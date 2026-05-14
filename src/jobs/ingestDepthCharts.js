/**
 * US-4.3: Depth chart ingestion from the MLB Stats API.
 *
 * Fetches the depth chart roster for every MLB team and updates each player's
 * `depth_chart_rank` and `depth_chart_position` columns. No API key required.
 *
 * Strategy:
 *   For each of the 30 teams:
 *     GET /api/v1/teams/{teamId}/roster?rosterType=depthChart
 *
 *   The response lists players in consecutive position groups, ordered by rank
 *   within each group (first entry = starter = rank 1). A multi-position
 *   player appears once per eligible position. We keep their BEST rank (lowest
 *   number) across all appearances and the canonical position where they got it.
 *
 * Position normalisation:
 *   LF / CF / RF → OF
 *   SP / CP / RP → P
 *   All others pass through if they map to our canonical set.
 *
 * Staleness threshold: 6 hours (configured in syncLog).
 *
 * Usage as a module:
 *   const { ingestDepthCharts } = require('./src/jobs/ingestDepthCharts');
 *   const result = await ingestDepthCharts({ force: true });
 *
 * Usage as a CLI script:
 *   node src/jobs/ingestDepthCharts.js [--force]
 */

require('dotenv').config();
const { getDb } = require('../db/connection');
const { isStale, recordSync } = require('../db/syncLog');

const API_BASE = 'https://statsapi.mlb.com/api/v1';
const SOURCE = 'depth_charts';
const PACING_MS = 300;

const log = require('../logger').child({ component: 'ingest', source: SOURCE });

// ── Fetch helpers ─────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'player-data-api/1.0 (fantasy-baseball)',
    },
  });

  if (response.status === 429) {
    if (attempt > 5) throw new Error(`HTTP 429 rate limit exceeded for ${url}`);
    const waitMs = Math.pow(2, attempt) * 1000;
    log.warn('rate limited', { waitSeconds: waitMs / 1000, attempt, maxAttempts: 5 });
    await sleep(waitMs);
    return fetchJson(url, attempt + 1);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 200)}`);
  }

  await sleep(PACING_MS);
  return response.json();
}

async function fetchTeams() {
  const year = new Date().getFullYear();
  const url = `${API_BASE}/teams?sportId=1&activeStatus=Yes&season=${year}&fields=teams,id,abbreviation`;
  const payload = await fetchJson(url);
  return (Array.isArray(payload.teams) ? payload.teams : []).filter((t) => t.id);
}

async function fetchDepthChart(teamId) {
  const url = `${API_BASE}/teams/${teamId}/roster?rosterType=depthChart`;
  const payload = await fetchJson(url);
  return Array.isArray(payload.roster) ? payload.roster : [];
}

// ── Position normalisation ────────────────────────────────────────────────────

const CANONICAL = new Set(['C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'P']);

/**
 * Maps a depth-chart position abbreviation to our canonical set.
 * Returns null for positions we don't track (e.g. unknown codes).
 */
function normalizeDepthChartPosition(abbr) {
  const raw = String(abbr || '').trim().toUpperCase();
  if (raw === 'LF' || raw === 'CF' || raw === 'RF') return 'OF';
  if (raw === 'SP' || raw === 'RP' || raw === 'CP') return 'P';
  return CANONICAL.has(raw) ? raw : null;
}

// ── Build depth chart map from all 30 teams ───────────────────────────────────

/**
 * Returns Map<player_id, { rank, position }> with the best (lowest) rank
 * across all position groups for each player.
 *
 * Rank is the 1-based index within a position group — so rank 1 = starter,
 * rank 2 = backup, etc.
 */
async function buildDepthChartMap() {
  const teams = await fetchTeams();
  log.info('fetching depth charts', { teams: teams.length });

  // Map<player_id, { rank, position }>
  const depthMap = new Map();
  let totalEntries = 0;

  for (const team of teams) {
    try {
      const roster = await fetchDepthChart(team.id);

      // Walk entries in order, tracking rank-within-position-group
      let currentPos = null;
      let rankInGroup = 0;

      for (const entry of roster) {
        const mlbId = Number(entry?.person?.id);
        if (!Number.isFinite(mlbId) || mlbId <= 0) continue;

        const rawAbbr = entry?.position?.abbreviation;
        const pos = normalizeDepthChartPosition(rawAbbr);
        if (!pos) continue;

        // Reset rank counter whenever the position group changes
        if (pos !== currentPos) {
          currentPos = pos;
          rankInGroup = 0;
        }
        rankInGroup++;

        const playerId = `mlb-${mlbId}`;
        const existing = depthMap.get(playerId);

        // Keep the best (lowest) rank this player achieves across all positions
        if (!existing || rankInGroup < existing.rank) {
          depthMap.set(playerId, { rank: rankInGroup, position: pos });
        }

        totalEntries++;
      }
    } catch (err) {
      log.warn('depth chart skipped', { teamId: team.id, error: err.message });
    }
  }

  log.info('depth chart map built', { uniquePlayers: depthMap.size, totalEntries, teams: teams.length });

  return depthMap;
}

// ── DB update ─────────────────────────────────────────────────────────────────

function applyDepthChartUpdates(depthMap) {
  const db = getDb();
  const { writeEvent } = (() => { try { return require('../db/eventsLog'); } catch (_) { return { writeEvent: () => null }; } })();

  // Ensure columns exist (idempotent — migrate.js also does this on startup)
  for (const col of [
    'ALTER TABLE players ADD COLUMN depth_chart_rank     INTEGER',
    'ALTER TABLE players ADD COLUMN depth_chart_position TEXT',
  ]) {
    try { db.exec(col); } catch (_) {}
  }

  // US-13.1: read prior depth chart state
  const priorDepth = new Map();
  try {
    const rows = db.prepare('SELECT player_id, depth_chart_rank, depth_chart_position FROM players').all();
    for (const r of rows) priorDepth.set(r.player_id, { rank: r.depth_chart_rank, position: r.depth_chart_position });
  } catch (_) {}

  const update = db.prepare(`
    UPDATE players
    SET depth_chart_rank     = @rank,
        depth_chart_position = @position,
        updated_at           = datetime('now')
    WHERE player_id = @player_id
      AND (depth_chart_rank IS NOT @rank OR depth_chart_position IS NOT @position)
  `);

  const clearAbsent = db.prepare(`
    UPDATE players
    SET depth_chart_rank     = NULL,
        depth_chart_position = NULL,
        updated_at           = datetime('now')
    WHERE (depth_chart_rank IS NOT NULL OR depth_chart_position IS NOT NULL)
      AND player_id NOT IN (SELECT value FROM json_each(@ids))
  `);

  let updated = 0;
  let cleared = 0;
  const changedPlayers = [];

  const run = db.transaction(() => {
    for (const [playerId, { rank, position }] of depthMap.entries()) {
      const info = update.run({ player_id: playerId, rank, position });
      if (info.changes) {
        updated++;
        changedPlayers.push({ playerId, newRank: rank, newPosition: position, prior: priorDepth.get(playerId) });
      }
    }

    const ids = JSON.stringify([...depthMap.keys()]);
    const info = clearAbsent.run({ ids });
    cleared = info.changes;
  });

  run();

  // US-13.1: emit player.depthChart events
  const dataAsOf = new Date().toISOString();
  for (const { playerId, newRank, newPosition, prior } of changedPlayers) {
    writeEvent('player.depthChart', playerId, {
      newValue:  { rank: newRank,      position: newPosition },
      priorValue: { rank: prior?.rank ?? null, position: prior?.position ?? null },
      dataAsOf,
    });
  }

  return { updated, cleared };
}

// ── Main job ──────────────────────────────────────────────────────────────────

/**
 * @param {object}  opts
 * @param {boolean} [opts.force=false] - skip staleness check
 * @returns {Promise<{skipped?:boolean, updated:number, cleared:number, total:number, durationMs:number}>}
 */
async function ingestDepthCharts({ force = false } = {}) {
  if (!force && !isStale(SOURCE)) {
    log.info('skip — fresh', { hint: 'use --force to override' });
    return { skipped: true, updated: 0, cleared: 0, total: 0, durationMs: 0 };
  }

  log.info('start');
  const start = Date.now();

  let depthMap;
  try {
    depthMap = await buildDepthChartMap();
  } catch (err) {
    recordSync(SOURCE, 'error', 0);
    throw new Error(`Failed to build depth chart map: ${err.message}`);
  }

  // Log rank distribution for observability
  const rankCounts = {};
  for (const { rank } of depthMap.values()) {
    const bucket = rank <= 3 ? String(rank) : '4+';
    rankCounts[bucket] = (rankCounts[bucket] || 0) + 1;
  }
  log.info('rank distribution', { rankCounts });

  const { updated, cleared } = applyDepthChartUpdates(depthMap);
  const durationMs = Date.now() - start;

  recordSync(SOURCE, 'success', depthMap.size);

  log.info('complete', { durationMs, updated, cleared, total: depthMap.size });

  return { updated, cleared, total: depthMap.size, durationMs };
}

module.exports = { ingestDepthCharts };

// Run directly as a CLI script
if (require.main === module) {
  const force = process.argv.includes('--force');
  ingestDepthCharts({ force })
    .then((result) => {
      if (result.skipped) {
        console.log('Skipped — data is still fresh. Use --force to override.');
      } else {
        console.log(
          `Done. updated=${result.updated} cleared=${result.cleared} ` +
          `total=${result.total} (${result.durationMs}ms)`
        );
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[ingest] Fatal error:', err.message);
      process.exit(1);
    });
}

/**
 * US-4.1: Player metadata ingestion from balldontlie MLB API.
 *
 * Fetches active player rosters and upserts them into the SQLite `players`
 * table. Idempotent — safe to run multiple times. Respects the staleness
 * threshold defined in data_sync_log (default 24h for player_metadata).
 *
 * Usage as a module:
 *   const { ingestPlayerMetadata } = require('./src/jobs/ingestPlayerMetadata');
 *   const result = await ingestPlayerMetadata({ force: true });
 *
 * Usage as a CLI script:
 *   BALLDONTLIE_API_KEY=... node src/jobs/ingestPlayerMetadata.js [--force]
 */

require('dotenv').config();
const { getDb } = require('../db/connection');
const { isStale, recordSync } = require('../db/syncLog');

const API_BASE = 'https://api.balldontlie.io/mlb/v1';
const SOURCE = 'player_metadata';

// ── Fetch helpers ────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, apiKey, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      Authorization: apiKey,
      Accept: 'application/json',
      'User-Agent': 'player-data-api/1.0',
    },
  });

  if (response.status === 429) {
    if (attempt > 6) throw new Error(`HTTP 429 rate limit exceeded for ${url}`);
    const resetAt = Number(response.headers.get('x-ratelimit-reset'));
    const waitMs = Number.isFinite(resetAt) && resetAt > 0
      ? Math.max(1000, resetAt * 1000 - Date.now() + 1000)
      : 15000;
    console.warn(`[ingest] Rate limited — waiting ${Math.ceil(waitMs / 1000)}s (attempt ${attempt}/6)`);
    await sleep(waitMs);
    return fetchJson(url, apiKey, attempt + 1);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 200)}`);
  }

  const remaining = Number(response.headers.get('x-ratelimit-remaining'));
  const resetAt   = Number(response.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(remaining) && remaining <= 0 && Number.isFinite(resetAt) && resetAt > 0) {
    const waitMs = Math.max(1000, resetAt * 1000 - Date.now() + 1000);
    console.warn(`[ingest] Rate window exhausted — waiting ${Math.ceil(waitMs / 1000)}s`);
    await sleep(waitMs);
  } else {
    await sleep(250); // gentle pacing
  }

  return response.json();
}

async function fetchPaginated(endpoint, apiKey, perPage = 100, maxItems = 600) {
  const all = [];
  let cursor = null;

  while (all.length < maxItems) {
    const params = new URLSearchParams({ per_page: String(perPage) });
    if (cursor !== null) params.set('cursor', String(cursor));
    const url = `${API_BASE}/${endpoint}?${params}`;
    const payload = await fetchJson(url, apiKey);
    const data = Array.isArray(payload.data) ? payload.data : [];
    all.push(...data);
    const next = payload.meta?.next_cursor;
    if (!next) break;
    cursor = next;
  }

  return all.slice(0, maxItems);
}

async function fetchActivePlayers(apiKey, perPage = 100) {
  try {
    return await fetchPaginated('players/active', apiKey, perPage);
  } catch (err) {
    if (!String(err.message).includes('HTTP 401')) throw err;
    console.warn('[ingest] players/active not available — falling back to /players');
    const all = await fetchPaginated('players', apiKey, perPage);
    return all.filter((p) => p && p.active !== false);
  }
}

// ── Normalisation ────────────────────────────────────────────────────────────

function normalizePosition(positionText) {
  const raw = String(positionText || '').trim();
  if (!raw) return ['U'];
  const VALID = new Set(['C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'P', 'U']);
  const tokens = raw
    .split(/[\/,]/)
    .map((t) => t.trim().toUpperCase())
    .map((t) => (t === 'RP' || t === 'SP' ? 'P' : t))
    .filter((t) => VALID.has(t));
  if (tokens.length) return [...new Set(tokens)];
  const u = raw.toUpperCase();
  if (u.includes('PITCHER'))           return ['P'];
  if (u.includes('CATCHER'))           return ['C'];
  if (u.includes('FIRST'))             return ['1B'];
  if (u.includes('SECOND'))            return ['2B'];
  if (u.includes('THIRD'))             return ['3B'];
  if (u.includes('SHORT'))             return ['SS'];
  if (u.includes('OUTFIELD'))          return ['OF'];
  if (u.includes('DESIGNATED'))        return ['DH'];
  return ['U'];
}

function toPlayerRow(player) {
  const id     = Number(player.id);
  const team   = player.team || {};
  const teamId = Number(team.id);
  const name   = String(player.full_name || `${player.first_name || ''} ${player.last_name || ''}`).trim();

  if (!Number.isFinite(id) || !Number.isFinite(teamId) || !team.abbreviation || !name) return null;

  const positions = normalizePosition(player.position);
  return {
    player_id:     `mlb-${id}`,
    mlb_person_id: id,
    name,
    player_name:   name,
    positions:     JSON.stringify(positions),
    position:      positions.join(','),
    mlb_team:      String(team.abbreviation).toUpperCase(),
    mlb_team_id:   `mlb-${teamId}`,
    status:        'active',
    is_available:  1,
  };
}

// ── DB upsert ────────────────────────────────────────────────────────────────

function upsertPlayers(rows) {
  const db = getDb();

  const existing = db.prepare('SELECT player_id, name, mlb_team, status, positions FROM players').all();
  const existingMap = new Map(existing.map((r) => [r.player_id, r]));

  const upsert = db.prepare(`
    INSERT INTO players (
      player_id, mlb_person_id, name, player_name,
      positions, position, mlb_team, mlb_team_id,
      status, is_available, updated_at
    ) VALUES (
      @player_id, @mlb_person_id, @name, @player_name,
      @positions, @position, @mlb_team, @mlb_team_id,
      @status, @is_available, datetime('now')
    )
    ON CONFLICT(player_id) DO UPDATE SET
      name          = excluded.name,
      player_name   = excluded.player_name,
      positions     = excluded.positions,
      position      = excluded.position,
      mlb_team      = excluded.mlb_team,
      mlb_team_id   = excluded.mlb_team_id,
      status        = excluded.status,
      is_available  = excluded.is_available,
      updated_at    = datetime('now')
  `);

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  const run = db.transaction((playerRows) => {
    for (const row of playerRows) {
      const prev = existingMap.get(row.player_id);
      if (!prev) {
        upsert.run(row);
        added++;
      } else {
        const changed =
          prev.name      !== row.name      ||
          prev.mlb_team  !== row.mlb_team  ||
          prev.status    !== row.status    ||
          prev.positions !== row.positions;
        if (changed) {
          upsert.run(row);
          updated++;
        } else {
          unchanged++;
        }
      }
    }
  });

  run(rows);
  return { added, updated, unchanged };
}

// ── Main job ─────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {boolean} [opts.force=false] - skip staleness check
 * @param {string}  [opts.apiKey]      - override env var
 * @param {number}  [opts.perPage=100]
 * @returns {Promise<{skipped?:boolean, added:number, updated:number, unchanged:number, total:number, durationMs:number}>}
 */
async function ingestPlayerMetadata({ force = false, apiKey, perPage = 100 } = {}) {
  const key = apiKey || process.env.BALLDONTLIE_API_KEY || process.env.BDL_API_KEY || '';

  if (!key) {
    throw new Error('BALLDONTLIE_API_KEY is required for player metadata ingestion');
  }

  if (!force && !isStale(SOURCE)) {
    console.log(`[ingest] ${SOURCE} is fresh — skipping (use force:true to override)`);
    return { skipped: true, added: 0, updated: 0, unchanged: 0, total: 0, durationMs: 0 };
  }

  console.log(`[ingest] Starting ${SOURCE} ingestion…`);
  const start = Date.now();

  let players;
  try {
    players = await fetchActivePlayers(key, perPage);
    console.log(`[ingest] Fetched ${players.length} active players from API`);
  } catch (err) {
    recordSync(SOURCE, 'error', 0);
    throw err;
  }

  const rows = players.map(toPlayerRow).filter(Boolean);
  const skippedCount = players.length - rows.length;
  if (skippedCount) {
    console.warn(`[ingest] Skipped ${skippedCount} players (missing required fields)`);
  }

  const { added, updated, unchanged } = upsertPlayers(rows);
  const durationMs = Date.now() - start;

  recordSync(SOURCE, 'success', rows.length);

  console.log(
    `[ingest] ${SOURCE} complete in ${durationMs}ms — ` +
    `added: ${added}, updated: ${updated}, unchanged: ${unchanged}`
  );

  return { added, updated, unchanged, total: rows.length, durationMs };
}

module.exports = { ingestPlayerMetadata };

// Run directly as a script
if (require.main === module) {
  const force = process.argv.includes('--force');
  ingestPlayerMetadata({ force })
    .then((result) => {
      if (result.skipped) {
        console.log('Skipped — data is still fresh. Use --force to override.');
      } else {
        console.log(`Done. added=${result.added} updated=${result.updated} unchanged=${result.unchanged} total=${result.total} (${result.durationMs}ms)`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[ingest] Fatal error:', err.message);
      process.exit(1);
    });
}

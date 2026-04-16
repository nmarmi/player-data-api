/**
 * US-4.1: Player metadata ingestion from the MLB Stats API.
 *
 * Fetches the 40-man roster for every MLB team and upserts players into the
 * SQLite `players` table. No API key is required — the MLB Stats API is free
 * and publicly accessible at statsapi.mlb.com.
 *
 * Strategy:
 *   1. GET /api/v1/teams?sportId=1  → build teamId → abbreviation map
 *   2. For each team: GET /api/v1/teams/{id}/roster?rosterType=40Man&hydrate=person
 *   3. Parse roster entries → normalize → upsert
 *
 * The 40-man roster includes active players, IL players, and optioned players,
 * which is the right scope for a fantasy baseball player pool.
 *
 * Usage as a module:
 *   const { ingestPlayerMetadata } = require('./src/jobs/ingestPlayerMetadata');
 *   const result = await ingestPlayerMetadata({ force: true });
 *
 * Usage as a CLI script:
 *   node src/jobs/ingestPlayerMetadata.js [--force] [--season 2025]
 */

require('dotenv').config();
const { getDb } = require('../db/connection');
const { isStale, recordSync } = require('../db/syncLog');

const API_BASE = 'https://statsapi.mlb.com/api/v1';
const SOURCE = 'player_metadata';

// Polite pacing between requests (ms). The MLB Stats API has no published rate
// limit, so we stay courteous to avoid triggering any undocumented throttling.
const PACING_MS = 300;

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
    console.warn(`[ingest] Rate limited — waiting ${waitMs / 1000}s (attempt ${attempt}/5)`);
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

// ── MLB Stats API calls ───────────────────────────────────────────────────────

/**
 * Returns all active MLB teams for the given season.
 * @returns {Promise<Array<{id: number, abbreviation: string, name: string}>>}
 */
async function fetchTeams(season) {
  const url = `${API_BASE}/teams?sportId=1&activeStatus=Yes&season=${season}&fields=teams,id,abbreviation,name`;
  const payload = await fetchJson(url);
  const teams = Array.isArray(payload.teams) ? payload.teams : [];
  return teams.filter((t) => t.id && t.abbreviation);
}

/**
 * Returns the 40-man roster for a single team, with person details hydrated.
 * Each entry has: { person: { id, fullName, primaryPosition }, position, status }
 * @returns {Promise<Array>}
 */
async function fetchTeamRoster(teamId, season) {
  const url =
    `${API_BASE}/teams/${teamId}/roster` +
    `?rosterType=40Man&season=${season}&hydrate=person`;
  const payload = await fetchJson(url);
  return Array.isArray(payload.roster) ? payload.roster : [];
}

// ── Normalisation ─────────────────────────────────────────────────────────────

const VALID_POSITIONS = new Set(['C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'P', 'U']);

/**
 * Maps MLB Stats API position abbreviations to our canonical position tokens.
 * SP/RP → P, LF/CF/RF → OF, everything else pass-through if valid.
 */
function normalizePosition(abbreviation) {
  const raw = String(abbreviation || '').trim().toUpperCase();
  if (raw === 'SP' || raw === 'RP') return 'P';
  if (raw === 'LF' || raw === 'CF' || raw === 'RF') return 'OF';
  if (raw === 'TWP') return 'P'; // two-way player — treated as pitcher
  return VALID_POSITIONS.has(raw) ? raw : null;
}

/**
 * Given a roster entry from the MLB Stats API, return a DB row or null if
 * required fields are missing.
 *
 * Roster entry shape (with hydrate=person):
 * {
 *   person: { id, fullName, primaryPosition: { abbreviation } },
 *   position: { abbreviation },   ← current roster slot position
 *   status:   { code, description }
 * }
 */
function toPlayerRow(entry, teamAbbr, teamId) {
  const person = entry.person || {};
  const mlbId = Number(person.id);
  const name = String(person.fullName || '').trim();

  if (!Number.isFinite(mlbId) || mlbId <= 0 || !name || !teamAbbr) return null;

  // Prefer the roster-slot position; fall back to the player's primary position
  const posAbbr =
    (entry.position && entry.position.abbreviation) ||
    (person.primaryPosition && person.primaryPosition.abbreviation) ||
    '';

  const pos = normalizePosition(posAbbr);
  const positions = pos ? [pos] : ['U'];

  // Translate roster status to our canonical values
  const statusCode = String(entry.status?.code || 'A').trim().toUpperCase();
  const status = normalizeRosterStatus(statusCode, entry.status?.description);

  return {
    player_id:     `mlb-${mlbId}`,
    mlb_person_id: mlbId,
    name,
    player_name:   name,
    positions:     JSON.stringify(positions),
    position:      positions.join(','),
    mlb_team:      String(teamAbbr).toUpperCase(),
    mlb_team_id:   `mlb-${teamId}`,
    status,
    is_available:  status === 'active' || status === 'DTD' ? 1 : 0,
  };
}

/**
 * Maps MLB roster status codes to our canonical status strings.
 *
 * Common codes from the API:
 *   A  = Active
 *   D10 = 10-Day IL
 *   D15 = 15-Day IL (historical, now 10-Day)
 *   D60 = 60-Day IL
 *   RM = Restricted List
 *   BRV = Bereavement List
 *   PL = Paternity List
 *   MIN = Minor League / Optioned
 *   DFA = Designated for Assignment
 *   NON = Non-Roster Invitee
 */
function normalizeRosterStatus(code, description) {
  if (code === 'A') return 'active';
  if (code === 'D10' || code === 'D15') return 'IL-10';
  if (code === 'D60') return 'IL-60';
  if (code === 'PL' || code === 'BRV') return 'DTD';
  if (code === 'MIN') return 'minors';
  if (code === 'DFA') return 'DFA';
  if (code === 'RM') return 'restricted';

  // Fall back to description-based matching
  const desc = String(description || '').toUpperCase();
  if (desc.includes('60')) return 'IL-60';
  if (desc.includes('10') || desc.includes('15')) return 'IL-10';
  if (desc.includes('PATERNITY') || desc.includes('BEREAVEMENT')) return 'DTD';
  if (desc.includes('MINOR') || desc.includes('OPTION')) return 'minors';
  if (desc.includes('DESIGNATED')) return 'DFA';

  return 'active';
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

function upsertPlayers(rows) {
  const db = getDb();

  const existing = db
    .prepare('SELECT player_id, name, mlb_team, status, positions FROM players')
    .all();
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
      name         = excluded.name,
      player_name  = excluded.player_name,
      positions    = excluded.positions,
      position     = excluded.position,
      mlb_team     = excluded.mlb_team,
      mlb_team_id  = excluded.mlb_team_id,
      status       = excluded.status,
      is_available = excluded.is_available,
      updated_at   = datetime('now')
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

// ── Main job ──────────────────────────────────────────────────────────────────

/**
 * @param {object}  opts
 * @param {boolean} [opts.force=false]  - skip staleness check and run anyway
 * @param {number}  [opts.season]       - MLB season year (defaults to current year)
 * @returns {Promise<{skipped?:boolean, added:number, updated:number, unchanged:number, total:number, teams:number, durationMs:number}>}
 */
async function ingestPlayerMetadata({ force = false, season } = {}) {
  if (!force && !isStale(SOURCE)) {
    console.log(`[ingest] ${SOURCE} is fresh — skipping (use force:true to override)`);
    return { skipped: true, added: 0, updated: 0, unchanged: 0, total: 0, teams: 0, durationMs: 0 };
  }

  const year = season || new Date().getFullYear();
  console.log(`[ingest] Starting ${SOURCE} ingestion for ${year} season…`);
  const start = Date.now();

  // Step 1: fetch all MLB teams
  let teams;
  try {
    teams = await fetchTeams(year);
    console.log(`[ingest] Found ${teams.length} MLB teams`);
  } catch (err) {
    recordSync(SOURCE, 'error', 0);
    throw new Error(`Failed to fetch MLB teams: ${err.message}`);
  }

  // Step 2: fetch 40-man roster for each team
  const allRows = [];
  let skippedEntries = 0;

  for (const team of teams) {
    try {
      const roster = await fetchTeamRoster(team.id, year);
      let teamCount = 0;
      for (const entry of roster) {
        const row = toPlayerRow(entry, team.abbreviation, team.id);
        if (row) {
          allRows.push(row);
          teamCount++;
        } else {
          skippedEntries++;
        }
      }
      console.log(`[ingest]   ${team.abbreviation}: ${teamCount} players`);
    } catch (err) {
      console.warn(`[ingest] Skipping ${team.abbreviation} (teamId ${team.id}): ${err.message}`);
    }
  }

  if (skippedEntries) {
    console.warn(`[ingest] Skipped ${skippedEntries} entries (missing required fields)`);
  }

  // Deduplicate by player_id — a player traded mid-season appears on both teams;
  // last occurrence wins (most recently processed team = current team)
  const deduped = [...new Map(allRows.map((r) => [r.player_id, r])).values()];
  const duplicates = allRows.length - deduped.length;
  if (duplicates) {
    console.log(`[ingest] Deduped ${duplicates} duplicate entries (multi-team players)`);
  }

  // Step 3: upsert into the database
  const { added, updated, unchanged } = upsertPlayers(deduped);
  const durationMs = Date.now() - start;

  recordSync(SOURCE, 'success', deduped.length);

  console.log(
    `[ingest] ${SOURCE} complete in ${durationMs}ms — ` +
    `added: ${added}, updated: ${updated}, unchanged: ${unchanged}, total: ${deduped.length}`
  );

  return { added, updated, unchanged, total: deduped.length, teams: teams.length, durationMs };
}

module.exports = { ingestPlayerMetadata };

// Run directly as a CLI script
if (require.main === module) {
  const force  = process.argv.includes('--force');
  const si     = process.argv.indexOf('--season');
  const season = si !== -1 ? Number(process.argv[si + 1]) : undefined;

  ingestPlayerMetadata({ force, season })
    .then((result) => {
      if (result.skipped) {
        console.log('Skipped — data is still fresh. Use --force to override.');
      } else {
        console.log(
          `Done. added=${result.added} updated=${result.updated} ` +
          `unchanged=${result.unchanged} total=${result.total} ` +
          `teams=${result.teams} (${result.durationMs}ms)`
        );
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[ingest] Fatal error:', err.message);
      process.exit(1);
    });
}

/**
 * US-4.2: Injury status ingestion from the MLB Stats API.
 *
 * Updates player `status` and `is_available` in the DB without modifying
 * any other fields (name, team, positions). No API key required.
 *
 * Two complementary data sources are combined:
 *
 *   1. PRIMARY — 40-man roster per team (30 calls)
 *      GET /api/v1/teams/{teamId}/roster?rosterType=40Man
 *      Provides the authoritative current status for every 40-man player via
 *      the roster entry's status.code field (D10, D60, A, MIN, etc.).
 *
 *   2. SUPPLEMENTARY — recent "Status Change" transactions (1 call)
 *      GET /api/v1/transactions?startDate={7daysAgo}&endDate={today}&sportId=1
 *      Parses the free-text `description` field to catch very recent IL
 *      placements, activations, and paternity list moves. These override
 *      the roster status since they may be more up-to-date.
 *
 * Staleness threshold: 1 hour (set in syncLog).
 *
 * Usage as a module:
 *   const { ingestInjuries } = require('./src/jobs/ingestInjuries');
 *   const result = await ingestInjuries({ force: true });
 *
 * Usage as a CLI script:
 *   node src/jobs/ingestInjuries.js [--force]
 */

require('dotenv').config();
const { getDb } = require('../db/connection');
const { isStale, recordSync } = require('../db/syncLog');

const API_BASE = 'https://statsapi.mlb.com/api/v1';
const SOURCE = 'injuries';
const PACING_MS = 300;

// How many days back to look for supplementary transaction data
const TRANSACTION_LOOKBACK_DAYS = 7;

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

async function fetchTeams() {
  const year = new Date().getFullYear();
  const url = `${API_BASE}/teams?sportId=1&activeStatus=Yes&season=${year}&fields=teams,id,abbreviation`;
  const payload = await fetchJson(url);
  return (Array.isArray(payload.teams) ? payload.teams : []).filter((t) => t.id);
}

/**
 * Fetches the 40-man roster for a single team.
 * We only need the person.id and status.code — no hydration needed.
 */
async function fetchTeamRoster(teamId) {
  const year = new Date().getFullYear();
  const url = `${API_BASE}/teams/${teamId}/roster?rosterType=40Man&season=${year}`;
  const payload = await fetchJson(url);
  return Array.isArray(payload.roster) ? payload.roster : [];
}

/**
 * Fetches all Status Change transactions from the last TRANSACTION_LOOKBACK_DAYS days.
 */
async function fetchRecentStatusChanges() {
  const now = new Date();
  const endDate   = now.toISOString().slice(0, 10);
  const startDate = new Date(now - TRANSACTION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const url =
    `${API_BASE}/transactions` +
    `?startDate=${startDate}&endDate=${endDate}&sportId=1`;
  const payload = await fetchJson(url);
  const all = Array.isArray(payload.transactions) ? payload.transactions : [];
  return all.filter((t) => t.typeCode === 'SC');
}

// ── Status normalisation ──────────────────────────────────────────────────────

/**
 * Maps MLB roster status codes to our canonical status strings.
 * Mirrors the mapping used in ingestPlayerMetadata for consistency.
 */
function normalizeRosterStatusCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (c === 'A')   return 'active';
  if (c === 'D10' || c === 'D15') return 'IL-10';
  if (c === 'D60') return 'IL-60';
  if (c === 'PL' || c === 'BRV')  return 'DTD';
  if (c === 'MIN') return 'minors';
  if (c === 'DFA') return 'DFA';
  if (c === 'RM')  return 'restricted';
  return 'active';
}

/**
 * Parses a transaction description string to derive a canonical status.
 * Returns null if the description doesn't indicate a recognisable status change.
 *
 * Example descriptions:
 *   "placed LHP Chris Murphy on the 15-day injured list..."
 *   "placed CF Parker Meadows on the 10-day injured list..."
 *   "placed ... on the 60-day injured list..."
 *   "activated RHP Pete Fairbanks from the paternity list."
 *   "reinstated ... from the 10-day injured list."
 *   "transferred ... to the 60-day injured list."
 */
function parseTransactionDescription(description) {
  if (!description) return null;
  const desc = description.toLowerCase();

  // IL placements and transfers
  if (desc.includes('60-day injured list') || desc.includes('60 day injured list')) return 'IL-60';
  if (
    desc.includes('10-day injured list') ||
    desc.includes('10 day injured list') ||
    desc.includes('15-day injured list') ||
    desc.includes('15 day injured list')
  ) return 'IL-10';

  // Paternity / bereavement
  if (desc.includes('paternity list') || desc.includes('bereavement list')) {
    // "placed on" = DTD; "activated from" = active (handled below)
    if (desc.includes('placed') || desc.includes('transferred')) return 'DTD';
  }

  // Activations and reinstatements → back to active
  if (
    desc.includes('activated') ||
    desc.includes('reinstated') ||
    desc.includes('returned from')
  ) return 'active';

  return null;
}

function isAvailableStatus(status) {
  return status === 'active' || status === 'DTD';
}

// ── Build combined status map ─────────────────────────────────────────────────

/**
 * Source 1: iterate all 30 teams' 40-man rosters.
 * Returns Map<player_id_string, canonical_status_string>
 */
async function buildRosterStatusMap() {
  const teams = await fetchTeams();
  console.log(`[ingest] Scanning 40-man rosters for ${teams.length} teams…`);

  const statusMap = new Map();
  for (const team of teams) {
    try {
      const roster = await fetchTeamRoster(team.id);
      for (const entry of roster) {
        const mlbId = Number(entry?.person?.id);
        if (!Number.isFinite(mlbId) || mlbId <= 0) continue;
        const status = normalizeRosterStatusCode(entry?.status?.code);
        statusMap.set(`mlb-${mlbId}`, status);
      }
    } catch (err) {
      console.warn(`[ingest] Skipping roster for team ${team.id}: ${err.message}`);
    }
  }

  return statusMap;
}

/**
 * Source 2: recent Status Change transactions.
 * Returns Map<player_id_string, canonical_status_string>
 * Only entries where the description maps to a known status are included.
 */
async function buildTransactionStatusMap() {
  let txns;
  try {
    txns = await fetchRecentStatusChanges();
  } catch (err) {
    console.warn(`[ingest] Could not fetch transactions (non-fatal): ${err.message}`);
    return new Map();
  }

  console.log(`[ingest] ${txns.length} Status Change transactions in last ${TRANSACTION_LOOKBACK_DAYS} days`);

  // Sort oldest → newest so later (more recent) entries win when we iterate
  txns.sort((a, b) => new Date(a.date) - new Date(b.date));

  const statusMap = new Map();
  for (const txn of txns) {
    const mlbId = Number(txn?.person?.id);
    if (!Number.isFinite(mlbId) || mlbId <= 0) continue;
    const status = parseTransactionDescription(txn.description);
    if (status) statusMap.set(`mlb-${mlbId}`, status);
  }

  return statusMap;
}

// ── DB update ─────────────────────────────────────────────────────────────────

/**
 * Applies status updates from the combined map.
 *
 * - Every player in the map gets their status/is_available updated if changed.
 * - Players in the DB who are currently non-active AND are absent from the map
 *   are reset to 'active' (they've been removed from the 40-man entirely, so
 *   their last known healthy status is assumed).
 */
function applyStatusUpdates(combinedMap) {
  const db = getDb();

  const updateStatus = db.prepare(`
    UPDATE players
    SET status       = @status,
        is_available = @is_available,
        updated_at   = datetime('now')
    WHERE player_id = @player_id
      AND (status != @status OR is_available != @is_available)
  `);

  // Reset players who are no longer on any 40-man roster back to active.
  // json_each lets SQLite unpack a JSON array of IDs inline.
  const resetAbsent = db.prepare(`
    UPDATE players
    SET status       = 'active',
        is_available = 1,
        updated_at   = datetime('now')
    WHERE status != 'active'
      AND player_id NOT IN (SELECT value FROM json_each(@ids))
  `);

  let updated = 0;
  let cleared = 0;

  const run = db.transaction(() => {
    for (const [playerId, status] of combinedMap.entries()) {
      const available = isAvailableStatus(status) ? 1 : 0;
      const info = updateStatus.run({ player_id: playerId, status, is_available: available });
      if (info.changes) updated++;
    }

    const ids = JSON.stringify([...combinedMap.keys()]);
    const info = resetAbsent.run({ ids });
    cleared = info.changes;
  });

  run();
  return { updated, cleared };
}

// ── Main job ──────────────────────────────────────────────────────────────────

/**
 * @param {object}  opts
 * @param {boolean} [opts.force=false] - skip staleness check
 * @returns {Promise<{skipped?:boolean, updated:number, cleared:number, nonActive:number, total:number, durationMs:number}>}
 */
async function ingestInjuries({ force = false } = {}) {
  if (!force && !isStale(SOURCE)) {
    console.log(`[ingest] ${SOURCE} is fresh — skipping (use --force to override)`);
    return { skipped: true, updated: 0, cleared: 0, nonActive: 0, total: 0, durationMs: 0 };
  }

  console.log(`[ingest] Starting ${SOURCE} ingestion…`);
  const start = Date.now();

  // Build status map from primary source (40-man rosters)
  let rosterMap;
  try {
    rosterMap = await buildRosterStatusMap();
    console.log(`[ingest] Roster map built: ${rosterMap.size} players`);
  } catch (err) {
    recordSync(SOURCE, 'error', 0);
    throw new Error(`Failed to build roster status map: ${err.message}`);
  }

  // Build supplementary map from recent transactions and merge
  // Transactions are more recent so they take priority when there is a conflict
  const txnMap = await buildTransactionStatusMap();
  const combinedMap = new Map([...rosterMap, ...txnMap]);

  const nonActive = [...combinedMap.values()].filter((s) => s !== 'active').length;
  console.log(
    `[ingest] Combined status map: ${combinedMap.size} players, ` +
    `${nonActive} non-active (${combinedMap.size - nonActive} active)`
  );

  // Log a breakdown of non-active statuses
  const breakdown = {};
  for (const status of combinedMap.values()) {
    if (status !== 'active') breakdown[status] = (breakdown[status] || 0) + 1;
  }
  if (Object.keys(breakdown).length) {
    console.log('[ingest] Non-active breakdown:', breakdown);
  }

  const { updated, cleared } = applyStatusUpdates(combinedMap);
  const durationMs = Date.now() - start;

  recordSync(SOURCE, 'success', nonActive);

  console.log(
    `[ingest] ${SOURCE} complete in ${durationMs}ms — ` +
    `statuses updated: ${updated}, recovered (reset to active): ${cleared}`
  );

  return { updated, cleared, nonActive, total: combinedMap.size, durationMs };
}

module.exports = { ingestInjuries };

// Run directly as a CLI script
if (require.main === module) {
  const force = process.argv.includes('--force');
  ingestInjuries({ force })
    .then((result) => {
      if (result.skipped) {
        console.log('Skipped — data is still fresh. Use --force to override.');
      } else {
        console.log(
          `Done. updated=${result.updated} cleared=${result.cleared} ` +
          `nonActive=${result.nonActive} total=${result.total} (${result.durationMs}ms)`
        );
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[ingest] Fatal error:', err.message);
      process.exit(1);
    });
}

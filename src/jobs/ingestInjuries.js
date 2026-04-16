/**
 * US-4.2: Injury status ingestion from balldontlie MLB API.
 *
 * Fetches the current injury list and updates player `status` and
 * `is_available` in the DB. Players not on the injury list are reset
 * to `active`. Staleness threshold: 1 hour (set in syncLog).
 *
 * Usage as a module:
 *   const { ingestInjuries } = require('./src/jobs/ingestInjuries');
 *   const result = await ingestInjuries({ force: true });
 *
 * Usage as a CLI script:
 *   BALLDONTLIE_API_KEY=... node src/jobs/ingestInjuries.js [--force]
 */

require('dotenv').config();
const { getDb } = require('../db/connection');
const { isStale, recordSync } = require('../db/syncLog');

const API_BASE = 'https://api.balldontlie.io/mlb/v1';
const SOURCE = 'injuries';

// ── Fetch helpers (same rate-limit handling as 4.1) ─────────────────────────

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
    await sleep(250);
  }

  return response.json();
}

async function fetchPaginated(endpoint, apiKey, perPage = 100) {
  const all = [];
  let cursor = null;

  while (true) {
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

  return all;
}

// ── Status normalisation ─────────────────────────────────────────────────────

/**
 * Maps balldontlie injury status strings to canonical values:
 * IL-10, IL-60, DTD, day-to-day, injured
 */
function normalizeInjuryStatus(raw) {
  if (!raw) return 'injured';
  const text = String(raw).trim();
  const upper = text.toUpperCase();

  if (upper.includes('60')) return 'IL-60';
  if (upper.includes('15')) return 'IL-15';
  if (upper.includes('10')) return 'IL-10';
  if (upper === 'DTD' || upper.includes('DAY-TO-DAY') || upper.includes('DAY TO DAY')) return 'DTD';
  if (upper.includes('OUT')) return 'injured';
  if (upper.includes('IL')) return 'injured';
  return text.toLowerCase();
}

function isAvailableStatus(status) {
  return status === 'active' || status === 'DTD' || status === 'day-to-day';
}

// ── DB update ────────────────────────────────────────────────────────────────

function applyInjuryUpdates(injuredMap) {
  const db = getDb();

  const updateStatus = db.prepare(`
    UPDATE players
    SET status = @status, is_available = @is_available, updated_at = datetime('now')
    WHERE player_id = @player_id AND (status != @status OR is_available != @is_available)
  `);

  const resetActive = db.prepare(`
    UPDATE players
    SET status = 'active', is_available = 1, updated_at = datetime('now')
    WHERE status != 'active' AND player_id NOT IN (SELECT value FROM json_each(@ids))
  `);

  let updated = 0;
  let cleared = 0;

  const run = db.transaction(() => {
    // Update injured players
    for (const [playerId, status] of injuredMap.entries()) {
      const available = isAvailableStatus(status) ? 1 : 0;
      const info = updateStatus.run({ player_id: playerId, status, is_available: available });
      if (info.changes) updated++;
    }

    // Reset players who have recovered (were non-active but no longer in injury list)
    const ids = JSON.stringify([...injuredMap.keys()]);
    const info = resetActive.run({ ids });
    cleared = info.changes;
  });

  run();
  return { updated, cleared };
}

// ── Main job ─────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {boolean} [opts.force=false]
 * @param {string}  [opts.apiKey]
 * @returns {Promise<{skipped?:boolean, updated:number, cleared:number, total:number, durationMs:number}>}
 */
async function ingestInjuries({ force = false, apiKey } = {}) {
  const key = apiKey || process.env.BALLDONTLIE_API_KEY || process.env.BDL_API_KEY || '';

  if (!key) {
    throw new Error('BALLDONTLIE_API_KEY is required for injury ingestion');
  }

  if (!force && !isStale(SOURCE)) {
    console.log(`[ingest] ${SOURCE} is fresh — skipping (use force:true to override)`);
    return { skipped: true, updated: 0, cleared: 0, total: 0, durationMs: 0 };
  }

  console.log(`[ingest] Starting ${SOURCE} ingestion…`);
  const start = Date.now();

  let injuries;
  try {
    injuries = await fetchPaginated('player_injuries', key);
    console.log(`[ingest] Fetched ${injuries.length} injury records`);
  } catch (err) {
    if (String(err.message).includes('HTTP 401')) {
      console.warn('[ingest] player_injuries endpoint requires a paid balldontlie plan — skipping injury updates');
      recordSync(SOURCE, 'unavailable', 0);
      return { skipped: true, reason: 'API tier does not include player_injuries', updated: 0, cleared: 0, total: 0, durationMs: Date.now() - start };
    }
    recordSync(SOURCE, 'error', 0);
    throw err;
  }

  // Build a map of mlb-{id} → normalized status
  const injuredMap = new Map();
  for (const row of injuries) {
    const playerId = Number(row?.player?.id || row?.player_id);
    if (!Number.isFinite(playerId) || playerId <= 0) continue;
    const rawStatus = row.status || row.injury_status || row.type || '';
    injuredMap.set(`mlb-${playerId}`, normalizeInjuryStatus(rawStatus));
  }

  console.log(`[ingest] ${injuredMap.size} unique players on injury list`);

  const { updated, cleared } = applyInjuryUpdates(injuredMap);
  const durationMs = Date.now() - start;

  recordSync(SOURCE, 'success', injuredMap.size);

  console.log(
    `[ingest] ${SOURCE} complete in ${durationMs}ms — ` +
    `statuses updated: ${updated}, recovered (reset to active): ${cleared}`
  );

  return { updated, cleared, total: injuredMap.size, durationMs };
}

module.exports = { ingestInjuries };

// Run directly as a script
if (require.main === module) {
  const force = process.argv.includes('--force');
  ingestInjuries({ force })
    .then((result) => {
      if (result.skipped) {
        console.log('Skipped — data is still fresh. Use --force to override.');
      } else {
        console.log(`Done. updated=${result.updated} cleared=${result.cleared} total=${result.total} (${result.durationMs}ms)`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[ingest] Fatal error:', err.message);
      process.exit(1);
    });
}

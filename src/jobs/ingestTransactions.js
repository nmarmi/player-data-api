/**
 * US-4.4: Transaction / roster-status ingestion from the MLB Stats API.
 *
 * Fetches recent MLB transactions and applies two kinds of DB updates:
 *   1. mlb_team / mlb_team_id — when a player changes MLB teams (trades,
 *      call-ups, waiver claims)
 *   2. status / is_available  — when a player's roster status changes
 *      (optioned, DFA, released, recalled)
 *
 * Only "status" and "team" updates from this job are written; the 4.2
 * injury job owns IL / DTD status updates and runs at a higher frequency.
 *
 * A full audit trail is kept in the `transactions` table (ON CONFLICT DO
 * NOTHING so re-runs are safe).
 *
 * No API key required. Staleness threshold: 6 hours (configured in syncLog).
 *
 * Usage as a module:
 *   const { ingestTransactions } = require('./src/jobs/ingestTransactions');
 *   await ingestTransactions({ force: true });
 *
 * Usage as a CLI script:
 *   node src/jobs/ingestTransactions.js [--force] [--days 14]
 */

require('dotenv').config();
const { getDb } = require('../db/connection');
const { isStale, recordSync } = require('../db/syncLog');

const API_BASE = 'https://statsapi.mlb.com/api/v1';
const SOURCE = 'transactions';
const PACING_MS = 300;
const DEFAULT_LOOKBACK_DAYS = 7;

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
 * Returns a Map<teamId, { abbreviation, name }> for all active MLB teams.
 */
async function fetchMlbTeamMap() {
  const year = new Date().getFullYear();
  const url = `${API_BASE}/teams?sportId=1&activeStatus=Yes&season=${year}&fields=teams,id,abbreviation,name`;
  const payload = await fetchJson(url);
  const teams = Array.isArray(payload.teams) ? payload.teams : [];
  const map = new Map();
  for (const t of teams) {
    if (t.id && t.abbreviation) map.set(Number(t.id), t.abbreviation);
  }
  return map;
}

/**
 * Fetches all transactions between startDate and endDate (YYYY-MM-DD strings).
 */
async function fetchTransactions(startDate, endDate) {
  const url =
    `${API_BASE}/transactions` +
    `?startDate=${startDate}&endDate=${endDate}&sportId=1`;
  const payload = await fetchJson(url);
  return Array.isArray(payload.transactions) ? payload.transactions : [];
}

// ── Transaction classification ────────────────────────────────────────────────

/**
 * Given a transaction and the set of MLB team IDs, returns the DB fields that
 * should be updated, or null if this transaction type is not relevant.
 *
 * Returns: { mlb_team?, mlb_team_id?, status? } — null fields mean "don't update".
 *
 * typeCode reference (from live API inspection):
 *   TR  = Trade
 *   CU  = Recalled (call-up)
 *   SE  = Selected (contract selected from minors)
 *   OPT = Optioned (sent to minors)
 *   DES = Designated for Assignment
 *   REL = Released
 *   WC  = Claimed Off Waivers
 *   OUT = Outrighted to minors
 *   SC  = Status Change (IL/injuries — handled by 4.2, skipped here)
 *   NC  = Number Change, FA = Free Agent sign, ASS = Assignment — all ignored
 */
function classifyTransaction(txn, mlbTeamMap) {
  const typeCode = String(txn.typeCode || '').trim().toUpperCase();
  const toTeamId = Number(txn.toTeam?.id);
  const toAbbr   = mlbTeamMap.get(toTeamId);   // defined only for MLB teams
  const isToMlb  = Boolean(toAbbr);

  switch (typeCode) {
    // ── Team transfers ──────────────────────────────────────────────────────
    case 'TR':   // Trade between teams
    case 'WC': { // Claimed off waivers
      if (!isToMlb) return null;
      return {
        mlb_team:    toAbbr,
        mlb_team_id: `mlb-${toTeamId}`,
        status:      null,   // trades don't change active/IL status
      };
    }

    case 'CU':   // Recalled from minors
    case 'SE': { // Contract selected from minors
      if (!isToMlb) return null;
      return {
        mlb_team:    toAbbr,
        mlb_team_id: `mlb-${toTeamId}`,
        status:      'active',
      };
    }

    // ── Status-only changes (team stays the same) ───────────────────────────
    case 'OPT': return { status: 'minors' };    // Optioned to minors
    case 'OUT': return { status: 'minors' };    // Outrighted to minors
    case 'DES': return { status: 'DFA' };       // Designated for Assignment
    case 'REL': return { status: 'released' };  // Released outright

    // ── Deliberately ignored ────────────────────────────────────────────────
    case 'SC':  // Status Change — owned by the 4.2 injury job
    default:
      return null;
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

function isAvailableStatus(status) {
  return status === 'active';
}

/**
 * Applies a map of player updates and inserts the raw transactions for audit.
 *
 * @param {Map<string, { mlb_team?, mlb_team_id?, status? }>} playerUpdates
 * @param {Array} rawTxns  — all transactions in the window (for audit table)
 */
function applyTransactionUpdates(playerUpdates, rawTxns) {
  const db = getDb();

  // Ensure the transactions table exists (migrate.js also does this on boot)
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      txn_id         INTEGER PRIMARY KEY,
      player_id      TEXT    NOT NULL,
      mlb_person_id  INTEGER NOT NULL,
      type_code      TEXT    NOT NULL,
      type_desc      TEXT    NOT NULL,
      from_team_id   INTEGER,
      to_team_id     INTEGER,
      effective_date TEXT    NOT NULL,
      description    TEXT,
      recorded_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const updateTeam = db.prepare(`
    UPDATE players
    SET mlb_team     = @mlb_team,
        mlb_team_id  = @mlb_team_id,
        updated_at   = datetime('now')
    WHERE player_id = @player_id
      AND (mlb_team IS NOT @mlb_team OR mlb_team_id IS NOT @mlb_team_id)
  `);

  const updateStatus = db.prepare(`
    UPDATE players
    SET status       = @status,
        is_available = @is_available,
        updated_at   = datetime('now')
    WHERE player_id = @player_id
      AND (status IS NOT @status OR is_available IS NOT @is_available)
  `);

  const insertTxn = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (txn_id, player_id, mlb_person_id, type_code, type_desc,
       from_team_id, to_team_id, effective_date, description)
    VALUES
      (@txn_id, @player_id, @mlb_person_id, @type_code, @type_desc,
       @from_team_id, @to_team_id, @effective_date, @description)
  `);

  let teamUpdated   = 0;
  let statusUpdated = 0;
  let txnsInserted  = 0;

  const run = db.transaction(() => {
    // Apply player-level updates
    for (const [playerId, fields] of playerUpdates.entries()) {
      if (fields.mlb_team && fields.mlb_team_id) {
        const info = updateTeam.run({
          player_id:   playerId,
          mlb_team:    fields.mlb_team,
          mlb_team_id: fields.mlb_team_id,
        });
        if (info.changes) teamUpdated++;
      }

      if (fields.status !== null && fields.status !== undefined) {
        const info = updateStatus.run({
          player_id:    playerId,
          status:       fields.status,
          is_available: isAvailableStatus(fields.status) ? 1 : 0,
        });
        if (info.changes) statusUpdated++;
      }
    }

    // Insert audit rows for every relevant raw transaction
    for (const txn of rawTxns) {
      const mlbId = Number(txn?.person?.id);
      if (!Number.isFinite(mlbId) || mlbId <= 0) continue;
      const info = insertTxn.run({
        txn_id:         txn.id,
        player_id:      `mlb-${mlbId}`,
        mlb_person_id:  mlbId,
        type_code:      txn.typeCode || '',
        type_desc:      txn.typeDesc || '',
        from_team_id:   txn.fromTeam?.id ?? null,
        to_team_id:     txn.toTeam?.id   ?? null,
        effective_date: txn.effectiveDate || txn.date || '',
        description:    txn.description  || null,
      });
      if (info.changes) txnsInserted++;
    }
  });

  run();
  return { teamUpdated, statusUpdated, txnsInserted };
}

// ── Main job ──────────────────────────────────────────────────────────────────

/**
 * @param {object}  opts
 * @param {boolean} [opts.force=false]       - skip staleness check
 * @param {number}  [opts.lookbackDays=7]    - how many days back to scan
 * @returns {Promise<{skipped?:boolean, teamUpdated:number, statusUpdated:number, txnsInserted:number, total:number, durationMs:number}>}
 */
async function ingestTransactions({ force = false, lookbackDays = DEFAULT_LOOKBACK_DAYS } = {}) {
  if (!force && !isStale(SOURCE)) {
    console.log(`[ingest] ${SOURCE} is fresh — skipping (use --force to override)`);
    return { skipped: true, teamUpdated: 0, statusUpdated: 0, txnsInserted: 0, total: 0, durationMs: 0 };
  }

  console.log(`[ingest] Starting ${SOURCE} ingestion (last ${lookbackDays} days)…`);
  const start = Date.now();

  // Build the MLB team lookup (ID → abbreviation)
  let mlbTeamMap;
  try {
    mlbTeamMap = await fetchMlbTeamMap();
    console.log(`[ingest] Loaded ${mlbTeamMap.size} MLB teams for lookup`);
  } catch (err) {
    recordSync(SOURCE, 'error', 0);
    throw new Error(`Failed to fetch MLB team list: ${err.message}`);
  }

  // Fetch the transaction window
  const now      = new Date();
  const endDate   = now.toISOString().slice(0, 10);
  const startDate = new Date(now - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  let allTxns;
  try {
    allTxns = await fetchTransactions(startDate, endDate);
    console.log(`[ingest] Fetched ${allTxns.length} transactions (${startDate} → ${endDate})`);
  } catch (err) {
    recordSync(SOURCE, 'error', 0);
    throw new Error(`Failed to fetch transactions: ${err.message}`);
  }

  // Log the type breakdown for observability
  const typeCounts = {};
  for (const t of allTxns) typeCounts[t.typeDesc] = (typeCounts[t.typeDesc] || 0) + 1;
  console.log('[ingest] Transaction types:', typeCounts);

  // Sort oldest → newest so later transactions override earlier ones for the
  // same player (e.g., DFA followed by release → final status = 'released')
  allTxns.sort((a, b) => {
    const dateA = a.effectiveDate || a.date || '';
    const dateB = b.effectiveDate || b.date || '';
    if (dateA !== dateB) return dateA < dateB ? -1 : 1;
    return (a.id || 0) - (b.id || 0);
  });

  // Classify each transaction and build per-player update map
  const playerUpdates = new Map();
  const auditTxns     = [];
  let   irrelevant    = 0;

  for (const txn of allTxns) {
    const mlbId = Number(txn?.person?.id);
    if (!Number.isFinite(mlbId) || mlbId <= 0) continue;

    const fields = classifyTransaction(txn, mlbTeamMap);

    if (!fields) {
      irrelevant++;
      continue;
    }

    const playerId = `mlb-${mlbId}`;
    const existing = playerUpdates.get(playerId) || {};

    // Merge: only overwrite with non-null values from this transaction
    playerUpdates.set(playerId, {
      mlb_team:    fields.mlb_team    ?? existing.mlb_team,
      mlb_team_id: fields.mlb_team_id ?? existing.mlb_team_id,
      status:      fields.status      ?? existing.status,
    });

    auditTxns.push(txn);
  }

  console.log(
    `[ingest] Classified: ${playerUpdates.size} players to update, ` +
    `${auditTxns.length} transactions to audit, ${irrelevant} ignored`
  );

  const { teamUpdated, statusUpdated, txnsInserted } = applyTransactionUpdates(
    playerUpdates,
    auditTxns
  );
  const durationMs = Date.now() - start;

  recordSync(SOURCE, 'success', auditTxns.length);

  console.log(
    `[ingest] ${SOURCE} complete in ${durationMs}ms — ` +
    `team changes: ${teamUpdated}, status changes: ${statusUpdated}, ` +
    `audit rows inserted: ${txnsInserted}`
  );

  return { teamUpdated, statusUpdated, txnsInserted, total: auditTxns.length, durationMs };
}

module.exports = { ingestTransactions };

// Run directly as a CLI script
if (require.main === module) {
  const force       = process.argv.includes('--force');
  const di          = process.argv.indexOf('--days');
  const lookbackDays = di !== -1 ? Number(process.argv[di + 1]) : DEFAULT_LOOKBACK_DAYS;

  ingestTransactions({ force, lookbackDays })
    .then((result) => {
      if (result.skipped) {
        console.log('Skipped — data is still fresh. Use --force to override.');
      } else {
        console.log(
          `Done. teamUpdated=${result.teamUpdated} statusUpdated=${result.statusUpdated} ` +
          `txnsInserted=${result.txnsInserted} total=${result.total} (${result.durationMs}ms)`
        );
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[ingest] Fatal error:', err.message);
      process.exit(1);
    });
}

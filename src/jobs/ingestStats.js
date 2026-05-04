/**
 * US-4.8: Season stats ingestion from the MLB Stats API.
 *
 * Fetches full-season hitting and pitching stats for a completed season and
 * stores them in the `player_stats` table. The valuation engine (Epic 5) reads
 * from this table to produce dollar-value projections.
 *
 * Source endpoint (no API key required):
 *   GET /api/v1/stats?stats=season&group={hitting|pitching}
 *                    &season={year}&sportIds=1&playerPool=All
 *                    &limit=500&offset={n}
 *
 * playerPool=All ensures we get every player with any plate appearances / outs
 * recorded, not just those who met the statistical qualification threshold.
 * The valuation engine is responsible for applying its own minimum thresholds.
 *
 * inningsPitched note: the API returns IP as a baseball-notation string where
 * the decimal represents outs, not fractional innings (e.g. "187.2" = 187⅔ IP).
 * This is converted to true decimal before storage.
 *
 * Staleness threshold: 24 hours. For a completed prior season this effectively
 * means "run once and never re-run" since the data is immutable.
 *
 * Usage as a module:
 *   const { ingestStats } = require('./src/jobs/ingestStats');
 *   await ingestStats({ force: true, season: 2025 });
 *
 * Usage as a CLI script:
 *   node src/jobs/ingestStats.js [--force] [--season 2025]
 */

require('dotenv').config();
const { getDb } = require('../db/connection');
const { isStale, recordSync } = require('../db/syncLog');

const API_BASE = 'https://statsapi.mlb.com/api/v1';
const SOURCE = 'player_stats';

const log = require('../logger').child({ component: 'ingest', source: SOURCE });
const PACING_MS = 300;
const PAGE_SIZE = 500;

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

// ── MLB Stats API call (paginated) ────────────────────────────────────────────

/**
 * Fetches all splits for a given stat group and season, paginating through all
 * results with limit=500 until totalSplits is exhausted.
 *
 * @param {'hitting'|'pitching'} group
 * @param {number} season
 * @returns {Promise<Array>} array of split objects
 */
async function fetchStatSplits(group, season) {
  const all = [];
  let offset = 0;
  let total  = null;

  do {
    const url =
      `${API_BASE}/stats` +
      `?stats=season&group=${group}&season=${season}` +
      `&sportIds=1&playerPool=All&limit=${PAGE_SIZE}&offset=${offset}`;

    const payload = await fetchJson(url);
    const bucket  = Array.isArray(payload.stats) ? payload.stats[0] : null;
    const splits  = Array.isArray(bucket?.splits) ? bucket.splits : [];

    if (total === null) {
      total = Number(bucket?.totalSplits) || splits.length;
      log.debug('paged group total', { group, total });
    }

    all.push(...splits);
    offset += splits.length;

    if (splits.length < PAGE_SIZE) break;
  } while (offset < total);

  return all;
}

// ── Parsing helpers ───────────────────────────────────────────────────────────

/**
 * Converts baseball-notation IP string to true decimal innings.
 * "187.2" (187 innings + 2 outs) → 187 + 2/3 ≈ 187.667
 * "45.1"  (45 innings + 1 out)   → 45 + 1/3  ≈ 45.333
 */
function parseIP(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  const str = String(raw);
  const dotIdx = str.indexOf('.');
  if (dotIdx === -1) return Number(str) || 0;
  const whole = Number(str.slice(0, dotIdx)) || 0;
  const outs  = Number(str.slice(dotIdx + 1)) || 0;
  return whole + outs / 3;
}

function toFloat(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Converts a quality-starts count. The MLB Stats API does not expose QS
 * directly in the standard season stats endpoint; we default to 0.
 * When available via a different hydration, this can be populated.
 */

/**
 * Builds a DB row from a single stat split entry.
 * Returns null if the player ID is missing.
 */
function splitToRow(split, season, group) {
  const mlbId = Number(split?.player?.id);
  if (!Number.isFinite(mlbId) || mlbId <= 0) return null;

  const s = split.stat || {};

  return {
    player_id:     `mlb-${mlbId}`,
    mlb_person_id: mlbId,
    season,
    stat_group:    group,
    games_played:  Number(s.gamesPlayed)   || 0,
    // hitting
    ab:            toFloat(s.atBats),
    r:             toFloat(s.runs),
    h:             toFloat(s.hits),
    doubles:       toFloat(s.doubles),
    triples:       toFloat(s.triples),
    hr:            toFloat(s.homeRuns),
    rbi:           toFloat(s.rbi),
    bb:            toFloat(s.baseOnBalls),
    k:             toFloat(s.strikeOuts),
    sb:            toFloat(s.stolenBases),
    avg:           toFloat(s.avg),
    obp:           toFloat(s.obp),
    slg:           toFloat(s.slg),
    ops:           toFloat(s.ops),
    // pitching
    w:             toFloat(s.wins),
    l:             toFloat(s.losses),
    era:           toFloat(s.era),
    whip:          toFloat(s.whip),
    k9:            toFloat(s.strikeoutsPer9Inn),
    ip:            parseIP(s.inningsPitched),
    sv:            toFloat(s.saves),
    hld:           toFloat(s.holds),
    qs:            0,   // not in standard API response
  };
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

function upsertStats(rows) {
  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO player_stats (
      player_id, mlb_person_id, season, stat_group,
      games_played, ab, r, h, doubles, triples, hr, rbi, bb, k, sb,
      avg, obp, slg, ops,
      w, l, era, whip, k9, ip, sv, hld, qs,
      updated_at
    ) VALUES (
      @player_id, @mlb_person_id, @season, @stat_group,
      @games_played, @ab, @r, @h, @doubles, @triples, @hr, @rbi, @bb, @k, @sb,
      @avg, @obp, @slg, @ops,
      @w, @l, @era, @whip, @k9, @ip, @sv, @hld, @qs,
      datetime('now')
    )
    ON CONFLICT(player_id, season, stat_group) DO UPDATE SET
      games_played = excluded.games_played,
      ab = excluded.ab, r = excluded.r, h = excluded.h,
      doubles = excluded.doubles, triples = excluded.triples,
      hr = excluded.hr, rbi = excluded.rbi, bb = excluded.bb,
      k = excluded.k, sb = excluded.sb,
      avg = excluded.avg, obp = excluded.obp, slg = excluded.slg, ops = excluded.ops,
      w = excluded.w, l = excluded.l, era = excluded.era, whip = excluded.whip,
      k9 = excluded.k9, ip = excluded.ip, sv = excluded.sv, hld = excluded.hld,
      qs = excluded.qs,
      updated_at = datetime('now')
  `);

  let inserted = 0;
  let updated  = 0;

  const run = db.transaction((statRows) => {
    for (const row of statRows) {
      const existing = db
        .prepare('SELECT id FROM player_stats WHERE player_id=? AND season=? AND stat_group=?')
        .get(row.player_id, row.season, row.stat_group);
      upsert.run(row);
      if (existing) updated++; else inserted++;
    }
  });

  run(rows);
  return { inserted, updated };
}

// ── Main job ──────────────────────────────────────────────────────────────────

/**
 * @param {object}  opts
 * @param {boolean} [opts.force=false]    - skip staleness check
 * @param {number}  [opts.season]         - season year (defaults to previous year)
 * @param {string}  [opts.group]          - 'hitting', 'pitching', or 'all' (default)
 * @returns {Promise<{skipped?:boolean, hitting:{inserted,updated}, pitching:{inserted,updated}, durationMs:number}>}
 */
async function ingestStats({ force = false, season, group = 'all' } = {}) {
  if (!force && !isStale(SOURCE)) {
    log.info('skip — fresh', { hint: 'use --force to override' });
    return { skipped: true, hitting: null, pitching: null, durationMs: 0 };
  }

  const year = season || (new Date().getFullYear() - 1);
  const groups = group === 'all' ? ['hitting', 'pitching'] : [group];

  log.info('start', { year, groups });
  const start = Date.now();

  const results = {};

  for (const g of groups) {
    log.info('fetching group stats', { group: g, year });
    let splits;
    try {
      splits = await fetchStatSplits(g, year);
      log.info('splits fetched', { group: g, count: splits.length });
    } catch (err) {
      recordSync(SOURCE, 'error', 0);
      throw new Error(`Failed to fetch ${g} stats: ${err.message}`);
    }

    const rows         = splits.map((s) => splitToRow(s, year, g)).filter(Boolean);
    const skippedCount = splits.length - rows.length;
    if (skippedCount) {
      log.warn('entries skipped', { group: g, count: skippedCount, reason: 'missing player ID' });
    }

    const { inserted, updated } = upsertStats(rows);
    results[g] = { inserted, updated, total: rows.length };
    log.info('group complete', { group: g, inserted, updated, total: rows.length });
  }

  const durationMs = Date.now() - start;
  const totalRows  = Object.values(results).reduce((s, r) => s + (r?.total ?? 0), 0);
  recordSync(SOURCE, 'success', totalRows);

  log.info('complete', { durationMs, totalRows });

  return {
    hitting:  results.hitting  || null,
    pitching: results.pitching || null,
    durationMs,
  };
}

module.exports = { ingestStats };

// Run directly as a CLI script
if (require.main === module) {
  const force  = process.argv.includes('--force');
  const si     = process.argv.indexOf('--season');
  const season = si !== -1 ? Number(process.argv[si + 1]) : undefined;
  const gi     = process.argv.indexOf('--group');
  const group  = gi !== -1 ? process.argv[gi + 1] : 'all';

  ingestStats({ force, season, group })
    .then((result) => {
      if (result.skipped) {
        console.log('Skipped — data is still fresh. Use --force to override.');
        return;
      }
      if (result.hitting)  console.log(`Hitting:  inserted=${result.hitting.inserted}  updated=${result.hitting.updated}`);
      if (result.pitching) console.log(`Pitching: inserted=${result.pitching.inserted} updated=${result.pitching.updated}`);
      console.log(`Total time: ${result.durationMs}ms`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[ingest] Fatal error:', err.message);
      process.exit(1);
    });
}

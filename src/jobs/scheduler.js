/**
 * US-4.6: Scheduled ingestion jobs.
 *
 * Runs all five ingestion jobs on configurable intervals using setInterval.
 * Jobs are called WITHOUT force=true so the staleness check inside each job
 * acts as a natural guard against redundant network calls — the job simply
 * exits early if the data is still fresh.
 *
 * The one exception is the boot-time pass: on server start we call every job
 * once with force=false so stale data from a previous deploy is refreshed
 * immediately rather than waiting for the first tick.
 *
 * Schedule (all configurable via env vars — see below):
 *
 *   player_metadata  │ every STATIC_INTERVAL_HOURS h  │ default 24 h
 *   player_stats     │ every STATIC_INTERVAL_HOURS h  │ default 24 h
 *   depth_charts     │ every SLOW_INTERVAL_HOURS h    │ default  6 h
 *   transactions     │ every SLOW_INTERVAL_HOURS h    │ default  6 h
 *   injuries         │ every INJURY_INTERVAL_MINUTES  │ default 30 min
 *                    │   only within ACTIVE_HOURS_START–ACTIVE_HOURS_END
 *
 * Environment variables:
 *   SCHEDULER_ENABLED         true|false  (default: true)
 *   STATIC_INTERVAL_HOURS     integer     (default: 24)
 *   SLOW_INTERVAL_HOURS       integer     (default: 6)
 *   INJURY_INTERVAL_MINUTES   integer     (default: 30)
 *   ACTIVE_HOURS_START        0–23        (default: 10  → 10 am local)
 *   ACTIVE_HOURS_END          0–23        (default: 23  → 11 pm local)
 */

const { ingestPlayerMetadata } = require('./ingestPlayerMetadata');
const { ingestInjuries }       = require('./ingestInjuries');
const { ingestDepthCharts }    = require('./ingestDepthCharts');
const { ingestTransactions }   = require('./ingestTransactions');
const { ingestStats }          = require('./ingestStats');

// ── Config helpers ─────────────────────────────────────────────────────────────

function envInt(name, defaultVal) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : defaultVal;
}

function getConfig() {
  return {
    enabled:               (process.env.SCHEDULER_ENABLED ?? 'true') !== 'false',
    staticIntervalHours:   envInt('STATIC_INTERVAL_HOURS',   24),
    slowIntervalHours:     envInt('SLOW_INTERVAL_HOURS',      6),
    injuryIntervalMinutes: envInt('INJURY_INTERVAL_MINUTES', 30),
    activeHoursStart:      envInt('ACTIVE_HOURS_START',      10),
    activeHoursEnd:        envInt('ACTIVE_HOURS_END',        23),
  };
}

// ── Active-hours gate ──────────────────────────────────────────────────────────

/**
 * Returns true if the current local hour is within [start, end] inclusive.
 * Handles overnight windows (e.g. start=22 end=2) via wraparound.
 */
function isWithinActiveHours(start, end) {
  const hour = new Date().getHours();
  if (start <= end) return hour >= start && hour <= end;
  return hour >= start || hour <= end;   // overnight window
}

// ── Job runner ─────────────────────────────────────────────────────────────────

/**
 * Wraps a single ingestion function call in try/catch so that errors are
 * logged but never propagate to crash the process.
 *
 * @param {string}   name      - display name for logs
 * @param {Function} fn        - async ingestion function
 * @param {object}   [opts]    - options passed to the ingestion job
 */
async function safeRun(name, fn, opts = {}) {
  try {
    const result = await fn(opts);
    if (result?.skipped) {
      console.log(`[scheduler] ${name} — skipped (still fresh)`);
    } else {
      const extra = result
        ? Object.entries(result)
            .filter(([k]) => !['skipped', 'durationMs'].includes(k))
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')
        : '';
      console.log(`[scheduler] ${name} — done in ${result?.durationMs ?? '?'}ms${extra ? ' ' + extra : ''}`);
    }
  } catch (err) {
    console.error(`[scheduler] ${name} — ERROR: ${err.message}`);
  }
}

// ── Ticker factory ─────────────────────────────────────────────────────────────

// Node.js / V8 wraps setInterval delays that exceed 2^31-1 ms (~24.8 days)
// and fires them immediately. Cap to 24 hours (86 400 000 ms) as a safety
// guard — no scheduled job should ever run less frequently than once a day.
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Creates a setInterval tick that runs `fn` every `intervalMs` milliseconds.
 * If `gateCheck` is provided, the tick is a no-op when gateCheck() returns
 * false (used for the active-hours window on the injuries job).
 *
 * Returns the interval handle so callers can clear it if needed.
 */
function createTicker(name, fn, intervalMs, gateCheck = null) {
  const safeMs = Math.min(intervalMs, MAX_INTERVAL_MS);
  if (safeMs !== intervalMs) {
    console.warn(`[scheduler] ${name}: interval clamped to ${safeMs / 3600000}h (was ${intervalMs / 3600000}h)`);
  }
  return setInterval(async () => {
    if (gateCheck && !gateCheck()) {
      console.log(`[scheduler] ${name} — outside active hours, skipping tick`);
      return;
    }
    await safeRun(name, fn);
  }, safeMs);
}

// ── Public API ─────────────────────────────────────────────────────────────────

let _handles = [];

/**
 * Starts all scheduled ingestion jobs.
 *
 * Safe to call multiple times — subsequent calls are no-ops if the scheduler
 * is already running. Returns the number of active intervals.
 */
async function startScheduler() {
  if (_handles.length > 0) {
    console.log('[scheduler] Already running — ignoring duplicate startScheduler() call');
    return _handles.length;
  }

  const cfg = getConfig();

  if (!cfg.enabled) {
    console.log('[scheduler] Disabled via SCHEDULER_ENABLED=false');
    return 0;
  }

  console.log('[scheduler] Starting with config:', {
    staticIntervalHours:   cfg.staticIntervalHours,
    slowIntervalHours:     cfg.slowIntervalHours,
    injuryIntervalMinutes: cfg.injuryIntervalMinutes,
    activeHours:           `${cfg.activeHoursStart}:00–${cfg.activeHoursEnd}:59`,
  });

  const staticMs = cfg.staticIntervalHours   * 60 * 60 * 1000;
  const slowMs   = cfg.slowIntervalHours     * 60 * 60 * 1000;
  const injuryMs = cfg.injuryIntervalMinutes * 60 * 1000;

  // ── Boot-time pass: refresh anything stale from the last deploy ─────────────
  // Run without force=true so the staleness check in each job determines
  // whether a network call is actually needed.
  console.log('[scheduler] Running boot-time staleness check for all sources…');
  await safeRun('player_metadata [boot]', ingestPlayerMetadata);
  await safeRun('injuries [boot]',        ingestInjuries);
  await safeRun('depth_charts [boot]',    ingestDepthCharts);
  await safeRun('transactions [boot]',    ingestTransactions);
  await safeRun('player_stats [boot]',    ingestStats);
  console.log('[scheduler] Boot-time pass complete');

  // ── Recurring intervals ─────────────────────────────────────────────────────
  _handles.push(createTicker('player_metadata', ingestPlayerMetadata, staticMs));
  _handles.push(createTicker('player_stats',    ingestStats,          staticMs));
  _handles.push(createTicker('depth_charts',    ingestDepthCharts,    slowMs));
  _handles.push(createTicker('transactions',    ingestTransactions,   slowMs));
  _handles.push(
    createTicker(
      'injuries',
      ingestInjuries,
      injuryMs,
      () => isWithinActiveHours(cfg.activeHoursStart, cfg.activeHoursEnd),
    ),
  );

  console.log(
    `[scheduler] ${_handles.length} jobs scheduled — ` +
    `metadata/stats every ${cfg.staticIntervalHours}h, ` +
    `depth_charts/transactions every ${cfg.slowIntervalHours}h, ` +
    `injuries every ${cfg.injuryIntervalMinutes}min ` +
    `(active ${cfg.activeHoursStart}:00–${cfg.activeHoursEnd}:59 local)`
  );

  return _handles.length;
}

/**
 * Stops all running intervals. Primarily useful in tests.
 */
function stopScheduler() {
  for (const h of _handles) clearInterval(h);
  _handles = [];
  console.log('[scheduler] Stopped');
}

module.exports = { startScheduler, stopScheduler };

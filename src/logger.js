/**
 * Tiny zero-dep structured logger (US-8.2).
 *
 * Emits one JSON line per call with `time`, `level`, `msg`, plus any caller
 * context. In dev, set `LOG_PRETTY=true` for a single-line human-readable
 * format — JSON stays the default so production aggregators ingest cleanly.
 *
 * `LOG_LEVEL` (default `info`) controls verbosity. Levels in order:
 * debug < info < warn < error.
 *
 * Usage:
 *   const log = require('./logger');
 *   log.info('listening', { port: 4001 });
 *   const ingestLog = log.child({ source: 'player_metadata' });
 *   ingestLog.info('done', { recordCount: 1694, durationMs: 2103 });
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVEL_LABEL = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' };

function activeLevel() {
  const raw = String(process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

function pretty(level, msg, ctx) {
  const time = new Date().toISOString();
  const label = LEVEL_LABEL[level] || level.toUpperCase();
  const tail = Object.keys(ctx).length ? ' ' + JSON.stringify(ctx) : '';
  return `${time} ${label} ${msg}${tail}`;
}

function emit(level, msg, ctx = {}, bound = {}) {
  if (LEVELS[level] < activeLevel()) return;

  const entry = {
    time: new Date().toISOString(),
    level,
    msg: String(msg),
    ...bound,
    ...ctx,
  };

  const line = process.env.LOG_PRETTY === 'true' ? pretty(level, msg, { ...bound, ...ctx }) : JSON.stringify(entry);
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(line + '\n');
}

function makeLogger(bound = {}) {
  return {
    debug: (msg, ctx) => emit('debug', msg, ctx, bound),
    info:  (msg, ctx) => emit('info',  msg, ctx, bound),
    warn:  (msg, ctx) => emit('warn',  msg, ctx, bound),
    error: (msg, ctx) => emit('error', msg, ctx, bound),
    child: (extra) => makeLogger({ ...bound, ...extra }),
  };
}

module.exports = makeLogger();

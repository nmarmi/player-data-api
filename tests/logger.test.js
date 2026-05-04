'use strict';

/**
 * US-8.2: structured logger contract test.
 *
 * Each log entry must be valid JSON with at least `time` (ISO 8601), `level`
 * (debug|info|warn|error), and `msg`. Additional context fields merge in.
 * `LOG_LEVEL` filters lower-priority entries. Child loggers bind context.
 */

function captureStdout(fn) {
  const original = process.stdout.write.bind(process.stdout);
  const lines = [];
  process.stdout.write = (chunk, ...rest) => {
    lines.push(String(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return lines.join('').split('\n').filter(Boolean);
}

function captureStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  const lines = [];
  process.stderr.write = (chunk, ...rest) => {
    lines.push(String(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return lines.join('').split('\n').filter(Boolean);
}

function freshLogger(env = {}) {
  // Reload the logger so env-var changes take effect for this test.
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  jest.resetModules();
  return require('../src/logger');
}

describe('logger (US-8.2)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('emits one JSON line per call with time, level, msg, and context', () => {
    const log = freshLogger({ LOG_LEVEL: 'info', LOG_PRETTY: 'false' });
    const lines = captureStdout(() => log.info('hello', { count: 7 }));

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.msg).toBe('hello');
    expect(entry.level).toBe('info');
    expect(entry.count).toBe(7);
    expect(entry.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('errors go to stderr', () => {
    const log = freshLogger({ LOG_LEVEL: 'info', LOG_PRETTY: 'false' });
    const stdout = captureStdout(() => {
      const stderr = captureStderr(() => log.error('boom', { code: 'X' }));
      expect(stderr).toHaveLength(1);
      const entry = JSON.parse(stderr[0]);
      expect(entry.level).toBe('error');
      expect(entry.code).toBe('X');
    });
    expect(stdout).toHaveLength(0);
  });

  test('LOG_LEVEL filters lower-priority entries', () => {
    const log = freshLogger({ LOG_LEVEL: 'warn', LOG_PRETTY: 'false' });
    const lines = captureStdout(() => {
      log.debug('verbose');
      log.info('chatter');
      log.warn('heads up');
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).msg).toBe('heads up');
  });

  test('child logger merges bound context into every entry', () => {
    const log = freshLogger({ LOG_LEVEL: 'info', LOG_PRETTY: 'false' });
    const ingest = log.child({ component: 'ingest', source: 'player_metadata' });
    const lines = captureStdout(() => ingest.info('done', { recordCount: 1694, durationMs: 2103 }));

    const entry = JSON.parse(lines[0]);
    // US-8.2: ingestion jobs log source, records processed, duration, errors.
    expect(entry.component).toBe('ingest');
    expect(entry.source).toBe('player_metadata');
    expect(entry.recordCount).toBe(1694);
    expect(entry.durationMs).toBe(2103);
  });

  test('LOG_PRETTY=true produces single-line human-readable output', () => {
    const log = freshLogger({ LOG_LEVEL: 'info', LOG_PRETTY: 'true' });
    const lines = captureStdout(() => log.info('hello', { x: 1 }));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s+INFO\s+hello\s+\{"x":1\}$/);
  });
});

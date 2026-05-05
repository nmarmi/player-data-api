const app = require('./app');
const { getDb, DB_PATH } = require('./db/connection');
const { migrate } = require('./db/migrate');
const { seedIfEmpty } = require('./db/seed');
const { seedAdmin } = require('./db/seedAdmin');
const { startScheduler, getConfig: getSchedulerConfig } = require('./jobs/scheduler');
const log = require('./logger');

const PORT = Number(process.env.PORT) || 4001;

// US-8.1: Log active configuration on startup (without secrets).
function logActiveConfig() {
  const validApiKeys = process.env.API_LICENSE_KEY
    ? 1
    : (process.env.VALID_API_KEYS ? process.env.VALID_API_KEYS.split(',').filter(Boolean).length : 0);
  const sched = getSchedulerConfig();

  log.info('active config', {
    port: PORT,
    nodeEnv: process.env.NODE_ENV || 'development',
    allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
    dbPath: DB_PATH,
    auth: {
      apiKeysConfigured: validApiKeys,
      adminKeyConfigured: Boolean(process.env.ADMIN_API_KEY),
    },
    legacyApi: {
      sunset: process.env.LEGACY_API_SUNSET || 'Wed, 31 Dec 2026 23:59:59 GMT',
      migrationLink: process.env.LEGACY_API_MIGRATION_LINK || '</docs/migration-v1.md>; rel="deprecation"',
    },
    scheduler: {
      enabled: sched.enabled,
      staticIntervalHours: sched.staticIntervalHours,
      slowIntervalHours: sched.slowIntervalHours,
      injuryIntervalMinutes: sched.injuryIntervalMinutes,
      activeHours: `${sched.activeHoursStart}:00–${sched.activeHoursEnd}:59`,
    },
    log: {
      level: process.env.LOG_LEVEL || 'info',
      pretty: process.env.LOG_PRETTY === 'true',
    },
  });
}

// Initialise database before accepting requests
let dbReady = false;
try {
  getDb();
  log.info('db connected', { dbPath: DB_PATH });
  migrate();
  seedIfEmpty();
  seedAdmin();
  dbReady = true;
} catch (err) {
  log.error('db init failed', { error: err.message });
  log.warn('db fallback', { mode: 'in-memory JSON seed data' });
}

app.listen(PORT, () => {
  log.info('server listening', { port: PORT, url: `http://localhost:${PORT}` });
  logActiveConfig();

  if (!process.env.API_LICENSE_KEY && !process.env.VALID_API_KEYS) {
    log.warn('no api keys configured', { effect: 'all licensed endpoints will return 401' });
  }

  if (dbReady) {
    startScheduler().catch((err) => {
      log.error('scheduler failed to start', { error: err.message });
    });
  } else {
    log.warn('scheduler skipped', { reason: 'db not available' });
  }
});

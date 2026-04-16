const app = require('./app');
const { getDb, DB_PATH } = require('./db/connection');
const { migrate } = require('./db/migrate');
const { seedIfEmpty } = require('./db/seed');
const { startScheduler } = require('./jobs/scheduler');

const PORT = process.env.PORT || 4001;

// Initialise database before accepting requests
let dbReady = false;
try {
  getDb();
  console.log(`[db] Connected to SQLite database at ${DB_PATH}`);
  migrate();
  seedIfEmpty();
  dbReady = true;
} catch (err) {
  console.error('[db] Failed to initialise database:', err.message);
  console.warn('[db] Falling back to in-memory JSON seed data');
}

app.listen(PORT, () => {
  console.log(`Player Data API listening on http://localhost:${PORT}`);
  if (!process.env.API_LICENSE_KEY && !process.env.VALID_API_KEYS) {
    console.warn('Warning: No API_LICENSE_KEY or VALID_API_KEYS set. License checks will fail.');
  }

  // Start scheduled ingestion only when the DB is ready
  if (dbReady) {
    startScheduler().catch((err) => {
      console.error('[scheduler] Failed to start:', err.message);
    });
  } else {
    console.warn('[scheduler] Skipping scheduler — DB not available');
  }
});

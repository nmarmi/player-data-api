/**
 * US-13.1 / US-13.2: Events table helpers.
 *
 * Event types:  'player.injury' | 'player.transaction' | 'player.depthChart'
 *
 * Backfill safeguard: `writeEvent` checks the table's MAX(created_at) before
 * the very first call per process. If the table is empty or the newest stored
 * event was created more than 24 h ago (i.e. this is first deploy or a restart
 * after a long gap), all subsequent writes that belong to the current ingestion
 * batch are silently dropped — they would be replayed as notifications to
 * connected Draft Kits but they represent stale state, not fresh news.
 *
 * After the initial run the guard resets and new events are written normally.
 */

const { getDb } = require('./connection');

// ── Backfill guard ────────────────────────────────────────────────────────────
let _initialSuppressUntil = null; // null = not yet checked, Date = suppress before this time

function checkBackfillWindow() {
  if (_initialSuppressUntil !== null) return;

  try {
    const db  = getDb();
    const row = db.prepare(`SELECT MAX(created_at) AS newest FROM events`).get();
    const newest = row?.newest ? new Date(row.newest + 'Z') : null;
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 h ago

    if (!newest || newest < cutoff) {
      // Table is empty or last event is stale — suppress writes for this batch
      _initialSuppressUntil = new Date(Date.now() + 60 * 1000); // suppress for 60 s
    } else {
      _initialSuppressUntil = new Date(0); // no suppression needed
    }
  } catch (_) {
    _initialSuppressUntil = new Date(0);
  }
}

/**
 * Write a new event row.
 * Returns the new row id, or null if suppressed by the backfill guard or if the DB is unavailable.
 *
 * @param {string}  type      — 'player.injury' | 'player.transaction' | 'player.depthChart'
 * @param {string}  playerId  — e.g. 'mlb-660271'
 * @param {object}  payload   — { newValue, priorValue, dataAsOf, … }
 * @returns {number|null}
 */
function writeEvent(type, playerId, payload) {
  try {
    checkBackfillWindow();

    // Suppress events during the initial backfill window
    if (_initialSuppressUntil && new Date() < _initialSuppressUntil) return null;

    const db   = getDb();
    const info = db.prepare(`
      INSERT INTO events (type, player_id, payload) VALUES (?, ?, ?)
    `).run(type, playerId, JSON.stringify(payload));
    return info.lastInsertRowid;
  } catch (_) {
    return null;
  }
}

/**
 * Fetch pending (undispatched) events optionally filtered by playerIds.
 * Supports resumption via `sinceId` (last event id the client received).
 *
 * @param {string[]} [playerIds]  — optional filter
 * @param {number}   [sinceId=0] — return events with id > sinceId
 * @param {number}   [limit=100]
 * @returns {Array<object>}
 */
function getPendingEvents(playerIds = [], sinceId = 0, limit = 100) {
  try {
    const db = getDb();
    if (playerIds.length) {
      const placeholders = playerIds.map(() => '?').join(',');
      return db.prepare(`
        SELECT * FROM events
        WHERE id > ? AND player_id IN (${placeholders})
        ORDER BY id ASC LIMIT ?
      `).all(sinceId, ...playerIds, limit);
    }
    return db.prepare(`
      SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT ?
    `).all(sinceId, limit);
  } catch (_) {
    return [];
  }
}

/** Mark events as dispatched (SSE or webhook). */
function markDispatched(ids) {
  if (!ids.length) return;
  try {
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`
      UPDATE events SET dispatched_at = datetime('now')
      WHERE id IN (${placeholders})
    `).run(...ids);
  } catch (_) {}
}

/**
 * Write a synthetic event for admin demos / force-trigger (US-13.3).
 * Bypasses the backfill guard since this is an intentional injection.
 */
function writeAdminEvent(type, playerId, payload) {
  try {
    const db   = getDb();
    const info = db.prepare(`
      INSERT INTO events (type, player_id, payload) VALUES (?, ?, ?)
    `).run(type, playerId, JSON.stringify({ ...payload, synthetic: true }));
    return info.lastInsertRowid;
  } catch (_) {
    return null;
  }
}

/** Reset the backfill guard (used in tests). */
function _resetBackfillGuard() { _initialSuppressUntil = null; }

module.exports = { writeEvent, getPendingEvents, markDispatched, writeAdminEvent, _resetBackfillGuard };

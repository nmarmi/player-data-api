/**
 * US-13.2: Server-Sent Events delivery + optional webhook dispatch.
 * US-13.3: Admin force-trigger for synthetic events.
 */
const crypto = require('crypto');
const { getPendingEvents, markDispatched, writeAdminEvent } = require('../db/eventsLog');
const { findKeyByRaw } = require('../db/developerAccounts');
const { getKeyFromRequest } = require('../middleware/license');
const log = require('../logger').child({ component: 'events' });

const HEARTBEAT_MS     = 25_000;  // keep proxies alive
const POLL_INTERVAL_MS = 3_000;   // how often to check for new events

// ── SSE stream ────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/events/stream
 *
 * Query params:
 *   playerIds  — comma-separated mlb-xxx ids to filter on (optional)
 *   since      — resume from last seen event id (optional, default 0)
 */
function streamEvents(req, res) {
  const playerIds = (req.query.playerIds || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const sinceId = Math.max(0, Number(req.query.since) || 0);

  // SSE headers — no buffering, keep-alive
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // disable nginx buffering
  res.flushHeaders();

  let lastId = sinceId;

  function send(eventType, data) {
    try {
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(data)}\n`);
      res.write(`id: ${data.id}\n\n`);
    } catch (_) {}
  }

  function sendHeartbeat() {
    try { res.write(': heartbeat\n\n'); } catch (_) {}
  }

  function poll() {
    const rows = getPendingEvents(playerIds, lastId);
    if (rows.length) {
      const dispatchedIds = [];
      for (const row of rows) {
        let payload;
        try { payload = JSON.parse(row.payload); } catch (_) { payload = {}; }
        send(row.type, { id: row.id, playerId: row.player_id, createdAt: row.created_at, ...payload });
        lastId = row.id;
        dispatchedIds.push(row.id);
      }
      markDispatched(dispatchedIds);

      // Also fire webhooks for accounts with a registered URL
      dispatchWebhooks(rows).catch(() => {});
    }
  }

  // Immediate flush of any buffered events since `sinceId`
  poll();

  const pollTimer      = setInterval(poll,          POLL_INTERVAL_MS);
  const heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    log.info('SSE client disconnected', { playerIds: playerIds.length, lastId });
  });
}

// ── Webhook dispatch ──────────────────────────────────────────────────────────

/**
 * For developer accounts with a registered webhook_url, POST each event with
 * an HMAC-SHA256 signature so receivers can verify authenticity.
 * Best-effort — failures are logged but never block the SSE stream.
 */
async function dispatchWebhooks(rows) {
  if (!rows.length) return;

  const db = (() => { try { return require('../db/connection').getDb(); } catch (_) { return null; } })();
  if (!db) return;

  let webhooks;
  try {
    webhooks = db.prepare(`
      SELECT k.id, k.webhook_url, k.account_id
      FROM   api_keys k
      WHERE  k.webhook_url IS NOT NULL AND k.revoked_at IS NULL
    `).all();
  } catch (_) { return; }

  if (!webhooks.length) return;

  for (const row of rows) {
    let payload;
    try { payload = JSON.parse(row.payload); } catch (_) { payload = {}; }
    const body = JSON.stringify({
      id: row.id, type: row.type, playerId: row.player_id,
      createdAt: row.created_at, ...payload,
    });

    for (const hook of webhooks) {
      const secret = process.env.SESSION_SECRET || 'webhook-secret';
      const sig    = crypto.createHmac('sha256', secret).update(body).digest('hex');
      try {
        await fetch(hook.webhook_url, {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-DraftIQ-Signature': `sha256=${sig}`,
          },
          body,
          signal: AbortSignal.timeout(5000),
        });
        log.info('webhook dispatched', { hookId: hook.id, eventId: row.id, type: row.type });
      } catch (err) {
        log.warn('webhook dispatch failed', { hookId: hook.id, eventId: row.id, error: err.message });
      }
    }
  }
}

// ── Admin webhook registration ─────────────────────────────────────────────────

function registerWebhook(req, res) {
  const { webhookUrl } = req.body || {};
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    return res.status(400).json({ success: false, error: 'webhookUrl required', code: 'INVALID_INPUT' });
  }

  const key = getKeyFromRequest(req);
  if (!key) return res.status(401).json({ success: false, error: 'API key required', code: 'UNAUTHORIZED' });

  const found = findKeyByRaw(key);
  if (found.status !== 'valid') {
    return res.status(401).json({ success: false, error: 'Invalid API key', code: 'UNAUTHORIZED' });
  }

  try {
    const db = require('../db/connection').getDb();
    db.prepare(`UPDATE api_keys SET webhook_url = ? WHERE id = ?`).run(webhookUrl, found.keyRow.id);
    log.info('webhook registered', { keyId: found.keyRow.id, webhookUrl });
    return res.json({ success: true, webhookUrl });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to register webhook', code: 'INTERNAL_ERROR' });
  }
}

// ── Admin force-trigger (US-13.3) ─────────────────────────────────────────────

function forceEvent(req, res) {
  const { type, playerId, payload } = req.body || {};

  const VALID_TYPES = ['player.injury', 'player.transaction', 'player.depthChart'];
  if (!type || !VALID_TYPES.includes(type)) {
    return res.status(400).json({
      success: false,
      error: `type must be one of: ${VALID_TYPES.join(', ')}`,
      code: 'INVALID_INPUT',
    });
  }
  if (!playerId) {
    return res.status(400).json({ success: false, error: 'playerId required', code: 'INVALID_INPUT' });
  }

  const id = writeAdminEvent(type, playerId, payload || {});
  if (!id) {
    return res.status(503).json({ success: false, error: 'Could not write event — DB unavailable', code: 'SERVICE_UNAVAILABLE' });
  }

  log.info('admin event injected', { id, type, playerId });
  return res.status(201).json({ success: true, id, type, playerId, synthetic: true });
}

module.exports = { streamEvents, registerWebhook, forceEvent };

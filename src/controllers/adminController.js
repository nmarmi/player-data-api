/**
 * US-4.5: Manual refresh trigger endpoint.
 *
 * POST /admin/refresh
 *   Body (optional): { "source": "player_metadata" }
 *   Body (optional): { "source": ["injuries", "transactions"] }
 *
 * Omitting `source` runs ALL ingestion jobs in sequence.
 * Always runs with force=true so the staleness check is bypassed.
 *
 * Response shape:
 *   { success: true, sources: [{ source, recordsUpdated, durationMs }] }
 *
 * Protected by requireAdmin middleware (see routes/admin.js).
 */

const { ingestPlayerMetadata } = require('../jobs/ingestPlayerMetadata');
const { ingestInjuries }       = require('../jobs/ingestInjuries');
const { ingestDepthCharts }    = require('../jobs/ingestDepthCharts');
const { ingestTransactions }   = require('../jobs/ingestTransactions');
const { ingestStats }          = require('../jobs/ingestStats');
const log = require('../logger').child({ component: 'admin' });

// Map each source name to its job function and the result field that
// represents "records processed" (each job returns slightly different keys).
const JOB_MAP = {
  player_metadata: {
    fn: ingestPlayerMetadata,
    recordsKey: 'total',
  },
  injuries: {
    fn: ingestInjuries,
    recordsKey: 'total',
  },
  depth_charts: {
    fn: ingestDepthCharts,
    recordsKey: 'total',
  },
  transactions: {
    fn: (opts) => ingestTransactions(opts),
    recordsKey: 'total',
  },
  player_stats: {
    fn: ingestStats,
    recordsKey: 'total',
  },
};

const ALL_SOURCES = Object.keys(JOB_MAP);

/**
 * Runs a single ingestion job and returns a normalised result object.
 * Never throws — errors are captured and returned in the result.
 */
async function runJob(source) {
  const { fn, recordsKey } = JOB_MAP[source];
  const t0 = Date.now();
  try {
    const result = await fn({ force: true });
    return {
      source,
      success:        true,
      recordsUpdated: result[recordsKey] ?? 0,
      durationMs:     Date.now() - t0,
    };
  } catch (err) {
    log.error('refresh job failed', { source, error: err.message, stack: err.stack });
    return {
      source,
      success:        false,
      error:          err.message,
      recordsUpdated: 0,
      durationMs:     Date.now() - t0,
    };
  }
}

/**
 * POST /admin/refresh
 */
async function triggerRefresh(req, res) {
  // Resolve which sources to run
  const rawSource = req.body?.source;
  let sources;

  if (!rawSource) {
    sources = ALL_SOURCES;
  } else if (Array.isArray(rawSource)) {
    sources = rawSource;
  } else {
    sources = [rawSource];
  }

  // Validate every requested source name
  const unknown = sources.filter((s) => !JOB_MAP[s]);
  if (unknown.length) {
    return res.status(400).json({
      success: false,
      error:   `Unknown source(s): ${unknown.join(', ')}. Valid sources: ${ALL_SOURCES.join(', ')}`,
      code:    'INVALID_SOURCE',
    });
  }

  log.info('refresh started', { sources, count: sources.length });

  // Run jobs sequentially to avoid hammering the MLB Stats API
  const results = [];
  for (const source of sources) {
    log.info('refresh job starting', { source });
    const result = await runJob(source);
    results.push(result);
    log.info('refresh job complete', {
      source,
      success: result.success,
      recordsUpdated: result.recordsUpdated,
      durationMs: result.durationMs,
    });
  }

  const anyFailed = results.some((r) => !r.success);
  return res.status(anyFailed ? 207 : 200).json({
    success: !anyFailed,
    sources: results,
  });
}

module.exports = { triggerRefresh };

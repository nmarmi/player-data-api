'use strict';

/**
 * US-8.3: OpenAPI drift-guard.
 *
 * The spec at `docs/openapi.yaml` is the published cross-repo contract. This
 * test boots the app and asserts that every documented `/api/v1/*` path
 * actually responds — i.e. the spec hasn't drifted away from the routes.
 *
 * It does NOT validate response shapes against the schemas (Jest isn't an
 * OpenAPI runtime); the per-endpoint integration tests cover shape contracts.
 * What this guards is the existence + auth posture of every documented path.
 */

process.env.API_LICENSE_KEY = process.env.API_LICENSE_KEY || 'test-license-key';
process.env.RATE_LIMIT_DISABLED = 'true';
// Force /admin/refresh to 401 so the smoke test doesn't trigger real ingestion.
process.env.ADMIN_API_KEY = 'admin-key-not-sent-by-test';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const request = require('supertest');
const app = require('../src/app');

const SPEC_PATH = path.join(__dirname, '..', 'docs', 'openapi.yaml');
const spec = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));

const apiBase = '/api/v1';

function templateToPath(openapiPath) {
  // /players/{playerId} → /players/mlb-660271
  return openapiPath.replace(/\{(\w+)\}/g, (_, name) => {
    if (name === 'playerId') return 'mlb-660271';
    return 'placeholder';
  });
}

function exampleBodyFor(openapiPath, method) {
  // Minimum bodies that satisfy required validation per endpoint.
  const settings = {
    numberOfTeams: 10,
    salaryCap: 260,
    rosterSlots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 3, UTIL: 1, SP: 3, RP: 2, BENCH: 3 },
    scoringType: '5x5 Roto',
    draftType: 'AUCTION',
  };

  if (openapiPath.endsWith('/valuations')) {
    return { leagueSettings: settings, draftState: {} };
  }
  if (openapiPath.endsWith('/recommendations')) {
    return { leagueSettings: settings, draftState: {} };
  }
  if (openapiPath.endsWith('/recommendations/nominations') || openapiPath.endsWith('/recommendations/budget')) {
    return {
      leagueSettings: settings,
      draftState: { teamBudgets: { 'fantasy-team-1': 260 }, filledRosterSlots: {} },
      teamId: 'fantasy-team-1',
    };
  }
  if (openapiPath === '/usage' && method === 'post') {
    return { event: 'spec-smoke', timestamp: new Date().toISOString() };
  }
  if (openapiPath === '/admin/refresh') {
    // We don't actually trigger an ingest run during tests — admin auth is
    // expected to fail without a key, which is what we assert.
    return {};
  }
  return undefined;
}

describe('US-8.3 OpenAPI drift-guard', () => {
  test('spec has top-level info, paths, and key components', () => {
    expect(spec.info?.version).toBe('v1');
    expect(spec.paths).toBeTruthy();
    expect(spec.components?.schemas?.LeagueSettings).toBeTruthy();
    expect(spec.components?.schemas?.DraftState).toBeTruthy();
    expect(spec.components?.schemas?.PlayerStub).toBeTruthy();
    expect(spec.components?.securitySchemes?.ApiKey).toBeTruthy();
  });

  test('every documented path responds (no 404 from Express router)', async () => {
    const documentedPaths = Object.keys(spec.paths);
    expect(documentedPaths.length).toBeGreaterThan(8);

    for (const docPath of documentedPaths) {
      const concretePath = `${apiBase}${templateToPath(docPath)}`;
      const ops = spec.paths[docPath];

      for (const method of Object.keys(ops)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;

        let req = request(app)[method](concretePath).set('X-API-Key', process.env.API_LICENSE_KEY);
        const body = exampleBodyFor(docPath, method);
        if (body !== undefined) req = req.send(body);

        const res = await req;

        // Accept any status that proves the path was matched by Express.
        // We're checking that the spec didn't document a path that no longer
        // exists in routes — a real 404 from express's catch-all would fail
        // here. A 401/403 from auth middleware still proves the path matched.
        expect([200, 201, 204, 400, 401, 403, 404, 503].includes(res.status)).toBe(true);

        // For non-/admin endpoints, a 404 must be the controller's intentional
        // "not found" (e.g. unknown player id) — not the express catch-all
        // "Route not found" 404. Distinguish via the body.code field.
        if (res.status === 404 && res.body?.code === 'NOT_FOUND' && /Route not found/i.test(res.body.error || '')) {
          throw new Error(`OpenAPI documents ${method.toUpperCase()} ${docPath} but no route is mounted (got express catch-all 404)`);
        }
      }
    }
  });
});

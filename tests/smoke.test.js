'use strict';

/**
 * US-7.1 — smoke tests
 *
 * These tests verify that the core modules can be required without throwing
 * and that the test runner itself is wired up correctly.
 */

describe('Smoke tests', () => {
  test('Jest is configured and running', () => {
    expect(true).toBe(true);
  });

  test('playersService can be required', () => {
    const svc = require('../src/services/playersService');
    expect(typeof svc.buildPlayersQuery).toBe('function');
    expect(typeof svc.applyPlayersQuery).toBe('function');
    expect(typeof svc.loadPlayers).toBe('function');
  });

  test('valuationEngine can be required', () => {
    const eng = require('../src/services/valuationEngine');
    expect(typeof eng.runValuations).toBe('function');
    expect(typeof eng.mergeSettings).toBe('function');
    expect(typeof eng.normalizeLeagueSettings).toBe('function');
  });

  test('express app can be required', () => {
    const app = require('../src/app');
    expect(app).toBeDefined();
  });
});

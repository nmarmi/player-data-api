#!/usr/bin/env node
/**
 * Pull MLB data from balldontlie and write data/players.json
 * in PlayerStub-compatible format.
 *
 * Usage:
 *   BALLDONTLIE_API_KEY=... node scripts/fetch-mlb-data.js
 *   node scripts/fetch-mlb-data.js --season=2026 --out=data/players.json --per-page=100
 */
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.balldontlie.io/mlb/v1';
const DEFAULT_OUT = path.join(__dirname, '..', 'data', 'players.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    season: new Date().getFullYear(),
    out: DEFAULT_OUT,
    perPage: 100,
    maxPlayers: 350,
  };

  for (const raw of argv.slice(2)) {
    if (raw.startsWith('--season=')) {
      const season = Number(raw.slice('--season='.length));
      if (Number.isFinite(season)) args.season = season;
    } else if (raw.startsWith('--out=')) {
      args.out = path.resolve(process.cwd(), raw.slice('--out='.length));
    } else if (raw.startsWith('--per-page=')) {
      const perPage = Number(raw.slice('--per-page='.length));
      if (Number.isFinite(perPage) && perPage > 0) args.perPage = Math.min(100, Math.floor(perPage));
    } else if (raw.startsWith('--max-players=')) {
      const maxPlayers = Number(raw.slice('--max-players='.length));
      if (Number.isFinite(maxPlayers) && maxPlayers > 0) args.maxPlayers = Math.floor(maxPlayers);
    }
  }

  return args;
}

function normalizePositionText(positionText) {
  const raw = String(positionText || '').trim();
  if (!raw) return ['U'];

  // Handle direct tokens and slash/comma lists first.
  const direct = raw
    .split(/[\/,]/)
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean)
    .map((token) => {
      if (token === 'RP' || token === 'SP') return 'P';
      return token;
    })
    .filter((token) => ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'P', 'U'].includes(token));

  if (direct.length) return [...new Set(direct)];

  const upper = raw.toUpperCase();
  if (upper.includes('PITCHER')) return ['P'];
  if (upper.includes('CATCHER')) return ['C'];
  if (upper.includes('FIRST BASE')) return ['1B'];
  if (upper.includes('SECOND BASE')) return ['2B'];
  if (upper.includes('THIRD BASE')) return ['3B'];
  if (upper.includes('SHORTSTOP')) return ['SS'];
  if (upper.includes('OUTFIELD')) return ['OF'];
  if (upper.includes('DESIGNATED HITTER')) return ['DH'];
  return ['U'];
}

function normalizeStatus(injury) {
  if (!injury) return 'active';
  const text = String(injury.status || injury.injury_status || '').trim().toLowerCase();
  if (!text) return 'injured';
  if (text.includes('out') || text.includes('injur') || text.includes('il')) return 'injured';
  if (text.includes('day-to-day') || text.includes('dtd')) return 'day-to-day';
  return text;
}

async function fetchJson(url, apiKey, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      Authorization: apiKey,
      Accept: 'application/json',
      'User-Agent': 'player-data-api-importer/1.0',
    },
  });

  if (response.status === 429) {
    if (attempt > 8) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP 429 for ${url} ${text.slice(0, 140)}`);
    }
    const resetAt = Number(response.headers.get('x-ratelimit-reset'));
    let waitMs = 15000;
    if (Number.isFinite(resetAt) && resetAt > 0) {
      waitMs = Math.max(1000, resetAt * 1000 - Date.now() + 1000);
    }
    console.warn(`Rate limited (429). Waiting ${Math.ceil(waitMs / 1000)}s before retry ${attempt}/8...`);
    await sleep(waitMs);
    return fetchJson(url, apiKey, attempt + 1);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} for ${url} ${text.slice(0, 140)}`);
  }
  const remaining = Number(response.headers.get('x-ratelimit-remaining'));
  const resetAt = Number(response.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(remaining) && remaining <= 0 && Number.isFinite(resetAt) && resetAt > 0) {
    const waitMs = Math.max(1000, resetAt * 1000 - Date.now() + 1000);
    console.warn(`Rate window exhausted. Waiting ${Math.ceil(waitMs / 1000)}s for reset...`);
    await sleep(waitMs);
  } else {
    // Gentle pacing for free tier.
    await sleep(250);
  }
  return response.json();
}

async function fetchPaginated(endpoint, apiKey, baseParams = {}, perPage = 100, maxItems = Infinity) {
  const all = [];
  let cursor = null;

  while (true) {
    const params = new URLSearchParams();
    params.set('per_page', String(perPage));
    Object.entries(baseParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    if (cursor !== null && cursor !== undefined && cursor !== '') params.set('cursor', String(cursor));

    const url = `${API_BASE}/${endpoint}?${params.toString()}`;
    const payload = await fetchJson(url, apiKey);
    const data = Array.isArray(payload.data) ? payload.data : [];
    all.push(...data);
    if (all.length >= maxItems) {
      return all.slice(0, maxItems);
    }

    const nextCursor = payload.meta && payload.meta.next_cursor;
    if (nextCursor === null || nextCursor === undefined || nextCursor === '') break;
    cursor = nextCursor;
  }

  return all;
}

async function fetchPlayersWithFallback(apiKey, perPage, maxPlayers) {
  try {
    const active = await fetchPaginated('players/active', apiKey, {}, perPage, maxPlayers);
    return active;
  } catch (error) {
    if (!String(error.message || '').includes('HTTP 401')) throw error;
    console.warn('players/active not available for this API tier. Falling back to /players.');
    const players = await fetchPaginated('players', apiKey, {}, perPage, maxPlayers);
    return players.filter((player) => player && player.active !== false);
  }
}

function parseStatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildStatMap(seasonStats) {
  const map = new Map();
  for (const row of seasonStats) {
    if (!row || !row.player || !row.player.id) continue;
    const playerId = Number(row.player.id);
    map.set(playerId, {
      ab: parseStatNumber(row.ab),
      r: parseStatNumber(row.r),
      h: parseStatNumber(row.h),
      hr: parseStatNumber(row.hr),
      rbi: parseStatNumber(row.rbi),
      bb: parseStatNumber(row.bb),
      k: parseStatNumber(row.so ?? row.k),
      sb: parseStatNumber(row.sb),
      avg: parseStatNumber(row.avg),
      obp: parseStatNumber(row.obp),
      slg: parseStatNumber(row.slg),
      fpts: parseStatNumber(row.fpts ?? row.fantasy_points),
    });
  }
  return map;
}

function buildInjuryMap(injuries) {
  const map = new Map();
  for (const row of injuries) {
    const playerId = Number(row && (row.player_id || (row.player && row.player.id)));
    if (!Number.isFinite(playerId)) continue;
    map.set(playerId, row);
  }
  return map;
}

function toPlayerRecord(player, injury, stats) {
  const id = Number(player.id);
  const team = player.team || {};
  const teamId = Number(team.id);
  const positions = normalizePositionText(player.position);
  const name = String(player.full_name || `${player.first_name || ''} ${player.last_name || ''}`).trim();
  const status = normalizeStatus(injury);
  const isAvailable = status === 'active' || status === 'day-to-day';

  if (!Number.isFinite(id) || !Number.isFinite(teamId) || !team.abbreviation || !name) return null;

  return {
    playerId: `mlb-${id}`,
    mlbPersonId: id,
    name,
    playerName: name,
    positions,
    position: positions.join(','),
    mlbTeam: String(team.abbreviation).toUpperCase(),
    mlbTeamId: `mlb-${teamId}`,
    status,
    isAvailable,
    ...(stats || {
      ab: 0,
      r: 0,
      h: 0,
      hr: 0,
      rbi: 0,
      bb: 0,
      k: 0,
      sb: 0,
      avg: 0,
      obp: 0,
      slg: 0,
      fpts: 0,
    }),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const apiKey = process.env.BALLDONTLIE_API_KEY || process.env.BDL_API_KEY || '';
  if (!apiKey) {
    throw new Error('Missing BALLDONTLIE_API_KEY (or BDL_API_KEY). Set it in your environment before running import-mlb.');
  }

  console.log(`Fetching balldontlie MLB data (season ${args.season})...`);

  const players = await fetchPlayersWithFallback(apiKey, args.perPage, args.maxPlayers);
  console.log(`Fetched ${players.length} active players.`);

  let injuries = [];
  try {
    injuries = await fetchPaginated('player_injuries', apiKey, {}, args.perPage);
    console.log(`Fetched ${injuries.length} injury rows.`);
  } catch (error) {
    console.warn(`Warning: injuries unavailable (${error.message}). Continuing with status=active.`);
  }

  let seasonStats = [];
  try {
    seasonStats = await fetchPaginated('season_stats', apiKey, { season: args.season }, args.perPage);
    console.log(`Fetched ${seasonStats.length} season stat rows.`);
  } catch (error) {
    console.warn(`Warning: season stats unavailable (${error.message}). Continuing with zeroed stats.`);
  }

  const injuryMap = buildInjuryMap(injuries);
  const statMap = buildStatMap(seasonStats);
  const skipped = [];

  const records = players
    .map((player) => {
      const id = Number(player.id);
      const record = toPlayerRecord(player, injuryMap.get(id), statMap.get(id));
      if (!record) {
        skipped.push({ playerId: player.id, reason: 'Missing required identity/team fields' });
      }
      return record;
    })
    .filter(Boolean);

  records.sort((a, b) => {
    const byPoints = Number(b.fpts || 0) - Number(a.fpts || 0);
    if (byPoints !== 0) return byPoints;
    return String(a.name).localeCompare(String(b.name));
  });

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(records), 'utf8');

  console.log(`Imported ${records.length} players. Skipped ${skipped.length}.`);
  if (skipped.length) {
    console.warn('Skipped player details (first 20):');
    skipped.slice(0, 20).forEach((entry) => {
      console.warn(`  ${entry.playerId}: ${entry.reason}`);
    });
  }
  console.log(`Wrote ${args.out}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

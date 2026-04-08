const fs = require('fs');
const path = require('path');

const playersPath = path.join(__dirname, '..', '..', 'data', 'players.json');
const fallbackPlayers = require('../../data/players');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_SORT_BY = 'fpts';
const DEFAULT_SORT_ORDER = 'desc';
const KNOWN_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'P', 'U'];

const NUMERIC_FIELDS = new Set([
  'ab',
  'r',
  'h',
  'hr',
  'rbi',
  'bb',
  'k',
  'sb',
  'avg',
  'obp',
  'slg',
  'fpts',
]);

const SORTABLE_FIELDS = new Set([
  'name',
  'playerName',
  'positions',
  'mlbTeam',
  'mlbTeamId',
  'position',
  'ab',
  'r',
  'h',
  'hr',
  'rbi',
  'bb',
  'k',
  'sb',
  'avg',
  'obp',
  'slg',
  'fpts',
]);

const MLB_TEAM_IDS = {
  ARI: 109,
  ATL: 144,
  BAL: 110,
  BOS: 111,
  CHC: 112,
  CIN: 113,
  CLE: 114,
  COL: 115,
  CWS: 145,
  DET: 116,
  HOU: 117,
  KC: 118,
  LAA: 108,
  LAD: 119,
  MIA: 146,
  MIL: 158,
  MIN: 142,
  NYM: 121,
  NYY: 147,
  OAK: 133,
  PHI: 143,
  PIT: 134,
  SD: 135,
  SEA: 136,
  SF: 137,
  STL: 138,
  TB: 139,
  TEX: 140,
  TOR: 141,
  WAS: 120,
};

function stringHash(input) {
  let hash = 0;
  const text = String(input || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function toPositiveInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const normalized = Math.floor(number);
  return normalized > 0 ? normalized : null;
}

function parseMlbPersonId(value) {
  const asNumber = toPositiveInt(value);
  if (asNumber) return asNumber;
  const match = String(value || '').match(/^mlb-(\d+)$/i);
  return match ? toPositiveInt(match[1]) : null;
}

function parseMlbTeamId(value) {
  const asNumber = toPositiveInt(value);
  if (asNumber) return asNumber;
  const match = String(value || '').match(/^mlb-(\d+)$/i);
  return match ? toPositiveInt(match[1]) : null;
}

function inferMlbPersonId(player, index) {
  return (
    parseMlbPersonId(player.mlbPersonId) ||
    parseMlbPersonId(player.playerId) ||
    parseMlbPersonId(player.id) ||
    ((stringHash(`${player.playerName || ''}|${player.team || ''}|${index}`) % 900000) + 100000)
  );
}

function normalizePlayerRecord(player, index) {
  const mlbPersonId = inferMlbPersonId(player, index);
  const mlbTeam = String(player.mlbTeam || player.team || '').trim().toUpperCase();
  const teamId = parseMlbTeamId(player.mlbTeamId) || MLB_TEAM_IDS[mlbTeam] || null;
  const name = String(player.name || player.playerName || '').trim();
  const positions = normalizePositions(player, name);
  const status = String(player.status || 'active').trim().toLowerCase() || 'active';
  const isAvailable = parseAvailability(player.isAvailable);
  const { id, team, ...rest } = player;
  return {
    ...rest,
    name,
    playerName: name,
    positions,
    position: positions.join(','),
    mlbTeam,
    mlbTeamId: teamId ? `mlb-${teamId}` : null,
    mlbPersonId,
    playerId: `mlb-${mlbPersonId}`,
    status,
    isAvailable,
  };
}

function loadPlayers() {
  let players = fallbackPlayers;
  try {
    if (fs.existsSync(playersPath)) {
      players = JSON.parse(fs.readFileSync(playersPath, 'utf8'));
    }
  } catch (_) {}
  return players.map(normalizePlayerRecord);
}

function firstValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizeStringValue(value) {
  return String(value || '').trim();
}

function parseListParam(value) {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : [value];
  const list = raw
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
  return [...new Set(list)];
}

function parseNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseSortBy(value) {
  const normalized = normalizeStringValue(value);
  return SORTABLE_FIELDS.has(normalized) ? normalized : DEFAULT_SORT_BY;
}

function parseSortOrder(value) {
  const normalized = normalizeStringValue(value).toLowerCase();
  return normalized === 'asc' ? 'asc' : DEFAULT_SORT_ORDER;
}

function toPositionTokens(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => String(v).trim().toUpperCase())
      .filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
}

function normalizePositions(player, name) {
  const tokens = toPositionTokens(player.positions || player.position);
  if (tokens.length) return [...new Set(tokens)];
  return fallbackPositionsFromName(name || player.playerName);
}

function parseAvailability(value) {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  return Boolean(normalized);
}

function fallbackPositionsFromName(playerName) {
  if (!playerName) return [];
  const upper = String(playerName).toUpperCase();
  const matches = upper.match(/\b(C|1B|2B|3B|SS|OF|DH|P|U)\b/g) || [];
  return [...new Set(matches)];
}

function playerPositionTokens(player) {
  const tokens = toPositionTokens(player.positions || player.position);
  if (tokens.length) return tokens;
  return fallbackPositionsFromName(player.name || player.playerName);
}

function buildNumericRanges(query) {
  const ranges = {};
  for (const field of NUMERIC_FIELDS) {
    const capField = field.charAt(0).toUpperCase() + field.slice(1);
    const min = parseNumber(firstValue(query[`min${capField}`]));
    const max = parseNumber(firstValue(query[`max${capField}`]));
    if (min !== null || max !== null) {
      ranges[field] = { min, max };
    }
  }
  return ranges;
}

function buildPlayersQuery(query = {}) {
  const search = normalizeStringValue(firstValue(query.search)).toLowerCase();
  const teams = parseListParam(query.team);
  const positions = parseListParam(query.position);
  const sortBy = parseSortBy(firstValue(query.sortBy));
  const sortOrder = parseSortOrder(firstValue(query.sortOrder));
  const limit = clamp(parsePositiveInt(firstValue(query.limit), DEFAULT_LIMIT), 1, MAX_LIMIT);
  const offset = Math.max(0, parsePositiveInt(firstValue(query.offset), 0));
  const ranges = buildNumericRanges(query);

  return {
    search,
    teams,
    positions,
    sortBy,
    sortOrder,
    limit,
    offset,
    ranges,
  };
}

function matchesSearch(player, search) {
  if (!search) return true;
  const name = String(player.name || player.playerName || '').toLowerCase();
  const team = String(player.mlbTeam || '').toLowerCase();
  const teamId = String(player.mlbTeamId || '').toLowerCase();
  const position = String((player.positions || []).join(',') || player.position || '').toLowerCase();
  const playerId = String(player.playerId || '').toLowerCase();
  return (
    name.includes(search) ||
    team.includes(search) ||
    teamId.includes(search) ||
    position.includes(search) ||
    playerId.includes(search)
  );
}

function matchesTeam(player, teams) {
  if (!teams.length) return true;
  return teams.includes(String(player.mlbTeam || '').toUpperCase());
}

function matchesPosition(player, positions) {
  if (!positions.length) return true;
  const tokens = playerPositionTokens(player);
  return positions.some((position) => tokens.includes(position));
}

function matchesRanges(player, ranges) {
  for (const [field, { min, max }] of Object.entries(ranges)) {
    const value = Number(player[field]);
    if (!Number.isFinite(value)) return false;
    if (min !== null && value < min) return false;
    if (max !== null && value > max) return false;
  }
  return true;
}

function comparePlayers(left, right, sortBy, direction) {
  const leftValue = sortBy === 'positions' ? (left.positions || []).join(',') : left[sortBy];
  const rightValue = sortBy === 'positions' ? (right.positions || []).join(',') : right[sortBy];
  const leftNumber = Number(leftValue);
  const rightNumber = Number(rightValue);

  let compare = 0;
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    compare = leftNumber - rightNumber;
  } else {
    compare = String(leftValue || '').localeCompare(String(rightValue || ''));
  }

  if (compare === 0) {
    compare = String(left.name || left.playerName || '').localeCompare(
      String(right.name || right.playerName || '')
    );
  }
  return compare * direction;
}

function applyPlayersQuery(players, query) {
  const filtered = players.filter(
    (player) =>
      matchesSearch(player, query.search) &&
      matchesTeam(player, query.teams) &&
      matchesPosition(player, query.positions) &&
      matchesRanges(player, query.ranges)
  );

  const direction = query.sortOrder === 'asc' ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => comparePlayers(a, b, query.sortBy, direction));
  const page = sorted.slice(query.offset, query.offset + query.limit);

  return {
    players: page,
    total: filtered.length,
    limit: query.limit,
    offset: query.offset,
    sort: { by: query.sortBy, order: query.sortOrder },
    filters: {
      search: query.search || null,
      teams: query.teams,
      positions: query.positions,
      ranges: query.ranges,
    },
  };
}

function getPlayerFilterOptions(players) {
  const teams = [...new Set(players.map((player) => String(player.mlbTeam || '').trim().toUpperCase()))]
    .filter(Boolean)
    .sort();

  const positions = [
    ...new Set(players.flatMap((player) => playerPositionTokens(player).map((token) => token.toUpperCase()))),
  ].filter(Boolean);
  positions.sort((a, b) => a.localeCompare(b));

  return {
    teams,
    positions,
    sortFields: [...SORTABLE_FIELDS],
  };
}

module.exports = {
  loadPlayers,
  buildPlayersQuery,
  applyPlayersQuery,
  getPlayerFilterOptions,
};

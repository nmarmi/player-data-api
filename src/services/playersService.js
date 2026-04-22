const fs = require('fs');
const path = require('path');

const playersDataPath = path.join(__dirname, '..', '..', 'data', 'players.json');
const externalPlayersPath = process.env.PLAYERS_DATA_PATH
  ? path.resolve(process.cwd(), process.env.PLAYERS_DATA_PATH)
  : null;
const fallbackPlayers = require('../../data/players');

let _getDb = null;
function tryGetDb() {
  if (!_getDb) {
    try { _getDb = require('../db/connection').getDb; } catch (_) {}
  }
  try { return _getDb ? _getDb() : null; } catch (_) { return null; }
}

/** Convert a DB row back to the camelCase PlayerStub shape. */
function rowToPlayer(row) {
  return {
    playerId:    row.player_id,
    mlbPersonId: row.mlb_person_id,
    name:        row.name,
    playerName:  row.player_name,
    positions:   JSON.parse(row.positions || '[]'),
    position:    row.position,
    mlbTeam:     row.mlb_team,
    mlbTeamId:   row.mlb_team_id,
    status:      row.status,
    isAvailable: row.is_available === 1,
    depthChartRank:     row.depth_chart_rank,
    depthChartPosition: row.depth_chart_position,
    ab:   row.ab,  r:   row.r,   h:   row.h,   hr:  row.hr,
    rbi:  row.rbi, bb:  row.bb,  k:   row.k,   sb:  row.sb,
    avg:  row.avg, obp: row.obp, slg: row.slg,
    era:  row.era, whip: row.whip, w: row.w, sv: row.sv, ip: row.ip, k9: row.k9,
    fpts: row.fpts,
  };
}

function canonicalPositions(player) {
  const positions = Array.isArray(player.positions)
    ? player.positions
    : String(player.position || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
  return [...new Set(positions.map((v) => String(v).toUpperCase()))].sort();
}

function playerQualityScore(player) {
  const numericFields = ['ab', 'r', 'h', 'hr', 'rbi', 'bb', 'k', 'sb', 'avg', 'obp', 'slg', 'w', 'sv', 'ip', 'k9', 'fpts'];
  const nonZeroCount = numericFields.reduce((count, field) => {
    const value = Number(player[field] || 0);
    return count + (value !== 0 ? 1 : 0);
  }, 0);

  const fpts = Number(player.fpts || 0);
  const mlbPersonId = Number(player.mlbPersonId || 0);
  // Real MLB IDs are typically 6+ digits; old synthetic IDs in this repo are often tiny.
  const idReliabilityBonus = mlbPersonId >= 100000 ? 500 : 0;

  return nonZeroCount * 1000 + fpts + idReliabilityBonus;
}

function playerIdentityKey(player) {
  const mlbPersonId = Number(player.mlbPersonId || 0);
  if (mlbPersonId >= 100000) return `pid:${mlbPersonId}`;
  return [
    String(player.name || player.playerName || '').trim().toLowerCase(),
    String(player.mlbTeam || '').trim().toUpperCase(),
  ].join('||');
}

function mergePlayerRecords(a, b) {
  const base = playerQualityScore(a) >= playerQualityScore(b) ? { ...a } : { ...b };
  const other = base === a ? b : a;

  const mergedPositions = [...new Set([...canonicalPositions(base), ...canonicalPositions(other)])].sort();
  base.positions = mergedPositions;
  base.position = mergedPositions.join(',');

  const numericFields = ['ab', 'r', 'h', 'hr', 'rbi', 'bb', 'k', 'sb', 'avg', 'obp', 'slg', 'era', 'whip', 'w', 'sv', 'ip', 'k9', 'fpts'];
  for (const field of numericFields) {
    const baseValue = Number(base[field] || 0);
    const otherValue = Number(other[field] || 0);
    if (baseValue === 0 && otherValue !== 0) base[field] = otherValue;
  }

  if (!base.mlbPersonId || Number(base.mlbPersonId) < 100000) {
    const otherId = Number(other.mlbPersonId || 0);
    if (otherId >= 100000) {
      base.mlbPersonId = otherId;
      base.playerId = `mlb-${otherId}`;
    }
  }

  return base;
}

function hasReliablePersonId(player) {
  return Number(player.mlbPersonId || 0) >= 100000;
}

function dedupePlayers(players = []) {
  // First dedupe strict duplicates by playerId.
  const byPlayerId = new Map();
  for (const player of players) {
    const id = String(player.playerId || '').trim();
    if (!id) continue;
    const existing = byPlayerId.get(id);
    if (!existing || playerQualityScore(player) > playerQualityScore(existing)) {
      byPlayerId.set(id, player);
    }
  }

  // Then dedupe logical duplicates by identity and merge positions/stats.
  const byIdentity = new Map();
  for (const player of byPlayerId.values()) {
    const key = playerIdentityKey(player);
    if (!key || key.startsWith('||')) continue;

    const existing = byIdentity.get(key);
    if (!existing) byIdentity.set(key, player);
    else byIdentity.set(key, mergePlayerRecords(existing, player));
  }

  // Final safety pass: collapse any remaining duplicates by visible identity
  // (same player name + MLB team), which catches legacy low-ID records.
  const byNameTeam = new Map();
  for (const player of byIdentity.values()) {
    const key = [
      String(player.name || player.playerName || '').trim().toLowerCase(),
      String(player.mlbTeam || '').trim().toUpperCase(),
    ].join('||');
    if (!key || key.startsWith('||')) continue;
    const existing = byNameTeam.get(key);
    if (!existing) byNameTeam.set(key, player);
    else byNameTeam.set(key, mergePlayerRecords(existing, player));
  }

  const mergedByNameTeam = [...byNameTeam.values()];

  // Extra cleanup: if same name+position has one reliable MLB ID record and one or more
  // low-ID legacy records (often stale team aliases), keep the reliable record.
  const byNamePos = new Map();
  for (const player of mergedByNameTeam) {
    const key = [
      String(player.name || player.playerName || '').trim().toLowerCase(),
      canonicalPositions(player).join('|'),
    ].join('||');
    if (!byNamePos.has(key)) byNamePos.set(key, []);
    byNamePos.get(key).push(player);
  }

  const finalPlayers = [];
  for (const group of byNamePos.values()) {
    const reliable = group.filter(hasReliablePersonId);
    const legacy = group.filter((p) => !hasReliablePersonId(p));
    if (reliable.length === 1 && legacy.length >= 1) {
      // Merge any useful non-zero stat/position info into the reliable row, then keep one row.
      let merged = reliable[0];
      for (const oldRow of legacy) merged = mergePlayerRecords(merged, oldRow);
      finalPlayers.push(merged);
    } else {
      finalPlayers.push(...group);
    }
  }

  return finalPlayers;
}

const STATS_JOIN_SQL = `
  SELECT
    p.player_id, p.mlb_person_id, p.name, p.player_name,
    p.positions,  p.position,     p.mlb_team, p.mlb_team_id,
    p.status,     p.is_available,
    p.depth_chart_rank, p.depth_chart_position,
    COALESCE(hs.ab,  0) AS ab,
    COALESCE(hs.r,   0) AS r,
    COALESCE(hs.h,   0) AS h,
    COALESCE(hs.hr,  0) AS hr,
    COALESCE(hs.rbi, 0) AS rbi,
    COALESCE(hs.bb,  0) AS bb,
    COALESCE(hs.k,   0) AS k,
    COALESCE(hs.sb,  0) AS sb,
    COALESCE(hs.avg, 0) AS avg,
    COALESCE(hs.obp, 0) AS obp,
    COALESCE(hs.slg, 0) AS slg,
    COALESCE(ps.era,  0) AS era,
    COALESCE(ps.whip, 0) AS whip,
    COALESCE(ps.w,    0) AS w,
    COALESCE(ps.sv,   0) AS sv,
    COALESCE(ps.ip,   0) AS ip,
    COALESCE(ps.k9,   0) AS k9,
    (
      COALESCE(hs.hr,  0) * 5 +
      COALESCE(hs.rbi, 0) * 2 +
      COALESCE(hs.r,   0) * 2 +
      COALESCE(hs.sb,  0) * 3 +
      COALESCE(ps.w,   0) * 7 +
      COALESCE(ps.sv,  0) * 10 +
      COALESCE(ps.ip,  0) * 0.5
    ) AS fpts
  FROM players p
  LEFT JOIN player_stats hs
    ON  hs.player_id  = p.player_id
    AND hs.stat_group = 'hitting'
    AND hs.season     = (SELECT MAX(season) FROM player_stats WHERE stat_group = 'hitting')
  LEFT JOIN player_stats ps
    ON  ps.player_id  = p.player_id
    AND ps.stat_group = 'pitching'
    AND ps.season     = (SELECT MAX(season) FROM player_stats WHERE stat_group = 'pitching')
`;

function loadPlayersFromDb() {
  const db = tryGetDb();
  if (!db) return null;
  try {
    const rows = db.prepare(STATS_JOIN_SQL).all();
    if (!rows.length) return null;
    return dedupePlayers(rows.map(rowToPlayer));
  } catch (_) { return null; }
}

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
  'era',
  'whip',
  'w',
  'sv',
  'ip',
  'k9',
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
  'era',
  'whip',
  'w',
  'sv',
  'ip',
  'k9',
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
    ((stringHash(`${player.playerName || ''}|${player.mlbTeam || player.team || ''}|${index}`) % 900000) + 100000)
  );
}

function readPlayersFromPath(filePath) {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
  // US-3.3: prefer database; fall back to JSON if DB unavailable or empty
  const dbPlayers = loadPlayersFromDb();
  if (dbPlayers) return dbPlayers;

  let players = null;
  try {
    players = readPlayersFromPath(externalPlayersPath) || readPlayersFromPath(playersDataPath);
  } catch (_) {}
  if (!Array.isArray(players) || !players.length) players = fallbackPlayers;
  return dedupePlayers(players.map(normalizePlayerRecord));
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
  parseListParam,
};

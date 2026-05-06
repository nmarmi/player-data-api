#!/usr/bin/env node
/**
 * Convert NL stats CSV to data/players.json for the API.
 * Usage: node scripts/csv-to-players.js [path-to-csv]
 *   Default CSV: data/2025-player-NL-stats.csv (or 3Year-average-NL-stats.csv / projections-NL.csv)
 *
 * CSV columns: Player,AB,R,H,1B,2B,3B,HR,RBI,BB,K,SB,CS,AVG,OBP,SLG,FPTS
 * Player format: "Name Position | TEAM" or Name Position | TEAM
 */
const fs = require('fs');
const path = require('path');

const csvPath = process.argv[2] || path.join(__dirname, '..', 'data', '2025-player-NL-stats.csv');
const outPath = path.join(__dirname, '..', 'data', 'players.json');
const KNOWN_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'P', 'U'];

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

function parsePlayerField(raw) {
  // "Juan Soto OF | NYM" or "Shohei Ohtani U,P | LAD " -> name, position, team
  const s = raw.trim();
  const pipe = s.lastIndexOf(' | ');
  if (pipe === -1) return { playerName: s, position: '', team: '' };
  const team = s.slice(pipe + 3).trim();
  const nameAndPos = s.slice(0, pipe).trim();
  const knownPositions = ['U,P', '1B', '2B', '3B', 'SS', 'OF', 'C', 'DH', 'P'];
  let position = '';
  let playerName = nameAndPos;
  for (const pos of knownPositions) {
    const suffix = ' ' + pos;
    if (nameAndPos.endsWith(suffix)) {
      position = pos;
      playerName = nameAndPos.slice(0, -suffix.length).trim();
      break;
    }
  }
  if (!position && nameAndPos.includes(' ')) {
    const last = nameAndPos.split(/\s+/).pop();
    if (last.length <= 4) {
      position = last;
      playerName = nameAndPos.slice(0, nameAndPos.length - last.length).trim();
    }
  }
  return { playerName, position, team };
}

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

function buildMlbPersonId(rawId, playerName, team, rowIndex) {
  const parsed = toPositiveInt(rawId);
  if (parsed) return parsed;
  return (stringHash(`${playerName}|${team}|${rowIndex}`) % 900000) + 100000;
}

function findColumnIndex(headerFields, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return headerFields.findIndex((name) => wanted.has(String(name).trim().toLowerCase()));
}

function parseLine(line, columns, rowIndex) {
  let playerRaw;
  let restStr;
  if (line.startsWith('"')) {
    const end = line.indexOf('",');
    if (end === -1) return { error: 'Malformed quoted Player field' };
    playerRaw = line.slice(1, end).replace(/""/g, '"');
    restStr = line.slice(end + 2);
  } else {
    const idx = line.indexOf(',');
    if (idx === -1) return { error: 'Missing CSV delimiter' };
    playerRaw = line.slice(0, idx);
    restStr = line.slice(idx + 1);
  }
  const cells = restStr.split(',').map((x) => x.trim());
  const cell = (index) => (index >= 0 ? cells[index] : '');
  const num = (index) => {
    const v = cell(index);
    if (v === '' || v == null) return 0;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const { playerName, position, team } = parsePlayerField(playerRaw);
  const mlbPersonId = buildMlbPersonId(cell(columns.mlbPersonId), playerName, team, rowIndex);
  return {
    mlbPersonId,
    playerId: `mlb-${mlbPersonId}`,
    playerName,
    team,
    position,
    ab: num(columns.ab),
    r: num(columns.r),
    h: num(columns.h),
    hr: num(columns.hr),
    rbi: num(columns.rbi),
    bb: num(columns.bb),
    k: num(columns.k),
    sb: num(columns.sb),
    avg: num(columns.avg),
    obp: num(columns.obp),
    slg: num(columns.slg),
    fpts: num(columns.fpts),
  };
  if (!player.name) return { error: 'Missing player name' };
  if (!player.mlbTeam) return { error: 'Missing MLB team abbreviation' };
  if (!player.positions.length) return { error: 'Missing/invalid positions' };
  if (!player.mlbTeamId) return { error: `Unknown MLB team "${player.mlbTeam}"` };
  return { player };
}

const csv = fs.readFileSync(csvPath, 'utf8');
const lines = csv.split(/\r?\n/).filter((l) => l.trim());
const header = lines[0];
if (!header.toLowerCase().startsWith('player')) {
  console.error('Expected CSV header starting with Player. Got:', header.slice(0, 80));
  process.exit(1);
}
const headerFields = header.split(',').map((value) => value.trim());
const statHeaders = headerFields.slice(1);
const columns = {
  mlbPersonId: findColumnIndex(statHeaders, ['mlbPersonId', 'mlb_person_id', 'mlbamid']),
  ab: findColumnIndex(statHeaders, ['ab']),
  r: findColumnIndex(statHeaders, ['r']),
  h: findColumnIndex(statHeaders, ['h']),
  hr: findColumnIndex(statHeaders, ['hr']),
  rbi: findColumnIndex(statHeaders, ['rbi']),
  bb: findColumnIndex(statHeaders, ['bb']),
  k: findColumnIndex(statHeaders, ['k']),
  sb: findColumnIndex(statHeaders, ['sb']),
  avg: findColumnIndex(statHeaders, ['avg']),
  obp: findColumnIndex(statHeaders, ['obp']),
  slg: findColumnIndex(statHeaders, ['slg']),
  fpts: findColumnIndex(statHeaders, ['fpts']),
};
const required = ['ab', 'r', 'h', 'hr', 'rbi', 'bb', 'k', 'sb', 'avg', 'obp', 'slg', 'fpts'];
const missing = required.filter((column) => columns[column] === -1);
if (missing.length) {
  console.error('Missing required CSV columns:', missing.join(', '));
  process.exit(1);
}

const players = [];
const skippedRows = [];
for (let i = 1; i < lines.length; i++) {
  const row = parseLine(lines[i], columns, i);
  if (row && row.playerName) players.push(row);
}
// Dedupe by playerId (mlb-{mlbPersonId})
const seen = new Set();
const unique = players.filter((player) => {
  if (seen.has(player.playerId)) return false;
  seen.add(player.playerId);
  return true;
}).map(({ _sourceRow, ...player }) => player);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(unique, null, 0), 'utf8');
console.log(
  `Processed ${lines.length - 1} rows. Imported ${unique.length}. Skipped ${skippedRows.length}. Duplicates ${duplicateCount}.`
);
if (skippedRows.length) {
  console.warn('Skipped row details (first 20):');
  skippedRows.slice(0, 20).forEach((entry) => {
    console.warn(`  row ${entry.row}: ${entry.reason}`);
  });
}
console.log('Wrote', unique.length, 'players to', outPath);

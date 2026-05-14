#!/usr/bin/env node
/**
 * US-11.2: Import forward-looking projection stats from a CSV file into the
 * `player_projections` table.
 *
 * Usage:
 *   node scripts/import-projections.js <path/to/projections.csv> [--source steamer|zips|manual] [--season 2025]
 *
 * Expected CSV columns (case-insensitive, common aliases accepted):
 *
 *   Player / Name / PlayerName  — display name; used to match against `players` table
 *   MLBID / mlb_person_id / mlbam  — MLB person ID (preferred for matching)
 *   Team / mlbTeam
 *   PA / AB                    — plate appearances or at-bats
 *   G / Games                  — games played
 *   R                          — runs
 *   H                          — hits
 *   HR                         — home runs
 *   RBI                        — runs batted in
 *   BB                         — walks
 *   K / SO                     — strikeouts
 *   SB                         — stolen bases
 *   AVG                        — batting average
 *   OBP                        — on-base percentage
 *   SLG                        — slugging percentage
 *   OPS                        — OPS (derived if absent)
 *   IP                         — innings pitched (can be decimal or "187.2" notation)
 *   W                          — wins
 *   L                          — losses
 *   ERA                        — earned run average
 *   WHIP
 *   K9 / K_9                   — strikeouts per 9 innings
 *   SV                         — saves
 *   HLD / HD                   — holds
 *   QS                         — quality starts
 *
 * A row is classified as a pitcher projection when IP > 0 and HR < 10 is unlikely
 * for a batter.  The heuristic used: if IP > 20, treat as pitching; else hitting.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

// ── CLI argument parsing ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (!args.length || args[0] === '--help') {
  console.log(
    'Usage: node scripts/import-projections.js <csv-path> [--source steamer|zips|manual] [--season YYYY]'
  );
  process.exit(0);
}

const csvPath   = args[0];
const sourceArg = args.indexOf('--source');
const seasonArg = args.indexOf('--season');
const source    = sourceArg !== -1 ? args[sourceArg + 1] : (process.env.VALUATION_PROJECTION_SOURCE || 'steamer');
const season    = seasonArg !== -1 ? Number(args[seasonArg + 1]) : new Date().getFullYear();

const VALID_SOURCES = ['steamer', 'zips', 'manual'];
if (!VALID_SOURCES.includes(source)) {
  console.error(`Unknown source "${source}". Valid values: ${VALID_SOURCES.join(', ')}`);
  process.exit(1);
}

if (!fs.existsSync(csvPath)) {
  console.error(`CSV file not found: ${csvPath}`);
  process.exit(1);
}

// ── CSV parsing (no external deps) ───────────────────────────────────────────
function parseCSV(content) {
  const lines  = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const header = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
  const rows   = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = splitCSVLine(line);
    const row   = {};
    header.forEach((key, idx) => { row[key] = (cells[idx] || '').trim().replace(/"/g, ''); });
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line) {
  const cells = [];
  let current = '', inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { cells.push(current); current = ''; }
    else { current += ch; }
  }
  cells.push(current);
  return cells;
}

// ── Column lookup (case-insensitive, alias-aware) ─────────────────────────────
function col(row, ...aliases) {
  for (const alias of aliases) {
    const key = Object.keys(row).find((k) => k.toLowerCase() === alias.toLowerCase());
    if (key !== undefined && row[key] !== '') return row[key];
  }
  return null;
}

function num(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

// Baseball IP notation: 187.2 means 187 + 2/3 innings (0.2 → 2 outs → 2/3 inning)
function parseIP(value) {
  if (value === null || value === '') return 0;
  const s = String(value);
  const [whole, frac] = s.split('.');
  const wholeNum = parseInt(whole, 10) || 0;
  const fracNum  = parseInt(frac  || '0', 10);
  return wholeNum + (fracNum / 3);
}

// ── DB connection ─────────────────────────────────────────────────────────────
const { getDb }   = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');

const db = getDb();
migrate();

// Build a lookup map: mlbPersonId → player_id
const playersByPersonId = new Map();
const playersByName     = new Map();
for (const row of db.prepare('SELECT player_id, mlb_person_id, name, player_name FROM players').all()) {
  if (row.mlb_person_id) playersByPersonId.set(String(row.mlb_person_id), row.player_id);
  const nameLower = String(row.name || row.player_name || '').toLowerCase().trim();
  if (nameLower) playersByName.set(nameLower, row.player_id);
}

// ── Upsert helper ─────────────────────────────────────────────────────────────
const upsert = db.prepare(`
  INSERT INTO player_projections
    (player_id, mlb_person_id, season, stat_group, source,
     games_played, ab, r, h, hr, rbi, bb, k, sb,
     avg, obp, slg, ops, w, l, era, whip, k9, ip, sv, hld, qs, updated_at)
  VALUES
    (@player_id, @mlb_person_id, @season, @stat_group, @source,
     @games_played, @ab, @r, @h, @hr, @rbi, @bb, @k, @sb,
     @avg, @obp, @slg, @ops, @w, @l, @era, @whip, @k9, @ip, @sv, @hld, @qs, datetime('now'))
  ON CONFLICT(player_id, season, stat_group, source) DO UPDATE SET
    games_played = excluded.games_played, ab = excluded.ab,
    r = excluded.r, h = excluded.h, hr = excluded.hr, rbi = excluded.rbi,
    bb = excluded.bb, k = excluded.k, sb = excluded.sb,
    avg = excluded.avg, obp = excluded.obp, slg = excluded.slg, ops = excluded.ops,
    w = excluded.w, l = excluded.l, era = excluded.era, whip = excluded.whip,
    k9 = excluded.k9, ip = excluded.ip, sv = excluded.sv, hld = excluded.hld,
    qs = excluded.qs, updated_at = datetime('now')
`);

// ── Main import ───────────────────────────────────────────────────────────────
const content  = fs.readFileSync(csvPath, 'utf8');
const csvRows  = parseCSV(content);

let inserted = 0, skipped = 0;

const importAll = db.transaction(() => {
  for (const row of csvRows) {
    // Resolve player_id
    const rawId      = col(row, 'mlbid', 'mlb_person_id', 'mlbamid', 'playerid', 'mlb_id');
    const rawName    = col(row, 'player', 'name', 'playername', 'fullname');
    let   playerId   = null;
    let   mlbPersonId = 0;

    if (rawId) {
      const idStr = String(parseInt(rawId, 10));
      playerId    = playersByPersonId.get(idStr);
      mlbPersonId = parseInt(rawId, 10) || 0;
    }
    if (!playerId && rawName) {
      playerId = playersByName.get(rawName.toLowerCase().trim());
    }
    if (!playerId) {
      // Synthesize a local player_id from name so projections aren't silently lost
      if (!rawName) { skipped++; continue; }
      playerId = `proj-${rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    }

    const ip         = parseIP(col(row, 'ip'));
    const stat_group = ip > 20 ? 'pitching' : 'hitting';

    const ab  = num(col(row, 'ab'));
    const avg = num(col(row, 'avg'));
    const obp = num(col(row, 'obp'));
    const slg = num(col(row, 'slg'));
    const ops = num(col(row, 'ops')) || (obp + slg);

    upsert.run({
      player_id: playerId,
      mlb_person_id: mlbPersonId,
      season,
      stat_group,
      source,
      games_played: num(col(row, 'g', 'games')),
      ab,
      r:   num(col(row, 'r', 'runs')),
      h:   num(col(row, 'h', 'hits')),
      hr:  num(col(row, 'hr')),
      rbi: num(col(row, 'rbi')),
      bb:  num(col(row, 'bb')),
      k:   num(col(row, 'k', 'so')),
      sb:  num(col(row, 'sb')),
      avg, obp, slg, ops,
      w:    num(col(row, 'w', 'wins')),
      l:    num(col(row, 'l', 'losses')),
      era:  num(col(row, 'era')),
      whip: num(col(row, 'whip')),
      k9:   num(col(row, 'k9', 'k_9', 'k/9')),
      ip,
      sv:  num(col(row, 'sv', 'saves')),
      hld: num(col(row, 'hld', 'hd', 'holds')),
      qs:  num(col(row, 'qs')),
    });
    inserted++;
  }
});

importAll();
console.log(`✅  Imported ${inserted} projections (source="${source}", season=${season}); ${skipped} rows skipped (no name/ID).`);

if (require.main === module) {
  // Already ran above
}

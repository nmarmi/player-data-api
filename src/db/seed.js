const { getDb } = require('./connection');
const path = require('path');
const fs = require('fs');
const log = require('../logger').child({ component: 'db' });

function loadSeedPlayers() {
  const jsonPath = path.join(__dirname, '..', '..', 'data', 'players.json');
  if (fs.existsSync(jsonPath)) return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  return require('../../data/players');
}

/**
 * US-3.1 / US-3.2: Populates the players table from the seed JSON file
 * if the table is empty. This is the "fallback to seed data" behaviour.
 */
function seedIfEmpty() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as n FROM players').get().n;

  if (count > 0) {
    log.info('seed skipped', { existingRows: count, reason: 'players table already populated' });
    return;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO players (
      player_id, mlb_person_id, name, player_name,
      positions, position, mlb_team, mlb_team_id,
      status, is_available,
      ab, r, h, hr, rbi, bb, k, sb, avg, obp, slg, fpts
    ) VALUES (
      @player_id, @mlb_person_id, @name, @player_name,
      @positions, @position, @mlb_team, @mlb_team_id,
      @status, @is_available,
      @ab, @r, @h, @hr, @rbi, @bb, @k, @sb, @avg, @obp, @slg, @fpts
    )
  `);

  const insertMany = db.transaction((players) => {
    for (const p of players) {
      insert.run({
        player_id:     p.playerId,
        mlb_person_id: p.mlbPersonId,
        name:          p.name || p.playerName || '',
        player_name:   p.playerName || p.name || '',
        positions:     JSON.stringify(
          Array.isArray(p.positions)
            ? p.positions
            : p.position
              ? p.position.split(',').map((v) => v.trim()).filter(Boolean)
              : []
        ),
        position:      p.position || '',
        mlb_team:      p.mlbTeam || p.team || '',
        mlb_team_id:   p.mlbTeamId || null,
        status:        p.status || 'active',
        is_available:  p.isAvailable === false ? 0 : 1,
        ab:  p.ab  || 0, r:   p.r   || 0, h:   p.h   || 0,
        hr:  p.hr  || 0, rbi: p.rbi || 0, bb:  p.bb  || 0,
        k:   p.k   || 0, sb:  p.sb  || 0, avg: p.avg || 0,
        obp: p.obp || 0, slg: p.slg || 0, fpts: p.fpts || 0,
      });
    }
  });

  const seedPlayers = loadSeedPlayers();
  insertMany(seedPlayers);
  log.info('seeded', { players: seedPlayers.length, source: 'seed file' });
}

module.exports = { seedIfEmpty };

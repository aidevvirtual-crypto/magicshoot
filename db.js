// SQLite storage (Node's built-in node:sqlite — no native build needed)
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// DATA_DIR lets hosted deployments keep the database outside the (replaced-on-deploy) build folder
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'magicshoot.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    shots INTEGER NOT NULL DEFAULT 0,
    played_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scores_player ON scores(player_id);
  CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const DEFAULT_SETTINGS = {
  gameDuration: 30,      // detik per pemain
  maxPlayers: 5,         // pemain bersamaan
  countdown: 3,          // detik hitung mundur
  readyTimeout: 60,      // detik menunggu pemain menekan START
  batMin: 6,
  batMax: 14,
  batSpeed: 1,
  goldenChance: 0.08,    // peluang bat emas (x3 poin)
  pointsPerHit: 10,
  comboBonus: 5,         // bonus per tingkat combo (maks 4 tingkat)
  fireCooldown: 250,     // ms antar tembakan
  sensitivity: 1,
  envRotate: 12,         // derajat ayunan environment kiri-kanan
  bgmVolume: 0.5,
  sfxVolume: 0.8,
  tauntsEnabled: true,
  controlMode: 'sword',  // 'sword' (HP = gagang pedang, petir) | 'gun' (HP = pistol)
  swingFire: true,       // ayunkan HP untuk menembak
  swingThreshold: 22,    // m/s² percepatan ayunan untuk menembak
  publicUrl: '',         // override URL QR (mis. tunnel https)
  adminPassword: 'admin123',
};

const NUMERIC = Object.keys(DEFAULT_SETTINGS).filter(k => typeof DEFAULT_SETTINGS[k] === 'number');
const BOOLEAN = Object.keys(DEFAULT_SETTINGS).filter(k => typeof DEFAULT_SETTINGS[k] === 'boolean');

function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    if (NUMERIC.includes(row.key)) out[row.key] = Number(row.value);
    else if (BOOLEAN.includes(row.key)) out[row.key] = row.value === 'true';
    else out[row.key] = row.value;
  }
  return out;
}

const LIMITS = {
  gameDuration: [5, 600], maxPlayers: [1, 5], countdown: [0, 10], readyTimeout: [10, 600],
  batMin: [1, 40], batMax: [1, 40], batSpeed: [0.2, 4], goldenChance: [0, 1],
  pointsPerHit: [1, 1000], comboBonus: [0, 1000], fireCooldown: [0, 3000],
  sensitivity: [0.2, 5], envRotate: [0, 60], bgmVolume: [0, 1], sfxVolume: [0, 1],
  swingThreshold: [8, 60],
};
const ENUMS = { controlMode: ['sword', 'gun'] };

function saveSettings(patch) {
  const stmt = db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [key, raw] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    let value = raw;
    if (NUMERIC.includes(key)) {
      value = Number(raw);
      if (!Number.isFinite(value)) continue;
      const [lo, hi] = LIMITS[key] || [-Infinity, Infinity];
      value = Math.min(hi, Math.max(lo, value));
      if (['gameDuration', 'maxPlayers', 'countdown', 'readyTimeout', 'batMin', 'batMax', 'pointsPerHit', 'comboBonus', 'fireCooldown'].includes(key)) value = Math.round(value);
    } else if (BOOLEAN.includes(key)) {
      value = raw === true || raw === 'true';
    } else {
      value = String(raw).trim();
      if (key === 'adminPassword' && value.length < 4) continue;
      if (ENUMS[key] && !ENUMS[key].includes(value)) continue;
    }
    stmt.run(key, String(value));
  }
  const s = getSettings();
  if (s.batMax < s.batMin) stmt.run('batMax', String(s.batMin));
  return getSettings();
}

const q = {
  createPlayer: db.prepare('INSERT INTO players(name, created_at) VALUES(?, ?)'),
  insertScore: db.prepare('INSERT INTO scores(player_id, score, hits, shots, played_at) VALUES(?, ?, ?, ?, ?)'),
  leaderboard: db.prepare(`
    SELECT p.id AS playerId, p.name, b.score, b.hits, b.shots
    FROM players p
    JOIN (
      SELECT s.player_id, s.score, s.hits, s.shots, s.played_at,
             ROW_NUMBER() OVER (PARTITION BY s.player_id ORDER BY s.score DESC, s.played_at ASC) AS rn
      FROM scores s
    ) b ON b.player_id = p.id AND b.rn = 1
    ORDER BY b.score DESC, b.played_at ASC
    LIMIT ?`),
  rankOf: db.prepare(`
    SELECT COUNT(*) + 1 AS rank FROM (
      SELECT player_id, MAX(score) AS best FROM scores GROUP BY player_id
    ) WHERE best > ?`),
  bestOf: db.prepare('SELECT MAX(score) AS best FROM scores WHERE player_id = ?'),
  topScore: db.prepare('SELECT MAX(score) AS top FROM scores'),
};

module.exports = {
  db,
  DATA_DIR,
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  createPlayer(name) {
    return Number(q.createPlayer.run(name, Date.now()).lastInsertRowid);
  },
  insertScore(playerId, score, hits, shots) {
    return Number(q.insertScore.run(playerId, score, hits, shots, Date.now()).lastInsertRowid);
  },
  leaderboard(limit = 10) {
    return q.leaderboard.all(limit);
  },
  rankOf(score) {
    return q.rankOf.get(score).rank;
  },
  bestOf(playerId) {
    return q.bestOf.get(playerId).best || 0;
  },
  topScore() {
    return q.topScore.get().top || 0;
  },

  // ---- admin ----
  listScores({ limit = 200, offset = 0, search = '' } = {}) {
    const like = `%${search}%`;
    const rows = db.prepare(`
      SELECT s.id, s.player_id AS playerId, p.name, s.score, s.hits, s.shots, s.played_at AS playedAt
      FROM scores s JOIN players p ON p.id = s.player_id
      WHERE p.name LIKE ?
      ORDER BY s.score DESC, s.played_at ASC LIMIT ? OFFSET ?`).all(like, limit, offset);
    const total = db.prepare('SELECT COUNT(*) AS n FROM scores s JOIN players p ON p.id = s.player_id WHERE p.name LIKE ?').get(like).n;
    return { rows, total };
  },
  updateScore(id, score) {
    return db.prepare('UPDATE scores SET score = ? WHERE id = ?').run(Math.max(0, Math.round(score)), id).changes;
  },
  deleteScore(id) {
    return db.prepare('DELETE FROM scores WHERE id = ?').run(id).changes;
  },
  resetScores() {
    return db.prepare('DELETE FROM scores').run().changes;
  },
  listPlayers({ limit = 200, offset = 0, search = '' } = {}) {
    const like = `%${search}%`;
    const rows = db.prepare(`
      SELECT p.id, p.name, p.created_at AS createdAt,
             COUNT(s.id) AS games, COALESCE(MAX(s.score), 0) AS best, MAX(s.played_at) AS lastPlayed
      FROM players p LEFT JOIN scores s ON s.player_id = p.id
      WHERE p.name LIKE ?
      GROUP BY p.id ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(like, limit, offset);
    const total = db.prepare('SELECT COUNT(*) AS n FROM players WHERE name LIKE ?').get(like).n;
    return { rows, total };
  },
  renamePlayer(id, name) {
    return db.prepare('UPDATE players SET name = ? WHERE id = ?').run(name, id).changes;
  },
  deletePlayer(id) {
    return db.prepare('DELETE FROM players WHERE id = ?').run(id).changes;
  },
  resetAll() {
    db.exec('DELETE FROM scores; DELETE FROM players;');
  },
  stats() {
    return {
      players: db.prepare('SELECT COUNT(*) AS n FROM players').get().n,
      games: db.prepare('SELECT COUNT(*) AS n FROM scores').get().n,
      topScore: db.prepare('SELECT COALESCE(MAX(score), 0) AS n FROM scores').get().n,
      totalHits: db.prepare('SELECT COALESCE(SUM(hits), 0) AS n FROM scores').get().n,
    };
  },
};

// MagicShoot — multiplayer gyro bat shooter
// Display (desktop):  http://localhost:3000/
// Controller (HP):    https://<IP-LAN>:3443/play   (HTTPS wajib untuk gyroscope)
// Admin:              http://localhost:3000/admin
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const store = require('./db');

const HTTP_PORT = Number(process.env.PORT || 3000);
// HTTPS_PORT=0 turns off the built-in self-signed HTTPS server (use it behind a real HTTPS proxy/domain)
const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 3443);
const PUBLIC_URL = process.env.PUBLIC_URL || '';
const ROOT = __dirname;
const PLAYER_COLORS = ['#ff3b6b', '#3bd1ff', '#ffd23b', '#7cff5a', '#c77dff'];

let settings = store.getSettings();

// ---------------------------------------------------------------- network
function lanAddresses() {
  if (process.env.LAN_IP) return [process.env.LAN_IP];
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ ip: a.address, name });
    }
  }
  // prefer the real Wi-Fi/Ethernet adapter over virtual ones (Windows hotspot 192.168.137.x, Hyper-V, VirtualBox, VPN...)
  const score = ({ ip, name }) => {
    let s = ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3;
    if (/wi-?fi|wlan|ethernet|^en|^eth/i.test(name)) s -= 10;
    if (/vethernet|virtual|vmware|vbox|hyper-v|loopback|tailscale|zerotier|wsl|docker|local area connection\*/i.test(name) || ip.startsWith('192.168.137.')) s += 20;
    return s;
  };
  return out.sort((a, b) => score(a) - score(b)).map(a => a.ip);
}

function joinUrl() {
  const base = settings.publicUrl || PUBLIC_URL;
  if (base) return base.replace(/\/+$/, '') + '/play';
  const ip = lanAddresses()[0] || 'localhost';
  return HTTPS_PORT ? `https://${ip}:${HTTPS_PORT}/play` : `http://${ip}:${HTTP_PORT}/play`;
}

async function loadCert() {
  const dir = path.join(store.DATA_DIR, 'certs');
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  const ipsFile = path.join(dir, 'ips.txt');
  const ips = lanAddresses();
  if (fs.existsSync(keyFile) && fs.existsSync(certFile) && fs.existsSync(ipsFile) &&
      fs.readFileSync(ipsFile, 'utf8') === ips.join(',')) {
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
  }
  const selfsigned = require('selfsigned');
  const pems = selfsigned.generate([{ name: 'commonName', value: 'magicshoot.local' }], {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        ...ips.map(ip => ({ type: 7, ip })),
      ],
    }],
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, pems.private);
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(ipsFile, ips.join(','));
  return { key: pems.private, cert: pems.cert };
}

// ---------------------------------------------------------------- express
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use('/assets', express.static(path.join(ROOT, 'assets'), { maxAge: '1d' }));
app.use('/fonts', express.static(path.join(ROOT, 'fonts'), { maxAge: '7d' }));
app.use('/music', express.static(path.join(ROOT, 'music'), { maxAge: '1d' }));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three'), { maxAge: '7d' }));
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'public', 'display.html')));
app.get('/play', (req, res) => res.sendFile(path.join(ROOT, 'public', 'play.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
app.use(express.static(path.join(ROOT, 'public')));

// ---- admin API
const adminTokens = new Map(); // token -> expiry
function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const exp = adminTokens.get(token);
  if (!exp || exp < Date.now()) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
const idParam = req => Number.parseInt(req.params.id, 10);

app.post('/api/admin/login', (req, res) => {
  const pass = String((req.body && req.body.password) || '');
  const expected = settings.adminPassword;
  const ok = pass.length === expected.length && crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(expected));
  if (!ok) return res.status(401).json({ error: 'Password salah' });
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.set(token, Date.now() + 12 * 3600 * 1000);
  res.json({ token });
});
app.get('/api/admin/stats', requireAdmin, (req, res) => res.json(store.stats()));
app.get('/api/admin/scores', requireAdmin, (req, res) => {
  res.json(store.listScores({ limit: Math.min(1000, +req.query.limit || 200), offset: +req.query.offset || 0, search: String(req.query.search || '') }));
});
app.put('/api/admin/scores/:id', requireAdmin, (req, res) => {
  const n = store.updateScore(idParam(req), Number(req.body.score) || 0);
  pushLeaderboard();
  res.json({ ok: n > 0 });
});
app.delete('/api/admin/scores/:id', requireAdmin, (req, res) => {
  const n = store.deleteScore(idParam(req));
  pushLeaderboard();
  res.json({ ok: n > 0 });
});
app.delete('/api/admin/scores', requireAdmin, (req, res) => {
  const n = store.resetScores();
  pushLeaderboard();
  res.json({ ok: true, deleted: n });
});
app.get('/api/admin/players', requireAdmin, (req, res) => {
  res.json(store.listPlayers({ limit: Math.min(1000, +req.query.limit || 200), offset: +req.query.offset || 0, search: String(req.query.search || '') }));
});
app.put('/api/admin/players/:id', requireAdmin, (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Nama tidak valid' });
  const n = store.renamePlayer(idParam(req), name);
  for (const p of players.values()) if (p.dbId === idParam(req)) p.name = name;
  pushLeaderboard();
  pushLobby();
  res.json({ ok: n > 0 });
});
app.delete('/api/admin/players/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  for (const p of [...players.values()]) if (p.dbId === id) removePlayer(p, 'Dihapus oleh admin');
  const n = store.deletePlayer(id);
  pushLeaderboard();
  res.json({ ok: n > 0 });
});
app.delete('/api/admin/all', requireAdmin, (req, res) => {
  for (const p of [...players.values()]) removePlayer(p, 'Data direset oleh admin');
  store.resetAll();
  pushLeaderboard();
  res.json({ ok: true });
});
app.get('/api/admin/live', requireAdmin, (req, res) => {
  res.json({
    active: activeList().map(publicPlayer),
    queue: queue.map(t => players.get(t)).filter(Boolean).map(p => ({ pid: p.pid, name: p.name, connected: !!p.socketId })),
    displays: displays.size,
    joinUrl: joinUrl(),
    lan: lanAddresses(),
  });
});
app.post('/api/admin/live/kick/:pid', requireAdmin, (req, res) => {
  const p = [...players.values()].find(x => x.pid === req.params.pid);
  if (!p) return res.status(404).json({ error: 'Tidak ditemukan' });
  if (p.state === 'playing' || p.state === 'countdown') finishGame(p);
  else removePlayer(p, 'Dikeluarkan oleh admin');
  res.json({ ok: true });
});
app.get('/api/admin/settings', requireAdmin, (req, res) => res.json(settings));
app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  settings = store.saveSettings(req.body || {});
  await refreshQr();
  io.to('display').emit('settings', displaySettings());
  for (const p of players.values()) sendState(p);
  promoteQueue();
  pushLobby();
  res.json(settings);
});

// ---------------------------------------------------------------- game state
/** token -> player */
const players = new Map();
/** tokens waiting for a slot */
const queue = [];
/** display sockets; first one is the leader that judges hits */
const displays = new Set();
let leaderDisplay = null;
let qrDataUrl = '';
let lastJoinUrl = '';

function newId(bytes = 6) { return crypto.randomBytes(bytes).toString('hex'); }

function cleanName(raw) {
  return String(raw || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

function activeList() {
  return [...players.values()].filter(p => p.slot !== null).sort((a, b) => a.slot - b.slot);
}

function freeSlot() {
  const used = new Set(activeList().map(p => p.slot));
  for (let i = 0; i < settings.maxPlayers; i++) if (!used.has(i)) return i;
  return null;
}

function publicPlayer(p) {
  const now = Date.now();
  return {
    pid: p.pid,
    name: p.name,
    color: p.color,
    slot: p.slot,
    state: p.state,
    score: p.score,
    hits: p.hits,
    shots: p.shots,
    streak: p.streak,
    connected: !!p.socketId,
    remaining: p.state === 'playing' ? Math.max(0, p.endsAt - now)
      : p.state === 'countdown' ? Math.max(0, p.countdownEndsAt - now) : 0,
    result: p.result || null,
  };
}

function displaySettings() {
  const { adminPassword, publicUrl, ...rest } = settings;
  return rest;
}

function lobbyPayload() {
  return {
    active: activeList().map(publicPlayer),
    queue: queue.length,
    queueNames: queue.map(t => players.get(t)).filter(Boolean).slice(0, 5).map(p => p.name),
    leaderboard: store.leaderboard(10),
    joinUrl: joinUrl(),
    qr: qrDataUrl,
    settings: displaySettings(),
  };
}

function pushLobby() { io.to('display').emit('lobby', lobbyPayload()); }
function pushLeaderboard() { io.to('display').emit('leaderboard', store.leaderboard(10)); }

function sendState(p, extra = {}) {
  if (!p.socketId) return;
  const now = Date.now();
  io.to(p.socketId).emit('state', {
    state: p.state,
    name: p.name,
    pid: p.pid,
    color: p.color,
    score: p.score,
    hits: p.hits,
    shots: p.shots,
    queuePos: p.state === 'queued' ? queue.indexOf(p.token) + 1 : 0,
    remaining: p.state === 'playing' ? Math.max(0, p.endsAt - now)
      : p.state === 'countdown' ? Math.max(0, p.countdownEndsAt - now)
      : p.state === 'ready' ? Math.max(0, p.readyDeadline - now) : 0,
    result: p.result || null,
    settings: {
      sensitivity: settings.sensitivity, fireCooldown: settings.fireCooldown, gameDuration: settings.gameDuration, sfxVolume: settings.sfxVolume,
      controlMode: settings.controlMode, swingFire: settings.swingFire, swingThreshold: settings.swingThreshold,
    },
    displayOnline: displays.size > 0,
    ...extra,
  });
}

function broadcastQueuePositions() {
  queue.forEach(t => { const p = players.get(t); if (p) sendState(p); });
}

function enterSlot(p, slot) {
  p.slot = slot;
  p.color = PLAYER_COLORS[slot % PLAYER_COLORS.length];
  p.state = 'ready';
  p.score = 0; p.hits = 0; p.shots = 0; p.streak = 0; p.result = null;
  p.readyDeadline = Date.now() + settings.readyTimeout * 1000;
  io.to('display').emit('player-join', publicPlayer(p));
  sendState(p);
}

function promoteQueue() {
  let changed = false;
  while (queue.length) {
    const slot = freeSlot();
    if (slot === null) break;
    const p = players.get(queue.shift());
    if (!p) continue;
    enterSlot(p, slot);
    changed = true;
  }
  if (changed) broadcastQueuePositions();
  return changed;
}

function enqueue(p) {
  p.state = 'queued';
  p.slot = null;
  p.result = null;
  if (!queue.includes(p.token)) queue.push(p.token);
  if (!promoteQueue()) sendState(p);
  pushLobby();
}

function removePlayer(p, reason) {
  const qi = queue.indexOf(p.token);
  if (qi >= 0) queue.splice(qi, 1);
  const hadSlot = p.slot !== null;
  p.slot = null;
  p.state = 'gone';
  players.delete(p.token);
  if (p.socketId) io.to(p.socketId).emit('kicked', { reason });
  if (hadSlot) io.to('display').emit('player-leave', { pid: p.pid });
  promoteQueue();
  broadcastQueuePositions();
  pushLobby();
}

function startCountdown(p) {
  p.state = 'countdown';
  p.countdownEndsAt = Date.now() + settings.countdown * 1000;
  io.to('display').emit('player-countdown', publicPlayer(p));
  sendState(p);
  pushLobby();
}

function startGame(p) {
  p.state = 'playing';
  p.endsAt = Date.now() + settings.gameDuration * 1000;
  p.lastFire = 0;
  io.to('display').emit('player-start', publicPlayer(p));
  sendState(p);
  pushLobby();
}

function finishGame(p) {
  if (p.state !== 'playing' && p.state !== 'countdown') return;
  const prevTop = store.topScore();
  const prevBest = store.bestOf(p.dbId);
  store.insertScore(p.dbId, p.score, p.hits, p.shots);
  const rank = store.rankOf(Math.max(p.score, prevBest));
  p.result = {
    score: p.score,
    hits: p.hits,
    shots: p.shots,
    accuracy: p.shots ? Math.round((p.hits / p.shots) * 100) : 0,
    rank,
    best: Math.max(prevBest, p.score),
    personalBest: p.score > prevBest && p.score > 0,
    topScore: p.score > prevTop && p.score > 0,
  };
  p.state = 'done';
  p.doneUntil = Date.now() + 3500; // keep the card on screen briefly, then free the slot
  io.to('display').emit('player-done', publicPlayer(p));
  pushLeaderboard();
  sendState(p);
  pushLobby();
}

function releaseSlot(p) {
  const pid = p.pid;
  p.slot = null;
  p.state = 'finished';
  io.to('display').emit('player-leave', { pid });
  sendState(p);
  promoteQueue();
  pushLobby();
}

// ---- main tick: countdowns, timers, timeouts, disconnect grace
setInterval(() => {
  const now = Date.now();
  for (const p of [...players.values()]) {
    if (p.state === 'countdown' && now >= p.countdownEndsAt) startGame(p);
    else if (p.state === 'playing' && now >= p.endsAt) finishGame(p);
    else if (p.state === 'done' && now >= p.doneUntil) releaseSlot(p);
    else if (p.state === 'ready' && now >= p.readyDeadline) removePlayer(p, 'Waktu menunggu START habis');

    if (!p.socketId && p.disconnectedAt) {
      const idle = now - p.disconnectedAt;
      if ((p.state === 'queued' || p.state === 'ready') && idle > 20000) removePlayer(p, 'Koneksi terputus');
      else if (p.state === 'finished' && idle > 10 * 60000) players.delete(p.token);
    }
  }
}, 100);

async function refreshQr() {
  const url = joinUrl();
  if (url === lastJoinUrl && qrDataUrl) return;
  lastJoinUrl = url;
  qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 420, color: { dark: '#12051f', light: '#ffffff' } });
}

// ---------------------------------------------------------------- sockets
const io = new Server({ cors: { origin: true }, pingInterval: 10000, pingTimeout: 15000 });

function pickLeader() {
  leaderDisplay = displays.size ? [...displays][0] : null;
  for (const id of displays) io.to(id).emit('leader', { leader: id === leaderDisplay });
}

io.on('connection', socket => {
  const role = socket.handshake.query.role;

  if (role === 'display') {
    socket.join('display');
    displays.add(socket.id);
    if (!leaderDisplay) leaderDisplay = socket.id;
    socket.emit('leader', { leader: leaderDisplay === socket.id });
    socket.emit('lobby', lobbyPayload());
    for (const p of players.values()) if (p.state !== 'finished') sendState(p);

    // Leader display judges every shot and reports the outcome.
    socket.on('shot-result', msg => {
      if (socket.id !== leaderDisplay || !msg) return;
      const p = [...players.values()].find(x => x.pid === msg.pid);
      if (!p || p.state !== 'playing') return;
      if (msg.hit) {
        p.hits++;
        p.streak++;
        const combo = Math.min(p.streak - 1, 4);
        let points = settings.pointsPerHit + combo * settings.comboBonus;
        if (msg.golden) points *= 3;
        p.score += points;
        io.to('display').emit('score', { pid: p.pid, points, total: p.score, streak: p.streak, golden: !!msg.golden, sx: msg.sx, sy: msg.sy });
        if (p.socketId) io.to(p.socketId).emit('hit', { points, total: p.score, streak: p.streak, golden: !!msg.golden });
      } else {
        p.streak = 0;
        io.to('display').emit('score', { pid: p.pid, points: 0, total: p.score, streak: 0 });
        if (p.socketId) io.to(p.socketId).emit('miss', {});
      }
    });

    socket.on('disconnect', () => {
      displays.delete(socket.id);
      if (leaderDisplay === socket.id) pickLeader();
      for (const p of players.values()) sendState(p);
    });
    return;
  }

  // ---------------- controller (phone)
  let me = null;

  socket.on('join', async (msg, ack) => {
    msg = msg || {};
    const reply = typeof ack === 'function' ? ack : () => {};
    // re-attach to an existing session (screen locked / page reloaded)
    if (msg.token && players.has(msg.token)) {
      me = players.get(msg.token);
      if (me.socketId && me.socketId !== socket.id) io.to(me.socketId).emit('kicked', { reason: 'Dibuka di tab lain' });
      me.socketId = socket.id;
      me.disconnectedAt = 0;
      reply({ ok: true, token: me.token, resumed: true });
      if (me.state === 'finished' && msg.again) enqueue(me);
      else sendState(me);
      pushLobby();
      return;
    }
    const name = cleanName(msg.name);
    if (!name) return reply({ ok: false, error: 'Nama wajib diisi' });
    me = {
      token: newId(16),
      pid: newId(4),
      dbId: store.createPlayer(name),
      name,
      socketId: socket.id,
      disconnectedAt: 0,
      state: 'queued',
      slot: null,
      color: '#ffffff',
      score: 0, hits: 0, shots: 0, streak: 0,
      result: null,
    };
    players.set(me.token, me);
    reply({ ok: true, token: me.token });
    enqueue(me);
  });

  socket.on('start', () => {
    if (me && me.state === 'ready') startCountdown(me);
  });

  socket.on('again', () => {
    if (me && (me.state === 'finished' || me.state === 'done')) {
      if (me.state === 'done') releaseSlot(me);
      enqueue(me);
    }
  });

  socket.on('leave', () => {
    if (!me) return;
    if (me.state === 'playing' || me.state === 'countdown') finishGame(me);
    me.socketId = null; // voluntary leave: don't send a "kicked" notice
    removePlayer(me, 'Keluar');
    me = null;
  });

  socket.on('aim', a => {
    if (!me || me.slot === null || !a) return;
    const x = Number(a.x), y = Number(a.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const out = { pid: me.pid, x: Math.max(-1.2, Math.min(1.2, x)), y: Math.max(-1.2, Math.min(1.2, y)) };
    // full phone orientation (three.js world quaternion) for the sword
    if (Array.isArray(a.q) && a.q.length === 4 && a.q.every(Number.isFinite)) out.q = a.q.map(Number);
    socket.to('display').volatile.emit('aim', out);
  });

  socket.on('fire', a => {
    if (!me || me.state !== 'playing' || !a || !leaderDisplay) return;
    const now = Date.now();
    if (now - me.lastFire < settings.fireCooldown * 0.8) return;
    me.lastFire = now;
    const x = Number(a.x), y = Number(a.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    me.shots++;
    io.to('display').emit('fire', { pid: me.pid, x, y });
  });

  socket.on('disconnect', () => {
    if (me && me.socketId === socket.id) {
      me.socketId = null;
      me.disconnectedAt = Date.now();
      pushLobby();
    }
  });
});

// ---------------------------------------------------------------- boot
(async () => {
  await refreshQr();
  const httpServer = http.createServer(app);
  io.attach(httpServer);
  httpServer.listen(HTTP_PORT, () => console.log(`Display  : http://localhost:${HTTP_PORT}/`));

  if (!HTTPS_PORT) {
    console.log(`Admin    : /admin  (password awal: ${store.DEFAULT_SETTINGS.adminPassword})`);
    console.log(`Pemain   : ${joinUrl()}`);
    return;
  }
  try {
    const cert = await loadCert();
    const httpsServer = https.createServer(cert, app);
    io.attach(httpsServer);
    // never let the optional LAN HTTPS server take the whole app down (e.g. port taken on a host)
    httpsServer.on('error', err => console.error(`HTTPS port ${HTTPS_PORT} tidak tersedia (${err.code}); lanjut tanpa HTTPS lokal.`));
    httpsServer.listen(HTTPS_PORT, () => {
      console.log(`Admin    : http://localhost:${HTTP_PORT}/admin  (password awal: ${store.DEFAULT_SETTINGS.adminPassword})`);
      console.log(`Pemain   : ${joinUrl()}`);
      console.log('Catatan  : HP & PC harus di jaringan WiFi yang sama. Terima peringatan sertifikat di HP (Advanced > Proceed).');
    });
  } catch (err) {
    console.error('HTTPS gagal dijalankan:', err.message);
  }
})();

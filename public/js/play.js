import { sfx, unlockAudio, setSfxVolume } from './sfx.js';

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEG = Math.PI / 180;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let token = store.get('ms_token');
let S = null;               // last state from server
let cfg = { sensitivity: 1, fireCooldown: 250, gameDuration: 30, sfxVolume: 0.8 };
let localEnd = 0;           // local clock time when current phase ends
let lastCd = -1;

// ============================================================ screens
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === `s-${id}`);
}
function warn(text) {
  const w = $('#warn');
  w.hidden = !text;
  w.textContent = text || '';
}

// ============================================================ socket
const socket = io({ query: { role: 'player' }, transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  if (token) {
    socket.emit('join', { token }, res => {
      if (!res || !res.ok) { token = null; store.set('ms_token', null); showName(); }
    });
  }
});
socket.on('disconnect', () => warn('Koneksi terputus, menyambungkan ulang...'));

function showName() {
  $('#name').value = store.get('ms_name') || '';
  show('name');
}

$('#name-form').addEventListener('submit', e => {
  e.preventDefault();
  unlockAudio();
  requestGyro(); // iOS needs this inside a user gesture
  const name = $('#name').value.trim();
  if (!name) return;
  store.set('ms_name', name);
  $('#name-err').textContent = '';
  socket.emit('join', { name }, res => {
    if (!res || !res.ok) { $('#name-err').textContent = (res && res.error) || 'Gagal masuk'; return; }
    token = res.token;
    store.set('ms_token', token);
    sfx.click();
  });
});

socket.on('state', st => {
  const prev = S ? S.state : null;
  S = st;
  cfg = { ...cfg, ...st.settings };
  setSfxVolume(cfg.sfxVolume);
  document.body.style.setProperty('--c', st.color || '#ff8a1f');
  warn(socket.connected ? (st.displayOnline ? '' : 'Layar game belum terhubung') : '');
  localEnd = performance.now() + (st.remaining || 0);

  switch (st.state) {
    case 'queued':
      $('#queue-pos').textContent = `#${st.queuePos}`;
      show('queue');
      break;
    case 'ready':
      document.querySelectorAll('.pname').forEach(el => { el.textContent = st.name; });
      $('#dur').textContent = cfg.gameDuration;
      updateGyroStep();
      show('ready');
      if (prev !== 'ready') { navigator.vibrate?.(200); sfx.join(); }
      break;
    case 'countdown':
      lastCd = -1;
      show('countdown');
      break;
    case 'playing':
      if (prev !== 'playing') { $('#hud-score').textContent = st.score; sfx.go(); navigator.vibrate?.(120); keepAwake(); }
      setupPad();
      show('play');
      break;
    case 'done':
    case 'finished':
      showResult(st);
      break;
  }
});

socket.on('kicked', ({ reason }) => {
  S = null;
  token = null;
  store.set('ms_token', null);
  $('#msg-text').textContent = reason || 'Sesi berakhir.';
  show('msg');
});

socket.on('hit', ({ points, total, streak, golden }) => {
  $('#hud-score').textContent = total;
  const ht = $('#hit-text');
  ht.textContent = golden ? `EMAS +${points}!` : `+${points}`;
  ht.classList.toggle('gold', !!golden);
  retrigger(ht, 'on');
  retrigger($('#pad'), 'flash-hit');
  $('#combo').textContent = streak >= 2 ? `Combo x${streak}` : '';
  navigator.vibrate?.(golden ? [40, 30, 40, 30, 80] : [35, 25, 60]);
  sfx.hit(streak);
});
socket.on('miss', () => {
  $('#combo').textContent = '';
  retrigger($('#pad'), 'flash-miss');
});

function retrigger(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

function showResult(st) {
  const r = st.result || { score: st.score, hits: st.hits, accuracy: 0, rank: '-', best: st.score };
  $('#res-score').textContent = r.score;
  $('#res-rank').textContent = `#${r.rank}`;
  $('#res-hits').textContent = r.hits;
  $('#res-acc').textContent = `${r.accuracy}%`;
  $('#res-best').textContent = r.best;
  $('#record').hidden = !(r.topScore || r.personalBest);
  $('#record').textContent = r.topScore ? 'Rekor baru!' : 'Skor terbaikmu!';
  if (!document.querySelector('#s-result.on')) {
    show('result');
    if (r.topScore || r.personalBest) sfx.fanfare(); else sfx.gameOver();
    navigator.vibrate?.([100, 60, 100]);
  }
  releaseAwake();
}

// ============================================================ buttons
document.addEventListener('click', e => {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  unlockAudio();
  sfx.click();
  switch (a.dataset.action) {
    case 'leave': socket.emit('leave'); token = null; store.set('ms_token', null); S = null; showName(); break;
    case 'again': socket.emit('again'); break;
    case 'recenter': recenter(); break;
    case 'rename': if (token) socket.emit('leave'); token = null; store.set('ms_token', null); S = null; showName(); break;
  }
});

$('#btn-gyro').addEventListener('click', () => { unlockAudio(); requestGyro(); });
$('#btn-start').addEventListener('click', () => {
  unlockAudio();
  requestGyro();
  recenter();
  socket.emit('start');
});

// ============================================================ gyro aiming
// Aim = direction the BACK of the phone points (works in portrait or landscape).
let gyroState = 'off';   // off | asking | on | denied | none
let gotOrientation = false;
const raw = { yaw: 0, pitch: 0 };
const calib = { yaw: 0, pitch: 0 };
const aim = { x: 0, y: 0 };
const touchAim = { x: 0, y: 0 };
let useTouch = false;

function onOrientation(e) {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  const a = e.alpha * DEG, b = e.beta * DEG, g = e.gamma * DEG;
  const sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(b), cb = Math.cos(b), sg = Math.sin(g), cg = Math.cos(g);
  // R = Rz(alpha) * Rx(beta) * Ry(gamma) applied to device -Z (out of the back)
  const dx = -sg * ca - cg * sb * sa;
  const dy = -sg * sa + cg * sb * ca;
  const dz = -cg * cb;
  raw.yaw = Math.atan2(dx, dy);
  raw.pitch = Math.asin(clamp(dz, -1, 1));
  if (!gotOrientation) {
    gotOrientation = true;
    gyroState = 'on';
    recenter();
    updateGyroStep();
  }
}

async function requestGyro() {
  if (gyroState === 'on' || gyroState === 'asking') return;
  if (!window.isSecureContext) {
    gyroState = 'none';
    updateGyroStep('Gyro butuh koneksi HTTPS. Pakai mode sentuh.');
    return;
  }
  if (typeof DeviceOrientationEvent === 'undefined') { gyroState = 'none'; updateGyroStep(); return; }
  try {
    gyroState = 'asking';
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') { gyroState = 'denied'; updateGyroStep(); return; }
    }
    addEventListener('deviceorientation', onOrientation);
    setTimeout(() => {
      if (!gotOrientation) { gyroState = 'none'; updateGyroStep(); }
    }, 1500);
  } catch (err) {
    gyroState = 'denied';
    updateGyroStep();
  }
}

function updateGyroStep(msg) {
  const step = $('#step-gyro');
  const btn = $('#btn-gyro');
  const st = $('#gyro-status');
  step.classList.toggle('done', gyroState === 'on');
  btn.hidden = gyroState === 'on';
  btn.disabled = gyroState === 'asking';
  st.textContent = msg || {
    off: '', asking: 'Meminta izin...', on: 'Gyro aktif! Gerakkan HP-mu.',
    denied: 'Izin ditolak. Mode sentuh dipakai (geser untuk membidik).',
    none: 'Sensor tidak tersedia. Mode sentuh dipakai (geser untuk membidik).',
  }[gyroState];
  useTouch = gyroState === 'none' || gyroState === 'denied';
}

function recenter() {
  calib.yaw = raw.yaw;
  calib.pitch = raw.pitch;
  touchAim.x = 0; touchAim.y = 0;
}

function computeAim() {
  if (useTouch || !gotOrientation) {
    aim.x = touchAim.x; aim.y = touchAim.y;
    return;
  }
  let dyaw = raw.yaw - calib.yaw;
  if (dyaw > Math.PI) dyaw -= 2 * Math.PI;
  if (dyaw < -Math.PI) dyaw += 2 * Math.PI;
  const dp = raw.pitch - calib.pitch;
  const halfX = (28 / cfg.sensitivity) * DEG;   // degrees of turn to reach the screen edge
  const halfY = (16 / cfg.sensitivity) * DEG;
  aim.x = clamp(dyaw / halfX, -1.1, 1.1);
  aim.y = clamp(dp / halfY, -1.1, 1.1);
}

// stream aim to the display ~30 times per second
setInterval(() => {
  if (!S || !['ready', 'countdown', 'playing'].includes(S.state)) return;
  computeAim();
  socket.volatile.emit('aim', { x: +aim.x.toFixed(4), y: +aim.y.toFixed(4) });
}, 33);

// ============================================================ firing
let lastFire = 0;
function fire() {
  if (!S || S.state !== 'playing') return;
  const now = performance.now();
  if (now - lastFire < cfg.fireCooldown) return;
  lastFire = now;
  computeAim();
  socket.emit('fire', { x: aim.x, y: aim.y });
  retrigger($('#fire-ring'), 'shot');
  navigator.vibrate?.(18);
  sfx.shoot();
}

let padReady = false;
function setupPad() {
  const pad = $('#pad');
  pad.classList.toggle('touch', useTouch);
  $('#pad-hint').textContent = useTouch ? 'Geser untuk membidik · tekan tombol untuk menembak' : 'Tap di mana saja untuk menembak';
  if (padReady) return;
  padReady = true;
  let drag = null;
  pad.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!useTouch) { fire(); return; }
    if (e.target.closest('#fire-ring')) { fire(); return; }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    pad.setPointerCapture(e.pointerId);
  });
  pad.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = pad.getBoundingClientRect();
    touchAim.x = clamp(touchAim.x + (e.clientX - drag.x) / r.width * 2.4 * cfg.sensitivity, -1.1, 1.1);
    touchAim.y = clamp(touchAim.y - (e.clientY - drag.y) / r.height * 2.4 * cfg.sensitivity, -1.1, 1.1);
    drag.x = e.clientX; drag.y = e.clientY;
    pad.style.setProperty('--ax', `${(touchAim.x + 1) * 50}%`);
    pad.style.setProperty('--ay', `${(1 - touchAim.y) * 50}%`);
  });
  const end = e => { if (drag && e.pointerId === drag.id) drag = null; };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
}

// ============================================================ timers (local clock)
function tick() {
  requestAnimationFrame(tick);
  if (!S) return;
  const now = performance.now();
  const left = Math.max(0, localEnd - now);
  if (S.state === 'countdown') {
    const n = Math.ceil(left / 1000);
    if (n !== lastCd && n > 0) {
      lastCd = n;
      const el = $('#cd-num');
      el.textContent = n;
      retrigger(el, 'tick');
      sfx.beep();
      navigator.vibrate?.(40);
    }
  } else if (S.state === 'playing') {
    const sec = Math.ceil(left / 1000);
    const t = $('#hud-time');
    if (t.textContent !== String(sec)) t.textContent = sec;
    t.parentElement.classList.toggle('hurry', sec <= 5);
    $('#hud-bar').style.transform = `scaleX(${clamp(left / (cfg.gameDuration * 1000), 0, 1)})`;
  } else if (S.state === 'ready') {
    const sec = Math.ceil(left / 1000);
    $('#ready-left').textContent = `Tekan START dalam ${sec} detik`;
  }
}
requestAnimationFrame(tick);

// ============================================================ screen wake lock
let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* unsupported */ }
}
function releaseAwake() {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S && S.state === 'playing') keepAwake();
});

if (!window.isSecureContext) warn('Buka lewat HTTPS agar gyro berfungsi.');
updateGyroStep();
if (!token) showName();

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
      $('#hold-hint').innerHTML = cfg.controlMode === 'gun'
        ? 'Pegang HP seperti pistol, <b>arahkan bagian belakang HP ke tengah layar</b>. Cari bidikan warna <span class="swatch"></span> di layar.'
        : 'Pegang HP seperti gagang pedang, <b>arahkan ujung atas HP ke tengah layar</b>. Cari pedang &amp; bidikan warna <span class="swatch"></span> di layar.';
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
// The phone's orientation is tracked as a full quaternion.
//  - sword mode: the TOP of the phone is the blade; it points at the target
//  - gun mode:   the BACK of the phone points at the target
let gyroState = 'off';   // off | asking | on | denied | none
let gotOrientation = false;
let qEarth = [0, 0, 0, 1];          // device -> earth frame (x east, y north, z up)
const calib = { heading: 0, pitch: 0 };
const aim = { x: 0, y: 0 };
let aimQ = null;                    // device orientation in the display's three.js world
const touchAim = { x: 0, y: 0 };
let useTouch = false;

// --- tiny quaternion helpers, [x, y, z, w]
const qAxis = (ax, ay, az, ang) => { const s = Math.sin(ang / 2); return [ax * s, ay * s, az * s, Math.cos(ang / 2)]; };
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
function qRot(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
const Q_EARTH_TO_THREE = qAxis(1, 0, 0, -Math.PI / 2); // earth z-up/north -> three y-up/-z forward
const pointerAxis = () => (cfg.controlMode === 'gun' ? [0, 0, -1] : [0, 1, 0]);

function onOrientation(e) {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  // W3C: R = Rz(alpha) * Rx(beta) * Ry(gamma)
  qEarth = qMul(qMul(qAxis(0, 0, 1, e.alpha * DEG), qAxis(1, 0, 0, e.beta * DEG)), qAxis(0, 1, 0, e.gamma * DEG));
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
      // iOS: motion (for swing-to-fire) has its own permission
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        DeviceMotionEvent.requestPermission().catch(() => {});
      }
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

// "this direction is the screen": remember the pointer's compass heading and tilt
function recenter() {
  const p = qRot(qEarth, pointerAxis());
  calib.heading = Math.atan2(p[0], p[1]);
  calib.pitch = Math.asin(clamp(p[2], -1, 1));
  touchAim.x = 0; touchAim.y = 0;
}

function computeAim() {
  if (useTouch || !gotOrientation) {
    aim.x = touchAim.x; aim.y = touchAim.y;
    aimQ = null;
    return;
  }
  // rotate so the calibrated heading faces the screen, then convert to three.js axes
  aimQ = qMul(Q_EARTH_TO_THREE, qMul(qAxis(0, 0, 1, calib.heading), qEarth));
  const v = qRot(aimQ, pointerAxis());
  const yaw = Math.atan2(v[0], -v[2]);
  const pitch = Math.asin(clamp(v[1], -1, 1)) - calib.pitch;
  const halfX = (28 / cfg.sensitivity) * DEG;   // degrees of turn to reach the screen edge
  const halfY = (16 / cfg.sensitivity) * DEG;
  aim.x = clamp(yaw / halfX, -1.1, 1.1);
  aim.y = clamp(pitch / halfY, -1.1, 1.1);
}

// stream aim (+ full orientation for the sword) to the display ~30 times per second
setInterval(() => {
  if (!S || !['ready', 'countdown', 'playing'].includes(S.state)) return;
  computeAim();
  const msg = { x: +aim.x.toFixed(4), y: +aim.y.toFixed(4) };
  if (aimQ) msg.q = aimQ.map(n => +n.toFixed(4));
  socket.volatile.emit('aim', msg);
}, 33);

// ---- extra fire triggers: hardware volume keys (only some phones/browsers pass them to web pages)
const VOLUME_KEYS = new Set(['AudioVolumeUp', 'AudioVolumeDown', 'VolumeUp', 'VolumeDown']);
addEventListener('keydown', e => {
  if (VOLUME_KEYS.has(e.key) || [24, 25, 174, 175].includes(e.keyCode)) { e.preventDefault(); fire(); }
});

// ---- swing the phone to fire (like slashing the sword)
let lastSwing = 0;
addEventListener('devicemotion', e => {
  if (!cfg.swingFire || !S || S.state !== 'playing') return;
  const a = e.acceleration;
  if (!a || a.x == null) return;
  const mag = Math.hypot(a.x, a.y, a.z);
  const now = performance.now();
  if (mag > cfg.swingThreshold && now - lastSwing > 450) { lastSwing = now; fire(); }
});

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
  const sword = cfg.controlMode !== 'gun';
  $('#fire-label').textContent = sword ? 'Petir!' : 'Tembak!';
  $('#pad-hint').textContent = useTouch
    ? 'Geser untuk membidik · tekan tombol untuk menembak'
    : `Tap layar${cfg.swingFire ? ', ayunkan HP' : ''} atau tombol volume untuk ${sword ? 'melepas petir' : 'menembak'}`;
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

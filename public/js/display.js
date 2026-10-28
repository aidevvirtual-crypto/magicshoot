import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { sfx, unlockAudio, setSfxVolume } from './sfx.js';

const $ = s => document.querySelector(s);
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V3 = THREE.Vector3;

let settings = { batMin: 6, batMax: 14, batSpeed: 1, goldenChance: 0.08, envRotate: 12, bgmVolume: 0.5, sfxVolume: 0.8, tauntsEnabled: true, controlMode: 'sword' };
const swordMode = () => settings.controlMode !== 'gun';
let isLeader = false;

// ============================================================ taunts
const TAUNTS_IDLE = [
  'Tembak dong, jangan cuma diliatin!', 'Mata minus ya?', 'Aku di sini lho~', 'Cupu!', 'Halah, gitu doang?',
  'Coba lagi, bocil!', 'Kena? Mimpi!', 'Lambat banget sih!', 'Nembak apa nyapu?', 'Tangan gemeteran ya?',
  'Pakai kacamata dulu sana!', 'Skill issue!', 'Ngantuk ya?', 'Nenekku lebih jago!', 'Wleee :P',
  'Tangkap aku kalau bisa!', 'Hihihi~', 'Kamu kalah sama kelelawar?', 'Bidik yang bener!', 'Zzz... bosen',
];
const TAUNTS_MISS = [
  'MELESET! Wkwk', 'Nyaris... NGGAK!', 'Angin doang!', 'Kasian deh lu!', 'Ups, gak kena!', 'Hahaha!',
  'Nembak awan ya?', 'Ke kiri dikit... eh kanan!', 'Pelurunya nyasar!', 'Fiuh~ santai',
];
const TAUNTS_OUCH = ['ADUHH!', 'Curang!', 'Nanti aku balas!', 'Aaakkk!', 'Cuma beruntung!', 'Sakit tauu!', 'Tidaaak!', 'Lapor emak!'];
const TAUNTS_LOBBY = ['Ayo scan QR-nya!', 'Gak ada yang berani?', 'Rumah ini milik kami!', 'Penakut semua!', 'Sini main, kalau berani!'];

// ============================================================ renderer / scene
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = makeSkyTexture();
scene.fog = new THREE.FogExp2(0x1d0d36, 0.016);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500);
const CAM_POS = new V3(0, 5.5, 16);
const CAM_LOOK = new V3(0, 7, -10);
camera.position.copy(CAM_POS);
camera.lookAt(CAM_LOOK);
const baseCamQuat = camera.quaternion.clone();

function makeCanvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#040010');
  gr.addColorStop(0.45, '#170a33');
  gr.addColorStop(0.75, '#3a1352');
  gr.addColorStop(1, '#5a1f4a');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTex = makeCanvasTex(128, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
});
const smokeTex = makeCanvasTex(128, (g, s) => {
  for (let i = 0; i < 14; i++) {
    const x = s / 2 + rand(-20, 20), y = s / 2 + rand(-20, 20), r = rand(20, 46);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }
});

// ---- lights
scene.add(new THREE.HemisphereLight(0x9a86ff, 0x2a0f2e, 1.1));
scene.add(new THREE.AmbientLight(0x5a3d8a, 0.6));
const moonLight = new THREE.DirectionalLight(0xc8d8ff, 2.2);
moonLight.position.set(-20, 30, 10);
scene.add(moonLight);
const rimLight = new THREE.DirectionalLight(0xff7a3a, 0.9);
rimLight.position.set(15, 6, -30);
scene.add(rimLight);
const pumpkinLight = new THREE.PointLight(0xff7a1a, 260, 60, 2);
pumpkinLight.position.set(0, 4, -18);
scene.add(pumpkinLight);
const boomLight = new THREE.PointLight(0xffaa55, 0, 30, 2);
scene.add(boomLight);

// ---- sky decoration
const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff2c8, fog: false, depthWrite: false }));
moon.position.set(-38, 42, -110);
moon.scale.setScalar(26);
scene.add(moon);
const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x9a6cff, fog: false, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
moonHalo.position.copy(moon.position).add(new V3(0, 0, -1));
moonHalo.scale.setScalar(70);
scene.add(moonHalo);
{
  const n = 700, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const th = rand(-Math.PI * 0.9, Math.PI * 0.9), ph = rand(0.08, 1.3), r = 180;
    pos.set([Math.sin(th) * Math.cos(ph) * r, Math.sin(ph) * r * 0.7 + 10, -Math.cos(th) * Math.cos(ph) * r], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })));
}
// distant fog bank below the floating island
const mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x6a2c7a, transparent: true, opacity: 0.35, fog: false, depthWrite: false }));
mist.position.set(0, -14, -60);
mist.scale.set(160, 40, 1);
scene.add(mist);

// floating embers / fireflies
const EMBERS = 140;
const emberGeo = new THREE.BufferGeometry();
const emberPos = new Float32Array(EMBERS * 3);
const emberSeed = new Float32Array(EMBERS);
for (let i = 0; i < EMBERS; i++) {
  emberPos.set([rand(-30, 30), rand(0.5, 18), rand(-30, 8)], i * 3);
  emberSeed[i] = Math.random() * 100;
}
emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
const embers = new THREE.Points(emberGeo, new THREE.PointsMaterial({
  color: 0xffa040, size: 0.28, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
}));
scene.add(embers);

// environment pivot (slowly rotates left/right)
const envPivot = new THREE.Group();
envPivot.position.set(0, 8.5, -34);
scene.add(envPivot);

// ============================================================ loading
const loader = new GLTFLoader();
const progress = { bat: 0, scene: 0, sword: 0 };
function setProgress() {
  const p = (progress.bat + progress.scene + progress.sword) / 3;
  $('#load-bar').style.width = `${Math.round(p * 100)}%`;
}
function loadGLB(url, key) {
  return new Promise((resolve, reject) => loader.load(url, resolve, e => {
    if (e.total) { progress[key] = e.loaded / e.total; setProgress(); }
  }, reject));
}

let batTemplate = null;
let batClip = null;
const goldMats = new Map();
// The held weapon is the magic stick (magic_stick.glb); identifiers keep the "sword" name.
let swordTemplate = null;
let swordClip = null;
let swordTipY = 2.2;            // gem centre height above the grip pivot (local units)
const SWORD_LEN = 2.8;          // stick length in world units
let gemInfo = null;             // { base: ImageData, mask: Float32Array, maskTex, w, h, src: Texture }
const gemMapCache = new Map();  // player colour -> recoloured base texture

// Find the gem in the stick's base texture (the bright cyan pixels) once.
function analyseGem(mat) {
  const src = mat.map;
  if (!src || !src.image) return null;
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src.image, 0, 0, S, S);
  const base = g.getImageData(0, 0, S, S);
  const d = base.data;
  const mask = new Float32Array(S * S);
  const mc = document.createElement('canvas');
  mc.width = mc.height = S;
  const mg = mc.getContext('2d');
  const md = mg.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const r = d[i * 4], b = d[i * 4 + 2];
    const w = clamp((b - r - 30) / 80, 0, 1); // cyan gem: blue far above red; brown wood: red above blue
    mask[i] = w;
    const v = Math.round(w * 255);
    md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = v;
    md.data[i * 4 + 3] = 255;
  }
  mg.putImageData(md, 0, 0);
  const maskTex = new THREE.CanvasTexture(mc);
  maskTex.flipY = src.flipY;
  maskTex.wrapS = src.wrapS; maskTex.wrapT = src.wrapT;
  maskTex.colorSpace = THREE.SRGBColorSpace;
  return { base, mask, maskTex, size: S, src };
}

// Base texture with the gem repainted in the player's colour (cached per colour).
function gemMapFor(color) {
  if (!gemInfo) return null;
  const key = new THREE.Color(color).getHexString();
  if (gemMapCache.has(key)) return gemMapCache.get(key);
  const { base, mask, size, src } = gemInfo;
  const col = new THREE.Color(color);
  const tr = col.r * 255, tg = col.g * 255, tb = col.b * 255;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const out = g.createImageData(size, size);
  const s = base.data, o = out.data;
  for (let i = 0; i < size * size; i++) {
    const j = i * 4, w = mask[i];
    if (w > 0) {
      const shade = 0.35 + 0.6 * (Math.max(s[j], s[j + 1], s[j + 2]) / 255); // keep the facets' light/dark
      o[j] = s[j] + (Math.min(255, tr * shade) - s[j]) * w;
      o[j + 1] = s[j + 1] + (Math.min(255, tg * shade) - s[j + 1]) * w;
      o[j + 2] = s[j + 2] + (Math.min(255, tb * shade) - s[j + 2]) * w;
    } else { o[j] = s[j]; o[j + 1] = s[j + 1]; o[j + 2] = s[j + 2]; }
    o[j + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = src.flipY;
  tex.wrapS = src.wrapS; tex.wrapT = src.wrapT;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  gemMapCache.set(key, tex);
  return tex;
}

async function loadAssets() {
  const [batG, sceneG, swordG] = await Promise.all([
    loadGLB('/assets/bat.glb', 'bat'), loadGLB('/assets/scene.glb', 'scene'), loadGLB('/assets/magic_stick.glb', 'sword'),
  ]);

  // --- magic stick: shaft along +Y with the gem on top; pivot at the grip like a held wand
  const sw = swordG.scene;
  sw.updateMatrixWorld(true);
  const sb = new THREE.Box3().setFromObject(sw);
  const ssz = sb.getSize(new V3());
  const sk = SWORD_LEN / ssz.y;
  const gripY = sb.min.y + ssz.y * 0.22;
  sw.scale.multiplyScalar(sk);
  sw.position.set(-(sb.min.x + ssz.x / 2) * sk, -gripY * sk, -(sb.min.z + ssz.z / 2) * sk);
  swordTipY = (sb.max.y - ssz.y * 0.11 - gripY) * sk; // centre of the gem cluster
  sw.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    if (!gemInfo) gemInfo = analyseGem(o.material);
  });
  swordTemplate = new THREE.Group();
  swordTemplate.add(sw);
  swordClip = swordG.animations[0] || null;

  // --- haunted island: normalise size, centre it on the pivot so it floats in frame
  const house = sceneG.scene;
  house.updateMatrixWorld(true);
  const hb = new THREE.Box3().setFromObject(house);
  const hs = hb.getSize(new V3());
  const hc = hb.getCenter(new V3());
  const k = Math.min(44 / Math.max(hs.x, hs.z), 34 / hs.y);
  house.scale.multiplyScalar(k);
  house.position.set(-hc.x * k, -hc.y * k, -hc.z * k);
  house.traverse(o => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => { if (m.emissive && m.emissive.getHex() > 0) m.emissiveIntensity = 2.5; });
    }
  });
  envPivot.add(house);

  // --- bat template: centre on origin, wingspan ~2.4 units
  const bat = batG.scene;
  bat.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(bat);
  const bsz = bb.getSize(new V3());
  const bc = bb.getCenter(new V3());
  const bk = 3.2 / Math.max(bsz.x, bsz.z);
  bat.scale.multiplyScalar(bk);
  bat.position.sub(bc.multiplyScalar(bk));
  // the model faces -Z; flip it so it faces +Z (the flight direction used by lookAt below)
  const batFlip = new THREE.Group();
  batFlip.rotation.y = Math.PI;
  batFlip.add(bat);
  batTemplate = new THREE.Group();
  batTemplate.add(batFlip);
  batTemplate.traverse(o => {
    if (o.isMesh) {
      o.frustumCulled = false;
      const m = o.material;
      if (m.emissive) {
        // let the texture glow a little so bats read against the night sky
        m.emissiveMap = m.map || null;
        m.emissive.setHex(m.map ? 0xb08ad0 : 0x4a1a6a);
        m.emissiveIntensity = 0.55;
      }
      if (!goldMats.has(m)) {
        const g = m.clone();
        g.color = new THREE.Color(0xffc53b);
        if (g.emissive) { g.emissiveMap = null; g.emissive.setHex(0xff8a00); g.emissiveIntensity = 0.9; }
        g.metalness = 0.7; g.roughness = 0.3;
        goldMats.set(m, g);
      }
    }
  });
  batClip = batG.animations[0];
}

// ============================================================ bats
const BAT_RADIUS = 1.4;
const bats = [];
const tmpV = new V3(), tmpV2 = new V3(), tmpM = new THREE.Matrix4();
const WORLD_UP = new V3(0, 1, 0);
const camFwd = new V3();

/** world point at given NDC and forward distance from the (unshaken) camera */
function screenPoint(nx, ny, depth, out = new V3()) {
  out.set(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
  camera.getWorldDirection(camFwd);
  out.multiplyScalar(depth / out.dot(camFwd)).add(camera.position);
  if (out.y < 1.4) out.y = 1.4;
  return out;
}
function toScreen(v, out = { x: 0, y: 0, behind: false }) {
  tmpV.copy(v).project(camera);
  out.behind = tmpV.z > 1;
  out.nx = tmpV.x; out.ny = tmpV.y;
  out.x = (tmpV.x + 1) / 2 * innerWidth;
  out.y = (1 - tmpV.y) / 2 * innerHeight;
  return out;
}

class Bat {
  constructor() {
    this.root = new THREE.Group();
    this.model = SkeletonUtils.clone(batTemplate);
    this.root.add(this.model);
    this.meshes = [];
    this.model.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.userData.base = o.material; this.meshes.push(o); } });
    this.mixer = new THREE.AnimationMixer(this.model);
    this.action = this.mixer.clipAction(batClip);
    this.action.play();
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x9a4dff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.scale.setScalar(4.2);
    this.root.add(this.glow);
    this.root.visible = false;
    scene.add(this.root);
    this.pos = this.root.position;
    this.vel = new V3();
    this.wp = new V3();
    this.fwd = new V3(0, 0, 1);
    this.axis = new V3();
    this.up = new V3();
    this.state = 'dead';
    this.bank = 0;
    this.roll = 0;
    this.scale = 1;
    this.bubble = null;
  }

  get hittable() { return this.state === 'fly' || this.state === 'leave'; }

  setGolden(on) {
    this.golden = on;
    for (const m of this.meshes) m.material = on ? goldMats.get(m.userData.base) || m.userData.base : m.userData.base;
    this.glow.material.color.setHex(on ? 0xffb020 : 0x9a4dff);
    this.glow.material.opacity = on ? 0.9 : 0.55;
  }

  spawn() {
    this.setGolden(Math.random() < settings.goldenChance);
    this.baseSpeed = rand(4.5, 7.5) * (this.golden ? 1.45 : 1);
    this.agility = rand(1.6, 2.8);
    this.bobF = rand(2, 4); this.bobP = rand(0, 6);
    this.size = (this.golden ? 0.8 : 1) * rand(0.85, 1.2);
    this.action.timeScale = rand(1.3, 2.2) * (this.golden ? 1.4 : 1);
    this.action.time = rand(0, batClip.duration);
    this.man = null; this.manT = 0; this.nextMan = rand(2, 6);
    this.roll = 0; this.bank = 0;
    const fromHouse = Math.random() < 0.45;
    if (fromHouse) {
      // burst out of the haunted house
      screenPoint(rand(-0.5, 0.5), rand(-0.25, 0.25), rand(36, 44), this.pos);
      this.scale = 0.01;
      this.newWaypoint(rand(9, 16));
    } else {
      const side = Math.random() < 0.5 ? -1 : 1;
      screenPoint(side * 1.35, rand(-0.2, 0.75), rand(9, 24), this.pos);
      this.scale = 1;
      this.newWaypoint();
    }
    this.vel.subVectors(this.wp, this.pos).setLength(this.baseSpeed);
    this.fwd.copy(this.vel).normalize();
    this.state = 'fly';
    this.root.visible = true;
    if (fromHouse && Math.random() < 0.5) this.startManeuver('loop');
  }

  newWaypoint(depth) {
    screenPoint(rand(-0.85, 0.85), rand(-0.55, 0.7), depth ?? rand(10, 28), this.wp);
  }

  leave() {
    if (this.state !== 'fly') return;
    this.state = 'leave';
    const side = this.pos.x < 0 ? -1 : 1;
    screenPoint(side * 1.8, rand(0, 0.9), rand(12, 26), this.wp);
  }

  startManeuver(kind) {
    if (this.man || !this.hittable) return false;
    this.man = kind;
    if (kind === 'loop') {
      this.manT = this.manDur = rand(0.9, 1.3);
      this.axis.crossVectors(this.fwd, WORLD_UP).normalize();
      if (this.axis.lengthSq() < 0.1) this.axis.set(1, 0, 0);
    } else if (kind === 'roll') {
      this.manT = this.manDur = rand(0.45, 0.7);
      this.rollDir = Math.random() < 0.5 ? -1 : 1;
    } else if (kind === 'zigzag') {
      this.manT = this.manDur = rand(1, 1.6);
    } else if (kind === 'dash') {
      this.manT = this.manDur = 0.7;
      this.newWaypoint();
    }
    sfx.squeak(clamp(toScreen(this.pos).nx, -1, 1) * 0.6);
    return true;
  }

  kill(dir) {
    this.state = 'dying';
    this.dieT = 0;
    this.vel.copy(dir).multiplyScalar(7).add(tmpV2.set(rand(-3, 3), rand(5, 8), 0));
    this.spinAxis = new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    this.man = null;
  }

  update(dt, t) {
    if (this.state === 'dead') return;
    this.mixer.update(dt * (this.state === 'dying' ? 3 : 1));

    if (this.state === 'dying') {
      this.dieT += dt;
      this.vel.y -= 20 * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.root.rotateOnWorldAxis(this.spinAxis, 16 * dt);
      const s = Math.max(0.001, 1 - this.dieT / 0.65) * this.size;
      this.root.scale.setScalar(s);
      if (this.dieT > 0.65) this.despawn();
      return;
    }

    const speed = this.baseSpeed * settings.batSpeed * (this.man === 'dash' ? 2.2 : 1);
    this.scale = Math.min(1, this.scale + dt * 1.8);

    if (this.man === 'loop') {
      this.vel.applyAxisAngle(this.axis, (Math.PI * 2 / this.manDur) * dt);
    } else {
      tmpV.subVectors(this.wp, this.pos);
      const dist = tmpV.length();
      if (dist < 1.8) {
        if (this.state === 'leave') return this.despawn();
        this.newWaypoint();
      }
      tmpV.setLength(speed);
      this.vel.lerp(tmpV, 1 - Math.exp(-this.agility * dt));
    }
    this.vel.setLength(THREE.MathUtils.lerp(this.vel.length(), speed, 1 - Math.exp(-3 * dt)));
    this.pos.addScaledVector(this.vel, dt);
    this.pos.y += Math.sin(t * this.bobF + this.bobP) * 1.2 * dt;
    if (this.man === 'zigzag') {
      tmpV.crossVectors(this.fwd, WORLD_UP).normalize();
      this.pos.addScaledVector(tmpV, Math.cos(t * 12) * 7 * dt);
    }
    if (this.pos.y < 1.2) { this.pos.y = 1.2; this.vel.y = Math.abs(this.vel.y); }

    // maneuvers
    if (this.man) {
      this.manT -= dt;
      if (this.man === 'roll') this.roll = this.rollDir * Math.PI * 2 * (1 - Math.max(0, this.manT) / this.manDur);
      if (this.manT <= 0) { this.man = null; this.roll = 0; this.nextMan = rand(2.5, 7); }
    } else if (this.state === 'fly') {
      this.nextMan -= dt;
      if (this.nextMan <= 0) this.startManeuver(pick(['loop', 'loop', 'roll', 'zigzag', 'dash']));
    }

    // orientation: face velocity, bank into turns
    tmpV2.copy(this.vel).normalize();
    const yawRate = tmpV.crossVectors(this.fwd, tmpV2).y / Math.max(dt, 1e-3);
    this.fwd.copy(tmpV2);
    this.bank = THREE.MathUtils.lerp(this.bank, clamp(-yawRate * 0.5, -1, 1), 1 - Math.exp(-6 * dt));
    if (this.man === 'loop') this.up.crossVectors(this.axis, this.fwd).normalize();
    else this.up.copy(WORLD_UP);
    this.up.applyAxisAngle(this.fwd, this.bank + this.roll);
    tmpM.lookAt(this.fwd, tmpV.set(0, 0, 0), this.up);
    this.root.quaternion.setFromRotationMatrix(tmpM);
    this.root.scale.setScalar(this.scale * this.size);

    if (this.state === 'leave') {
      const s = toScreen(this.pos);
      if (Math.abs(s.nx) > 1.3 || s.behind) this.despawn();
    }
  }

  despawn() {
    this.state = 'dead';
    this.root.visible = false;
    if (this.bubble) this.bubble.release();
  }
}

// population control: random number of bats that changes over time
let targetBats = 8;
let rerollIn = 0;
let spawnIn = 0;
function updatePopulation(dt) {
  rerollIn -= dt;
  if (rerollIn <= 0) {
    targetBats = randInt(settings.batMin, Math.max(settings.batMin, settings.batMax));
    rerollIn = rand(6, 12);
  }
  spawnIn -= dt;
  if (spawnIn > 0) return;
  spawnIn = rand(0.25, 0.7);
  const flying = bats.filter(b => b.state === 'fly');
  if (flying.length < targetBats) {
    let b = bats.find(x => x.state === 'dead');
    if (!b && bats.length < 40) { b = new Bat(); bats.push(b); }
    if (b) b.spawn();
  } else if (flying.length > targetBats) {
    pick(flying).leave();
  }
}

// ============================================================ effects
const effects = [];
function addEffect(e) { effects.push(e); return e; }

function sparkBurst(pos, colors, { count = 70, speed = [6, 14], life = 0.9, size = 0.45, gravity = -9, drag = 1.6 } = {}) {
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(count * 3), c = new Float32Array(count * 3), v = new Float32Array(count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    p.set([pos.x, pos.y, pos.z], i * 3);
    tmpV.randomDirection().multiplyScalar(rand(speed[0], speed[1]));
    v.set([tmpV.x, tmpV.y, tmpV.z], i * 3);
    col.set(pick(colors));
    c.set([col.r, col.g, col.b], i * 3);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const mat = new THREE.PointsMaterial({ size, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  let tt = 0;
  return addEffect({
    update(dt) {
      tt += dt;
      const k = Math.exp(-drag * dt);
      for (let i = 0; i < count; i++) {
        const j = i * 3;
        v[j] *= k; v[j + 1] = v[j + 1] * k + gravity * dt; v[j + 2] *= k;
        p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = Math.max(0, 1 - tt / life);
      mat.size = size * (1 - 0.5 * tt / life);
      return tt < life;
    },
    dispose() { scene.remove(pts); geo.dispose(); mat.dispose(); },
  });
}

function spriteFx(pos, { color = 0xffffff, from = 0.5, to = 5, life = 0.3, opacity = 1, additive = true, map = glowTex, rise = 0, spin = 0 }) {
  const mat = new THREE.SpriteMaterial({ map, color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const s = new THREE.Sprite(mat);
  s.position.copy(pos);
  s.scale.setScalar(from);
  scene.add(s);
  let tt = 0;
  return addEffect({
    update(dt) {
      tt += dt;
      const k = Math.min(1, tt / life);
      const e = 1 - Math.pow(1 - k, 3);
      s.scale.setScalar(from + (to - from) * e);
      s.position.y += rise * dt;
      mat.rotation += spin * dt;
      mat.opacity = opacity * (1 - k);
      return tt < life;
    },
    dispose() { scene.remove(s); mat.dispose(); },
  });
}

function ringFx(pos, color, to = 7, life = 0.45) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const m = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), mat);
  m.position.copy(pos);
  m.lookAt(camera.position);
  scene.add(m);
  let tt = 0;
  return addEffect({
    update(dt) {
      tt += dt;
      const k = tt / life;
      m.scale.setScalar(0.2 + to * (1 - Math.pow(1 - k, 2)));
      mat.opacity = 0.9 * (1 - k);
      return tt < life;
    },
    dispose() { scene.remove(m); m.geometry.dispose(); mat.dispose(); },
  });
}

let shake = 0;
function explosion(pos, color, golden) {
  const c = new THREE.Color(color);
  const palette = golden ? ['#fff3b0', '#ffd23b', '#ffae00', '#ffffff'] : [color, '#ffffff', '#ffb347', '#ff5e1a', '#c77dff'];
  sparkBurst(pos, palette, { count: golden ? 140 : 80, speed: [7, golden ? 20 : 15], life: 0.9 });
  sparkBurst(pos, ['#ff8a1f', '#ffd23b', '#b14dff'], { count: 36, speed: [1.5, 5], life: 1.6, size: 0.3, gravity: 2, drag: 1 });
  spriteFx(pos, { color: 0xffffff, from: 0.5, to: golden ? 7 : 5, life: 0.25 });
  spriteFx(pos, { color: c, from: 1, to: golden ? 9 : 6, life: 0.45, opacity: 0.8 });
  ringFx(pos, c, golden ? 5 : 3.5, 0.35);
  for (let i = 0; i < 4; i++) {
    spriteFx(tmpV2.copy(pos).add(tmpV.randomDirection().multiplyScalar(0.6)), {
      color: 0x4a2a66, from: 1.5, to: rand(4, 6), life: rand(1, 1.5), opacity: 0.55, additive: false, map: smokeTex, rise: 1.4, spin: rand(-1, 1),
    });
  }
  boomLight.position.copy(pos);
  boomLight.color.set(golden ? 0xffd23b : color);
  boomLight.intensity = golden ? 900 : 500;
  shake = Math.max(shake, golden ? 0.45 : 0.25);
  const flash = $('#fx-flash');
  flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on');
}

function missPuff(pos, color) {
  sparkBurst(pos, [color, '#ffffff', '#9a8aaa'], { count: 14, speed: [2, 5], life: 0.45, size: 0.3, gravity: -4 });
  spriteFx(pos, { color: 0x8a7a9a, from: 0.3, to: 2.2, life: 0.5, opacity: 0.6, additive: false, map: smokeTex });
}

// ---- lightning bolt: camera-facing ribbons along a jagged path, re-jittered to flicker
function boltPath(a, b, segs, jitter) {
  const pts = [];
  const dir = tmpV.subVectors(b, a);
  const len = dir.length();
  const side1 = new V3().crossVectors(dir, WORLD_UP).normalize();
  if (side1.lengthSq() < 0.01) side1.set(1, 0, 0);
  const side2 = new V3().crossVectors(dir, side1).normalize();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const env = Math.sin(Math.PI * t) * jitter * len;
    pts.push(new V3().lerpVectors(a, b, t)
      .addScaledVector(side1, (Math.random() - 0.5) * env)
      .addScaledVector(side2, (Math.random() - 0.5) * env));
  }
  return pts;
}
function makeRibbon(n, color, opacity) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
  const idx = [];
  for (let i = 0; i < n - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}
function setRibbon(mesh, pts, width) {
  const pos = mesh.geometry.attributes.position;
  const view = new V3(), tan = new V3(), side = new V3();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    tan.subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
    view.subVectors(camera.position, p);
    const dist = view.length(); // width is per unit of distance -> constant thickness on screen
    view.divideScalar(dist);
    side.crossVectors(tan, view).normalize().multiplyScalar(width * dist * (i === 0 || i === pts.length - 1 ? 0.4 : 1));
    pos.setXYZ(i * 2, p.x - side.x, p.y - side.y, p.z - side.z);
    pos.setXYZ(i * 2 + 1, p.x + side.x, p.y + side.y, p.z + side.z);
  }
  pos.needsUpdate = true;
}
function lightning(from, to, color) {
  const a = from.clone(), b = to.clone();
  const SEG = 18, FSEG = 7;
  const group = new THREE.Group();
  const glow = makeRibbon(SEG + 1, color, 0.55);
  const core = makeRibbon(SEG + 1, 0xffffff, 1);
  const forks = [0, 1].map(() => ({ glow: makeRibbon(FSEG + 1, color, 0.4), core: makeRibbon(FSEG + 1, 0xffffff, 0.8) }));
  group.add(glow, core);
  forks.forEach(f => group.add(f.glow, f.core));
  scene.add(group);
  const regen = () => {
    const main = boltPath(a, b, SEG, 0.12);
    setRibbon(glow, main, 0.01);
    setRibbon(core, main, 0.003);
    for (const f of forks) {
      const s = main[4 + Math.floor(Math.random() * (SEG - 8))];
      const end = s.clone().add(tmpV2.randomDirection().multiplyScalar(a.distanceTo(b) * rand(0.08, 0.16)));
      const fp = boltPath(s, end, FSEG, 0.3);
      setRibbon(f.glow, fp, 0.006);
      setRibbon(f.core, fp, 0.002);
    }
  };
  regen();
  spriteFx(a, { color, from: 0.4, to: 2.4, life: 0.25 });
  spriteFx(b, { color: 0xffffff, from: 0.5, to: 3, life: 0.2 });
  boomLight.position.copy(a);
  boomLight.color.set(color);
  boomLight.intensity = Math.max(boomLight.intensity, 400);
  let tt = 0, next = 0;
  const LIFE = 0.32;
  addEffect({
    update(dt) {
      tt += dt;
      if (tt > next) { regen(); next = tt + 0.045; }
      const k = 1 - tt / LIFE;
      group.traverse(o => { if (o.material) o.material.opacity = Math.max(0, k) * (o.material.color.getHex() === 0xffffff ? 1 : 0.55); });
      return tt < LIFE;
    },
    dispose() {
      scene.remove(group);
      group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    },
  });
}

// ---- per-player sword that mirrors the phone's orientation
const SWORD_DEPTH = 4.6;
const swordFwd = new V3();
function screenAt(nx, ny, depth, out) {
  out.set(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
  camera.getWorldDirection(swordFwd);
  return out.multiplyScalar(depth / out.dot(swordFwd)).add(camera.position);
}
function createSword(p) {
  if (!swordTemplate || p.sword) return;
  const root = new THREE.Group();
  const model = swordTemplate.clone(true);
  const col = new THREE.Color(p.data.color);
  model.traverse(o => {
    if (o.isMesh) {
      const m = o.material = o.material.clone();
      // gem repainted in the player's colour; only the gem glows (mask as emissive map)
      const map = gemMapFor(p.data.color);
      if (map) m.map = map;
      if (m.emissive) {
        m.emissiveMap = gemInfo ? gemInfo.maskTex : null;
        m.emissive.copy(col);
        m.emissiveIntensity = 2.2;
      }
    }
  });
  root.add(model);
  const tip = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  tip.position.y = swordTipY;
  tip.scale.setScalar(1.3);
  root.add(tip);
  root.visible = false;
  scene.add(root);
  const mixer = swordClip ? new THREE.AnimationMixer(model) : null;
  if (mixer) mixer.clipAction(swordClip).play();
  p.sword = { root, model, tip, mixer, q: new THREE.Quaternion(), target: new THREE.Quaternion(), charge: 0 };
  p.sword.q.setFromEuler(new THREE.Euler(-0.3, 0, 0));
}
function disposeSword(p) {
  if (!p.sword) return;
  scene.remove(p.sword.root);
  p.sword.root.traverse(o => { if (o.material) o.material.dispose(); });
  p.sword = null;
}
const swordTmpQ = new THREE.Quaternion();
const aimPoint = new V3();
function updateSwords(dt) {
  const now = performance.now();
  for (const p of players.values()) {
    if (!p.sword) createSword(p);
    const s = p.sword;
    if (!s) continue;
    const show = swordMode() && ['ready', 'countdown', 'playing'].includes(p.data.state);
    s.root.visible = show;
    if (!show) continue;
    if (s.mixer) s.mixer.update(dt);

    // hilt sits just above the player's score card
    const r = p.card.getBoundingClientRect();
    const nx = ((r.left + r.width / 2) / innerWidth) * 2 - 1;
    const ny = -(((r.top - innerHeight * 0.02) / innerHeight) * 2 - 1);
    screenAt(nx, ny, SWORD_DEPTH, s.root.position);

    if (p.q && now - p.qAt < 600) {
      s.target.set(p.q[0], p.q[1], p.q[2], p.q[3]).normalize();
    } else {
      // no orientation stream (touch mode): point the blade at the crosshair
      screenAt(p.smooth.x, p.smooth.y, 30, aimPoint);
      tmpV.subVectors(aimPoint, s.root.position).normalize();
      s.target.setFromUnitVectors(WORLD_UP, tmpV);
    }
    s.q.slerp(s.target, 1 - Math.exp(-22 * dt));
    s.root.quaternion.copy(s.q);

    s.charge = Math.max(0, s.charge - dt * 3);
    s.tip.material.opacity = 0.32 + 0.12 * Math.sin(now / 90) + s.charge;
    s.tip.scale.setScalar(1.5 + 0.2 * Math.sin(now / 140) + s.charge * 2.5);
    s.model.traverse(o => { if (o.isMesh && o.material.emissive) o.material.emissiveIntensity = 0.75 + 0.25 * Math.sin(now / 160) + s.charge * 3; });
  }
}
function swordTip(p, out) {
  return p.sword.root.localToWorld(out.set(0, swordTipY, 0));
}

// ============================================================ HTML overlays
const bubbleLayer = $('#bubbles');
const bubbles = new Set();
function say(bat, text, { dur = 2.2, cls = '', anchor = null } = {}) {
  if (!settings.tauntsEnabled && cls !== 'ouch') return;
  if (bat && bat.bubble) bat.bubble.release(true);
  const el = document.createElement('div');
  el.className = `bubble ${cls}`;
  el.textContent = text;
  bubbleLayer.appendChild(el);
  const b = {
    el, bat, anchor: anchor ? anchor.clone() : null, until: performance.now() + dur * 1000,
    release(now) {
      if (!bubbles.has(b)) return;
      bubbles.delete(b);
      if (b.bat && b.bat.bubble === b) b.bat.bubble = null;
      if (now) el.remove();
      else { el.classList.add('out'); setTimeout(() => el.remove(), 260); }
    },
  };
  if (bat) bat.bubble = b;
  bubbles.add(b);
  return b;
}
const scr = { x: 0, y: 0 };
function updateBubbles() {
  const now = performance.now();
  for (const b of bubbles) {
    if (now > b.until) { b.release(); continue; }
    const src = b.anchor || b.bat.pos;
    toScreen(tmpV2.copy(src).add(tmpV.set(0, 1.5 * (b.bat ? b.bat.size : 1), 0)), scr);
    b.el.style.display = scr.behind ? 'none' : '';
    b.el.style.transform = `translate(${scr.x}px, ${scr.y}px) translate(-50%, -100%)`;
  }
}
let tauntIn = 2;
let laughCooldown = 0;
function updateTaunts(dt) {
  tauntIn -= dt;
  laughCooldown -= dt;
  if (tauntIn > 0) return;
  tauntIn = rand(1.6, 3.6);
  if (bubbles.size >= 3) return;
  const cands = bats.filter(b => b.state === 'fly' && !b.bubble && b.pos.distanceTo(camera.position) < 26 && Math.abs(toScreen(b.pos).nx) < 0.8);
  if (!cands.length) return;
  const b = pick(cands);
  const anyone = [...players.values()].some(p => p.data.state === 'playing');
  say(b, pick(anyone ? TAUNTS_IDLE : (players.size ? TAUNTS_IDLE : TAUNTS_LOBBY)));
  if (Math.random() < 0.5) b.startManeuver(pick(['loop', 'roll']));
  if (laughCooldown <= 0) { sfx.laugh(clamp(toScreen(b.pos).nx, -1, 1) * 0.6); laughCooldown = 4; }
}

function popup(x, y, html, color, cls = '') {
  const el = document.createElement('div');
  el.className = `popup ${cls}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.setProperty('--c', color);
  el.innerHTML = html;
  $('#popups').appendChild(el);
  setTimeout(() => el.remove(), 1150);
}

function banner(html, { color = 'var(--accent)', cls = '', dur = 2600 } = {}) {
  const el = document.createElement('div');
  el.className = `banner ${cls}`;
  el.style.setProperty('--c', color);
  el.innerHTML = html;
  const box = $('#banners');
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 420); }, dur);
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ============================================================ players
/** pid -> { data, card, xhair, aim, smooth, end, cdEnd, lastAim } */
const players = new Map();

const XHAIR_SVG = `<svg viewBox="-50 -50 100 100">
  <circle r="30"/><circle r="4" class="center"/>
  <line x1="0" y1="-46" x2="0" y2="-18"/><line x1="0" y1="18" x2="0" y2="46"/>
  <line x1="-46" y1="0" x2="-18" y2="0"/><line x1="18" y1="0" x2="46" y2="0"/>
  <g class="hitmark"><line x1="-22" y1="-22" x2="-10" y2="-10"/><line x1="22" y1="-22" x2="10" y2="-10"/><line x1="-22" y1="22" x2="-10" y2="10"/><line x1="22" y1="22" x2="10" y2="10"/></g>
</svg>`;

function ensurePlayer(d) {
  let p = players.get(d.pid);
  if (!p) {
    const card = document.createElement('div');
    card.className = 'pcard';
    card.innerHTML = `<div class="pcombo"></div>
      <div class="top"><span class="dot"></span><span class="pname"></span></div>
      <div class="row"><span class="pscore">0</span><span class="ptime"></span></div>
      <div class="pstatus"></div>
      <div class="pbar"><i></i></div>`;
    const xh = document.createElement('div');
    xh.className = 'xhair idle';
    xh.innerHTML = `${XHAIR_SVG}<span></span>`;
    xh.style.opacity = '0';
    $('#crosshairs').appendChild(xh);
    p = { data: d, card, xhair: xh, aim: { x: 0, y: 0 }, smooth: { x: 0, y: 0 }, end: 0, cdEnd: 0, lastAim: 0, lastCd: -1, lastSec: -1 };
    players.set(d.pid, p);
    insertCard(p);
  }
  applyPlayer(p, d);
  return p;
}

function insertCard(p) {
  const box = $('#players');
  const after = [...box.children].find(c => !c.classList.contains('leaving') && +c.dataset.slot > p.data.slot);
  p.card.dataset.slot = p.data.slot;
  box.insertBefore(p.card, after || null);
}

function applyPlayer(p, d) {
  const prevState = p.data.state;
  p.data = d;
  const { card, xhair } = p;
  card.style.setProperty('--c', d.color);
  xhair.style.setProperty('--c', d.color);
  card.querySelector('.pname').textContent = d.name;
  xhair.querySelector('span').textContent = d.name;
  card.querySelector('.pscore').textContent = d.score;
  card.classList.toggle('offline', !d.connected && d.state !== 'playing');
  card.classList.toggle('waiting', d.state === 'ready');
  card.classList.toggle('done', d.state === 'done');
  const now = performance.now();
  if (d.state === 'playing') p.end = now + d.remaining;
  if (d.state === 'countdown') p.cdEnd = now + d.remaining;
  if (prevState !== d.state) {
    if (d.state === 'countdown') showCountdown(p);
    if (d.state !== 'countdown') hideCountdown(p);
  }
  renderCardStatus(p);
}

function renderCardStatus(p) {
  const d = p.data;
  const status = p.card.querySelector('.pstatus');
  const time = p.card.querySelector('.ptime');
  const bar = p.card.querySelector('.pbar i');
  const now = performance.now();
  let txt = '', tm = '', frac = 1, hurry = false;
  if (d.state === 'ready') { txt = 'Tekan START di HP'; frac = 1; }
  else if (d.state === 'countdown') { txt = 'Bersiap...'; }
  else if (d.state === 'playing') {
    const left = Math.max(0, p.end - now);
    const sec = Math.ceil(left / 1000);
    tm = `${sec}`;
    frac = left / (settings.gameDuration * 1000 || 30000);
    hurry = sec <= 5;
    txt = `${d.hits} kena · ${d.shots ? Math.round(d.hits / d.shots * 100) : 0}% akurasi`;
    if (hurry && sec !== p.lastSec && sec > 0) sfx.tick();
    p.lastSec = sec;
  } else if (d.state === 'done') {
    txt = d.result ? `Selesai! Peringkat #${d.result.rank}` : 'Selesai!';
    frac = 0;
  }
  if (status.textContent !== txt) status.textContent = txt;
  if (time.textContent !== tm) time.textContent = tm;
  bar.style.transform = `scaleX(${clamp(frac, 0, 1)})`;
  p.card.classList.toggle('hurry', hurry);
  if (d.state !== 'playing') p.card.querySelector('.pcombo').classList.remove('on');
}

function removePlayer(pid) {
  const p = players.get(pid);
  if (!p) return;
  players.delete(pid);
  disposeSword(p);
  hideCountdown(p);
  p.card.classList.add('leaving');
  p.xhair.style.opacity = '0';
  setTimeout(() => { p.card.remove(); p.xhair.remove(); }, 450);
  updateIdleHint();
}

function updateIdleHint() {
  $('#idle-hint').classList.toggle('hide', players.size > 0);
}

// ---- countdown overlays
function showCountdown(p) {
  if (p.cdEl) return;
  const el = document.createElement('div');
  el.className = 'cd';
  el.style.setProperty('--c', p.data.color);
  el.innerHTML = `<span class="num"></span><span class="who"></span>`;
  el.querySelector('.who').textContent = p.data.name;
  $('#countdowns').appendChild(el);
  p.cdEl = el;
  p.lastCd = -1;
}
function hideCountdown(p, go = false) {
  if (!p.cdEl) return;
  const el = p.cdEl;
  p.cdEl = null;
  if (go) {
    el.classList.add('go');
    const n = el.querySelector('.num');
    n.textContent = 'GO!';
    n.classList.remove('tick'); void n.offsetWidth; n.classList.add('tick');
    setTimeout(() => el.remove(), 800);
  } else el.remove();
}
function updateCountdowns() {
  const now = performance.now();
  for (const p of players.values()) {
    if (!p.cdEl) continue;
    const n = Math.ceil(Math.max(0, p.cdEnd - now) / 1000);
    if (n !== p.lastCd && n > 0) {
      p.lastCd = n;
      const num = p.cdEl.querySelector('.num');
      num.textContent = n;
      num.classList.remove('tick'); void num.offsetWidth; num.classList.add('tick');
      sfx.beep();
    }
  }
}

// ---- crosshairs
function updateCrosshairs(dt) {
  const now = performance.now();
  const k = 1 - Math.exp(-20 * dt);
  for (const p of players.values()) {
    const live = now - p.lastAim < 2500 && (p.data.state !== 'done');
    p.smooth.x += (p.aim.x - p.smooth.x) * k;
    p.smooth.y += (p.aim.y - p.smooth.y) * k;
    const x = (p.smooth.x + 1) / 2 * innerWidth;
    const y = (1 - p.smooth.y) / 2 * innerHeight;
    p.xhair.style.transform = `translate(${x}px, ${y}px)`;
    p.xhair.style.opacity = live ? '1' : '0';
    p.xhair.classList.toggle('idle', p.data.state !== 'playing');
  }
}
function retrigger(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

// ============================================================ shooting
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function judgeShot(p, x, y) {
  ndc.set(x, y);
  raycaster.setFromCamera(ndc, camera);
  const { origin, direction } = raycaster.ray;
  let best = null, bestT = Infinity;
  for (const b of bats) {
    if (!b.hittable) continue;
    tmpV.subVectors(b.pos, origin);
    const t = tmpV.dot(direction);
    if (t < 0) continue;
    const d2 = tmpV.lengthSq() - t * t;
    const r = BAT_RADIUS * b.size * b.scale * (1 + t * 0.025); // more forgiving for distant bats
    if (d2 < r * r && t < bestT) { best = b; bestT = t; }
  }
  const pan = clamp(x, -1, 1) * 0.6;
  if (best) {
    const where = best.pos.clone();
    const golden = best.golden;
    if (best.bubble) best.bubble.release(true);
    best.kill(direction);
    explosion(where, p.data.color, golden);
    sfx.explode(pan, golden);
    if (golden) sfx.golden(pan);
    if (Math.random() < 0.7) say(null, pick(TAUNTS_OUCH), { dur: 1.2, cls: 'ouch', anchor: where });
    retrigger(p.xhair, 'hit');
    const s = toScreen(where);
    return { hit: true, golden, sx: s.nx, sy: s.ny, point: where };
  }
  // miss: a puff in the distance + nearest bat mocks the shooter
  const missAt = origin.clone().addScaledVector(direction, 22);
  missPuff(missAt, p.data.color);
  sfx.miss(pan);
  let near = null, nd = 0.45;
  for (const b of bats) {
    if (b.state !== 'fly') continue;
    const s = toScreen(b.pos);
    const d = Math.hypot(s.nx - x, s.ny - y);
    if (d < nd) { nd = d; near = b; }
  }
  if (near) {
    near.startManeuver(pick(['loop', 'roll', 'zigzag']));
    if (Math.random() < 0.6) say(near, pick(TAUNTS_MISS), { dur: 1.6 });
  }
  return { hit: false, point: missAt };
}

// ============================================================ socket
const socket = io({ query: { role: 'display' } });
const net = $('#net-status');
socket.on('connect', () => { net.hidden = true; });
socket.on('disconnect', () => { net.hidden = false; });
socket.on('leader', m => { isLeader = !!m.leader; });

function applySettings(s) {
  if (!s) return;
  settings = { ...settings, ...s };
  setSfxVolume(settings.sfxVolume);
  bgm.volume = clamp(settings.bgmVolume, 0, 1);
}

let lastLeaderboard = [];
function renderLeaderboard(rows, freshName) {
  lastLeaderboard = rows;
  const ol = $('#lb');
  ol.innerHTML = rows.map(r => `<li data-name="${esc(r.name)}"><span class="n">${esc(r.name)}</span><span class="s">${r.score}</span></li>`).join('');
  $('#lb-empty').style.display = rows.length ? 'none' : '';
  if (freshName) {
    for (const li of ol.children) if (li.dataset.name === freshName) { li.classList.add('fresh'); break; }
  }
}

socket.on('lobby', L => {
  applySettings(L.settings);
  $('#qr').src = L.qr;
  $('#join-url').textContent = L.joinUrl;
  const qi = $('#queue-info');
  qi.innerHTML = L.queue ? `Antrean: <b>${L.queue}</b> pemain${L.queueNames.length ? `<br><small>Berikutnya: ${esc(L.queueNames[0])}</small>` : ''}` : '';
  if (JSON.stringify(L.leaderboard) !== JSON.stringify(lastLeaderboard)) renderLeaderboard(L.leaderboard);
  const seen = new Set();
  for (const d of L.active) { seen.add(d.pid); ensurePlayer(d); }
  for (const pid of [...players.keys()]) if (!seen.has(pid)) removePlayer(pid);
  updateIdleHint();
});
socket.on('settings', applySettings);
socket.on('leaderboard', rows => renderLeaderboard(rows, lastDoneName));

socket.on('player-join', d => {
  ensurePlayer(d);
  updateIdleHint();
  banner(`${esc(d.name)} bergabung!<small>Arahkan HP ke layar &amp; tekan START</small>`, { color: d.color });
  sfx.join();
  // a bat welcomes the newcomer
  const b = bats.find(x => x.state === 'fly' && !x.bubble);
  if (b) say(b, pick([`Halo ${d.name}, siap kalah?`, `${d.name}? Gak takut!`, `Wah ada ${d.name}, cupu nih`, `Sini ${d.name}, tangkap aku!`]), { dur: 3 });
});
socket.on('player-countdown', d => ensurePlayer(d));
socket.on('player-start', d => {
  const p = ensurePlayer(d);
  hideCountdown(p, true);
  sfx.go();
});
let lastDoneName = null;
socket.on('player-done', d => {
  const p = ensurePlayer(d);
  lastDoneName = d.name;
  const r = d.result || { score: d.score, rank: '-' };
  if (r.topScore) {
    banner(`REKOR BARU! ${esc(d.name)}<small>${r.score} poin · peringkat #1</small>`, { cls: 'record', dur: 4200 });
    sfx.fanfare();
  } else {
    banner(`${esc(d.name)}: ${r.score} poin<small>Peringkat #${r.rank} · akurasi ${r.accuracy ?? 0}%</small>`, { color: d.color, dur: 3400 });
    sfx.gameOver();
  }
  p.xhair.style.opacity = '0';
});
socket.on('player-leave', ({ pid }) => removePlayer(pid));

socket.on('aim', ({ pid, x, y, q }) => {
  const p = players.get(pid);
  if (!p) return;
  p.aim.x = x; p.aim.y = y;
  if (q) { p.q = q; p.qAt = performance.now(); }
  if (performance.now() - p.lastAim > 2500) { p.smooth.x = x; p.smooth.y = y; }
  p.lastAim = performance.now();
});

socket.on('fire', ({ pid, x, y }) => {
  const p = players.get(pid);
  if (!p || !batTemplate) return;
  p.aim.x = x; p.aim.y = y;
  p.lastAim = performance.now();
  retrigger(p.xhair, 'fire');
  const sword = swordMode() && p.sword && p.sword.root.visible;
  if (sword) sfx.zap(clamp(x, -1, 1) * 0.6);
  else sfx.shoot(clamp(x, -1, 1) * 0.6);
  const { point, ...res } = judgeShot(p, x, y);
  if (sword) {
    p.sword.charge = 0.6;
    lightning(swordTip(p, new V3()), point, p.data.color);
  }
  if (isLeader) socket.emit('shot-result', { pid, ...res });
});

socket.on('score', ({ pid, points, total, streak, golden, sx, sy }) => {
  const p = players.get(pid);
  if (!p) return;
  p.data.score = total;
  p.data.shots = p.data.shots + 1;
  if (points > 0) p.data.hits++;
  const sc = p.card.querySelector('.pscore');
  sc.textContent = total;
  const combo = p.card.querySelector('.pcombo');
  if (streak >= 2) { combo.textContent = `Combo x${streak}`; retrigger(combo, 'on'); }
  else combo.classList.remove('on');
  if (points > 0) {
    retrigger(sc, 'bump');
    sfx.hit(streak, clamp(sx ?? 0, -1, 1) * 0.6);
    const x = ((sx ?? 0) + 1) / 2 * innerWidth, y = (1 - (sy ?? 0)) / 2 * innerHeight;
    const extra = golden ? '<small>BAT EMAS x3!</small>' : streak >= 2 ? `<small>COMBO x${streak}</small>` : '';
    popup(x, y, `+${points}${extra}`, p.data.color, golden ? 'gold' : '');
  }
});

// ============================================================ audio
const bgm = new Audio('/music/loop.mp3');
bgm.loop = true;
bgm.volume = settings.bgmVolume;
bgm.preload = 'auto';

function startAudio() {
  unlockAudio();
  setSfxVolume(settings.sfxVolume);
  return bgm.play();
}
const gate = $('#audio-gate');
gate.addEventListener('click', () => {
  startAudio().catch(() => {});
  gate.hidden = true;
});
addEventListener('keydown', e => {
  if (e.key === 'f' || e.key === 'F') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  if (e.key === 'm' || e.key === 'M') bgm.muted = !bgm.muted;
});

// ============================================================ loop
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // environment sway + camera shake
  envPivot.rotation.y = Math.sin(t * 0.12) * THREE.MathUtils.degToRad(settings.envRotate);
  pumpkinLight.intensity = 220 + Math.sin(t * 9) * 30 + Math.sin(t * 23) * 25;
  boomLight.intensity *= Math.exp(-10 * dt);
  shake *= Math.exp(-6 * dt);
  camera.position.copy(CAM_POS);
  camera.quaternion.copy(baseCamQuat);
  camera.position.x += Math.sin(t * 0.21) * 0.4;
  camera.position.y += Math.sin(t * 0.17) * 0.25;
  camera.updateMatrixWorld();

  for (let i = 0; i < EMBERS; i++) {
    const j = i * 3, s = emberSeed[i];
    emberPos[j] += Math.sin(t * 0.5 + s) * 0.01;
    emberPos[j + 1] += 0.012 + Math.sin(t + s) * 0.006;
    if (emberPos[j + 1] > 20) emberPos[j + 1] = 0.5;
  }
  emberGeo.attributes.position.needsUpdate = true;

  if (batTemplate) {
    updatePopulation(dt);
    for (const b of bats) b.update(dt, t);
    updateTaunts(dt);
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    if (!effects[i].update(dt)) { effects[i].dispose(); effects.splice(i, 1); }
  }

  updateBubbles();
  updateCrosshairs(dt);
  updateSwords(dt);
  updateCountdowns();
  for (const p of players.values()) renderCardStatus(p);

  if (shake > 0.002) {
    camera.position.x += rand(-shake, shake);
    camera.position.y += rand(-shake, shake);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

loadAssets()
  .then(() => {
    $('#load-bar').style.width = '100%';
    $('#loading').classList.add('done');
    setTimeout(() => $('#loading').remove(), 700);
    // try to autoplay; browsers usually require a click first
    startAudio().then(() => { gate.hidden = true; }).catch(() => { gate.hidden = false; });
  })
  .catch(err => {
    console.error(err);
    $('#load-text').textContent = `Gagal memuat aset: ${err.message || err}`;
  });
requestAnimationFrame(frame);

// debug hook for local testing in the browser console
window.__ms = { bats, camera, scene, judgeShot, players, explosion };

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GAME_CONFIG, LocalGameService, WAR_RULES } from './game-service.js';
import { BUILDING_ASSETS, getBuildingAsset } from './building-assets.js';
import { buildingScaffoldState, reconcileBuildingSnapshot } from './game-runtime-state.js';
import { runServiceTests } from './service-tests.js';

// ---------- Versioned local game-service boundary ----------
const service = new LocalGameService();
const DEFS = {
  hq: { name: 'Command Hall', pos: [0, 0] },
  workshop: { name: 'Workshop / Forge', pos: [-9, 4] },
  tower: { name: 'Watchtower', pos: [8, 6] },
  comms: { name: 'Communications', pos: [6, -8] },
};
const PREVIEW_SERVICE_CHECKS = runServiceTests();
console.info(`DZN local service checks passed (${PREVIEW_SERVICE_CHECKS.passed}).`);
const state = new Proxy({}, {
  get(_target, key) {
    const entry = service.community();
    const member = service.member();
    if (key === 'levels') return entry?.saved.base.levels;
    if (key === 'treasury') return entry?.saved.base.treasury ?? 0;
    if (key === 'upgrades') return Object.fromEntries((entry?.saved.base.legacyJobs || []).map(job => [job.key, job]));
    if (key === 'raidCount') return entry?.saved.base.raidCount ?? 0;
    if (key === 'lastRaidClaimed') return entry?.saved.base.lastRaidClaimed ?? 0;
    if (key === 'parts' || key === 'stored' || key === 'salvage' || key === 'timber' || key === 'muted') return member?.[key] ?? 0;
    return undefined;
  },
  set(_target, key, value) {
    const entry = service.community();
    if (key === 'parts' || key === 'stored' || key === 'salvage' || key === 'muted') {
      service.setMemberValue(service.state.currentIdentityId, key, value);
      return true;
    }
    if (key === 'treasury' && entry) entry.saved.base.treasury = Math.max(0, Math.floor(Number(value) || 0));
    else if (key === 'raidCount' && entry) entry.saved.base.raidCount = Math.max(0, Math.floor(Number(value) || 0));
    else if (key === 'lastRaidClaimed' && entry) entry.saved.base.lastRaidClaimed = Math.max(0, Math.floor(Number(value) || 0));
    service.save();
    return true;
  },
});
function save() { service.save(); }

// ---------- Audio ----------
const music = new Audio('assets/audio/base-theme.mp3');
music.loop = true;
music.volume = Math.max(0, Math.min(1, 0.35));
const clank = new Audio('assets/audio/build-clank.mp3');
let audioCtx = null;
function beep(freq = 660, dur = 0.08) {
  if (state.muted || !audioCtx) {
    return;
  }
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + dur);
}
function playClank() {
  if (!state.muted) {
    clank.currentTime = 0;
    clank.play().catch(() => {});
  }
}
window.addEventListener('pointerdown', () => {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    if (!state.muted) {
      music.play().catch(() => {});
    }
  }
}, { once: true });

// ---------- Renderer / scene ----------
const container = document.getElementById('game-container');
let renderCanvas = document.createElement('canvas');
let renderer;
let fallback2D = false;
let fallbackContext = null;
const webglContext = renderCanvas.getContext('webgl2', { antialias: true, alpha: false });
if (webglContext) {
  try {
    renderer = new THREE.WebGLRenderer({ canvas: renderCanvas, context: webglContext, antialias: true });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
  } catch (error) {
    console.warn('WebGL2 initialization failed; switching to the functional Canvas 2D compatibility renderer.', error);
  }
}
if (!renderer) {
  fallback2D = true;
  if (webglContext) renderCanvas = document.createElement('canvas');
  fallbackContext = renderCanvas.getContext('2d');
  if (!fallbackContext) throw new Error('Neither WebGL2 nor Canvas 2D is available for rendering.');
  renderer = {
    domElement: renderCanvas,
    setSize(width, height) {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      renderCanvas.width = Math.round(width * ratio);
      renderCanvas.height = Math.round(height * ratio);
      renderCanvas.style.width = `${width}px`;
      renderCanvas.style.height = `${height}px`;
      fallbackContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    },
    setPixelRatio() {},
    render: drawCompatibilityScene,
    setAnimationLoop(callback) {
      const frame = time => { callback(time); requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
    },
  };
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderCanvas);
  console.info('WebGL2 is unavailable in this sandbox; the isometric Canvas 2D compatibility renderer is active.');
}

const canvasBuildingImages = new Map();
function getCanvasBuildingImage(key, level) {
  const asset = getBuildingAsset(key, level);
  if (!asset) return null;
  if (!canvasBuildingImages.has(asset.png)) {
    const image = new Image();
    const record = { image, ready: false };
    image.onload = () => { record.ready = true; };
    image.onerror = () => console.warn(`Canvas 2D building artwork failed to load: ${asset.png}`);
    image.src = asset.png;
    canvasBuildingImages.set(asset.png, record);
  }
  const record = canvasBuildingImages.get(asset.png);
  return record.ready ? record.image : null;
}

function drawCompatibilityScene() {
  const ctx = fallbackContext;
  if (!ctx) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const unit = Math.min(width, height) / Math.max(zoom, 18) * 0.68;
  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#1a3423');
  gradient.addColorStop(0.55, '#263d29');
  gradient.addColorStop(1, '#101b14');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const project = (x, z) => ({
    x: width * 0.53 + ((x - camTarget.x) - (z - camTarget.z)) * unit * 0.69,
    y: height * 0.53 + ((x - camTarget.x) + (z - camTarget.z)) * unit * 0.36,
  });
  const diamond = (cx, cz, halfX, halfZ, fill, stroke = null) => {
    const pts = [[cx - halfX, cz], [cx, cz - halfZ], [cx + halfX, cz], [cx, cz + halfZ]].map(([x, z]) => project(x, z));
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach(pt => ctx.lineTo(pt.x, pt.y)); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  };
  for (let i = 0; i < 70; i++) {
    const angle = i * 2.399963;
    const radius = 20 + (i * 17 % 44);
    const p = project(Math.cos(angle) * radius, Math.sin(angle) * radius);
    const r = Math.max(2, unit * (0.24 + (i % 4) * 0.06));
    ctx.fillStyle = i % 3 ? '#17351f' : '#315333';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(13,25,15,.46)'; ctx.beginPath(); ctx.arc(p.x + r * .55, p.y + r * .45, r * .7, 0, Math.PI * 2); ctx.fill();
  }
  const land = service.community()?.saved.base.landPlots || [];
  for (const config of GAME_CONFIG.landPlots.slice(1)) {
    const plot = land.find(item => item.id === config.id);
    if (!plot) continue;
    const [x, z] = config.position;
    diamond(x, z, 5, 5, plot.status === 'claimed' ? '#405b49' : plot.status === 'approved' ? '#625c42' : '#354c38', '#8b997a');
    for (let i = 0; i < config.trees; i++) {
      if (plot.status === 'claimed' && plot.facilityLevel > 0) continue;
      const a = i * 2.39996 + config.hall;
      const radius = 1.4 + (i % 3) * 0.8;
      const p = project(x + Math.cos(a) * radius, z + Math.sin(a) * radius);
      const standing = i < plot.treesRemaining;
      const size = Math.max(8, unit * (0.52 + config.hall * 0.09));
      ctx.fillStyle = standing ? '#715037' : '#a78656';
      ctx.fillRect(p.x - size * 0.12, p.y - size * (standing ? 0.9 : 0.24), size * 0.24, size * (standing ? 0.9 : 0.24));
      if (standing) {
        ctx.fillStyle = ['#477b50', '#3b7250', '#31694b', '#295d48', '#245442'][config.hall - 1];
        ctx.beginPath(); ctx.moveTo(p.x, p.y - size * 1.8); ctx.lineTo(p.x - size * 0.55, p.y - size * 0.35); ctx.lineTo(p.x + size * 0.55, p.y - size * 0.35); ctx.closePath(); ctx.fill();
      }
    }
    const label = project(x, z + 5.6);
    ctx.font = '700 10px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#e8f1e9';
    ctx.fillText(`${config.name} · ${plot.status}`, label.x, label.y);
    if (plot.status === 'claimed') {
      const center = project(x, z);
      if (plot.facilityLevel > 0) {
        const size = Math.max(16, unit * 2.6);
        ctx.fillStyle = '#29382f'; ctx.fillRect(center.x - size * .5, center.y - size * .75, size, size * .75);
        ctx.fillStyle = '#6a7b55'; ctx.beginPath(); ctx.moveTo(center.x - size * .6, center.y - size * .75); ctx.lineTo(center.x, center.y - size * 1.15); ctx.lineTo(center.x + size * .6, center.y - size * .75); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#c084fc'; ctx.fillRect(center.x - size * .37, center.y - size * .45, size * .74, Math.max(3, size * .1));
        ctx.fillStyle = '#edfaf0'; ctx.font = '700 10px Orbitron, sans-serif'; ctx.fillText(`L${plot.facilityLevel}`, center.x, center.y - size * .5);
      } else { ctx.fillStyle = '#70e59a'; ctx.fillRect(label.x - 3, label.y - 18, 6, 10); }
      ctx.font = '700 9px Inter, sans-serif';
      ctx.fillText(`${plot.barricades} barricades`, label.x, label.y + 11);
    }
  }
  diamond(0, 0, 15, 14, '#73766e', '#9b9e91');
  diamond(0, 0, 9.4, 8.8, 'rgba(102,112,99,.65)', 'rgba(198,202,184,.45)');
  const wall = [];
  for (const [x, z] of [[-17, -17], [17, -17], [17, 17], [-17, 17]]) wall.push(project(x, z));
  ctx.beginPath(); ctx.moveTo(wall[0].x, wall[0].y); wall.slice(1).forEach(pt => ctx.lineTo(pt.x, pt.y)); ctx.closePath();
  ctx.strokeStyle = `rgba(174,188,156,${0.44 + (state.levels?.hq || 1) * 0.07})`; ctx.lineWidth = Math.max(2, unit * (0.12 + (state.levels?.hq || 1) * 0.015)); ctx.stroke();

  if (camTarget.x > 35) {
    diamond(55, -10, 19, 17, '#454a3e', '#7b7c66');
    for (let i = 0; i < 5; i++) {
      const p = project(55 + [-5, 0, 5, -4, 4][i], -10 + [3, 0, 3, -4, -4][i]);
      const s = Math.max(7, unit * (i === 1 ? 3 : 1.5));
      ctx.fillStyle = i === 1 ? '#575b4d' : '#85877a'; ctx.fillRect(p.x - s / 2, p.y - s, s, s);
      if (raid && i === 0) { ctx.strokeStyle = '#ffad57'; ctx.lineWidth = 3; ctx.strokeRect(p.x - s / 2, p.y - s, s, s); }
    }
    if (raid) raid.troops.forEach(t => { const p = project(t.position.x, t.position.z); ctx.fillStyle = '#bd83f2'; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); });
    if (warBattle) {
      for (let i = 0; i < 4; i++) {
        const p = project(55 + [-8, 0, 8, 6][i], -10 + [4, 0, 5, -8][i]);
        ctx.fillStyle = i === 0 ? '#6b735d' : '#79816b';
        ctx.fillRect(p.x - 11, p.y - 20, 22, 24);
        ctx.strokeStyle = 'rgba(192,132,252,.8)'; ctx.strokeRect(p.x - 12, p.y - 21, 24, 26);
      }
      const progress = Math.min(1, warBattle.time / warBattle.duration);
      for (let i = 0; i < Math.min(8, warBattle.squadSize); i++) {
        const p = project(34 + progress * 13, -10 + (i - 4) * 1.2);
        ctx.fillStyle = warBattle.tactic === 'recon' ? '#c084fc' : '#ffb45f';
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.fillStyle = '#e7e2cf'; ctx.font = '700 12px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(warBattle ? `WAR ATTACK · ${warBattle.defenderName.toUpperCase()}` : 'OUTPOST DELTA · AI TRAINING', width / 2, height * .2);
    return;
  }
  for (const [key, building] of Object.entries(buildings || {})) {
    const p = project(DEFS[key].pos[0], DEFS[key].pos[1]);
    const lvl = state.levels?.[key] || 1;
    const asset = getBuildingAsset(key, lvl);
    const footprint = asset?.family.footprint || 5;
    const drawWidth = unit * footprint * 1.05;
    const drawHeight = drawWidth * (key === 'tower' ? 1.4 : 1.02);
    const image = getCanvasBuildingImage(key, lvl);
    diamond(DEFS[key].pos[0], DEFS[key].pos[1], drawWidth * .56, drawWidth * .34, '#454a40', selectedKey === key ? '#70e59a' : 'rgba(221,225,207,.45)');
    ctx.fillStyle = 'rgba(5,9,6,.5)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y - 2, drawWidth * .42, Math.max(4, drawWidth * .2), 0, 0, Math.PI * 2); ctx.fill();
    if (image) {
      ctx.drawImage(image, p.x - drawWidth / 2, p.y - drawHeight, drawWidth, drawHeight);
    } else {
      const roof = key === 'hq' ? '#667548' : key === 'workshop' ? '#445844' : key === 'tower' ? '#576d69' : '#506849';
      ctx.fillStyle = '#30392d'; ctx.fillRect(p.x - drawWidth * .36, p.y - drawHeight * .66, drawWidth * .72, drawHeight * .54);
      ctx.fillStyle = roof; ctx.fillRect(p.x - drawWidth * .43, p.y - drawHeight * .78, drawWidth * .86, drawHeight * .25);
      ctx.fillStyle = key === 'hq' ? '#c084fc' : '#70e59a'; ctx.fillRect(p.x - drawWidth * .2, p.y - drawHeight * .48, drawWidth * .4, Math.max(3, drawWidth * .08));
    }
    if (building.scaffold?.visible) { ctx.strokeStyle = '#edb54b'; ctx.lineWidth = 3; ctx.strokeRect(p.x - drawWidth * .55, p.y - drawHeight * 1.04, drawWidth * 1.1, drawHeight); }
    if (selectedKey === key) { ctx.strokeStyle = '#70e59a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y - drawHeight * .45, drawWidth * .63, drawHeight * .54, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = '#eff4e9'; ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${DEFS[key].name} · L${lvl}`, p.x, p.y + drawWidth * .32);
  }
  for (let i = 0; i < 5; i++) {
    const a = i * 1.256 + performance.now() * 0.0001;
    const p = project(Math.cos(a) * 12, Math.sin(a) * 12);
    ctx.fillStyle = '#495e40'; ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2); ctx.fill();
  }
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2420);
scene.fog = new THREE.Fog(0x1a2420, 60, 130);

let zoom = 28;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
const camTarget = new THREE.Vector3(0, 0, 0);
function updateCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = -zoom * aspect / 2;
  camera.right = zoom * aspect / 2;
  camera.top = zoom / 2;
  camera.bottom = -zoom / 2;
  camera.updateProjectionMatrix();
  camera.position.copy(camTarget).add(new THREE.Vector3(40, 40, 40));
  camera.lookAt(camTarget);
}
updateCamera();
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateCamera();
});

scene.add(new THREE.HemisphereLight(0x9fd4ff, 0x203018, 0.9));
const sun = new THREE.DirectionalLight(0xffd9a0, 2.2);
sun.position.set(30, 45, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 120 });
scene.add(sun);
const purpleFill = new THREE.PointLight(0xa855f7, 60, 40);
purpleFill.position.set(-6, 8, -6);
scene.add(purpleFill);

const texLoader = new THREE.TextureLoader();
function tiledTexture(url, repeat) {
  const tex = texLoader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  return tex;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ map: tiledTexture('assets/forest-ground.webp', 24) }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const pad = new THREE.Mesh(new THREE.PlaneGeometry(30, 28), new THREE.MeshStandardMaterial({ map: tiledTexture('assets/concrete-pad.webp', 4) }));
pad.rotation.x = -Math.PI / 2;
pad.position.y = 0.03;
pad.receiveShadow = true;
scene.add(pad);

// ---------- Helpers ----------
const MAT = {
  olive: new THREE.MeshStandardMaterial({ color: 0x55603a, roughness: 0.8 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2b3128, roughness: 0.7 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x8a8d84, roughness: 0.9 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x9aa3a8, metalness: 0.7, roughness: 0.35 }),
  purple: new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0x7e22ce, emissiveIntensity: 1.2 }),
  green: new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x16a34a, emissiveIntensity: 1.2 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x4a3322 }),
  pine: new THREE.MeshStandardMaterial({ color: 0x1f4d2b, roughness: 0.9 }),
  scaffold: new THREE.MeshStandardMaterial({ color: 0xf2b134, metalness: 0.4 }),
};
function box(parent, w, h, d, mat, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function cyl(parent, rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

// Perimeter fence posts
for (let i = 0; i < 48; i++) {
  const a = (i / 48) * Math.PI * 2;
  box(scene, 0.3, 1.6, 0.3, MAT.dark, Math.cos(a) * 18, 0, Math.sin(a) * 18);
  if (i % 12 === 0) {
    box(scene, 0.25, 0.25, 0.25, MAT.green, Math.cos(a) * 18, 1.6, Math.sin(a) * 18);
  }
}

// ---------- Buildings ----------
const buildings = {};
const animated = { radars: [], lights: [], chimneys: [] };
const revealEffects = new Map();
const celebrations = [];
let revealBannerTimer = 0;
function celebrateUpgrade(x, z, name, level) {
  const banner = document.getElementById('upgradeReveal');
  if (banner) {
    banner.querySelector('span').textContent = `${name} · Level ${level}`;
    banner.classList.remove('active');
    void banner.offsetWidth;
    banner.classList.add('active');
    clearTimeout(revealBannerTimer);
    revealBannerTimer = setTimeout(() => banner.classList.remove('active'), GAME_CONFIG.revealSeconds * 1000);
  }
  if (!state.muted) { beep(660, .17); setTimeout(() => beep(880, .19), 115); setTimeout(() => beep(1100, .25), 245); }
  if (fallback2D || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const group = new THREE.Group();
  group.position.set(x, .15, z);
  const rings = [0xc084fc, 0x70e59a, 0xe9d4ff].map((color, index) => {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.27, 40), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: .7, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = .06 + index * .04;
    group.add(mesh);
    return mesh;
  });
  const sparks = Array.from({ length: 28 }, (_, index) => {
    const angle = index * 2.399963;
    const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(.13 + (index % 3) * .04), new THREE.MeshBasicMaterial({ color: index % 2 ? 0x70e59a : 0xd5a9ff, transparent: true, opacity: 1, depthWrite: false }));
    mesh.position.set(Math.cos(angle) * .5, .4, Math.sin(angle) * .5);
    group.add(mesh);
    return { mesh, angle, speed: 2.3 + (index % 5) * .35, lift: .7 + (index % 4) * .28 };
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.25, .8, 9, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x9bffbb, transparent: true, opacity: .2, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 4.5;
  group.add(beam);
  scene.add(group);
  celebrations.push({ group, rings, sparks, beam, startedAt: performance.now() });
}

function updateCelebrations(now) {
  for (let i = celebrations.length - 1; i >= 0; i--) {
    const effect = celebrations[i];
    const progress = (now - effect.startedAt) / (GAME_CONFIG.revealSeconds * 1000);
    if (progress >= 1) {
      scene.remove(effect.group);
      effect.group.traverse(object => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
      celebrations.splice(i, 1);
      continue;
    }
    effect.rings.forEach((ring, index) => { const stage = Math.max(0, progress - index * .12); ring.scale.setScalar(.35 + stage * 3.3); ring.material.opacity = Math.max(0, .8 - stage); });
    effect.sparks.forEach(({ mesh, angle, speed, lift }) => { mesh.position.set(Math.cos(angle) * (.5 + progress * speed), .4 + Math.sin(progress * Math.PI) * lift * 3, Math.sin(angle) * (.5 + progress * speed)); mesh.rotation.y += .04; mesh.material.opacity = 1 - progress; });
    effect.beam.material.opacity = .22 * Math.sin(progress * Math.PI);
    effect.beam.scale.set(1 + progress * .8, 1, 1 + progress * .8);
  }
}
const gltfLoader = new GLTFLoader();
const modelTemplateCache = new Map();
const modelLoadPromises = new Map();
const landScenery = new THREE.Group();
scene.add(landScenery);
const sceneryTemplates = new Map();
const landPickGeometry = new THREE.CylinderGeometry(1.1, 1.1, 5.5, 8);
const landPickMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
let landTreePicks = [];
let sceneryRequest = 0;

async function sceneryModel(name) {
  if (!sceneryTemplates.has(name)) {
    sceneryTemplates.set(name, gltfLoader.loadAsync(`assets/models/scenery/${name}.glb`).then(gltf => gltf.scene));
  }
  return sceneryTemplates.get(name);
}

async function facilityModel(name) {
  const key = `facility/${name}`;
  if (!sceneryTemplates.has(key)) sceneryTemplates.set(key, gltfLoader.loadAsync(`assets/models/facilities/${name}.glb`).then(gltf => gltf.scene).catch(error => {
    sceneryTemplates.delete(key);
    console.warn(`Facility model ${name} could not load; keeping the claimed plot marker.`, error);
    return null;
  }));
  return sceneryTemplates.get(key);
}

async function reconcileLandScenery() {
  if (fallback2D) return;
  const request = ++sceneryRequest;
  const base = service.community()?.saved.base;
  if (!base) return;
  const names = [...Array.from({ length: 5 }, (_, i) => `pine_l0${i + 1}`), 'pine_stump', 'pine_log_stack', 'claim_marker', 'granite_boulder'];
  try {
    const facilityNames = base.landPlots.filter(plot => plot.status === 'claimed' && plot.facilityLevel > 0)
      .map(plot => `${GAME_CONFIG.facilities[plot.id]?.model}_l0${plot.facilityLevel}`).filter(name => !name.startsWith('undefined'));
    const models = Object.fromEntries(await Promise.all([
      ...names.map(async name => [name, await sceneryModel(name)]),
      ...facilityNames.map(async name => [name, await facilityModel(name)]),
    ]));
    if (request !== sceneryRequest) return;
    for (const child of landScenery.children) if (child.userData.ownedTerrain) { child.geometry.dispose(); child.material.dispose(); }
    landScenery.clear();
    landTreePicks = [];
    for (const config of GAME_CONFIG.landPlots.slice(1)) {
      const plot = base.landPlots.find(item => item.id === config.id);
      if (!plot) continue;
      const [x, z] = config.position;
      const claimed = plot.status === 'claimed';
      const clearing = new THREE.Mesh(
        new THREE.CircleGeometry(5.25, 10),
        new THREE.MeshStandardMaterial({ color: claimed ? 0x405b49 : plot.status === 'approved' ? 0x636044 : 0x344537, roughness: 1, transparent: true, opacity: 0.83 }),
      );
      clearing.rotation.x = -Math.PI / 2;
      clearing.position.set(x, 0.07, z);
      clearing.receiveShadow = true;
      clearing.userData.ownedTerrain = true;
      landScenery.add(clearing);
      for (let i = 0; i < config.trees; i++) {
        if (claimed && plot.facilityLevel > 0) continue;
        const a = i * 2.39996 + config.hall;
        const radius = 1.4 + (i % 3) * 0.8;
        const standing = i < plot.treesRemaining;
        const asset = models[standing ? `pine_l0${config.hall}` : 'pine_stump'].clone();
        asset.position.set(x + Math.cos(a) * radius, 0.09, z + Math.sin(a) * radius);
        asset.rotation.y = a;
        asset.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
        landScenery.add(asset);
        if (standing) {
          const pick = new THREE.Mesh(landPickGeometry, landPickMaterial);
          pick.position.set(asset.position.x, 2.75, asset.position.z);
          pick.userData.plotId = config.id;
          landScenery.add(pick);
          landTreePicks.push(pick);
        }
      }
      if (claimed) {
        const name = plot.facilityLevel > 0 ? `${GAME_CONFIG.facilities[config.id].model}_l0${plot.facilityLevel}` : null;
        if (name && models[name]) {
          const facility = models[name].clone(true);
          facility.position.set(x, 0.09, z);
          facility.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
          landScenery.add(facility);
        } else {
          const marker = models.claim_marker.clone();
          marker.position.set(x, 0.09, z);
          landScenery.add(marker);
        }
        for (let i = 0; i < plot.barricades; i++) {
          const logs = models.pine_log_stack.clone();
          const a = i * Math.PI * 2 / 3;
          logs.position.set(x + Math.cos(a) * 4.1, 0.09, z + Math.sin(a) * 4.1);
          logs.rotation.y = a + Math.PI / 2;
          landScenery.add(logs);
        }
      }
    }
    for (let i = 0; i < 100; i++) {
      const a = i * 2.39996;
      const radius = 32 + (i % 13) * 2.25;
      const asset = models[i % 8 === 0 ? 'granite_boulder' : `pine_l0${1 + (i % 5)}`].clone();
      asset.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      asset.rotation.y = a;
      landScenery.add(asset);
    }
  } catch (error) {
    console.error('Scenery GLB import failed; base preview remains available.', error);
  }
}
let displayedCommunityId = service.profile()?.communityId || null;
let renderedBuildingLevels = {};

function buildModel(key, level) {
  const g = new THREE.Group();
  if (key === 'hq') {
    box(g, 6, 0.5, 6, MAT.concrete);
    box(g, 5, 2.5, 5, MAT.olive, 0, 0.5);
    box(g, 5.2, 0.3, 5.2, MAT.dark, 0, 3);
    box(g, 5.3, 0.2, 0.2, MAT.purple, 0, 1.6, 2.6);
    if (level >= 2) {
      box(g, 3.4, 2, 3.4, MAT.olive, 0, 3.3);
      box(g, 3.6, 0.2, 3.6, MAT.green, 0, 5.3);
    }
    if (level >= 3) {
      box(g, 2, 1.6, 2, MAT.dark, 0, 5.5);
      cyl(g, 0.06, 0.06, 3, MAT.metal, 0, 7.1);
      const flag = box(g, 1.2, 0.7, 0.05, MAT.purple, 0.6, 9.2);
      animated.lights.push({ flag });
    }
  } else if (key === 'workshop') {
    box(g, 6, 0.4, 4.5, MAT.concrete);
    box(g, 5.5, 2.2, 4, MAT.dark, 0, 0.4);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 5.5, 12, 1, false, 0, Math.PI), MAT.olive);
    roof.rotation.z = Math.PI / 2;
    roof.position.y = 2.6;
    roof.castShadow = true;
    g.add(roof);
    box(g, 2, 1.6, 0.1, MAT.green, 0, 0.4, 2.02);
    for (let i = 0; i < level; i++) {
      const chimney = cyl(g, 0.3, 0.35, 2.5 + i, MAT.metal, -2 + i * 1.6, 2.5, -1);
      animated.chimneys.push({ group: g, x: -2 + i * 1.6, y: 5 + i, z: -1 });
      chimney.userData.isChimney = true;
    }
  } else if (key === 'tower') {
    const height = 4 + level * 2;
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      cyl(g, 0.15, 0.2, height, MAT.metal, x, 0, z, 6);
    }
    box(g, 3, 0.3, 3, MAT.dark, 0, height);
    box(g, 2.6, 1.3, 2.6, MAT.olive, 0, height + 0.3);
    box(g, 2.7, 0.15, 2.7, MAT.purple, 0, height + 1.6);
    const head = new THREE.Group();
    head.position.set(0, height + 2, 0);
    box(head, 0.5, 0.5, 0.8, MAT.metal);
    const spot = new THREE.SpotLight(0xd8b4fe, 120, 40, 0.3, 0.5);
    spot.position.set(0, 0.3, 0);
    const spotTarget = new THREE.Object3D();
    spotTarget.position.set(0, -height, 10);
    head.add(spot, spotTarget);
    spot.target = spotTarget;
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(2.4, height + 6, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xd8b4fe, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.position.set(0, -(height + 6) / 2 + 0.3, 5);
    beam.rotation.x = -Math.atan2(10, height) + Math.PI;
    beam.rotation.x = Math.PI - Math.atan2(10, height + 6);
    head.add(beam);
    g.add(head);
    animated.lights.push({ head });
  } else if (key === 'comms') {
    box(g, 4.5, 0.4, 4.5, MAT.concrete);
    box(g, 3, 2, 3, MAT.olive, -0.5, 0.4, -0.5);
    box(g, 3.1, 0.2, 0.2, MAT.green, -0.5, 1.6, 1.05);
    const mastHeight = 3 + level * 2;
    cyl(g, 0.1, 0.2, mastHeight, MAT.metal, 1.4, 0.4, 1.4, 6);
    const radar = new THREE.Group();
    radar.position.set(1.4, mastHeight + 0.4, 1.4);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.6 + level * 0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.5), MAT.metal);
    dish.rotation.x = Math.PI / 2;
    dish.material.side = THREE.DoubleSide;
    radar.add(dish);
    box(radar, 0.1, 0.1, 1, MAT.purple, 0, 0, 0.3);
    g.add(radar);
    animated.radars.push(radar);
    if (level >= 3) {
      cyl(g, 0.05, 0.08, 5, MAT.metal, -1.8, 2.4, -1.8, 5);
      box(g, 0.25, 0.25, 0.25, MAT.purple, -1.8, 7.4, -1.8);
    }
  }
  g.traverse(o => {
    o.userData.buildingKey = key;
  });
  return g;
}

function makeScaffold() {
  const s = new THREE.Group();
  for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    cyl(s, 0.08, 0.08, 6, MAT.scaffold, x, 0, z, 5);
  }
  box(s, 6.2, 0.1, 0.1, MAT.scaffold, 0, 3, 3);
  box(s, 6.2, 0.1, 0.1, MAT.scaffold, 0, 3, -3);
  const crane = new THREE.Group();
  crane.position.set(3, 6, 3);
  box(crane, 5, 0.25, 0.25, MAT.scaffold, -2.5, 0, 0);
  box(crane, 0.04, 2, 0.04, MAT.dark, -4.5, -2, 0);
  s.add(crane);
  s.userData.crane = crane;
  return s;
}

function loadBuildingTemplate(path) {
  if (modelTemplateCache.has(path)) return Promise.resolve(modelTemplateCache.get(path));
  if (modelLoadPromises.has(path)) return modelLoadPromises.get(path);
  const promise = gltfLoader.loadAsync(path).then(gltf => {
    const template = gltf.scene;
    if (!template) throw new Error('GLB contains no scene root.');
    modelTemplateCache.set(path, template);
    modelLoadPromises.delete(path);
    return template;
  }).catch(error => {
    modelLoadPromises.delete(path);
    throw error;
  });
  modelLoadPromises.set(path, promise);
  return promise;
}

function normalizeBuildingClone(template, key, level) {
  const asset = getBuildingAsset(key, level);
  const source = template.clone(true);
  source.rotation.y = THREE.MathUtils.degToRad(asset.yawDegrees);
  source.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(source);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const horizontalSize = Math.max(size.x, size.z);
  if (!Number.isFinite(horizontalSize) || horizontalSize <= 0 || !Number.isFinite(bounds.min.y)) throw new Error('GLB has invalid or empty geometry bounds.');
  source.position.set(-center.x, -bounds.min.y, -center.z);
  source.traverse(object => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      object.userData.buildingKey = key;
      object.userData.buildingLevel = level;
    }
  });
  const normalized = new THREE.Group();
  normalized.scale.setScalar(asset.family.footprint / horizontalSize);
  normalized.add(source);
  normalized.userData.buildingKey = key;
  normalized.userData.buildingLevel = level;
  normalized.userData.assetPath = asset.glb;
  normalized.updateMatrixWorld(true);
  return normalized;
}

let rendererDiagnosticMessage = '';
function setRendererDiagnostic(message) {
  if (message !== undefined) rendererDiagnosticMessage = message;
  const status = document.getElementById('rendererStatus');
  if (!status) return;
  status.textContent = rendererDiagnosticMessage || (fallback2D ? 'Canvas 2D compatibility · source PNGs' : 'Three.js WebGL · textured GLB models');
  status.classList.toggle('error', Boolean(rendererDiagnosticMessage));
}

function requestBuildingModel(key, level) {
  const building = buildings[key];
  const asset = getBuildingAsset(key, level);
  if (!building || !asset || fallback2D) return;
  if (building.modelAssetPath === asset.glb && building.modelLevel === level) return;
  const requestToken = ++building.loadToken;
  const requestCommunity = service.profile()?.communityId;
  loadBuildingTemplate(asset.glb).then(template => {
    if (building.loadToken !== requestToken || service.profile()?.communityId !== requestCommunity || state.levels[key] !== level) return;
    const replacement = normalizeBuildingClone(template, key, level);
    const previous = building.model;
    building.group.add(replacement);
    building.model = replacement;
    building.modelAssetPath = asset.glb;
    building.modelLevel = level;
    building.group.userData.buildingLevel = level;
    if (previous) building.group.remove(previous);
    setRendererDiagnostic('');
  }).catch(error => {
    if (building.loadToken !== requestToken) return;
    console.warn(`Unable to load ${key} Level ${level} building GLB (${asset.glb}); retaining the last valid model or procedural fallback.`, error);
    setRendererDiagnostic(`${DEFS[key].name} L${level} artwork unavailable · fallback active`);
  });
}

function applyScaffoldState(now = Date.now()) {
  const visible = buildingScaffoldState({
    legacyJobs: service.community()?.saved.base.legacyJobs || [], revealEffects,
    now,
  });
  for (const key of Object.keys(DEFS)) if (buildings[key]) buildings[key].scaffold.visible = Boolean(visible[key]);
}

function reconcileBasePresentation() {
  const communityId = service.profile()?.communityId || null;
  const levels = state.levels || {};
  const reconciliation = reconcileBuildingSnapshot(displayedCommunityId, communityId, levels, renderedBuildingLevels);
  if (reconciliation.communityChanged) {
    for (const building of Object.values(buildings)) building.loadToken++;
    revealEffects.clear();
    displayedCommunityId = communityId;
  }
  for (const key of reconciliation.changedKeys) {
    requestBuildingModel(key, levels[key]);
    renderedBuildingLevels[key] = levels[key];
    if (buildings[key]) buildings[key].group.userData.buildingLevel = levels[key];
  }
  applyScaffoldState();
}

function refreshBuilding(key) {
  if (buildings[key]) {
    const level = state.levels[key];
    requestBuildingModel(key, level);
    renderedBuildingLevels[key] = level;
    buildings[key].group.userData.buildingLevel = level;
    applyScaffoldState();
  }
}

for (const key of Object.keys(DEFS)) {
  const group = new THREE.Group();
  group.position.set(DEFS[key].pos[0], 0.05, DEFS[key].pos[1]);
  group.userData.buildingKey = key;
  scene.add(group);
  const scaffold = makeScaffold();
  scaffold.visible = false;
  group.add(scaffold);
  const building = { group, scaffold, model: null, modelLevel: null, modelAssetPath: null, loadToken: 0 };
  const asset = getBuildingAsset(key, state.levels[key]);
  const pickHeight = Math.max(8, asset.family.footprint * 1.5);
  const pickVolume = new THREE.Mesh(
    new THREE.BoxGeometry(asset.family.footprint * 1.8, pickHeight, asset.family.footprint * 1.8),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 }),
  );
  pickVolume.position.y = pickHeight / 2;
  pickVolume.userData.buildingKey = key;
  pickVolume.userData.isStablePickVolume = true;
  group.add(pickVolume);
  building.pickVolume = pickVolume;
  building.model = buildModel(key, state.levels[key]);
  building.modelLevel = state.levels[key];
  building.group.userData.buildingLevel = state.levels[key];
  group.add(building.model);
  buildings[key] = building;
  renderedBuildingLevels[key] = state.levels[key];
}
if (!fallback2D) for (const key of Object.keys(DEFS)) requestBuildingModel(key, state.levels[key]);
applyScaffoldState();

// Patrol soldiers
const patrols = [];
for (let i = 0; i < 5; i++) {
  const soldier = new THREE.Group();
  box(soldier, 0.5, 0.8, 0.35, MAT.olive, 0, 0.6);
  box(soldier, 0.18, 0.6, 0.18, MAT.dark, -0.13, 0);
  box(soldier, 0.18, 0.6, 0.18, MAT.dark, 0.13, 0);
  cyl(soldier, 0.22, 0.22, 0.3, MAT.olive, 0, 1.4);
  box(soldier, 0.1, 0.1, 0.6, MAT.metal, 0.3, 0.9, 0.2);
  scene.add(soldier);
  patrols.push({ mesh: soldier, radius: 13 + (i % 2) * 2.5, phase: (i / 5) * Math.PI * 2, speed: 0.12 + i * 0.01 });
}

// Smoke particles
const smokeMat = new THREE.MeshBasicMaterial({ color: 0x9aa39a, transparent: true, opacity: 0.5, depthWrite: false });
const smokeGeo = new THREE.SphereGeometry(0.35, 8, 6);
const smoke = [];
function spawnSmoke(worldPos) {
  const puff = new THREE.Mesh(smokeGeo, smokeMat.clone());
  puff.position.copy(worldPos);
  puff.userData.life = 0;
  scene.add(puff);
  smoke.push(puff);
}

// ---------- Outpost (raid target) ----------
const OUTPOST = new THREE.Vector3(55, 0, -10);
const outpostBlocks = [];
const warBaseGroup = new THREE.Group();
warBaseGroup.visible = false;
scene.add(warBaseGroup);
const warTroopMeshes = [];
function buildOutpost() {
  outpostBlocks.forEach(b => scene.remove(b));
  outpostBlocks.length = 0;
  const layout = [[0, 0, 4, 3], [-5, 3, 2, 4], [5, 3, 2, 4], [-4, -4, 2, 2], [4, -4, 2, 2]];
  for (const [x, z, s, h] of layout) {
    const m = box(scene, s, h, s, x === 0 ? MAT.dark : MAT.concrete, OUTPOST.x + x, 0, OUTPOST.z + z);
    m.userData.hp = 100;
    outpostBlocks.push(m);
  }
}
buildOutpost();

// ---------- UI: identity, shared projects, progression and Forge ----------
const $ = id => document.getElementById(id);
const panel = $('panel');
let selectedKey = null;
let raid = null;
let warBattle = null;
let toastTimer = 0;
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function toast(text) {
  $('toast').textContent = text;
  toastTimer = 2.5;
}
function openPanel(html) {
  panel.innerHTML = html;
  panel.style.display = 'block';
}
function closePanel() {
  panel.style.display = 'none';
  selectedKey = null;
  updateBuildingList();
}
function isLeadership() {
  const role = service.profile()?.role;
  return role === 'owner' || role === 'admin';
}
function productionRate() {
  if (!service.getAccess().allowed) return 0;
  return GAME_CONFIG.buildings.workshop.stats[state.levels.workshop - 1].partsPerSecond;
}
function renderAppearanceGallery() {
  const gallery = $('appearanceGallery');
  if (!gallery) return;
  gallery.innerHTML = Object.entries(BUILDING_ASSETS).map(([key, family]) => family.levels.map((asset, index) => {
    const name = key === 'workshop' ? 'Workshop / Forge' : DEFS[key].name;
    return `<figure><img src="${asset.png}" loading="lazy" alt="${escapeHTML(name)} Level ${index + 1} cosmetic preview"><figcaption>${escapeHTML(name)} · L${index + 1}</figcaption></figure>`;
  }).join('')).join('');
}

function renderIdentityOptions() {
  const select = $('identitySelect');
  select.innerHTML = service.getIdentityOptions().map(identity => {
    const status = identity.verified ? 'verified' : 'unverified';
    return `<option value="${identity.id}">${escapeHTML(identity.communityName)} · ${escapeHTML(identity.name)} (${escapeHTML(identity.role)}, ${status})</option>`;
  }).join('');
  select.value = service.state.currentIdentityId;
  select.onchange = () => {
    if (raid || warBattle) { select.value = service.state.currentIdentityId; return; }
    service.selectIdentity(select.value);
    selectedKey = null;
    closePanel();
    reconcileBasePresentation();
    reconcileLandScenery();
    updateHud();
    updateBuildingList();
    toast(`Preview identity: ${service.profile().name}`);
  };
}
function updatePreviewCard() {
  const profile = service.profile();
  const community = service.getCommunityInfo();
  const access = service.getAccess();
  $('roleLabel').textContent = `${profile.name} · ${profile.role.toUpperCase()} · ${profile.verified ? 'VERIFIED FIXTURE' : 'UNVERIFIED'}`;
  $('previewStatus').textContent = `${community.name} · ${access.reason}`;
  $('previewStatus').classList.toggle('locked', !access.allowed);
  const recoveryNotice = $('recoveryNotice');
  if (recoveryNotice) {
    recoveryNotice.hidden = !service.state.recoveryNotice;
    recoveryNotice.textContent = service.state.recoveryNotice || '';
  }
  setRendererDiagnostic();
  const toggle = $('proToggleBtn');
  toggle.disabled = profile.role !== 'owner' || !community.eligible || Boolean(raid);
  toggle.textContent = !community.eligible ? 'Free community · Pro unavailable' : `Simulate owner Pro: ${community.proActive ? 'ON' : 'OFF'}`;
}
function updateBuildingList() {
  const access = service.getAccess().allowed;
  $('buildingList').innerHTML = Object.entries(DEFS).map(([key, def]) => {
    const level = access ? `L${state.levels[key]}` : 'Locked';
    return `<button class="building-entry ${selectedKey === key ? 'selected' : ''}" data-building="${key}" ${!access ? 'aria-label="Locked building; select for access details"' : ''}><span>${escapeHTML(def.name)}</span><span class="level">${level}</span></button>`;
  }).join('');
  document.querySelectorAll('[data-building]').forEach(button => button.addEventListener('click', () => showBuildingPanel(button.dataset.building)));
}
function updateHud() {
  const profile = service.profile();
  const community = service.getCommunityInfo();
  const access = service.getAccess();
  $('communityBadge').textContent = `${access.allowed ? '●' : '🔒'} ${community.name} · ${community.proActive ? 'OWNER PRO ACTIVE' : 'PRO INACTIVE'} · ${profile.role.toUpperCase()}`;
  $('parts').textContent = access.allowed ? `⚙ ${Math.floor(state.parts)} Parts` : '⚙ Locked';
  $('salvage').textContent = access.allowed ? `♻ ${Math.floor(state.salvage)} Salvage` : '♻ Locked';
  $('timber').textContent = access.allowed ? `🪵 ${Math.floor(state.timber)} Timber` : '🪵 Locked';
  $('treasury').textContent = access.allowed ? `🏦 ${Math.floor(state.treasury)} Unallocated` : '🏦 Locked';
  $('collectBtn').textContent = `Collect +${Math.floor(state.stored)}`;
  $('collectBtn').disabled = !access.allowed || state.stored < 1;
  $('muteBtn').textContent = state.muted ? '🔇' : '🔊';
  updatePreviewCard();
  updateBuildingList();
}
function formatRemaining(timestamp) {
  const seconds = Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
function startReveal(key) {
  const building = buildings[key];
  if (!building) return;
  refreshBuilding(key);
  building.scaffold.visible = true;
  revealEffects.set(key, Date.now() + GAME_CONFIG.revealSeconds * 1000);
  celebrateUpgrade(DEFS[key].pos[0], DEFS[key].pos[1], DEFS[key].name, state.levels[key]);
  playClank();
}
function showBuildingPanel(key) {
  const def = DEFS[key];
  if (!def) return;
  selectedKey = key;
  updateBuildingList();
  const access = service.getAccess();
  if (!access.allowed) {
    openPanel(`<h2>${escapeHTML(def.name)} · Locked</h2><p class="notice warn">${escapeHTML(access.reason)}</p><p>The community’s base and contributions remain saved while access is locked. Choose an eligible verified identity with active owner Pro in the Preview panel.</p><div class="row"><button id="closeBtn">Close</button></div>`);
    $('closeBtn').onclick = closePanel;
    return;
  }
  const requirement = service.getUpgradeRequirement(service.state.currentIdentityId, key);
  const level = requirement.level;
  const legacyJob = service.community().saved.base.legacyJobs.find(job => job.key === key);
  const activeProject = service.community().saved.base.projects.find(project => project.key === key && project.status === 'approved');
  const cfg = GAME_CONFIG.buildings[key];
  const currentStats = cfg.stats[level - 1];
  const nextStats = requirement.targetLevel <= GAME_CONFIG.maxLevel ? cfg.stats[requirement.targetLevel - 1] : null;
  let html = `<h2>${escapeHTML(def.name)} · Level ${level}/5</h2><p><span class="dim">Current benefit:</span> ${escapeHTML(requirement.currentBenefit)}</p><p class="help">Current stats: ${escapeHTML(JSON.stringify(currentStats).replace(/[{}\"]/g, '').replace(/,/g, ' · ').replace(/:/g, ' '))}</p>`;
  if (requirement.targetLevel <= GAME_CONFIG.maxLevel) {
    html += `<hr><p><b>Next benefit · Level ${requirement.targetLevel}:</b> ${escapeHTML(requirement.nextBenefit)}</p><p class="help">Next stats: ${escapeHTML(JSON.stringify(nextStats).replace(/[{}\"]/g, '').replace(/,/g, ' · ').replace(/:/g, ' '))}</p>`;
    html += `<p>Project target: <b>${requirement.cost.toLocaleString()} Parts</b> · funding completes construction immediately. A ${GAME_CONFIG.revealSeconds.toFixed(1)}s delivery/scaffold reveal follows.</p>`;
    if (requirement.prerequisites.length) html += `<div class="notice warn"><b>Requirements / status</b>${requirement.prerequisites.map(item => `<p>• ${escapeHTML(item)}</p>`).join('')}</div>`;
    if (legacyJob) html += `<p class="notice">Previously paid legacy work is preserved. Completion is due ${new Date(legacyJob.end).toLocaleTimeString()}.</p>`;
    if (activeProject) {
      const remaining = Math.max(0, activeProject.targetAmount - activeProject.funded);
      html += `<div class="project-card ${activeProject.pinned ? 'pinned' : ''}"><strong>${activeProject.pinned ? '★ PRIORITY · ' : ''}Approved · L${activeProject.targetLevel}</strong><p>Funded ${activeProject.funded.toLocaleString()} / ${activeProject.targetAmount.toLocaleString()} Parts · ${remaining.toLocaleString()} remaining</p><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, activeProject.funded / activeProject.targetAmount * 100)}%"></div></div><div class="row"><button id="projectDetailsBtn">Open project funding</button></div></div>`;
    } else if (requirement.targetLevel <= GAME_CONFIG.maxLevel) {
      html += `<p class="help">Prerequisites: ${requirement.prerequisites.length ? 'listed above' : 'met'} · HQ controls supporting-building caps.</p>`;
      if (isLeadership()) html += `<div class="row"><button id="approveProjectBtn" ${requirement.ok ? '' : 'disabled'}>Approve L${requirement.targetLevel} project</button></div>`;
      else html += `<p class="notice">Only the community owner/admin can approve this upgrade. Members can fund it after approval.</p>`;
    }
  } else html += '<p class="notice">Level 5 is the current demo cap. Districts beyond the Command Compound are under development.</p>';
  html += `<div class="row"><button id="openForgeBtn" ${key === 'workshop' ? '' : 'hidden'}>Open personal Forge</button><button id="closeBtn">Close</button></div>`;
  openPanel(html);
  $('closeBtn').onclick = closePanel;
  if ($('approveProjectBtn')) $('approveProjectBtn').onclick = () => {
    const result = service.approveProject(service.state.currentIdentityId, key);
    if (!result.ok) { toast(result.error); showBuildingPanel(key); return; }
    toast(`Project approved · ${GAME_CONFIG.buildings[key].costs[state.levels[key]]} Parts target`);
    showBuildingPanel(key);
  };
  if ($('projectDetailsBtn')) $('projectDetailsBtn').onclick = () => showProjectFundingPanel(activeProject.id);
  if ($('openForgeBtn')) $('openForgeBtn').onclick = showForgePanel;
}

function projectById(projectId) {
  return service.community()?.saved.base.projects.find(project => project.id === projectId) || null;
}
function showProjectsPanel() {
  selectedKey = null;
  updateBuildingList();
  const access = service.getAccess();
  if (!access.allowed) {
    openPanel(`<h2>Community Projects</h2><p class="notice warn">${escapeHTML(access.reason)}</p><p>Shared projects and unallocated funds remain preserved while this community is locked.</p><div class="row"><button id="closeBtn">Close</button></div>`);
    $('closeBtn').onclick = closePanel;
    return;
  }
  const base = service.community().saved.base;
  const projects = [...base.projects].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
  const role = isLeadership() ? 'Leadership can approve and pin up to three priorities, and allocate only existing unallocated treasury.' : 'Members can contribute personal Parts to any approved project. Members cannot approve, pin, alter layouts or allocate treasury.';
  let html = `<h2>Community Projects</h2><p>One shared Command Compound for <b>${escapeHTML(service.getCommunityInfo().name)}</b>.</p><p>Unallocated shared Treasury: <b>${base.treasury.toLocaleString()} Parts</b>. It is not project funding until leadership assigns it.</p><p class="help">${escapeHTML(role)}</p>`;
  if (projects.length) html += projects.map(project => {
    const complete = project.status === 'completed';
    const label = `${GAME_CONFIG.buildings[project.key].name} · Upgrade to Level ${project.targetLevel} · Current Level ${base.levels[project.key]}`;
    const rem = Math.max(0, project.targetAmount - project.funded);
    const myLifetime = service.member().lifetimeContributed;
    const donorList = project.donors.slice(-4).map(donor => `${escapeHTML(donor.name)} +${donor.amount}`).join(' · ') || 'No personal donors yet';
    return `<article class="project-card ${project.pinned ? 'pinned' : ''}"><strong>${project.pinned ? '★ PRIORITY · ' : ''}${escapeHTML(label)}${complete ? ' · COMPLETE' : ''}</strong><p>${escapeHTML(project.benefit)}</p><p>Target ${project.targetAmount.toLocaleString()} · funded ${project.funded.toLocaleString()} · remaining ${rem.toLocaleString()} Parts</p><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, project.funded / project.targetAmount * 100)}%"></div></div><p>Prerequisites: ${project.prerequisites.length ? project.prerequisites.map(escapeHTML).join(' · ') : 'validated at approval'}</p><p>Recent donors: ${donorList}</p><p>Your lifetime contributions: ${myLifetime.toLocaleString()} Parts · persisted with this community</p><div class="row"><button data-project-details="${project.id}">${complete ? 'View completed project' : 'Fund project'}</button>${isLeadership() && !complete ? `<button data-project-pin="${project.id}" data-pinned="${project.pinned}">${project.pinned ? 'Unpin priority' : 'Pin priority'}</button>` : ''}</div></article>`;
  }).join('');
  else html += '<p class="notice">No projects approved yet. Select a building, review its requirements and ask an owner/admin to approve the next upgrade.</p>';
  html += `<div class="row"><button id="closeBtn">Close</button></div>`;
  openPanel(html);
  $('closeBtn').onclick = closePanel;
  document.querySelectorAll('[data-project-details]').forEach(button => button.onclick = () => showProjectFundingPanel(button.dataset.projectDetails));
  document.querySelectorAll('[data-project-pin]').forEach(button => button.onclick = () => {
    const result = service.pinProject(service.state.currentIdentityId, button.dataset.projectPin, button.dataset.pinned !== 'true');
    if (!result.ok) toast(result.error); else toast(result.pinned ? 'Priority pinned.' : 'Priority unpinned.');
    showProjectsPanel();
  });
}
function showProjectFundingPanel(projectId, errorMessage = '') {
  const project = projectById(projectId);
  if (!project) { toast('That project is no longer available.'); showProjectsPanel(); return; }
  const access = service.getAccess();
  const base = service.community().saved.base;
  const member = service.member();
  const remaining = Math.max(0, project.targetAmount - project.funded);
  const complete = project.status === 'completed';
  const donors = project.donors.slice(-6).map(donor => `<li>${escapeHTML(donor.name)} contributed ${donor.amount} Parts</li>`).join('') || '<li>No personal contributions yet.</li>';
  const leadership = isLeadership();
  let html = `<h2>${project.pinned ? '★ Priority · ' : ''}${escapeHTML(GAME_CONFIG.buildings[project.key].name)} · Upgrade to Level ${project.targetLevel}</h2><p><b>Current building level:</b> Level ${base.levels[project.key]}</p><p>${escapeHTML(project.benefit)}</p><p>Prerequisites: ${project.prerequisites.length ? project.prerequisites.map(escapeHTML).join(' · ') : 'Validated when approved'}</p><p>Project target <b>${project.targetAmount.toLocaleString()}</b> · funded <b>${project.funded.toLocaleString()}</b> · remaining <b>${remaining.toLocaleString()}</b> Parts</p><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, project.funded / project.targetAmount * 100)}%"></div></div><p>Your personal Parts: ${member.parts.toLocaleString()} · your lifetime contributions: ${member.lifetimeContributed.toLocaleString()}</p><p>Recent project donors</p><ul>${donors}</ul>`;
  if (errorMessage) html += `<p class="notice warn" role="status">${escapeHTML(errorMessage)}</p>`;
  if (!access.allowed) html += `<p class="notice warn">${escapeHTML(access.reason)}</p>`;
  else if (complete) html += '<p class="notice">Fully funded and completed once. The new level is active immediately.</p>';
  else {
    html += `<div class="row"><label class="field-label" for="donationAmount">Personal donation</label><input id="donationAmount" type="number" min="1" step="1" value="${Math.min(50, Math.max(1, Math.min(member.parts, remaining)))}" aria-label="Personal Parts to contribute"><button id="donateProjectBtn">Contribute Parts</button></div><p class="help">Positive whole number only. The service caps the accepted amount to your balance and the project’s remaining cost.</p>`;
    if (leadership) html += `<div class="row"><label class="field-label" for="allocationAmount">Leadership treasury allocation</label><input id="allocationAmount" type="number" min="1" step="1" value="${Math.min(50, Math.max(1, Math.min(base.treasury, remaining)))}" aria-label="Treasury Parts to allocate"><button id="allocateBtn">Assign unallocated Treasury</button></div><p class="help">Unallocated now: ${base.treasury.toLocaleString()} Parts. Treasury allocation does not count as personal contributions.</p>`;
  }
  html += `<div class="row"><button id="backProjectsBtn">Back to projects</button><button id="closeBtn">Close</button></div>`;
  openPanel(html);
  $('closeBtn').onclick = closePanel;
  $('backProjectsBtn').onclick = showProjectsPanel;
  if ($('donateProjectBtn')) $('donateProjectBtn').onclick = () => {
    const result = service.contributeToProject(service.state.currentIdentityId, projectId, Number($('donationAmount').value));
    if (!result.ok) { showProjectFundingPanel(projectId, result.error); return; }
    if (result.completed && !result.replay) startReveal(project.key);
    beep(520);
    toast(`Accepted ${result.accepted} Parts${result.completed ? ' · project complete' : ` · ${result.remaining} remaining`}`);
    showProjectFundingPanel(projectId);
  };
  if ($('allocateBtn')) $('allocateBtn').onclick = () => {
    const result = service.allocateTreasury(service.state.currentIdentityId, projectId, Number($('allocationAmount').value));
    if (!result.ok) { showProjectFundingPanel(projectId, result.error); return; }
    if (result.completed && !result.replay) startReveal(project.key);
    toast(`Assigned ${result.accepted} Treasury Parts${result.completed ? ' · project complete' : ` · ${result.remaining} remaining`}`);
    showProjectFundingPanel(projectId);
  };
}
function showForgePanel() {
  selectedKey = null;
  updateBuildingList();
  const access = service.getAccess();
  if (!access.allowed) {
    openPanel(`<h2>Personal Forge</h2><p class="notice warn">${escapeHTML(access.reason)}</p><p>Personal Salvage, queued jobs and community progression are preserved while access is locked.</p><div class="row"><button id="closeBtn">Close</button></div>`);
    $('closeBtn').onclick = closePanel;
    return;
  }
  service.processForge();
  const member = service.member();
  const jobs = [...member.forgeJobs].filter(job => job.status !== 'claimed').sort((a, b) => b.createdAt - a.createdAt);
  const slots = service.forgeSlotCount();
  const working = member.forgeJobs.filter(job => job.status === 'working').length;
  const claimText = member.nextClaimAt > Date.now() ? `Next daily Salvage in ${formatRemaining(member.nextClaimAt)}` : 'Daily demo Salvage resupply is ready.';
  let html = `<h2>Personal Forge</h2><p>Personal inventory · Salvage ${member.salvage.toLocaleString()} · Parts ${member.parts.toLocaleString()}</p><p>Demo resupply: +${GAME_CONFIG.dailySalvage} Salvage once per 24h per stable preview identity. <span id="forgeDailyCountdown">${claimText}</span></p><div class="row"><button id="claimSalvageBtn" ${member.nextClaimAt > Date.now() ? 'disabled' : ''}>Claim daily Salvage</button></div><hr><p id="forgeSlotStatus">Forge slots: ${working}/${slots} working · ${slots} slot${slots === 1 ? '' : 's'} from Command Hall L${state.levels.hq}. Recipes use fast preview timings.</p>`;
  html += GAME_CONFIG.forgeRecipes.map(recipe => `<div class="job-card"><strong>${escapeHTML(recipe.name)}</strong><p>-${recipe.input} Salvage → +${recipe.output} Parts · ${recipe.durationSeconds}s fast preview timing</p><button data-recipe="${recipe.id}" ${member.salvage < recipe.input ? 'disabled' : ''}>Start recipe</button></div>`).join('');
  html += '<h3>Queued · Working · Ready jobs</h3>';
  html += jobs.length ? jobs.map(job => {
    const recipe = GAME_CONFIG.forgeRecipes.find(item => item.id === job.recipeId);
    const status = job.status === 'working' ? `Working · ${formatRemaining(job.finishAt)} left` : job.status === 'queued' ? (Number.isFinite(job.startedAt) ? `Queued · starts in ${formatRemaining(job.startedAt)}` : 'Queued · awaiting a slot') : 'Ready to claim';
    return `<article class="job-card"><strong>${escapeHTML(recipe.name)} · <span data-forge-job-status="${job.id}">${escapeHTML(status)}</span></strong><p>Input ${job.input} Salvage (debited at enqueue) · output ${job.output} Parts · ${job.durationSeconds}s demo timing</p><button data-claim-job="${job.id}" ${job.status === 'ready' ? '' : 'hidden'}>Claim ${job.output} Parts</button></article>`;
  }).join('') : '<p class="help">No active Forge jobs.</p>';
  html += `<p class="help">Slot, start and finish timestamps are saved locally. Output is only awarded by an explicit once-only claim.</p><div class="row"><button id="closeBtn">Close</button></div>`;
  openPanel(html);
  $('closeBtn').onclick = closePanel;
  $('claimSalvageBtn').onclick = () => { const result = service.claimDailySalvage(); if (!result.ok) toast(result.error); else { toast(`Daily resupply +${result.amount} Salvage`); } showForgePanel(); };
  document.querySelectorAll('[data-recipe]').forEach(button => button.onclick = () => {
    const result = service.startForgeJob(service.state.currentIdentityId, button.dataset.recipe);
    if (!result.ok) toast(result.error); else toast(result.status === 'queued' ? 'Recipe queued; inputs debited.' : 'Forge recipe started; inputs debited.');
    showForgePanel();
  });
  document.querySelectorAll('[data-claim-job]').forEach(button => button.onclick = () => {
    const result = service.claimForgeJob(service.state.currentIdentityId, button.dataset.claimJob);
    if (!result.ok) toast(result.error); else toast(`Forge claimed: +${result.amount} Parts`);
    showForgePanel();
  });
}

function refreshForgePanel() {
  if (panel.style.display === 'none' || !panel.querySelector('#forgeSlotStatus') || !service.getAccess().allowed) return;
  const jobs = service.processForge();
  const member = service.member();
  const slots = service.forgeSlotCount();
  const working = jobs.filter(job => job.status === 'working').length;
  $('forgeSlotStatus').textContent = `Forge slots: ${working}/${slots} working · ${slots} slot${slots === 1 ? '' : 's'} from Command Hall L${state.levels.hq}. Recipes use fast preview timings.`;
  $('forgeDailyCountdown').textContent = member.nextClaimAt > Date.now() ? `Next daily Salvage in ${formatRemaining(member.nextClaimAt)}` : 'Daily demo Salvage resupply is ready.';
  $('claimSalvageBtn').disabled = member.nextClaimAt > Date.now();
  for (const job of jobs) {
    const statusNode = [...panel.querySelectorAll('[data-forge-job-status]')].find(node => node.dataset.forgeJobStatus === job.id);
    const claimButton = [...panel.querySelectorAll('[data-claim-job]')].find(button => button.dataset.claimJob === job.id);
    if (!statusNode) continue;
    statusNode.textContent = job.status === 'working' ? `Working · ${formatRemaining(job.finishAt)} left`
      : job.status === 'queued' ? (Number.isFinite(job.startedAt) ? `Queued · starts in ${formatRemaining(job.startedAt)}` : 'Queued · awaiting a slot')
        : 'Ready to claim';
    if (claimButton) claimButton.hidden = job.status !== 'ready';
  }
}

function showProgressionPanel() {
  selectedKey = null;
  updateBuildingList();
  const access = service.getAccess();
  if (!access.allowed) {
    openPanel(`<h2>Command Hall Progression</h2><p class="notice warn">${escapeHTML(access.reason)}</p><div class="row"><button id="closeBtn">Close</button></div>`);
    $('closeBtn').onclick = closePanel;
    return;
  }
  const levels = state.levels;
  const hq = levels.hq;
  const req = service.getUpgradeRequirement(service.state.currentIdentityId, 'hq');
  const supports = ['workshop', 'tower', 'comms'].map(key => `<p>${escapeHTML(GAME_CONFIG.buildings[key].name)} · L${levels[key]}/5 — ${levels[key] >= hq ? 'meets current Hall tier' : `needs Level ${hq}`}</p>`).join('');
  const districts = GAME_CONFIG.districts.map(district => `<article class="district-card"><strong>${escapeHTML(district.name)}</strong><p>${district.hall <= hq ? '● Available' : `🔒 Requires Command Hall L${district.hall}`} · ${escapeHTML(district.status)}</p></article>`).join('');
  let html = `<h2>Permanent Progression</h2><p>Command Hall controls the support-building cap, squad readiness, Forge slots and wall tier.</p><p>Current: Hall Level ${hq}/5 · ${GAME_CONFIG.buildings.hq.benefits[hq - 1]}</p><p>Current Hall stats: ${2 + hq * 2} training troops · wall Tier ${hq}.</p><h3>Support requirements for the next Hall level</h3>${supports}`;
  if (hq < GAME_CONFIG.maxLevel) {
    html += `<p>Hall ${hq + 1} target: ${GAME_CONFIG.buildings.hq.costs[hq].toLocaleString()} Parts · benefit: ${GAME_CONFIG.buildings.hq.benefits[hq]}</p>`;
    if (req.prerequisites.length) html += `<div class="notice warn">${req.prerequisites.map(item => `<p>• ${escapeHTML(item)}</p>`).join('')}</div>`;
    else html += `<p class="help">Requirements met. An owner/admin can approve this as a collaborative project from the Command Hall.</p>`;
  } else html += '<p>Maximum demo Hall level reached.</p>';
  html += `<hr><h3>Stronghold Map</h3>${districts}<p class="help">Clear each plot, have leadership approve its claim, then fund its distinct facility together through five visual tiers.</p><hr><p><b>Permanent base progression</b> is saved per community. <b>Seasonal score:</b> not active in this local preview; training wins are practice results, not seasonal ranking.</p><div class="row"><button id="closeBtn">Close</button></div>`;
  openPanel(html);
  $('closeBtn').onclick = closePanel;
}

function showLandPanel() {
  const access = service.getAccess();
  if (!access.allowed) {
    openPanel(`<h2>Land & Forest</h2><p class="notice warn">${escapeHTML(access.reason)}</p><p>Shared land and personal Timber stay saved while access is locked.</p><div class="row"><button id="closeBtn">Close</button></div>`);
    $('closeBtn').onclick = closePanel;
    return;
  }
  const snapshot = service.snapshot();
  const hall = snapshot.base.levels.hq;
  const cards = GAME_CONFIG.landPlots.slice(1).map(config => {
    const plot = snapshot.base.landPlots.find(item => item.id === config.id);
    const locked = hall < config.hall;
    const status = locked ? `Requires Command Hall L${config.hall}` : plot.status === 'wild'
      ? `${plot.treesRemaining}/${config.trees} trees standing` : plot.status === 'cleared'
        ? 'Cleared · awaiting owner approval' : plot.status === 'approved'
          ? `Approved · ${plot.timberFunded}/${config.timberCost} Timber donated` : `Claimed · ${plot.barricades}/${GAME_CONFIG.maxBarricadesPerPlot} barricades`;
    const button = locked ? '' : plot.status === 'wild'
      ? `<button data-chop="${config.id}">Chop one tree · +${GAME_CONFIG.timberPerTree} Timber</button>`
      : plot.status === 'cleared' && isLeadership()
        ? `<button data-approve-land="${config.id}">Approve shared land claim</button>`
        : plot.status === 'approved'
          ? `<button data-contribute-timber="${config.id}" ${snapshot.member.timber < 1 ? 'disabled' : ''}>Donate Timber to claim</button>`
          : plot.status === 'claimed'
            ? `<button data-barricade="${config.id}" ${snapshot.member.timber < GAME_CONFIG.barricadeTimberCost || plot.barricades >= GAME_CONFIG.maxBarricadesPerPlot ? 'disabled' : ''}>Build barricade · ${GAME_CONFIG.barricadeTimberCost} Timber</button>`
            : '';
    const facility = GAME_CONFIG.facilities[config.id];
    const project = plot.facilityProject;
    let facilityHtml = '';
    if (plot.status === 'claimed') {
      facilityHtml = `<p><b>${escapeHTML(facility.name)} · Level ${plot.facilityLevel}/5</b></p><p class="help">${escapeHTML(facility.purpose)}${config.id === 'timberline-depot' && plot.facilityLevel > 0 ? ` · ${20 + (plot.facilityLevel - 1) * 10} Timber per member daily` : ''}</p>`;
      if (project) {
        const donors = project.donors.map(d => `${escapeHTML(d.name)}: ${d.parts} Parts + ${d.timber} Timber`).join(' · ');
        facilityHtml += `<p>Approved Level ${project.targetLevel}: ${project.partsFunded}/${project.partsCost} Parts · ${project.timberFunded}/${project.timberCost} Timber</p><div class="progress-track"><div class="progress-fill" style="width:${Math.floor(100 * (project.partsFunded + project.timberFunded) / (project.partsCost + project.timberCost))}%"></div></div><p class="help">${donors || 'Awaiting first contribution'}</p><button data-fund-facility="${config.id}" ${snapshot.member.parts + snapshot.member.timber < 1 ? 'disabled' : ''}>Donate Parts &amp; Timber</button>`;
      } else if (plot.facilityLevel < 5 && isLeadership()) {
        const target = plot.facilityLevel + 1;
        const [partsCost, timberCost] = facility.costs[target];
        facilityHtml += `<button data-approve-facility="${config.id}" ${target > hall ? 'disabled' : ''}>Approve Level ${target} · ${partsCost} Parts + ${timberCost} Timber</button>`;
        if (target > hall) facilityHtml += `<p class="help">Command Hall L${target} required for the next facility tier.</p>`;
      }
      if (config.id === 'timberline-depot' && plot.facilityLevel > 0) facilityHtml += `<div class="row"><button data-depot-claim="${config.id}" ${snapshot.member.nextTimberClaimAt > Date.now() ? 'disabled' : ''}>${snapshot.member.nextTimberClaimAt > Date.now() ? `Resupply in ${formatRemaining(snapshot.member.nextTimberClaimAt)}` : 'Claim daily Timber'}</button></div>`;
    }
    return `<article class="district-card"><strong>${escapeHTML(config.name)} · Hall L${config.hall}</strong><p>${escapeHTML(status)}</p><div class="row">${button}</div>${facilityHtml}</article>`;
  }).join('');
  openPanel(`<h2>Land & Forest</h2><p>Verified players clear trees and keep the Timber they cut. Leadership approves land and facility projects; members contribute and build them together.</p><p class="notice">Your Timber: ${snapshot.member.timber} · Claimed plots: ${snapshot.base.landPlots.filter(plot => plot.status === 'claimed').length}/5 · Built barricades: ${snapshot.base.landPlots.reduce((sum, plot) => sum + plot.barricades, 0)}</p><div class="row"><button id="recycleTimberBtn" ${snapshot.member.salvage < GAME_CONFIG.recycleSalvageCost ? 'disabled' : ''}>Recycle ${GAME_CONFIG.recycleSalvageCost} Salvage → ${GAME_CONFIG.recycledTimber} Timber</button></div><p class="help">Daily Salvage keeps Timber renewable after your forest is cleared.</p>${cards}<p class="help">Ridgewatch boosts Assault, Signal Relay boosts Recon, and Highland Works defends both. Facility levels and barricades are frozen when a local war is accepted.</p><div class="row"><button id="closeBtn">Close</button></div>`);
  $('closeBtn').onclick = closePanel;
  $('recycleTimberBtn').onclick = () => { const result = service.recycleTimber(); toast(result.ok ? `+${result.amount} recycled Timber` : result.error); updateHud(); showLandPanel(); };
  panel.querySelectorAll('[data-chop]').forEach(button => button.onclick = () => {
    const result = service.chopTree(service.state.currentIdentityId, button.dataset.chop);
    if (!result.ok) toast(result.error); else { toast(`+${result.timberEarned} Timber · ${result.treesRemaining} trees left`); reconcileLandScenery(); updateHud(); }
    showLandPanel();
  });
  panel.querySelectorAll('[data-approve-land]').forEach(button => button.onclick = () => {
    const result = service.approveLandClaim(service.state.currentIdentityId, button.dataset.approveLand);
    if (!result.ok) toast(result.error); else { toast('Owner approved the shared land claim.'); reconcileLandScenery(); }
    showLandPanel();
  });
  panel.querySelectorAll('[data-contribute-timber]').forEach(button => button.onclick = () => {
    const config = GAME_CONFIG.landPlots.find(item => item.id === button.dataset.contributeTimber);
    const plot = service.community().saved.base.landPlots.find(item => item.id === config.id);
    const amount = Math.min(service.member().timber, config.timberCost - plot.timberFunded);
    const result = service.contributeTimber(service.state.currentIdentityId, config.id, amount);
    if (!result.ok) toast(result.error); else { toast(result.status === 'claimed' ? 'New land claimed for the whole community.' : `${result.accepted} Timber donated.`); reconcileLandScenery(); updateHud(); if (result.status === 'claimed') celebrateUpgrade(config.position[0], config.position[1], config.name + ' claimed', 1); }
    showLandPanel();
  });
  panel.querySelectorAll('[data-barricade]').forEach(button => button.onclick = () => {
    const result = service.buildBarricade(service.state.currentIdentityId, button.dataset.barricade);
    if (!result.ok) toast(result.error); else { toast('Barricade built by a community member.'); reconcileLandScenery(); updateHud(); }
    showLandPanel();
  });
  panel.querySelectorAll('[data-approve-facility]').forEach(button => button.onclick = () => {
    const result = service.approveFacility(service.state.currentIdentityId, button.dataset.approveFacility);
    toast(result.ok ? `Level ${result.targetLevel} facility approved for community funding.` : result.error);
    showLandPanel();
  });
  panel.querySelectorAll('[data-fund-facility]').forEach(button => button.onclick = () => {
    const plotId = button.dataset.fundFacility;
    const project = service.community().saved.base.landPlots.find(item => item.id === plotId)?.facilityProject;
    const member = service.member();
    const result = service.contributeFacility(service.state.currentIdentityId, plotId,
      Math.min(member.parts, project.partsCost - project.partsFunded), Math.min(member.timber, project.timberCost - project.timberFunded));
    if (!result.ok) toast(result.error);
    else {
      toast(result.completed ? `${GAME_CONFIG.facilities[plotId].name} Level ${result.targetLevel} complete!` : `${result.acceptedParts} Parts and ${result.acceptedTimber} Timber donated.`);
      if (result.completed && !result.replay) { const config = GAME_CONFIG.landPlots.find(item => item.id === plotId); celebrateUpgrade(config.position[0], config.position[1], GAME_CONFIG.facilities[plotId].name, result.facilityLevel); reconcileLandScenery(); playClank(); }
      updateHud();
    }
    showLandPanel();
  });
  panel.querySelectorAll('[data-depot-claim]').forEach(button => button.onclick = () => {
    const result = service.claimDepotTimber();
    toast(result.ok ? `Lumber Yard resupply +${result.amount} personal Timber` : result.error);
    updateHud(); showLandPanel();
  });
}

function checkUpgrades() {
  const completed = service.processLegacyJobs();
  for (const key of completed) {
    refreshBuilding(key);
    buildings[key].scaffold.visible = false;
    toast(`${DEFS[key].name} legacy upgrade completed once · Level ${state.levels[key]}`);
    startReveal(key);
    if (selectedKey === key) showBuildingPanel(key);
  }
}

$('collectBtn').onclick = () => {
  const result = service.collectParts();
  if (!result.ok) { toast(result.error); return; }
  beep(880);
  toast(`+${result.amount} personal Parts collected`);
};
$('projectsBtn').onclick = showProjectsPanel;
$('forgeBtn').onclick = showForgePanel;
$('progressionBtn').onclick = showProgressionPanel;
$('landBtn').onclick = showLandPanel;
$('proToggleBtn').onclick = () => {
  const community = service.getCommunityInfo();
  const result = service.setOwnerProActive(service.state.currentIdentityId, !community.proActive);
  if (!result.ok) toast(result.error);
  else { closePanel(); toast(result.proActive ? 'Simulated owner Pro activated · access restored.' : 'Simulated owner Pro inactive · base remains saved and locked.'); }
  updateHud();
};
$('muteBtn').onclick = () => {
  state.muted = !state.muted;
  if (state.muted) music.pause(); else music.play().catch(() => {});
  save();
  updateHud();
};
renderIdentityOptions();
renderAppearanceGallery();
reconcileLandScenery();
updateHud();

// ---------- War Table & raid ----------
const WAR_COMMUNITY_IDS = ['iron-pines', 'violet-ridge', 'mossback-free'];
const WAR_LEADERSHIP = ['owner', 'admin'];
let selectedWarOpponentCommunityId = null;

function warCommunityName(communityId) {
  return service.getIdentityOptions().find(identity => identity.communityId === communityId)?.communityName || communityId;
}

function warTimelineHTML(war) {
  const events = (war.events || []).slice(-10);
  return events.length ? `<h3>Event timeline · replay log</h3>${events.map(event => `<div class="war-event"><span class="war-tag">${escapeHTML(event.type.toUpperCase())}</span> · ${new Date(event.at).toLocaleTimeString()} — ${escapeHTML(event.text)}${event.details?.attackId ? `<p class="help">Replay ID ${escapeHTML(event.details.attackId)} · ${escapeHTML(event.details.tactic)} · ${event.details.score} pts</p>` : ''}</div>`).join('')}` : '<p class="help">No war events yet.</p>';
}

function warSnapshotLine(side) {
  const levels = side.base.levels;
  return `Hall L${levels.hq} · Workshop L${levels.workshop} · Watchtower L${levels.tower} · Comms L${levels.comms} · Squad ${side.stats.squadSize} · Walls T${side.stats.wallTier} · Claimed districts ${side.base.landPlots?.filter(plot => plot.status === 'claimed').length || 1} · Barricades ${side.stats.fortification || 0} · Assault +${side.stats.assaultBonus || 0} · Recon +${side.stats.reconBonus || 0} · Works -${side.stats.worksDefence || 0}`;
}

function renderWarRecord(war, currentCommunityId, currentIdentity) {
  const challenger = war.snapshots.challenger;
  const defender = war.snapshots.defender;
  const isChallenger = currentCommunityId === war.challengerCommunityId;
  const isParticipant = isChallenger || currentCommunityId === war.defenderCommunityId;
  const leadership = WAR_LEADERSHIP.includes(currentIdentity.role);
  const readiness = service.getWarReadiness(currentCommunityId, currentIdentity.id);
  const playerRoster = war.roster[currentCommunityId] || [];
  const hasRoster = playerRoster.some(member => member.identityId === currentIdentity.id);
  const myAttacks = war.attacks.filter(attack => attack.communityId === currentCommunityId);
  const alreadyAttacked = war.attacks.some(attack => attack.identityId === currentIdentity.id);
  const challengerCount = war.attacks.filter(attack => attack.communityId === war.challengerCommunityId).length;
  const defenderCount = war.attacks.filter(attack => attack.communityId === war.defenderCommunityId).length;
  const atCap = challengerCount >= WAR_RULES.maxAttacksPerSide && defenderCount >= WAR_RULES.maxAttacksPerSide;
  const canResolve = war.state === 'active' && leadership && (atCap || Date.now() >= war.attackEndsAt);
  const currentSide = isChallenger ? challenger : defender;
  const enemySide = isChallenger ? defender : challenger;
  let actions = '';
  if (war.state === 'challenged' && currentCommunityId === war.defenderCommunityId) {
    actions = leadership && readiness.eligible
      ? `<div class="row"><button data-war-accept="${escapeHTML(war.id)}">Accept challenge</button><button data-war-decline="${escapeHTML(war.id)}">Decline</button></div>`
      : `<p class="notice warn">Challenge inbox is leadership-only. ${escapeHTML(readiness.unmetGates.join(' '))}</p>`;
  } else if (war.state === 'challenged') {
    actions = '<p class="notice">Challenge sent. Waiting for the opposing owner/admin to accept.</p>';
  } else if (war.state === 'preparation') {
    const ready = Date.now() >= war.prepReadyAt && Date.now() <= war.prepDeadlineAt;
    actions = `<p class="notice">Preparation window · <span data-war-countdown="${war.prepReadyAt}" data-war-mode="prep" data-prep-deadline="${war.prepDeadlineAt}">${ready ? `Start before ${formatRemaining(war.prepDeadlineAt)}` : `Launch opens in ${formatRemaining(war.prepReadyAt)}`}</span></p>${leadership ? `<div class="row"><button data-war-start="${escapeHTML(war.id)}" ${ready ? '' : 'disabled'}>Start war</button></div>` : '<p class="help">An owner/admin from either side can start when preparation opens.</p>'}`;
  } else if (war.state === 'active') {
    const myCap = myAttacks.length >= WAR_RULES.maxAttacksPerSide;
    const canAttack = isParticipant && readiness.eligible && hasRoster && !alreadyAttacked && !myCap && Date.now() <= war.attackEndsAt;
    actions = `<div class="war-scoreboard"><div><span>${escapeHTML(challenger.name)}</span><strong>${war.score[war.challengerCommunityId] || 0}</strong></div><span>VS</span><div><span>${escapeHTML(defender.name)}</span><strong>${war.score[war.defenderCommunityId] || 0}</strong></div></div>
      <p class="help">Attacks ${challengerCount}/${WAR_RULES.maxAttacksPerSide} · ${defenderCount}/${WAR_RULES.maxAttacksPerSide} · closes in <span data-war-countdown="${war.attackEndsAt}" data-war-mode="attack">${formatRemaining(war.attackEndsAt)}</span></p>
      <p><b>Locked attacker base:</b> ${escapeHTML(warSnapshotLine(currentSide))}</p><p><b>Locked defence:</b> ${escapeHTML(warSnapshotLine(enemySide))}</p>
      <div class="row"><div class="war-tactic"><strong>ASSAULT · direct push</strong><p>Ridgewatch adds 2 per level. Enemy barricades reduce Assault by 3 each; Defence Works reduces both tactics by 2 per level.</p></div><div class="war-tactic"><strong>RECON · signal sweep</strong><p>Signal Relay adds 2 per level. Enemy barricades reduce Recon by 1 each; Defence Works counters the sweep.</p></div></div>
      ${canAttack ? `<div class="row"><button data-war-attack="assault" data-war-id="${escapeHTML(war.id)}">Deploy Assault squad</button><button data-war-attack="recon" data-war-id="${escapeHTML(war.id)}">Deploy Recon squad</button></div>` : `<p class="notice ${readiness.eligible ? '' : 'warn'}">${!readiness.eligible ? escapeHTML(readiness.unmetGates.join(' ')) : !hasRoster ? 'This identity was not on the verified pre-war roster.' : alreadyAttacked ? 'Your roster member has already deployed once.' : myCap ? 'Your community has used its two-attack cap.' : 'Attack window closed.'}</p>`}
      ${leadership ? `<div class="row"><button data-war-resolve="${escapeHTML(war.id)}" ${canResolve ? '' : 'disabled'}>${canResolve ? 'Resolve war · lock result' : 'Resolve when attack cap is reached or timer ends'}</button></div>` : ''}`;
  } else if (war.state === 'resolved') {
    const winner = war.tie ? 'TIE · no winner' : warCommunityName(war.winnerCommunityId);
    const localReward = war.rewards?.length || war.rewardLedgerIds?.length || 0;
    actions = `<div class="notice"><b>${escapeHTML(winner)}</b><p>Final score ${war.score[war.challengerCommunityId] || 0} – ${war.score[war.defenderCommunityId] || 0}</p><p>Local-only activity rewards: ${localReward ? '40 Parts per deployed roster member, claimed once into this browser preview.' : 'No attacks were deployed; no reward.'}</p><p class="help">This result never changes a DZN server leaderboard, match result, event feed or DayZ stat.</p></div>`;
  } else {
    actions = `<p class="notice">War ${escapeHTML(war.state)} · no attack or reward can be issued.</p>`;
  }
  const status = war.state.toUpperCase();
  return `<article class="war-card ${war.state === 'active' ? 'ready' : ''}" data-war-record="${escapeHTML(war.id)}" data-war-state="${escapeHTML(war.state)}"><span class="war-tag">${status} · ${escapeHTML(war.id)}</span><h3>${escapeHTML(challenger.name)} vs ${escapeHTML(defender.name)}</h3><p class="help">Captured before the challenge · fixed for scoring. ${isParticipant ? 'Shared war record for both preview communities.' : ''}</p>${actions}${warTimelineHTML(war)}</article>`;
}

function showWarTable(errorMessage = '') {
  selectedKey = null;
  updateBuildingList();
  const profile = service.profile();
  const community = service.getCommunityInfo();
  const currentReadiness = service.getWarReadiness(community.id, profile.id);
  const leadership = WAR_LEADERSHIP.includes(profile.role);
  const otherCommunityId = community.id === 'iron-pines' ? 'violet-ridge' : 'iron-pines';
  if (!selectedWarOpponentCommunityId || selectedWarOpponentCommunityId === community.id) selectedWarOpponentCommunityId = otherCommunityId;
  const communities = WAR_COMMUNITY_IDS.map(communityId => {
    const leader = service.getIdentityOptions().find(identity => identity.communityId === communityId && identity.role === 'owner');
    const readiness = service.getWarReadiness(communityId, communityId === community.id ? profile.id : leader?.id || null);
    return `<article class="war-card ${readiness.eligible ? 'ready' : 'locked'}"><b>${escapeHTML(readiness.communityName)}${communityId === community.id ? ' · YOUR COMMUNITY' : ''}</b><p>${readiness.proActive ? 'Owner Pro active' : 'Owner Pro inactive'} · Hall L${readiness.levels?.hq ?? '—'} · support L${readiness.levels ? `${readiness.levels.workshop}/${readiness.levels.tower}/${readiness.levels.comms}` : '—'} <span class="sim">[LOCAL FIXTURE]</span></p>${readiness.eligible ? '<p class="help">War readiness gates met.</p>' : `<div class="notice warn">${readiness.unmetGates.map(gate => `<p>${escapeHTML(gate)}</p>`).join('')}</div>`}</article>`;
  }).join('');
  const activeWar = service.state.wars.find(war => ['challenged', 'preparation', 'active'].includes(war.state));
  const wars = service.getWars(profile.id);
  const targetReadiness = service.getWarReadiness(selectedWarOpponentCommunityId, service.getIdentityOptions().find(identity => identity.communityId === selectedWarOpponentCommunityId && identity.role === 'owner')?.id || null);
  const canChallenge = leadership && currentReadiness.eligible && targetReadiness.eligible && !activeWar && !raid && !warBattle && ['iron-pines', 'violet-ridge'].includes(community.id);
  const otherOption = service.getIdentityOptions().find(identity => identity.communityId === otherCommunityId);
  const access = service.getAccess(profile.id);
  const trainingSquad = 2 + (state.levels.hq || 1) * 2;
  let html = `<h2>War Table</h2><p>Server-versus-server <span class="sim">[LOCAL WAR PREVIEW]</span> · only Iron Pines and Violet Ridge can challenge. Identity, membership and Pro status are local fixtures—not authentication or live multiplayer.</p>${errorMessage ? `<p class="notice warn" role="status">${escapeHTML(errorMessage)}</p>` : ''}<h3>Eligibility · exact gates</h3>${communities}<div class="war-card"><b>Issue a challenge</b><p class="help">Owner/admin only. Opposing owner/admin must accept. One active local war at a time.</p><div class="row"><label class="field-label" for="warOpponentSelect">Opponent community</label><select id="warOpponentSelect"><option value="${escapeHTML(otherCommunityId)}">${escapeHTML(otherOption?.communityName || otherCommunityId)}${targetReadiness.eligible ? '' : ' · locked'}</option><option value="mossback-free" disabled>Mossback Free Community · locked (Free tier)</option></select><button id="warChallengeBtn" ${canChallenge ? '' : 'disabled'}>Send challenge</button></div>${!leadership ? '<p class="notice warn">Only this community’s owner/admin may issue a challenge.</p>' : ''}${activeWar ? `<p class="notice">War ${escapeHTML(activeWar.id)} is already ${escapeHTML(activeWar.state)}. Resolve or close it before another challenge.</p>` : !targetReadiness.eligible ? `<p class="notice warn">Opponent gates: ${targetReadiness.unmetGates.map(escapeHTML).join(' ')}</p>` : !currentReadiness.eligible ? `<p class="notice warn">Your gates: ${currentReadiness.unmetGates.map(escapeHTML).join(' ')}</p>` : ''}</div>`;
  if (wars.length) html += `<h3>Challenge inbox · shared war record</h3>${wars.map(war => renderWarRecord(war, community.id, profile)).join('')}`;
  else html += '<p class="help">No challenges or wars yet. Once both fictional communities meet the gates, one owner/admin can challenge the other.</p>';
  const lockedMessage = access.allowed ? '' : `<p class="notice warn">${escapeHTML(access.reason)}</p>`;
  html += `<hr><p><b>AI Training Encounter:</b> Fixed Outpost Delta <span class="sim">[TRAINING · SIMULATED]</span></p><p>Squad: ${trainingSquad} troops · Training attempts: ${state.raidCount}. Practice is separate from war scores and rewards.</p>${lockedMessage}<div class="row"><button id="raidBtn" ${raid || warBattle || !access.allowed ? 'disabled' : ''}>Launch Practice Raid</button><button id="closeBtn">Close</button></div><p class="help">War points and practice wins are local preview data only. No coordinates or private information are used.</p>`;
  openPanel(html);
  $('closeBtn').onclick = closePanel;
  $('raidBtn').onclick = launchRaid;
  $('warOpponentSelect').value = selectedWarOpponentCommunityId;
  $('warOpponentSelect').onchange = () => { selectedWarOpponentCommunityId = $('warOpponentSelect').value; showWarTable(); };
  $('warChallengeBtn').onclick = () => {
    const result = service.challengeWar(profile.id, $('warOpponentSelect').value);
    if (!result.ok) { showWarTable(result.error); return; }
    toast('Challenge sent · waiting for opposing owner/admin.');
    showWarTable();
  };
  panel.querySelectorAll('[data-war-accept]').forEach(button => button.onclick = () => {
    const result = service.acceptWarChallenge(profile.id, button.dataset.warAccept);
    if (!result.ok) { showWarTable(result.error); return; }
    toast('Challenge accepted · preparation window opened.'); showWarTable();
  });
  panel.querySelectorAll('[data-war-decline]').forEach(button => button.onclick = () => {
    const result = service.declineWarChallenge(profile.id, button.dataset.warDecline);
    if (!result.ok) { showWarTable(result.error); return; }
    toast('Challenge declined.'); showWarTable();
  });
  panel.querySelectorAll('[data-war-start]').forEach(button => button.onclick = () => {
    const result = service.startWar(profile.id, button.dataset.warStart);
    if (!result.ok) { showWarTable(result.error); return; }
    toast('War active · two deployments per side.'); showWarTable();
  });
  panel.querySelectorAll('[data-war-attack]').forEach(button => button.onclick = () => launchWarAttack(button.dataset.warId, button.dataset.warAttack));
  panel.querySelectorAll('[data-war-resolve]').forEach(button => button.onclick = () => {
    const result = service.resolveWar(profile.id, button.dataset.warResolve);
    if (!result.ok) { showWarTable(result.error); return; }
    toast(result.tie ? 'War resolved · tie.' : `War resolved · ${warCommunityName(result.winnerCommunityId)} wins.`);
    showWarTable();
  });
}
$('warBtn').onclick = showWarTable;

function refreshWarTableTimers() {
  if (panel.style.display === 'none' || !panel.querySelector('[data-war-record]')) return;
  const profile = service.profile();
  const readiness = service.getWarReadiness(profile.communityId, profile.id);
  const leadership = WAR_LEADERSHIP.includes(profile.role);
  for (const card of panel.querySelectorAll('[data-war-record]')) {
    const war = service.getWar(card.dataset.warRecord);
    if (!war) continue;
    if (war.state !== card.dataset.warState) { showWarTable(); return; }
    const countdown = card.querySelector('[data-war-countdown]');
    if (war.state === 'preparation' && countdown) {
      const start = card.querySelector('[data-war-start]');
      const canStart = leadership && readiness.eligible && Date.now() >= war.prepReadyAt && Date.now() <= war.prepDeadlineAt;
      countdown.textContent = Date.now() < war.prepReadyAt ? `Launch opens in ${formatRemaining(war.prepReadyAt)}` : `Start before ${formatRemaining(war.prepDeadlineAt)}`;
      if (start) start.disabled = !canStart;
    } else if (war.state === 'active') {
      if (countdown) countdown.textContent = formatRemaining(war.attackEndsAt);
      const closed = Date.now() > war.attackEndsAt;
      card.querySelectorAll('[data-war-attack]').forEach(button => { if (closed) button.disabled = true; });
      const challengerCount = war.attacks.filter(attack => attack.communityId === war.challengerCommunityId).length;
      const defenderCount = war.attacks.filter(attack => attack.communityId === war.defenderCommunityId).length;
      const capped = challengerCount >= WAR_RULES.maxAttacksPerSide && defenderCount >= WAR_RULES.maxAttacksPerSide;
      const resolve = card.querySelector('[data-war-resolve]');
      if (resolve) resolve.disabled = !(leadership && readiness.eligible && (closed || capped));
      if (resolve && leadership && readiness.eligible && (closed || capped)) resolve.textContent = 'Resolve war · lock result';
    }
  }
}

function clearWarBaseVisuals() {
  for (const child of [...warBaseGroup.children]) {
    child.traverse(object => { if (object.isMesh) object.geometry?.dispose(); });
    warBaseGroup.remove(child);
  }
}

function buildWarBaseVisual(side) {
  clearWarBaseVisuals();
  const animationCounts = { radars: animated.radars.length, lights: animated.lights.length, chimneys: animated.chimneys.length };
  warBaseGroup.position.set(OUTPOST.x, 0, OUTPOST.z);
  for (const [key, building] of Object.entries(DEFS)) {
    const model = buildModel(key, side.base.levels[key]);
    model.position.set(building.pos[0], 0.05, building.pos[1]);
    warBaseGroup.add(model);
  }
  box(warBaseGroup, 35, 0.45, 0.65, MAT.dark, 0, 0, -17);
  box(warBaseGroup, 35, 0.45, 0.65, MAT.dark, 0, 0, 17);
  box(warBaseGroup, 0.65, 0.45, 34, MAT.dark, -17, 0, 0);
  box(warBaseGroup, 0.65, 0.45, 34, MAT.dark, 17, 0, 0);
  animated.radars.length = animationCounts.radars;
  animated.lights.length = animationCounts.lights;
  animated.chimneys.length = animationCounts.chimneys;
  warBaseGroup.visible = true;
}

function launchWarAttack(warId, tactic) {
  if (raid || warBattle) return;
  const profile = service.profile();
  const result = service.submitWarAttack(profile.id, warId, tactic);
  if (!result.ok) { showWarTable(result.error); return; }
  const war = service.getWar(warId);
  const defendingSide = profile.communityId === war.challengerCommunityId ? war.snapshots.defender : war.snapshots.challenger;
  buildWarBaseVisual(defendingSide);
  for (const building of Object.values(buildings)) building.group.visible = false;
  outpostBlocks.forEach(block => { block.visible = false; });
  const squadSize = Math.min(10, (profile.communityId === war.challengerCommunityId ? war.snapshots.challenger : war.snapshots.defender).stats.squadSize);
  const target = OUTPOST.clone().add(new THREE.Vector3(-3, 0, 0));
  const troops = [];
  for (let i = 0; i < squadSize; i++) {
    const troop = new THREE.Group();
    box(troop, 0.48, 0.8, 0.35, MAT.olive, 0, 0.45);
    box(troop, 0.17, 0.52, 0.16, MAT.dark, -0.13, 0);
    box(troop, 0.17, 0.52, 0.16, MAT.dark, 0.13, 0);
    cyl(troop, 0.2, 0.2, 0.26, MAT.olive, 0, 1.05);
    const start = new THREE.Vector3(OUTPOST.x - 22, 0, OUTPOST.z + (i - (squadSize - 1) / 2) * 1.15);
    const troopTarget = target.clone().add(new THREE.Vector3(0, 0, (i - (squadSize - 1) / 2) * 0.9));
    troop.position.copy(start);
    scene.add(troop);
    warTroopMeshes.push(troop);
    troops.push({ mesh: troop, start, target: troopTarget, phase: i * 0.45 });
  }
  warBattle = { warId, tactic, result, defenderName: defendingSide.name, squadSize, troops, time: 0, duration: 7, smokeTimer: 0 };
  camTarget.copy(OUTPOST);
  zoom = 32;
  updateCamera();
  panel.style.display = 'none';
  toast(`${tactic === 'assault' ? 'Assault' : 'Recon'} deployed · ${result.score} points · ${result.feedback}`);
  playClank();
}

function updateWarBattle(dt) {
  if (!warBattle) return;
  warBattle.time += dt;
  const progress = THREE.MathUtils.clamp(warBattle.time / warBattle.duration, 0, 1);
  for (const troop of warBattle.troops) {
    troop.mesh.position.lerpVectors(troop.start, troop.target, progress);
    troop.mesh.position.y = Math.abs(Math.sin(warBattle.time * 8 + troop.phase)) * 0.08;
    troop.mesh.rotation.y = Math.PI / 2;
  }
  warBattle.smokeTimer += dt;
  if (warBattle.smokeTimer >= 0.8 && progress > 0.65) {
    warBattle.smokeTimer = 0;
    spawnSmoke(OUTPOST.clone().add(new THREE.Vector3(-2 + Math.sin(warBattle.time) * 3, 1, Math.cos(warBattle.time) * 4)));
  }
  if (warBattle.time < warBattle.duration) return;
  for (const troop of warTroopMeshes) scene.remove(troop);
  warTroopMeshes.length = 0;
  clearWarBaseVisuals();
  warBaseGroup.visible = false;
  outpostBlocks.forEach(block => { block.visible = true; });
  for (const building of Object.values(buildings)) building.group.visible = true;
  const completed = warBattle;
  warBattle = null;
  camTarget.set(0, 0, 0);
  zoom = 28;
  updateCamera();
  toast(`${completed.result.feedback} · Open War Table for the updated score and event replay.`);
  showWarTable();
}

function launchRaid() {
  if (raid || warBattle) return;
  if (!service.getAccess().allowed) {
    toast(service.getAccess().reason);
    showWarTable();
    return;
  }
  const raidId = Math.max(state.raidCount, state.lastRaidClaimed) + 1;
  const attempt = service.recordTrainingAttempt(raidId);
  if (!attempt.ok) {
    toast(attempt.error);
    showWarTable();
    return;
  }
  closePanel();
  buildOutpost();
  const troops = [];
  const count = 2 + state.levels.hq * 2;
  for (let i = 0; i < count; i++) {
    const t = new THREE.Group();
    box(t, 0.6, 0.9, 0.4, MAT.olive);
    cyl(t, 0.25, 0.25, 0.3, MAT.purple, 0, 0.9);
    t.position.set(OUTPOST.x - 18, 0, OUTPOST.z + (i - count / 2) * 1.5);
    scene.add(t);
    troops.push(t);
  }
  raid = { id: raidId, troops, time: 0, tracers: [] };
  camTarget.copy(OUTPOST);
  zoom = 30;
  updateCamera();
  playClank();
  toast('AI training squad deployed.');
}

function updateRaid(dt) {
  raid.time += dt;
  const firepower = 25 * (1 + state.levels.tower * 0.25);
  const alive = outpostBlocks.filter(b => b.userData.hp > 0);
  for (const t of raid.troops) {
    const target = alive[0];
    if (!target) {
      break;
    }
    const dir = target.position.clone().sub(t.position).setY(0);
    if (dir.length() > 4) {
      t.position.addScaledVector(dir.normalize(), dt * 5);
      t.rotation.y = Math.atan2(dir.x, dir.z);
    } else {
      target.userData.hp -= firepower * dt;
      if (Math.random() < dt * 6) {
        spawnSmoke(target.position.clone().add(new THREE.Vector3(0, 1, 0)));
        beep(200 + Math.random() * 100, 0.04);
      }
    }
  }
  for (const b of outpostBlocks) {
    if (b.userData.hp <= 0 && b.scale.y > 0.1) {
      b.scale.y = Math.max(0.1, b.scale.y - dt * 2);
    }
  }
  if (alive.length === 0 || raid.time > 30) {
    finishRaid(alive.length === 0);
  }
}

function finishRaid(won) {
  const finished = raid;
  raid = null;
  finished.troops.forEach(t => scene.remove(t));
  let reward = 0;
  if (won) {
    const proposedReward = Math.round(250 * (1 + state.levels.comms * 0.2));
    const claim = service.recordTrainingVictory(service.state.currentIdentityId, finished.id, proposedReward);
    if (claim.ok) reward = claim.reward;
    else console.warn('Training reward was not applied:', claim.error);
  }
  panel.innerHTML = `<h2>${won ? 'TRAINING VICTORY' : 'TRAINING DEFEAT'}</h2><p>Simulated Outpost Delta ${won ? 'neutralised' : 'held out'}.</p><p>Training reward: ⚙ ${reward} Parts${won && reward === 0 ? ' · already claimed or locked' : ''}</p><div class="row"><button id="closeBtn">Return to Base</button></div>`;
  panel.style.display = 'block';
  beep(won ? 990 : 180, 0.4);
  $('closeBtn').onclick = () => {
    closePanel();
    camTarget.set(0, 0, 0);
    zoom = 28;
    updateCamera();
  };
}

// ---------- Input: pan / zoom / pick ----------
const raycaster = new THREE.Raycaster();
const pointers = new Map();
let dragDistance = 0;
let pinchStart = 0;
function pickBuildingAtClient(clientX, clientY) {
  if (!fallback2D) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    raycaster.setFromCamera(ndc, camera);
    const pickVolumes = Object.values(buildings).map(building => building.pickVolume);
    const hit = raycaster.intersectObjects(pickVolumes, false)[0];
    return hit?.object.userData.buildingKey || null;
  }
  if (camTarget.x > 35) return null;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const unit = Math.min(width, height) / Math.max(zoom, 18) * 0.68;
  const project = (x, z) => ({
    x: width * 0.53 + ((x - camTarget.x) - (z - camTarget.z)) * unit * 0.69,
    y: height * 0.53 + ((x - camTarget.x) + (z - camTarget.z)) * unit * 0.36,
  });
  let selected = null;
  let bestScore = 1;
  for (const key of Object.keys(DEFS)) {
    const asset = getBuildingAsset(key, state.levels[key]);
    const footprint = asset?.family.footprint || 5;
    const drawWidth = unit * footprint * 1.05;
    const drawHeight = drawWidth * (key === 'tower' ? 1.4 : 1.02);
    const center = project(DEFS[key].pos[0], DEFS[key].pos[1]);
    const rx = drawWidth * 0.62;
    const ry = Math.max(14, drawHeight * 0.58);
    const score = ((clientX - center.x) / rx) ** 2 + ((clientY - (center.y - drawHeight * 0.5)) / ry) ** 2;
    if (score <= bestScore) {
      bestScore = score;
      selected = key;
    }
  }
  return selected;
}
function pickLandTreeAtClient(clientX, clientY) {
  if (fallback2D || !landTreePicks.length) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
  const hit = raycaster.intersectObjects(landTreePicks, false)[0];
  return hit?.object.userData.plotId || null;
}
renderer.domElement.addEventListener('pointerdown', e => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    dragDistance = 0;
  } else if (pointers.size === 2) {
    dragDistance = 6; // A pinch gesture must never be interpreted as a building click.
    const [a, b] = [...pointers.values()];
    pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
  }
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', e => {
  const prev = pointers.get(e.pointerId);
  if (!prev) {
    return;
  }
  const dx = e.clientX - prev.x;
  const dy = e.clientY - prev.y;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    zoom = THREE.MathUtils.clamp(zoom * pinchStart / dist, 12, 60);
    pinchStart = dist;
  } else {
    dragDistance += Math.abs(dx) + Math.abs(dy);
    const scale = zoom / window.innerHeight;
    const right = new THREE.Vector3(1, 0, -1).normalize();
    const forward = new THREE.Vector3(-1, 0, -1).normalize();
    camTarget.addScaledVector(right, -dx * scale).addScaledVector(forward, dy * scale * 1.4);
    camTarget.clamp(new THREE.Vector3(-40, 0, -40), new THREE.Vector3(70, 0, 40));
  }
  updateCamera();
});
renderer.domElement.addEventListener('pointerup', e => {
  pointers.delete(e.pointerId);
  if (dragDistance < 6 && !raid && !warBattle) {
    const key = pickBuildingAtClient(e.clientX, e.clientY);
    if (key && buildings[key]) {
      beep(740);
      showBuildingPanel(key);
    } else {
      const plotId = pickLandTreeAtClient(e.clientX, e.clientY);
      if (plotId) {
        const result = service.chopTree(service.state.currentIdentityId, plotId);
        toast(result.ok ? `Tree cleared · +${result.timberEarned} Timber` : result.error);
        if (result.ok) { reconcileLandScenery(); updateHud(); }
        showLandPanel();
      } else closePanel();
    }
  }
});
renderer.domElement.addEventListener('pointercancel', e => pointers.delete(e.pointerId));
renderer.domElement.addEventListener('wheel', e => {
  zoom = THREE.MathUtils.clamp(zoom * (e.deltaY > 0 ? 1.1 : 0.9), 12, 60);
  updateCamera();
}, { passive: true });

// ---------- Loop ----------
const timer = new THREE.Timer();
let elapsed = 0;
let smokeTimer = 0;
let panelTimer = 0;
let forgeTimer = 0;
let saveTimer = 0;
const tmp = new THREE.Vector3();
renderer.setAnimationLoop(time => {
  updateCelebrations(time);
  timer.update(time);
  const dt = Math.min(0.1, timer.getDelta());
  elapsed += dt;

  const memberInventory = service.member();
  if (memberInventory) memberInventory.stored = Math.min(500, memberInventory.stored + productionRate() * dt);
  checkUpgrades();

  animated.radars.forEach(r => {
    r.rotation.y += dt * 1.5;
  });
  animated.lights.forEach(l => {
    if (l.head) {
      l.head.rotation.y = Math.sin(elapsed * 0.5) * 1.6 + 0.8;
    }
    if (l.flag) {
      l.flag.rotation.y = Math.sin(elapsed * 3) * 0.3;
    }
  });
  smokeTimer += dt;
  if (smokeTimer > 0.25) {
    smokeTimer = 0;
    animated.chimneys.forEach(c => {
      tmp.set(c.x, c.y, c.z);
      c.group.localToWorld(tmp);
      spawnSmoke(tmp);
    });
  }
  for (let i = smoke.length - 1; i >= 0; i--) {
    const p = smoke[i];
    p.userData.life += dt;
    p.position.y += dt * 1.2;
    p.position.x += dt * 0.4;
    p.scale.setScalar(1 + p.userData.life * 1.5);
    p.material.opacity = Math.max(0, 0.5 - p.userData.life * 0.2);
    if (p.userData.life > 2.5) {
      scene.remove(p);
      p.material.dispose();
      smoke.splice(i, 1);
    }
  }
  patrols.forEach(p => {
    const a = p.phase + elapsed * p.speed;
    p.mesh.position.set(Math.cos(a) * p.radius, Math.abs(Math.sin(elapsed * 8)) * 0.08, Math.sin(a) * p.radius);
    p.mesh.rotation.y = -a;
  });
  Object.values(buildings).forEach(b => {
    if (b.scaffold.visible) {
      b.scaffold.userData.crane.rotation.y = elapsed * 0.8;
      b.model.position.y = Math.sin(elapsed * 10) * 0.03;
    } else {
      b.model.position.y = 0;
    }
  });
  purpleFill.intensity = 50 + Math.sin(elapsed * 2) * 15;

  if (raid) {
    updateRaid(dt);
  }
  if (warBattle) updateWarBattle(dt);
  applyScaffoldState();
  panelTimer += dt;
  if (panelTimer > 0.5) {
    panelTimer = 0;
    updateHud();
    if (selectedKey && state.upgrades[selectedKey]) showBuildingPanel(selectedKey);
  }
  forgeTimer += dt;
  if (forgeTimer >= 1) {
    forgeTimer = 0;
    refreshForgePanel();
    refreshWarTableTimers();
  }
  saveTimer += dt;
  if (saveTimer >= 5) {
    saveTimer = 0;
    save();
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) {
      $('toast').textContent = '';
    }
  }
  renderer.render(scene, camera);
});
window.addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
updateHud();

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { GAME_CONFIG, LocalGameService, WAR_RULES, WAR_STAGE_DEFS, BATTLE_WEAR_RULES, TRAINING_COSTS, TRAINING_SECONDS } from './game-service.js';
import { BUILDING_ASSETS, getBuildingAsset } from './building-assets.js';
import { SQUAD_ROLES, squadAsset, squadPortrait, squadTier, squadUnlocked, squadProfile, evaluateWarSquad } from './squad-assets.js';
import { PATROL_NODES, PATROL_ORDERS, DEFENDER_POST_NODES, createPatrolMotion, createDefenderMotion, setPatrolOrder, stepPatrolMotion, patrolNodesForLayout, walkablePatrolPath } from './patrol-routes.js';
import { DEFENDER_CONCEPTS, DEFENDER_POSTS, defenderAsset, defenderPortrait } from './defender-assets.js';
import { buildingScaffoldState, reconcileBuildingSnapshot } from './game-runtime-state.js';
import { runServiceTests } from './service-tests.js';
import { connectedProMatches, routeBriefing } from './world-map.js';
import { FIRST_EDITION_CARDS, cardEarned } from './collectible-cards.js';
import { GRID_STEP, LAYOUT_ZONES, CORE_DEFAULTS, WALL_COSTS, MAX_WALLS_PER_HALL, layoutOccupancy, rowCells, validateLayoutPosition, validateWallPosition } from './layout-grid.js';
import { OPERATIVES, EXPEDITION_RULES, EXPEDITION_FIELD, expeditionFieldPath, FIELD_UPGRADES, PING_TYPES, OperationsController } from './operative-ops.js';
import { operativeAsset } from './operative-assets.js';
import { WAR_LANES, WAR_OBJECTIVES, WAR_METHODS, WAR_FIELD_ORDERS, WAR_DEFENCE_ORDERS, evaluateWarPlan, buildWarDamageReport } from './war-tactics.js';

// ---------- Versioned local game-service boundary ----------
const service = new LocalGameService();
const operations = new OperationsController(service);
const DEFS = {
  hq: { name: 'Command Hall', pos: [0, 0] },
  workshop: { name: 'Workshop / Forge', pos: [-9, 4] },
  tower: { name: 'Arc Battery', pos: [8, 6] },
  comms: { name: 'Communications', pos: [6, -8] },
};
let activePatrolNodes = PATROL_NODES;
let activePatrolLayout = null;
const patrols = [];
const defenderPatrols = new Map();
let operativePatrol = null;
function syncLayoutPositions() {
  const layout = service.community()?.saved.base.layout;
  if (!layout) return;
  const yardAccessible = service.community()?.saved.base.landPlots.some(plot => plot.id === 'timberline-depot' && plot.facilityLevel > 0);
  activePatrolLayout = { ...layout, yardAccessible };
  activePatrolNodes = patrolNodesForLayout(activePatrolLayout);
  for (const patrol of patrols || []) { patrol.motion.waypointNode = null; patrol.motion.waypoints = null; }
  for (const patrol of defenderPatrols?.values?.() || []) { patrol.motion.waypointNode = null; patrol.motion.waypoints = null; }
  if (operativePatrol?.motion) { operativePatrol.motion.waypointNode = null; operativePatrol.motion.waypoints = null; }
  for (const key of Object.keys(DEFS)) {
    const point = layout.structures[key];
    if (!point) continue;
    DEFS[key].pos = [point.x, point.z];
    if (buildings[key]) buildings[key].group.position.set(point.x, .05, point.z);
  }
}
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
    renderer.toneMappingExposure = 1.18;
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
const canvasSquadImages = new Map();
function getCanvasSquadImage(role, tier) {
  const path = squadPortrait(role, tier);
  if (!path) return null;
  if (!canvasSquadImages.has(path)) {
    const image = new Image();
    const record = { image, ready: false };
    image.onload = () => { record.ready = true; };
    image.onerror = () => console.warn(`Canvas 2D squad artwork failed to load: ${path}`);
    image.src = path;
    canvasSquadImages.set(path, record);
  }
  const record = canvasSquadImages.get(path);
  return record.ready ? record.image : null;
}
function drawCanvasSoldier(ctx, project, mesh, unit) {
  const image = getCanvasSquadImage(mesh.userData.squadRole || 'assault', mesh.userData.squadTier || 1);
  if (!image) return;
  const point = project(mesh.position.x, mesh.position.z);
  const size = Math.max(45, unit * 2.75);
  ctx.fillStyle = 'rgba(0,0,0,.34)';
  ctx.beginPath();
  ctx.ellipse(point.x, point.y, size * .2, size * .055, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(image, point.x - size / 2, point.y - size * .97, size, size);
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
      const facilityPoint = service.community()?.saved.base.layout?.structures[config.id];
      const center = project(facilityPoint?.x ?? x, facilityPoint?.z ?? z);
      if (plot.facilityLevel > 0) {
        const size = Math.max(16, unit * 2.6);
        ctx.fillStyle = '#29382f'; ctx.fillRect(center.x - size * .5, center.y - size * .75, size, size * .75);
        ctx.fillStyle = '#6a7b55'; ctx.beginPath(); ctx.moveTo(center.x - size * .6, center.y - size * .75); ctx.lineTo(center.x, center.y - size * 1.15); ctx.lineTo(center.x + size * .6, center.y - size * .75); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#c084fc'; ctx.fillRect(center.x - size * .37, center.y - size * .45, size * .74, Math.max(3, size * .1));
        ctx.fillStyle = '#edfaf0'; ctx.font = '700 10px Orbitron, sans-serif'; ctx.fillText(`L${plot.facilityLevel}`, center.x, center.y - size * .5);
        if (plot.wear) {
          ctx.strokeStyle = '#ff9b54'; ctx.lineWidth = 2 + plot.wear;
          ctx.beginPath(); ctx.ellipse(center.x, center.y, size * .7, size * .36, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = '#ffd2ad'; ctx.fillText(`REPAIR ${plot.wear}/${BATTLE_WEAR_RULES.maxSeverity}`, center.x, center.y + 12);
        }
      } else { ctx.fillStyle = '#70e59a'; ctx.fillRect(label.x - 3, label.y - 18, 6, 10); }
      ctx.font = '700 9px Inter, sans-serif';
      ctx.fillText(`${plot.barricades} barricades`, label.x, label.y + 11);
    }
  }
  diamond(0, 0, 15, 14, '#73766e', '#9b9e91');
  diamond(0, 0, 9.4, 8.8, 'rgba(102,112,99,.65)', 'rgba(198,202,184,.45)');
  const beaconLevel = service.community()?.saved.base.levels.hq || 1;
  const beacon = project(-8, -9);
  const beaconHeight = Math.max(20, unit * (1.4 + beaconLevel * .3));
  ctx.fillStyle = '#2a3434'; ctx.fillRect(beacon.x - 8, beacon.y - beaconHeight, 16, beaconHeight);
  ctx.fillStyle = beaconLevel >= 4 ? '#b27aea' : '#70e59a';
  ctx.fillRect(beacon.x - 5, beacon.y - beaconHeight + 4, 10, 5);
  ctx.font = '700 9px Orbitron, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#f3faf4';
  ctx.fillText(`DZN L${beaconLevel}`, beacon.x, beacon.y - beaconHeight - 5);
  for (const config of GAME_CONFIG.landPlots.slice(1)) {
    const plot = land.find(item => item.id === config.id);
    if (plot?.status !== 'claimed' || !plot.routeLevel) continue;
    const [[sx, sz], [ex, ez]] = supplyRouteEndpoints(config.position);
    const from = project(sx, sz);
    const to = project(ex, ez);
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = plot.routeLevel >= 5 ? '#b27aea' : plot.routeLevel >= 3 ? '#9da79c' : '#896746';
    ctx.lineWidth = Math.max(4, unit * (.33 + plot.routeLevel * .04)); ctx.lineCap = 'round'; ctx.stroke();
    if (plot.routeLevel >= 4) { ctx.strokeStyle = '#70e59a'; ctx.lineWidth = 2; ctx.stroke(); }
  }
  const wall = [];
  for (const [x, z] of [[-17, -17], [17, -17], [17, 17], [-17, 17]]) wall.push(project(x, z));
  ctx.beginPath(); ctx.moveTo(wall[0].x, wall[0].y); wall.slice(1).forEach(pt => ctx.lineTo(pt.x, pt.y)); ctx.closePath();
  ctx.strokeStyle = `rgba(174,188,156,${0.44 + (state.levels?.hq || 1) * 0.07})`; ctx.lineWidth = Math.max(2, unit * (0.12 + (state.levels?.hq || 1) * 0.015)); ctx.stroke();
  for (const segment of service.community()?.saved.base.layout?.walls || []) {
    const p = project(segment.x, segment.z);
    const size = Math.max(5, unit * .7);
    ctx.fillStyle = segment.level >= 4 ? '#8154ae' : segment.level >= 3 ? '#75827e' : '#76543a';
    ctx.fillRect(p.x - size, p.y - size * .75, size * 2, size * .9);
    ctx.strokeStyle = segment.level >= 4 ? '#a5ff7b' : '#bbc5b4';
    ctx.lineWidth = 2; ctx.strokeRect(p.x - size, p.y - size * .75, size * 2, size * .9);
  }

  if (camTarget.x > 35) {
    diamond(55, -10, 19, 17, '#454a3e', '#7b7c66');
    for (let i = 0; i < 5; i++) {
      const p = project(55 + [-5, 0, 5, -4, 4][i], -10 + [3, 0, 3, -4, -4][i]);
      const s = Math.max(7, unit * (i === 1 ? 3 : 1.5));
      ctx.fillStyle = i === 1 ? '#575b4d' : '#85877a'; ctx.fillRect(p.x - s / 2, p.y - s, s, s);
      if (raid && i === 0) { ctx.strokeStyle = '#ffad57'; ctx.lineWidth = 3; ctx.strokeRect(p.x - s / 2, p.y - s, s, s); }
    }
    if (raid) raid.troops.forEach(t => drawCanvasSoldier(ctx, project, t, unit));
    if (warBattle) {
      const layout = warBattle.defenderSnapshot.base.layout;
      const breached = new Set(warBattle.result.tactics?.breachedWallIds || []);
      for (const segment of layout.walls) {
        if (warBattle.time / warBattle.duration >= 0.35 && breached.has(segment.id)) continue;
        const p = project(OUTPOST.x + segment.x, OUTPOST.z + segment.z);
        ctx.fillStyle = segment.level >= 4 ? '#8254aa' : '#76857b';
        ctx.fillRect(p.x - 6, p.y - 9, 12, 11);
      }
      for (const [key, point] of Object.entries(layout.structures)) {
        if (!GAME_CONFIG.buildings[key]) continue;
        const p = project(OUTPOST.x + point.x, OUTPOST.z + point.z);
        ctx.fillStyle = key === warBattle.result.tactics?.plan.objective ? '#a86fe1' : '#596f60';
        ctx.fillRect(p.x - 15, p.y - 27, 30, 29);
        ctx.strokeStyle = '#a9c6a4'; ctx.strokeRect(p.x - 15, p.y - 27, 30, 29);
        ctx.fillStyle = '#f4fff0'; ctx.font = '700 9px Inter, sans-serif';
        ctx.fillText(key === 'hq' ? 'HALL' : key === 'tower' ? 'ARC' : key === 'comms' ? 'COMMS' : 'FORGE', p.x, p.y - 29);
      }
      const route = warBattle.result.tactics?.route;
      if (route) {
        ctx.beginPath();
        route.forEach((point, index) => { const p = project(OUTPOST.x + point.x, OUTPOST.z + point.z); if (index) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
        ctx.strokeStyle = '#c084fc'; ctx.lineWidth = 3; ctx.stroke();
      }
      warBattle.troops.forEach(troop => drawCanvasSoldier(ctx, project, troop.mesh, unit));
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
  patrols.forEach(patrol => { if (patrol.mesh.visible) drawCanvasSoldier(ctx, project, patrol.mesh, unit); });
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2420);
scene.fog = new THREE.Fog(0x1a2420, 60, 130);

let zoom = 28;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
const camTarget = new THREE.Vector3(0, 0, 0);
const cameraOffset = new THREE.Vector3(40, 40, 40);
let focusedPatrolRole = null;
function updateCameraPosition() {
  camera.position.copy(camTarget).add(cameraOffset);
  camera.lookAt(camTarget);
}
function updateCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = -zoom * aspect / 2;
  camera.right = zoom * aspect / 2;
  camera.top = zoom / 2;
  camera.bottom = -zoom / 2;
  camera.updateProjectionMatrix();
  updateCameraPosition();
}
updateCamera();
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateCamera();
});

scene.add(new THREE.HemisphereLight(0xc9e4ff, 0x55604a, 1.25));
const sun = new THREE.DirectionalLight(0xffd9a0, 2.2);
sun.position.set(30, 45, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 120 });
scene.add(sun);
// A broad opposite fill reveals black armour and textured building sides at
// normal strategy zoom without flattening the warm key light or its shadows.
const detailFill = new THREE.DirectionalLight(0xdedcff, 1.1);
detailFill.position.set(-25, 24, -20);
scene.add(detailFill);
const purpleFill = new THREE.PointLight(0xa855f7, 60, 40);
purpleFill.position.set(-6, 8, -6);
scene.add(purpleFill);
// Patrol inspection gets a close, soft key light without changing the base lighting.
const patrolFocusLight = new THREE.PointLight(0xc3ffce, 18, 6, 2);
patrolFocusLight.visible = false;
scene.add(patrolFocusLight);
const patrolFocusRing = new THREE.Mesh(
  new THREE.RingGeometry(0.62, 0.73, 40),
  new THREE.MeshBasicMaterial({ color: 0x70e59a, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false }),
);
patrolFocusRing.rotation.x = -Math.PI / 2;
patrolFocusRing.visible = false;
scene.add(patrolFocusRing);

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

// A visible home for off-duty squads. Patrols leave this clearing for assigned
// structures, stop to work or guard, then return here.
const campMat = new THREE.MeshStandardMaterial({ color: 0x182520, roughness: 0.9 });
const campAccent = new THREE.MeshStandardMaterial({ color: 0x7542a4, metalness: 0.35, roughness: 0.55 });
const campFallback = new THREE.Group();
scene.add(campFallback);
const campTent = new THREE.Mesh(new THREE.ConeGeometry(1.45, 1.35, 4), campMat);
campTent.rotation.y = Math.PI / 4;
campTent.position.set(-6.6, 0.74, -13.1);
campTent.castShadow = true;
campFallback.add(campTent);
box(campFallback, 1.2, 0.8, 0.85, MAT.dark, -6.6, 0, -13.1);
box(campFallback, 1.5, 0.15, 0.38, campAccent, -6.6, 1.34, -13.1);
for (const x of [-2.8, -1.7]) box(campFallback, 0.62, 0.53, 0.68, MAT.dark, x, 0, -13.7);
const campBeacon = cyl(campFallback, 0.1, 0.18, 1.45, MAT.dark, -2.1, 0, -10.5);
box(campFallback, 0.4, 0.19, 0.4, MAT.green, -2.1, 1.46, -10.5);

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
const animated = { radars: [], lights: [], chimneys: [], yards: [] };
let warTurretRig = null;

function addArcMuzzle(mount, distance, spread = 0.16) {
  const muzzles = [-spread, spread].map(x => {
    const node = new THREE.Group();
    node.position.set(x, 0.12, distance);
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xc7ff73, transparent: true, opacity: 0, depthWrite: false }));
    flash.userData.arcFlash = true;
    flash.scale.setScalar(0.01);
    node.add(flash);
    const light = new THREE.PointLight(0xb5ff65, 0, 5, 2);
    node.add(light);
    mount.add(node);
    return { node, flash, light };
  });
  return { muzzles, muzzle: muzzles[1].node, barrelIndex: 1 };
}

// Rosebud's Arc Battery GLBs are one textured mesh each. Keep that artwork,
// but give its upper assembly a real yaw pivot instead of spinning the base.
function articulateArcBattery(model) {
  const mesh = model.getObjectByProperty('isMesh', true);
  const position = mesh?.geometry?.getAttribute('position');
  const index = mesh?.geometry?.getIndex();
  if (!mesh || !position || !index || index.count < 12) return null;
  mesh.geometry.computeBoundingBox();
  const bounds = mesh.geometry.boundingBox;
  const cut = bounds.min.y + (bounds.max.y - bounds.min.y) * 0.61;
  const fixed = [], moving = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    ((position.getY(a) + position.getY(b) + position.getY(c)) / 3 >= cut ? moving : fixed).push(a, b, c);
  }
  if (Math.min(fixed.length, moving.length) < index.count * 0.12) return null;
  const lowerGeometry = mesh.geometry.clone();
  const upperGeometry = mesh.geometry.clone();
  lowerGeometry.setIndex(fixed);
  upperGeometry.setIndex(moving);
  lowerGeometry.userData.arcSplit = upperGeometry.userData.arcSplit = true;
  const pivotWorld = mesh.localToWorld(new THREE.Vector3((bounds.min.x + bounds.max.x) / 2, cut, (bounds.min.z + bounds.max.z) / 2));
  const rotor = mesh.clone(false);
  rotor.name = 'arc_battery_rotor';
  rotor.geometry = upperGeometry;
  rotor.castShadow = rotor.receiveShadow = true;
  mesh.geometry = lowerGeometry;
  mesh.parent.add(rotor);
  const yaw = new THREE.Group();
  yaw.name = 'arc_battery_yaw';
  model.add(yaw);
  model.updateMatrixWorld(true);
  yaw.position.copy(model.worldToLocal(pivotWorld));
  const elevation = new THREE.Group();
  elevation.name = 'arc_battery_elevation';
  elevation.position.y = (bounds.max.y - cut) * 0.15;
  yaw.add(elevation);
  const recoil = new THREE.Group();
  recoil.name = 'arc_battery_recoil';
  elevation.add(recoil);
  model.updateMatrixWorld(true);
  recoil.attach(rotor);
  const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
  const muzzleParts = addArcMuzzle(elevation, span * 0.23, span * 0.07);
  return { yaw, elevation, recoil, ...muzzleParts, flashAmount: 0 };
}

function stepArcBattery(rig, dt, time, target = null, fire = false) {
  if (!rig) return false;
  let desired = Math.sin(time * 0.45) * 0.85;
  let elevation = Math.sin(time * 0.31) * 0.035;
  if (target) {
    const local = rig.yaw.parent.worldToLocal(target.clone());
    const dx = local.x - rig.yaw.position.x;
    const dz = local.z - rig.yaw.position.z;
    desired = Math.atan2(dx, dz);
    elevation = THREE.MathUtils.clamp(-Math.atan2(
      local.y - rig.yaw.position.y - (rig.elevation?.position.y || 0),
      Math.hypot(dx, dz),
    ), -0.12, 0.16);
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion && !target) {
    desired = rig.yaw.rotation.y;
    elevation = rig.elevation?.rotation.x || 0;
  }
  const delta = Math.atan2(Math.sin(desired - rig.yaw.rotation.y), Math.cos(desired - rig.yaw.rotation.y));
  rig.yaw.rotation.y += reducedMotion ? delta : THREE.MathUtils.clamp(delta, -dt * 1.9, dt * 1.9);
  if (rig.elevation) {
    const pitchDelta = elevation - rig.elevation.rotation.x;
    rig.elevation.rotation.x += reducedMotion ? pitchDelta : THREE.MathUtils.clamp(pitchDelta, -dt * 0.9, dt * 0.9);
  }
  const remaining = Math.atan2(Math.sin(desired - rig.yaw.rotation.y), Math.cos(desired - rig.yaw.rotation.y));
  const fired = Boolean(fire && target && Math.abs(remaining) < 0.12);
  if (reducedMotion) {
    if (fired) {
      rig.barrelIndex = 1 - rig.barrelIndex;
      rig.muzzle = rig.muzzles[rig.barrelIndex].node;
    }
    rig.flashAmount = 0;
    if (rig.recoil) rig.recoil.position.z = 0;
    rig.muzzles.forEach(muzzle => { muzzle.flash.material.opacity = 0; muzzle.light.intensity = 0; });
    return fired;
  }
  if (fired) {
    rig.barrelIndex = 1 - rig.barrelIndex;
    rig.muzzle = rig.muzzles[rig.barrelIndex].node;
    rig.flashAmount = 1;
    if (rig.recoil) rig.recoil.position.z = -0.14;
  }
  rig.flashAmount = Math.max(0, rig.flashAmount - dt * 4.2);
  if (rig.recoil) rig.recoil.position.z = THREE.MathUtils.damp(rig.recoil.position.z, 0, 12, dt);
  rig.muzzles.forEach((muzzle, index) => {
    const brightness = index === rig.barrelIndex ? rig.flashAmount : 0;
    muzzle.flash.material.opacity = brightness * 0.95;
    muzzle.flash.scale.setScalar(0.01 + brightness * 1.8);
    muzzle.light.intensity = brightness * 24;
  });
  return fired;
}

function clearArcSplitGeometry(model) {
  model?.traverse(object => {
    if (object.isMesh && (object.geometry?.userData.arcSplit || object.userData.arcFlash)) object.geometry.dispose();
    if (object.userData.arcFlash) object.material.dispose();
  });
}
const revealEffects = new Map();
const celebrations = [];
let revealBannerTimer = 0;
function celebrateUpgrade(x, z, name, level, announce = true) {
  const banner = document.getElementById('upgradeReveal');
  if (banner && announce) {
    banner.querySelector('span').textContent = `${name} · Level ${level}`;
    banner.classList.remove('active');
    void banner.offsetWidth;
    banner.classList.add('active');
    clearTimeout(revealBannerTimer);
    revealBannerTimer = setTimeout(() => banner.classList.remove('active'), GAME_CONFIG.revealSeconds * 1000);
  }
  if (announce && !state.muted) { beep(660, .17); setTimeout(() => beep(880, .19), 115); setTimeout(() => beep(1100, .25), 245); }
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
  const chevrons = Array.from({ length: 8 }, (_, index) => {
    const angle = index * Math.PI / 4;
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(.28, .65, 3), new THREE.MeshBasicMaterial({ color: index % 2 ? 0xc084fc : 0x70e59a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.y = angle;
    group.add(mesh);
    return { mesh, angle };
  });
  const flash = new THREE.PointLight(0x9bffbb, 0, 13, 2);
  flash.position.y = 4;
  group.add(flash);
  scene.add(group);
  celebrations.push({ group, rings, sparks, beam, chevrons, flash, startedAt: performance.now() });
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
    effect.chevrons.forEach(({ mesh, angle }, index) => {
      const rise = Math.max(0, Math.min(1, (progress - index * .035) * 1.45));
      mesh.position.set(Math.cos(angle) * (2.1 + rise * 1.15), .35 + rise * 5.5, Math.sin(angle) * (2.1 + rise * 1.15));
      mesh.material.opacity = Math.sin(rise * Math.PI) * .8;
      mesh.rotation.z = rise * .35;
    });
    effect.flash.intensity = 4.5 * Math.sin(Math.min(1, progress * 1.5) * Math.PI);
  }
}
const gltfLoader = new GLTFLoader();
const modelTemplateCache = new Map();
const modelLoadPromises = new Map();
const animatedSquadTemplates = new Map();
const landScenery = new THREE.Group();
scene.add(landScenery);
const sceneryTemplates = new Map();
const landPickGeometry = new THREE.CylinderGeometry(1.1, 1.1, 5.5, 8);
const landPickMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
let landTreePicks = [];
let sceneryRequest = 0;

async function sceneryModel(name) {
  if (!sceneryTemplates.has(name)) {
    const assetName = /^pine_l0[1-5]$/.test(name) ? `${name}-3`
      : /^(granite_boulder|claim_marker)$/.test(name) ? `${name}-2` : name;
    sceneryTemplates.set(name, gltfLoader.loadAsync(`assets/models/scenery/${assetName}.glb?v=forest-20261023`).then(gltf => gltf.scene));
  }
  return sceneryTemplates.get(name);
}

async function facilityModel(name) {
  const key = `facility/${name}`;
  const assetName = name.startsWith('timberline_l0') ? name.replace('timberline_', 'timberline_v4_') : name;
  if (!sceneryTemplates.has(key)) sceneryTemplates.set(key, gltfLoader.loadAsync(`assets/models/facilities/${assetName}.glb?v=timberline-motion-20261023`).then(gltf => gltf.scene).catch(error => {
    sceneryTemplates.delete(key);
    console.warn(`Facility model ${name} could not load; keeping the claimed plot marker.`, error);
    return null;
  }));
  return sceneryTemplates.get(key);
}

async function routeModel(level) {
  const key = `route/${level}`;
  if (!sceneryTemplates.has(key)) sceneryTemplates.set(key, gltfLoader.loadAsync(`assets/models/routes/supply_route_l0${level}.glb`).then(gltf => gltf.scene).catch(error => {
    sceneryTemplates.delete(key);
    console.warn(`Supply route Level ${level} could not load.`, error);
    return null;
  }));
  return sceneryTemplates.get(key);
}

async function chronicleModel(level) {
  const key = `chronicle/${level}`;
  if (!sceneryTemplates.has(key)) sceneryTemplates.set(key, gltfLoader.loadAsync(`assets/models/chronicle/chronicle_beacon_l0${level}.glb`).then(gltf => gltf.scene).catch(error => {
    sceneryTemplates.delete(key);
    console.warn(`Chronicle Beacon Level ${level} could not load.`, error);
    return null;
  }));
  return sceneryTemplates.get(key);
}

async function wallModel(level) {
  const key = `wall/${level}`;
  if (!sceneryTemplates.has(key)) sceneryTemplates.set(key, gltfLoader.loadAsync(`assets/models/walls/wall_l0${level}.glb`).then(gltf => gltf.scene).catch(error => {
    sceneryTemplates.delete(key);
    console.warn(`Wall Level ${level} model could not load.`, error);
    return null;
  }));
  return sceneryTemplates.get(key);
}

function supplyRouteEndpoints([x, z]) {
  const distance = Math.hypot(x, z);
  const sideX = z / distance, sideZ = -x / distance;
  return [
    [x / distance * 13 + sideX * 7, z / distance * 13 + sideZ * 7],
    [x / distance * (distance - 3.5) + sideX * 3.8, z / distance * (distance - 3.5) + sideZ * 3.8],
  ];
}

async function reconcileLandScenery() {
  if (fallback2D) return;
  const request = ++sceneryRequest;
  const base = service.community()?.saved.base;
  if (!base) return;
  syncLayoutPositions();
  syncPatrolOrders();
  const names = [...Array.from({ length: 5 }, (_, i) => `pine_l0${i + 1}`), 'pine_stump', 'pine_log_stack', 'claim_marker', 'granite_boulder', 'fallen_trunk', 'fern_patch', 'mossy_rock_cluster', 'brush_pile', 'lumber_pallet'];
  try {
    const facilityNames = base.landPlots.filter(plot => plot.status === 'claimed' && plot.facilityLevel > 0)
      .map(plot => `${GAME_CONFIG.facilities[plot.id]?.model}_l0${plot.facilityLevel}`).filter(name => !name.startsWith('undefined'));
    if (!base.landPlots.find(plot => plot.id === 'timberline-depot')?.facilityLevel) facilityNames.push('timberline_l01');
    const routeLevels = [...new Set(base.landPlots.filter(plot => plot.status === 'claimed' && plot.routeLevel > 0).map(plot => plot.routeLevel))];
    const wallLevels = [...new Set(base.layout.walls.map(wall => wall.level))];
    const models = Object.fromEntries(await Promise.all([
      ...names.map(async name => [name, await sceneryModel(name)]),
      ...facilityNames.map(async name => [name, await facilityModel(name)]),
      ...routeLevels.map(async level => [`route_l0${level}`, await routeModel(level)]),
      ...wallLevels.map(async level => [`wall_l0${level}`, await wallModel(level)]),
      [`chronicle_l0${base.levels.hq}`, await chronicleModel(base.levels.hq)],
    ]));
    if (request !== sceneryRequest) return;
    for (const child of landScenery.children) {
      if (child.userData.ownedTerrain) { child.geometry.dispose(); child.material.dispose(); }
      if (child.userData.ownedGhost) child.traverse(object => {
        if (object.isMesh) for (const material of [].concat(object.material)) material.dispose();
      });
    }
    landScenery.clear();
    landTreePicks = [];
    animated.yards.length = 0;
    const beacon = models[`chronicle_l0${base.levels.hq}`]?.clone(true);
    if (beacon) {
      beacon.position.set(-8, .1, -9);
      beacon.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
      landScenery.add(beacon);
    }
    for (const config of GAME_CONFIG.landPlots.slice(1)) {
      const plot = base.landPlots.find(item => item.id === config.id);
      if (plot?.status !== 'claimed' || !plot.routeLevel || !models[`route_l0${plot.routeLevel}`]) continue;
      const [[sx, sz], [ex, ez]] = supplyRouteEndpoints(config.position);
      const dx = ex - sx, dz = ez - sz;
      const length = Math.hypot(dx, dz);
      const count = Math.max(1, Math.ceil(length / 3.8));
      for (let i = 0; i < count; i++) {
        const route = models[`route_l0${plot.routeLevel}`].clone(true);
        const t = (i + .5) / count;
        route.position.set(sx + dx * t, .075, sz + dz * t);
        route.rotation.y = Math.atan2(dx, dz);
        route.scale.z = length / (count * 3.8);
        route.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
        landScenery.add(route);
      }
    }
    for (const config of GAME_CONFIG.landPlots.slice(1)) {
      const plot = base.landPlots.find(item => item.id === config.id);
      if (!plot) continue;
      const [x, z] = plot.facilityLevel > 0
        ? [base.layout.structures[config.id]?.x ?? config.position[0], base.layout.structures[config.id]?.z ?? config.position[1]]
        : config.position;
      const claimed = plot.status === 'claimed';
      if (config.id === 'timberline-depot' && plot.facilityLevel === 0 && models.timberline_l01) {
        // A visible 3D blueprint makes the first district discoverable before Hall L2.
        const blueprint = models.timberline_l01.clone(true);
        blueprint.userData.ownedGhost = true;
        blueprint.position.set(x, .1, z);
        blueprint.traverse(object => {
          if (!object.isMesh) return;
          const ghostMaterial = material => {
            const clone = material.clone();
            clone.transparent = true;
            clone.opacity = .72;
            clone.depthWrite = false;
            return clone;
          };
          object.material = Array.isArray(object.material) ? object.material.map(ghostMaterial) : ghostMaterial(object.material);
        });
        landScenery.add(blueprint);
      }
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
        // Keep the 3D blueprint readable before construction; the trees still
        // ring the site and remain individually clickable for clearing.
        const radius = config.id === 'timberline-depot' ? 5.8 + (i % 3) * .55 : 1.4 + (i % 3) * .8;
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
          const point = base.layout.structures[config.id];
          facility.position.set(point?.x ?? x, 0.09, point?.z ?? z);
          facility.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
          landScenery.add(facility);
          if (config.id === 'timberline-depot') animated.yards.push({
            rotor: facility.getObjectByName('saw_rotor'),
            rollers: [0, 10, 20, 30].map(index => facility.getObjectByName(`conveyor_roller_${index}`)).filter(Boolean),
            carriage: facility.getObjectByName('saw_carriage'),
            hook: facility.getObjectByName('loading_crane_hook'),
            phase: 0,
          });
        } else {
          const marker = models.claim_marker.clone();
          marker.position.set(x, 0.09, z);
          landScenery.add(marker);
        }
        if (plot.wear) {
          const point = base.layout.structures[config.id];
          const cx = point?.x ?? x, cz = point?.z ?? z;
          const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.35 + plot.wear * .18, 36),
            new THREE.MeshBasicMaterial({ color: 0xff8c4d, transparent: true, opacity: .5, side: THREE.DoubleSide, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(cx, .14, cz);
          ring.userData.ownedTerrain = true;
          landScenery.add(ring);
          for (let i = 0; i < plot.wear; i++) {
            const scorch = new THREE.Mesh(new THREE.CircleGeometry(.45 + i * .12, 12),
              new THREE.MeshBasicMaterial({ color: 0x211e1c, transparent: true, opacity: .7, depthWrite: false, side: THREE.DoubleSide }));
            scorch.rotation.x = -Math.PI / 2;
            scorch.position.set(cx + Math.cos(i * 2.35) * 3.7, .13, cz + Math.sin(i * 2.35) * 3.7);
            scorch.userData.ownedTerrain = true;
            landScenery.add(scorch);
          }
        }
        for (let i = 0; i < plot.barricades; i++) {
          const logs = models.pine_log_stack.clone();
          const a = i * Math.PI * 2 / 3;
          logs.position.set(x + Math.cos(a) * 4.1, 0.09, z + Math.sin(a) * 4.1);
          logs.rotation.y = a + Math.PI / 2;
          landScenery.add(logs);
        }
        if (config.id === 'timberline-depot') {
          const pallet = models.lumber_pallet.clone(true);
          pallet.position.set(x + 3.9, .1, z + 2.1);
          pallet.rotation.y = -.45;
          landScenery.add(pallet);
        }
      }
      for (const [name, ox, oz, rotation] of [
        ['fern_patch', -4.75, -1.2, .3], ['mossy_rock_cluster', 4.75, 1.25, .8],
        [plot.treesRemaining ? 'brush_pile' : 'fallen_trunk', -4.65, 2.5, 1.25],
      ]) {
        const detail = models[name].clone(true);
        detail.position.set(x + ox, .09, z + oz);
        detail.rotation.y = rotation;
        detail.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
        landScenery.add(detail);
      }
    }
    for (const wall of base.layout.walls) {
      const template = models[`wall_l0${wall.level}`];
      if (!template) continue;
      const segment = template.clone(true);
      segment.position.set(wall.x, .09, wall.z);
      const horizontal = base.layout.walls.some(other => other.id !== wall.id && other.level === wall.level && other.z === wall.z && Math.abs(other.x - wall.x) === GRID_STEP);
      const vertical = base.layout.walls.some(other => other.id !== wall.id && other.level === wall.level && other.x === wall.x && Math.abs(other.z - wall.z) === GRID_STEP);
      if (vertical && !horizontal) segment.rotation.y = Math.PI / 2;
      segment.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
      landScenery.add(segment);
    }
    for (let i = 0; i < 100; i++) {
      const a = i * 2.39996;
      const radius = 32 + (i % 13) * 2.25;
      const asset = models[i % 8 === 0 ? 'granite_boulder' : `pine_l0${1 + (i % 5)}`].clone();
      asset.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      asset.rotation.y = a;
      landScenery.add(asset);
      if (i % 4 === 0) {
        const detail = models[i % 12 === 0 ? 'fallen_trunk' : i % 8 === 0 ? 'mossy_rock_cluster' : 'fern_patch'].clone(true);
        detail.position.set(Math.cos(a + .07) * (radius + 2.1), .03, Math.sin(a + .07) * (radius + 2.1));
        detail.rotation.y = a;
        landScenery.add(detail);
      }
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
    beam.rotation.x = Math.PI - Math.atan2(10, height + 6);
    head.add(beam);
    g.add(head);
    g.userData.turretRig = { yaw: head, recoil: null, ...addArcMuzzle(head, 0.72), flashAmount: 0 };
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

// Keep the squad home beside the camp route node so patrols walk to its open
// entrance. The procedural shelter remains available only if the GLB fails.
const campAssetPath = 'assets/models/camps/dzn-squad-bivouac-for-a-realistic-isometric-3d-survival-strategy-game-one-open-s.glb';
if (!fallback2D) loadBuildingTemplate(campAssetPath).then(template => {
  const shelter = template.clone(true);
  shelter.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(shelter);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const footprint = Math.max(size.x, size.z);
  if (!Number.isFinite(footprint) || footprint <= 0 || !Number.isFinite(bounds.min.y)) throw new Error('Camp GLB has empty bounds.');
  shelter.position.set(-center.x, -bounds.min.y, -center.z);
  shelter.traverse(object => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  const camp = new THREE.Group();
  camp.position.set(-6, 0.05, -12.2);
  camp.scale.setScalar(4 / footprint);
  camp.add(shelter);
  scene.add(camp);
  campFallback.visible = false;
}).catch(error => console.warn(`Unable to load DZN squad camp GLB (${campAssetPath}); keeping fallback shelter.`, error));

function loadAnimatedSquad(path) {
  if (!animatedSquadTemplates.has(path)) {
    animatedSquadTemplates.set(path, gltfLoader.loadAsync(path).catch(error => {
      animatedSquadTemplates.delete(path);
      throw error;
    }));
  }
  return animatedSquadTemplates.get(path);
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
  if (key === 'tower') normalized.userData.turretRig = articulateArcBattery(normalized);
  return normalized;
}

let rendererDiagnosticMessage = '';
function setRendererDiagnostic(message) {
  if (message !== undefined) rendererDiagnosticMessage = message;
  const status = document.getElementById('rendererStatus');
  if (!status) return;
  status.textContent = rendererDiagnosticMessage || (fallback2D ? 'Canvas 2D compatibility · DZN squad art' : 'Three.js WebGL · articulated 3D squads');
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
    if (previous) { building.group.remove(previous); clearArcSplitGeometry(previous); }
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
    projects: service.community()?.saved.base.projects || [],
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
syncLayoutPositions();
if (!fallback2D) for (const key of Object.keys(DEFS)) requestBuildingModel(key, state.levels[key]);
applyScaffoldState();

// Keep the owner's detailed character sheets in the Armoury. In the world, load
// actual three-dimensional GLBs so the named limb pivots can walk and turn.
function bindSquadEquipment(model, role) {
  const right = model.getObjectByName('right_arm');
  const left = model.getObjectByName('left_arm');
  const held = {
    assault: ['carbine_barrel', 'carbine_body', 'carbine_sight'],
    recon: ['scanner', 'scanner_screen'],
    engineer: ['axe_handle', 'axe_head'],
    sentinel: ['heavy_carbine', 'heavy_barrel', 'reflex_sight', 'drum_magazine'],
    medic: ['aid_injector', 'injector_charge'],
  };
  // The older articulated kits store tools in world coordinates beside the
  // forearm. Move each tool's grip onto the glove before parenting it, so the
  // whole item follows the shoulder instead of floating alongside the soldier.
  const gripOffset = {
    recon: [-.04, -.16, -.315], engineer: [-.10, -.07, -.285],
    sentinel: [-.06, -.18, -.23], medic: [-.06, -.17, -.285],
  }[role] || [0, 0, 0];
  model.updateMatrixWorld(true);
  for (const name of held[role] || []) {
    const part = model.getObjectByName(name);
    if (right && part) {
      right.attach(part);
      part.position.add(new THREE.Vector3(...gripOffset));
    }
  }
  if (role === 'assault' && left) for (const name of ['forearm_shield', 'shield_light']) {
    const part = model.getObjectByName(name);
    if (part) left.attach(part);
  }
}
function equipSoldier(soldier, role, tier) {
  const path = squadAsset(role, tier);
  if (soldier.userData.squadAsset === path) return;
  soldier.userData.squadAsset = path;
  soldier.userData.squadRole = role;
  soldier.userData.squadTier = tier;
  const token = (soldier.userData.loadToken || 0) + 1;
  soldier.userData.loadToken = token;
  soldier.userData.walkMixer?.stopAllAction();
  soldier.userData.walkMixer = null;
  soldier.userData.walkAction = null;
  soldier.userData.idleAction = null;
  soldier.userData.activeAction = null;
  soldier.clear();
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), new THREE.MeshBasicMaterial({ color: 0x020503, transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.025;
  soldier.add(shadow);
  const rigged = role === 'assault' || role === 'recon' || role === 'engineer' || role === 'medic' || role === 'sentinel';
  const request = rigged ? loadAnimatedSquad(path) : loadBuildingTemplate(path);
  request.then(asset => {
    if (soldier.userData.loadToken !== token || soldier.userData.squadAsset !== path) return;
    const model = rigged ? cloneSkeleton(asset.scene) : asset.clone(true);
    model.name = 'squad_model';
    if (!rigged) bindSquadEquipment(model, role);
    model.traverse(item => { if (item.isMesh) { item.castShadow = true; item.receiveShadow = true; } });
    soldier.add(model);
    if (rigged) {
      const clip = asset.animations.find(animation => animation.name === (role === 'assault' ? 'DZN_Warden_Walk' : 'DZN_Operative_Walk')) || asset.animations[0];
      if (!clip) throw new Error(`Animated squad model has no walk clip: ${path}`);
      // The Warden source faces +X; image-guided Ghost, Fixer, Lifeline and Sentinel face +Z.
      if (role === 'assault') model.rotation.y = -Math.PI / 2;
      const mixer = new THREE.AnimationMixer(model);
      soldier.userData.walkMixer = mixer;
      soldier.userData.walkAction = mixer.clipAction(clip);
      // The Warden source only contains a walk. Hold its first keyed pose as a
      // real idle clip so waiting at a building never freezes a mid-step frame.
      const idleClip = asset.animations.find(animation => animation.name === 'DZN_Operative_Idle') ||
        (role === 'assault' ? new THREE.AnimationClip('DZN_Warden_Idle', 1, clip.tracks.map(track => {
          const size = track.getValueSize();
          const first = Array.from(track.values.slice(0, size));
          return new track.constructor(track.name, [0, 1], [...first, ...first]);
        })) : null);
      soldier.userData.idleAction = idleClip ? mixer.clipAction(idleClip) : null;
      soldier.userData.activeAction = soldier.userData.idleAction || soldier.userData.walkAction;
      soldier.userData.activeAction.play();
      if (role !== 'assault') return;
      loadAnimatedSquad('assets/models/squads-v6/warden_carbine.glb').then(weapon => {
        if (soldier.userData.loadToken !== token || soldier.userData.squadAsset !== path) return;
        const carbine = weapon.scene.clone(true);
        carbine.name = 'warden_carbine';
        carbine.rotation.y = Math.PI / 2;
        carbine.scale.setScalar(0.84 + tier * 0.04);
        carbine.position.set(0.18, 1.03, -0.23);
        carbine.traverse(item => { if (item.isMesh) item.castShadow = true; });
        model.add(carbine);
        model.updateMatrixWorld(true);
        const hand = model.getObjectByName('Hand_R');
        if (hand) hand.attach(carbine);
        else console.warn('DZN Warden rig has no right hand for its carbine.');
      }).catch(weaponError => console.warn('DZN Warden carbine could not load.', weaponError));
    }
  }).catch(error => {
    if (soldier.userData.loadToken !== token) return;
    console.warn(`DZN squad model could not load: ${path}`, error);
    if (!rigged) return;
    const current = soldier.getObjectByName('squad_model');
    if (current) soldier.remove(current);
    loadBuildingTemplate(`assets/models/squads-v5/${role}_l0${tier}.glb`).then(template => {
      if (soldier.userData.loadToken !== token) return;
      const fallback = template.clone(true);
      fallback.name = 'squad_model';
      bindSquadEquipment(fallback, role);
      soldier.add(fallback);
    }).catch(fallbackError => console.warn('DZN Warden fallback model could not load.', fallbackError));
  });
}
function makeSoldier(role, levels) {
  const soldier = new THREE.Group();
  equipSoldier(soldier, role, squadTier(role, levels));
  return soldier;
}
function animateSoldier(soldier, phase, pace = 1, stop = null, dt = 1 / 60) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (soldier.userData.walkMixer) {
    const nextAction = pace > 0.05 ? soldier.userData.walkAction : soldier.userData.idleAction;
    if (nextAction && nextAction !== soldier.userData.activeAction) {
      nextAction.reset().play();
      soldier.userData.activeAction.crossFadeTo(nextAction, .18, false);
      soldier.userData.activeAction = nextAction;
    }
    soldier.userData.walkMixer.update(Math.max(0, dt) * (pace > 0.05 ? pace : (soldier.userData.idleAction ? 1 : 0)));
    const model = soldier.getObjectByName('squad_model');
    if (model && soldier.userData.squadRole === 'assault') {
      // The image-guided Warden arrived with a loose arm gait. Keep both hands
      // forward around the rifle while the imported leg walk still plays.
      for (const [name, forward, across, tuck] of [['UpperArm_R', .62, -.35, -.6], ['Forearm_R', .45, -.1, -.35], ['UpperArm_L', .7, .35, .6], ['Forearm_L', .28, .1, .35]]) {
        const limb = model.getObjectByName(name);
        if (limb) {
          limb.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tuck));
          limb.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), across));
          limb.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), forward));
        }
      }
    }
    if (model) model.position.y = pace ? Math.abs(Math.sin(phase)) * .015 : Math.sin(phase * .5) * .006;
    return;
  }
  const swing = Math.sin(phase) * 0.42 * pace;
  const equipped = ['recon', 'engineer', 'sentinel', 'medic'].includes(soldier.userData.squadRole);
  for (const [name, angle] of [['left_leg', swing], ['right_leg', -swing], ['left_arm', equipped && soldier.userData.squadRole === 'sentinel' ? -.26 - swing * .15 : -swing * .55], ['right_arm', equipped ? -.34 + swing * .22 : swing * .65]]) {
    const limb = soldier.getObjectByName(name);
    if (limb) limb.rotation.x = angle;
  }
  const model = soldier.getObjectByName('squad_model');
  if (model) {
    model.position.y = pace ? Math.abs(Math.sin(phase)) * .035 : Math.sin(phase * .5) * .006;
    model.rotation.y = !pace && stop ? Math.sin(phase * .35) * .08 : 0;
  }
  if (pace || !stop) return;
  const role = soldier.userData.squadRole;
  const right = soldier.getObjectByName('right_arm');
  const left = soldier.getObjectByName('left_arm');
  if (role === 'engineer' && (stop === 'workshop' || stop === 'hall')) {
    if (right) right.rotation.x = -.48 + Math.sin(phase * 2.2) * .24;
    if (left) left.rotation.x = -.2;
  } else if (role === 'recon' && stop === 'comms') {
    if (right) right.rotation.x = -.62 + Math.sin(phase) * .06;
    if (left) left.rotation.x = -.28;
  } else if (role === 'medic' && stop === 'workshop') {
    if (right) right.rotation.x = -.5 + Math.sin(phase * 1.4) * .12;
    if (left) left.rotation.x = -.22;
  } else if ((role === 'assault' || role === 'sentinel') && (stop === 'tower' || stop === 'hall')) {
    if (right) right.rotation.x = -.16;
    if (left) left.rotation.x = -.12;
  }
}

// Patrol soldiers
for (let i = 0; i < 5; i++) {
  const role = ['assault', 'recon', 'engineer', 'sentinel', 'medic'][i];
  const soldier = makeSoldier(role, state.levels);
  const motion = createPatrolMotion(role, i);
  soldier.position.set(motion.x, 0, motion.z);
  scene.add(soldier);
  patrols.push({ mesh: soldier, role, motion });
}
function syncPatrolKits() { for (const patrol of patrols) equipSoldier(patrol.mesh, patrol.role, squadTier(patrol.role, state.levels)); }
function syncPatrolOrders() {
  const base = service.community()?.saved.base;
  const orders = base?.patrolOrders || {};
  const yardRoute = activePatrolLayout?.yardAccessible ? ['workshop', 'yard', 'camp', 'workshop'] : null;
  const workSite = base?.projects.filter(project => project.status === 'constructing' && project.startedAt <= Date.now()).sort((a, b) => a.finishAt - b.finishAt)[0];
  const engineerRoute = workSite ? ['camp', workSite.key === 'hq' ? 'hall' : workSite.key, 'camp'] : yardRoute;
  for (const patrol of patrols) setPatrolOrder(patrol.motion, orders[patrol.role] || 'standard', patrol.role === 'engineer' ? engineerRoute : null);
}
// One chosen commander is physically present at the bivouac while at home.
// Its existing role route leads to a useful building and back, with the same
// wall/building avoidance as the ordinary patrols.
const operativeMesh = new THREE.Group();
scene.add(operativeMesh);
operativePatrol = { mesh: operativeMesh, id: null, motion: null, loadToken: 0, mixer: null, action: null, actionName: null, away: false };
function syncOperativePatrol() {
  const identityId = service.state.currentIdentityId;
  const id = operations.selected(identityId);
  const role = OPERATIVES[id]?.role;
  const access = service.getAccess().allowed;
  const away = operations.current(identityId)?.status === 'active';
  const visible = Boolean(!fallback2D && access && role && !away);
  operativeMesh.visible = visible;
  if (!visible) { operativePatrol.away = away; return; }
  if (operativePatrol.id === id && !operativePatrol.away) return;
  operativePatrol.away = false;
  operativePatrol.id = id;
  operativePatrol.loadToken++;
  operativePatrol.mixer?.stopAllAction();
  operativePatrol.mixer = null;
  operativePatrol.action = null;
  operativePatrol.actionName = null;
  operativeMesh.clear();
  const motion = createPatrolMotion(role, role === 'engineer' ? 2 : 0);
  motion.wait = 3;
  operativePatrol.motion = motion;
  operativeMesh.position.set(motion.x, 0, motion.z);
  const ring = new THREE.Mesh(new THREE.RingGeometry(.48, .57, 32),
    new THREE.MeshBasicMaterial({ color: OPERATIVES[id].colour, transparent: true, opacity: .76, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = .045;
  ring.name = 'commander_ground_marker';
  operativeMesh.add(ring);
  const token = operativePatrol.loadToken;
  const path = operativeAsset(id);
  loadAnimatedSquad(path).then(asset => {
    if (token !== operativePatrol.loadToken || operativePatrol.id !== id) return;
    const model = cloneSkeleton(asset.scene);
    model.name = 'operative_model';
    model.traverse(item => { if (item.isMesh) { item.castShadow = true; item.receiveShadow = true; } });
    operativeMesh.add(model);
    const walk = asset.animations.find(clip => clip.name === 'DZN_Operative_Walk');
    const idle = asset.animations.find(clip => clip.name === 'DZN_Operative_Idle');
    if (!walk || !idle) throw new Error(`DZN operative is missing walk or idle animation: ${path}`);
    operativePatrol.mixer = new THREE.AnimationMixer(model);
    operativePatrol.actions = { walk: operativePatrol.mixer.clipAction(walk), idle: operativePatrol.mixer.clipAction(idle) };
    operativePatrol.action = operativePatrol.actions.idle;
    operativePatrol.actionName = 'idle';
    operativePatrol.action.play();
  }).catch(error => console.warn(`DZN operative 3D model could not load: ${path}`, error));
}

function defenderLimbPivot(model, name) {
  const limb = model.getObjectByName(name);
  if (!limb?.parent) return null;
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(limb);
  if (bounds.isEmpty()) return null;
  const shoulder = bounds.getCenter(new THREE.Vector3());
  shoulder.y = bounds.max.y - (bounds.max.y - bounds.min.y) * 0.08;
  const parent = limb.parent;
  const pivot = new THREE.Group();
  pivot.name = `${name}_pivot`;
  parent.add(pivot);
  parent.updateMatrixWorld(true);
  pivot.position.copy(parent.worldToLocal(shoulder));
  pivot.updateMatrixWorld(true);
  pivot.attach(limb);
  return pivot;
}

function bindDefenderRig(model, role) {
  const limbs = Object.fromEntries(['left_arm', 'right_arm', 'left_leg', 'right_leg',
    'left_front_leg', 'right_front_leg', 'left_rear_leg', 'right_rear_leg', 'hound_head']
    .map(name => [name, defenderLimbPivot(model, name)]));
  for (const name of ['barrier_shield', 'scanner', 'left_drone', 'right_drone', 'tail',
    'snare_module_0', 'snare_module_1', 'snare_module_2',
    'snare_charge_0', 'snare_charge_1', 'snare_charge_2']) limbs[name] = model.getObjectByName(name);
  model.updateMatrixWorld(true);
  const held = role === 'guardian' ? { left_arm: ['barrier_shield'] }
    : role === 'aegis' ? { right_arm: ['scanner', 'scanner_screen'] } : {};
  for (const [armName, names] of Object.entries(held)) for (const name of names) {
    const part = model.getObjectByName(name);
    const arm = model.getObjectByName(armName);
    if (part && arm) arm.attach(part);
  }
  return limbs;
}

function syncDefenderPatrols() {
  const assigned = service.community()?.saved.base.defenders || {};
  for (const role of Object.keys(DEFENDER_CONCEPTS)) {
    const unit = assigned[role];
    const previous = defenderPatrols.get(role);
    if (previous && unit?.level === previous.level && unit?.post === previous.post) continue;
    if (previous) { previous.active = false; scene.remove(previous.mesh); defenderPatrols.delete(role); }
    if (!unit?.level || !unit.post || fallback2D) continue;
    const mesh = new THREE.Group();
    const motion = createDefenderMotion(role, unit.post);
    mesh.position.set(motion.x, 0, motion.z);
    scene.add(mesh);
    const patrol = { role, level: unit.level, post: unit.post, mesh, motion, active: true };
    defenderPatrols.set(role, patrol);
    loadBuildingTemplate(defenderAsset(role, unit.level)).then(template => {
      if (!patrol.active) return;
      const model = template.clone(true);
      model.traverse(item => { if (item.isMesh) { item.castShadow = true; item.receiveShadow = true; } });
      mesh.add(model);
      patrol.limbs = bindDefenderRig(model, role);
      patrol.model = model;
    }).catch(error => console.warn(`${DEFENDER_CONCEPTS[role].name} model could not load`, error));
  }
}
function animateDefender(patrol, time = elapsed, threat = 0) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const { mesh, motion, role } = patrol;
  const limbs = patrol.limbs || mesh.userData.defenderLimbs;
  if (!limbs) return;
  const moving = Boolean(motion.moving);
  const swing = Math.sin(motion.stride) * (moving ? 0.34 : 0);
  if (role === 'hound') {
    for (const [name, sign] of [['left_front_leg', 1], ['right_rear_leg', 1], ['right_front_leg', -1], ['left_rear_leg', -1]]) {
      const leg = limbs[name];
      if (leg) leg.rotation.x = swing * sign;
    }
    if (limbs.hound_head) limbs.hound_head.rotation.y = Math.sin(time * (threat ? 3 : 0.8)) * (moving ? 0.08 : 0.24);
    if (limbs.tail) limbs.tail.rotation.y = Math.sin(time * (threat ? 7 : 2)) * 0.2;
  } else {
    if (limbs.left_leg) limbs.left_leg.rotation.x = swing;
    if (limbs.right_leg) limbs.right_leg.rotation.x = -swing;
    if (limbs.left_arm) limbs.left_arm.rotation.x = (role === 'guardian' ? -0.28 - threat * 0.5 : role === 'aegis' ? -0.2 : -0.12) - swing * 0.22;
    if (limbs.right_arm) limbs.right_arm.rotation.x = (role === 'aegis' ? -0.46 - threat * 0.3 : role === 'trapper' ? -0.25 - threat * 0.35 : -0.12) + swing * 0.28;
  }
  if (limbs.barrier_shield) limbs.barrier_shield.rotation.y = Math.sin(time * 5) * threat * 0.04;
  if (patrol.model) patrol.model.position.y = moving ? Math.abs(Math.sin(motion.stride)) * 0.025 : Math.sin(time * 1.4) * 0.006;
  if (role === 'aegis') for (const [index, name] of ['left_drone', 'right_drone'].entries()) {
    const drone = limbs[name];
    if (drone) {
      if (!drone.userData.restPosition) drone.userData.restPosition = drone.position.clone();
      const rest = drone.userData.restPosition;
      drone.position.set(rest.x + Math.sin(time * (1 + threat * 2) + index * Math.PI) * threat * 0.26,
        rest.y + Math.sin(time * (2 + threat * 3) + index * Math.PI) * (0.09 + threat * 0.08),
        rest.z + Math.cos(time * (1 + threat * 2) + index * Math.PI) * threat * 0.2);
      drone.rotation.y = Math.sin(time * (0.7 + threat * 2) + index * Math.PI) * (0.35 + threat * 0.5);
    }
  }
  if (role === 'trapper') for (let index = 0; index < 3; index++) {
    const snareModule = limbs[`snare_module_${index}`];
    const charge = limbs[`snare_charge_${index}`];
    if (snareModule) snareModule.rotation.y = Math.sin(time * (1.1 + threat * 3) + index * 2) * (0.06 + threat * 0.18);
    if (charge) {
      if (!charge.userData.restScale) charge.userData.restScale = charge.scale.clone();
      charge.scale.copy(charge.userData.restScale).multiplyScalar(1 + Math.sin(time * (3 + threat * 5) + index * 2) * (0.06 + threat * 0.12));
    }
  }
}
syncDefenderPatrols();
let defenderPreview = null;
let defenderPreviewToken = 0;
function placeDefenderPreview(role, level) {
  const path = defenderAsset(role, level);
  if (!path) return;
  const token = ++defenderPreviewToken;
  if (defenderPreview) { scene.remove(defenderPreview); defenderPreview = null; }
  loadBuildingTemplate(path).then(template => {
    if (token !== defenderPreviewToken) return;
    const model = template.clone(true);
    model.position.set(-2, 0.07, -8);
    model.rotation.y = -0.6;
    model.scale.setScalar(1.25);
    model.traverse(item => { if (item.isMesh) { item.castShadow = true; item.receiveShadow = true; } });
    model.userData.cosmeticConcept = true;
    defenderPreview = model;
    scene.add(model);
  }).catch(error => console.warn(`Defender concept could not load: ${path}`, error));
  toast(`${DEFENDER_CONCEPTS[role].name} L${level} · 3D concept at squad camp · no battle effect`);
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
let outpostReady = null;
const warBaseGroup = new THREE.Group();
warBaseGroup.visible = false;
scene.add(warBaseGroup);
const warTroopMeshes = [];
const warFillLight = new THREE.HemisphereLight(0xe4d5ff, 0x56664b, 1.05);
const warKeyLight = new THREE.DirectionalLight(0xd8e9ff, 2.3);
warKeyLight.position.copy(OUTPOST).add(new THREE.Vector3(-18, 22, 9));
warKeyLight.target.position.copy(OUTPOST);
const warDefenderMeshes = [];
const warWallMeshes = [];
let warDefenderToken = 0;
function buildOutpost() {
  if (outpostBlocks.length) {
    for (const building of outpostBlocks) {
      building.userData.hp = building.userData.maxHp;
      building.userData.shotClock = 0;
      building.scale.setScalar(1);
      building.visible = true;
    }
    return outpostReady;
  }
  const layout = [['hq', 0, 0], ['workshop', -7, 5], ['tower', 7, 5], ['comms', 0, -7]];
  const loads = layout.map(([key, x, z]) => {
    const building = new THREE.Group();
    building.position.set(OUTPOST.x + x, 0, OUTPOST.z + z);
    building.userData.structureKey = key;
    building.userData.maxHp = key === 'hq' ? 220 : 160;
    building.userData.hp = building.userData.maxHp;
    building.userData.shotClock = 0;
    scene.add(building);
    outpostBlocks.push(building);
    const asset = getBuildingAsset(key, 1);
    return loadBuildingTemplate(asset.glb).then(template => {
      const model = normalizeBuildingClone(template, key, 1);
      building.add(model);
      building.userData.turretRig = model.userData.turretRig || null;
    }).catch(error => {
      console.warn(`Training outpost ${key} model could not load; using procedural building.`, error);
      const fallback = buildModel(key, 1);
      building.add(fallback);
      building.userData.turretRig = fallback.userData.turretRig || null;
    });
  });
  outpostReady = Promise.all(loads);
  return outpostReady;
}
buildOutpost();

// ---------- UI: identity, shared projects, progression and Forge ----------
const $ = id => document.getElementById(id);
const panel = $('panel');
const patrolFocusExit = document.createElement('button');
patrolFocusExit.type = 'button';
patrolFocusExit.hidden = true;
patrolFocusExit.textContent = '← Back to base';
patrolFocusExit.style.cssText = 'position:fixed;z-index:9;left:50%;bottom:18px;transform:translateX(-50%);box-shadow:0 8px 30px #000a';
document.body.append(patrolFocusExit);
function stopPatrolFocus(returnToBase = false) {
  focusedPatrolRole = null;
  patrolFocusExit.hidden = true;
  patrolFocusExit.textContent = '← Back to base';
  patrolFocusLight.visible = false;
  patrolFocusRing.visible = false;
  if (returnToBase) { camTarget.set(0, 0, 0); zoom = 28; updateCamera(); }
}
function focusedPatrol() {
  if (!focusedPatrolRole) return null;
  return focusedPatrolRole.startsWith('defender:')
    ? defenderPatrols.get(focusedPatrolRole.slice('defender:'.length))
    : patrols.find(item => item.role === focusedPatrolRole);
}
patrolFocusExit.onclick = () => stopPatrolFocus(true);
let selectedKey = null;
let raid = null;
let raidLaunching = false;
const trainingHud = document.createElement('div');
trainingHud.hidden = true;
trainingHud.setAttribute('role', 'status');
trainingHud.style.cssText = 'position:fixed;z-index:8;right:12px;top:64px;max-width:min(300px,calc(100vw - 24px));padding:9px 12px;border:1px solid #70e59a88;border-radius:10px;background:#0d1914ee;color:#edf4ee;font:700 11px Inter,system-ui,sans-serif;box-shadow:0 8px 25px #0008';
document.body.append(trainingHud);
const warHud = document.createElement('div');
warHud.hidden = true;
warHud.setAttribute('role', 'status');
warHud.style.cssText = trainingHud.style.cssText.replace('#70e59a88', '#c084fc88');
document.body.append(warHud);
const warOrders = document.createElement('div');
warOrders.hidden = true;
warOrders.setAttribute('aria-label', 'Battle field orders');
warOrders.style.cssText = 'position:fixed;z-index:9;right:12px;top:154px;width:min(360px,calc(100vw - 24px));padding:11px;border:1px solid #c084fc88;border-radius:10px;background:#101421f2;color:#edf4ee;font:12px Inter,system-ui,sans-serif;box-shadow:0 8px 25px #0009';
document.body.append(warOrders);
let warBattle = null;
let fieldSession = null;
let toastTimer = 0;
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function toast(text) {
  $('toast').textContent = text;
  toastTimer = 2.5;
}
function openPanel(html) {
  document.querySelectorAll('.hud-menu[open]').forEach(menu => { menu.open = false; });
  panel.innerHTML = `<button type="button" class="panel-dismiss" aria-label="Close panel">×</button>${html}`;
  panel.querySelector('.panel-dismiss').onclick = closePanel;
  panel.style.display = 'block';
  panel.scrollTop = 0;
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
    syncLayoutPositions();
    reconcileBasePresentation();
    reconcileLandScenery();
    syncPatrolKits();
    syncPatrolOrders();
    syncDefenderPatrols();
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
function currentAwaySquads() {
  const profile = service.profile();
  return service.getWars(profile.id).filter(war => ['preparation', 'active'].includes(war.state))
    .flatMap(war => service.getAwaySquads(profile.communityId, war.id));
}
function updateHud() {
  const profile = service.profile();
  const community = service.getCommunityInfo();
  const access = service.getAccess();
  $('communityBadge').textContent = `${access.allowed ? '●' : '🔒'} ${community.name} · ${community.proActive ? 'OWNER PRO ACTIVE' : 'PRO INACTIVE'} · ${profile.role.toUpperCase()}`;
  const away = currentAwaySquads().length;
  const defenceChip = $('defenceChip');
  defenceChip.hidden = away === 0;
  defenceChip.classList.toggle('exposed', away > 0);
  defenceChip.textContent = `${away} SQUAD${away === 1 ? '' : 'S'} AWAY · HOME EXPOSED`;
  let deployed = 0;
  patrols.forEach(patrol => {
    const unlocked = squadUnlocked(patrol.role, state.levels);
    patrol.mesh.visible = unlocked && deployed >= Math.min(away, 3);
    if (unlocked) deployed++;
  });
  if (focusedPatrolRole && !focusedPatrol()?.mesh.visible) stopPatrolFocus(true);
  for (const patrol of defenderPatrols.values()) patrol.mesh.visible = access.allowed;
  syncOperativePatrol();
  if (fieldSession) for (const object of fieldSession.hiddenObjects) object.visible = false;
  $('parts').textContent = access.allowed ? `⚙ ${Math.floor(state.parts)} Parts` : '⚙ Locked';
  $('salvage').textContent = access.allowed ? `♻ ${Math.floor(state.salvage)} Salvage` : '♻ Locked';
  $('timber').textContent = access.allowed ? `🪵 ${Math.floor(state.timber)} Timber` : '🪵 Locked';
  $('treasury').textContent = access.allowed ? `🏦 ${Math.floor(state.treasury)} Unallocated` : '🏦 Locked';
  $('collectBtn').textContent = `Collect +${Math.floor(state.stored)}`;
  const production = service.getProductionInfo();
  $('collectBtn').title = production ? `Workshop / Forge: ${Math.floor(production.stored)}/${production.capacity} Parts stored · ${production.perSecond} Parts/sec. ${production.perSecond ? 'Production continues while away until storage is full.' : 'Production is paused until this community has access.'}` : '';
  $('collectBtn').disabled = !access.allowed || state.stored < 1;
  $('muteBtn').textContent = state.muted ? '🔇' : '🔊';
  const yard = service.community()?.saved.base.landPlots.find(plot => plot.id === 'timberline-depot');
  const yardProduction = service.getTimberProductionInfo();
  $('yardBtn').textContent = yard?.facilityLevel ? `🪵 Yard L${yard.facilityLevel}${Math.floor(yardProduction?.stored || 0) ? ` · ${Math.floor(yardProduction.stored)} ready` : ''}` : state.levels.hq < 2 ? '🪵 Lumber Yard · Hall L2' : '🪵 Lumber Yard';
  $('yardBtn').title = yardProduction?.level ? `${Math.floor(yardProduction.stored)}/${yardProduction.capacity} Timber stored · ${yardProduction.perMinute} Timber/min. Open the Yard to collect.` : 'Clear and claim Timberline Depot, then fund its Lumber Yard.';
  updatePreviewCard();
  updateBuildingList();
}
function formatRemaining(timestamp) {
  const seconds = Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
function constructionStatus(project) {
  if (project.status === 'completed') return 'Complete';
  if (project.status === 'constructing') return project.startedAt > Date.now()
    ? `Crew ${project.crewSlot + 1} queued · starts in ${formatRemaining(project.startedAt)}`
    : `Crew ${project.crewSlot + 1} building · ${formatRemaining(project.finishAt)} remaining`;
  return 'Funding';
}
function startReveal(key) {
  const building = buildings[key];
  if (!building) return;
  const previousLevels = { ...state.levels, [key]: Math.max(1, state.levels[key] - 1) };
  refreshBuilding(key);
  syncPatrolKits();
  building.scaffold.visible = true;
  revealEffects.set(key, Date.now() + GAME_CONFIG.revealSeconds * 1000);
  celebrateUpgrade(DEFS[key].pos[0], DEFS[key].pos[1], DEFS[key].name, state.levels[key]);
  for (const [role, definition] of Object.entries(SQUAD_ROLES)) {
    const tier = squadTier(role, state.levels);
    if (squadUnlocked(role, state.levels) && !squadUnlocked(role, previousLevels)) celebrateUpgrade(DEFS[key].pos[0], DEFS[key].pos[1], `${definition.name} deployed`, tier, false);
    else if (squadUnlocked(role, state.levels) && tier > squadTier(role, previousLevels)) celebrateUpgrade(DEFS[key].pos[0], DEFS[key].pos[1], `${definition.name} kit upgraded`, tier, false);
  }
  if (key === 'hq') {
    reconcileLandScenery();
    celebrateUpgrade(-8, -9, 'DZN Chronicle Beacon', state.levels.hq, false);
  }
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
  const activeProject = service.community().saved.base.projects.find(project => project.key === key && ['approved', 'constructing'].includes(project.status));
  const cfg = GAME_CONFIG.buildings[key];
  const currentStats = cfg.stats[level - 1];
  const nextStats = requirement.targetLevel <= GAME_CONFIG.maxLevel ? cfg.stats[requirement.targetLevel - 1] : null;
  let html = `<h2>${escapeHTML(def.name)} · Level ${level}/5</h2><p><span class="dim">Now:</span> ${escapeHTML(requirement.currentBenefit)}</p>`;
  if (requirement.targetLevel <= GAME_CONFIG.maxLevel) {
    html += `<p><b>Next · Level ${requirement.targetLevel}:</b> ${escapeHTML(requirement.nextBenefit)}</p><p><b>Cost:</b> ${requirement.cost.toLocaleString()} Parts</p>`;
    if (requirement.prerequisites.length) html += `<div class="notice warn"><b>Before upgrading</b>${requirement.prerequisites.map(item => `<p>• ${escapeHTML(item)}</p>`).join('')}</div>`;
    html += `<details class="technical-details"><summary>Stats and construction details</summary><p class="help">Current: ${escapeHTML(JSON.stringify(currentStats).replace(/[{}\"]/g, '').replace(/,/g, ' · ').replace(/:/g, ' '))}</p><p class="help">Next: ${escapeHTML(JSON.stringify(nextStats).replace(/[{}\"]/g, '').replace(/,/g, ' · ').replace(/:/g, ' '))}</p><p class="help">A builder crew starts when funding is complete. Construction takes ${GAME_CONFIG.constructionSecondsPerLevel * requirement.targetLevel}s; a ${GAME_CONFIG.revealSeconds.toFixed(1)}s upgrade reveal follows.</p></details>`;
    if (legacyJob) html += `<p class="notice">Previously paid legacy work is preserved. Completion is due ${new Date(legacyJob.end).toLocaleTimeString()}.</p>`;
    if (activeProject) {
      const remaining = Math.max(0, activeProject.targetAmount - activeProject.funded);
      html += `<div class="project-card ${activeProject.pinned ? 'pinned' : ''}"><strong>${activeProject.pinned ? '★ PRIORITY · ' : ''}<span data-build-timer="${activeProject.id}">${escapeHTML(constructionStatus(activeProject))}</span> · L${activeProject.targetLevel}</strong><p>Funded ${activeProject.funded.toLocaleString()} / ${activeProject.targetAmount.toLocaleString()} Parts · ${remaining.toLocaleString()} remaining</p><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, activeProject.funded / activeProject.targetAmount * 100)}%"></div></div><div class="row"><button id="projectDetailsBtn">${activeProject.status === 'approved' ? 'Open project funding' : 'View construction'}</button></div></div>`;
    } else if (requirement.targetLevel <= GAME_CONFIG.maxLevel) {
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
function refreshConstructionTimers() {
  document.querySelectorAll('[data-build-timer]').forEach(label => {
    const project = projectById(label.dataset.buildTimer);
    if (project) label.textContent = constructionStatus(project);
  });
  document.querySelectorAll('[data-public-build-finish]').forEach(label => {
    const startedAt = Number(label.dataset.publicBuildStart);
    const finishAt = Number(label.dataset.publicBuildFinish);
    label.textContent = startedAt > Date.now() ? `Queued · starts in ${formatRemaining(startedAt)}` : `Under construction · ${formatRemaining(finishAt)} remaining`;
  });
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
  let html = `<h2>Community Projects</h2><p>One shared Command Compound for <b>${escapeHTML(service.getCommunityInfo().name)}</b>.</p><p>${service.getBuilderCapacity()} builder ${service.getBuilderCapacity() === 1 ? 'crew' : 'crews'} · Hall Level ${base.levels.hq}.</p><p>Unallocated shared Treasury: <b>${base.treasury.toLocaleString()} Parts</b>. It is not project funding until leadership assigns it.</p><p class="help">${escapeHTML(role)}</p>`;
  if (projects.length) html += projects.map(project => {
    const complete = project.status === 'completed';
    const label = `${GAME_CONFIG.buildings[project.key].name} · Upgrade to Level ${project.targetLevel} · Current Level ${base.levels[project.key]}`;
    const rem = Math.max(0, project.targetAmount - project.funded);
    const myLifetime = service.member().lifetimeContributed;
    const donorList = project.donors.slice(-4).map(donor => `${escapeHTML(donor.name)} +${donor.amount}`).join(' · ') || 'No personal donors yet';
    return `<article class="project-card ${project.pinned ? 'pinned' : ''}"><strong>${project.pinned ? '★ PRIORITY · ' : ''}${escapeHTML(label)} · <span data-build-timer="${project.id}">${escapeHTML(constructionStatus(project))}</span></strong><p>${escapeHTML(project.benefit)}</p><p>Target ${project.targetAmount.toLocaleString()} · funded ${project.funded.toLocaleString()} · remaining ${rem.toLocaleString()} Parts</p><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, project.funded / project.targetAmount * 100)}%"></div></div><p>Prerequisites: ${project.prerequisites.length ? project.prerequisites.map(escapeHTML).join(' · ') : 'validated at approval'}</p><p>Recent donors: ${donorList}</p><p>Your lifetime contributions: ${myLifetime.toLocaleString()} Parts · persisted with this community</p><div class="row"><button data-project-details="${project.id}">${complete ? 'View completed project' : project.status === 'constructing' ? 'View construction' : 'Fund project'}</button>${isLeadership() && project.status === 'approved' ? `<button data-project-pin="${project.id}" data-pinned="${project.pinned}">${project.pinned ? 'Unpin priority' : 'Pin priority'}</button>` : ''}</div></article>`;
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
  else if (complete) html += '<p class="notice">Construction complete. The new level is active.</p>';
  else if (project.status === 'constructing') html += `<p class="notice"><span data-build-timer="${project.id}">${escapeHTML(constructionStatus(project))}</span>. The builder returns to the camp when this upgrade is complete.</p>`;
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
    if (result.constructionStarted && !result.replay) { applyScaffoldState(); syncPatrolOrders(); }
    beep(520);
    toast(`Accepted ${result.accepted} Parts${result.constructionStarted ? ' · builder crew assigned' : ` · ${result.remaining} remaining`}`);
    showProjectFundingPanel(projectId);
  };
  if ($('allocateBtn')) $('allocateBtn').onclick = () => {
    const result = service.allocateTreasury(service.state.currentIdentityId, projectId, Number($('allocationAmount').value));
    if (!result.ok) { showProjectFundingPanel(projectId, result.error); return; }
    if (result.constructionStarted && !result.replay) { applyScaffoldState(); syncPatrolOrders(); }
    toast(`Assigned ${result.accepted} Treasury Parts${result.constructionStarted ? ' · builder crew assigned' : ` · ${result.remaining} remaining`}`);
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
  let html = `<h2>Personal Forge</h2><p>Personal inventory · Salvage ${member.salvage.toLocaleString()} · Parts ${member.parts.toLocaleString()}</p><p>Demo resupply: +${GAME_CONFIG.dailySalvage + service.routeNetworkBonus()} Salvage once per 24h per stable preview identity, including +${service.routeNetworkBonus()} from shared supply routes. <span id="forgeDailyCountdown">${claimText}</span></p><div class="row"><button id="claimSalvageBtn" ${member.nextClaimAt > Date.now() ? 'disabled' : ''}>Claim daily Salvage</button></div><hr><p id="forgeSlotStatus">Forge slots: ${working}/${slots} working · ${slots} slot${slots === 1 ? '' : 's'} from Command Hall L${state.levels.hq}. Recipes use fast preview timings.</p>`;
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

function defenderCardsHTML() {
  const base = service.community().saved.base;
  const leadership = isLeadership();
  const access = service.getAccess().allowed;
  return Object.entries(DEFENDER_CONCEPTS).map(([role, definition]) => {
    const defender = base.defenders[role];
    const requirement = service.getDefenderRequirement(service.state.currentIdentityId, role);
    const project = defender.project;
    const tier = Math.max(1, defender.level);
    const post = defender.post ? DEFENDER_POSTS[defender.post] : 'Reserve at camp';
    const progress = project ? `<p class="help">Approved L${project.targetLevel} · ${project.funded}/${project.cost} Parts funded</p><div class="row"><input type="number" min="1" step="1" value="${Math.max(1, project.cost - project.funded)}" data-defender-amount="${role}" aria-label="Parts for ${escapeHTML(definition.name)}"><button data-defender-fund="${role}" ${access ? '' : 'disabled'}>Contribute Parts</button></div>` : '';
    const approval = !project && defender.level < 5 ? `<p class="help">Next L${requirement.targetLevel}: ${requirement.cost} Parts · ${requirement.prerequisites.length ? escapeHTML(requirement.prerequisites.join(' ')) : 'Ready for leadership approval.'}</p><button data-defender-approve="${role}" ${leadership && requirement.ok ? '' : 'disabled'}>Approve L${requirement.targetLevel} project</button>` : '';
    const assignment = defender.level ? `<div class="row"><select data-defender-post="${role}" aria-label="${escapeHTML(definition.name)} defensive post" ${leadership && access ? '' : 'disabled'}><option value="">Reserve at camp</option>${Object.entries(DEFENDER_POSTS).map(([key, label]) => `<option value="${key}" ${defender.post === key ? 'selected' : ''}>${escapeHTML(label)}</option>`).join('')}</select><button data-defender-assign="${role}" ${leadership && access ? '' : 'disabled'}>Assign post</button></div>` : '';
    return `<article class="squad-card defender-card"><div class="squad-card-head"><span class="squad-emblem" aria-hidden="true">◆</span><div><strong>${escapeHTML(definition.name)}</strong><small>${escapeHTML(definition.role)}</small></div><b>${defender.level ? `L${defender.level}` : 'LOCKED'}</b></div><img class="squad-portrait" src="${defenderPortrait(role)}" alt="${escapeHTML(definition.name)} supplied design"><p>${escapeHTML(definition.detail)}</p><p><b>Ability:</b> ${escapeHTML(definition.ability)}<br><b>Post:</b> ${escapeHTML(post)}</p>${approval}${progress}${assignment}${defender.level && defender.post ? `<button type="button" data-watch-defender="${role}">Watch defender in 3D</button>` : ''}<p class="help">Inspect any 3D appearance at camp without unlocking or equipping it:</p><div class="squad-tier-strip">${[1, 2, 3, 4, 5].map(level => `<button type="button" data-defender-preview="${role}" data-level="${level}" aria-label="Place ${escapeHTML(definition.name)} Level ${level} 3D preview">L${level}</button>`).join('')}</div></article>`;
  }).join('');
}

function showPatrolOrdersPanel() {
  const access = service.getAccess();
  const leadership = isLeadership();
  const base = service.community().saved.base;
  const rows = Object.entries(SQUAD_ROLES).map(([role, definition]) => {
    const unlocked = squadUnlocked(role, base.levels);
    const current = base.patrolOrders[role] || 'standard';
    return `<article class="squad-card"><div class="squad-card-head"><strong>${escapeHTML(definition.name)}</strong><b>${unlocked ? `L${squadTier(role, base.levels)}` : 'LOCKED'}</b></div><p class="help">${unlocked ? `Current order: ${escapeHTML(PATROL_ORDERS[current])}` : `Unlock at Command Hall L${definition.unlockHall} and ${escapeHTML(GAME_CONFIG.buildings[definition.source].name)} L${definition.unlockSource}.`}</p><div class="row"><select data-patrol-order="${role}" aria-label="${escapeHTML(definition.name)} patrol destination" ${!access.allowed || !leadership || !unlocked ? 'disabled' : ''}>${Object.entries(PATROL_ORDERS).map(([key, label]) => `<option value="${key}" ${key === current ? 'selected' : ''}>${escapeHTML(label)}</option>`).join('')}</select><button data-assign-patrol="${role}" ${!access.allowed || !leadership || !unlocked ? 'disabled' : ''}>Assign</button></div></article>`;
  }).join('');
  openPanel(`<h2>Patrol Orders</h2><p>Send unlocked squads between camp and a chosen building, or hold them at camp. They follow clear paths around moved buildings and walls.</p>${!access.allowed ? `<p class="notice warn">${escapeHTML(access.reason)}</p>` : !leadership ? '<p class="help">The owner or an authorised admin assigns routes for this shared base.</p>' : ''}<div class="squad-grid">${rows}</div><p class="help">These local-preview orders change where soldiers walk at home. War scores and saved battle snapshots stay unchanged.</p><div class="row"><button id="closeBtn">Close</button></div>`);
  panel.querySelectorAll('[data-assign-patrol]').forEach(button => button.addEventListener('click', () => {
    const role = button.dataset.assignPatrol;
    const order = panel.querySelector(`[data-patrol-order="${role}"]`)?.value;
    const result = service.assignPatrolOrder(service.state.currentIdentityId, role, order);
    if (result.ok) syncPatrolOrders();
    toast(result.ok ? `${SQUAD_ROLES[role].name}: ${PATROL_ORDERS[order]}` : result.error);
    showPatrolOrdersPanel();
  }));
  $('closeBtn').onclick = closePanel;
}

function showSquadPanel() {
  selectedKey = null;
  updateBuildingList();
  const levels = state.levels;
  const cards = Object.entries(SQUAD_ROLES).map(([role, definition]) => {
    const profile = squadProfile(role, levels);
    const tier = profile.tier;
    const sourceName = GAME_CONFIG.buildings[definition.source].name;
    const unlock = profile.unlocked ? `DEPLOYED · L${tier}` : `LOCKED · Hall L${definition.unlockHall} + ${escapeHTML(sourceName)} L${definition.unlockSource}`;
    return `<article class="squad-card ${role}${profile.unlocked ? '' : ' locked'}"><div class="squad-card-head"><span class="squad-emblem" aria-hidden="true">${definition.emblem}</span><div><strong>${escapeHTML(definition.name)}</strong><small>${escapeHTML(definition.purpose)}</small></div><b>${profile.unlocked ? `L${tier}` : '🔒'}</b></div><p class="squad-status">${unlock}</p>${profile.unlocked ? `<button type="button" data-watch-patrol="${role}">Watch 3D patrol</button>` : ""}<img class="squad-portrait" src="${squadPortrait(role, tier)}" alt="${escapeHTML(definition.name)} Level ${tier} preview"><p class="squad-art-preview-label">Viewing L${tier} · ${escapeHTML(definition.equipment[tier - 1])}</p><div class="squad-tier-strip" aria-label="${escapeHTML(definition.name)} Level 1 to 5 artwork">${[1, 2, 3, 4, 5].map(level => `<button type="button" class="${level === tier ? 'selected' : ''}" data-squad-preview="${role}" data-level="${level}" aria-label="Preview ${escapeHTML(definition.name)} Level ${level} appearance" aria-pressed="${level === tier}" title="Level ${level} · ${escapeHTML(definition.equipment[level - 1])}"><img src="${squadPortrait(role, level)}" loading="lazy" alt=""></button>`).join('')}</div><p>${escapeHTML(definition.kit)}. Kit tier follows ${escapeHTML(sourceName)} and the Command Hall cap.</p><p><b>${profile.unlocked ? 'Current build' : 'Preview kit'}:</b> ${profile.maxHealth} HP · ${profile.damage} damage · ${profile.armour} armour<br><b>Ability:</b> ${escapeHTML(profile.ability)}</p><details class="technical-details"><summary>See all five kit levels</summary><ol>${definition.equipment.map((item, index) => `<li class="${profile.unlocked && index < tier ? 'equipped' : ''}">L${index + 1} · ${escapeHTML(item)} · ${definition.health[index]} HP / ${definition.damage[index]} dmg / ${definition.armour[index]} armour · ${escapeHTML(definition.ability[index])}</li>`).join('')}</ol></details></article>`;
  }).join('');
  const away = currentAwaySquads().length;
  const defenderCards = defenderCardsHTML();
  openPanel(`<h2>DZN Squad Armoury</h2><p>Inspect each outfit or watch its 3D patrol. Active gear follows building level; previewing an outfit does not equip it.</p><button id="trainingLoadoutBtn">Set training squad</button>${away ? `<p class="notice warn">${away} squad${away === 1 ? '' : 's'} away. Home defence is reduced until return or recall.</p>` : ''}<details class="technical-details"><summary>How upgrades and battles work</summary><p>Command Hall and specialist buildings set active kit. Sentinel and Lifeline unlock at Hall L4 with a Level 3 specialist building. Upgraded damage boosts attacks; health, armour and Lifeline support reduce losses. Battles lock both bases and kits before the first move.</p></details><div class="squad-grid">${cards}</div><h3>DZN Base Defenders</h3><p>Leadership approves upgrades and assigns posts. Assigned defenders guard the base; reserves stay out of battle.</p><div class="squad-grid">${defenderCards}</div><div class="row"><button id="closeBtn">Close</button></div>`);
  $('trainingLoadoutBtn').onclick = () => showTrainingLoadout();
  panel.querySelectorAll('[data-squad-preview]').forEach(button => button.addEventListener('click', () => {
    const role = button.dataset.squadPreview;
    const level = Number(button.dataset.level);
    const definition = SQUAD_ROLES[role];
    if (!definition || !Number.isInteger(level) || level < 1 || level > 5) return;
    const card = button.closest('.squad-card');
    const portrait = card.querySelector('.squad-portrait');
    portrait.src = squadPortrait(role, level);
    portrait.alt = `${definition.name} Level ${level} appearance preview`;
    card.querySelector('.squad-art-preview-label').textContent = `Viewing L${level} · ${definition.equipment[level - 1]}`;
    card.querySelectorAll('[data-squad-preview]').forEach(choice => {
      const selected = choice === button;
      choice.classList.toggle('selected', selected);
      choice.setAttribute('aria-pressed', String(selected));
    });
  }));
  panel.querySelectorAll('[data-watch-patrol]').forEach(button => button.addEventListener('click', () => {
    const patrol = patrols.find(item => item.role === button.dataset.watchPatrol && item.mesh.visible);
    if (!patrol || fallback2D || raid || warBattle) { toast('3D patrol is unavailable right now.'); return; }
    focusedPatrolRole = patrol.role;
    patrolFocusExit.hidden = false;
    patrolFocusExit.textContent = `← Back to base · ${SQUAD_ROLES[patrol.role].name} L${patrol.mesh.userData.squadTier}`;
    patrolFocusLight.visible = true;
    patrolFocusRing.visible = true;
    zoom = 8;
    camTarget.copy(patrol.mesh.position);
    updateCamera();
    closePanel();
    toast(`Watching ${SQUAD_ROLES[patrol.role].name} in 3D · drag to explore`);
  }));
  panel.querySelectorAll('[data-watch-defender]').forEach(button => button.addEventListener('click', () => {
    const role = button.dataset.watchDefender;
    const patrol = defenderPatrols.get(role);
    if (!patrol?.mesh.visible || fallback2D || raid || warBattle) { toast('Assigned defender is unavailable in 3D right now.'); return; }
    focusedPatrolRole = `defender:${role}`;
    patrolFocusExit.hidden = false;
    patrolFocusExit.textContent = `← Back to base · ${DEFENDER_CONCEPTS[role].name} L${patrol.level}`;
    patrolFocusLight.visible = true;
    patrolFocusRing.visible = true;
    zoom = 8;
    camTarget.copy(patrol.mesh.position);
    updateCamera();
    closePanel();
    toast(`Watching ${DEFENDER_CONCEPTS[role].name} guard ${DEFENDER_POSTS[patrol.post]}`);
  }));
  panel.querySelectorAll('[data-defender-preview]').forEach(button => button.addEventListener('click', () => {
    const level = Number(button.dataset.level);
    if (!Number.isInteger(level) || level < 1 || level > 5) return;
    placeDefenderPreview(button.dataset.defenderPreview, level);
    closePanel();
  }));
  panel.querySelectorAll('[data-defender-approve]').forEach(button => button.addEventListener('click', () => {
    const result = service.approveDefender(service.state.currentIdentityId, button.dataset.defenderApprove);
    toast(result.ok ? `${DEFENDER_CONCEPTS[button.dataset.defenderApprove].name} L${result.targetLevel} approved for shared funding` : result.error);
    showSquadPanel();
  }));
  panel.querySelectorAll('[data-defender-fund]').forEach(button => button.addEventListener('click', () => {
    const role = button.dataset.defenderFund;
    const amount = Number(panel.querySelector(`[data-defender-amount="${role}"]`)?.value);
    const result = service.fundDefender(service.state.currentIdentityId, role, amount);
    if (result.ok && result.completed && !result.replay) {
      syncDefenderPatrols();
      celebrateUpgrade(-4, -12, DEFENDER_CONCEPTS[role].name, result.level);
      playClank();
    }
    toast(result.ok ? `${DEFENDER_CONCEPTS[role].name}: +${result.accepted} Parts${result.completed ? ` · Level ${result.level} complete` : ''}` : result.error);
    showSquadPanel(); updateHud();
  }));
  panel.querySelectorAll('[data-defender-assign]').forEach(button => button.addEventListener('click', () => {
    const role = button.dataset.defenderAssign;
    const selected = panel.querySelector(`[data-defender-post="${role}"]`)?.value || null;
    const result = service.assignDefender(service.state.currentIdentityId, role, selected);
    if (result.ok) syncDefenderPatrols();
    toast(result.ok ? `${DEFENDER_CONCEPTS[role].name} assigned: ${selected ? DEFENDER_POSTS[selected] : 'reserve at camp'}` : result.error);
    showSquadPanel();
  }));
  $('closeBtn').onclick = closePanel;
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

function showChroniclePanel() {
  const chronicle = service.getChronicle();
  if (!chronicle.ok) {
    openPanel(`<h2>Server Chronicle</h2><p class="notice warn">${escapeHTML(chronicle.error)}</p><p>Your community history stays saved while access is locked.</p><div class="row"><button id="closeBtn">Close</button></div>`);
    $('closeBtn').onclick = closePanel;
    return;
  }
  const cards = chronicle.entries.map(item => {
    const date = item.at ? new Date(item.at).toLocaleString() : 'Earlier progress · exact date unavailable';
    return `<article class="project-card"><strong>${escapeHTML(item.kind.toUpperCase())}</strong><p>${escapeHTML(item.text)}</p><p class="help">${escapeHTML(date)}</p></article>`;
  }).join('');
  openPanel(`<h2>Server Chronicle</h2><p>The community’s construction and local war milestones. The in-world DZN beacon grows with Command Hall Level ${chronicle.beaconLevel}/5.</p><p class="notice">${chronicle.entries.length} milestones · saved with this community’s local preview</p>${cards || '<p class="help">Your first completed community project will appear here.</p>'}<p class="help">This record is cosmetic. It does not change war scoring, DZN leaderboards, live server stats, or member entitlement.</p><div class="row"><button id="closeBtn">Close</button></div>`);
  $('closeBtn').onclick = closePanel;
}

function showFieldOrdersPanel(message = '') {
  const board = service.getFieldOrders();
  if (!board.ok) {
    openPanel(`<h2>DZN Field Orders</h2><p class="notice warn">${escapeHTML(board.error)}</p><p>Orders require a verified member of an eligible Pro community in this local preview.</p><button id="closeBtn">Close</button>`);
    $('closeBtn').onclick = closePanel;
    return;
  }
  const finished = board.orders.filter(order => order.completed).length;
  const resetMinutes = Math.max(0, Math.ceil((board.resetsAt - Date.now()) / 60_000));
  const resetLabel = `${Math.floor(resetMinutes / 60)}h ${resetMinutes % 60}m`;
  const cards = board.orders.map(order => `<article class="project-card"><strong>${escapeHTML(order.name)}</strong><p>${escapeHTML(order.objective)}</p><p class="help">⚙ ${order.rewardParts} personal Parts · ${order.claimed ? 'Reward claimed' : order.completed ? 'Ready to claim' : 'Awaiting action'}</p>${order.completed && !order.claimed ? `<button data-claim-order="${escapeHTML(order.id)}">Claim reward</button>` : ''}</article>`).join('');
  openPanel(`<h2>DZN Field Orders</h2><p>Complete real actions in your Stronghold. Orders refresh at 00:00 UTC; rewards stay in your personal inventory.</p><p class="notice">${finished}/${board.orders.length} complete · resets in ${resetLabel}</p>${message ? `<p class="notice">${escapeHTML(message)}</p>` : ''}${cards}<div class="row"><button id="ordersForgeBtn">Open Forge</button><button id="ordersWarBtn">Open War Table</button><button id="closeBtn">Close</button></div><p class="help">Local preview progress only. Field Orders do not affect DZN server rankings or war scores.</p>`);
  panel.querySelectorAll('[data-claim-order]').forEach(button => button.onclick = () => {
    const result = service.claimFieldOrder(service.state.currentIdentityId, button.dataset.claimOrder);
    if (result.ok) { beep(940); updateHud(); }
    showFieldOrdersPanel(result.ok ? `+${result.amount} personal Parts secured.` : result.error);
  });
  $('ordersForgeBtn').onclick = showForgePanel;
  $('ordersWarBtn').onclick = () => showWarTable();
  $('closeBtn').onclick = closePanel;
}

function showLandPanel(focusPlotId = null) {
  const access = service.getAccess();
  if (!access.allowed) {
    openPanel(`<h2>Land & Forest</h2><p class="notice warn">${escapeHTML(access.reason)}</p><p>Shared land and personal Timber stay saved while access is locked.</p><div class="row"><button id="closeBtn">Close</button></div>`);
    $('closeBtn').onclick = closePanel;
    return;
  }
  service.advanceTimberProduction();
  const snapshot = service.snapshot();
  const hall = snapshot.base.levels.hq;
  const repairPriority = snapshot.base.repairPriority;
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
      if (config.id === 'timberline-depot' && plot.facilityLevel > 0) {
        const production = service.getTimberProductionInfo();
        facilityHtml += `<p class="notice">Lumber stock: ${Math.floor(production.stored)}/${production.capacity} · +${production.perMinute} Timber/min${production.perMinute ? '' : ' · paused'}</p><div class="row"><button data-yard-collect="${config.id}" ${production.stored < 1 ? 'disabled' : ''}>Collect ${Math.floor(production.stored)} Timber</button><button data-depot-claim="${config.id}" ${snapshot.member.nextTimberClaimAt > Date.now() ? 'disabled' : ''}>${snapshot.member.nextTimberClaimAt > Date.now() ? `Resupply in ${formatRemaining(snapshot.member.nextTimberClaimAt)}` : 'Claim daily Timber'}</button></div>`;
      }
    }
    let routeHtml = '';
    if (plot.status === 'claimed') {
      routeHtml = `<hr><p><b>DZN Supply Route · Level ${plot.routeLevel}/5</b></p><p class="help">Connect this district to the Command Hall. Each completed route tier adds +${GAME_CONFIG.routeSalvageBonusPerLevel} personal daily Salvage for verified members in this local preview.</p>`;
      const routeProject = plot.routeProject;
      if (routeProject) {
        const donors = routeProject.donors.map(d => `${escapeHTML(d.name)}: ${d.parts} Parts + ${d.timber} Timber`).join(' · ');
        routeHtml += `<p>Approved Level ${routeProject.targetLevel}: ${routeProject.partsFunded}/${routeProject.partsCost} Parts · ${routeProject.timberFunded}/${routeProject.timberCost} Timber</p><div class="progress-track"><div class="progress-fill" style="width:${Math.floor(100 * (routeProject.partsFunded + routeProject.timberFunded) / (routeProject.partsCost + routeProject.timberCost))}%"></div></div><p class="help">${donors || 'Awaiting first contribution'}</p><button data-fund-route="${config.id}" ${snapshot.member.parts + snapshot.member.timber < 1 ? 'disabled' : ''}>Donate to supply route</button>`;
      } else if (plot.routeLevel < 5 && isLeadership()) {
        const target = plot.routeLevel + 1;
        const [partsCost, timberCost] = GAME_CONFIG.routeCosts[target];
        routeHtml += `<button data-approve-route="${config.id}" ${target > hall ? 'disabled' : ''}>Approve Route L${target} · ${partsCost} Parts + ${timberCost} Timber</button>`;
        if (target > hall) routeHtml += `<p class="help">Command Hall L${target} required for the next route tier.</p>`;
      }
    }
    const yardGuide = config.id === 'timberline-depot' && plot.facilityLevel === 0
      ? '<p class="help">Lumber Yard path: Hall L2 → clear 3 trees → owner approves the land → members fund the claim and Level 1 yard.</p>' : '';
    const repairHtml = plot.wear ? `<p class="notice warn">Battle wear ${plot.wear}/${BATTLE_WEAR_RULES.maxSeverity} · cosmetic damage; production and battle stats are unchanged.</p><div class="row">${isLeadership() && repairPriority !== config.id ? `<button data-repair-priority="${config.id}">Prioritise repair</button>` : ''}${repairPriority === config.id ? `<button data-repair-district="${config.id}" ${snapshot.member.parts < BATTLE_WEAR_RULES.repairParts || snapshot.member.timber < BATTLE_WEAR_RULES.repairTimber ? 'disabled' : ''}>Repair one stage · ${BATTLE_WEAR_RULES.repairParts} Parts + ${BATTLE_WEAR_RULES.repairTimber} Timber</button>` : '<span class="help">Awaiting leadership priority</span>'}</div>` : '';
    return `<article class="district-card ${focusPlotId === config.id ? 'focused' : ''}" data-plot-card="${config.id}"><strong>${escapeHTML(config.id === 'timberline-depot' ? 'Timberline Lumber Yard site' : config.name)} · Hall L${config.hall}</strong><p>${escapeHTML(status)}</p>${yardGuide}<div class="row">${button}</div>${repairHtml}${facilityHtml}${routeHtml}</article>`;
  }).join('');
  openPanel(`<h2>Land & Forest</h2><p>Chop trees for Timber. The owner approves each cleared district; members fund its buildings together.</p><p class="notice">Your Timber: ${snapshot.member.timber} · Claimed land: ${snapshot.base.landPlots.filter(plot => plot.status === 'claimed').length}/5${repairPriority ? ` · Repair priority: ${escapeHTML(GAME_CONFIG.landPlots.find(plot => plot.id === repairPriority)?.name || repairPriority)}` : ''}</p>${focusPlotId ? '<div class="row"><button id="returnBaseBtn">Return camera to base</button></div>' : ''}<div class="row"><button id="recycleTimberBtn" ${snapshot.member.salvage < GAME_CONFIG.recycleSalvageCost ? 'disabled' : ''}>Recycle ${GAME_CONFIG.recycleSalvageCost} Salvage → ${GAME_CONFIG.recycledTimber} Timber</button></div>${cards}<details class="technical-details"><summary>Routes, defence and renewable Timber</summary><p class="help">Daily Salvage keeps Timber renewable. Supply routes add +${service.routeNetworkBonus()} to each member's next daily Salvage claim. Ridgewatch boosts Assault, Signal Relay boosts Recon, and Highland Works defends both. Facility levels and barricades freeze during an accepted local war; routes do not change war scoring.</p></details><div class="row"><button id="closeBtn">Close</button></div>`);
  // Timberline is the first card, so retain the short explanation and return
  // control at the top instead of scrolling them off screen.
  if ($('returnBaseBtn')) $('returnBaseBtn').onclick = () => { camTarget.set(0, 0, 0); zoom = 28; updateCamera(); closePanel(); };
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
  panel.querySelectorAll('[data-repair-priority]').forEach(button => button.onclick = () => {
    const result = service.setRepairPriority(service.state.currentIdentityId, button.dataset.repairPriority);
    toast(result.ok ? 'District repair priority updated.' : result.error);
    showLandPanel(focusPlotId);
  });
  panel.querySelectorAll('[data-repair-district]').forEach(button => button.onclick = () => {
    const plotId = button.dataset.repairDistrict;
    const result = service.repairDistrict(service.state.currentIdentityId, plotId);
    toast(result.ok ? result.completed ? 'District repairs complete.' : `${result.remaining} battle wear stages remain.` : result.error);
    if (result.ok) { reconcileLandScenery(); updateHud(); if (result.completed) {
      const [x, z] = GAME_CONFIG.landPlots.find(plot => plot.id === plotId).position;
      celebrateUpgrade(x, z, 'District restored', 1);
    } }
    showLandPanel(focusPlotId);
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
  panel.querySelectorAll('[data-approve-route]').forEach(button => button.onclick = () => {
    const result = service.approveRoute(service.state.currentIdentityId, button.dataset.approveRoute);
    toast(result.ok ? `Supply route Level ${result.targetLevel} approved for community funding.` : result.error);
    showLandPanel();
  });
  panel.querySelectorAll('[data-fund-route]').forEach(button => button.onclick = () => {
    const plotId = button.dataset.fundRoute;
    const project = service.community().saved.base.landPlots.find(item => item.id === plotId)?.routeProject;
    const member = service.member();
    const result = service.contributeRoute(service.state.currentIdentityId, plotId,
      Math.min(member.parts, project.partsCost - project.partsFunded), Math.min(member.timber, project.timberCost - project.timberFunded));
    if (!result.ok) toast(result.error);
    else {
      toast(result.completed ? `DZN supply route Level ${result.targetLevel} complete!` : `${result.acceptedParts} Parts and ${result.acceptedTimber} Timber donated.`);
      if (result.completed && !result.replay) {
        const config = GAME_CONFIG.landPlots.find(item => item.id === plotId);
        celebrateUpgrade(config.position[0] * .7, config.position[1] * .7, `${config.name} Supply Route`, result.routeLevel);
        reconcileLandScenery(); playClank();
      }
      updateHud();
    }
    showLandPanel();
  });
  panel.querySelectorAll('[data-depot-claim]').forEach(button => button.onclick = () => {
    const result = service.claimDepotTimber();
    toast(result.ok ? `Lumber Yard resupply +${result.amount} personal Timber` : result.error);
    updateHud(); showLandPanel();
  });
  panel.querySelectorAll('[data-yard-collect]').forEach(button => button.onclick = () => {
    const result = service.collectYardTimber();
    toast(result.ok ? `+${result.amount} Timber collected from the Lumber Yard` : result.error);
    updateHud(); showLandPanel('timberline-depot');
  });
}

let activeBuilderSiteId = null;
function checkUpgrades() {
  const constructionCompleted = service.processConstructionJobs();
  for (const key of constructionCompleted) {
    startReveal(key);
    syncPatrolOrders();
    toast(`${DEFS[key].name} construction complete · Level ${state.levels[key]}`);
    if (selectedKey === key) showBuildingPanel(key);
  }
  const workSite = service.community()?.saved.base.projects.find(project => project.status === 'constructing' && project.startedAt <= Date.now());
  if ((workSite?.id || null) !== activeBuilderSiteId) {
    activeBuilderSiteId = workSite?.id || null;
    syncPatrolOrders();
  }
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
$('squadsBtn').onclick = showSquadPanel;
$('patrolOrdersBtn').onclick = showPatrolOrdersPanel;
$('progressionBtn').onclick = showProgressionPanel;
$('landBtn').onclick = () => showLandPanel();
$('yardBtn').onclick = () => {
  if (raid || warBattle) { toast('Return from the battle to view the Lumber Yard.'); return; }
  const point = service.community()?.saved.base.layout.structures['timberline-depot'];
  const [x, z] = point ? [point.x, point.z] : GAME_CONFIG.landPlots.find(plot => plot.id === 'timberline-depot').position;
  camTarget.set(x, 0, z);
  zoom = 17;
  updateCamera();
  showLandPanel('timberline-depot');
};
$('identityBtn').onclick = () => { $('previewDetails').open = true; $('previewDetails').scrollIntoView({ block: 'nearest' }); };
document.addEventListener('click', event => {
  if (!event.target.closest('.hud-menu')) document.querySelectorAll('.hud-menu[open]').forEach(menu => { menu.open = false; });
});
document.querySelectorAll('.hud-menu').forEach(menu => {
  menu.addEventListener('toggle', () => {
    if (menu.open) document.querySelectorAll('.hud-menu[open]').forEach(other => { if (other !== menu) other.open = false; });
  });
  menu.querySelectorAll('button').forEach(button => button.addEventListener('click', () => { menu.open = false; }));
});

let layoutZone = 'command-compound';
let layoutMode = 'move-building';
let layoutStructure = 'hq';
let layoutStart = null;
let layoutWallId = null;
let layoutPending = null;
let layoutBlueprintPending = null;
let layoutDrillReport = null;
let layoutBlueprintOpen = false;
const layoutModes = {
  'move-building': 'Move building', 'build-wall': 'Build one wall', 'build-row': 'Build wall row',
  'upgrade-wall': 'Upgrade one wall', 'upgrade-row': 'Upgrade wall row', 'move-wall': 'Move wall',
};
function quoteLayoutAction(base, member, claimed, pending) {
  const { mode, start, end, key, wallId } = pending;
  const moving = mode === 'move-building' || mode === 'move-wall';
  const cells = moving ? [end] : rowCells(start || end, end);
  if (!cells) return { error: 'Choose a straight row of up to 16 cells.', cells: [] };
  let error = null, partsCost = 0, timberCost = 0;
  if (mode === 'move-building') {
    const current = base.layout.structures[key];
    error = current?.x === end.x && current?.z === end.z ? 'The building is already there.' : validateLayoutPosition(base.layout, claimed, key, end.x, end.z);
  } else if (mode === 'move-wall') {
    const wall = base.layout.walls.find(item => item.id === wallId);
    error = !wall ? 'Select a wall first.' : wall.x === end.x && wall.z === end.z ? 'The wall is already there.' : validateWallPosition(base.layout, claimed, end.x, end.z, wallId);
  } else if (mode.startsWith('build')) {
    if (base.layout.walls.length + cells.length > MAX_WALLS_PER_HALL[base.levels.hq]) error = 'Command Hall wall capacity reached.';
    for (const cell of cells) error ||= validateWallPosition(base.layout, claimed, cell.x, cell.z);
    partsCost = WALL_COSTS[1].parts * cells.length;
    timberCost = WALL_COSTS[1].timber * cells.length;
  } else {
    const walls = cells.map(cell => base.layout.walls.find(wall => wall.x === cell.x && wall.z === cell.z));
    if (walls.some(wall => !wall)) error = 'Every selected cell needs an existing wall.';
    else if (walls.some(wall => wall.level >= base.levels.hq || wall.level >= GAME_CONFIG.maxLevel)) error = 'Upgrade the Command Hall before raising this wall tier.';
    else {
      partsCost = walls.reduce((sum, wall) => sum + WALL_COSTS[wall.level + 1].parts, 0);
      timberCost = walls.reduce((sum, wall) => sum + WALL_COSTS[wall.level + 1].timber, 0);
    }
  }
  if (!error && (member.parts < partsCost || member.timber < timberCost)) error = `Need ${partsCost} Parts and ${timberCost} Timber.`;
  return { cells, partsCost, timberCost, error, summary: `${layoutModes[mode]} · ${cells.length} ${mode === 'move-building' ? 'building' : cells.length === 1 ? 'piece' : 'pieces'} · ${partsCost} Parts + ${timberCost} Timber` };
}
function showLayoutPanel(errorMessage = '') {
  const previousScroll = panel.querySelector('.layout-scroll');
  const scrollLeft = previousScroll?.scrollLeft || 0, scrollTop = previousScroll?.scrollTop || 0;
  selectedKey = null;
  updateBuildingList();
  const snapshot = service.snapshot();
  const base = snapshot.base;
  const owner = snapshot.profile.role === 'owner' && snapshot.access.allowed;
  const claimed = new Set(base.landPlots.filter(plot => plot.status === 'claimed').map(plot => plot.id));
  if (!claimed.has(layoutZone)) layoutZone = 'command-compound';
  const bounds = LAYOUT_ZONES[layoutZone];
  const keys = layoutZone === 'command-compound' ? Object.keys(CORE_DEFAULTS) : [layoutZone];
  if (!keys.includes(layoutStructure)) layoutStructure = keys[0];
  const centers = Object.fromEntries(Object.entries(base.layout.structures).filter(([key]) => key in CORE_DEFAULTS || claimed.has(key))
    .map(([key, point]) => [`${point.x},${point.z}`, key]));
  const walls = new Map(base.layout.walls.map(wall => [`${wall.x},${wall.z}`, wall]));
  const occupied = layoutOccupancy(base.layout, claimed);
  const columns = (bounds.maxX - bounds.minX) / GRID_STEP + 1;
  const rows = (bounds.maxZ - bounds.minZ) / GRID_STEP + 1;
  const cells = [];
  for (let z = bounds.minZ; z <= bounds.maxZ; z += GRID_STEP) for (let x = bounds.minX; x <= bounds.maxX; x += GRID_STEP) {
    const key = `${x},${z}`, structure = centers[key], wall = walls.get(key);
    const chosen = layoutStart?.x === x && layoutStart?.z === z;
    const preview = layoutPending && (layoutPending.mode.startsWith('move')
      ? layoutPending.end.x === x && layoutPending.end.z === z
      : rowCells(layoutPending.start || layoutPending.end, layoutPending.end)?.some(cell => cell.x === x && cell.z === z));
    const label = structure ? (GAME_CONFIG.buildings[structure]?.name || GAME_CONFIG.facilities[structure]?.name || structure) : wall ? `Wall Level ${wall.level}` : occupied.has(key) ? 'Reserved building or camp space' : 'Empty grid space';
    cells.push(`<button class="layout-cell ${occupied.has(key) ? 'occupied' : ''} ${wall ? 'wall' : ''} ${chosen ? 'chosen' : ''} ${preview ? 'preview' : ''}" data-layout-x="${x}" data-layout-z="${z}" title="${escapeHTML(label)} · ${x}, ${z}" aria-label="${escapeHTML(label)} at ${x}, ${z}" ${owner ? '' : 'disabled'}>${structure ? escapeHTML(structure === 'hq' ? 'HQ' : structure === 'workshop' ? 'FG' : structure === 'tower' ? 'AB' : structure === 'comms' ? 'CM' : 'YD') : wall ? `W${wall.level}` : ''}</button>`);
  }
  const stageHint = layoutPending ? 'Check the highlighted cells and confirm below.' : layoutStart ? `Start ${layoutStart.x}, ${layoutStart.z} chosen. Pick the end cell.` : layoutMode === 'move-wall' ? 'Select an existing wall, then its destination.' : layoutMode.endsWith('row') ? 'Pick the first and last cells of a straight row.' : 'Pick one cell on the grid.';
  const zoneOptions = GAME_CONFIG.landPlots.filter(plot => claimed.has(plot.id)).map(plot => `<option value="${plot.id}">${escapeHTML(plot.name)}</option>`).join('');
  const quote = layoutPending ? quoteLayoutAction(base, snapshot.member, claimed, layoutPending) : null;
  const blueprints = service.getBlueprints(snapshot.profile.id);
  const blueprintCards = blueprints.map(item => `<div class="layout-blueprint"><div class="layout-blueprint-heading"><b>Slot ${item.slot}</b><input data-blueprint-name="${item.slot}" maxlength="32" aria-label="Slot ${item.slot} name" value="${escapeHTML(item.name)}" ${owner ? '' : 'disabled'}><span class="help">${item.savedAt ? `${item.walls} walls · ${item.ready ? 'ready' : escapeHTML(item.reason)}` : 'empty'}</span></div><div class="layout-blueprint-actions"><button data-blueprint-save="${item.slot}" ${owner ? '' : 'disabled'}>${item.savedAt ? 'Overwrite' : 'Save current'}</button><button data-blueprint-activate="${item.slot}" ${owner && item.ready ? '' : 'disabled'}>Deploy</button><button data-blueprint-drill="${item.slot}" ${item.ready && snapshot.access.allowed ? '' : 'disabled'}>Test</button></div></div>`).join('');
  const blueprintNotice = layoutBlueprintPending ? `<div class="layout-preview" role="status"><strong>Deploy ${escapeHTML(blueprints.find(item => item.slot === layoutBlueprintPending)?.name || 'blueprint')}?</strong><p>All buildings and owned wall segments move together. Wall levels, resources and locked war snapshots stay intact.</p><div class="row"><button id="blueprintConfirm">Confirm deployment</button><button id="blueprintCancel">Cancel</button></div></div>` : '';
  const drillNotice = layoutDrillReport ? `<div class="layout-preview" role="status"><strong>${escapeHTML(layoutDrillReport.name)} · friendly defence test</strong><p>Three equal-tier DZN training squads attacked your Command Hall. Highest attacker score: ${layoutDrillReport.worst.score}/100 from ${escapeHTML(layoutDrillReport.worst.name)}.</p><p>${layoutDrillReport.lanes.map(lane => `${escapeHTML(lane.name)} ${lane.score}/100 · ${lane.breached}/${lane.wallCount} route walls breached · ${lane.casualties} attackers withdrawn`).join('<br>')}</p><p class="help">Practice only. No score, damage, resources or rewards are saved.</p></div>` : '';
  openPanel(`<h2>Edit base</h2><p class="help">Place each wall, draw a straight row, or reposition a building. Select cells, review the cost, then confirm.</p>
    ${errorMessage ? `<p class="notice warn" role="status">${escapeHTML(errorMessage)}</p>` : ''}
    ${!owner ? `<p class="notice warn">${escapeHTML(snapshot.access.allowed ? 'Only the server owner can edit this shared base.' : snapshot.access.reason)}</p>` : ''}
    <p class="notice">${snapshot.member.parts} Parts · ${snapshot.member.timber} Timber · ${base.layout.walls.length}/${MAX_WALLS_PER_HALL[base.levels.hq]} walls · Hall L${base.levels.hq}</p>
    <details class="war-card" id="blueprintDetails" ${layoutBlueprintOpen || layoutBlueprintPending || layoutDrillReport ? 'open' : ''}><summary><b>Defence blueprints</b> · save, deploy and test</summary><p class="help">The owner can keep three arrangements of the buildings and walls already bought. A new wall makes an older plan stale until it is saved again. Deployments pause during a pending war.</p>${blueprintCards}${blueprintNotice}${drillNotice}</details>
    <div class="layout-actions" role="group" aria-label="Base edit actions">${Object.entries(layoutModes).map(([id, label]) => `<button type="button" data-layout-mode="${id}" class="${layoutMode === id ? 'active' : ''}" aria-pressed="${layoutMode === id}">${label}</button>`).join('')}</div>
    <div class="layout-toolbar"><label>Area<select id="layoutZone">${zoneOptions}</select></label><label>Building<select id="layoutStructure" ${layoutMode === 'move-building' ? '' : 'disabled'}>${keys.map(key => `<option value="${key}">${escapeHTML(GAME_CONFIG.buildings[key]?.name || GAME_CONFIG.facilities[key]?.name || key)}</option>`).join('')}</select></label></div>
    <p class="help" role="status">${stageHint}</p>
    ${quote ? `<div class="layout-preview ${quote.error ? 'warn' : ''}" role="status"><strong>${escapeHTML(quote.summary || layoutModes[layoutPending.mode])}</strong>${quote.error ? `<p>${escapeHTML(quote.error)}</p>` : '<p>Preview only. Your resources are spent after you confirm.</p>'}<div class="row"><button id="layoutConfirm" ${quote.error || !owner ? 'disabled' : ''}>Confirm ${escapeHTML(layoutModes[layoutPending.mode].toLowerCase())}</button><button id="layoutDiscard">Change selection</button></div></div>` : ''}
    <div class="layout-scroll"><div class="layout-grid" style="grid-template-columns:repeat(${columns},36px)" aria-label="${escapeHTML(layoutZone)} build grid">${cells.join('')}</div></div>
    <div class="layout-key"><span>HQ Hall</span><span>FG Forge</span><span>AB Arc Battery</span><span>CM Comms</span><span>YD District</span><span>W# Wall level</span></div>
    <p class="help">Each cell is 2 metres. Moving is free. Walls and upgrades use personal Parts and Timber; the finished base is shared with your server.</p>
    <div class="row"><button id="layoutCancelStart" ${layoutStart ? '' : 'disabled'}>Clear start</button><button id="closeBtn">Done</button></div>`);
  const layoutScroller = panel.querySelector('.layout-scroll');
  layoutScroller.scrollLeft = scrollLeft; layoutScroller.scrollTop = scrollTop;
  $('layoutZone').value = layoutZone;
  $('layoutStructure').value = layoutStructure;
  $('layoutZone').onchange = e => { layoutZone = e.target.value; layoutStart = null; layoutWallId = null; layoutPending = null; showLayoutPanel(); };
  panel.querySelectorAll('[data-layout-mode]').forEach(button => button.onclick = () => {
    layoutMode = button.dataset.layoutMode;
    layoutStart = null; layoutWallId = null; layoutPending = null;
    showLayoutPanel();
  });
  $('layoutStructure').onchange = e => { layoutStructure = e.target.value; layoutPending = null; showLayoutPanel(); };
  $('layoutCancelStart').onclick = () => { layoutStart = null; layoutWallId = null; layoutPending = null; showLayoutPanel(); };
  $('closeBtn').onclick = closePanel;
  $('blueprintDetails').ontoggle = event => { layoutBlueprintOpen = event.target.open; };
  panel.querySelectorAll('[data-blueprint-save]').forEach(button => button.onclick = () => {
    const slot = Number(button.dataset.blueprintSave);
    const name = panel.querySelector(`[data-blueprint-name="${slot}"]`).value;
    const result = service.saveBlueprint(snapshot.profile.id, slot, name);
    if (!result.ok) { showLayoutPanel(result.error); return; }
    layoutBlueprintPending = null; layoutDrillReport = null;
    toast(`Saved ${result.name}.`); showLayoutPanel();
  });
  panel.querySelectorAll('[data-blueprint-activate]').forEach(button => button.onclick = () => {
    layoutBlueprintPending = Number(button.dataset.blueprintActivate);
    layoutDrillReport = null; showLayoutPanel();
  });
  panel.querySelectorAll('[data-blueprint-drill]').forEach(button => button.onclick = () => {
    const result = service.drillBlueprint(snapshot.profile.id, Number(button.dataset.blueprintDrill));
    if (!result.ok) { showLayoutPanel(result.error); return; }
    layoutBlueprintPending = null; layoutDrillReport = result; showLayoutPanel();
  });
  if (layoutBlueprintPending) {
    $('blueprintCancel').onclick = () => { layoutBlueprintPending = null; showLayoutPanel(); };
    $('blueprintConfirm').onclick = () => {
      const result = service.applyBlueprint(snapshot.profile.id, layoutBlueprintPending);
      if (!result.ok) { layoutBlueprintPending = null; showLayoutPanel(result.error); return; }
      layoutBlueprintPending = null; layoutDrillReport = null; layoutStart = null; layoutWallId = null; layoutPending = null;
      syncLayoutPositions(); reconcileLandScenery(); updateHud(); playClank();
      toast(`${result.name} deployed.`); showLayoutPanel();
    };
  }
  if (layoutPending) {
    $('layoutDiscard').onclick = () => { layoutPending = null; showLayoutPanel(); };
    $('layoutConfirm').onclick = () => {
      const { mode, start, end, key, wallId } = layoutPending;
      let result;
      if (mode === 'move-building') result = service.moveStructure(snapshot.profile.id, key, end.x, end.z);
      else if (mode === 'move-wall') result = service.moveWall(snapshot.profile.id, wallId, end.x, end.z);
      else if (mode.startsWith('build')) result = service.placeWallRow(snapshot.profile.id, start || end, end);
      else result = service.upgradeWallRow(snapshot.profile.id, start || end, end);
      if (!result.ok) { showLayoutPanel(result.error); return; }
      layoutStart = null; layoutWallId = null; layoutPending = null;
      syncLayoutPositions(); reconcileLandScenery(); updateHud(); playClank();
      if (mode.startsWith('upgrade')) celebrateUpgrade(end.x, end.z, 'Perimeter wall', result.walls[0].level);
      toast(mode === 'move-building' ? 'Building repositioned.' : mode === 'move-wall' ? 'Wall moved.' : `${result.walls.length} wall segment${result.walls.length === 1 ? '' : 's'} ${mode.startsWith('upgrade') ? 'upgraded' : 'built'}.`);
      showLayoutPanel();
    };
  }
  panel.querySelectorAll('[data-layout-x]').forEach(button => button.onclick = () => {
    const point = { x: Number(button.dataset.layoutX), z: Number(button.dataset.layoutZ) };
    const existingWall = base.layout.walls.find(wall => wall.x === point.x && wall.z === point.z);
    if (layoutMode === 'build-wall' || layoutMode === 'upgrade-wall' || layoutMode === 'move-building') {
      layoutPending = { mode: layoutMode, end: point, key: layoutStructure };
    } else if (!layoutStart) {
      if (layoutMode === 'move-wall' && !existingWall) { showLayoutPanel('Select an existing wall first.'); return; }
      layoutStart = point; layoutWallId = existingWall?.id || null; layoutPending = null;
      showLayoutPanel(); return;
    } else {
      layoutPending = { mode: layoutMode, start: layoutStart, end: point, wallId: layoutWallId };
    }
    showLayoutPanel();
  });
}
$('editBaseBtn').onclick = () => {
  layoutStart = null; layoutWallId = null; layoutPending = null; layoutBlueprintPending = null; layoutDrillReport = null; layoutBlueprintOpen = false;
  showLayoutPanel();
};
$('chronicleBtn').onclick = showChroniclePanel;
$('fieldOrdersBtn').onclick = () => showFieldOrdersPanel();
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
syncPatrolOrders();
updateHud();

// ---------- War Table & raid ----------
const WAR_COMMUNITY_IDS = ['iron-pines', 'violet-ridge', 'mossback-free'];
const WAR_LEADERSHIP = ['owner', 'admin'];
let selectedWarOpponentCommunityId = null;
let selectedTrainingApproach = 'west';

function trainingSquadSummary(counts) {
  return Object.entries(counts).filter(([, count]) => count > 0)
    .map(([role, count]) => `${count} ${SQUAD_ROLES[role].name.replace('DZN ', '')}`).join(' · ');
}

function showTrainingLoadout(errorMessage = '') {
  const profile = service.profile();
  const access = service.getAccess(profile.id);
  const readiness = service.getTrainingReadiness(profile.id);
  const { counts, capacity, reserve, jobs, away, occupied, reserveCapacity } = readiness;
  const used = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const rows = Object.entries(SQUAD_ROLES).map(([role, definition]) => {
    const kit = squadProfile(role, state.levels);
    return `<div class="project-card"><label class="field-label" for="training${role}">${escapeHTML(definition.name)} · ${kit.unlocked ? `L${kit.tier} · ${kit.maxHealth} HP · ${kit.damage} damage` : 'LOCKED'}</label><div class="row"><input id="training${role}" data-training-role="${role}" type="number" min="0" max="${capacity}" step="1" value="${counts[role]}" ${kit.unlocked && access.allowed ? '' : 'disabled'}><span class="help">Ready ${reserve[role]} · ${TRAINING_COSTS[role]} Parts · ${TRAINING_SECONDS[role]}s each</span><button data-train-role="${role}" ${kit.unlocked && access.allowed && occupied < reserveCapacity && service.member(profile.id).parts >= TRAINING_COSTS[role] ? '' : 'disabled'}>Train +1</button></div></div>`;
  }).join('');
  const queue = jobs.length ? jobs.map(job => `${job.count} ${SQUAD_ROLES[job.role].name.replace('DZN ', '')} · ${formatRemaining(job.finishAt)}`).join(' · ') : 'Empty';
  const returning = away.length ? away.map(deployment => `${trainingSquadSummary(deployment.counts)} · ${formatRemaining(deployment.returnAt)}`).join(' · ') : 'None';
  const reinforcementRequests = service.getReinforcementRequests(profile.id).requests;
  const roleOptions = Object.entries(SQUAD_ROLES).filter(([role]) => squadProfile(role, state.levels).unlocked)
    .map(([role, definition]) => `<option value="${role}">${escapeHTML(definition.name)}</option>`).join('');
  const reinforcementCards = reinforcementRequests.length ? reinforcementRequests.map((request, index) =>
    `<div class="project-card"><strong>${escapeHTML(request.name)} · ${escapeHTML(SQUAD_ROLES[request.role].name)}</strong><p class="help">${request.remaining}/${request.count} still needed · expires ${formatRemaining(request.expiresAt)}</p><button data-reinforce-index="${index}" ${request.identityId === profile.id || reserve[request.role] < 1 ? 'disabled' : ''}>Donate 1 trained troop</button></div>`).join('') : '<p class="help">No open requests in this community.</p>';
  const reinforcementHtml = `<details class="technical-details"><summary>Community reinforcements · ${reinforcementRequests.length} open</summary><p>Ask a connected member for trained troops. Each donation moves a real troop from their reserve into yours; camp space and Pro access still apply. Requests expire after 12 hours.</p><div class="row"><select id="reinforcementRole" aria-label="Troop to request">${roleOptions}</select><input id="reinforcementCount" aria-label="Number of troops to request" type="number" min="1" max="4" step="1" value="1"><button id="requestReinforcements" ${access.allowed && occupied < reserveCapacity ? '' : 'disabled'}>Request troops</button></div>${reinforcementCards}</details>`;
  openPanel(`<h2>Camp & training</h2><p>Assign up to ${capacity} troops for Outpost Delta. ${used} assigned · ${occupied}/${reserveCapacity} camp spaces used. Drills and server-war attacks both draw from your trained reserve; surviving war troops return after their mission.</p><p class="${readiness.ready ? 'help' : 'notice warn'}">${readiness.ready ? 'Drill squad ready to deploy.' : 'Drill squad missing: ' + trainingSquadSummary(readiness.missing)}</p><p class="help">Training queue: ${escapeHTML(queue)}. Away on war duty: ${escapeHTML(returning)}. Jobs and returns finish while you are away.</p>${errorMessage ? `<p class="notice warn" role="status">${escapeHTML(errorMessage)}</p>` : ''}${!access.allowed ? `<p class="notice warn">${escapeHTML(access.reason)}</p>` : ''}${rows}${reinforcementHtml}<p class="help">Ghosts move quickly, Fixers pressure the battery, Sentinels absorb fire, and Lifeline medics recover nearby allies. Unlocked kit levels apply automatically.</p><div class="row"><button id="saveTrainingLoadout" ${access.allowed ? '' : 'disabled'}>Save squad</button><button id="backToWarTable">War Table</button></div>`);
  $('saveTrainingLoadout').onclick = () => {
    const selected = Object.fromEntries([...panel.querySelectorAll('[data-training-role]')].map(input => [input.dataset.trainingRole, Number(input.value)]));
    const result = service.setTrainingLoadout(profile.id, selected);
    if (!result.ok) { showTrainingLoadout(result.error); return; }
    toast('Training squad saved.');
    showWarTable();
  };
  $('backToWarTable').onclick = () => showWarTable();
  panel.querySelectorAll('[data-train-role]').forEach(button => button.onclick = () => {
    const result = service.trainTroops(profile.id, button.dataset.trainRole, 1);
    if (result.ok) { toast(`${SQUAD_ROLES[result.role].name} training · ${formatRemaining(result.finishAt)}.`); updateHud(); }
    showTrainingLoadout(result.ok ? '' : result.error);
  });
  $('requestReinforcements').onclick = () => {
    const result = service.requestReinforcements(profile.id, $('reinforcementRole').value, Number($('reinforcementCount').value));
    if (result.ok) toast('Troop request posted to your community camp.');
    showTrainingLoadout(result.ok ? '' : result.error);
  };
  panel.querySelectorAll('[data-reinforce-index]').forEach(button => button.onclick = () => {
    const request = reinforcementRequests[Number(button.dataset.reinforceIndex)];
    const result = service.donateReinforcements(profile.id, request.id, 1);
    if (result.ok) toast(`1 ${SQUAD_ROLES[result.role].name} sent to ${request.name}.`);
    showTrainingLoadout(result.ok ? '' : result.error);
  });
}

function warCommunityName(communityId) {
  return service.getIdentityOptions().find(identity => identity.communityId === communityId)?.communityName || communityId;
}

function warTimelineHTML(war) {
  const events = (war.events || []).slice(-10);
  return events.length ? `<h3>Event timeline · replay log</h3>${events.map(event => `<div class="war-event"><span class="war-tag">${escapeHTML(event.type.toUpperCase())}</span> · ${new Date(event.at).toLocaleTimeString()} — ${escapeHTML(event.text)}${event.type === 'attack' && event.details?.attackId ? `<p class="help">Replay ID ${escapeHTML(event.details.attackId)} · ${escapeHTML(event.details.tactic)} · ${event.details.score} pts${event.details.tactics?.plan ? ` · ${escapeHTML(event.details.tactics.laneName)} → ${escapeHTML(event.details.tactics.objectiveName)} · ${escapeHTML(event.details.tactics.methodName)}` : ''}${event.details.squad?.counts ? ` · ${escapeHTML(trainingSquadSummary(event.details.squad.counts))}` : ''}${event.details.orders?.length ? ` · ${event.details.orders.map(order => escapeHTML(order.name)).join(' → ')}` : ''}</p>` : ''}</div>`).join('')}` : '<p class="help">No war events yet.</p>';
}

function warSnapshotLine(side) {
  const levels = side.base.levels;
  return `Hall L${levels.hq} · Workshop L${levels.workshop} · Arc Battery L${levels.tower} · Comms L${levels.comms} · Squad ${side.stats.squadSize} · Walls T${side.stats.wallTier} · Claimed districts ${side.base.landPlots?.filter(plot => plot.status === 'claimed').length || 1} · Barricades ${side.stats.fortification || 0} · Assault +${side.stats.assaultBonus || 0} · Recon +${side.stats.reconBonus || 0} · Works -${side.stats.worksDefence || 0} · Warden L${side.stats.assaultKit.leadTier} kit +${side.stats.assaultKit.scoreBonus} / loss shield ${side.stats.assaultKit.casualtyShield} · Ghost L${side.stats.reconKit.leadTier} kit +${side.stats.reconKit.scoreBonus} / loss shield ${side.stats.reconKit.casualtyShield}`;
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
  const canResolve = war.state === 'active' && leadership && (war.stages?.length ? Date.now() >= war.attackEndsAt : atCap || Date.now() >= war.attackEndsAt);
  const currentSide = isChallenger ? challenger : defender;
  const enemySide = isChallenger ? defender : challenger;
  const homeDefence = war.defenceOrders?.[currentCommunityId]?.order || 'balanced';
  let actions = '';
  if (war.state === 'challenged' && currentCommunityId === war.defenderCommunityId) {
    actions = leadership && readiness.eligible
      ? `<div class="row"><button data-war-accept="${escapeHTML(war.id)}">Accept challenge</button><button data-war-decline="${escapeHTML(war.id)}">Decline</button></div>`
      : `<p class="notice warn">Challenge inbox is leadership-only. ${escapeHTML(readiness.unmetGates.join(' '))}</p>`;
  } else if (war.state === 'challenged') {
    actions = '<p class="notice">Challenge sent. Waiting for the opposing owner/admin to accept.</p>';
  } else if (war.state === 'preparation') {
    const ready = Date.now() >= war.prepReadyAt && Date.now() <= war.prepDeadlineAt;
    actions = `<p class="notice">Preparation window · <span data-war-countdown="${war.prepReadyAt}" data-war-mode="prep" data-prep-deadline="${war.prepDeadlineAt}">${ready ? `Start before ${formatRemaining(war.prepDeadlineAt)}` : `Launch opens in ${formatRemaining(war.prepReadyAt)}`}</span></p><div class="war-card"><b>Home defence · ${escapeHTML(WAR_DEFENCE_ORDERS[homeDefence].name)}</b><p class="help">${escapeHTML(WAR_DEFENCE_ORDERS[homeDefence].detail)} The order locks when war starts; its effect is shown when an attack deploys.</p>${leadership && readiness.eligible ? `<div class="row"><select data-war-defence-select="${escapeHTML(war.id)}" aria-label="Home defence order">${Object.entries(WAR_DEFENCE_ORDERS).map(([key, value]) => `<option value="${key}" ${key === homeDefence ? 'selected' : ''}>${escapeHTML(value.name)}</option>`).join('')}</select><button data-war-defence-save="${escapeHTML(war.id)}">Set defence</button></div>` : '<p class="help">Your owner or admin chooses the order.</p>'}</div>${leadership ? `<div class="row"><button data-war-start="${escapeHTML(war.id)}" ${ready ? '' : 'disabled'}>Start war</button></div>` : '<p class="help">An owner/admin from either side can start when preparation opens.</p>'}`;
  } else if (war.state === 'active') {
    const myCap = myAttacks.length >= WAR_RULES.maxAttacksPerSide;
    const canAttack = isParticipant && readiness.eligible && hasRoster && !alreadyAttacked && !myCap && Date.now() <= war.attackEndsAt;
    const resumableAttack = war.attacks.find(attack => attack.identityId === currentIdentity.id && attack.tactics?.plan
      && (attack.orders?.length || 0) < 2 && !attack.returnedAt && Date.now() <= Math.min(war.attackEndsAt, attack.at + 45_000));
    actions = `<div class="war-scoreboard"><div><span>${escapeHTML(challenger.name)}</span><strong>${war.score[war.challengerCommunityId] || 0}</strong></div><span>VS</span><div><span>${escapeHTML(defender.name)}</span><strong>${war.score[war.defenderCommunityId] || 0}</strong></div></div>
      <p class="help">Attacks ${challengerCount}/${WAR_RULES.maxAttacksPerSide} · ${defenderCount}/${WAR_RULES.maxAttacksPerSide} · closes in <span data-war-countdown="${war.attackEndsAt}" data-war-mode="attack">${formatRemaining(war.attackEndsAt)}</span></p>
      <p class="help">Your locked home defence: ${escapeHTML(WAR_DEFENCE_ORDERS[homeDefence].name)}. Opposing order is revealed on deployment.</p>
      <p><b>Locked attacker base:</b> ${escapeHTML(warSnapshotLine(currentSide))}</p><p><b>Locked defence:</b> ${escapeHTML(warSnapshotLine(enemySide))}</p>
      <div class="row"><div class="war-tactic"><strong>ASSAULT · direct push</strong><p>Warden kit can add up to +${currentSide.stats.assaultKit.scoreBonus} score and shield ${currentSide.stats.assaultKit.casualtyShield} losses${currentSide.stats.assaultKit.reinforcementRole ? ' with a selected Sentinel' : ''}${currentSide.stats.assaultKit.supportRole ? ' and selected Lifeline' : ''}. Ridgewatch adds 2 per level; enemy barricades reduce Assault by 3 each.</p></div><div class="war-tactic"><strong>RECON · signal sweep</strong><p>Ghost kit can add up to +${currentSide.stats.reconKit.scoreBonus} score and shield ${currentSide.stats.reconKit.casualtyShield} losses${currentSide.stats.reconKit.supportRole ? ' with a selected Lifeline' : ''}. Signal Relay adds 2 per level; enemy barricades reduce Recon by 1 each. Defence Works reduces both tactics by 2 per level.</p></div></div>
      ${canAttack ? `<p class="help">Choose a route, target and approach before committing your one attack. The locked wall layout changes the risk and score.</p><div class="row"><button data-war-attack="assault" data-war-id="${escapeHTML(war.id)}">Plan Assault</button><button data-war-attack="recon" data-war-id="${escapeHTML(war.id)}">Plan Recon</button></div>` : `<p class="notice ${readiness.eligible ? '' : 'warn'}">${!readiness.eligible ? escapeHTML(readiness.unmetGates.join(' ')) : !hasRoster ? 'This identity was not on the verified pre-war roster.' : alreadyAttacked ? 'Your roster member has already deployed once.' : myCap ? 'Your community has used its two-attack cap.' : 'Attack window closed.'}</p>`}
      ${resumableAttack && readiness.eligible ? `<div class="row"><button data-war-resume="${escapeHTML(resumableAttack.attackId)}" data-war-id="${escapeHTML(war.id)}">Resume attack · ${resumableAttack.orders?.length || 0}/2 field orders</button></div>` : ''}
      ${leadership ? `<div class="row"><button data-war-resolve="${escapeHTML(war.id)}" ${canResolve ? '' : 'disabled'}>${canResolve ? 'Resolve war · lock result' : 'Resolve after all timed stages close'}</button></div>` : ''}`;
    if (war.stages?.length) actions += `<h3>Timed build challenges</h3><p class="help">One verified roster member per server completes each stage from the locked building tier. Stages open in sequence; first completion earns +2. Costs use personal DZN Parts and Timber, and points stay in this local war.</p>${war.stages.map(stage => {
      const definition = WAR_STAGE_DEFS.find(item => item.id === stage.id);
      if (!definition) return '';
      const own = stage.completedBy[currentCommunityId], enemyId = currentCommunityId === war.challengerCommunityId ? war.defenderCommunityId : war.challengerCommunityId;
      const enemy = stage.completedBy[enemyId];
      const now = Date.now(), open = now >= stage.opensAt && now < stage.closesAt;
      return `<article class="war-card ${open ? 'ready' : ''}"><b>${escapeHTML(definition.name)} · ${escapeHTML(definition.building)}</b><p>${escapeHTML(definition.objective)}</p><p class="help">${now < stage.opensAt ? `Opens in ${formatRemaining(stage.opensAt)}` : now < stage.closesAt ? `Closes in ${formatRemaining(stage.closesAt)}` : 'Closed'} · ${definition.parts} Parts + ${definition.timber} Timber · Your side: ${own ? `+${own.points} points` : 'pending'} · Rival: ${enemy ? `+${enemy.points} points` : 'pending'}</p>${!own && hasRoster && readiness.eligible && open ? `<button data-war-stage="${escapeHTML(stage.id)}" data-war-id="${escapeHTML(war.id)}">Complete ${escapeHTML(definition.name)}</button>` : ''}</article>`;
    }).join('')}<button data-war-refresh="${escapeHTML(war.id)}">Refresh stage timers</button>`;
  } else if (war.state === 'resolved') {
    const winner = war.tie ? 'TIE · no winner' : warCommunityName(war.winnerCommunityId);
    const localReward = war.rewards?.length || war.rewardLedgerIds?.length || 0;
    const impacts = war.events?.find(event => event.type === 'resolved')?.details?.wear?.filter(item => item.communityId === currentCommunityId) || [];
    const affected = [...new Set(impacts.map(item => item.plotId))].map(id => GAME_CONFIG.landPlots.find(plot => plot.id === id)?.name || id);
    actions = `<div class="notice"><b>${escapeHTML(winner)}</b><p>Final score ${war.score[war.challengerCommunityId] || 0} – ${war.score[war.defenderCommunityId] || 0}</p><p>Local-only activity rewards: ${localReward ? '40 Parts per deployed roster member, claimed once into this browser preview.' : 'No attacks were deployed; no reward.'}</p>${affected.length ? `<p>Battle aftermath · ${escapeHTML(affected.join(', '))} took cosmetic wear.</p>` : ''}<p class="help">This result never changes a DZN server leaderboard, match result, event feed or DayZ stat.</p></div>`;
  } else {
    actions = `<p class="notice">War ${escapeHTML(war.state)} · no attack or reward can be issued.</p>`;
  }
  if (isParticipant && ['preparation', 'active'].includes(war.state)) {
    const scouts = service.getScoutReports(currentIdentity.id, war.id);
    const ownScout = scouts.find(scout => scout.identityId === currentIdentity.id);
    const away = service.getAwaySquads(currentCommunityId, war.id);
    const ownAwayAttacks = war.attacks.filter(attack => attack.identityId === currentIdentity.id && attack.returnAt > Date.now() && !attack.returnedAt);
    actions += `<div class="world-mission"><strong>SCOUTS & HOME DEFENCE</strong><p>${away.length} squad${away.length === 1 ? '' : 's'} away from your base. Every away squad can expose home defence to a timely counterattack; barricades and a prepared home reserve can reduce the bonus.</p>${readiness.eligible && hasRoster && !ownScout && scouts.length < WAR_RULES.maxScoutsPerSide ? `<button data-war-scout="${escapeHTML(war.id)}">Send scout · ${WAR_RULES.scoutArrivalMs / 1000}s to intel</button>` : ''}${scouts.map(scout => `<p>${escapeHTML(scout.id)} · ${scout.recalledAt ? 'recalled' : scout.active ? scout.arrived ? `intel received, returns in ${formatRemaining(scout.returnAt)}` : `travelling, arrives in ${formatRemaining(scout.arrivalAt)}` : 'returned'}${scout.intel ? ` · Hall L${scout.intel.hallLevel}, Tower L${scout.intel.towerLevel}, ${scout.intel.fortification} barricades` : ''}${scout.active && scout.identityId === currentIdentity.id ? ` <button data-scout-recall="${escapeHTML(scout.id)}">Recall scout</button>` : ''}</p>`).join('')}${ownAwayAttacks.map(attack => `<p>War squad ${escapeHTML(attack.attackId)} returns in ${formatRemaining(attack.returnAt)} · <button data-war-recall="${escapeHTML(attack.attackId)}" data-war-id="${escapeHTML(war.id)}">Recall to defend (25% point cost)</button></p>`).join('')}</div>`;
  }
  const status = war.state.toUpperCase();
  const damageReports = war.attacks.length ? `<details class="war-card"><summary><b>Battle condition · ${war.attacks.length} deployment${war.attacks.length === 1 ? '' : 's'}</b></summary><p class="help">Each new strike starts from the damage already dealt to that base when it launches. Field orders never rewrite a later strike.</p>${war.attacks.map(attack => {
    const report = attack.damage;
    if (!report?.ok) return '';
    const breached = report.walls.filter(wall => wall.remainingHealth === 0 && (wall.startingHealth ?? wall.maxHealth) > 0).length;
    return `<p><b>${escapeHTML(attack.attackId)}</b> · ${escapeHTML(report.objective.name)} ${Math.round((report.objective.startingHealth ?? report.objective.maxHealth) / report.objective.maxHealth * 100)}% → ${Math.round(report.objective.remainingHealth / report.objective.maxHealth * 100)}% integrity · ${breached} new wall ${breached === 1 ? 'breach' : 'breaches'} · ${report.squad.length - report.casualties}/${report.squad.length} troops survived.</p>`;
  }).join('')}</details>` : '';
  return `<article class="war-card ${war.state === 'active' ? 'ready' : ''}" data-war-record="${escapeHTML(war.id)}" data-war-state="${escapeHTML(war.state)}"><span class="war-tag">${status} · ${escapeHTML(war.id)}</span><h3>${escapeHTML(challenger.name)} vs ${escapeHTML(defender.name)}</h3><p class="help">Captured before the challenge · fixed for scoring. ${isParticipant ? 'Shared war record for both preview communities.' : ''}</p>${actions}${damageReports}${warTimelineHTML(war)}</article>`;
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
  const trainingLoadout = service.getTrainingReadiness(profile.id);
  const trainingSquad = Object.values(trainingLoadout.counts).reduce((sum, count) => sum + count, 0);
  const baseCondition = service.snapshot(profile.id).base;
  const damaged = baseCondition.landPlots.filter(plot => plot.wear > 0);
  const repairPriority = baseCondition.repairPriority;
  const wearStages = damaged.reduce((sum, plot) => sum + plot.wear, 0);
  const repairSummary = damaged.length ? `<div class="notice warn"><b>Base condition · ${damaged.length} damaged district${damaged.length === 1 ? '' : 's'}</b><p>${wearStages} cosmetic wear stage${wearStages === 1 ? '' : 's'} · repair priority: ${escapeHTML(GAME_CONFIG.landPlots.find(plot => plot.id === repairPriority)?.name || 'awaiting leadership')}</p><button id="warRepairBtn">Open district repairs</button></div>` : '';
  let html = `<h2>War Table</h2>${repairSummary}<p>Server-versus-server <span class="sim">[LOCAL WAR PREVIEW]</span> · Iron Pines and Violet Ridge. Identity and Pro status are local fixtures, not live multiplayer.</p>${errorMessage ? `<p class="notice warn" role="status">${escapeHTML(errorMessage)}</p>` : ''}`;
  if (wars.length) html += `<h3>${activeWar ? 'Current war & history' : 'Past wars'}</h3>${wars.map(war => renderWarRecord(war, community.id, profile)).join('')}`;
  if (!activeWar) html += '<p class="help">No war underway. Open eligibility and challenge below to start one.</p>';
  html += `<details class="war-card" ${activeWar && !errorMessage ? '' : 'open'}><summary><b>Eligibility & new challenge</b></summary><p class="help">Owner/admin issues a challenge; the opposing owner/admin accepts. One local war at a time.</p>${communities}<div class="war-card"><b>Issue a challenge</b><div class="row"><label class="field-label" for="warOpponentSelect">Opponent community</label><select id="warOpponentSelect"><option value="${escapeHTML(otherCommunityId)}">${escapeHTML(otherOption?.communityName || otherCommunityId)}${targetReadiness.eligible ? '' : ' · locked'}</option><option value="mossback-free" disabled>Mossback Free Community · locked (Free tier)</option></select><button id="warChallengeBtn" ${canChallenge ? '' : 'disabled'}>Send challenge</button></div>${!leadership ? '<p class="notice warn">Only this community’s owner/admin may issue a challenge.</p>' : ''}${activeWar ? `<p class="notice">War ${escapeHTML(activeWar.id)} is already ${escapeHTML(activeWar.state)}. Resolve or close it before another challenge.</p>` : !targetReadiness.eligible ? `<p class="notice warn">Opponent gates: ${targetReadiness.unmetGates.map(escapeHTML).join(' ')}</p>` : !currentReadiness.eligible ? `<p class="notice warn">Your gates: ${currentReadiness.unmetGates.map(escapeHTML).join(' ')}</p>` : ''}</div></details>`;
  const lockedMessage = access.allowed ? '' : `<p class="notice warn">${escapeHTML(access.reason)}</p>`;
  html += `<details class="war-card"><summary><b>AI training · Outpost Delta</b></summary><p>${trainingSquad}/${trainingLoadout.capacity} troops · ${escapeHTML(trainingSquadSummary(trainingLoadout.counts))} · ${trainingLoadout.ready ? 'READY' : `Missing ${escapeHTML(trainingSquadSummary(trainingLoadout.missing))}`} · Attempts ${state.raidCount}.</p>${lockedMessage}<div class="row"><button id="configureTrainingBtn">Camp & squad</button><label class="field-label" for="trainingApproach">Approach</label><select id="trainingApproach"><option value="west">West cover</option><option value="south">South ridge</option><option value="east">East battery flank</option></select><button id="raidBtn" ${raid || raidLaunching || warBattle || !access.allowed || !trainingLoadout.ready ? 'disabled' : ''}>Launch drill</button></div><p class="help">Practice is separate from server war scores. Deployed troops leave your personal camp reserve; training jobs finish while away.</p></details><div class="row"><button id="closeBtn">Close</button></div>`;
  openPanel(html);
  if ($('warRepairBtn')) $('warRepairBtn').onclick = () => showLandPanel(repairPriority || damaged[0].id);
  $('closeBtn').onclick = closePanel;
  $('configureTrainingBtn').onclick = () => showTrainingLoadout();
  $('raidBtn').onclick = launchRaid;
  $('trainingApproach').value = selectedTrainingApproach;
  $('trainingApproach').onchange = () => { selectedTrainingApproach = $('trainingApproach').value; };
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
  panel.querySelectorAll('[data-war-defence-save]').forEach(button => button.onclick = () => {
    const selector = panel.querySelector(`[data-war-defence-select="${button.dataset.warDefenceSave}"]`);
    const result = service.setWarDefenceOrder(profile.id, button.dataset.warDefenceSave, selector.value);
    if (!result.ok) { showWarTable(result.error); return; }
    toast(`${result.name} set · locks when war starts.`); showWarTable();
  });
  panel.querySelectorAll('[data-war-attack]').forEach(button => button.onclick = () => showWarPlanner(button.dataset.warId, button.dataset.warAttack));
  panel.querySelectorAll('[data-war-resume]').forEach(button => button.onclick = () => resumeWarAttack(button.dataset.warId, button.dataset.warResume));
  panel.querySelectorAll('[data-war-stage]').forEach(button => button.onclick = () => {
    const result = service.completeWarStage(profile.id, button.dataset.warId, button.dataset.warStage);
    if (!result.ok) { showWarTable(result.error); return; }
    toast(`${WAR_STAGE_DEFS.find(stage => stage.id === result.stageId).name} complete · +${result.points} local points.`);
    updateHud(); showWarTable();
  });
  panel.querySelectorAll('[data-war-refresh]').forEach(button => button.onclick = () => showWarTable());
  panel.querySelectorAll('[data-war-scout]').forEach(button => button.onclick = () => {
    const result = service.dispatchScout(profile.id, button.dataset.warScout);
    toast(result.ok ? 'Scout dispatched · home defence exposed until return or recall.' : result.error);
    showWarTable();
  });
  panel.querySelectorAll('[data-scout-recall]').forEach(button => button.onclick = () => {
    const result = service.recallScout(profile.id, button.dataset.scoutRecall);
    toast(result.ok ? 'Scout returned to defend.' : result.error);
    showWarTable();
  });
  panel.querySelectorAll('[data-war-recall]').forEach(button => button.onclick = () => {
    const result = service.recallWarSquad(profile.id, button.dataset.warId, button.dataset.warRecall);
    toast(result.ok ? `Squad recalled · ${result.penalty} points traded for home defence.` : result.error);
    showWarTable();
  });
  panel.querySelectorAll('[data-war-resolve]').forEach(button => button.onclick = () => {
    const result = service.resolveWar(profile.id, button.dataset.warResolve);
    if (!result.ok) { showWarTable(result.error); return; }
    reconcileLandScenery(); updateHud();
    toast(result.tie ? 'War resolved · tie.' : `War resolved · ${warCommunityName(result.winnerCommunityId)} wins.`);
    showWarTable();
  });
}
$('warBtn').onclick = () => showWarTable();

// ---------- Playable Outpost Ember field ----------
// Mission rewards and hazards still come only from OperationsController.
// This view makes those choices physical: move around cover, reach a marked
// objective and issue the existing mission action there.
const FIELD_ORIGIN = new THREE.Vector3(38, 0, 27);
const fieldGroup = new THREE.Group();
fieldGroup.position.copy(FIELD_ORIGIN);
fieldGroup.visible = false;
scene.add(fieldGroup);
// Keep a precise walkable picking surface while showing the continuous forest
// underneath. The mission is an outpost cut into the woods, not a floating pad.
const fieldFloor = new THREE.Mesh(new THREE.PlaneGeometry(30, 36),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
fieldFloor.rotation.x = -Math.PI / 2;
fieldFloor.position.y = 0.07;
fieldGroup.add(fieldFloor);
function fieldPaving(x, z, width, depth, repeat = 1) {
  const paving = new THREE.Mesh(new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ map: tiledTexture('assets/concrete-pad.webp', repeat), roughness: 0.94,
      color: 0xc1c8b8 }));
  paving.rotation.x = -Math.PI / 2;
  paving.position.set(x, 0.055, z);
  paving.receiveShadow = true;
  fieldGroup.add(paving);
}
// Broken service roads join the two route choices without obscuring cover.
fieldPaving(0, -14, 9, 5, 1.3);
fieldPaving(-9, -10.5, 5, 5, 0.9);
fieldPaving(9, -10.5, 5, 5, 0.9);
fieldPaving(0, -1, 8, 4, 1.1);
fieldPaving(-9, -0.5, 5, 5, 0.9);
fieldPaving(9, -0.5, 5, 5, 0.9);
fieldPaving(-9, 8, 6, 6, 1);
fieldPaving(9, 8, 6, 6, 1);
fieldPaving(-9, 15, 5, 4, 0.8);
fieldPaving(9, 15, 5, 4, 0.8);
const fieldMarkers = new THREE.Group();
fieldGroup.add(fieldMarkers);
const fieldGate = new THREE.Group();
fieldGate.position.set(0, 0, -1);
fieldGroup.add(fieldGate);
const fieldTurret = new THREE.Group();
fieldTurret.position.set(16, 0, 3);
fieldGroup.add(fieldTurret);
const fieldCache = new THREE.Group();
fieldGroup.add(fieldCache);
const fieldBeaconMat = new THREE.MeshStandardMaterial({ color: 0x79d997, emissive: 0x2d9254, emissiveIntensity: 1.4 });
for (const [x, z] of [[-9, 8], [9, 8], [-9, 15], [9, 15]]) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.42, 36),
    new THREE.MeshBasicMaterial({ color: z === 15 ? 0x8ed0ff : 0xc084fc, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.11, z);
  fieldGroup.add(ring);
}
for (const [x, z] of [[-14, -16], [14, -16], [-14, 16], [14, 16]]) {
  cyl(fieldGroup, 0.14, 0.23, 2.2, MAT.dark, x, 0, z);
  box(fieldGroup, 0.36, 0.15, 0.36, fieldBeaconMat, x, 2.15, z);
}
for (const [x, z, colour] of [[-11, -14, 0x9ee7c2], [11, -3, 0xb7a9ee], [-10, 10, 0x9ee7c2]]) {
  const flood = new THREE.PointLight(colour, 2.4, 15, 2);
  flood.position.set(x, 3.1, z);
  fieldGroup.add(flood);
}
for (const [x, z] of [[-9, 8], [9, 8]]) {
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.65, 0.35, 20), MAT.metal);
  base.position.set(x, 0.24, z);
  fieldCache.add(base);
  const canister = new THREE.Group();
  canister.position.set(x, 0.42, z);
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.63, 0.7, 1.28, 16),
    new THREE.MeshStandardMaterial({ color: 0x283936, metalness: 0.72, roughness: 0.33 }));
  shell.position.y = 0.66;
  canister.add(shell);
  for (const height of [0.13, 0.72, 1.27]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.69, 0.075, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0x9a79bd, emissive: 0x4c1c81, emissiveIntensity: 0.8, metalness: 0.5 }));
    band.rotation.x = Math.PI / 2;
    band.position.y = height;
    canister.add(band);
  }
  const strip = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.84, 12),
    new THREE.MeshStandardMaterial({ color: 0x8efa89, emissive: 0x36e35b, emissiveIntensity: 1.5 }));
  strip.position.y = 0.72;
  canister.add(strip);
  fieldCache.add(canister);
  const glow = new THREE.PointLight(0x78fa9a, 5, 5);
  glow.position.set(x, 1.55, z);
  fieldCache.add(glow);
}
let fieldTurretRig = null;
let fieldBuildRequested = false;
function buildFieldSet() {
  if (fieldBuildRequested) return;
  fieldBuildRequested = true;
  const addAsset = (path, key, level, x, z) => loadBuildingTemplate(path).then(template => {
    const model = key ? normalizeBuildingClone(template, key, level) : template.clone(true);
    model.position.set(x, 0.09, z);
    model.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
    fieldGroup.add(model);
    return model;
  }).catch(error => console.warn('Outpost Ember detail kept its simple fallback.', error));
  addAsset(getBuildingAsset('comms', 2).glb, 'comms', 2, -17, -4);
  addAsset(getBuildingAsset('workshop', 2).glb, 'workshop', 2, 17, 12);
  loadBuildingTemplate(getBuildingAsset('tower', 2).glb).then(template => {
    const model = normalizeBuildingClone(template, 'tower', 2);
    fieldTurret.add(model);
    fieldTurretRig = model.userData.turretRig;
  }).catch(error => console.warn('Outpost Ember battery detail unavailable.', error));
  wallModel(2).then(template => {
    if (!template) return;
    for (const x of [-2, 0, 2]) {
      const segment = template.clone(true);
      segment.position.set(x, 0.1, 0);
      fieldGate.add(segment);
    }
  }).catch(error => console.warn('Outpost Ember barrier detail unavailable.', error));
  Promise.all([sceneryModel('fallen_trunk'), sceneryModel('lumber_pallet')]).then(([trunk, pallet]) => {
    for (const cover of EXPEDITION_FIELD.cover) {
      const source = trunk.clone(true);
      source.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(source);
      const size = bounds.getSize(new THREE.Vector3());
      if (size.x <= 0 || size.z <= 0) continue;
      const scale = Math.min(2.1, Math.max(0.65, (cover.maxX - cover.minX + 1) / Math.max(size.x, size.z)));
      for (const offset of [-0.22, 0.22]) {
        const log = trunk.clone(true);
        log.scale.setScalar(scale);
        log.position.set((cover.minX + cover.maxX) / 2 + offset, 0.08,
          (cover.minZ + cover.maxZ) / 2 - offset * 0.45);
        log.rotation.y = offset < 0 ? 0.1 : 0.32;
        fieldGroup.add(log);
      }
    }
    for (const x of [-9, 9]) {
      const stack = pallet.clone(true);
      stack.position.set(x + 2.25, 0.08, 8);
      fieldGroup.add(stack);
    }
  }).catch(error => console.warn('Outpost Ember cover detail unavailable.', error));
  Promise.all(['pine_l03', 'pine_l04', 'pine_l05', 'granite_boulder',
    'mossy_rock_cluster', 'fern_patch', 'brush_pile'].map(sceneryModel)).then(
    ([pine3, pine4, pine5, boulder, rocks, fern, brush]) => {
      const perimeter = [
        [-21, -18, pine4], [-17, -12, pine5], [-22, -5, pine3], [-18, 2, pine4],
        [-21, 10, pine5], [-17, 18, pine3], [-12, -22, pine3], [-5, -21, pine5],
        [3, -22, pine4], [11, -21, pine3], [19, -17, pine4], [21, -7, pine3],
      ];
      for (const [x, z, template] of perimeter) {
        const tree = template.clone(true);
        tree.position.set(x, 0.06, z);
        tree.rotation.y = (x * 0.37 + z * 0.19) % (Math.PI * 2);
        tree.scale.setScalar(0.82 + (Math.abs(x + z) % 5) * 0.08);
        tree.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
        fieldGroup.add(tree);
      }
      const lowDetails = [
        [-14, -12], [-15, -4], [-15, 7], [-13, 17], [14, -14], [16, -3],
        [17, 8], [14, 17], [-2, -19], [7, 19], [-18, 15], [20, 2],
      ];
      for (const [index, [x, z]] of lowDetails.entries()) {
        const detail = (index % 4 === 0 ? boulder : index % 3 === 0 ? rocks :
          index % 2 === 0 ? brush : fern).clone(true);
        detail.position.set(x, 0.06, z);
        detail.rotation.y = index * 1.7;
        detail.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
        fieldGroup.add(detail);
      }
    }).catch(error => console.warn('Outpost Ember forest detail unavailable.', error));
}
const fieldHud = document.createElement('section');
fieldHud.id = 'fieldHud';
fieldHud.hidden = true;
fieldHud.setAttribute('aria-label', 'Outpost Ember field command');
document.body.append(fieldHud);
function fieldLabel(text, colour) {
  const canvas = document.createElement('canvas');
  canvas.width = 384; canvas.height = 76;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#091510ee'; ctx.fillRect(4, 5, 376, 66);
  ctx.strokeStyle = '#' + colour.toString(16).padStart(6, '0');
  ctx.lineWidth = 3; ctx.strokeRect(4, 5, 376, 66);
  ctx.fillStyle = '#f2fff2'; ctx.font = '700 27px Inter, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(text, 192, 47);
  const texture = new THREE.CanvasTexture(canvas);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  label.scale.set(3.6, 0.72, 1);
  return label;
}
function clearFieldMarkers() {
  for (const marker of [...fieldMarkers.children]) {
    marker.traverse(object => {
      if (object.isSprite) { object.material.map.dispose(); object.material.dispose(); }
      else if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); }
    });
    fieldMarkers.remove(marker);
  }
}
function refreshFieldMarkers(attempt) {
  clearFieldMarkers();
  if (attempt.status !== 'active') return;
  const choices = EXPEDITION_FIELD.choices[attempt.phase] || [];
  choices.forEach((choice, index) => {
    const disabled = choice.id === 'cut' && !attempt.roster.engineer;
    const colour = disabled ? 0x737a72 : choice.colour;
    const marker = new THREE.Group();
    marker.position.set(choice.x, 0, choice.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.48, 36),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15; marker.add(ring);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 2.15, 12),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.38, depthWrite: false }));
    column.position.y = 1.15; marker.add(column);
    const label = fieldLabel((index + 1) + '  ' + choice.label.toUpperCase(), colour);
    label.position.y = 3; marker.add(label);
    const pick = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 }));
    pick.position.y = 1.2;
    pick.userData.fieldChoice = choice.id;
    marker.add(pick);
    marker.userData.ring = ring;
    marker.userData.choice = choice.id;
    marker.userData.disabled = disabled;
    fieldMarkers.add(marker);
  });
  fieldGate.position.y = attempt.breached ? -1.7 : 0;
}
let fieldLoadToken = 0;
function renderFieldHud(message = '') {
  if (!fieldSession) return;
  const attempt = operations.current(fieldSession.identityId);
  if (!attempt) { leaveExpeditionField(); return; }
  fieldHud.replaceChildren();
  const title = document.createElement('div');
  title.className = 'field-title';
  title.textContent = 'OUTPOST EMBER  /  ' + OPERATIVES[attempt.operativeId].name.toUpperCase();
  fieldHud.append(title);
  const stage = document.createElement('div');
  stage.className = 'field-stage';
  stage.textContent = attempt.status === 'active'
    ? attempt.phase.toUpperCase() + '  •  Choose a marked field objective'
    : attempt.status === 'extracted' ? 'EXTRACTION COMPLETE' : 'MISSION ' + attempt.status.toUpperCase();
  fieldHud.append(stage);
  const stats = document.createElement('div');
  stats.className = 'field-stats';
  stats.textContent = 'HEALTH ' + attempt.health + '   SHIELD ' + attempt.shield
    + '   DOWN ' + attempt.casualties + '   CARGO ' + attempt.cargo + ' PARTS';
  fieldHud.append(stats);
  const clock = document.createElement('div');
  clock.id = 'fieldClock';
  clock.className = 'field-clock';
  clock.textContent = attempt.status === 'active'
    ? 'Window ' + formatRemaining(attempt.deadlineAt) + '  ·  tap ground to move, tap a beacon or press 1/2'
    : 'Saved result · ' + attempt.reward + ' Parts delivered once';
  fieldHud.append(clock);
  if (message) {
    const note = document.createElement('p');
    note.className = 'field-message';
    note.textContent = message;
    fieldHud.append(note);
  }
  if (attempt.status === 'active') {
    const actions = document.createElement('div');
    actions.className = 'field-actions';
    for (const [index, choice] of EXPEDITION_FIELD.choices[attempt.phase].entries()) {
      const button = document.createElement('button');
      button.textContent = (index + 1) + ' · ' + choice.label;
      button.disabled = choice.id === 'cut' && !attempt.roster.engineer;
      if (button.disabled) button.title = 'Needs a Fixer combat engineer';
      button.onclick = () => orderFieldChoice(choice.id);
      actions.append(button);
    }
    fieldHud.append(actions);
    const abilities = document.createElement('div');
    abilities.className = 'field-abilities';
    const tactical = document.createElement('button');
    tactical.textContent = 'Tactical · ' + OPERATIVES[attempt.operativeId].tactical;
    const abilityTargetReady = attempt.operativeId === 'rivet' ? attempt.phase === 'barrier'
      : attempt.operativeId === 'signal' ? ['approach', 'barrier'].includes(attempt.phase)
        : attempt.casualties > 0 || attempt.health < 100;
    tactical.disabled = !abilityTargetReady || attempt.turn < attempt.tacticalReadyTurn;
    tactical.onclick = () => activateFieldAbility('tactical');
    abilities.append(tactical);
    const ultimate = document.createElement('button');
    ultimate.textContent = 'Ultimate · ' + OPERATIVES[attempt.operativeId].ultimate;
    ultimate.disabled = !abilityTargetReady || attempt.ultimateUsed;
    ultimate.onclick = () => activateFieldAbility('ultimate');
    abilities.append(ultimate);
    if (!attempt.fieldUpgrade && attempt.phase !== 'extraction') {
      const upgrade = document.createElement('select');
      upgrade.setAttribute('aria-label', 'Temporary field upgrade');
      for (const [id, label] of Object.entries(FIELD_UPGRADES)) {
        const option = document.createElement('option');
        option.value = id; option.textContent = label;
        upgrade.append(option);
      }
      const install = document.createElement('button');
      install.textContent = 'Install upgrade';
      install.onclick = () => {
        const result = operations.chooseFieldUpgrade(fieldSession.identityId, upgrade.value);
        renderFieldHud(result.ok ? 'Temporary field kit installed.' : result.error);
      };
      abilities.append(upgrade, install);
    }
    fieldHud.append(abilities);
  }
  const footer = document.createElement('div');
  footer.className = 'field-footer';
  const back = document.createElement('button');
  back.textContent = '← Back to base';
  back.onclick = leaveExpeditionField;
  footer.append(back);
  if (attempt.status === 'active') {
    const withdraw = document.createElement('button');
    withdraw.textContent = 'Withdraw squad';
    withdraw.onclick = () => {
      const result = operations.withdraw(fieldSession.identityId);
      if (result.ok) { refreshFieldMarkers(operations.current(fieldSession.identityId)); renderFieldHud('Squad withdrawn. No cargo awarded.'); updateHud(); }
      else renderFieldHud(result.error);
    };
    footer.append(withdraw);
  }
  fieldHud.append(footer);
}
function enterExpeditionField() {
  const identityId = service.state.currentIdentityId;
  const attempt = operations.current(identityId);
  if (!attempt || attempt.status !== 'active') { showOperationsBoard('Start a salvage run first.'); return; }
  if (fallback2D) { showOperationsBoard('The field needs WebGL; the accessible Operations Board remains playable.'); return; }
  if (raid || warBattle) { toast('Finish the current battle first.'); return; }
  if (fieldSession) leaveExpeditionField();
  stopPatrolFocus();
  buildFieldSet();
  const point = attempt.fieldPosition || EXPEDITION_FIELD.start;
  const hiddenObjects = [
    ...Object.values(buildings).map(building => building.group), ...patrols.map(patrol => patrol.mesh),
    ...defenderPatrols.values().map(patrol => patrol.mesh), operativeMesh, landScenery, ...outpostBlocks,
  ];
  const previousVisibility = new Map(hiddenObjects.map(object => [object, object.visible]));
  const leader = new THREE.Group();
  leader.position.set(point.x, 0, point.z);
  fieldGroup.add(leader);
  const followers = [];
  for (const [role, count] of Object.entries(attempt.roster)) for (let i = 0; i < count; i++) {
    const mesh = makeSoldier(role, state.levels);
    mesh.position.set(point.x + (followers.length % 2 ? -0.6 : 0.6), 0, point.z - 0.8 - Math.floor(followers.length / 2) * 0.5);
    fieldGroup.add(mesh);
    followers.push(mesh);
  }
  const token = ++fieldLoadToken;
  fieldSession = {
    identityId, attemptId: attempt.id, leader, followers, route: [], pendingChoice: null,
    trail: [], hiddenObjects, previousVisibility, previousTarget: camTarget.clone(),
    previousZoom: zoom, previousOffset: cameraOffset.clone(), time: 0, fireFor: 0, mixer: null,
    activeAction: null, actions: null, lastStatus: attempt.status,
  };
  loadAnimatedSquad(operativeAsset(attempt.operativeId)).then(asset => {
    if (token !== fieldLoadToken || !fieldSession || fieldSession.leader !== leader) return;
    const model = cloneSkeleton(asset.scene);
    model.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
    leader.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const walk = asset.animations.find(clip => clip.name === 'DZN_Operative_Walk') || asset.animations[0];
    const idle = asset.animations.find(clip => clip.name === 'DZN_Operative_Idle');
    if (walk) {
      const actions = { walk: mixer.clipAction(walk), idle: mixer.clipAction(idle || walk) };
      actions.idle.play();
      fieldSession.mixer = mixer;
      fieldSession.actions = actions;
      fieldSession.activeAction = actions.idle;
    }
  }).catch(error => {
    if (token !== fieldLoadToken || !fieldSession || fieldSession.leader !== leader) return;
    console.warn('Outpost Ember commander model unavailable; using squad rig.', error);
    leader.add(makeSoldier(OPERATIVES[attempt.operativeId].role, state.levels));
  });
  for (const object of hiddenObjects) object.visible = false;
  fieldGroup.visible = true;
  refreshFieldMarkers(attempt);
  document.body.classList.add('field-mode');
  fieldHud.hidden = false;
  closePanel();
  camTarget.copy(FIELD_ORIGIN).add(new THREE.Vector3(point.x * 0.6, 0, point.z * 0.6));
  cameraOffset.set(35, 43, 36);
  zoom = 29;
  updateCamera();
  renderFieldHud();
  toast('Outpost Ember deployed. Move to a glowing objective.');
}
function leaveExpeditionField() {
  if (!fieldSession) return;
  fieldLoadToken++;
  fieldSession.mixer?.stopAllAction();
  for (const follower of fieldSession.followers) follower.userData.loadToken = (follower.userData.loadToken || 0) + 1;
  fieldGroup.remove(fieldSession.leader, ...fieldSession.followers);
  fieldGroup.visible = false;
  clearFieldMarkers();
  for (const [object, visible] of fieldSession.previousVisibility) object.visible = visible;
  camTarget.copy(fieldSession.previousTarget);
  cameraOffset.copy(fieldSession.previousOffset);
  zoom = fieldSession.previousZoom;
  fieldSession = null;
  fieldHud.hidden = true;
  document.body.classList.remove('field-mode');
  updateCamera();
  updateHud();
}
function setFieldDestination(point, choiceId = null) {
  if (!fieldSession) return false;
  const local = fieldSession.leader.position;
  const route = expeditionFieldPath({ x: local.x, z: local.z }, point);
  if (!route) { renderFieldHud('That ground is blocked by cover. Choose a clear path.'); return false; }
  fieldSession.route = route.slice(1).map(step => new THREE.Vector3(step.x, 0, step.z));
  fieldSession.pendingChoice = choiceId ? { id: choiceId, phase: operations.current(fieldSession.identityId)?.phase } : null;
  if (!fieldSession.route.length && fieldSession.pendingChoice) resolveFieldChoice();
  return true;
}
function orderFieldChoice(choiceId) {
  if (!fieldSession) return;
  const attempt = operations.current(fieldSession.identityId);
  const point = EXPEDITION_FIELD.choices[attempt?.phase]?.find(choice => choice.id === choiceId);
  if (!point || (choiceId === 'cut' && !attempt.roster.engineer)) { renderFieldHud('That objective is not available to this squad.'); return; }
  setFieldDestination(point, choiceId);
}
function resolveFieldChoice() {
  if (!fieldSession?.pendingChoice) return;
  const { id, phase } = fieldSession.pendingChoice;
  fieldSession.pendingChoice = null;
  const before = operations.current(fieldSession.identityId);
  if (!before || before.phase !== phase || before.status !== 'active') { renderFieldHud('The objective changed. Choose the current beacon.'); return; }
  const result = operations.advance(fieldSession.identityId, id);
  if (!result.ok) { renderFieldHud(result.error); return; }
  const after = operations.current(fieldSession.identityId);
  fieldSession.lastStatus = after.status;
  if (after.shield < before.shield || after.health < before.health) {
    fieldSession.fireFor = 0.7;
    for (let i = 0; i < 3; i++) spawnSmoke(FIELD_ORIGIN.clone().add(fieldSession.leader.position).add(new THREE.Vector3(Math.sin(i * 2), 1, Math.cos(i * 2))));
  }
  if (after.status === 'extracted') { beep(840, 0.16); toast('Convoy extracted · +' + after.reward + ' personal Parts'); }
  else if (after.status !== 'active') toast('Outpost Ember mission ' + after.status + '.');
  else beep(620, 0.1);
  refreshFieldMarkers(after);
  renderFieldHud(after.events.at(-1)?.text || 'Objective resolved.');
  updateHud();
}
function activateFieldAbility(kind) {
  if (!fieldSession) return;
  const result = operations.useAbility(fieldSession.identityId, kind);
  if (result.ok) {
    const attempt = operations.current(fieldSession.identityId);
    refreshFieldMarkers(attempt);
    spawnSmoke(FIELD_ORIGIN.clone().add(fieldSession.leader.position).add(new THREE.Vector3(0, 1, 0)));
    renderFieldHud(OPERATIVES[attempt.operativeId][kind] + ' activated.');
  } else renderFieldHud(result.error);
}
function updateExpeditionField(dt) {
  if (!fieldSession) return;
  const session = fieldSession;
  const attempt = operations.current(session.identityId);
  if (!attempt || attempt.id !== session.attemptId) { leaveExpeditionField(); return; }
  if (attempt.status !== session.lastStatus) {
    session.lastStatus = attempt.status;
    session.route.length = 0;
    session.pendingChoice = null;
    refreshFieldMarkers(attempt);
    renderFieldHud(attempt.status === 'expired' ? 'The mission window closed before extraction.' : 'Mission status changed.');
  }
  session.time += dt;
  camTarget.lerp(FIELD_ORIGIN.clone().add(new THREE.Vector3(session.leader.position.x * 0.6, 0, session.leader.position.z * 0.6)),
    Math.min(1, dt * 4));
  updateCameraPosition();
  let moving = false;
  if (session.route.length) {
    const target = session.route[0];
    const delta = target.clone().sub(session.leader.position);
    const distance = delta.length();
    const step = Math.min(distance, dt * 5.2);
    if (distance > 0.001) {
      session.leader.position.addScaledVector(delta, step / distance);
      session.leader.rotation.y = Math.atan2(delta.x, delta.z);
      moving = true;
    }
    if (distance <= step + 0.02) {
      session.leader.position.copy(target);
      session.route.shift();
      if (!session.route.length && session.pendingChoice) resolveFieldChoice();
    }
  }
  session.trail.unshift(session.leader.position.clone());
  if (session.trail.length > 90) session.trail.length = 90;
  for (const [index, follower] of session.followers.entries()) {
    const sample = session.trail[Math.min(session.trail.length - 1, 10 + index * 9)] || session.leader.position;
    const offset = index % 2 ? -0.45 : 0.45;
    const target = sample.clone().add(new THREE.Vector3(offset, 0, -0.45 - Math.floor(index / 2) * 0.28));
    const was = follower.position.clone();
    follower.position.lerp(target, Math.min(1, dt * 5));
    const direction = follower.position.clone().sub(was);
    if (direction.lengthSq() > 0.0002) follower.rotation.y = Math.atan2(direction.x, direction.z);
    animateSoldier(follower, session.time * 9 + index, direction.lengthSq() > 0.0002 ? 1 : 0, null, dt);
  }
  if (session.actions && session.mixer) {
    const next = moving ? session.actions.walk : session.actions.idle;
    if (next !== session.activeAction) {
      next.reset().fadeIn(0.15).play();
      session.activeAction?.fadeOut(0.15);
      session.activeAction = next;
    }
    session.mixer.update(dt);
  }
  if (fieldTurretRig) {
    const target = FIELD_ORIGIN.clone().add(session.leader.position).add(new THREE.Vector3(0, 1.3, 0));
    stepArcBattery(fieldTurretRig, dt, session.time, target, session.fireFor > 0);
  }
  session.fireFor = Math.max(0, session.fireFor - dt);
  for (const marker of fieldMarkers.children) {
    const ring = marker.userData.ring;
    ring.material.opacity = marker.userData.disabled ? 0.25 : 0.6 + Math.sin(session.time * 4) * 0.25;
  }
  const clock = document.getElementById('fieldClock');
  if (clock && operations.current(session.identityId)?.status === 'active') clock.textContent =
    'Window ' + formatRemaining(attempt.deadlineAt) + '  ·  tap ground to move, tap a beacon or press 1/2';
}
window.addEventListener('keydown', event => {
  if (!fieldSession || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === 'Escape') { leaveExpeditionField(); event.preventDefault(); }
  if (event.key === '1' || event.key === '2') {
    const phase = operations.current(fieldSession.identityId)?.phase;
    const choice = EXPEDITION_FIELD.choices[phase]?.[Number(event.key) - 1];
    if (choice) { orderFieldChoice(choice.id); event.preventDefault(); }
  }
});
function showOperationsBoard(message = '') {
  const identityId = service.state.currentIdentityId;
  const board = operations.getBoard(identityId);
  if (!board.ok) { toast(board.error); return; }
  if (!board.access.allowed) {
    openPanel(`<h2>DZN Operations</h2><p class="notice warn">${escapeHTML(board.access.reason)}</p><p class="help">Private community signals, preparation and missions are available to verified members of an eligible owner Pro server. This is a local preview identity, not a DZN login.</p><div class="row"><button id="closeBtn">Close</button></div>`);
    $('closeBtn').onclick = closePanel;
    return;
  }
  const attempt = board.current;
  const active = attempt?.status === 'active';
  const selected = board.selected;
  const roster = Object.entries(OPERATIVES).map(([id, op]) => {
    const tier = squadTier(op.role, state.levels);
    return `<article class="operative-card ${selected === id ? 'selected' : ''}"><img src="${escapeHTML(squadPortrait(op.role, tier))}" alt="${escapeHTML(op.name)} DZN kit preview" loading="lazy"><div><strong>${escapeHTML(op.name)}</strong><small>${escapeHTML(op.title)} · kit L${tier}</small><small>${escapeHTML(op.passive)} · ${escapeHTML(op.tactical)} · ${escapeHTML(op.ultimate)}</small></div><button data-select-operative="${id}" ${active || selected === id ? 'disabled' : ''}>${selected === id ? 'Command slot selected' : 'Assign commander'}</button></article>`;
  }).join('');
  const profile = operations.showcase(identityId);
  const mastery = Object.entries(profile.mastery).map(([id, count]) => `<span>${escapeHTML(OPERATIVES[id].name)} ${count}</span>`).join(' · ');
  const badges = [
    ['First Through', profile.earned.firstThrough, 'Extract after breaching a route'],
    ['Eyes on Target', profile.earned.eyesOnTarget, 'Extract with route intelligence'],
    ['Siege Medic', profile.earned.siegeMedic, 'Extract after a real casualty recovery'],
  ].map(([name, earned, criterion]) => `<div class="operation-ping"><strong>${earned ? '✦ ' : '◇ '}${name}</strong><span>${earned ? 'Earned in local PvE' : criterion}</span></div>`).join('');
  let missionHTML = '';
  if (!attempt) {
    const troopInputs = Object.entries(SQUAD_ROLES).map(([role, squad]) => `<label class="field-label" for="opsTroop${role}">${escapeHTML(squad.name)} <input id="opsTroop${role}" data-ops-troop="${role}" type="number" min="0" max="12" step="1" value="${role === 'assault' || role === 'engineer' ? 1 : 0}" ${squadUnlocked(role, state.levels) ? '' : 'disabled'}></label>`).join('');
    missionHTML = `<div class="war-card ready"><h3>Salvage Run · Outpost Ember</h3><p>Scout a route, open a shutter, choose a cache and extract before the ten minute window closes. One commander uses ${EXPEDITION_RULES.commanderSlots} of ${board.capacity} slots. The rest hold ordinary troops. ${EXPEDITION_RULES.launchSalvage} personal Salvage prepares the convoy.</p><div class="operation-orders">${troopInputs}</div><p id="opsCapacity" class="help"></p><div class="row"><button id="opsLaunch">Deploy ${escapeHTML(OPERATIVES[selected].name)}</button></div></div>`;
  } else {
    const phases = ['approach', 'barrier', 'cache', 'extraction'];
    const currentIndex = phases.indexOf(attempt.phase);
    const track = `<div class="operation-stage-track" aria-label="Expedition stage">${phases.map((phase, index) => `<span class="${active && index === currentIndex ? 'current' : index < currentIndex || !active ? 'done' : ''}">${phase.toUpperCase()}</span>`).join('')}</div>`;
    const choices = { approach: [['scout', 'Scout · safer route'], ['push', 'Rush · higher risk']], barrier: [['cut', 'Engineer cut'], ['force', 'Force through']], cache: [['secure', 'Core cache · 40 Parts'], ['extra', 'Extra cache · 65 Parts, high risk']], extraction: [['extract', 'Rapid pickup · 75% cargo, safe'], ['hold', 'Hold beacon · full cargo, 50 hazard']] };
    const abilityTargetReady = attempt.operativeId === 'rivet' ? attempt.phase === 'barrier'
      : attempt.operativeId === 'signal' ? ['approach', 'barrier'].includes(attempt.phase)
      : attempt.casualties > 0 || attempt.health < 100;
    const fieldChoice = attempt.fieldUpgrade ? `<p class="notice">Field Upgrade: ${escapeHTML(FIELD_UPGRADES[attempt.fieldUpgrade])}</p>`
      : attempt.phase === 'extraction' ? '<p class="help">Field Upgrade window closed at extraction.</p>'
      : `<h3>Choose one temporary Field Upgrade</h3><div class="operation-orders">${Object.entries(FIELD_UPGRADES).map(([id, label]) => `<button data-field-upgrade="${id}">${escapeHTML(label)}</button>`).join('')}</div>`;
    const actions = active ? `<div class="operation-orders">${choices[attempt.phase].map(([id, label]) => `<button data-op-step="${id}" ${id === 'cut' && !attempt.roster.engineer ? 'disabled title="Needs a Combat Engineer"' : ''}>${label}</button>`).join('')}</div><div class="operation-orders"><button id="opsTactical" ${attempt.turn < attempt.tacticalReadyTurn || !abilityTargetReady ? 'disabled' : ''}>Tactical · ${escapeHTML(OPERATIVES[attempt.operativeId].tactical)}</button><button id="opsUltimate" ${attempt.ultimateUsed || !abilityTargetReady ? 'disabled' : ''}>Ultimate · ${escapeHTML(OPERATIVES[attempt.operativeId].ultimate)}</button></div><p class="help">${escapeHTML(OPERATIVES[attempt.operativeId].tacticalText)} Tactical ready at turn ${attempt.tacticalReadyTurn}; Ultimate once per attempt. All effects are bounded.</p>${fieldChoice}<div class="row"><button id="opsWithdraw">Withdraw · lose cargo</button></div>` : `<p class="notice">${attempt.status === 'extracted' ? `Extraction complete · ${attempt.reward} of ${attempt.cargo} collected Parts delivered to personal inventory.` : `Expedition ${escapeHTML(attempt.status)} · no Parts awarded.`} Start a new run when ready.</p><div class="row"><button id="opsNew">Prepare another run</button></div>`;
    missionHTML = `<div class="war-card ready"><h3>Outpost Ember · ${escapeHTML(OPERATIVES[attempt.operativeId].name)}</h3><p>Attempt ${escapeHTML(attempt.id)} · ${active ? `window closes in <b id="opsCountdown">${formatRemaining(attempt.deadlineAt)}</b>` : escapeHTML(attempt.status)}</p>${track}<div class="operation-statline"><b>Health ${attempt.health}/100</b><b>Shield ${attempt.shield}</b><b>Incapacitated ${attempt.casualties}</b><b>Recovered ${attempt.recovered}</b><b>Recovery charges ${attempt.recoveriesLeft}</b><b>Cargo ${attempt.cargo} Parts</b></div>${actions}<div class="operation-log"><strong>Field record</strong>${attempt.events.slice().reverse().map(event => `<p>${escapeHTML(event.text)}</p>`).join('')}</div></div>`;
  }
  if (active && !fallback2D) missionHTML += '<div class="row"><button id="opsEnterField">Enter 3D field</button><span class="help">Move through Outpost Ember and select objectives in the world.</span></div>';
  const pings = board.pings.slice().reverse().map(ping => `<div class="operation-ping"><strong>${escapeHTML(PING_TYPES[ping.type])} · ${escapeHTML(ping.target)}</strong><span>${escapeHTML(ping.author)} · expires in ${formatRemaining(ping.expiresAt)} · ${ping.acknowledgedBy.length} acknowledged · suggestion</span>${!ping.acknowledgedBy.includes(identityId) ? `<button data-ack-ping="${escapeHTML(ping.id)}">Acknowledge</button>` : ''}</div>`).join('');
  const reports = board.history.slice(-3).reverse().map(record => `<details class="operation-log"><summary>${escapeHTML(record.id)} · ${escapeHTML(record.status)} · ${record.reward} Parts</summary><p>${escapeHTML(OPERATIVES[record.operativeId].name)} · ${record.extractionMode === 'held' ? 'held beacon' : record.extractionMode === 'rapid' ? 'rapid pickup' : 'legacy mission'} · cargo ${record.cargo} · recovered ${record.recovered}</p>${record.events.map(event => `<p>${escapeHTML(event.text)}</p>`).join('') || '<p>Earlier mission; detailed field record unavailable.</p>'}</details>`).join('');
  openPanel(`<h2>DZN Operations Board</h2><p>One operative commands the ordinary army. The selected commander is a textured, animated 3D character at the bivouac while home and leaves the base during an expedition. Shared construction and local wars keep their existing rules. <span class="sim">[LOCAL PREVIEW]</span></p>${message ? `<p class="notice" role="status">${escapeHTML(message)}</p>` : ''}<div class="operations-layout"><div><h3>Operative Bay</h3><div class="operative-roster">${roster}</div>${missionHTML}${reports ? `<h3>After-action reports</h3>${reports}` : ''}</div><aside class="operations-side"><h3>Community signals</h3><p class="help">Suggestions are visible only to this eligible preview community. They expire after 15 minutes; acknowledgement is not owner approval.</p><label class="field-label" for="opsPingType">Signal</label><select id="opsPingType">${Object.entries(PING_TYPES).map(([id, name]) => `<option value="${id}">${escapeHTML(name)}</option>`).join('')}</select><label class="field-label" for="opsPingTarget">Target or objective</label><input id="opsPingTarget" maxlength="70" placeholder="e.g. west shutter"><div class="row"><button id="opsPostPing">Place signal</button></div>${pings || '<p class="help">No active signals.</p>'}<h3>Personal showcase</h3><p>${profile.completed} extracted mission${profile.completed === 1 ? '' : 's'} · ${mastery}</p>${badges}<p class="help">These are local PvE achievements with attempt evidence. Calling cards are cosmetic and never grant combat power.</p></aside></div><div class="row"><button id="closeBtn">Return to base</button></div>`);
  $('closeBtn').onclick = closePanel;
  if ($('opsEnterField')) $('opsEnterField').onclick = enterExpeditionField;
  panel.querySelectorAll('[data-select-operative]').forEach(button => button.onclick = () => { const result = operations.selectOperative(identityId, button.dataset.selectOperative); showOperationsBoard(result.ok ? `${OPERATIVES[result.operativeId].name} assigned to your command slot.` : result.error); });
  const troopFields = [...panel.querySelectorAll('[data-ops-troop]')];
  if (troopFields.length) {
    const updateCapacity = () => {
      const total = troopFields.reduce((sum, field) => sum + (Number(field.value) || 0), 0) + EXPEDITION_RULES.commanderSlots;
      $('opsCapacity').textContent = `${total}/${board.capacity} command slots · selected operative costs 2 · troop kit follows shared Hall/support levels.`;
      $('opsLaunch').disabled = total < 3 || total > board.capacity || service.member(identityId).salvage < EXPEDITION_RULES.launchSalvage || troopFields.some(field => !Number.isSafeInteger(Number(field.value)) || Number(field.value) < 0);
    };
    troopFields.forEach(field => field.oninput = updateCapacity); updateCapacity();
    $('opsLaunch').onclick = () => {
      const troops = Object.fromEntries(troopFields.map(field => [field.dataset.opsTroop, Number(field.value)]));
      const result = operations.startExpedition(identityId, troops);
      if (result.ok) { toast('Salvage convoy deployed.'); updateHud(); }
      if (result.ok && !fallback2D) enterExpeditionField();
      else showOperationsBoard(result.ok ? 'Outpost Ember mission started. Choose your first route.' : result.error);
    };
  }
  panel.querySelectorAll('[data-op-step]').forEach(button => button.onclick = () => {
    const result = operations.advance(identityId, button.dataset.opStep);
    if (result.ok && result.status === 'extracted') { celebrateUpgrade(-5, -12, 'Salvage convoy extracted', 1, false); toast(`Extraction complete · +${result.cargo} personal Parts`); updateHud(); }
    showOperationsBoard(result.ok ? '' : result.error);
  });
  panel.querySelectorAll('[data-field-upgrade]').forEach(button => button.onclick = () => { const result = operations.chooseFieldUpgrade(identityId, button.dataset.fieldUpgrade); showOperationsBoard(result.ok ? 'Field Upgrade installed for this attempt.' : result.error); });
  if ($('opsTactical')) $('opsTactical').onclick = () => { const result = operations.useAbility(identityId, 'tactical'); showOperationsBoard(result.ok ? 'Tactical ability activated.' : result.error); };
  if ($('opsUltimate')) $('opsUltimate').onclick = () => { const result = operations.useAbility(identityId, 'ultimate'); showOperationsBoard(result.ok ? 'Ultimate ability activated.' : result.error); };
  if ($('opsWithdraw')) $('opsWithdraw').onclick = () => { const result = operations.withdraw(identityId); showOperationsBoard(result.ok ? 'Squad withdrawn. Salvage and cargo remain spent.' : result.error); };
  if ($('opsNew')) $('opsNew').onclick = () => { const result = operations.prepareNext(identityId); showOperationsBoard(result.ok ? '' : result.error); };
  $('opsPostPing').onclick = () => { const result = operations.postPing(identityId, $('opsPingType').value, $('opsPingTarget').value); showOperationsBoard(result.ok ? 'Signal placed for your community.' : result.error); };
  panel.querySelectorAll('[data-ack-ping]').forEach(button => button.onclick = () => { const result = operations.acknowledgePing(identityId, button.dataset.ackPing); showOperationsBoard(result.ok ? 'Signal acknowledged.' : result.error); });
}
$('operationsBtn').onclick = () => showOperationsBoard();
setInterval(() => {
  const countdown = $('opsCountdown');
  if (!countdown || panel.style.display === 'none') return;
  const current = operations.current();
  if (!current || current.status !== 'active') { showOperationsBoard(); return; }
  countdown.textContent = formatRemaining(current.deadlineAt);
}, 1000);

function showCardVault() {
  const base = service.community()?.saved.base;
  const access = service.getAccess();
  const cards = FIRST_EDITION_CARDS.map(card => {
    const earned = cardEarned(card.id, base);
    return `<article class="collectible-card ${earned ? 'earned' : ''}"><div class="collectible-card-art"><img src="${escapeHTML(card.image)}" alt="${escapeHTML(card.name)} First Edition card art" loading="lazy"></div><strong>${escapeHTML(card.name)}</strong><span>${escapeHTML(card.rarity)} · ${earned ? 'Earned in this preview' : 'Discoverable'}</span><p>${earned ? 'Milestone reached. This local collection mark follows the current base.' : escapeHTML(card.condition)}</p></article>`;
  }).join('');
  const showcase = access.allowed ? operations.showcase() : null;
  const operative = OPERATIVES[operations.selected()];
  const serviceBadges = showcase ? [
    ['First Through', showcase.earned.firstThrough], ['Eyes on Target', showcase.earned.eyesOnTarget], ['Siege Medic', showcase.earned.siegeMedic],
  ].map(([name, earned]) => `<span class="world-kit">${earned ? '✦' : '◇'} ${name} · ${earned ? 'earned' : 'locked'}</span>`).join('') : '';
  const evidence = showcase?.evidence?.length ? showcase.evidence.slice().reverse().map(record => `<p class="war-event">${escapeHTML(record.id)} · ${escapeHTML(OPERATIVES[record.operativeId].name)} · ${record.reward} Parts extracted · ${record.recovered} recovered · ${record.scanned ? 'scouted' : 'unscouted'} · ${record.breached ? 'breached' : 'no breach'}</p>`).join('') : '<p class="help">Complete a local salvage extraction to begin your service record.</p>';
  const profilePanel = showcase ? `<hr><h3>Personal Showcase · ${escapeHTML(service.profile().name)}</h3><div class="row"><img src="${escapeHTML(squadPortrait(operative.role, squadTier(operative.role, state.levels)))}" alt="Selected DZN operative kit" style="width:90px;height:105px;object-fit:contain;background:#202924;border-radius:9px"><div><strong>${escapeHTML(operative.name)} · ${escapeHTML(operative.title)}</strong><p>${showcase.completed} local PvE extractions · mastery ${showcase.mastery[operations.selected()] || 0}</p><div class="world-kits">${serviceBadges}</div></div></div><h3>Achievement evidence</h3>${evidence}` : `<p class="notice warn">${escapeHTML(access.reason)}</p>`;
  openPanel(`<h2>DZN First Edition Cards</h2><p>Guardian, Ghost and Fixer bring DZN's squads and base upgrades into a collectible art series. Milestones reveal cards in this local preview.</p><div class="collectible-grid">${cards}</div>${profilePanel}<p class="help">Cards and mastery are cosmetic local previews. No globally limited edition, trading rights, or competitive buffs have been issued.</p><div class="row"><button id="closeBtn">Close</button></div>`);
  $('closeBtn').onclick = closePanel;
}
$('cardsBtn').onclick = showCardVault;

let selectedWorldCommunityId = 'iron-pines';
let worldSearch = '';
const worldMapView = { scale: 1, x: 0, y: 0 };
function applyWorldMapView(overlay) {
  const viewport = overlay.querySelector('.world-map-viewport');
  const content = overlay.querySelector('.world-map-content');
  if (!viewport || !content) return;
  const maxX = (worldMapView.scale - 1) * viewport.clientWidth / 2;
  const maxY = (worldMapView.scale - 1) * viewport.clientHeight / 2;
  worldMapView.x = THREE.MathUtils.clamp(worldMapView.x, -maxX, maxX);
  worldMapView.y = THREE.MathUtils.clamp(worldMapView.y, -maxY, maxY);
  content.style.transform = `translate3d(${worldMapView.x}px, ${worldMapView.y}px, 0) scale(${worldMapView.scale})`;
  content.style.setProperty('--pin-inverse', String(1 / worldMapView.scale));
  const label = overlay.querySelector('#worldZoomStatus');
  if (label) label.textContent = `${Math.round(worldMapView.scale * 100)}%`;
}
function setWorldMapZoom(overlay, scale) {
  worldMapView.scale = THREE.MathUtils.clamp(Math.round(scale * 10) / 10, 1, 4);
  if (worldMapView.scale === 1) { worldMapView.x = 0; worldMapView.y = 0; }
  applyWorldMapView(overlay);
}
function showWorldMap() {
  closePanel();
  const overlay = $('worldMapOverlay');
  const profile = service.profile();
  const communities = service.getWorldMap();
  const selected = communities.find(community => community.id === selectedWorldCommunityId) || communities[0];
  selectedWorldCommunityId = selected.id;
  const ownBase = selected.id === profile.communityId;
  const access = service.getAccess(profile.id);
  const war = service.getWars(profile.id).find(item => ['preparation', 'active'].includes(item.state) && [item.challengerCommunityId, item.defenderCommunityId].includes(selected.id));
  const reports = war ? service.getScoutReports(profile.id, war.id) : [];
  const canScout = Boolean(war && access.allowed && selected.id !== profile.communityId && service.getWarReadiness(profile.communityId, profile.id).eligible && war.roster[profile.communityId]?.some(member => member.identityId === profile.id) && !reports.some(report => report.identityId === profile.id) && reports.length < WAR_RULES.maxScoutsPerSide);
  const away = war ? service.getAwaySquads(selected.id, war.id) : [];
  const pins = communities.map(community => `<button class="world-pin ${community.id === selected.id ? 'selected' : ''} ${community.accessTier === 'view only' ? 'view-only' : ''}" style="left:${community.map[0]}%;top:${community.map[1]}%" data-world-community="${escapeHTML(community.id)}" data-world-name="${escapeHTML(community.name.toLocaleLowerCase())}" aria-label="Inspect ${escapeHTML(community.name)}">${community.construction.length ? '⚒' : '◆'}</button>`).join('');
  const proResults = connectedProMatches(communities).map(community => `<button class="world-result" data-world-community="${escapeHTML(community.id)}" data-world-name="${escapeHTML(community.name.toLocaleLowerCase())}"><span>◆ ${escapeHTML(community.name)}</span><small>PRO · Hall L${community.hallLevel}</small></button>`).join('');
  const origin = communities.find(community => community.id === profile.communityId);
  const route = origin && selected.id !== origin.id && selected.accessTier !== 'view only' ? routeBriefing(origin, selected) : null;
  const routePanel = route ? `<div class="world-route"><strong>Route briefing · ${escapeHTML(origin.name)} → ${escapeHTML(selected.name)}</strong><div class="world-route-stats"><span><b>${route.distanceKm.toLocaleString()} km</b> great-circle</span><span><b>~${route.travelHours} h</b> travel + mobilisation</span><span><b>${escapeHTML(route.riskLabel)}</b> risk ${route.risk}/5</span><span><b>×${route.rewardMultiplier.toFixed(2)}</b> victory Parts</span></div><p>Planning estimate from fictional regional markers, using 850 km/h plus 1.5 hours mobilisation. Risk reflects distance, Hall level and assigned defenders. A local war victory earns the capped risk multiplier from the accepted, frozen bases; scores and rankings stay unchanged. Travel time is strategic context while preview battles retain accelerated mission timers.</p></div>` : '';
  const buildings = Object.entries(selected.buildings).map(([key, level]) => {
    const asset = getBuildingAsset(key, level);
    const construction = selected.construction.find(project => project.key === key);
    return `<div class="world-building ${construction ? 'constructing' : ''}"><img src="${escapeHTML(asset.png)}" alt="${escapeHTML(GAME_CONFIG.buildings[key].name)} Level ${level}${construction ? ', under construction' : ''}"><strong>${escapeHTML(GAME_CONFIG.buildings[key].name)} · L${level}${construction ? ' · ⚒' : ''}</strong></div>`;
  }).join('');
  const construction = selected.construction.length ? selected.construction.map(project => `<div class="world-construction"><strong>⚒ ${project.status === 'constructing' ? 'BUILDING' : 'FUNDING'} · ${escapeHTML(project.name)} → L${project.targetLevel}</strong><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, Math.max(0, project.percent))}%"></div></div><p ${project.status === 'constructing' ? `data-public-build-start="${project.startedAt}" data-public-build-finish="${project.finishAt}"` : ''}>${project.status === 'constructing' ? project.startedAt > Date.now() ? `Queued · starts in ${formatRemaining(project.startedAt)}` : `Under construction · ${formatRemaining(project.finishAt)} remaining` : `${project.percent}% funded`}</p></div>`).join('') : '<p class="help">No approved work is under construction.</p>';
  const districts = selected.districts.map(district => `${escapeHTML(GAME_CONFIG.landPlots.find(plot => plot.id === district.id)?.name || district.id)}: ${escapeHTML(district.status)}${district.status !== 'claimed' ? ` · ${district.treesRemaining} trees` : district.facilityLevel ? ` · facility L${district.facilityLevel}${district.wear ? ` · battle wear ${district.wear}/${BATTLE_WEAR_RULES.maxSeverity}` : ''}` : ''}`).join('<br>');
  const visibleKits = Object.entries(SQUAD_ROLES).map(([role, definition]) => `<span class="world-kit"><b>${escapeHTML(definition.name)}</b> · ${squadUnlocked(role, selected.buildings) ? `gear L${squadTier(role, selected.buildings)}` : `locked · Hall L${definition.unlockHall} / ${escapeHTML(GAME_CONFIG.buildings[definition.source].name)} L${definition.unlockSource}`}</span>`).join('');
  const visibleDefenders = Object.entries(DEFENDER_CONCEPTS).map(([role, definition]) => {
    const unit = selected.defenders?.[role];
    return `<span class="world-kit"><b>${escapeHTML(definition.name)}</b> · ${unit?.level ? `L${unit.level} · ${unit.post ? escapeHTML(DEFENDER_POSTS[unit.post]) : 'reserve'}` : 'locked'}</span>`;
  }).join('');
  const mission = war ? `<div class="world-mission"><strong>${escapeHTML(war.state.toUpperCase())} · ${escapeHTML(war.id)}</strong><p>${away.length} ${away.length === 1 ? 'squad' : 'squads'} away from ${escapeHTML(selected.name)} right now. Each exposed squad can give an attacker up to +6 points, reduced by barricades, assigned Hounds and a prepared home reserve. Recalled squads stop exposing home defence.</p>${canScout ? `<button id="worldScoutBtn">Send scout · arrives in ${WAR_RULES.scoutArrivalMs / 1000}s</button>` : ''}${reports.map(report => `<p>Scout ${escapeHTML(report.id)}: ${report.recalledAt ? 'recalled' : report.active ? report.arrived ? `intel received · returns in ${formatRemaining(report.returnAt)}` : `travelling · arrives in ${formatRemaining(report.arrivalAt)}` : 'returned'}${report.intel ? ` · Hall L${report.intel.hallLevel}, Arc Battery L${report.intel.towerLevel}, ${report.intel.fortification} barricades` : ''} ${report.active && report.identityId === profile.id ? `<button data-recall-scout="${escapeHTML(report.id)}">Recall to defend</button>` : ''}</p>`).join('')}</div>` : '';
  overlay.innerHTML = `<div class="row" style="justify-content:space-between;margin:0 0 8px"><h2>DZN · World Strongholds</h2><button id="closeWorldBtn">Return to base</button></div><p>Explore three fictional communities. The Pro search is populated from this preview roster; a reviewed DZN Network connection can later supply eligible servers using coarse public regions. No player or server coordinates are shown.</p><div class="world-layout"><div class="world-map"><div class="world-map-toolbar"><label class="world-search-label" for="worldSearch">Find connected Pro stronghold<input id="worldSearch" type="search" autocomplete="off" placeholder="Search Pro servers" value="${escapeHTML(worldSearch)}"></label><div class="world-zoom-controls"><button id="worldZoomOut" aria-label="Zoom out">−</button><span id="worldZoomStatus" aria-live="polite">100%</span><button id="worldZoomIn" aria-label="Zoom in">+</button><button id="worldZoomReset">Reset</button></div></div><div class="world-map-viewport" tabindex="0" aria-label="World map. Drag to move; use plus, minus, Home and arrow keys to navigate"><div class="world-map-content"><img src="assets/world/stronghold-world.png" draggable="false" alt="Stylized world map showing continents and illustrative community markers">${pins}</div></div><div class="world-results" aria-label="Connected Pro preview servers">${proResults}</div><p id="worldSearchStatus" class="help" role="status"></p></div><div class="world-details"><h3>${escapeHTML(selected.name)}</h3><p>${ownBase ? 'Your connected community' : 'Visitor preview · read only'} · ${escapeHTML(selected.accessTier)} · Command Hall L${selected.hallLevel}</p><p class="help">DZN perimeter: ${selected.wallSegments} wall segments · ${selected.wallTierTotal} combined wall tiers.</p>${routePanel}<div class="world-buildings">${buildings}</div><h3>Active construction</h3>${construction}<h3>Land and districts</h3><p>${districts}</p><h3>Visible squad kit</h3><div class="world-kits">${visibleKits}</div><h3>Base defenders</h3><div class="world-kits">${visibleDefenders}</div>${mission}<p class="help">Only verified players connected to their own eligible community may fund, build or scout. Main infrastructure still requires owner/admin approval. This local preview does not connect to live DZN accounts or launch real attacks.</p><div class="row"><button id="worldWarBtn">Open War Table</button></div></div></div>`;
  overlay.style.display = 'block';
  applyWorldMapView(overlay);
  const updateWorldSearch = () => {
    worldSearch = $('worldSearch').value;
    const matches = connectedProMatches(communities, worldSearch);
    const needle = worldSearch.trim().toLocaleLowerCase();
    overlay.querySelectorAll('[data-world-name]').forEach(item => { item.hidden = !!needle && !item.dataset.worldName.includes(needle); });
    $('worldSearchStatus').textContent = `${matches.length} connected Pro ${matches.length === 1 ? 'server' : 'servers'} in this preview${needle ? ' match your search' : ''}.`;
  };
  $('worldSearch').oninput = updateWorldSearch;
  updateWorldSearch();
  const viewport = overlay.querySelector('.world-map-viewport');
  let drag = null;
  viewport.onpointerdown = event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
  };
  viewport.onpointermove = event => {
    if (!drag || drag.id !== event.pointerId) return;
    worldMapView.x += event.clientX - drag.x;
    worldMapView.y += event.clientY - drag.y;
    drag.x = event.clientX; drag.y = event.clientY;
    applyWorldMapView(overlay);
  };
  viewport.onpointerup = viewport.onpointercancel = () => { drag = null; };
  viewport.onwheel = event => { event.preventDefault(); setWorldMapZoom(overlay, worldMapView.scale + (event.deltaY < 0 ? .2 : -.2)); };
  viewport.ondblclick = () => setWorldMapZoom(overlay, worldMapView.scale + .5);
  viewport.onkeydown = event => {
    if (event.key === '+' || event.key === '=') setWorldMapZoom(overlay, worldMapView.scale + .2);
    else if (event.key === '-') setWorldMapZoom(overlay, worldMapView.scale - .2);
    else if (event.key === 'Home') { worldMapView.scale = 1; worldMapView.x = 0; worldMapView.y = 0; applyWorldMapView(overlay); }
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      worldMapView.x += event.key === 'ArrowLeft' ? 25 : event.key === 'ArrowRight' ? -25 : 0;
      worldMapView.y += event.key === 'ArrowUp' ? 25 : event.key === 'ArrowDown' ? -25 : 0;
      applyWorldMapView(overlay);
    } else return;
    event.preventDefault();
  };
  $('worldZoomIn').onclick = () => setWorldMapZoom(overlay, worldMapView.scale + .25);
  $('worldZoomOut').onclick = () => setWorldMapZoom(overlay, worldMapView.scale - .25);
  $('worldZoomReset').onclick = () => { worldMapView.scale = 1; worldMapView.x = 0; worldMapView.y = 0; applyWorldMapView(overlay); };
  $('closeWorldBtn').onclick = () => { overlay.style.display = 'none'; $('worldBtn').focus(); };
  $('worldWarBtn').onclick = () => { overlay.style.display = 'none'; showWarTable(); };
  overlay.querySelectorAll('[data-world-community]').forEach(button => button.onclick = () => { selectedWorldCommunityId = button.dataset.worldCommunity; showWorldMap(); });
  if ($('worldScoutBtn')) $('worldScoutBtn').onclick = () => {
    const result = service.dispatchScout(profile.id, war.id);
    toast(result.ok ? 'Scout dispatched · home defence exposed until return or recall.' : result.error);
    showWorldMap();
  };
  overlay.querySelectorAll('[data-recall-scout]').forEach(button => button.onclick = () => {
    const result = service.recallScout(profile.id, button.dataset.recallScout);
    toast(result.ok ? 'Scout recalled · home defence reinforced.' : result.error);
    showWorldMap();
  });
}
$('worldBtn').onclick = showWorldMap;
document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('worldMapOverlay').style.display === 'block') { $('worldMapOverlay').style.display = 'none'; $('worldBtn').focus(); } });

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
      const readyToResolve = closed || (!war.stages?.length && capped);
      if (resolve) resolve.disabled = !(leadership && readiness.eligible && readyToResolve);
      if (resolve && leadership && readiness.eligible && readyToResolve) resolve.textContent = 'Resolve war · lock result';
    }
  }
}

function clearWarBaseVisuals() {
  warDefenderToken++;
  warTurretRig = null;
  for (const bolt of warBattle?.bolts || []) disposeWarBolt(bolt);
  for (const defender of warDefenderMeshes) {
    scene.remove(defender.mesh);
    if (defender.snareField) {
      defender.snareField.geometry.dispose();
      defender.snareField.material.dispose();
    }
  }
  warDefenderMeshes.length = 0;
  warWallMeshes.length = 0;
  for (const child of [...warBaseGroup.children]) {
    if (child.userData.sharedTemplate) clearArcSplitGeometry(child);
    else child.traverse(object => {
      if (object.isMesh) object.geometry?.dispose();
      if (object.userData.arcFlash || object.userData.warMarker) object.material.dispose();
    });
    warBaseGroup.remove(child);
  }
}

function disposeWarBolt(bolt) {
  scene.remove(bolt.beam, bolt.impact);
  bolt.beam.geometry.dispose();
  bolt.beam.material.dispose();
  bolt.impact.geometry.dispose();
  bolt.impact.material.dispose();
}

function spawnArcBolt(origin, aim, bolts) {
  const direction = aim.clone().sub(origin);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.065, direction.length(), 8),
    new THREE.MeshBasicMaterial({ color: 0xc5ff75, transparent: true, opacity: 0.95, depthWrite: false }));
  beam.position.copy(origin).addScaledVector(direction, 0.5);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  const impact = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xc5ff75, transparent: true, opacity: 0.8, depthWrite: false }));
  impact.position.copy(aim);
  scene.add(beam, impact);
  bolts.push({ beam, impact, life: 0 });
}

function updateArcBolts(bolts, dt) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    const bolt = bolts[i];
    bolt.life += dt;
    bolt.beam.material.opacity = Math.max(0, 0.95 * (1 - bolt.life / 0.38));
    bolt.impact.material.opacity = Math.max(0, 0.8 * (1 - bolt.life / 0.38));
    bolt.impact.scale.setScalar(1 + bolt.life * 2.5);
    if (bolt.life >= 0.38) {
      disposeWarBolt(bolt);
      bolts.splice(i, 1);
    }
  }
}

const WAR_ROLE_COLOURS = Object.freeze({ assault: 0xd4f477, recon: 0xb38bff, engineer: 0xffbc6c, sentinel: 0x8ed0ff, medic: 0x70f0b0 });
const WAR_ROLE_LABELS = Object.freeze({ assault: 'Warden', recon: 'Ghost', engineer: 'Fixer', sentinel: 'Sentinel', medic: 'Lifeline' });
function spawnWarPulse(battle, position, colour, radius = 1.15) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const mesh = new THREE.Mesh(new THREE.RingGeometry(radius * 0.72, radius, 28),
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.copy(position);
  mesh.position.y = Math.max(0.12, position.y);
  scene.add(mesh);
  battle.effects.push({ mesh, life: 0, duration: 0.7, kind: 'pulse' });
}
function spawnWarTrace(battle, from, to, colour, width = 0.028) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const difference = to.clone().sub(from);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(width, width, difference.length(), 6),
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9, depthWrite: false }));
  mesh.position.copy(from).addScaledVector(difference, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), difference.normalize());
  scene.add(mesh);
  battle.effects.push({ mesh, life: 0, duration: 0.18, kind: 'trace' });
}
function updateWarEffects(battle, dt) {
  for (let i = battle.effects.length - 1; i >= 0; i--) {
    const effect = battle.effects[i];
    effect.life += dt;
    const fraction = Math.min(1, effect.life / effect.duration);
    effect.mesh.material.opacity = (effect.kind === 'pulse' ? 0.8 : 0.9) * (1 - fraction);
    if (effect.kind === 'pulse') effect.mesh.scale.setScalar(1 + fraction * 1.5);
    if (fraction < 1) continue;
    scene.remove(effect.mesh);
    effect.mesh.geometry.dispose();
    effect.mesh.material.dispose();
    battle.effects.splice(i, 1);
  }
}
function clearWarEffects(battle) {
  if (!battle) return;
  for (const effect of battle.effects) {
    scene.remove(effect.mesh);
    effect.mesh.geometry.dispose();
    effect.mesh.material.dispose();
  }
  battle.effects.length = 0;
}

function makeWarHealthBar(width = 0.78) {
  const group = new THREE.Group();
  const background = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.105),
    new THREE.MeshBasicMaterial({ color: 0x14251e, transparent: true, opacity: 0.9, depthTest: false }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.04, 0.065),
    new THREE.MeshBasicMaterial({ color: 0x8cf0a2, depthTest: false }));
  fill.position.z = 0.005;
  group.add(background, fill);
  group.renderOrder = 30;
  group.userData.fill = fill;
  group.userData.width = width - 0.04;
  scene.add(group);
  return group;
}

function setWarHealthBar(bar, fraction) {
  const health = THREE.MathUtils.clamp(fraction, 0, 1);
  bar.userData.fill.scale.x = Math.max(0.001, health);
  bar.userData.fill.position.x = -(1 - health) * bar.userData.width / 2;
  bar.userData.fill.material.color.setHex(health > 0.55 ? 0x8cf0a2 : health > 0.25 ? 0xffce73 : 0xff7474);
  bar.quaternion.copy(camera.quaternion);
  bar.visible = health > 0;
}

function disposeWarHealthBar(bar) {
  scene.remove(bar);
  for (const child of bar.children) {
    child.geometry.dispose();
    child.material.dispose();
  }
}

function warHealthAt(track, progress) {
  return Math.max(0, track.maxHealth - track.hits.filter(hit => hit.at <= progress).reduce((sum, hit) => sum + hit.damage, 0));
}

function updateWarDamage(battle, progress) {
  const report = battle.damage;
  if (!report?.ok) return;
  for (const [index, troop] of battle.troops.entries()) {
    const track = report.squad[index];
    if (!track) continue;
    for (const hit of track.hits) if (hit.at <= progress && hit.at > troop.lastDamageAt) {
      spawnWarPulse(battle, troop.mesh.position, 0xff9d72, 0.48);
      troop.lastDamageAt = hit.at;
    }
    const health = warHealthAt(track, progress);
    troop.healthBar.position.copy(troop.mesh.position).add(new THREE.Vector3(0, 2.25, 0));
    setWarHealthBar(troop.healthBar, health / track.maxHealth);
  }
  const objective = report.objective;
  for (const hit of objective.hits) if (hit.at <= progress && hit.at > battle.lastObjectiveHitAt) {
    const point = battle.objectiveMarker.position;
    spawnWarPulse(battle, new THREE.Vector3(OUTPOST.x + point.x, 0.18, OUTPOST.z + point.z), 0xffb45e, 1.65);
    battle.lastObjectiveHitAt = hit.at;
  }
  battle.objectiveHealthBar.position.set(OUTPOST.x + battle.objectiveMarker.position.x, 6, OUTPOST.z + battle.objectiveMarker.position.z);
  const targetHealth = warHealthAt(objective, progress);
  setWarHealthBar(battle.objectiveHealthBar, targetHealth / objective.maxHealth);
  if (targetHealth === 0 && !battle.objectiveDownShown) {
    battle.objectiveDownShown = true;
    battle.objectiveMarker.material.color.setHex(0xff7474);
    const point = battle.objectiveMarker.position;
    for (let i = 0; i < 5; i++) spawnSmoke(new THREE.Vector3(OUTPOST.x + point.x + Math.sin(i * 1.25) * 1.2, 1.2, OUTPOST.z + point.z + Math.cos(i * 1.25) * 1.2));
    toast(`${objective.name} neutralized in this local war attack.`);
  }
  for (const wall of report.walls) {
    for (const hit of wall.hits) if (hit.at <= progress && hit.at > (battle.lastWallHitAt[wall.id] || 0)) {
      spawnWarPulse(battle, new THREE.Vector3(OUTPOST.x + wall.x, 0.13, OUTPOST.z + wall.z), 0xffbc6c, 0.8);
      battle.lastWallHitAt[wall.id] = hit.at;
    }
    if (warHealthAt(wall, progress) === 0) for (const mesh of warWallMeshes) if (mesh.userData.wallId === wall.id) mesh.visible = false;
  }
  const activeTroops = report.squad.filter(track => warHealthAt(track, progress) > 0).length;
  const brokenWalls = report.walls.filter(wall => warHealthAt(wall, progress) === 0).length;
  battle.damageStatus.textContent = `SQUAD ${activeTroops}/${report.squad.length} · ${objective.name.toUpperCase()} ${Math.round(warHealthAt(objective, progress) / objective.maxHealth * 100)}% · WALLS ${brokenWalls}/${report.walls.length}`;
}

function buildWarBaseVisual(side) {
  clearWarBaseVisuals();
  const token = warDefenderToken;
  const animationCounts = { radars: animated.radars.length, lights: animated.lights.length, chimneys: animated.chimneys.length };
  warBaseGroup.position.set(OUTPOST.x, 0, OUTPOST.z);
  for (const [key, building] of Object.entries(DEFS)) {
    const model = buildModel(key, side.base.levels[key]);
    const point = side.base.layout?.structures?.[key];
    model.position.set(point?.x ?? building.pos[0], 0.05, point?.z ?? building.pos[1]);
    warBaseGroup.add(model);
    if (key === 'tower') warTurretRig = model.userData.turretRig;
    const asset = getBuildingAsset(key, side.base.levels[key]);
    if (asset) loadBuildingTemplate(asset.glb).then(template => {
      if (token !== warDefenderToken) return;
      const detailed = normalizeBuildingClone(template, key, side.base.levels[key]);
      detailed.position.copy(model.position);
      detailed.userData.sharedTemplate = true;
      warBaseGroup.add(detailed);
      warBaseGroup.remove(model);
      model.traverse(object => {
        if (object.isMesh) object.geometry?.dispose();
        if (object.userData.arcFlash) object.material.dispose();
      });
      if (key === 'tower') warTurretRig = detailed.userData.turretRig;
    }).catch(error => console.warn(`War base ${key} model could not load; retaining fallback.`, error));
  }
  for (const wall of side.base.layout?.walls || []) wallModel(wall.level).then(template => {
    if (token !== warDefenderToken || !template) return;
    const segment = template.clone(true);
    segment.position.set(wall.x, .09, wall.z);
    segment.userData.sharedTemplate = true;
    segment.userData.wallId = wall.id;
    const damageTrack = warBattle?.damage?.walls?.find(track => track.id === wall.id);
    if (damageTrack && warHealthAt(damageTrack, warBattle.time / warBattle.duration) === 0) segment.visible = false;
    warBaseGroup.add(segment);
    warWallMeshes.push(segment);
  });
  box(warBaseGroup, 35, 0.45, 0.65, MAT.dark, 0, 0, -17);
  box(warBaseGroup, 35, 0.45, 0.65, MAT.dark, 0, 0, 17);
  box(warBaseGroup, 0.65, 0.45, 34, MAT.dark, -17, 0, 0);
  box(warBaseGroup, 0.65, 0.45, 34, MAT.dark, 17, 0, 0);
  animated.radars.length = animationCounts.radars;
  animated.lights.length = animationCounts.lights;
  animated.chimneys.length = animationCounts.chimneys;
  warBaseGroup.visible = true;
  for (const [role, defender] of Object.entries(side.base.defenders || {})) {
    const node = DEFENDER_POST_NODES[defender.post];
    if (!defender.level || !node) continue;
    const [x, z] = PATROL_NODES[node];
    const mesh = new THREE.Group();
    mesh.position.set(OUTPOST.x + x, 0, OUTPOST.z + z);
    mesh.rotation.y = -Math.PI / 2;
    scene.add(mesh);
    const patrol = { role, level: defender.level, mesh, home: mesh.position.clone() };
    if (role === 'trapper') {
      const field = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.05, 32),
        new THREE.MeshBasicMaterial({ color: 0xafff52, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      field.rotation.x = -Math.PI / 2;
      field.position.y = 0.055;
      mesh.add(field);
      patrol.snareField = field;
    }
    warDefenderMeshes.push(patrol);
    loadBuildingTemplate(defenderAsset(role, defender.level)).then(template => {
      if (token !== warDefenderToken) return;
      const model = template.clone(true);
      mesh.add(model);
      patrol.model = model;
      patrol.limbs = bindDefenderRig(model, role);
    }).catch(error => console.warn(`War defender model could not load: ${role}`, error));
  }
}

function warPlanMapHTML(defender, tactics) {
  const map = ({ x, z }) => `${160 + x * 5},${130 + z * 5}`;
  const breached = new Set(tactics.breachedWallIds);
  const route = tactics.route.map(point => map(point)).join(' ');
  const walls = (defender.base.layout.walls || []).map(wall => `<rect x="${160 + wall.x * 5 - 5}" y="${130 + wall.z * 5 - 5}" width="10" height="10" rx="2" fill="${breached.has(wall.id) ? '#ffab70' : '#87928b'}"><title>${escapeHTML(wall.id)} · tier ${wall.level}</title></rect>`).join('');
  const structures = Object.entries(defender.base.layout.structures).filter(([key]) => WAR_OBJECTIVES[key]).map(([key, position]) => `<g><circle cx="${160 + position.x * 5}" cy="${130 + position.z * 5}" r="${key === tactics.plan.objective ? 13 : 10}" fill="${key === tactics.plan.objective ? '#c084fc' : '#284b3a'}" stroke="#bde8c7" stroke-width="2"/><text x="${160 + position.x * 5}" y="${134 + position.z * 5}" text-anchor="middle" fill="#fff" font-size="11" font-weight="bold">${key === 'hq' ? 'H' : key === 'tower' ? 'T' : 'C'}</text></g>`).join('');
  return `<svg class="war-plan-map" viewBox="0 0 320 260" role="img" aria-label="Locked defending base with selected attack route, buildings and wall segments"><rect x="0" y="0" width="320" height="260" fill="#102019"/><path d="M75 45 L245 45 L245 215 L75 215 Z" fill="#263d31" stroke="#8a9c82" stroke-width="2"/><path d="M88 58 L232 58 L232 202 L88 202 Z" fill="none" stroke="#4b7258" stroke-dasharray="4 5"/>${walls}${structures}<polyline points="${route}" fill="none" stroke="#c084fc" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${160 + tactics.route[0].x * 5}" cy="${130 + tactics.route[0].z * 5}" r="7" fill="#8cff9b" stroke="#102019" stroke-width="2"/></svg>`;
}

function showWarPlanner(warId, tactic) {
  const profile = service.profile();
  const war = service.getWar(warId);
  if (!war || war.state !== 'active' || !['assault', 'recon'].includes(tactic)) { showWarTable('This war attack is no longer available.'); return; }
  const defender = profile.communityId === war.challengerCommunityId ? war.snapshots.defender : war.snapshots.challenger;
  const attacker = profile.communityId === war.challengerCommunityId ? war.snapshots.challenger : war.snapshots.defender;
  const capacity = attacker.stats.squadSize;
  const leadRole = tactic === 'recon' ? 'recon' : 'assault';
  const conditionAtLaunch = service.getWarCondition(warId, defender.communityId);
  const reserve = service.getTrainingReadiness(profile.id).reserve;
  const defaultCounts = Object.fromEntries(Object.keys(SQUAD_ROLES).map(role => [role, 0]));
  let unassigned = capacity;
  for (const role of [leadRole, ...Object.keys(SQUAD_ROLES).filter(role => role !== leadRole)]) {
    if (!squadProfile(role, attacker.base.levels).unlocked) continue;
    defaultCounts[role] = Math.min(unassigned, reserve[role] || 0);
    unassigned -= defaultCounts[role];
  }
  const squadRows = Object.entries(SQUAD_ROLES).map(([role, definition]) => {
    const kit = squadProfile(role, attacker.base.levels);
    return `<label>${escapeHTML(definition.name)} <small>${kit.unlocked ? `Ready ${reserve[role] || 0} · L${kit.tier} · ${kit.ability}` : 'Locked at war acceptance'}</small><input type="number" data-war-squad="${role}" min="0" max="${capacity}" step="1" value="${defaultCounts[role]}" ${kit.unlocked ? '' : 'disabled'}></label>`;
  }).join('');
  const options = (values, selected) => Object.entries(values).map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHTML(typeof label === 'string' ? label : label.name)}</option>`).join('');
  const weakened = Object.entries(conditionAtLaunch.objectives).map(([key, health]) => `${WAR_OBJECTIVES[key]} ${Math.round(health / (180 + defender.base.levels[key] * 70) * 100)}%`).join(' · ');
  const brokenWalls = Object.values(conditionAtLaunch.walls).filter(health => health === 0).length;
  openPanel(`<h2>${tactic === 'assault' ? 'Assault' : 'Recon'} tactical order</h2><p>Choose how your squad enters ${escapeHTML(defender.name)}. The accepted base positions are locked; earlier battle damage carries into this strike. Confirming sends trained troops away and spends your one deployment.</p>${weakened || brokenWalls ? `<p class="notice">Current fortifications: ${escapeHTML(weakened || 'Buildings intact')}${brokenWalls ? ` · ${brokenWalls} wall ${brokenWalls === 1 ? 'breach' : 'breaches'} already open` : ''}</p>` : ''}<div class="war-plan-controls"><label>Entry route<select id="warPlanLane">${options(WAR_LANES, 'west')}</select></label><label>Objective<select id="warPlanObjective">${options(WAR_OBJECTIVES, tactic === 'assault' ? 'tower' : 'comms')}</select></label><label>Approach<select id="warPlanMethod">${options(WAR_METHODS, 'flank')}</select></label></div><details class="war-squad-picker" open><summary>Deploy your squad · ${capacity} frozen Hall slots</summary><div class="war-squad-grid">${squadRows}</div><p id="warSquadStatus" class="help" role="status"></p></details><div id="warPlanPreview"></div><div class="row"><button id="warPlanConfirm">Confirm deployment</button><button id="warPlanTrain">Camp & training</button><button id="warPlanCancel">Return to War Table</button></div><p class="help">Fixers help cut defended walls, Ghosts reward covered flanks, Sentinels cover the battery and Lifeline medics reduce losses. Surviving troops return; losses must be retrained. Kit tiers are locked at acceptance. This war remains a local preview.</p>`);
  const squadInputs = [...panel.querySelectorAll('[data-war-squad]')];
  const select = () => ({ lane: $('warPlanLane').value, objective: $('warPlanObjective').value, method: $('warPlanMethod').value,
    squad: Object.fromEntries(squadInputs.map(input => [input.dataset.warSquad, Number(input.value)])) });
  const refresh = () => {
    const choice = select();
    const tactics = evaluateWarPlan(defender, tactic, choice, conditionAtLaunch);
    const squad = evaluateWarSquad(attacker.base.levels, tactic, choice.squad, capacity, tactics);
    const assigned = Object.values(choice.squad).reduce((sum, count) => sum + count, 0);
    const missing = squad.ok ? Object.keys(SQUAD_ROLES).filter(role => squad.counts[role] > (reserve[role] || 0)) : [];
    $('warSquadStatus').textContent = missing.length ? `${assigned}/${capacity} assigned · Train ${missing.map(role => SQUAD_ROLES[role].name).join(', ')} at camp before deployment.`
      : squad.ok ? `${assigned}/${capacity} trained and ready · ${trainingSquadSummary(squad.counts)} · ${squad.scoreDelta >= 0 ? '+' : ''}${squad.scoreDelta} score · ${squad.casualtyDelta >= 0 ? '+' : ''}${squad.casualtyDelta} casualty pressure${squad.specialties.length ? ` · ${squad.specialties.join(' · ')}` : ''}` : `${assigned}/${capacity} assigned · ${squad.error}`;
    $('warPlanConfirm').disabled = !tactics.ok || !squad.ok || missing.length > 0;
    $('warPlanPreview').innerHTML = tactics.ok ? `<div class="war-plan-summary"><b>${escapeHTML(tactics.laneName)} → ${escapeHTML(tactics.objectiveName)}</b><span>${tactics.wallCount} walls · tier ${tactics.wallPressure}</span><span>${tactics.scoreDelta >= 0 ? '+' : ''}${tactics.scoreDelta} route score · ${tactics.casualtyDelta >= 0 ? '+' : ''}${tactics.casualtyDelta} route risk</span></div><details class="war-route-details"><summary>Inspect route on the locked base</summary>${warPlanMapHTML(defender, tactics)}</details>` : `<p class="notice warn">${escapeHTML(tactics.error)}</p>`;
  };
  for (const id of ['warPlanLane', 'warPlanObjective', 'warPlanMethod']) $(id).onchange = refresh;
  squadInputs.forEach(input => input.oninput = refresh);
  $('warPlanConfirm').onclick = () => launchWarAttack(warId, tactic, select());
  $('warPlanTrain').onclick = () => showTrainingLoadout();
  $('warPlanCancel').onclick = showWarTable;
  refresh();
}

function launchWarAttack(warId, tactic, plan) {
  if (raid || warBattle) return;
  const profile = service.profile();
  const result = service.submitWarAttack(profile.id, warId, tactic, service.newActionId('war-attack'), plan);
  if (!result.ok) { showWarTable(result.error); return; }
  playWarAttack(warId, tactic, result);
}

function resumeWarAttack(warId, attackId) {
  if (raid || warBattle) return;
  const profile = service.profile();
  const war = service.getWar(warId);
  const attack = war?.attacks.find(item => item.attackId === attackId && item.identityId === profile.id);
  if (!attack || war.state !== 'active' || !service.getAccess(profile.id).allowed || !attack.tactics?.plan
    || (attack.orders?.length || 0) >= 2 || attack.returnedAt || Date.now() > Math.min(war.attackEndsAt, attack.at + 45_000)) {
    showWarTable('This deployment can no longer resume. Its completed orders and score remain in the timeline.');
    return;
  }
  playWarAttack(warId, attack.tactic, attack, true);
}

function playWarAttack(warId, tactic, result, resumed = false) {
  const profile = service.profile();
  const war = service.getWar(warId);
  const defendingSide = profile.communityId === war.challengerCommunityId ? war.snapshots.defender : war.snapshots.challenger;
  const attackingSide = profile.communityId === war.challengerCommunityId ? war.snapshots.challenger : war.snapshots.defender;
  const damage = result.damage?.ok ? result.damage : buildWarDamageReport(attackingSide, defendingSide, result);
  buildWarBaseVisual(defendingSide);
  const objective = defendingSide.base.layout.structures[result.tactics.plan.objective];
  const objectiveMarker = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.45, 40),
    new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide }));
  objectiveMarker.rotation.x = -Math.PI / 2;
  objectiveMarker.position.set(objective.x, 0.13, objective.z);
  objectiveMarker.userData.warMarker = true;
  warBaseGroup.add(objectiveMarker);
  let defenceBeacon = null;
  if (result.defenceOrderActive) {
    const beaconPoint = result.defenceOrder === 'perimeter' ? result.tactics.route[2]
      : defendingSide.base.layout.structures[result.defenceOrder === 'battery' ? 'tower' : result.defenceOrder === 'signals' ? 'comms' : 'hq'];
    const beaconColour = { perimeter: 0xffbc6c, battery: 0xc084fc, signals: 0x8ed0ff, reserve: 0x70f0b0 }[result.defenceOrder];
    defenceBeacon = new THREE.Mesh(new THREE.RingGeometry(2.05, 2.32, 40),
      new THREE.MeshBasicMaterial({ color: beaconColour, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    defenceBeacon.rotation.x = -Math.PI / 2;
    defenceBeacon.position.set(beaconPoint.x, 0.17, beaconPoint.z);
    defenceBeacon.userData.warMarker = true;
    warBaseGroup.add(defenceBeacon);
  }
  for (const building of Object.values(buildings)) building.group.visible = false;
  outpostBlocks.forEach(block => { block.visible = false; });
  const squadSize = attackingSide.stats.squadSize;
  const selectedRoles = damage.ok ? damage.squad.map(unit => unit.role) : null;
  const route = result.tactics?.route || [{ x: -22, z: 0 }, { x: -17, z: 0 }, { x: -3, z: 0 }];
  const first = route[0], second = route[1];
  const dx = second.x - first.x, dz = second.z - first.z;
  const length = Math.hypot(dx, dz) || 1;
  const across = { x: -dz / length, z: dx / length };
  const cutWallIds = new Set((damage.ok ? damage.walls : []).filter(wall => wall.remainingHealth === 0).map(wall => wall.id));
  const walkLayout = { ...defendingSide.base.layout, walls: defendingSide.base.layout.walls.filter(wall => !cutWallIds.has(wall.id)) };
  const standKey = result.tactics.plan.objective === 'hq' ? 'hall' : result.tactics.plan.objective;
  const stand = patrolNodesForLayout(walkLayout)[standKey];
  const clearStand = ([x, z]) => x >= -17 && x <= 17 && z >= -15 && z <= 15
    && Object.entries(walkLayout.structures).every(([key, point]) => {
      const clearance = (BUILDING_ASSETS[key]?.footprint ?? 6) / 2 + 0.3;
      return Math.abs(x - point.x) > clearance || Math.abs(z - point.z) > clearance;
    }) && walkLayout.walls.every(wall => Math.abs(x - wall.x) > 1 || Math.abs(z - wall.z) > 1);
  const standSlots = [[0, 0], [-2, 0], [2, 0], [0, 2], [0, -2], [-4, 0], [4, 0], [-2, 2], [2, 2], [0, 4], [-4, 2], [4, 2]]
    .map(([x, z]) => [stand[0] + x, stand[1] + z]).filter(clearStand);
  const middle = route[2];
  const middleIsClear = Object.entries(walkLayout.structures).every(([key, point]) => {
    const clearance = (BUILDING_ASSETS[key]?.footprint ?? 6) / 2 + 0.3;
    return Math.abs(middle.x - point.x) > clearance || Math.abs(middle.z - point.z) > clearance;
  }) && walkLayout.walls.every(wall => Math.abs(middle.x - wall.x) > 1 || Math.abs(middle.z - wall.z) > 1);
  const troops = [];
  for (let i = 0; i < squadSize; i++) {
    let role = selectedRoles?.[i] || (tactic === 'recon' ? 'recon' : 'assault');
    if (!selectedRoles && squadUnlocked('medic', attackingSide.base.levels) && i === squadSize - 1) role = 'medic';
    else if (!selectedRoles && tactic === 'assault' && squadUnlocked('sentinel', attackingSide.base.levels) && i % 4 === 3) role = 'sentinel';
    const troop = makeSoldier(role, attackingSide.base.levels);
    const column = i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2);
    const spread = column * 1.12;
    const entry = [second.x + across.x * spread, second.z + across.z * spread];
    const via = middleIsClear ? middle : null;
    const firstLeg = via ? walkablePatrolPath(entry, [via.x, via.z], walkLayout) : [];
    const lastLeg = walkablePatrolPath(firstLeg?.at(-1) || entry, standSlots[i % standSlots.length] || stand, walkLayout);
    const walk = lastLeg ? [...(firstLeg || []), ...lastLeg] : null;
    const path = (walk ? [[first.x + across.x * spread, first.z + across.z * spread], entry, ...walk] : route.map(point => [point.x + across.x * spread, point.z + across.z * spread]))
      .map(([x, z]) => new THREE.Vector3(OUTPOST.x + x, 0, OUTPOST.z + z));
    if (!walk) path[path.length - 1].add(path[path.length - 2].clone().sub(path[path.length - 1]).normalize().multiplyScalar(3.2));
    const roleRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.53, 24),
      new THREE.MeshBasicMaterial({ color: WAR_ROLE_COLOURS[role], transparent: true, opacity: 0.68, depthWrite: false, side: THREE.DoubleSide }));
    roleRing.rotation.x = -Math.PI / 2;
    roleRing.position.y = 0.085;
    troop.add(roleRing);
    troop.position.copy(path[0]);
    scene.add(troop);
    warTroopMeshes.push(troop);
    troops.push({ mesh: troop, role, roleRing, healthBar: makeWarHealthBar(), lastDamageAt: 0, path, phase: i * 0.45, lag: role === 'medic' ? 0.08 : role === 'sentinel' ? 0.04 : 0,
      nextAction: 4.4 + i * 0.11, withdrawn: damage.ok ? damage.squad[i]?.withdrawn : i >= squadSize - result.casualties });
  }
  warBattle = { warId, tactic, result, damage, defenderName: defendingSide.name, defenderSnapshot: defendingSide, objectiveMarker, objectiveHealthBar: makeWarHealthBar(1.35),
    lastObjectiveHitAt: 0, lastWallHitAt: {}, objectiveDownShown: false, defenceBeacon, squadSize, troops, time: 0, duration: 12, smokeTimer: 0, shotClock: 0, bolts: [], effects: [], breachShown: false,
    orders: [...(result.orders || [])], orderView: '', coverUntil: 0, previousCameraOffset: cameraOffset.clone() };
  scene.add(warFillLight, warKeyLight, warKeyLight.target);
  warHud.hidden = false;
  warHud.style.maxWidth = 'min(355px,calc(100vw - 24px))';
  const roster = [...new Set(troops.map(troop => troop.role))].map(role => `<span style="color:#${WAR_ROLE_COLOURS[role].toString(16).padStart(6, '0')}">● ${WAR_ROLE_LABELS[role]} ${troops.filter(troop => troop.role === role).length}</span>`).join(' · ');
  warHud.innerHTML = `<div class="war-progress"></div><div style="font-weight:500;line-height:1.5;margin-top:5px">${roster}</div><div class="war-damage-status" style="color:#b8efc9;font-weight:650;line-height:1.4;margin-top:5px" aria-live="off"></div>${result.defenceOrderActive ? `<div style="color:#ffdb9b;font-weight:650;line-height:1.4;margin-top:5px">HOME DEFENCE · ${escapeHTML(WAR_DEFENCE_ORDERS[result.defenceOrder].name)}</div>` : ''}`;
  warBattle.damageStatus = warHud.querySelector('.war-damage-status');
  updateWarDamage(warBattle, 0);
  warOrders.hidden = false;
  warOrders.innerHTML = '<b>FIELD COMMAND</b><p>Approaching the defended base. Contact orders unlock shortly.</p>';
  camTarget.copy(OUTPOST);
  cameraOffset.set(route[0].x < 0 ? -40 : 40, 40, route[0].z < 0 ? -40 : 40);
  zoom = 28;
  updateCamera();
  panel.style.display = 'none';
  toast(resumed ? `Resumed ${tactic} attack · ${warBattle.orders.length}/2 field orders recorded.` : `${tactic === 'assault' ? 'Assault' : 'Recon'} deployed via ${result.tactics.laneName}. Direct the squad when contact begins.`);
  playClank();
}

warOrders.onclick = event => {
  const button = event.target.closest('button[data-field-order]');
  if (!button || !warBattle) return;
  const phase = button.dataset.phase;
  const command = button.dataset.fieldOrder;
  const result = service.issueWarFieldOrder(service.profile().id, warBattle.warId, warBattle.result.attackId, phase, command);
  if (!result.ok) { toast(result.error); return; }
  warBattle.orders.push(result.order);
  warBattle.result.score = result.score;
  warBattle.result.casualties = result.casualties;
  warBattle.result.feedback = result.feedback;
  warBattle.result.damage = result.damage;
  warBattle.damage = result.damage;
  warBattle.troops.forEach((troop, index) => { troop.withdrawn = result.damage?.squad?.[index]?.withdrawn ?? index >= warBattle.squadSize - result.casualties; });
  if (command === 'smoke' || command === 'cover') {
    warBattle.coverUntil = warBattle.time + 2.2;
    for (let i = 0; i < 5; i++) spawnSmoke(warBattle.troops[i % warBattle.troops.length].mesh.position.clone().add(new THREE.Vector3(0, 0.5, 0)));
  } else {
    warBattle.objectiveMarker.material.color.setHex(0xffb45e);
    const target = warBattle.objectiveMarker.position;
    spawnSmoke(new THREE.Vector3(OUTPOST.x + target.x, 1, OUTPOST.z + target.z));
  }
  warBattle.orderView = '';
  toast(`${result.order.name} · ${result.score} attack points · ${result.casualties} withdrawn.`);
  playClank();
};

function updateWarOrders(progress) {
  if (!warBattle) return;
  const contact = warBattle.orders.find(order => order.phase === 'contact');
  const withdrawal = warBattle.orders.find(order => order.phase === 'withdrawal');
  const phase = progress < 0.22 ? 'approach' : !contact ? 'contact' : progress < 0.6 ? 'advance' : !withdrawal ? 'withdrawal' : 'complete';
  if (phase === warBattle.orderView) return;
  warBattle.orderView = phase;
  if (phase === 'approach') warOrders.innerHTML = '<b>FIELD COMMAND</b><p>Approaching the defended base. Contact orders unlock shortly.</p>';
  else if (phase === 'advance') warOrders.innerHTML = `<b>CONTACT ORDER · ${escapeHTML(contact.name)}</b><p>Squad is advancing. Withdrawal orders unlock at the target.</p>`;
  else if (phase === 'complete') warOrders.innerHTML = `<b>ORDERS EXECUTED</b><p>${escapeHTML(contact.name)} → ${escapeHTML(withdrawal.name)} · ${warBattle.result.score} points · ${warBattle.result.casualties} withdrawn.</p>`;
  else {
    const choices = WAR_FIELD_ORDERS[phase];
    const detail = phase === 'contact' ? 'Focus fire adds points but risks a troop. Smoke protects a troop.' : 'Press the target for points and extra risk, or cover withdrawal to protect up to two troops at a score cost.';
    warOrders.innerHTML = `<b>${phase === 'contact' ? 'CONTACT' : 'WITHDRAWAL'} · ISSUE ONE ORDER</b><p>${detail}</p><div class="row">${Object.entries(choices).map(([id, label]) => `<button type="button" data-phase="${phase}" data-field-order="${id}">${escapeHTML(label)}</button>`).join('')}</div>`;
  }
}

function warPathPosition(path, fraction, destination) {
  const lengths = path.slice(1).map((point, index) => point.distanceTo(path[index]));
  const total = lengths.reduce((sum, length) => sum + length, 0) || 1;
  let remaining = THREE.MathUtils.clamp(fraction, 0, 1) * total;
  for (let index = 0; index < lengths.length; index++) {
    if (remaining <= lengths[index] || index === lengths.length - 1) {
      destination.lerpVectors(path[index], path[index + 1], lengths[index] ? remaining / lengths[index] : 1);
      return Math.atan2(path[index + 1].x - path[index].x, path[index + 1].z - path[index].z);
    }
    remaining -= lengths[index];
  }
  return 0;
}

function animateWarRoleAction(battle, troop) {
  if (troop.withdrawn || battle.time < troop.nextAction) return;
  troop.nextAction = battle.time + (troop.role === 'medic' ? 2 : troop.role === 'sentinel' ? 1.4 : 1.1);
  const target = battle.objectiveMarker.position.clone().add(OUTPOST).add(new THREE.Vector3(0, 1.2, 0));
  const origin = troop.mesh.position.clone().add(new THREE.Vector3(0, 1.15, 0));
  if (troop.role === 'assault') spawnWarTrace(battle, origin, target, WAR_ROLE_COLOURS.assault);
  else if (troop.role === 'sentinel') {
    spawnWarTrace(battle, origin, target, WAR_ROLE_COLOURS.sentinel, 0.05);
    spawnWarPulse(battle, troop.mesh.position, WAR_ROLE_COLOURS.sentinel, 0.65);
  } else if (troop.role === 'recon') {
    spawnWarPulse(battle, troop.mesh.position, WAR_ROLE_COLOURS.recon, 1.25);
    spawnWarTrace(battle, origin, target, WAR_ROLE_COLOURS.recon, 0.016);
  } else if (troop.role === 'engineer') {
    const breachPoint = battle.result.tactics?.breachedWallIds.length ? battle.result.tactics.route[2] : null;
    const breach = breachPoint ? new THREE.Vector3(OUTPOST.x + breachPoint.x, 0, OUTPOST.z + breachPoint.z) : troop.path[troop.path.length - 1];
    spawnWarTrace(battle, origin, breach.clone().add(new THREE.Vector3(0, 0.75, 0)), WAR_ROLE_COLOURS.engineer, 0.042);
    spawnWarPulse(battle, breach, WAR_ROLE_COLOURS.engineer, 0.75);
  } else if (troop.role === 'medic') {
    spawnWarPulse(battle, troop.mesh.position, WAR_ROLE_COLOURS.medic, 1.9);
  }
}

function updateWarBattle(dt) {
  if (!warBattle) return;
  warBattle.time += dt;
  const progress = THREE.MathUtils.clamp(warBattle.time / warBattle.duration, 0, 1);
  updateWarOrders(progress);
  const tactics = warBattle.result.tactics;
  warBattle.objectiveMarker.scale.setScalar(1 + Math.sin(warBattle.time * 6) * 0.12);
  if (warBattle.defenceBeacon && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    warBattle.defenceBeacon.scale.setScalar(1 + Math.sin(warBattle.time * 4) * 0.09);
    warBattle.defenceBeacon.material.opacity = 0.65 + Math.sin(warBattle.time * 4) * 0.2;
  }
  const activeCount = warBattle.damage?.squad?.filter(track => warHealthAt(track, progress) > 0).length ?? warBattle.squadSize - warBattle.result.casualties;
  warHud.querySelector('.war-progress').textContent = `${warBattle.tactic.toUpperCase()} · ${tactics?.laneName || 'West treeline'} → ${tactics?.objectiveName || 'Command Hall'} · ${progress < 0.27 ? 'APPROACH' : progress < 0.48 ? tactics?.breachedWallIds.length ? 'BREACH' : 'COVER' : progress < 0.7 ? 'ADVANCE' : progress < 0.84 ? 'TARGET PUSH' : 'WITHDRAWAL'} · ${activeCount}/${warBattle.squadSize} press on · ${Math.max(0, Math.ceil(warBattle.duration - warBattle.time))}s`;
  for (const [index, troop] of warBattle.troops.entries()) {
    const actionProgress = Math.max(0, progress - troop.lag);
    const track = warBattle.damage?.squad?.[index];
    const fallenAt = track?.withdrawn ? track.hits.find((hit, position) => track.hits.slice(0, position + 1).reduce((sum, item) => sum + item.damage, 0) >= track.maxHealth)?.at : null;
    const retreatAt = troop.withdrawn ? Math.min(0.74, fallenAt ?? 0.74) : 0.84;
    const retreating = actionProgress > retreatAt;
    const travel = retreating
      ? Math.max(0.16, (troop.withdrawn ? Math.min(0.94, retreatAt / 0.7) - (actionProgress - retreatAt) * 2.7 : 1 - (actionProgress - 0.84) * 2.5))
      : Math.min(1, actionProgress / 0.7);
    const heading = warPathPosition(troop.path, travel, troop.mesh.position);
    const advancing = !retreating && actionProgress < 0.7;
    troop.mesh.rotation.y = retreating ? heading + Math.PI : heading;
    troop.mesh.position.y = advancing || retreating ? Math.abs(Math.sin(warBattle.time * 8 + troop.phase)) * 0.055 : 0;
    troop.roleRing.material.opacity = retreating ? 0.3 : 0.52 + Math.sin(warBattle.time * 3 + troop.phase) * 0.13;
    animateSoldier(troop.mesh, warBattle.time * 8 + troop.phase, advancing || retreating ? 1 : 0, null, dt);
    if (!retreating && (!track || warHealthAt(track, progress) > 0) && progress > 0.37 && progress < 0.83) animateWarRoleAction(warBattle, troop);
  }
  updateWarDamage(warBattle, progress);
  if (warBattle.damage?.walls?.some(wall => warHealthAt(wall, progress) === 0)) {
    if (!warBattle.breachShown) {
      warBattle.breachShown = true;
      const breach = tactics.route[2];
      spawnSmoke(new THREE.Vector3(OUTPOST.x + breach.x, 1, OUTPOST.z + breach.z));
      toast(`A locked wall segment fell on the ${tactics.laneName} route.`);
    }
  }
  for (const defender of warDefenderMeshes) {
    const nearest = warBattle.troops.filter((troop, index) => !warBattle.damage?.squad?.[index] || warHealthAt(warBattle.damage.squad[index], progress) > 0).reduce((best, troop) => {
      const distance = troop.mesh.position.distanceTo(defender.home);
      return !best || distance < best.distance ? { mesh: troop.mesh, distance } : best;
    }, null);
    const threat = nearest ? THREE.MathUtils.clamp((20 - nearest.distance) / 12, 0, 1) : 0;
    if (threat) {
      const direction = nearest.mesh.position.clone().sub(defender.home);
      const facing = Math.atan2(direction.x, direction.z);
      const turn = Math.atan2(Math.sin(facing - defender.mesh.rotation.y), Math.cos(facing - defender.mesh.rotation.y));
      defender.mesh.rotation.y += THREE.MathUtils.clamp(turn, -dt * 2.8, dt * 2.8);
      if (defender.role === 'hound') {
        direction.y = 0;
        defender.mesh.position.copy(defender.home).add(direction.normalize().multiplyScalar(Math.max(0, Math.sin(warBattle.time * 9)) * threat * 0.55));
      }
    } else defender.mesh.position.copy(defender.home);
    if (defender.snareField) {
      defender.snareField.scale.setScalar(1 + threat * (0.4 + Math.sin(warBattle.time * 8) * 0.2));
      defender.snareField.material.opacity = threat * (0.2 + Math.sin(warBattle.time * 8) * 0.08);
    }
    animateDefender({ ...defender, motion: { stride: warBattle.time * 8, moving: defender.role === 'hound' && threat > 0.1 } }, warBattle.time, threat);
  }
  const turretPosition = warTurretRig?.yaw.getWorldPosition(new THREE.Vector3());
  const target = turretPosition && warBattle.troops.filter((troop, index) => !warBattle.damage?.squad?.[index] || warHealthAt(warBattle.damage.squad[index], progress) > 0).reduce((nearest, troop) => {
    const distance = troop.mesh.position.distanceToSquared(turretPosition);
    return !nearest || distance < nearest.distance ? { mesh: troop.mesh, distance } : nearest;
  }, null)?.mesh;
  warBattle.shotClock = Math.min(1.2, warBattle.shotClock + dt);
  const fire = Boolean(target && progress < 0.94 && warBattle.time >= warBattle.coverUntil && warBattle.shotClock >= 0.8);
  const aim = target?.position.clone().add(new THREE.Vector3(0, 1.1, 0));
  if (stepArcBattery(warTurretRig, dt, warBattle.time, aim, fire)) {
    warBattle.shotClock = 0;
    spawnArcBolt(warTurretRig.muzzle.getWorldPosition(new THREE.Vector3()), aim, warBattle.bolts);
  }
  updateArcBolts(warBattle.bolts, dt);
  updateWarEffects(warBattle, dt);
  warBattle.smokeTimer += dt;
  if (warBattle.smokeTimer >= 0.8 && progress > 0.65) {
    warBattle.smokeTimer = 0;
    spawnSmoke(OUTPOST.clone().add(new THREE.Vector3(-2 + Math.sin(warBattle.time) * 3, 1, Math.cos(warBattle.time) * 4)));
  }
  if (warBattle.time < warBattle.duration) return;
  for (const troop of warBattle.troops) disposeWarHealthBar(troop.healthBar);
  disposeWarHealthBar(warBattle.objectiveHealthBar);
  for (const troop of warTroopMeshes) {
    scene.remove(troop);
    const ring = troop.children.find(child => child.geometry?.type === 'RingGeometry');
    ring?.geometry.dispose();
    ring?.material.dispose();
  }
  warTroopMeshes.length = 0;
  clearWarEffects(warBattle);
  scene.remove(warFillLight, warKeyLight, warKeyLight.target);
  clearWarBaseVisuals();
  warBaseGroup.visible = false;
  outpostBlocks.forEach(block => { block.visible = true; });
  for (const building of Object.values(buildings)) building.group.visible = true;
  const completed = warBattle;
  warBattle = null;
  warHud.hidden = true;
  warOrders.hidden = true;
  camTarget.set(0, 0, 0);
  cameraOffset.copy(completed.previousCameraOffset);
  zoom = 28;
  updateCamera();
  toast(`Raid replay complete · ${completed.result.score} points. Open War Table for the full result.`);
  showWarTable();
}

async function launchRaid() {
  if (raid || raidLaunching || warBattle) return;
  const identityId = service.state.currentIdentityId;
  const access = service.getAccess(identityId);
  if (!access.allowed) {
    toast(access.reason);
    showWarTable();
    return;
  }
  const levels = { ...state.levels };
  const loadout = service.getTrainingReadiness(identityId);
  if (!loadout.ready) { toast('Train the missing troops at camp first.'); showTrainingLoadout(); return; }
  const approach = selectedTrainingApproach;
  raidLaunching = true;
  try {
    await buildOutpost();
  } catch (error) {
    console.error('Training outpost could not be prepared.', error);
    toast('Training outpost unavailable. Try again.');
    raidLaunching = false;
    return;
  }
  raidLaunching = false;
  if (raid || warBattle) return;
  if (service.state.currentIdentityId !== identityId || !service.getAccess(identityId).allowed) {
    toast('Training access changed. Prepare the drill again.');
    showWarTable();
    return;
  }
  const raidId = Math.max(state.raidCount, state.lastRaidClaimed) + 1;
  const attempt = service.recordTrainingAttempt(raidId, identityId);
  if (!attempt.ok) {
    toast(attempt.error);
    showWarTable();
    return;
  }
  closePanel();
  const troops = [];
  const roles = Object.entries(loadout.counts).flatMap(([role, count]) => Array(count).fill(role));
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    const kit = squadProfile(role, levels);
    const t = makeSoldier(role, levels);
    t.userData.stride = i * 0.65;
    t.userData.hp = kit.maxHealth;
    t.userData.combat = { role, maxHealth: kit.maxHealth, damage: kit.damage, armour: kit.armour, tier: kit.tier,
      speed: { assault: 5, recon: 6.8, engineer: 4.7, sentinel: 4, medic: 5.2 }[role] };
    const offset = (i - (roles.length - 1) / 2) * 1.6;
    if (approach === 'east') t.position.set(OUTPOST.x + 19, 0, OUTPOST.z + offset);
    else if (approach === 'south') t.position.set(OUTPOST.x + offset, 0, OUTPOST.z + 19);
    else t.position.set(OUTPOST.x - 19, 0, OUTPOST.z + offset);
    scene.add(t);
    troops.push(t);
  }
  raid = { id: raidId, identityId, troops, approach, time: 0, tracers: [], hudSecond: -1 };
  trainingHud.hidden = false;
  camTarget.copy(OUTPOST);
  zoom = 30;
  updateCamera();
  playClank();
  toast(`${roles.length} DZN troops deployed from the ${approach} approach.`);
}

function updateRaid(dt) {
  raid.time += dt;
  const remainingSeconds = Math.max(0, Math.ceil(45 - raid.time));
  if (remainingSeconds !== raid.hudSecond) {
    raid.hudSecond = remainingSeconds;
    trainingHud.textContent = `OUTPOST DELTA · ${remainingSeconds}s · ${raid.troops.filter(t => t.userData.hp > 0).length}/${raid.troops.length} troops · ${outpostBlocks.filter(b => b.userData.hp > 0).length}/${outpostBlocks.length} targets`;
  }
  for (const t of raid.troops) {
    if (t.userData.hp <= 0) continue;
    const combat = t.userData.combat;
    const alive = outpostBlocks.filter(b => b.userData.hp > 0);
    const priority = combat.role === 'engineer' ? 'tower' : combat.role === 'recon' ? 'comms' : null;
    const target = alive.find(b => b.userData.structureKey === priority) || alive.reduce((nearest, block) =>
      !nearest || block.position.distanceToSquared(t.position) < nearest.position.distanceToSquared(t.position) ? block : nearest, null);
    if (!target) {
      break;
    }
    if (combat.role === 'medic') {
      t.userData.healClock = (t.userData.healClock || 0) + dt;
      if (t.userData.healClock >= 1.2) {
        const ally = raid.troops.filter(candidate => candidate.userData.hp > 0 && candidate.userData.hp < candidate.userData.combat.maxHealth && candidate.position.distanceToSquared(t.position) < 80)
          .sort((a, b) => a.userData.hp / a.userData.combat.maxHealth - b.userData.hp / b.userData.combat.maxHealth)[0];
        if (ally) { ally.userData.hp = Math.min(ally.userData.combat.maxHealth, ally.userData.hp + 10 + combat.tier * 4); t.userData.healClock = 0; }
      }
    }
    const dir = target.position.clone().sub(t.position).setY(0);
    if (dir.length() > 4) {
      t.position.addScaledVector(dir.normalize(), dt * combat.speed);
      t.rotation.y = Math.atan2(dir.x, dir.z);
      animateSoldier(t, raid.time * 8 + t.userData.stride, 1, null, dt);
    } else {
      animateSoldier(t, raid.time * 2 + t.userData.stride, 0.22, null, dt);
      const specialistBonus = (combat.role === 'engineer' && target.userData.structureKey === 'tower') || (combat.role === 'recon' && target.userData.structureKey === 'comms') ? 1.35 : 1;
      target.userData.hp -= combat.damage * 1.25 * specialistBonus * dt;
      if (Math.random() < dt * 6) {
        spawnSmoke(target.position.clone().add(new THREE.Vector3(0, 1, 0)));
        beep(200 + Math.random() * 100, 0.04);
      }
    }
  }
  const defender = outpostBlocks.find(b => b.userData.structureKey === 'tower' && b.userData.hp > 0);
  const rig = defender?.userData.turretRig;
  const troop = rig && raid.troops.filter(t => t.userData.hp > 0).reduce((nearest, candidate) => {
    const distance = candidate.position.distanceToSquared(defender.position);
    return !nearest || distance < nearest.distance ? { mesh: candidate, distance } : nearest;
  }, null)?.mesh;
  if (rig) {
    defender.userData.shotClock += dt;
    const aim = troop?.position.clone().add(new THREE.Vector3(0, 1.1, 0));
    if (stepArcBattery(rig, dt, raid.time, aim, defender.userData.shotClock >= 1.2)) {
      defender.userData.shotClock = 0;
      spawnArcBolt(rig.muzzle.getWorldPosition(new THREE.Vector3()), aim, raid.tracers);
      troop.userData.hp -= Math.max(5, 18 - Math.floor(troop.userData.combat.armour / 4));
      if (troop.userData.hp <= 0) {
        troop.visible = false;
        spawnSmoke(troop.position.clone().add(new THREE.Vector3(0, 0.8, 0)));
      }
    }
  }
  updateArcBolts(raid.tracers, dt);
  for (const b of outpostBlocks) {
    if (b.userData.hp <= 0 && b.scale.y > 0.1) {
      b.scale.y = Math.max(0.1, b.scale.y - dt * 2);
    }
  }
  const structuresRemaining = outpostBlocks.some(b => b.userData.hp > 0);
  if (!structuresRemaining || raid.time > 45 || raid.troops.every(t => t.userData.hp <= 0)) {
    finishRaid(!structuresRemaining);
  }
}

function finishRaid(won) {
  const finished = raid;
  raid = null;
  trainingHud.hidden = true;
  finished.troops.forEach(t => scene.remove(t));
  finished.tracers.forEach(disposeWarBolt);
  let reward = 0;
  if (won) {
    const proposedReward = Math.round(250 * (1 + state.levels.comms * 0.2));
    const claim = service.recordTrainingVictory(finished.identityId, finished.id, proposedReward);
    if (claim.ok) reward = claim.reward;
    else console.warn('Training reward was not applied:', claim.error);
  }
  panel.innerHTML = `<h2>${won ? 'TRAINING VICTORY' : 'TRAINING DEFEAT'}</h2><p>Simulated Outpost Delta ${won ? 'neutralised' : 'held out'}.</p><p>Approach: ${escapeHTML(finished.approach)} · Time: ${Math.min(45, Math.round(finished.time))}s · Troops returned: ${finished.troops.filter(t => t.userData.hp > 0).length}/${finished.troops.length}.</p><p>Training reward: ⚙ ${reward} Parts${won && reward === 0 ? ' · already claimed or locked' : ''}</p><div class="row"><button id="closeBtn">Return to Base</button></div>`;
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
  if (fieldSession) { dragDistance += Math.abs(dx) + Math.abs(dy); return; }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    zoom = THREE.MathUtils.clamp(zoom * pinchStart / dist, 12, 60);
    pinchStart = dist;
  } else {
    dragDistance += Math.abs(dx) + Math.abs(dy);
    if (focusedPatrolRole && dragDistance > 6) stopPatrolFocus();
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
  if (fieldSession) {
    if (dragDistance < 6) {
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      const pickers = fieldMarkers.children.map(marker => marker.children.find(child => child.userData.fieldChoice)).filter(Boolean);
      const marker = raycaster.intersectObjects(pickers, false)[0]?.object;
      if (marker) orderFieldChoice(marker.userData.fieldChoice);
      else {
        const groundHit = raycaster.intersectObject(fieldFloor, false)[0];
        if (groundHit) {
          const point = fieldGroup.worldToLocal(groundHit.point.clone());
          setFieldDestination({ x: point.x, z: point.z });
        }
      }
    }
    return;
  }
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
  if (fieldSession) { zoom = THREE.MathUtils.clamp(zoom * (e.deltaY > 0 ? 1.08 : 0.92), 25, 44); updateCamera(); return; }
  if (focusedPatrolRole) stopPatrolFocus();
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

  checkUpgrades();
  service.advancePartsProduction();
  service.advanceTimberProduction();

  animated.radars.forEach(r => {
    r.rotation.y += dt * 1.5;
  });
  if (buildings.tower?.group.visible) stepArcBattery(buildings.tower.model?.userData.turretRig, dt, elapsed);
  animated.lights.forEach(l => {
    if (l.head) {
      l.head.rotation.y = Math.sin(elapsed * 0.5) * 1.6 + 0.8;
    }
    if (l.flag) {
      l.flag.rotation.y = Math.sin(elapsed * 3) * 0.3;
    }
  });
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) animated.yards.forEach(yard => {
    yard.phase += dt;
    if (yard.rotor) yard.rotor.rotation.z -= dt * 6.2;
    for (const roller of yard.rollers) roller.rotateY(dt * 1.9);
    if (yard.carriage) yard.carriage.position.z = 1.55 + Math.sin(yard.phase * 1.25) * .09;
    if (yard.hook) yard.hook.position.y = 2.54 + Math.sin(yard.phase * .8) * .12;
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
    const motion = stepPatrolMotion(p.motion, dt, activePatrolNodes, activePatrolLayout);
    p.mesh.position.set(motion.x, 0, motion.z);
    p.mesh.rotation.y = motion.yaw;
    animateSoldier(p.mesh, motion.moving ? motion.stride : elapsed * 1.5, motion.moving ? 1 : 0, motion.wait > 0 ? motion.node : null, dt);
  });
  if (focusedPatrolRole) {
    const patrol = focusedPatrol();
    if (!patrol?.mesh.visible || raid || warBattle) stopPatrolFocus(true);
    else {
      camTarget.lerp(patrol.mesh.position, Math.min(1, dt * 7));
      updateCameraPosition();
      patrolFocusLight.position.set(patrol.mesh.position.x + 1.2, 2.6, patrol.mesh.position.z + 1.2);
      patrolFocusRing.position.set(patrol.mesh.position.x, 0.055, patrol.mesh.position.z);
      patrolFocusRing.scale.setScalar(1 + Math.sin(elapsed * 3) * 0.04);
    }
  }
  for (const patrol of defenderPatrols.values()) {
    const motion = stepPatrolMotion(patrol.motion, dt, activePatrolNodes, service.community()?.saved.base.layout);
    patrol.mesh.position.set(motion.x, 0, motion.z);
    patrol.mesh.rotation.y = motion.yaw;
    animateDefender(patrol, elapsed);
  }
  if (operativeMesh.visible && operativePatrol.motion) {
    const motion = stepPatrolMotion(operativePatrol.motion, dt, activePatrolNodes, service.community()?.saved.base.layout);
    operativeMesh.position.set(motion.x, 0, motion.z);
    operativeMesh.rotation.y = motion.yaw;
    const name = motion.moving ? 'walk' : 'idle';
    if (operativePatrol.mixer && operativePatrol.actionName !== name) {
      const next = operativePatrol.actions[name];
      next.reset().fadeIn(.18).play();
      operativePatrol.action?.fadeOut(.18);
      operativePatrol.action = next;
      operativePatrol.actionName = name;
    }
    operativePatrol.mixer?.update(dt);
  }
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
  if (fieldSession) updateExpeditionField(dt);
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
    refreshConstructionTimers();
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

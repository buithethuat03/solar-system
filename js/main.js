// ============================================================================
//  main.js  —  Renderer, camera, controls, post-processing & the sim loop.
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

import { buildSolarSystem } from './bodies.js';
import { daysSinceJ2000, j2000DaysToDate, voyagerState } from './kepler.js';
import { initUI } from './ui.js';
import { loadPrefs, savePref } from './prefs.js';
import { parseHash, serializeState, scheduleHashWrite } from './permalink.js';
import { createEclipse } from './eclipse.js';
import { createBlackHoleView } from './blackhole.js';
import { interstellarScenePosition } from './blackhole-physics.js';
import { createPostFX, BLOOM_LAYER } from './postfx.js';
import { createInterstellarTravel } from './interstellar-travel.js';
import { createBlackHoleLocator } from './blackhole-locator.js';
import { SUN, PLANETS, MOONS, VOYAGERS, BLACK_HOLES, CONFIG } from './data.js';
import { t, applyBodyTranslations, applyStaticTranslations, MONTHS } from './i18n.js';

// ---------------------------------------------------------------------------
//  Renderer / scene / camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
// Deduplicate identical texture URLs across modules (the eclipse rig shares
// Earth's maps with the main scene; without the cache they downloaded twice).
THREE.Cache.enabled = true;
// logarithmicDepthBuffer: the true-scale view spans an enormous dynamic range —
// from a sub-unit moon up close out to bodies millions of units away — which a
// linear depth buffer cannot resolve without severe z-fighting. The log buffer
// keeps near objects crisp while still reaching the far dwarf planets.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
// All Solar-System objects live under one movable root. Re-centering this root
// around a metre-scale spacecraft preserves GPU precision billions of km out;
// eclipse geometry remains in ordinary scene coordinates.
const systemRoot = new THREE.Group();
scene.add(systemRoot);
// Far plane reaches past Eris' aphelion (~3.7M units) plus the background shells.
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 4.0e7);
camera.position.set(0, 120, 320);

// Camera framings reused by the distance-scale switch and Reset view.
const HOME_POS = new THREE.Vector3(0, 120, 320);          // compressed-view default
// True-scale default: pulled back far enough to take in Earth's whole orbit
// (~37,570 units), so the pin-prick Sun and the vast gulf to Earth read at once.
const TRUE_VIEW = new THREE.Vector3(0, 60000, 150000);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.id = 'labels';
document.body.appendChild(labelRenderer.domElement);

// NOTE: controls + picking must listen on the CANVAS. The CSS2D label layer
// sits on top with pointer-events:none so clicks fall through to the canvas,
// while individual labels (pointer-events:auto) stay clickable.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 3;
controls.maxDistance = 14000;
controls.zoomSpeed = 1.1;
controls.enableZoom = true;
controls.enablePan = true;
// Touch: one finger orbits, two fingers pinch-to-zoom (and drag to pan).
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

// ---------------------------------------------------------------------------
//  Asset loading manager (drives the loading screen)
// ---------------------------------------------------------------------------
// Texture resolution: first-time visitors default to 2K; '8k' is opt-in and
// persisted, so changing it + reloading replays the normal load animation.
const TEX_RES = (localStorage.getItem('solar.texRes') === '8k') ? 'high' : 'low';

const loadingEl = document.getElementById('loading');
const loadingBar = document.getElementById('loading-bar');
const loadingText = document.getElementById('loading-text');
const manager = new THREE.LoadingManager();
manager.onProgress = (url, loaded, total) => {
  const pct = Math.round((loaded / total) * 100);
  if (loadingBar) loadingBar.style.width = pct + '%';
  if (loadingText) loadingText.textContent = `${t('loadingTextures')} ${pct}%`;
};
manager.onLoad = () => {
  if (loadingEl) { loadingEl.classList.add('hidden'); }
};
manager.onError = (url) => console.warn('Failed to load:', url);
const loader = new THREE.TextureLoader(manager);

// ---------------------------------------------------------------------------
//  Simulation state
// ---------------------------------------------------------------------------
// Persisted view settings and (winning over them) a shared-link hash state.
// Applying a link never writes prefs — a recipient's saved setup survives.
const savedPrefs = loadPrefs();
const linkState = parseHash(window.location.hash);
const boot = (key, fallback) =>
  linkState.layers?.[key] ?? savedPrefs[key] ?? fallback;
const state = {
  paused: linkState.paused ?? savedPrefs.paused ?? false,
  speed: linkState.speed ?? savedPrefs.speed ?? 1 / 86400,
  direction: savedPrefs.direction ?? 1,
  simDays: linkState.date
    ? Date.parse(linkState.date + 'T12:00:00Z') / 86400000 - 10957.5
    : daysSinceJ2000(new Date()),
  showOrbits: boot('showOrbits', true),
  showLabels: boot('showLabels', true),
  showBelts: boot('showBelts', true),
  showMoons: boot('showMoons', true),
  showDwarfs: boot('showDwarfs', true),
  showSpacecraft: boot('showSpacecraft', true),
  showBlackHoles: boot('showBlackHoles', true),
  distanceMode: 'visual',   // applied via controller after init (camera framing)
  bloom: boot('bloom', true),
  selected: null,      // { kind, ref, object3D }
  following: false,
};
const bootDistanceMode = linkState.mode ?? savedPrefs.distanceMode ?? 'visual';
const bootSelectedId = linkState.body ?? savedPrefs.selectedId ?? null;
let applyingLink = true;   // suppress pref writes while restoring state
// Share/persist funnel: every controller mutation lands here once.
function persistAndShare(key, value) {
  if (!applyingLink && key) savePref(key, value);
  scheduleHashWrite(state, state.selected?.ref?.id ?? null);
}

// ---------------------------------------------------------------------------
//  Build the solar system
// ---------------------------------------------------------------------------
// Overlay Vietnamese onto the dataset (if selected) BEFORE building, so labels,
// the navigator and the info panel all pick up the translated names/text.
applyBodyTranslations(SUN, PLANETS, MOONS, VOYAGERS, BLACK_HOLES);
const system = buildSolarSystem(systemRoot, loader, onPick, state.distanceMode, TEX_RES,
  Math.min(8, renderer.capabilities.getMaxAnisotropy()));

// ---------------------------------------------------------------------------
//  Post-processing (js/postfx.js) — selective bloom: only the Sun (and the
//  eclipse Sun) glow. Tag the Sun and its corona/glow sprites; layers.enable
//  keeps them on layer 0 too, so the base render still draws them.
// ---------------------------------------------------------------------------
system.sunMesh.traverse((o) => o.layers.enable(BLOOM_LAYER));
const postfx = createPostFX({ renderer, scene, camera, getBloomEnabled: () => state.bloom });
const renderFrame = postfx.renderFrame;

// ---------------------------------------------------------------------------
//  Picking (click to select)
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downX = 0, downY = 0, downT = 0;

renderer.domElement.addEventListener('pointerdown', (e) => {
  downX = e.clientX; downY = e.clientY; downT = performance.now();
});
renderer.domElement.addEventListener('pointerup', (e) => {
  const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
  const dt = performance.now() - downT;
  if (moved < 6 && dt < 350) clickSelect(e.clientX, e.clientY);
});
renderer.domElement.addEventListener('dblclick', (e) => {
  clickSelect(e.clientX, e.clientY, true);
});

function clickSelect(cx, cy, focus = false) {
  if (eclipse.isActive() || blackHole.isActive()) return;
  pointer.x = (cx / window.innerWidth) * 2 - 1;
  pointer.y = -(cy / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(system.selectable, false);
  if (hits.length) {
    onPick(hits[0].object.userData, hits[0].object, focus);
  }
}

// Build a live info card for a Voyager: distance, light-time and speed are
// computed from the current simulated date (the rest is static mission data).
function voyagerLiveRef(data) {
  const st = voyagerState(data, state.simDays);   // null before launch
  const fmtUTC = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  const info = {};
  // Live distance/light-time/speed only exist once the craft has launched.
  if (st) {
    info[t('scDistance')]  = `${st.distAU.toFixed(2)} AU  ·  ${(st.distAU * 0.149597871).toFixed(2)} ${t('scBillionKm')}`;
    info[t('scLightTime')] = `${st.lightHours.toFixed(1)} ${t('scHours')}`;
    info[t('scSpeed')]     = `${st.speedKms.toFixed(1)} km/s  ·  ${st.speedAUyr.toFixed(2)} AU/yr`;
  }
  info[t('scLaunched')]     = fmtUTC(data.launchISO);
  info[t('scInterstellar')] = fmtUTC(data.interstellarISO);
  // Status tracks the simulated date: before launch → after launch → interstellar.
  const launchDays = daysSinceJ2000(new Date(data.launchISO));
  const interDays  = daysSinceJ2000(new Date(data.interstellarISO));
  info[t('scStatus')] = (!st || state.simDays < launchDays) ? t('scStatusPrelaunch')
                      : (state.simDays >= interDays)        ? t('scStatusActive')
                      :                                       t('scStatusCruising');
  return { id: data.id, name: data.name, type: data.type, description: data.description, facts: data.facts, info };
}

// Called from picking or from a label / list click. `userData.object3D`, when
// present (Voyagers), is the group to follow/frame instead of the clicked mesh.
function onPick(userData, object3D, focus = false) {
  const target = userData.object3D || object3D;
  const ref = (userData.kind === 'spacecraft') ? voyagerLiveRef(userData.ref) : userData.ref;
  state.selected = { kind: userData.kind, ref: userData.ref, object3D: target };
  persistAndShare('selectedId', userData.ref?.id ?? '');
  ui.showInfo(ref, userData.kind);
  ui.highlight(userData.ref.id);
  if (focus) focusOn(target);
  // A single click only inspects a body — it must not stay in follow mode. If we
  // were following another body, leave follow so the UI reflects "not following".
  else if (state.following) stopFollow();
}

function blackHoleById(id) {
  return BLACK_HOLES.find((body) => body.id === id) || null;
}

// Gaia BH1's physical geometry is far below one pixel from the Solar System, so
// selection uses a screen proxy. Focusing navigates to its real Float64 logical
// anchor; no fabricated nearby distance is introduced.
function selectBlackHole(data, focus = false) {
  if (!data) return;
  state.selected = { kind: 'black-hole', ref: data, object3D: null };
  ui.showInfo(data, 'black-hole');
  ui.highlight(data.id);
  if (state.following) stopFollow();
  if (focus) enterBlackHoleView(data);
}

// ---------------------------------------------------------------------------
//  Camera focus & follow
// ---------------------------------------------------------------------------
const REDUCED_MOTION = typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;
const focusAnim = { active: false, start: 0, dur: REDUCED_MOTION ? 0.25 : 1.1, storedDir: new THREE.Vector3(), storedDist: 0, fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(), fromTgt: new THREE.Vector3(), toTgt: new THREE.Vector3() };
const followPrev = new THREE.Vector3();
let followObj = null;
const tmpV = new THREE.Vector3();
const originShift = new THREE.Vector3();

function bodyWorldPos(object3D, out) {
  object3D.getWorldPosition(out);
  return out;
}
function bodyRadius(object3D) {
  object3D.geometry?.computeBoundingSphere?.();
  return (object3D.geometry?.boundingSphere?.radius || 5) * object3D.getWorldScale(tmpV).x;
}

function setDefaultCameraLimits() {
  const trueScale = state.distanceMode !== 'visual';
  camera.near = 0.05;
  controls.minDistance = trueScale ? 0.05 : 3;
  controls.maxDistance = trueScale ? 1.0e7 : 14000;
  camera.updateProjectionMatrix();
}

// Move the complete orrery (not the camera) so `object3D` is near world origin,
// then shift the camera by the same amount. The rendered view does not jump, but
// model/view matrices no longer subtract two multi-million-unit float values to
// reveal a spacecraft only a few millionths of a unit wide.
function rebaseAround(object3D, preserveView = true) {
  bodyWorldPos(object3D, originShift);
  if (originShift.lengthSq() < 1e-24) return;
  systemRoot.position.sub(originShift);
  if (preserveView) {
    camera.position.sub(originShift);
    controls.target.sub(originShift);
    if (focusAnim.active) {
      focusAnim.fromPos.sub(originShift);
      focusAnim.toPos.sub(originShift);
      focusAnim.fromTgt.sub(originShift);
      focusAnim.toTgt.sub(originShift);
    }
  }
}

function focusOn(object3D) {
  if (!object3D) return;
  // Never fly to a hidden spacecraft (e.g. nav-clicked in the compressed view, or
  // with the Spacecraft toggle off) — its true position is millions of units away
  // and the focus animation bypasses the zoom limit, which would strand the camera.
  if (object3D.userData?.kind === 'spacecraft' &&
      !(state.showSpacecraft && state.distanceMode !== 'visual')) return;
  const isSpacecraft = object3D.userData?.kind === 'spacecraft';
  const explicitRadius = object3D.userData?.focusRadius;
  // The loading screen normally guarantees this is ready. If the model failed to
  // load, keep selection working but do not fly into an undefined microscopic view.
  if (isSpacecraft && !(explicitRadius > 0)) return;

  rebaseAround(object3D);
  const target = bodyWorldPos(object3D, new THREE.Vector3());
  const r = explicitRadius ?? bodyRadius(object3D);
  if (isSpacecraft) {
    // Frame Voyager from only a few real bounding radii away. A near plane tied
    // to its physical radius permits metre-scale dolly/orbit without clipping.
    camera.near = Math.max(r * 0.02, 1e-10);
    controls.minDistance = r * 1.15;
    controls.maxDistance = 1.0e7;
    camera.updateProjectionMatrix();
  } else {
    setDefaultCameraLimits();
  }
  // Frame the body at ~5.5 radii. A small floor (not the old fixed 8) lets tiny
  // bodies be inspected up close in the true-scale view, where they are specks.
  const dist = isSpacecraft ? r * 3.2 : Math.max(r * 5.5, 0.5);
  const dir = tmpV.copy(camera.position).sub(controls.target).normalize();
  focusAnim.storedDir.copy(dir);     // keep dir+dist so toPos can track the moving body
  focusAnim.storedDist = dist;
  focusAnim.fromPos.copy(camera.position);
  focusAnim.fromTgt.copy(controls.target);
  focusAnim.toTgt.copy(target);
  focusAnim.toPos.copy(target).add(dir.multiplyScalar(dist));
  focusAnim.start = performance.now(); focusAnim.active = true;
  followObj = object3D;
  state.following = true;
  ui.setFollowing(true);
}

function stopFollow() {
  followObj = null; state.following = false; focusAnim.active = false;
  ui.setFollowing(false);
}

// ---------------------------------------------------------------------------
//  Visibility toggles
// ---------------------------------------------------------------------------
function applyVisibility() {
  for (const o of system.orbitLines) {
    const isDwarf = o.data.isDwarf;
    o.line.visible = state.showOrbits && (!isDwarf || state.showDwarfs);
  }
  for (const p of system.planets) {
    const dwarfOk = !p.data.isDwarf || state.showDwarfs;
    p.pivot.visible = dwarfOk;
    for (const m of p.moons) {
      m.mesh.visible = state.showMoons;
      m.orbit.visible = state.showMoons && state.showOrbits;
    }
  }
  system.asteroidBelt.mesh.visible = state.showBelts;
  system.kuiperBelt.mesh.visible = state.showBelts;

  // Spacecraft exist only in the true-scale views (their true positions are
  // hundreds of AU out — meaningless in the compressed view).
  const showCraft = state.showSpacecraft && state.distanceMode !== 'visual';
  // baseVisible is the master on/off; system.update() ANDs it with "has the craft
  // launched yet" each frame, so a craft scrubbed to before its launch stays hidden.
  for (const v of system.voyagers) {
    v.baseVisible = showCraft;
    v.group.visible = showCraft && v.launched;
  }

  for (const l of system.labels) {
    let vis = state.showLabels;
    if (l.type === 'moon') vis = vis && state.showMoons;
    if (l.type === 'dwarf') vis = vis && state.showDwarfs;
    if (l.type === 'spacecraft') {
      if (l.voyager) {
        l.voyager.labelBaseVisible = state.showLabels && showCraft;
        vis = l.voyager.labelBaseVisible && l.voyager.launched;
      } else {
        vis = vis && showCraft;
      }
    }
    l.obj.visible = vis;
  }
}
applyVisibility();

// Show/hide the whole orrery (used when entering/leaving an eclipse view).
// The Milky-Way sky and starfield stay visible as a backdrop.
function setOrreryVisible(v) {
  system.sunMesh.visible = v;
  system.sunLight.visible = v;
  system.ambient.visible = v;
  for (const p of system.planets) p.pivot.visible = v;
  for (const o of system.orbitLines) o.line.visible = v;
  system.asteroidBelt.mesh.visible = v;
  system.kuiperBelt.mesh.visible = v;
  for (const vo of system.voyagers) vo.group.visible = false;
  for (const l of system.labels) l.obj.visible = false;
  if (v) applyVisibility();   // restore proper per-toggle visibility
}

// ---------------------------------------------------------------------------
//  Controller exposed to the UI
// ---------------------------------------------------------------------------
let orbitsBeforeAccurate = true;   // remember the Orbit-paths toggle across Accurate mode
const controller = {
  state,
  bodies: { sun: SUN, planets: PLANETS, moons: MOONS, voyagers: VOYAGERS, blackHoles: BLACK_HOLES },
  togglePause(p) { state.paused = p; persistAndShare('paused', p); },
  setSpeed(v) { state.speed = v; persistAndShare('speed', v); },
  setDirection(d) { state.direction = d; persistAndShare('direction', d); },
  goToNow() { state.simDays = daysSinceJ2000(new Date()); },
  setDate(date) { state.simDays = daysSinceJ2000(date); },
  setToggle(key, val) { state[key] = val; applyVisibility(); persistAndShare(key, val); },
  setDistanceMode(mode) {
    const wasAccurate = state.distanceMode === 'accurate';
    if (wasAccurate && mode !== 'accurate') {
      // Leaving Accurate: stop the galactic drift and restore the orbit toggle.
      system.setDriftMode(false);
      state.showOrbits = orbitsBeforeAccurate;        // restore paths
      ui.lockOrbits(false);
      ui.setLive(false, '');
    }
    state.distanceMode = mode;
    systemRoot.position.set(0, 0, 0);
    system.setDistanceMode(mode);
    ui.setSpacecraftNavVisible(mode !== 'visual');   // craft only exist in the true-scale views

    // Zoom limits differ by orders of magnitude: the compressed view fits inside
    // ~1,000 units, while the true-scale views span from a sub-unit moon up close
    // to dwarf planets millions of units out.
    const trueScale = (mode !== 'visual');
    // Far enough to dolly out and take in the Voyagers (~170+ AU ≈ 6.4M units),
    // yet still well inside the foreground starfield (~1.3e7) and sky (2e7).
    setDefaultCameraLimits();

    if (mode === 'accurate') {
      if (!wasAccurate) orbitsBeforeAccurate = state.showOrbits;
      state.showOrbits = false;                        // orbit paths off in the accurate view
      applyVisibility();
      ui.lockOrbits(true);
      ui.setLive(true, t('distHintAccurate'));
      state.simDays = daysSinceJ2000(new Date());      // start at the real "now"
      state.paused = false; ui.setPaused(false);
      system.setDriftMode(true, state.simDays);
      system.update(state.simDays);
      // Frame the inner system, then ride along with the drifting Sun.
      stopFollow(); focusAnim.active = false;
      controls.target.copy(system.sunMesh.position);
      camera.position.copy(system.sunMesh.position).add(TRUE_VIEW);
      followObj = system.sunMesh;                      // camera rides along with the drifting Sun
      state.following = true;
      system.sunMesh.getWorldPosition(followPrev);
      ui.setFollowing(true);
    } else {
      applyVisibility();
      system.update(state.simDays);
      // Reframe the viewpoint for the chosen scale (the two regimes are far too
      // different in size to share a camera position).
      stopFollow(); focusAnim.active = false;
      controls.target.set(0, 0, 0);
      camera.position.copy(trueScale ? TRUE_VIEW : HOME_POS);
      ui.setLive(false, trueScale ? t('distHintRealistic') : '');
    }
  },
  setBloom(on) { state.bloom = on; persistAndShare('bloom', on); },
  selectById(id) {
    const blackHoleData = blackHoleById(id);
    if (blackHoleData) { selectBlackHole(blackHoleData, false); return; }
    const obj = findObjectById(id);
    if (obj) onPick(obj.userData, obj, false);
  },
  focusById(id) {
    const blackHoleData = blackHoleById(id);
    if (blackHoleData) { selectBlackHole(blackHoleData, true); return; }
    const obj = findObjectById(id);
    if (obj) onPick(obj.userData, obj, true);
  },
  focusSelected() {
    if (!state.selected) return;
    if (state.selected.kind === 'black-hole') enterBlackHoleView(state.selected.ref);
    else focusOn(state.selected.object3D);
  },
  stopFollow,
  resetView() {
    if (blackHole.isActive()) { blackHole.resetView(); return; }
    focusAnim.active = false;
    systemRoot.position.set(0, 0, 0);
    setDefaultCameraLimits();
    if (state.distanceMode === 'accurate') {
      // Re-frame the drifting Sun and keep riding along with it.
      controls.target.copy(system.sunMesh.position);
      camera.position.copy(system.sunMesh.position).add(TRUE_VIEW);
      followObj = system.sunMesh;
      state.following = true;
      system.sunMesh.getWorldPosition(followPrev);
      ui.setFollowing(true);
    } else {
      stopFollow();
      controls.target.set(0, 0, 0);
      camera.position.copy(state.distanceMode === 'visual' ? HOME_POS : TRUE_VIEW);
    }
  },
};

function findObjectById(id) {
  for (const m of system.selectable) {
    const ud = m.userData;
    if (ud.ref && ud.ref.id === id) return m;
  }
  return null;
}

const ui = initUI(controller);
// FPS readout is a debug aid — only shown when the link carries dbg=1.
if (!linkState.debug) {
  const fpsEl = document.getElementById('hud-fps');
  if (fpsEl) fpsEl.style.display = 'none';
}
applyStaticTranslations();   // render all data-i18n chrome strings for LANG
ui.showInfo(SUN, 'sun');   // start by describing the Sun

// ---------------------------------------------------------------------------
//  Eclipse modes (solar / lunar)
// ---------------------------------------------------------------------------
// The eclipse rig (its own Sun/Earth/Moon meshes, shadow cones, POV canvas)
// is only needed once the user actually opens an eclipse view, so the whole
// module instance is created lazily on first enter(). THREE.Cache already
// holds every texture it wants, so the deferred build is near-instant.
let eclipseRig = null;
function ensureEclipseRig() {
  eclipseRig ??= createEclipse({
    scene, camera, controls,
    getSimDays: () => state.simDays,
    // Jumping to a real catalog event also aims the master clock at it, so the
    // orrery shows the true Sun–Moon–Earth alignment on exit. Pause: the moment
    // should not drift away while the user studies it.
    setSimDays: (d) => { state.simDays = d; state.paused = true; ui.setPaused(true); },
    onEnter: () => { stopFollow(); setOrreryVisible(false); },
    onExit: () => { setOrreryVisible(true); },
  });
  return eclipseRig;
}
const eclipse = {
  isActive: () => eclipseRig?.isActive() ?? false,
  enter: (kind) => ensureEclipseRig().enter(kind),
  exit: () => eclipseRig?.exit(),
  update: (dt) => eclipseRig?.update(dt),
  togglePlay: () => eclipseRig?.togglePlay(),
};

const blackHoleData = BLACK_HOLES[0];
const blackHoleLogical = interstellarScenePosition(blackHoleData, CONFIG.DIST_REAL_K);
const blackHoleAbsolute = new THREE.Vector3(...blackHoleLogical.positionScene);
const blackHoleRenderAnchor = blackHoleAbsolute.clone();
const blackHoleDistanceLabel = Number.isFinite(blackHoleLogical.distanceUncertaintyPc)
  ? `${blackHoleLogical.distancePc.toFixed(2)} ± ${blackHoleLogical.distanceUncertaintyPc.toFixed(2)} pc · ${t('evidenceDerived')}`
  : `${blackHoleLogical.distancePc.toFixed(2)} pc · ${t('evidenceDerived')}`;

const blackHole = createBlackHoleView({
  renderer, scene, camera, controls, loader,
  data: blackHoleData,
  sceneUnitsPerAU: CONFIG.DIST_REAL_K,
  logicalPosition: blackHoleLogical,
  getSimDays: () => state.simDays,
  tr: t,
  onEnter: () => { stopFollow(); },
  onExit: () => {
    interstellarTravel.cancel();
    systemRoot.position.set(0, 0, 0);
    blackHole.setRenderAnchor(blackHoleAbsolute);
    setOrreryVisible(true);
  },
});

const interstellarTravel = createInterstellarTravel({
  camera, controls, systemRoot, blackHole,
  absolute: blackHoleAbsolute,
  renderAnchor: blackHoleRenderAnchor,
  logical: blackHoleLogical,
  distanceLabel: blackHoleDistanceLabel,
  config: CONFIG,
  reducedMotion: REDUCED_MOTION,
});

function enterBlackHoleView(data = blackHoleData) {
  if (!data || data.id !== blackHoleData?.id) return;
  if (eclipse.isActive()) eclipse.exit();
  // Interstellar placement only has a meaningful common ruler in true-scale
  // mode. The selector is synchronized because this is an explicit mode change.
  if (state.distanceMode !== 'realistic') {
    controller.setDistanceMode('realistic');
    const distanceSelect = document.getElementById('dist-mode');
    if (distanceSelect) distanceSelect.value = 'realistic';
  }
  blackHole.enter('overview', { deferCamera: true });
  interstellarTravel.begin();
}

function enterEclipse(kind) {
  if (blackHole.isActive()) blackHole.exit();
  eclipse.enter(kind);
}

const eclBtn = document.getElementById('btn-eclipse');
const eclMenu = document.getElementById('eclipse-menu');
eclBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  eclMenu.classList.toggle('hidden');
  eclBtn.classList.toggle('active', !eclMenu.classList.contains('hidden'));
});
document.getElementById('ecl-go-solar').addEventListener('click', () => { eclMenu.classList.add('hidden'); eclBtn.classList.remove('active'); enterEclipse('solar'); });
document.getElementById('ecl-go-lunar').addEventListener('click', () => { eclMenu.classList.add('hidden'); eclBtn.classList.remove('active'); enterEclipse('lunar'); });
document.addEventListener('pointerdown', (e) => {
  if (!eclMenu.classList.contains('hidden') && !eclMenu.contains(e.target) && e.target !== eclBtn) {
    eclMenu.classList.add('hidden'); eclBtn.classList.remove('active');
  }
}, true);

// ---------------------------------------------------------------------------
//  Mobile overflow (⋯) menu — reparents the topbar actions on narrow screens
// ---------------------------------------------------------------------------
// appendChild moves the live elements, so every existing listener survives.
{
  const moreBtn = document.getElementById('btn-more');
  const moreMenu = document.getElementById('more-menu');
  const hud = document.getElementById('hud');
  const collapsible = ['btn-eclipse', 'btn-view', 'btn-share', 'btn-shot', 'btn-help', 'btn-reset-view']
    .map((id) => document.getElementById(id)).filter(Boolean);
  const closeMore = () => {
    moreMenu.classList.add('hidden');
    moreBtn.classList.remove('active');
    moreBtn.setAttribute('aria-expanded', 'false');
  };
  const narrow = matchMedia('(max-width: 700px)');
  const applyMore = () => {
    if (narrow.matches) {
      collapsible.forEach((b) => moreMenu.appendChild(b));
      moreBtn.hidden = false;
    } else {
      collapsible.forEach((b) => hud.insertBefore(b, moreBtn));
      moreBtn.hidden = true;
      closeMore();
    }
  };
  narrow.addEventListener('change', applyMore);
  applyMore();
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = moreMenu.classList.toggle('hidden') === false;
    moreBtn.classList.toggle('active', open);
    moreBtn.setAttribute('aria-expanded', String(open));
  });
  // Any action chosen from the menu closes it; so does tapping elsewhere.
  moreMenu.addEventListener('click', (e) => { if (e.target.closest('button')) closeMore(); });
  document.addEventListener('pointerdown', (e) => {
    if (!moreMenu.classList.contains('hidden') && !moreMenu.contains(e.target) && e.target !== moreBtn) {
      closeMore();
    }
  }, true);
}

// ---------------------------------------------------------------------------
//  Share link & screenshot
// ---------------------------------------------------------------------------
// Both live in the topbar, which every special mode (eclipse / black hole /
// fullscreen) hides — so they only ever act on the plain orrery view.
const shareBtn = document.getElementById('btn-share');
if (shareBtn) {
  const shareIco = shareBtn.querySelector('.btn-ico') ?? shareBtn;
  let shareTimer = null;
  shareBtn.addEventListener('click', async () => {
    const hash = '#' + serializeState(state, state.selected?.ref?.id ?? null);
    window.history.replaceState(null, '', hash);
    const url = location.origin + location.pathname + hash;
    let copied = true;
    try { await navigator.clipboard.writeText(url); } catch { copied = false; }
    shareIco.textContent = copied ? t('shareCopied') : t('shareFailed');
    clearTimeout(shareTimer);
    shareTimer = setTimeout(() => { shareIco.textContent = '🔗'; }, 1800);
  });
}

const shotBtn = document.getElementById('btn-shot');
if (shotBtn) {
  shotBtn.addEventListener('click', () => {
    if (blackHole.isActive()) return;
    // Render on demand right before the copy, so the WebGL back buffer is
    // guaranteed fresh without keeping preserveDrawingBuffer on all session.
    renderFrame();
    const src = renderer.domElement;
    const out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const g = out.getContext('2d');
    g.drawImage(src, 0, 0);
    const date = j2000DaysToDate(state.simDays);
    const caption = `${state.selected?.ref?.name ?? t('brandTitle')} — ` +
      `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    const fontPx = Math.max(14, Math.round(out.width / 90));
    const pad = Math.max(12, Math.round(out.width * 0.012));
    g.font = `600 ${fontPx}px Inter, system-ui, sans-serif`;
    g.textBaseline = 'bottom';
    g.fillStyle = 'rgba(2,6,14,.62)';
    g.fillRect(pad - 8, out.height - pad - fontPx - 12, g.measureText(caption).width + 16, fontPx + 16);
    g.fillStyle = '#eaf2ff';
    g.fillText(caption, pad, out.height - pad - 2);
    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `solar-system-${date.toISOString().slice(0, 10)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  });
}

// The clickable Gaia BH1 marker (js/blackhole-locator.js): a projected DOM
// proxy for the necessarily sub-pixel Float64 catalogue position.
const blackHoleLocator = createBlackHoleLocator({
  camera,
  data: blackHoleData,
  distanceLabel: blackHoleDistanceLabel,
  onSelect: (data, focus) => selectBlackHole(data, focus),
  isHidden: () => eclipse.isActive() || blackHole.isActive()
    || !state.showLabels || !state.showBlackHoles,
});

// ---------------------------------------------------------------------------
//  Resize
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  postfx.setSize(w, h);
  system.setStarPixelRatio(Math.min(window.devicePixelRatio, 2));
  labelRenderer.setSize(w, h);
  blackHole.resize(w, h);
});

// ---------------------------------------------------------------------------
//  Keyboard shortcuts
// ---------------------------------------------------------------------------
// Keys currently held, used to "fly" the viewpoint through space each frame.
const pressed = new Set();
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

window.addEventListener('keydown', (e) => {
  // Broad guard: typing fields and editable regions own their keys entirely.
  if (e.target.closest?.('input, select, textarea, [contenteditable]')) return;
  if (e.code === 'Space') {
    // A focused button handles Space natively — don't double-fire.
    if (e.target.closest?.('button')) return;
    e.preventDefault();
    if (eclipse.isActive()) eclipse.togglePlay();
    else { state.paused = !state.paused; ui.setPaused(state.paused); controller.togglePause(state.paused); }
    return;
  }
  if (e.code === 'Escape') {
    // Priority: help dialog → popovers → modes → follow.
    const helpPanel = document.getElementById('help-panel');
    if (helpPanel && !helpPanel.classList.contains('hidden')) {
      helpPanel.classList.add('hidden');
      document.getElementById('btn-help')?.focus();
      return;
    }
    for (const id of ['toggles', 'eclipse-menu', 'more-menu']) {
      const panel = document.getElementById(id);
      if (panel && !panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
    }
    if (blackHole.isActive()) blackHole.exit();
    else if (eclipse.isActive()) eclipse.exit();
    else stopFollow();
    return;
  }
  if (!blackHole.isActive() && !eclipse.isActive()) {
    if (e.key === '/') {
      e.preventDefault();
      document.getElementById('nav-search')?.focus();
      return;
    }
    if (e.key === '?') { document.getElementById('help-panel')?.classList.toggle('hidden'); return; }
    if (e.code === 'KeyL') { controller.setToggle('showLabels', !state.showLabels); ui.syncToggle?.('tg-labels', state.showLabels); return; }
    if (e.code === 'KeyO') { controller.setToggle('showOrbits', !state.showOrbits); ui.syncToggle?.('tg-orbits', state.showOrbits); return; }
    if (e.code === 'KeyM') { controller.setToggle('showMoons', !state.showMoons); ui.syncToggle?.('tg-moons', state.showMoons); return; }
    if (e.key === '[') { controller.setSpeed(Math.max(1 / 86400, state.speed / 2)); ui.refreshSpeedUi?.(); return; }
    if (e.key === ']') { controller.setSpeed(Math.min(3650, state.speed * 2)); ui.refreshSpeedUi?.(); return; }
    if (e.key === ',') { state.simDays -= 1; return; }
    if (e.key === '.') { state.simDays += 1; return; }
    if (e.key === '0') { controller.resetView?.(); return; }
  }
  if (MOVE_KEYS.has(e.code)) {
    e.preventDefault();
    if (blackHole.isActive()) return;
    pressed.add(e.code);
    if (state.following) stopFollow();   // manual control takes over from follow
  }
});
window.addEventListener('keyup', (e) => pressed.delete(e.code));
window.addEventListener('blur', () => pressed.clear());

// Translate camera + orbit target together → flies the viewpoint through space.
const _fwd = new THREE.Vector3(), _rgt = new THREE.Vector3();
const _wup = new THREE.Vector3(0, 1, 0), _mv = new THREE.Vector3();
function applyKeyboardMove(dt) {
  if (pressed.size === 0) return;
  _fwd.subVectors(controls.target, camera.position);
  const dist = _fwd.length() || 1;
  _fwd.normalize();
  _rgt.crossVectors(_fwd, _wup).normalize();
  _mv.set(0, 0, 0);
  const k = (a, b) => pressed.has(a) || pressed.has(b);
  if (k('KeyW', 'ArrowUp')) _mv.add(_fwd);
  if (k('KeyS', 'ArrowDown')) _mv.addScaledVector(_fwd, -1);
  if (k('KeyD', 'ArrowRight')) _mv.add(_rgt);
  if (k('KeyA', 'ArrowLeft')) _mv.addScaledVector(_rgt, -1);
  if (pressed.has('KeyR')) _mv.add(_wup);
  if (pressed.has('KeyF')) _mv.addScaledVector(_wup, -1);
  if (_mv.lengthSq() === 0) return;
  _mv.normalize().multiplyScalar(dist * 0.9 * dt);   // speed scales with zoom level
  camera.position.add(_mv);
  controls.target.add(_mv);
}

// ---------------------------------------------------------------------------
//  Animation loop
// ---------------------------------------------------------------------------
// Debug / power-user hook: inspect from the browser console (e.g. SOLAR.state).
// ---------------------------------------------------------------------------
//  PWA: service worker + downloadable offline pack
// ---------------------------------------------------------------------------
const swSupported = 'serviceWorker' in navigator &&
  (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname));
if (swSupported) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed:', err));
  });
}
{
  const offlineBtn = document.getElementById('btn-offline');
  const offlineStatus = document.getElementById('offline-status');
  if (offlineBtn && !swSupported) {
    offlineBtn.disabled = true;
    offlineBtn.textContent = '—';
    if (offlineStatus) offlineStatus.textContent = t('offlineUnsupported');
  } else if (offlineBtn) {
    import('./offline_manifest.js').then(({ OFFLINE_ASSETS, OFFLINE_TOTAL_BYTES }) => {
      offlineBtn.textContent =
        t('offlineDownload').replace('{mb}', String(Math.round(OFFLINE_TOTAL_BYTES / 1048576)));
      let running = false;
      offlineBtn.addEventListener('click', async () => {
        if (running) return;
        running = true;
        offlineBtn.disabled = true;
        try {
          await navigator.serviceWorker.ready;   // the SW caches whatever we fetch
          let done = 0;
          const queue = [...OFFLINE_ASSETS];
          const worker = async () => {
            for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
              const res = await fetch(path);
              if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
              await res.blob();
              done += 1;
              if (offlineStatus && (done % 3 === 0 || done === OFFLINE_ASSETS.length)) {
                offlineStatus.textContent = t('offlineProgress')
                  .replace('{done}', String(done)).replace('{total}', String(OFFLINE_ASSETS.length));
              }
            }
          };
          await Promise.all([worker(), worker(), worker(), worker()]);
          if (offlineStatus) offlineStatus.textContent = t('offlineDone');
        } catch (err) {
          console.warn('Offline pack failed:', err);
          if (offlineStatus) offlineStatus.textContent = t('offlineFail');
        } finally {
          running = false;
          offlineBtn.disabled = false;
        }
      });
    });
  }
}

window.SOLAR = {
  THREE, scene, systemRoot, camera, controls, system, state, controller,
  eclipse, blackHole,
  // Debug hook: wipe every service-worker cache (then hard-reload).
  clearCaches: () => caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))),
  gaiaBh1: {
    logical: blackHoleLogical,
    absoluteScenePosition: blackHoleAbsolute,
    renderOrigin: interstellarTravel.worldOrigin,
    travel: interstellarTravel,
  },
};

const clock = new THREE.Clock();
let frames = 0, fpsT = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  // Gaia BH1 owns the frame while active. During transit the Solar System and
  // binary retain their true Float64 separation while a floating render origin
  // follows the camera; the shared date controls still drive observed phase.
  if (blackHole.isActive()) {
    if (!state.paused) state.simDays += dt * state.speed * state.direction;
    if (interstellarTravel.active) system.update(state.simDays);
    interstellarTravel.update();
    blackHoleLocator.update();
    // The local binary overview reuses the inertial backdrop. Keep its shells
    // centred even if the Solar-System root had previously been rebased around
    // Voyager or displaced by Accurate-mode galactic drift.
    system.sky.position.copy(camera.position).sub(systemRoot.position);
    system.stars.position.copy(camera.position).sub(systemRoot.position);
    blackHole.update(dt, state.simDays);
    frames++; fpsT += dt;
    if (fpsT >= 0.25) {
      ui.setHUD({
        date: j2000DaysToDate(state.simDays),
        fps: Math.round(frames / fpsT),
        following: '',
      });
      frames = 0; fpsT = 0;
    }
    return;
  }

  applyKeyboardMove(dt);   // WASD / arrow-key fly-through in the orrery

  // Eclipse mode runs its own simulation; the orrery is hidden.
  if (eclipse.isActive()) {
    blackHoleLocator.update();
    eclipse.update(dt);
    controls.update();
    system.sky.position.copy(camera.position).sub(systemRoot.position);
    system.stars.position.copy(camera.position).sub(systemRoot.position);
    renderFrame();
    labelRenderer.render(scene, camera);
    return;
  }

  if (!state.paused) state.simDays += dt * state.speed * state.direction;
  system.update(state.simDays);

  const followingSpacecraft = state.following && followObj?.userData?.kind === 'spacecraft';
  if (followingSpacecraft) {
    // Voyager continues moving even while focused. Rebase every frame so it stays
    // at a numerically stable origin at real-time and accelerated simulation rates.
    // The initial focus rebase shifts camera + world together to avoid a visual
    // jump. Here the world alone follows the moving craft; shifting the camera
    // too would count Voyager's motion twice and drift the aim off target.
    rebaseAround(followObj, false);
    followPrev.set(0, 0, 0);
  }

  // Camera focus animation (wall-clock driven, so it is frame-rate independent)
  if (focusAnim.active) {
    const k = Math.min(1, (performance.now() - focusAnim.start) / (focusAnim.dur * 1000));
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // ease in-out
    // recompute live target AND destination (body keeps moving during the transition)
    bodyWorldPos(followObj, focusAnim.toTgt);
    focusAnim.toPos.copy(focusAnim.toTgt).add(tmpV.copy(focusAnim.storedDir).multiplyScalar(focusAnim.storedDist));
    camera.position.lerpVectors(focusAnim.fromPos, focusAnim.toPos, e);
    controls.target.lerpVectors(focusAnim.fromTgt, focusAnim.toTgt, e);
    if (k >= 1) { focusAnim.active = false; bodyWorldPos(followObj, followPrev); }
  } else if (state.following && followObj && !followingSpacecraft) {
    // rigidly track the body's motion while preserving manual orbit
    bodyWorldPos(followObj, tmpV);
    const dx = tmpV.x - followPrev.x, dy = tmpV.y - followPrev.y, dz = tmpV.z - followPrev.z;
    camera.position.x += dx; camera.position.y += dy; camera.position.z += dz;
    controls.target.x += dx; controls.target.y += dy; controls.target.z += dz;
    followPrev.copy(tmpV);
  }

  controls.update();
  blackHoleLocator.update();
  system.orientVoyagers();   // physical mesh scale is fixed; only aim its dish
  // Backdrop objects are children of the movable system root, so express the
  // camera position in that root's local coordinates.
  system.sky.position.copy(camera.position).sub(systemRoot.position);
  system.stars.position.copy(camera.position).sub(systemRoot.position);

  renderFrame();
  labelRenderer.render(scene, camera);

  // HUD updates (throttled)
  frames++; fpsT += dt;
  if (fpsT >= 0.25) {
    ui.setHUD({
      date: j2000DaysToDate(state.simDays),
      fps: Math.round(frames / fpsT),
      following: state.following ? (state.selected?.ref?.name || '') : '',
    });
    frames = 0; fpsT = 0;
  }
}
// Apply the saved / shared-link boot state now that the UI exists. The
// distance mode goes through the controller (camera framing, nav, hints)
// and the select element mirrors it like the black-hole entry path does.
if (bootDistanceMode !== 'visual') {
  controller.setDistanceMode(bootDistanceMode);
  const distanceSelect = document.getElementById('dist-mode');
  if (distanceSelect) distanceSelect.value = bootDistanceMode;
}
if (bootSelectedId) controller.selectById?.(bootSelectedId);
applyingLink = false;
scheduleHashWrite(state, state.selected?.ref?.id ?? null);

animate();

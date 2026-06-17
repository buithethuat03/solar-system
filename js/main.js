// ============================================================================
//  main.js  —  Renderer, camera, controls, post-processing & the sim loop.
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { buildSolarSystem } from './bodies.js';
import { daysSinceJ2000, j2000DaysToDate, voyagerState } from './kepler.js';
import { initUI } from './ui.js';
import { createEclipse } from './eclipse.js';
import { SUN, PLANETS, MOONS, VOYAGERS } from './data.js';
import { t, applyBodyTranslations, applyStaticTranslations, MONTHS } from './i18n.js';

// ---------------------------------------------------------------------------
//  Renderer / scene / camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
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
const state = {
  paused: false,
  speed: 1 / 86400,    // simulated days per real second (magnitude) — default real-time
  direction: 1,        // +1 forward, -1 reverse
  simDays: daysSinceJ2000(new Date()),
  showOrbits: true,
  showLabels: true,
  showBelts: true,
  showMoons: true,
  showDwarfs: true,
  showSpacecraft: true,
  distanceMode: 'visual',
  bloom: true,
  selected: null,      // { kind, ref, object3D }
  following: false,
};

// ---------------------------------------------------------------------------
//  Build the solar system
// ---------------------------------------------------------------------------
// Overlay Vietnamese onto the dataset (if selected) BEFORE building, so labels,
// the navigator and the info panel all pick up the translated names/text.
applyBodyTranslations(SUN, PLANETS, MOONS, VOYAGERS);
const system = buildSolarSystem(scene, loader, onPick, state.distanceMode, TEX_RES);

// ---------------------------------------------------------------------------
//  Post-processing — SELECTIVE bloom: only the Sun (and the eclipse Sun) glow.
//  The bright Milky-Way sky and starfield must never bloom, regardless of the
//  "Sun glow" toggle. Objects tagged on BLOOM_LAYER keep their material in the
//  bloom pass; everything else is rendered black so it contributes no glow.
// ---------------------------------------------------------------------------
const BLOOM_LAYER = 1;
const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_LAYER);
const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
const savedMaterials = {};
function darkenNonBloomed(obj) {
  if ((obj.isMesh || obj.isPoints || obj.isSprite) && bloomLayer.test(obj.layers) === false) {
    savedMaterials[obj.uuid] = obj.material;
    obj.material = darkMaterial;
  }
}
function restoreMaterial(obj) {
  if (savedMaterials[obj.uuid]) { obj.material = savedMaterials[obj.uuid]; delete savedMaterials[obj.uuid]; }
}
// Tag the Sun and its corona/glow sprites so they are the only things that bloom.
system.sunMesh.traverse((o) => o.layers.enable(BLOOM_LAYER));

const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.95, 0.55, 0.82
);
const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(renderScene);
bloomComposer.addPass(bloomPass);

const mixPass = new ShaderPass(new THREE.ShaderMaterial({
  uniforms: { baseTexture: { value: null }, bloomTexture: { value: bloomComposer.renderTarget2.texture } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv;
    void main(){ gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv); }`,
}), 'baseTexture');
mixPass.needsSwap = true;

const finalComposer = new EffectComposer(renderer);
finalComposer.addPass(renderScene);
finalComposer.addPass(mixPass);
finalComposer.addPass(new OutputPass());

// Render one frame: selective bloom when enabled, else a plain render.
function renderFrame() {
  if (state.bloom) {
    scene.traverse(darkenNonBloomed);
    bloomComposer.render();
    scene.traverse(restoreMaterial);
    finalComposer.render();
  } else {
    renderer.render(scene, camera);
  }
}

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
  if (eclipse.isActive()) return;
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
  ui.showInfo(ref, userData.kind);
  ui.highlight(userData.ref.id);
  if (focus) focusOn(target);
  // A single click only inspects a body — it must not stay in follow mode. If we
  // were following another body, leave follow so the UI reflects "not following".
  else if (state.following) stopFollow();
}

// ---------------------------------------------------------------------------
//  Camera focus & follow
// ---------------------------------------------------------------------------
const focusAnim = { active: false, start: 0, dur: 1.1, storedDir: new THREE.Vector3(), storedDist: 0, fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(), fromTgt: new THREE.Vector3(), toTgt: new THREE.Vector3() };
const followPrev = new THREE.Vector3();
let followObj = null;
const tmpV = new THREE.Vector3();

function bodyWorldPos(object3D, out) {
  object3D.getWorldPosition(out);
  return out;
}
function bodyRadius(object3D) {
  object3D.geometry?.computeBoundingSphere?.();
  return (object3D.geometry?.boundingSphere?.radius || 5) * object3D.getWorldScale(tmpV).x;
}

function focusOn(object3D) {
  if (!object3D) return;
  // Never fly to a hidden spacecraft (e.g. nav-clicked in the compressed view, or
  // with the Spacecraft toggle off) — its true position is millions of units away
  // and the focus animation bypasses the zoom limit, which would strand the camera.
  if (object3D.userData?.kind === 'spacecraft' &&
      !(state.showSpacecraft && state.distanceMode !== 'visual')) return;
  const target = bodyWorldPos(object3D, new THREE.Vector3());
  // Voyagers carry an explicit focusRadius: their visible model is a screen-relative
  // gizmo, so a geometry-derived radius would be camera-dependent and unstable.
  const r = object3D.userData?.focusRadius ?? bodyRadius(object3D);
  // Frame the body at ~5.5 radii. A small floor (not the old fixed 8) lets tiny
  // bodies be inspected up close in the true-scale view, where they are specks.
  const dist = Math.max(r * 5.5, 0.5);
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
  for (const v of system.voyagers) { v.baseVisible = showCraft; v.group.visible = showCraft; }

  for (const l of system.labels) {
    let vis = state.showLabels;
    if (l.type === 'moon') vis = vis && state.showMoons;
    if (l.type === 'dwarf') vis = vis && state.showDwarfs;
    if (l.type === 'spacecraft') vis = vis && showCraft;
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
  bodies: { sun: SUN, planets: PLANETS, moons: MOONS, voyagers: VOYAGERS },
  togglePause(p) { state.paused = p; },
  setSpeed(v) { state.speed = v; },
  setDirection(d) { state.direction = d; },
  goToNow() { state.simDays = daysSinceJ2000(new Date()); },
  setDate(date) { state.simDays = daysSinceJ2000(date); },
  setToggle(key, val) { state[key] = val; applyVisibility(); },
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
    system.setDistanceMode(mode);
    ui.setSpacecraftNavVisible(mode !== 'visual');   // craft only exist in the true-scale views

    // Zoom limits differ by orders of magnitude: the compressed view fits inside
    // ~1,000 units, while the true-scale views span from a sub-unit moon up close
    // to dwarf planets millions of units out.
    const trueScale = (mode !== 'visual');
    controls.minDistance = trueScale ? 0.05 : 3;
    // Far enough to dolly out and take in the Voyagers (~170+ AU ≈ 6.4M units),
    // yet still well inside the foreground starfield (~1.3e7) and sky (2e7).
    controls.maxDistance = trueScale ? 1.0e7 : 14000;

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
  setBloom(on) { state.bloom = on; },
  selectById(id) {
    const obj = findObjectById(id);
    if (obj) onPick(obj.userData, obj, false);
  },
  focusById(id) {
    const obj = findObjectById(id);
    if (obj) onPick(obj.userData, obj, true);
  },
  focusSelected() { if (state.selected) focusOn(state.selected.object3D); },
  stopFollow,
  resetView() {
    focusAnim.active = false;
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
applyStaticTranslations();   // translate the static HTML chrome (no-op in English)
ui.showInfo(SUN, 'sun');   // start by describing the Sun
const creditsEl = document.getElementById('credits');
if (creditsEl) creditsEl.textContent = t('credits');

// ---------------------------------------------------------------------------
//  Eclipse modes (solar / lunar)
// ---------------------------------------------------------------------------
const eclipse = createEclipse({
  scene, camera, controls,
  onEnter: () => { stopFollow(); setOrreryVisible(false); },
  onExit: () => { setOrreryVisible(true); },
});

const eclBtn = document.getElementById('btn-eclipse');
const eclMenu = document.getElementById('eclipse-menu');
eclBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  eclMenu.classList.toggle('hidden');
  eclBtn.classList.toggle('active', !eclMenu.classList.contains('hidden'));
});
document.getElementById('ecl-go-solar').addEventListener('click', () => { eclMenu.classList.add('hidden'); eclBtn.classList.remove('active'); eclipse.enter('solar'); });
document.getElementById('ecl-go-lunar').addEventListener('click', () => { eclMenu.classList.add('hidden'); eclBtn.classList.remove('active'); eclipse.enter('lunar'); });
document.addEventListener('pointerdown', (e) => {
  if (!eclMenu.classList.contains('hidden') && !eclMenu.contains(e.target) && e.target !== eclBtn) {
    eclMenu.classList.add('hidden'); eclBtn.classList.remove('active');
  }
}, true);

// ---------------------------------------------------------------------------
//  Resize
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  bloomComposer.setSize(w, h);
  finalComposer.setSize(w, h);
  labelRenderer.setSize(w, h);
  bloomPass.resolution.set(w, h);
});

// ---------------------------------------------------------------------------
//  Keyboard shortcuts
// ---------------------------------------------------------------------------
// Keys currently held, used to "fly" the viewpoint through space each frame.
const pressed = new Set();
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (eclipse.isActive()) eclipse.togglePlay();
    else { state.paused = !state.paused; ui.setPaused(state.paused); }
    return;
  }
  if (e.code === 'Escape') {
    if (eclipse.isActive()) eclipse.exit(); else stopFollow();
    return;
  }
  if (MOVE_KEYS.has(e.code)) {
    e.preventDefault();
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
window.SOLAR = { THREE, scene, camera, controls, system, state, controller, eclipse };

const clock = new THREE.Clock();
let frames = 0, fpsT = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  applyKeyboardMove(dt);   // WASD / arrow-key fly-through (works in both modes)
  system.sky.position.copy(camera.position);    // skybox follows the camera (always present)
  system.stars.position.copy(camera.position);

  // Eclipse mode runs its own simulation; the orrery is hidden.
  if (eclipse.isActive()) {
    eclipse.update(dt);
    controls.update();
    renderFrame();
    labelRenderer.render(scene, camera);
    return;
  }

  if (!state.paused) state.simDays += dt * state.speed * state.direction;
  system.update(state.simDays);

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
  } else if (state.following && followObj) {
    // rigidly track the body's motion while preserving manual orbit
    bodyWorldPos(followObj, tmpV);
    const dx = tmpV.x - followPrev.x, dy = tmpV.y - followPrev.y, dz = tmpV.z - followPrev.z;
    camera.position.x += dx; camera.position.y += dy; camera.position.z += dz;
    controls.target.x += dx; controls.target.y += dy; controls.target.z += dz;
    followPrev.copy(tmpV);
  }

  controls.update();
  system.scaleVoyagersToCamera(camera);   // keep the craft a sensible on-screen size

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
animate();

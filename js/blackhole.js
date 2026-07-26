// ============================================================================
//  blackhole.js — Gaia BH1 true-scale binary and Schwarzschild lensing view.
//
//  The close-up is a finite-observer null-geodesic lookup, not a radial image
//  distortion. It deliberately contains no accretion disc, jet, emissive black
//  hole, or painted photon ring: brightness near the critical curve comes only
//  from rays that reach the Gaia sky map or the real companion star.
// ============================================================================
import * as THREE from 'three';
import * as Physics from './blackhole-physics.js';
import {
  LUT_WIDTH,
  LUT_HEIGHT,
  LUT_R_MIN,
  LUT_R_MAX,
  LUT_SAMPLE_MIN,
  LUT_SAMPLE_SPLIT,
  LUT_LOOKUP_SPLIT,
  CRITICAL_IMPACT_OVER_M,
  DISK_LUT_WIDTH,
  DISK_LUT_HEIGHT,
} from './blackhole-lut-constants.js';
import {
  FULLSCREEN_VERTEX,
  BACKDROP_VERTEX,
  DISK_BLACKBODY_MIN_K,
  DISK_BLACKBODY_MAX_K,
  buildLensingFragment,
  buildCompositeFragment,
  buildDownsampleFragment,
  buildUpsampleFragment,
  buildBackdropFragment,
} from './blackhole-shaders.js';

const J2000_JD = 2451545.0;
const AU_PER_SOLAR_RADIUS = 0.00465046726096;
const DEFAULT_OBSERVER_RADIUS_OVER_M = 30;
const CLOSEUP_FOV_DEG = 55;
// Planckian reference spectrum for the display-mapped sky's chromatic
// blueshift (~solar photosphere); the companion uses its own measured Teff.
const BLUESHIFT_REFERENCE_TEMPERATURE_K = 5800;
// The camera-centred Gaia backdrop sphere must sit inside the overview far
// plane, which in turn covers the 50 AU dolly limit (grep-locked by tests).
const BACKDROP_RADIUS_AU = 40;
const OVERVIEW_FAR_AU = 60;
// Labeled slow-motion clock for the illustrative disk's differential shear
// (the real ISCO period of 9.27 Msun is ~4.2 ms — invisible in real time).
// The relative Omega ~ r^-3/2 shear between radii stays exact.
const DISK_TIME_SCALE = 15;
// The table is centre-sampled, so interactive dolly stays inside its first and
// last physical rows instead of clamping an exact endpoint to a nearby row.
const OBSERVER_RADIUS_MIN_OVER_M = LUT_R_MIN + (LUT_R_MAX - LUT_R_MIN) * 0.5 / LUT_HEIGHT;
const OBSERVER_RADIUS_MAX_OVER_M = LUT_R_MAX - (LUT_R_MAX - LUT_R_MIN) * 0.5 / LUT_HEIGHT;
const GALACTIC_FROM_ICRS = Object.freeze([
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [ 0.4941094279, -0.4448296300,  0.7469822445],
  [-0.8676661490, -0.1980763734,  0.4559837762],
]);

function quantityValue(quantity, fallback = NaN) {
  const value = typeof quantity === 'number' ? quantity : quantity?.value;
  return Number.isFinite(value) ? value : fallback;
}

function asSystemData(data) {
  const system = Array.isArray(data) ? data[0] : data;
  if (!system || typeof system !== 'object') {
    throw new TypeError('createBlackHoleView requires a Gaia BH1 data object');
  }
  return system;
}

function simulationDaysToJulianDate(simDays) {
  return simDays > 1_000_000 ? simDays : J2000_JD + simDays;
}

function vectorFromArray(array, target = new THREE.Vector3()) {
  return target.set(array[0], array[1], array[2]);
}

function blackbodySrgb(temperatureK) {
  // Tanner Helland's common Planckian-locus approximation, used only for the
  // display colour. Temperature remains the measured input in the UI/data.
  const t = Math.max(1000, Math.min(40000, temperatureK)) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const clampByte = value => Math.max(0, Math.min(255, value)) / 255;
  return new THREE.Color().setRGB(
    clampByte(r), clampByte(g), clampByte(b), THREE.SRGBColorSpace,
  );
}

// Prebaked radial gradient for the companion's display-only glow sprites
// (the same pattern the orrery Sun uses; tinted via the sprite material).
function makeCompanionGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.2, 'rgba(255,244,224,0.65)');
  gradient.addColorStop(0.55, 'rgba(255,232,190,0.18)');
  gradient.addColorStop(1, 'rgba(255,224,160,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createReticleGeometry(radius = 4.5) {
  const positions = [];
  const segments = 64;
  for (let i = 0; i <= segments; i++) {
    const angle = i / segments * Math.PI * 2;
    positions.push(radius * Math.cos(angle), radius * Math.sin(angle), 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function makeSourceList(container, system, label, epochLabel) {
  const heading = document.createElement('h3');
  heading.textContent = label;
  const epoch = document.createElement('p');
  epoch.className = 'bh-source-epoch';
  epoch.textContent = epochLabel;
  const list = document.createElement('ul');
  for (const source of system.sources || []) {
    const item = document.createElement('li');
    const anchor = document.createElement('a');
    anchor.href = source.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = source.title || source.citation || source.id;
    const metadata = document.createElement('small');
    const details = [];
    if (source.citation) details.push(source.citation);
    if (source.doi) details.push(`DOI ${source.doi}`);
    metadata.textContent = details.join(' · ');
    item.append(anchor, metadata);
    list.appendChild(item);
  }
  const esaItem = document.createElement('li');
  const esaAnchor = document.createElement('a');
  esaAnchor.href = 'https://www.esa.int/ESA_Multimedia/Images/2018/04/Gaia_s_sky_in_colour2';
  esaAnchor.target = '_blank';
  esaAnchor.rel = 'noopener noreferrer';
  esaAnchor.textContent = "Gaia's sky in colour";
  const esaMetadata = document.createElement('small');
  esaMetadata.textContent = 'ESA/Gaia/DPAC · display-mapped reference sky';
  esaItem.append(esaAnchor, esaMetadata);
  list.appendChild(esaItem);
  container.append(heading, epoch, list);
}

export function createBlackHoleView(ctx) {
  const {
    renderer,
    scene,
    camera,
    controls,
    onEnter,
    onExit,
  } = ctx;
  if (!renderer || !scene || !camera || !controls) {
    throw new TypeError('createBlackHoleView requires renderer, scene, camera, and controls');
  }

  const data = asSystemData(ctx.data);
  const textureLoader = ctx.loader || new THREE.TextureLoader();
  const derived = Physics.deriveBlackHoleSystem(data);
  const schwarzschild = derived.schwarzschild
    || Physics.schwarzschildDerived(data.blackHole?.massSolar ?? data.massSolar);
  const sceneUnitsPerAU = quantityValue(ctx.sceneUnitsPerAU);
  if (!(sceneUnitsPerAU > 0)) {
    throw new TypeError('createBlackHoleView requires the true-scale sceneUnitsPerAU');
  }
  const gravitationalRadiusScene = schwarzschild.gravitationalRadiusM
    / Physics.METRES_PER_AU * sceneUnitsPerAU;
  const horizonRadiusScene = schwarzschild.eventHorizonRadiusM
    / Physics.METRES_PER_AU * sceneUnitsPerAU;
  const closeupObserverRadiusScene = DEFAULT_OBSERVER_RADIUS_OVER_M * gravitationalRadiusScene;
  const overviewCameraOffset = new THREE.Vector3(280, 330, 690)
    .multiplyScalar(sceneUnitsPerAU / 240);
  const logicalPosition = ctx.logicalPosition || null;
  const tr = typeof ctx.tr === 'function' ? ctx.tr : null;
  const message = (key, fallback) => {
    if (!tr) return fallback;
    const translated = tr(key);
    return translated && translated !== key ? translated : fallback;
  };

  let active = false;
  let mode = 'overview';
  let disposed = false;
  let currentSimDays = Number.isFinite(ctx.getSimDays?.()) ? ctx.getSimDays() : 0;
  let orbitState = Physics.binaryOrbitState(data, simulationDaysToJulianDate(currentSimDays));
  let activePreset = 'earth';
  let observerRadiusOverM = DEFAULT_OBSERVER_RADIUS_OVER_M;
  let viewportWidth = Math.max(1, renderer.domElement.clientWidth || window.innerWidth);
  let viewportHeight = Math.max(1, renderer.domElement.clientHeight || window.innerHeight);
  let qualityMode = 'auto';
  let adaptiveScale = 1;
  let qualityFrameCount = 0;
  let qualityTime = 0;
  let upscaleCrisp = false;
  let fallbackDirty = true;
  let fallbackLastRender = 0;
  let fallbackActive = false;
  let fallbackReason = '';
  let assetsPromise = null;
  let assetState = null;
  let skyTexturePromise = null;
  let sharedSkyTexture = null;
  let closeupGpu = null;
  let closeupTarget = null;
  let closeupHdr = false;
  let targetWidth = 0;
  let targetHeight = 0;
  let diskEnabled = false;
  try {
    diskEnabled = localStorage.getItem('solar.bhDisk') === '1';
  } catch { /* private-mode storage stays off */ }
  let diskAssetsPromise = null;
  let diskState = null;

  const saved = {
    valid: false,
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    up: new THREE.Vector3(),
    target: new THREE.Vector3(),
    clearColor: new THREE.Color(),
  };

  // --------------------------------------------------------------------- UI
  const ui = document.createElement('div');
  ui.className = 'bh-ui';
  ui.id = 'bh-ui';
  ui.setAttribute('role', 'region');
  ui.setAttribute('aria-label', message('bhViewTitle', 'Gaia BH1 relativistic view'));
  ui.innerHTML = `
    <canvas class="bh-fallback" id="bh-fallback" hidden aria-label="${message('bhWebglFallback', 'Scientifically computed static fallback')}"></canvas>
    <header class="bh-top">
      <div class="bh-title">
        <h2>${data.name || 'Gaia BH1'}</h2>
        <p>${message('bhViewSubtitle', 'Detached binary · Schwarzschild close-up')}</p>
      </div>
      <button class="bh-exit" id="bh-exit" type="button">${message('bhExit', 'Exit')}</button>
    </header>
    <main class="bh-panel">
      <nav class="bh-tabs" role="tablist" aria-label="${message('bhViewTitle', 'Gaia BH1 views')}">
        <button class="bh-tab" id="bh-tab-overview" type="button" role="tab" aria-selected="true" aria-controls="bh-section-overview">${message('bhOverviewTab', 'Binary overview')}</button>
        <button class="bh-tab" id="bh-tab-closeup" type="button" role="tab" aria-selected="false" aria-controls="bh-section-closeup">${message('bhCloseupTab', 'Relativistic close-up')}</button>
      </nav>
      <section class="bh-section" id="bh-section-overview" role="tabpanel" aria-labelledby="bh-tab-overview">
        <div class="bh-overview-purpose">
          <strong>${message('bhOverviewPurposeTitle', 'What this view shows')}</strong>
          <p>${message('bhOverviewPurpose', 'At the selected observation date, the visible companion and the unseen compact object orbit their shared centre of mass. This is a local scale view of the Gaia BH1 system.')}</p>
          <p class="bh-overview-evidence">${message('bhOverviewEvidence', 'The black hole is not seen directly here: its evidence is the measured motion of the luminous star around a 9.27 M☉ dark mass.')}</p>
        </div>
        <div class="bh-overview-legend" aria-label="${message('bhOverviewLegend', 'Diagram legend')}">
          <span><i class="bh-key bh-key-star"></i>${message('bhLegendCompanion', 'Companion star · physical radius (glow is display-only)')}</span>
          <span><i class="bh-key bh-key-black-hole"></i>${message('bhLegendBlackHole', 'Black-hole position')}</span>
          <span><i class="bh-key bh-key-barycentre"></i>${message('bhLegendBarycentre', 'Shared barycentre')}</span>
          <span><i class="bh-key bh-key-orbits"></i>${message('bhLegendOrbits', 'Barycentric orbit paths')}</span>
          <span><i class="bh-key bh-key-sky"></i>${message('bhLegendSky', 'Sky backdrop · ESA Gaia reference sky (display-mapped)')}</span>
        </div>
        <p class="bh-mode-note">${message('bhOverviewScaleNote', 'The companion, orbit and event horizon share one true-scale ruler. The horizon is rendered at physical size; the locator is needed because it is normally sub-pixel.')}</p>
        <div class="bh-screen-scale" aria-label="${message('bhScreenScale', 'On-screen scale at the barycentre')}">
          <span class="bh-scale-line" id="bh-scale-line"></span>
          <output id="bh-scale-label">— AU</output>
          <small>${message('bhScreenScaleHint', 'Updates as you zoom; measured at the barycentre.')}</small>
        </div>
        <div class="bh-readout">
          <span>${message('bhSeparation', 'Current separation')}</span><output id="bh-separation">—</output>
          <span>${message('bhOrbitalPhase', 'Observed orbital phase')}</span><output id="bh-phase">—</output>
          <span>${message('bhCompanionRadius', 'Companion radius')}</span><output>${quantityValue(data.companion?.radiusSolar, 0.99).toFixed(2)} R☉</output>
        </div>
        <p class="bh-warning">${message('bhObservedPhaseNote', 'The date control sets the orbital phase inferred for observations received in the Solar System; it is not a simultaneity claim across ~478 pc.')}</p>
        <div class="bh-controls"><button type="button" id="bh-reset-overview">${message('bhResetView', 'Reset view')}</button></div>
      </section>
      <section class="bh-section" id="bh-section-closeup" role="tabpanel" aria-labelledby="bh-tab-closeup" hidden>
        <p class="bh-mode-note">${message('bhSchwarzschildAssumption', 'Spin is unknown — this view explicitly assumes a*=0 and uses the Schwarzschild metric.')}</p>
        <p class="bh-mode-note">${message('bhCompactObjectCaveat', 'The favored model is one 9.27 M☉ compact object. Current observations do not fully exclude a very tight inner black-hole pair; this close-up models the single-object solution.')}</p>
        <div class="bh-controls">
          <div class="bh-preset-row" role="group" aria-label="${message('bhCameraPreset', 'Camera preset')}">
            <button type="button" data-bh-preset="earth" aria-pressed="true">${message('bhPresetEarth', 'From Earth line')}</button>
            <button type="button" data-bh-preset="einstein" aria-pressed="false">${message('bhPresetEinstein', 'Einstein alignment')}</button>
            <button type="button" data-bh-preset="free" aria-pressed="false">${message('bhPresetFree', 'Free orbit')}</button>
          </div>
          <label>${message('bhObserverZoom', 'Observer radius · scroll/pinch to zoom')}
            <input id="bh-observer-radius" type="range" min="0" max="1000" step="1" />
            <small>${message('bhObserverZoomHint', 'Physical dolly range covered by the geodesic table: 6.09–99.91 GM/c².')}</small>
          </label>
          <label class="bh-check bh-disk-row"><input id="bh-disk-toggle" type="checkbox" /><span>${message('bhDiskToggle', 'Illustrative accretion disk (none detected — model)')}</span></label>
          <small class="bh-disk-hint">${message('bhDiskHint', 'Off by default: no accretion emission is detected at Gaia BH1.')}</small>
          <label>${message('bhQuality', 'Render quality')}
            <select id="bh-quality">
              <option value="auto">${message('bhQualityAuto', 'Auto')}</option>
              <option value="high">${message('bhQualityHigh', 'High · 100%')}</option>
              <option value="medium">${message('bhQualityMedium', 'Medium · 75%')}</option>
              <option value="low">${message('bhQualityLow', 'Low · 50%')}</option>
            </select>
          </label>
          <label>${message('bhExposure', 'Exposure')}
            <input id="bh-exposure" type="range" min="-2" max="2" step="0.01" value="0" />
          </label>
          <label class="bh-check"><input id="bh-upscale-crisp" type="checkbox" /><span>${message('bhUpscaleCrisp', 'Crisp upscale (nearest-neighbour)')}</span></label>
          <button type="button" id="bh-reset-closeup">${message('bhResetView', 'Reset view')}</button>
        </div>
        <p class="bh-warning" id="bh-disk-caveat" hidden>${message('bhDiskCaveat', 'Illustration, not an observation: Gaia BH1 has no detected accretion emission. This disk is a physically motivated thin-disk model (ISCO–30 GM/c², T ∝ r⁻³ᐟ⁴ with an inner taper, Doppler + gravitational shifts, lensed multiple images) shown only in this opt-in mode.')}</p>
        <div class="bh-readout">
          <span>${message('bhObserverDistance', 'Static observer radius')}</span><output id="bh-observer-distance">—</output>
          <span>${message('bhTimeDilation', 'dτ/dt')}</span><output id="bh-time-dilation">—</output>
          <span>${message('bhBlueshiftFactor', 'Blueshift factor')}</span><output id="bh-blueshift">—</output>
          <span>${message('bhShadowAngularDiameter', 'Shadow angular diameter')}</span><output id="bh-shadow-angle">—</output>
          <span>${message('bhFieldOfView', 'Vertical field of view')}</span><output>${CLOSEUP_FOV_DEG}°</output>
        </div>
        <p class="bh-warning">${message('bhStaticObserverWarning', 'This is a hypothetical static observer; remaining at any selected radius requires continuous thrust.')}</p>
        <p class="bh-mode-note">${message('bhBlueshiftNote', 'Received light is blueshifted and brightened by the static-observer factors 1/√(1−2GM/rc²) and (1−2GM/rc²)⁻²; the sky tint uses a Planckian reference spectrum (model).')}</p>
        <p class="bh-mode-note">${message('bhPsfNote', 'Star glow is a modeled instrument/eye point-spread function applied to the whole image, and the stellar disc uses a linear limb-darkening law (u = 0.6); neither is emission from the black hole.')}</p>
        <p>${message('bhSkyCaveat', 'The Gaia map is a display-mapped reference sky observed from the Solar System. The geodesic geometry is modeled; this is not calibrated photometry or the exact sky at Gaia BH1.')}</p>
        <div class="bh-status" id="bh-status" role="status" aria-live="polite"></div>
      </section>
      <section class="bh-sources" id="bh-sources"></section>
    </main>
    <div class="bh-reticle" id="bh-reticle" aria-hidden="true"><i aria-hidden="true"></i></div>
    <button class="bh-scene-label bh-label-black-hole" id="bh-label-black-hole" type="button" aria-label="${message('bhOpenCloseup', 'Open Schwarzschild close-up')}">${message('bhSceneBlackHole', 'Black hole · physical position')}</button>
    <div class="bh-scene-label bh-label-companion" id="bh-label-companion" aria-hidden="true">${message('bhSceneCompanion', 'G-type companion')}</div>
    <div class="bh-scene-label bh-label-barycentre" id="bh-label-barycentre" aria-hidden="true">${message('bhSceneBarycentre', 'Barycentre')}</div>
    <div class="bh-scene-label bh-label-shadow" id="bh-label-shadow" aria-hidden="true" hidden>${message('bhShadowRingLabel', 'Shadow diameter · true scale, distant-observer')} · ${schwarzschild.shadowDiameterKm.toFixed(1)} km</div>
  `;
  document.body.appendChild(ui);

  const $ = selector => ui.querySelector(selector);
  const overviewSection = $('#bh-section-overview');
  const closeupSection = $('#bh-section-closeup');
  const overviewTab = $('#bh-tab-overview');
  const closeupTab = $('#bh-tab-closeup');
  const reticleElement = $('#bh-reticle');
  const blackHoleLabel = $('#bh-label-black-hole');
  const companionLabel = $('#bh-label-companion');
  const barycentreLabel = $('#bh-label-barycentre');
  const shadowLabel = $('#bh-label-shadow');
  const overviewLabels = [blackHoleLabel, companionLabel, barycentreLabel];
  const scaleContainer = $('.bh-screen-scale');
  const scaleLine = $('#bh-scale-line');
  const scaleLabel = $('#bh-scale-label');
  const fallbackCanvas = $('#bh-fallback');
  const fallbackContext = fallbackCanvas.getContext('2d', { alpha: false });
  const statusElement = $('#bh-status');
  const separationOutput = $('#bh-separation');
  const phaseOutput = $('#bh-phase');
  const qualitySelect = $('#bh-quality');
  const observerRadiusSlider = $('#bh-observer-radius');
  const observerDistanceOutput = $('#bh-observer-distance');
  const timeDilationOutput = $('#bh-time-dilation');
  const blueshiftOutput = $('#bh-blueshift');
  const shadowAngleOutput = $('#bh-shadow-angle');
  const exposureSlider = $('#bh-exposure');
  const crispToggle = $('#bh-upscale-crisp');
  const diskToggle = $('#bh-disk-toggle');
  const diskCaveat = $('#bh-disk-caveat');
  diskToggle.checked = diskEnabled;
  diskCaveat.hidden = !diskEnabled;
  makeSourceList(
    $('#bh-sources'),
    data,
    message('bhSources', 'Sources'),
    `${message('bhCoordinateEpoch', 'Coordinate epoch')}: ${data.coordinates?.epoch || 'J2016.0'}`,
  );

  const observerSliderToRadius = value => OBSERVER_RADIUS_MIN_OVER_M * Math.pow(
    OBSERVER_RADIUS_MAX_OVER_M / OBSERVER_RADIUS_MIN_OVER_M,
    value / 1000,
  );
  const observerRadiusToSlider = radius => 1000 * Math.log(
    radius / OBSERVER_RADIUS_MIN_OVER_M,
  ) / Math.log(OBSERVER_RADIUS_MAX_OVER_M / OBSERVER_RADIUS_MIN_OVER_M);

  function updateObserverReadouts() {
    const observerDistanceKm = observerRadiusOverM * schwarzschild.gravitationalRadiusKm;
    const timeDilation = Physics.staticObserverTimeDilation(observerRadiusOverM);
    const shadowRadius = Physics.schwarzschildShadowAngularRadius(observerRadiusOverM);
    const radiusInSchwarzschildRadii = observerRadiusOverM / 2;
    observerDistanceOutput.textContent = `${observerDistanceKm.toFixed(2)} km · ${radiusInSchwarzschildRadii.toFixed(radiusInSchwarzschildRadii < 10 ? 2 : 1)} rₛ`;
    timeDilationOutput.textContent = timeDilation.toFixed(6);
    blueshiftOutput.textContent = `×${(1 / timeDilation).toFixed(6)}`;
    shadowAngleOutput.textContent = `${THREE.MathUtils.radToDeg(2 * shadowRadius).toFixed(6)}°`;
    observerRadiusSlider.value = String(Math.max(0, Math.min(1000,
      observerRadiusToSlider(observerRadiusOverM))));
  }
  updateObserverReadouts();

  // ---------------------------------------------------------- overview rig
  const rig = new THREE.Group();
  rig.name = 'Gaia BH1 true-scale local binary';
  rig.visible = false;
  scene.add(rig);

  const companionColor = blackbodySrgb(quantityValue(data.companion?.effectiveTemperatureK, 5850));
  const companionLuminosity = quantityValue(data.companion?.luminositySolar, 1.06);
  // A modest measured-luminosity scale is applied consistently to both views.
  // The Gaia backdrop is display-mapped, so this is explicitly not presented
  // as calibrated relative photometry (see the close-up caveat in the UI).
  const companionDisplayColor = companionColor.clone().multiplyScalar(companionLuminosity);
  const companionRadius = quantityValue(data.companion?.radiusSolar, 0.99)
    * AU_PER_SOLAR_RADIUS * sceneUnitsPerAU;
  const companionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(companionRadius, 48, 32),
    new THREE.MeshBasicMaterial({ color: companionDisplayColor, toneMapped: false }),
  );
  companionMesh.name = 'Gaia BH1 companion (true radius)';
  rig.add(companionMesh);

  // Display-only glow around the physical-radius photosphere (labeled in the
  // legend). Sprites carry the halo because the bloom composer is bypassed in
  // this mode; sprite scale is a diameter, so 6x/14x = 3/7 stellar radii.
  const companionGlowTexture = makeCompanionGlowTexture();
  const companionGlowInner = new THREE.Sprite(new THREE.SpriteMaterial({
    map: companionGlowTexture,
    color: companionColor,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }));
  companionGlowInner.scale.setScalar(companionRadius * 6);
  companionGlowInner.renderOrder = 2;
  const companionGlowOuter = new THREE.Sprite(new THREE.SpriteMaterial({
    map: companionGlowTexture,
    color: companionColor,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }));
  companionGlowOuter.scale.setScalar(companionRadius * 14);
  companionGlowOuter.renderOrder = 2;
  companionMesh.add(companionGlowInner, companionGlowOuter);

  // This sphere is the physical event horizon on exactly the same ruler as the
  // star and orbit. It is intentionally black, non-emissive and not enlarged;
  // the separate locator remains necessary because the sphere is sub-pixel in
  // a view wide enough to show the binary.
  const blackHoleAnchor = new THREE.Group();
  blackHoleAnchor.name = 'Gaia BH1 physical position';
  const horizonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(horizonRadiusScene, 32, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }),
  );
  horizonMesh.name = 'Gaia BH1 event horizon (physical radius, not enlarged)';
  blackHoleAnchor.add(horizonMesh);
  const locatorMaterial = new THREE.LineBasicMaterial({
    color: 0xaedcff,
    transparent: true,
    opacity: 0.72,
    depthTest: false,
    toneMapped: false,
  });
  const locatorRing = new THREE.LineLoop(createReticleGeometry(), locatorMaterial);
  locatorRing.renderOrder = 20;
  blackHoleAnchor.add(locatorRing);
  // True-scale shadow indicator: the critical impact parameter on the same
  // ruler as everything else. Hidden until it spans a few pixels, then it
  // crossfades with the DOM locator reticle (an honest apparent size, not a
  // glow — the distant-observer shadow diameter is exact at these distances).
  const shadowRingRadiusScene = CRITICAL_IMPACT_OVER_M * gravitationalRadiusScene;
  const shadowRingMaterial = new THREE.LineBasicMaterial({
    color: 0xaedcff,
    transparent: true,
    opacity: 0,
    depthTest: false,
    toneMapped: false,
  });
  const shadowRing = new THREE.LineLoop(
    createReticleGeometry(shadowRingRadiusScene), shadowRingMaterial,
  );
  shadowRing.renderOrder = 20;
  shadowRing.visible = false;
  blackHoleAnchor.add(shadowRing);
  rig.add(blackHoleAnchor);

  const connectorGeometry = new THREE.BufferGeometry();
  connectorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const connector = new THREE.Line(connectorGeometry, new THREE.LineBasicMaterial({
    color: 0x7a8da8,
    transparent: true,
    opacity: 0.28,
    toneMapped: false,
  }));
  connector.renderOrder = 2;
  rig.add(connector);

  function makeOrbitPath(key, color) {
    const points = [];
    const periastron = quantityValue(data.orbit?.periastronJulianDate);
    const period = quantityValue(data.orbit?.periodDays);
    for (let i = 0; i <= 320; i++) {
      const state = Physics.binaryOrbitState(data, periastron + period * i / 320);
      points.push(vectorFromArray(state[key]).multiplyScalar(sceneUnitsPerAU));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: key === 'star' ? 0.55 : 0.4,
      toneMapped: false,
    });
    const path = new THREE.Line(geometry, material);
    path.name = `${key} barycentric orbit`;
    path.renderOrder = 2;
    rig.add(path);
    return path;
  }
  const companionOrbit = makeOrbitPath('star', 0xe7d7a8);
  const blackHoleOrbit = makeOrbitPath('blackHole', 0x72acd4);

  // Equatorial axes expressed in the app's scene coordinates. Dotting a scene
  // vector with them recovers its ICRS Cartesian components in the shader.
  const eqX = vectorFromArray(Object.values(Physics.equatorialToSceneDirection(0, 0)));
  const eqY = vectorFromArray(Object.values(Physics.equatorialToSceneDirection(90, 0)));
  const eqZ = vectorFromArray(Object.values(Physics.equatorialToSceneDirection(0, 90)));
  // Illustrative-disk plane: the measured binary orbital plane (the only
  // measured plane in the system), prograde with the binary; the reference
  // direction just anchors the material pattern's azimuth.
  const diskPlaneNormal = new THREE.Vector3(...Physics.binaryOrbitalPlaneNormal(data));
  const diskPlaneSeed = Math.abs(diskPlaneNormal.y) < 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  const diskReferenceDir = new THREE.Vector3()
    .crossVectors(diskPlaneNormal, diskPlaneSeed).normalize();
  const earthToSystem = vectorFromArray(Object.values(Physics.equatorialToSceneDirection(
    quantityValue(data.coordinates?.raDeg),
    quantityValue(data.coordinates?.decDeg ?? data.coordinates?.declinationDeg),
  )));
  const earthLineObserver = earthToSystem.clone().negate();

  // ------------------------------------------------------ overview backdrop
  // Camera-centred BackSide sphere sampling the same Gaia map through the
  // same GLSL chunk as the lensing shader, so the two tabs agree by
  // construction; the travel sequence crossfades it over the Solar System's
  // Milky Way/starfield via renderOrder (stars 0 < backdrop 1 < rig 2).
  // Never parent it to the rig: early in travel the rig sits at ~3.7e12
  // units, far beyond Float32 precision for a 1.5e6-unit shell.
  let backdropOpacity = 1;
  let skyReady = false;
  const backdropMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uSky: { value: null },
      uOpacity: { value: 1 },
      uEqX: { value: eqX.clone() },
      uEqY: { value: eqY.clone() },
      uEqZ: { value: eqZ.clone() },
    },
    vertexShader: BACKDROP_VERTEX,
    fragmentShader: buildBackdropFragment(),
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    // toneMapped stays true: the include chunks apply the renderer's ACES and
    // output encoding, matching both the orrery materials it fades over and
    // the close-up composite at exposure 1. Keep it that way.
  });
  const backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(BACKDROP_RADIUS_AU * sceneUnitsPerAU, 48, 24),
    backdropMaterial,
  );
  backdrop.name = 'Gaia BH1 reference-sky backdrop';
  backdrop.frustumCulled = false;
  backdrop.renderOrder = 1;
  backdrop.visible = false;
  scene.add(backdrop);

  function syncBackdropVisibility() {
    backdrop.visible = active && mode === 'overview' && skyReady && backdropOpacity > 0.001;
  }

  function setBackdropFade(alpha) {
    backdropOpacity = Math.max(0, Math.min(1, Number(alpha) || 0));
    backdropMaterial.uniforms.uOpacity.value = backdropOpacity;
    syncBackdropVisibility();
  }

  const tmpCompanion = new THREE.Vector3();
  const tmpBlackHole = new THREE.Vector3();
  const tmpRelative = new THREE.Vector3();
  const tmpProject = new THREE.Vector3();
  const tmpObserver = new THREE.Vector3();
  const tmpRight = new THREE.Vector3();
  const tmpUp = new THREE.Vector3();
  const tmpColor = new THREE.Color();
  const tmpOverlayWorld = new THREE.Vector3();
  const tmpScaleA = new THREE.Vector3();
  const tmpScaleB = new THREE.Vector3();
  const tmpScaleRight = new THREE.Vector3();
  const scaleNumber = new Intl.NumberFormat(document.documentElement.lang || undefined, {
    maximumSignificantDigits: 2,
  });

  function updateOrbit(nextSimDays) {
    if (Number.isFinite(nextSimDays)) currentSimDays = nextSimDays;
    orbitState = Physics.binaryOrbitState(data, simulationDaysToJulianDate(currentSimDays));
    vectorFromArray(orbitState.star, tmpCompanion).multiplyScalar(sceneUnitsPerAU);
    vectorFromArray(orbitState.blackHole, tmpBlackHole).multiplyScalar(sceneUnitsPerAU);
    companionMesh.position.copy(tmpCompanion);
    blackHoleAnchor.position.copy(tmpBlackHole);
    const positions = connector.geometry.attributes.position;
    positions.setXYZ(0, tmpBlackHole.x, tmpBlackHole.y, tmpBlackHole.z);
    positions.setXYZ(1, tmpCompanion.x, tmpCompanion.y, tmpCompanion.z);
    positions.needsUpdate = true;
    separationOutput.textContent = `${orbitState.separationAU.toFixed(5)} AU`;
    phaseOutput.textContent = `${(orbitState.phase * 100).toFixed(2)}% · JD ${orbitState.observationJulianDate.toFixed(2)}`;

    if (closeupGpu) {
      updateCompanionUniforms();
      // Wrapped to keep float32 precision on the labeled slow-motion clock.
      closeupGpu.uniforms.uDiskTime.value = (currentSimDays * DISK_TIME_SCALE) % 6283.185307;
    }
    fallbackDirty = true;
  }

  function placeOverviewOverlay(element, object, rect) {
    object.getWorldPosition(tmpOverlayWorld);
    tmpProject.copy(tmpOverlayWorld).project(camera);
    const visible = tmpProject.z >= -1 && tmpProject.z <= 1
      && Math.abs(tmpProject.x) <= 1.15 && Math.abs(tmpProject.y) <= 1.15;
    element.hidden = !visible;
    if (!visible) return false;
    element.style.left = `${rect.left + (tmpProject.x + 1) * rect.width * 0.5}px`;
    element.style.top = `${rect.top + (1 - tmpProject.y) * rect.height * 0.5}px`;
    return true;
  }

  function updateScreenScale(rect) {
    rig.getWorldPosition(tmpOverlayWorld);
    tmpScaleRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    tmpScaleA.copy(tmpOverlayWorld).addScaledVector(tmpScaleRight, -sceneUnitsPerAU * 0.5).project(camera);
    tmpScaleB.copy(tmpOverlayWorld).addScaledVector(tmpScaleRight, sceneUnitsPerAU * 0.5).project(camera);
    const dx = (tmpScaleB.x - tmpScaleA.x) * rect.width * 0.5;
    const dy = (tmpScaleB.y - tmpScaleA.y) * rect.height * 0.5;
    const pixelsPerAu = Math.hypot(dx, dy);
    if (!Number.isFinite(pixelsPerAu) || pixelsPerAu <= 0) {
      scaleContainer.hidden = true;
      return;
    }

    // Choose a 1/2/5 ruler near 96 CSS pixels, so it remains legible through
    // zoom changes while retaining a direct world-to-screen scale at r = 0.
    const targetAu = 96 / pixelsPerAu;
    const decade = 10 ** Math.floor(Math.log10(targetAu));
    const candidates = [1, 2, 5, 10].map(value => value * decade);
    const rulerAu = candidates.reduce((best, value) => (
      Math.abs(value * pixelsPerAu - 96) < Math.abs(best * pixelsPerAu - 96) ? value : best
    ));
    scaleContainer.hidden = false;
    scaleLine.style.width = `${rulerAu * pixelsPerAu}px`;
    scaleLabel.textContent = `${scaleNumber.format(rulerAu)} AU`;
  }

  function updateReticle() {
    if (!active || mode !== 'overview') {
      reticleElement.hidden = true;
      overviewLabels.forEach(label => { label.hidden = true; });
      shadowLabel.hidden = true;
      shadowRing.visible = false;
      scaleContainer.hidden = true;
      return;
    }
    locatorRing.quaternion.copy(camera.quaternion);
    shadowRing.quaternion.copy(camera.quaternion);
    const rect = renderer.domElement.getBoundingClientRect();
    placeOverviewOverlay(reticleElement, blackHoleAnchor, rect);
    placeOverviewOverlay(blackHoleLabel, blackHoleAnchor, rect);
    placeOverviewOverlay(companionLabel, companionMesh, rect);
    placeOverviewOverlay(barycentreLabel, rig, rect);

    // Crossfade the screen-space locator against the true-scale shadow ring
    // once the ring's honest apparent size reaches a few pixels.
    blackHoleAnchor.getWorldPosition(tmpOverlayWorld);
    const anchorDistance = camera.position.distanceTo(tmpOverlayWorld);
    const ringPixels = shadowRingRadiusScene / Math.max(anchorDistance, 1e-12)
      * (rect.height * 0.5)
      / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const ringRamp = THREE.MathUtils.smoothstep(ringPixels, 4, 10);
    shadowRingMaterial.opacity = 0.72 * ringRamp;
    shadowRing.visible = ringRamp > 0.001;
    reticleElement.style.opacity = String(1 - ringRamp);
    if (ringRamp > 0.001) {
      placeOverviewOverlay(shadowLabel, blackHoleAnchor, rect);
      shadowLabel.style.opacity = String(ringRamp);
    } else {
      shadowLabel.hidden = true;
    }
    updateScreenScale(rect);
  }

  // ---------------------------------------------------------- saved camera
  function saveView() {
    saved.valid = true;
    saved.position.copy(camera.position);
    saved.quaternion.copy(camera.quaternion);
    saved.up.copy(camera.up);
    saved.target.copy(controls.target);
    saved.near = camera.near;
    saved.far = camera.far;
    saved.fov = camera.fov;
    saved.zoom = camera.zoom;
    saved.controls = {
      enabled: controls.enabled,
      enableRotate: controls.enableRotate,
      enableZoom: controls.enableZoom,
      enablePan: controls.enablePan,
      minDistance: controls.minDistance,
      maxDistance: controls.maxDistance,
      zoomSpeed: controls.zoomSpeed,
      rotateSpeed: controls.rotateSpeed,
      panSpeed: controls.panSpeed,
      touches: controls.touches ? { ...controls.touches } : null,
      mouseButtons: controls.mouseButtons ? { ...controls.mouseButtons } : null,
    };
    renderer.getClearColor(saved.clearColor);
    saved.clearAlpha = renderer.getClearAlpha();
    saved.autoClear = renderer.autoClear;
  }

  function restoreView() {
    if (!saved.valid) return;
    camera.position.copy(saved.position);
    camera.quaternion.copy(saved.quaternion);
    camera.up.copy(saved.up);
    camera.near = saved.near;
    camera.far = saved.far;
    camera.fov = saved.fov;
    camera.zoom = saved.zoom;
    camera.aspect = viewportWidth / viewportHeight;
    camera.updateProjectionMatrix();
    controls.target.copy(saved.target);
    Object.assign(controls, saved.controls);
    if (saved.controls.touches) controls.touches = { ...saved.controls.touches };
    if (saved.controls.mouseButtons) controls.mouseButtons = { ...saved.controls.mouseButtons };
    controls.update();
    renderer.setRenderTarget(null);
    renderer.setClearColor(saved.clearColor, saved.clearAlpha);
    renderer.autoClear = saved.autoClear;
    saved.valid = false;
  }

  function configureCommonCamera() {
    camera.aspect = viewportWidth / viewportHeight;
    camera.near = Math.max(horizonRadiusScene * 0.02, 1e-8);
    camera.far = sceneUnitsPerAU * OVERVIEW_FAR_AU;
    camera.fov = CLOSEUP_FOV_DEG;
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.enabled = true;
    controls.enableRotate = true;
    controls.rotateSpeed = 0.55;
    controls.enableZoom = false;
    controls.enablePan = false;
  }

  function placeOverviewCamera() {
    configureCommonCamera();
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.minDistance = Math.max(horizonRadiusScene * 1.05, 1e-7);
    controls.maxDistance = sceneUnitsPerAU * 50;
    controls.target.copy(rig.position);
    camera.up.set(0, 1, 0);
    camera.position.copy(rig.position).add(overviewCameraOffset);
    camera.lookAt(controls.target);
    controls.update();
  }

  function setPresetButtonState(preset) {
    activePreset = preset;
    ui.querySelectorAll('[data-bh-preset]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.bhPreset === preset));
    });
  }

  function clampObserverRadius(radiusOverM) {
    return Math.max(OBSERVER_RADIUS_MIN_OVER_M,
      Math.min(OBSERVER_RADIUS_MAX_OVER_M, radiusOverM));
  }

  function setObserverRadius(radiusOverM) {
    observerRadiusOverM = clampObserverRadius(radiusOverM);
    tmpObserver.copy(camera.position).sub(controls.target);
    if (tmpObserver.lengthSq() < 1e-24) tmpObserver.copy(earthLineObserver);
    tmpObserver.normalize();
    camera.position.copy(tmpObserver)
      .multiplyScalar(observerRadiusOverM * gravitationalRadiusScene)
      .add(controls.target);
    camera.lookAt(controls.target);
    controls.update();
    updateShadowUniforms();
    updateObserverReadouts();
    fallbackDirty = true;
  }

  function syncObserverRadiusFromCamera() {
    if (mode !== 'closeup') return;
    const radius = camera.position.distanceTo(controls.target) / gravitationalRadiusScene;
    if (!Number.isFinite(radius)) return;
    const next = clampObserverRadius(radius);
    if (Math.abs(next - observerRadiusOverM) > 1e-9) {
      observerRadiusOverM = next;
      updateObserverReadouts();
      fallbackDirty = true;
    }
    updateShadowUniforms();
  }

  function placeCloseupObserver(direction, preset, radiusOverM = observerRadiusOverM) {
    configureCommonCamera();
    observerRadiusOverM = clampObserverRadius(radiusOverM);
    controls.enableZoom = true;
    controls.zoomSpeed = 0.8;
    controls.minDistance = OBSERVER_RADIUS_MIN_OVER_M * gravitationalRadiusScene;
    controls.maxDistance = OBSERVER_RADIUS_MAX_OVER_M * gravitationalRadiusScene;
    controls.target.copy(rig.position);
    tmpObserver.copy(direction).normalize();
    camera.position.copy(tmpObserver)
      .multiplyScalar(observerRadiusOverM * gravitationalRadiusScene)
      .add(rig.position);
    camera.up.set(0, 1, 0);
    if (Math.abs(tmpObserver.dot(camera.up)) > 0.98) camera.up.set(0, 0, 1);
    camera.lookAt(controls.target);
    controls.update();
    setPresetButtonState(preset);
    updateObserverReadouts();
    updateShadowUniforms();
    fallbackDirty = true;
  }

  function applyPreset(preset) {
    if (preset === 'earth') {
      placeCloseupObserver(earthLineObserver, 'earth');
    } else if (preset === 'einstein') {
      vectorFromArray(orbitState.relative, tmpRelative).normalize().negate();
      placeCloseupObserver(tmpRelative, 'einstein');
    } else {
      setPresetButtonState('free');
      controls.enabled = true;
    }
  }

  // ---------------------------------------------------------- close-up GPU
  function loadTexture(url) {
    return new Promise((resolve, reject) => {
      textureLoader.load(url, resolve, undefined, reject);
    });
  }

  // The Gaia sky texture is shared by the close-up lensing pass and the
  // overview backdrop, so it is loaded and configured exactly once.
  // tools/test_blackhole.mjs greps the configuration literals below.
  function ensureSkyTexture() {
    if (!skyTexturePromise) {
      const skyUrl = new URL('../textures/blackhole/gaia_sky_equirectangular.jpg', import.meta.url);
      skyTexturePromise = loadTexture(skyUrl.href).then((skyTexture) => {
        // Hardware sRGB decode so trilinear/anisotropic filtering happens on
        // decoded values (WebGL2 core renders and mipmaps SRGB8_ALPHA8).
        skyTexture.colorSpace = THREE.SRGBColorSpace;
        skyTexture.wrapS = THREE.RepeatWrapping;
        skyTexture.wrapT = THREE.ClampToEdgeWrapping;
        skyTexture.minFilter = THREE.LinearMipmapLinearFilter;
        skyTexture.magFilter = THREE.LinearFilter;
        skyTexture.generateMipmaps = true;
        skyTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        if (disposed) {
          skyTexture.dispose();
        } else {
          sharedSkyTexture = skyTexture;
          backdropMaterial.uniforms.uSky.value = skyTexture;
          skyReady = true;
          syncBackdropVisibility();
        }
        return skyTexture;
      });
    }
    return skyTexturePromise;
  }

  async function loadCloseupAssets() {
    const lutUrl = new URL('../textures/blackhole/schwarzschild-lut-512x512-rg32f.bin', import.meta.url);
    const [response, skyTexture] = await Promise.all([
      fetch(lutUrl),
      ensureSkyTexture(),
    ]);
    if (!response.ok) throw new Error(`Schwarzschild LUT HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const expectedBytes = LUT_WIDTH * LUT_HEIGHT * 2 * Float32Array.BYTES_PER_ELEMENT;
    if (buffer.byteLength !== expectedBytes) {
      throw new Error(`Schwarzschild LUT has ${buffer.byteLength} bytes; expected ${expectedBytes}`);
    }
    return { lutValues: new Float32Array(buffer), skyTexture };
  }

  function createCloseupGpu(assets, hdr) {
    const lutTexture = new THREE.DataTexture(
      assets.lutValues,
      LUT_WIDTH,
      LUT_HEIGHT,
      THREE.RGFormat,
      THREE.FloatType,
    );
    lutTexture.internalFormat = 'RG32F';
    lutTexture.minFilter = THREE.NearestFilter;
    lutTexture.magFilter = THREE.NearestFilter;
    lutTexture.wrapS = lutTexture.wrapT = THREE.ClampToEdgeWrapping;
    lutTexture.generateMipmaps = false;
    lutTexture.flipY = false;
    lutTexture.needsUpdate = true;

    const linearCompanionColor = companionDisplayColor.clone();
    const uniforms = {
      uDeflectionLut: { value: lutTexture },
      uSky: { value: assets.skyTexture },
      uObserverDir: { value: new THREE.Vector3(0, 0, 1) },
      uCameraRight: { value: new THREE.Vector3(1, 0, 0) },
      uCameraUp: { value: new THREE.Vector3(0, 1, 0) },
      uEqX: { value: eqX.clone() },
      uEqY: { value: eqY.clone() },
      uEqZ: { value: eqZ.clone() },
      uCompanionDir: { value: new THREE.Vector3(0, 0, -1) },
      uCompanionColor: { value: linearCompanionColor },
      uCompanionAngularRadius: { value: 0.003 },
      uObserverRadiusOverM: { value: observerRadiusOverM },
      uAspect: { value: viewportWidth / viewportHeight },
      uTanHalfFov: { value: Math.tan(THREE.MathUtils.degToRad(CLOSEUP_FOV_DEG * 0.5)) },
      uSinShadow: { value: 0 },
      uCosShadow: { value: 1 },
      uInvAlphaRange: { value: 1 },
      uPixelStep: { value: 0.001 },
      uBlueshiftTint: { value: new THREE.Vector3(1, 1, 1) },
      uBlueshiftIntensity: { value: 1 },
      // Illustrative-disk uniforms (only the BH_DISK material variant reads
      // them; sharing one uniforms object keeps both variants in sync).
      uTrajectoryLut: { value: null },
      uFamilyLut: { value: null },
      uObserverLut: { value: null },
      uBlackbody: { value: null },
      uDiskNormal: { value: diskPlaneNormal.clone() },
      uDiskRef0: { value: diskReferenceDir.clone() },
      uShadowAngle: { value: 0.2 },
      uDiskOuterR: { value: 30 },
      uDiskIntensity: { value: 1.9 },
      uDiskTime: { value: 0 },
    };
    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: buildLensingFragment({ hdr }),
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const fullscreenScene = new THREE.Scene();
    const fullscreenCamera = new THREE.Camera();
    const quadGeometry = new THREE.PlaneGeometry(2, 2);
    const quad = new THREE.Mesh(quadGeometry, material);
    quad.frustumCulled = false;
    fullscreenScene.add(quad);
    const lensingQuad = quad;

    // Composite: exposure -> the same ACES fit the orrery uses -> sRGB with
    // one dither step (or a plain blit when the lensing pass wrote sRGB8).
    const compositeUniforms = {
      uScene: { value: null },
      uBloom: { value: null },
      uPsfWeight: { value: 0 },
      uExposure: { value: 1 },
    };
    const compositeScene = new THREE.Scene();
    const compositeMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: compositeUniforms,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: buildCompositeFragment({ hdr }),
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const compositeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial);
    compositeQuad.frustumCulled = false;
    compositeScene.add(compositeQuad);

    // PSF blur pyramid (HDR path only): one shared quad whose material is
    // swapped between the down/upsample passes each frame.
    let bloom = null;
    if (hdr) {
      const downMaterial = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
          uSource: { value: null },
          uHalfTexel: { value: new THREE.Vector2() },
        },
        vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: buildDownsampleFragment(),
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const upMaterial = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
          uSource: { value: null },
          uAdd: { value: null },
          uHalfTexel: { value: new THREE.Vector2() },
        },
        vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: buildUpsampleFragment(),
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const bloomScene = new THREE.Scene();
      const bloomQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), downMaterial);
      bloomQuad.frustumCulled = false;
      bloomScene.add(bloomQuad);
      bloom = {
        downMaterial,
        upMaterial,
        scene: bloomScene,
        quad: bloomQuad,
        geometry: bloomQuad.geometry,
        downs: [],
        ups: [],
      };
    }
    return {
      lutTexture,
      uniforms,
      material,
      lensingQuad,
      fullscreenScene,
      fullscreenCamera,
      quadGeometry,
      compositeScene,
      compositeMaterial,
      compositeUniforms,
      compositeGeometry: compositeQuad.geometry,
      bloom,
    };
  }

  // ------------------------------------------------- illustrative disk GPU
  function applyLensingMaterial() {
    if (!closeupGpu) return;
    closeupGpu.lensingQuad.material = diskEnabled && diskState
      ? diskState.material
      : closeupGpu.material;
  }

  function makeDiskDataTexture(values, width, height) {
    const texture = new THREE.DataTexture(values, width, height,
      THREE.RGFormat, THREE.FloatType);
    texture.internalFormat = 'RG32F';
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.needsUpdate = true;
    return texture;
  }

  // 1D Planckian-locus ramp built from the same blackbodySrgb helper the rest
  // of the module uses; hardware sRGB decode returns linear values in-shader.
  function makeBlackbodyTexture() {
    const size = 256;
    const data = new Uint8Array(size * 4);
    for (let i = 0; i < size; i++) {
      const temperature = DISK_BLACKBODY_MIN_K
        + (DISK_BLACKBODY_MAX_K - DISK_BLACKBODY_MIN_K) * i / (size - 1);
      const color = blackbodySrgb(temperature).convertLinearToSRGB();
      data[4 * i] = Math.round(color.r * 255);
      data[4 * i + 1] = Math.round(color.g * 255);
      data[4 * i + 2] = Math.round(color.b * 255);
      data[4 * i + 3] = 255;
    }
    const texture = new THREE.DataTexture(data, size, 1,
      THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  async function fetchDiskTable(fileName, expectedScalars) {
    const url = new URL(`../textures/blackhole/${fileName}`, import.meta.url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${fileName} HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const expectedBytes = expectedScalars * Float32Array.BYTES_PER_ELEMENT;
    if (buffer.byteLength !== expectedBytes) {
      throw new Error(`${fileName} has ${buffer.byteLength} bytes; expected ${expectedBytes}`);
    }
    return new Float32Array(buffer);
  }

  // Lazy: the ~4 MiB of disk tables download only on the first opt-in.
  function ensureDiskAssets() {
    if (diskAssetsPromise) return diskAssetsPromise;
    statusElement.textContent = message('bhDiskLoading', 'Loading disk geodesic tables…');
    diskAssetsPromise = Promise.all([
      fetchDiskTable('schwarzschild-disk-trajectory-512x512-rg32f.bin',
        DISK_LUT_WIDTH * DISK_LUT_HEIGHT * 2),
      fetchDiskTable('schwarzschild-disk-families-512x1-rg32f.bin',
        DISK_LUT_HEIGHT * 2),
      fetchDiskTable('schwarzschild-disk-observer-512x512-rg32f.bin',
        DISK_LUT_WIDTH * DISK_LUT_HEIGHT * 2),
    ]).then(([trajectoryValues, familyValues, observerValues]) => {
      if (disposed || !closeupGpu) return null;
      const state = {
        trajectoryTexture: makeDiskDataTexture(trajectoryValues, DISK_LUT_WIDTH, DISK_LUT_HEIGHT),
        familyTexture: makeDiskDataTexture(familyValues, DISK_LUT_HEIGHT, 1),
        observerTexture: makeDiskDataTexture(observerValues, DISK_LUT_WIDTH, DISK_LUT_HEIGHT),
        blackbodyTexture: makeBlackbodyTexture(),
        material: null,
      };
      closeupGpu.uniforms.uTrajectoryLut.value = state.trajectoryTexture;
      closeupGpu.uniforms.uFamilyLut.value = state.familyTexture;
      closeupGpu.uniforms.uObserverLut.value = state.observerTexture;
      closeupGpu.uniforms.uBlackbody.value = state.blackbodyTexture;
      state.material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: closeupGpu.uniforms,
        vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: buildLensingFragment({ hdr: closeupHdr, disk: true }),
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      let shaderError = null;
      const previousShaderErrorHandler = renderer.debug.onShaderError;
      renderer.debug.onShaderError = (...args) => {
        shaderError = new Error('The illustrative-disk shader did not compile');
        if (typeof previousShaderErrorHandler === 'function') previousShaderErrorHandler(...args);
      };
      try {
        closeupGpu.lensingQuad.material = state.material;
        renderer.compile(closeupGpu.fullscreenScene, closeupGpu.fullscreenCamera);
      } finally {
        closeupGpu.lensingQuad.material = closeupGpu.material;
        renderer.debug.onShaderError = previousShaderErrorHandler;
      }
      if (shaderError) throw shaderError;
      diskState = state;
      statusElement.textContent = message('bhDiskReady',
        'Illustrative disk ready · model, not an observation');
      applyLensingMaterial();
      return state;
    }).catch((error) => {
      diskAssetsPromise = null;
      diskEnabled = false;
      diskToggle.checked = false;
      diskCaveat.hidden = true;
      statusElement.textContent = `${message('bhAssetError', 'Unable to load local lensing assets')}: ${error.message}`;
      return null;
    });
    return diskAssetsPromise;
  }

  function setDiskEnabled(enabled) {
    diskEnabled = Boolean(enabled);
    try {
      localStorage.setItem('solar.bhDisk', diskEnabled ? '1' : '0');
    } catch { /* private-mode storage stays off */ }
    diskCaveat.hidden = !diskEnabled;
    if (diskEnabled) ensureDiskAssets();
    applyLensingMaterial();
  }

  // The shadow terms feeding the shader's stable sin(alpha - shadow) path are
  // computed here in float64 whenever the observer radius changes, together
  // with the static-observer reception factors of the same radius.
  function updateShadowUniforms() {
    if (!closeupGpu) return;
    const sinShadow = Math.min(1, CRITICAL_IMPACT_OVER_M
      * Math.sqrt(1 - 2 / observerRadiusOverM) / observerRadiusOverM);
    closeupGpu.uniforms.uObserverRadiusOverM.value = observerRadiusOverM;
    closeupGpu.uniforms.uSinShadow.value = sinShadow;
    closeupGpu.uniforms.uCosShadow.value = Math.sqrt(Math.max(0, 1 - sinShadow * sinShadow));
    closeupGpu.uniforms.uShadowAngle.value = Math.asin(sinShadow);
    closeupGpu.uniforms.uInvAlphaRange.value = 1 / (Math.PI / 2 - Math.asin(sinShadow));

    // Gravitational blueshift of received light. The sky's per-pixel spectra
    // are unknown (display-mapped image), so its chromatic shift uses a
    // Planckian reference spectrum: a blackbody at T blueshifts exactly to a
    // blackbody at g*T. The companion's measured Teff is known, so its colour
    // and g^4 intensity gain are applied exactly.
    const blueshift = Physics.gravitationalBlueshiftFactor(observerRadiusOverM);
    const intensity = Physics.receivedBolometricIntensityFactor(observerRadiusOverM);
    const reference = blackbodySrgb(BLUESHIFT_REFERENCE_TEMPERATURE_K);
    const shifted = blackbodySrgb(BLUESHIFT_REFERENCE_TEMPERATURE_K * blueshift);
    const tint = closeupGpu.uniforms.uBlueshiftTint.value;
    tint.set(
      shifted.r / Math.max(1e-6, reference.r),
      shifted.g / Math.max(1e-6, reference.g),
      shifted.b / Math.max(1e-6, reference.b),
    );
    const tintLuminance = 0.2126 * tint.x + 0.7152 * tint.y + 0.0722 * tint.z;
    tint.divideScalar(Math.max(1e-6, tintLuminance));
    closeupGpu.uniforms.uBlueshiftIntensity.value = intensity;
    const companionTeff = quantityValue(data.companion?.effectiveTemperatureK, 5850);
    closeupGpu.uniforms.uCompanionColor.value
      .copy(blackbodySrgb(companionTeff * blueshift))
      .multiplyScalar(companionLuminosity * intensity);
  }

  function updateCompanionUniforms() {
    if (!closeupGpu) return;
    vectorFromArray(orbitState.relative, tmpRelative).normalize();
    closeupGpu.uniforms.uCompanionDir.value.copy(tmpRelative);
    const radiusAU = quantityValue(data.companion?.radiusSolar, 0.99) * AU_PER_SOLAR_RADIUS;
    closeupGpu.uniforms.uCompanionAngularRadius.value = Math.asin(
      Math.min(1, radiusAU / orbitState.separationAU),
    );
  }

  function ensureCloseup() {
    if (assetsPromise) return assetsPromise;
    statusElement.textContent = message('bhLoadingLut', 'Loading the local Schwarzschild geodesic table…');
    assetsPromise = loadCloseupAssets().then((assets) => {
      if (disposed) {
        assets.skyTexture.dispose();
        return null;
      }
      assetState = assets;
      if (renderer.capabilities.isWebGL2) {
        try {
          // With EXT_color_buffer_float the lensing pass renders open-range
          // linear HDR into a HalfFloat target; without it the shader encodes
          // dithered sRGB into 8 bits directly (band-free either way).
          closeupHdr = renderer.extensions.has('EXT_color_buffer_float');
          closeupGpu = createCloseupGpu(assets, closeupHdr);
          let shaderError = null;
          const previousShaderErrorHandler = renderer.debug.onShaderError;
          renderer.debug.onShaderError = (...args) => {
            shaderError = new Error('The Schwarzschild lensing shader did not compile');
            if (typeof previousShaderErrorHandler === 'function') previousShaderErrorHandler(...args);
          };
          try {
            renderer.compile(closeupGpu.fullscreenScene, closeupGpu.fullscreenCamera);
            renderer.compile(closeupGpu.compositeScene, closeupGpu.fullscreenCamera);
            if (closeupGpu.bloom) {
              renderer.compile(closeupGpu.bloom.scene, closeupGpu.fullscreenCamera);
              closeupGpu.bloom.quad.material = closeupGpu.bloom.upMaterial;
              renderer.compile(closeupGpu.bloom.scene, closeupGpu.fullscreenCamera);
              closeupGpu.bloom.quad.material = closeupGpu.bloom.downMaterial;
            }
          } finally {
            renderer.debug.onShaderError = previousShaderErrorHandler;
          }
          if (shaderError) throw shaderError;
          updateShadowUniforms();
          updateCompanionUniforms();
          closeupGpu.compositeUniforms.uExposure.value = 2 ** Number(exposureSlider.value);
          if (diskEnabled) ensureDiskAssets();
          applyLensingMaterial();
          statusElement.textContent = message('bhLutReady', 'Null-geodesic LUT ready · ESA/Gaia/DPAC reference sky');
        } catch (error) {
          activateFallback(error.message);
        }
      } else {
        activateFallback(message('bhWebgl2Required', 'WebGL2 is unavailable'));
      }
      fallbackDirty = true;
      return assets;
    }).catch((error) => {
      fallbackReason = error.message;
      fallbackActive = true;
      statusElement.textContent = `${message('bhAssetError', 'Unable to load local lensing assets')}: ${error.message}`;
      return null;
    });
    return assetsPromise;
  }

  function activateFallback(reason) {
    fallbackActive = true;
    fallbackReason = reason || '';
    fallbackCanvas.hidden = mode !== 'closeup';
    statusElement.textContent = `${message('bhWebglFallback', 'Static CPU fallback from the same geodesic LUT')} · ${fallbackReason}`;
    // The static fallback never renders the illustrative disk; disabling the
    // toggle states that plainly instead of silently ignoring it.
    diskToggle.checked = false;
    diskToggle.disabled = true;
    diskToggle.title = message('bhDiskUnavailableFallback',
      'The illustrative disk needs the WebGL2 renderer; the static fallback never shows it.');
    diskCaveat.hidden = true;
    fallbackDirty = true;
  }

  function selectedRenderScale() {
    if (qualityMode === 'high') return 1;
    if (qualityMode === 'medium') return 0.75;
    if (qualityMode === 'low') return 0.5;
    return adaptiveScale;
  }

  // Continuous adaptive resolution: one 1/16 notch per 45-frame window with a
  // wide fps dead band, so scale changes are frequent, small and invisible
  // instead of rare 25% pops.
  function adaptQuality(dt) {
    if (qualityMode !== 'auto') return;
    qualityFrameCount++;
    qualityTime += Math.min(0.1, Math.max(0, dt || 0));
    if (qualityFrameCount < 45) return;
    const fps = qualityFrameCount / Math.max(0.001, qualityTime);
    const previous = adaptiveScale;
    const notch = 1 / 16;
    if (fps < 45) adaptiveScale = Math.max(0.5, adaptiveScale - notch);
    else if (fps > 58) adaptiveScale = Math.min(1, adaptiveScale + notch);
    qualityFrameCount = 0;
    qualityTime = 0;
    if (adaptiveScale !== previous) targetWidth = targetHeight = 0;
  }

  function ensureCloseupTarget() {
    const pixelRatio = renderer.getPixelRatio();
    const scale = selectedRenderScale();
    const width = Math.max(1, Math.floor(viewportWidth * pixelRatio * scale));
    const height = Math.max(1, Math.floor(viewportHeight * pixelRatio * scale));
    if (!closeupTarget) {
      closeupTarget = new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.LinearFilter,
        magFilter: upscaleCrisp ? THREE.NearestFilter : THREE.LinearFilter,
        format: THREE.RGBAFormat,
        // Open-range linear HDR when renderable; the composite pass performs
        // exposure/tone mapping. The 8-bit path stores dithered sRGB.
        type: closeupHdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
      });
      closeupTarget.texture.colorSpace = THREE.NoColorSpace;
      closeupTarget.texture.generateMipmaps = false;
      closeupGpu.compositeUniforms.uScene.value = closeupTarget.texture;
      closeupGpu.compositeUniforms.uBloom.value = closeupTarget.texture;
      targetWidth = width;
      targetHeight = height;
      ensureBloomPyramid();
    } else if (width !== targetWidth || height !== targetHeight) {
      closeupTarget.setSize(width, height);
      targetWidth = width;
      targetHeight = height;
      ensureBloomPyramid();
    }
    // Tangent-plane step of one render pixel, used by the analytic Jacobian.
    closeupGpu.uniforms.uPixelStep.value = 2 * closeupGpu.uniforms.uTanHalfFov.value / height;
  }

  // Three half-resolution octaves for the PSF: downs hold the pyramid,
  // ups collect the widened result back to half resolution.
  function ensureBloomPyramid() {
    const bloom = closeupGpu?.bloom;
    if (!bloom) return;
    const makeTarget = (w, h) => {
      const target = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
      });
      target.texture.colorSpace = THREE.NoColorSpace;
      target.texture.generateMipmaps = false;
      return target;
    };
    const sizes = [1, 2, 3].map(level => [
      Math.max(1, Math.floor(targetWidth / 2 ** level)),
      Math.max(1, Math.floor(targetHeight / 2 ** level)),
    ]);
    if (!bloom.downs.length) {
      bloom.downs = sizes.map(([w, h]) => makeTarget(w, h));
      bloom.ups = [makeTarget(...sizes[1]), makeTarget(...sizes[0])];
      closeupGpu.compositeUniforms.uBloom.value = bloom.ups[1].texture;
      closeupGpu.compositeUniforms.uPsfWeight.value = 0.08;
    } else {
      bloom.downs.forEach((target, index) => target.setSize(...sizes[index]));
      bloom.ups[0].setSize(...sizes[1]);
      bloom.ups[1].setSize(...sizes[0]);
    }
  }

  function renderBloomPyramid() {
    const bloom = closeupGpu?.bloom;
    if (!bloom) return;
    const down = bloom.downMaterial.uniforms;
    const up = bloom.upMaterial.uniforms;
    const pass = (material, target) => {
      bloom.quad.material = material;
      renderer.setRenderTarget(target);
      renderer.render(bloom.scene, closeupGpu.fullscreenCamera);
    };
    bloom.quad.material = bloom.downMaterial;
    down.uSource.value = closeupTarget.texture;
    down.uHalfTexel.value.set(0.5 / targetWidth, 0.5 / targetHeight);
    pass(bloom.downMaterial, bloom.downs[0]);
    down.uSource.value = bloom.downs[0].texture;
    down.uHalfTexel.value.set(0.5 / bloom.downs[0].width, 0.5 / bloom.downs[0].height);
    pass(bloom.downMaterial, bloom.downs[1]);
    down.uSource.value = bloom.downs[1].texture;
    down.uHalfTexel.value.set(0.5 / bloom.downs[1].width, 0.5 / bloom.downs[1].height);
    pass(bloom.downMaterial, bloom.downs[2]);
    up.uSource.value = bloom.downs[2].texture;
    up.uAdd.value = bloom.downs[1].texture;
    up.uHalfTexel.value.set(0.5 / bloom.downs[2].width, 0.5 / bloom.downs[2].height);
    pass(bloom.upMaterial, bloom.ups[0]);
    up.uSource.value = bloom.ups[0].texture;
    up.uAdd.value = bloom.downs[0].texture;
    up.uHalfTexel.value.set(0.5 / bloom.ups[0].width, 0.5 / bloom.ups[0].height);
    pass(bloom.upMaterial, bloom.ups[1]);
  }

  function updateRayUniforms() {
    if (!closeupGpu) return;
    syncObserverRadiusFromCamera();
    camera.updateMatrixWorld();
    tmpObserver.copy(camera.position).sub(controls.target).normalize();
    tmpRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    tmpUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    closeupGpu.uniforms.uObserverDir.value.copy(tmpObserver);
    closeupGpu.uniforms.uCameraRight.value.copy(tmpRight);
    closeupGpu.uniforms.uCameraUp.value.copy(tmpUp);
    closeupGpu.uniforms.uAspect.value = viewportWidth / viewportHeight;
  }

  function clearRendererBlack() {
    renderer.getClearColor(tmpColor);
    const alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.setClearColor(tmpColor, alpha);
  }

  function renderCloseupGpu() {
    ensureCloseupTarget();
    updateRayUniforms();
    fallbackCanvas.hidden = true;
    try {
      renderer.setRenderTarget(closeupTarget);
      renderer.clear(true, false, false);
      renderer.render(closeupGpu.fullscreenScene, closeupGpu.fullscreenCamera);
      renderBloomPyramid();
      renderer.setRenderTarget(null);
      renderer.render(closeupGpu.compositeScene, closeupGpu.fullscreenCamera);
    } catch (error) {
      renderer.setRenderTarget(null);
      activateFallback(error.message);
    }
  }

  // ---------------------------------------------------------- CPU fallback
  function lookupCoordinateFromS(s) {
    if (s <= LUT_SAMPLE_SPLIT) {
      if (s <= LUT_SAMPLE_MIN) return 0;
      return LUT_LOOKUP_SPLIT * Math.log(s / LUT_SAMPLE_MIN)
        / Math.log(LUT_SAMPLE_SPLIT / LUT_SAMPLE_MIN);
    }
    return LUT_LOOKUP_SPLIT + (1 - LUT_LOOKUP_SPLIT)
      * (s - LUT_SAMPLE_SPLIT) / (1 - LUT_SAMPLE_SPLIT);
  }

  function sampleLutCpu(values, q, observerRadius) {
    const fx = Math.max(0, Math.min(LUT_WIDTH - 1, q * LUT_WIDTH - 0.5));
    const fy = Math.max(0, Math.min(LUT_HEIGHT - 1,
      (observerRadius - LUT_R_MIN) / (LUT_R_MAX - LUT_R_MIN) * LUT_HEIGHT - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(LUT_WIDTH - 1, x0 + 1), y1 = Math.min(LUT_HEIGHT - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const at = (x, y) => values[2 * (y * LUT_WIDTH + x)];
    const a = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
    const b = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
    return a * (1 - ty) + b * ty;
  }

  function prepareSkyPixels(image) {
    const width = 1075;
    const height = Math.round(width * image.height / image.width);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    return { width, height, pixels: context.getImageData(0, 0, width, height).data };
  }

  function renderFallbackFrame() {
    fallbackDirty = false;
    fallbackLastRender = performance.now();
    if (!fallbackActive || !assetState || mode !== 'closeup' || !active) return;
    syncObserverRadiusFromCamera();
    if (!assetState.skyPixels) assetState.skyPixels = prepareSkyPixels(assetState.skyTexture.image);

    const aspect = viewportWidth / viewportHeight;
    let width = Math.min(720, viewportWidth);
    let height = Math.round(width / aspect);
    if (height > 720) {
      height = 720;
      width = Math.round(height * aspect);
    }
    width = Math.max(2, Math.floor(width));
    height = Math.max(2, Math.floor(height));
    if (fallbackCanvas.width !== width || fallbackCanvas.height !== height) {
      fallbackCanvas.width = width;
      fallbackCanvas.height = height;
    }

    camera.updateMatrixWorld();
    tmpObserver.copy(camera.position).sub(controls.target).normalize();
    tmpRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    tmpUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    vectorFromArray(orbitState.relative, tmpRelative).normalize();
    const companionDirection = tmpRelative.clone();
    const companionAngularRadius = Math.asin(Math.min(1,
      quantityValue(data.companion?.radiusSolar, 0.99) * AU_PER_SOLAR_RADIUS
      / orbitState.separationAU));
    const companionCos = Math.cos(companionAngularRadius);
    const companionSrgb = companionDisplayColor.clone().convertLinearToSRGB();
    const starRgb = [
      Math.round(Math.min(1, companionSrgb.r) * 255),
      Math.round(Math.min(1, companionSrgb.g) * 255),
      Math.round(Math.min(1, companionSrgb.b) * 255),
    ];
    const output = fallbackContext.createImageData(width, height);
    const pixels = output.data;
    const sky = assetState.skyPixels;
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(CLOSEUP_FOV_DEG * 0.5));
    const shadow = Math.asin(CRITICAL_IMPACT_OVER_M
      * Math.sqrt(1 - 2 / observerRadiusOverM) / observerRadiusOverM);

    for (let py = 0; py < height; py++) {
      const sy = (1 - 2 * (py + 0.5) / height) * tanHalfFov;
      for (let px = 0; px < width; px++) {
        const sx = (2 * (px + 0.5) / width - 1) * aspect * tanHalfFov;
        let rx = -tmpObserver.x + tmpRight.x * sx + tmpUp.x * sy;
        let ry = -tmpObserver.y + tmpRight.y * sx + tmpUp.y * sy;
        let rz = -tmpObserver.z + tmpRight.z * sx + tmpUp.z * sy;
        const rayLength = Math.hypot(rx, ry, rz);
        rx /= rayLength; ry /= rayLength; rz /= rayLength;
        const cosAlpha = Math.max(-1, Math.min(1,
          -(rx * tmpObserver.x + ry * tmpObserver.y + rz * tmpObserver.z)));
        const alpha = Math.acos(cosAlpha);
        const offset = 4 * (py * width + px);
        if (alpha <= shadow) {
          pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
          pixels[offset + 3] = 255;
          continue;
        }

        const s = Math.sqrt(Math.max(0, Math.min(1,
          (alpha - shadow) / (Math.PI / 2 - shadow))));
        const phi = sampleLutCpu(assetState.lutValues, lookupCoordinateFromS(s), observerRadiusOverM);
        let tx = rx + tmpObserver.x * cosAlpha;
        let ty = ry + tmpObserver.y * cosAlpha;
        let tz = rz + tmpObserver.z * cosAlpha;
        const tangentLength = Math.hypot(tx, ty, tz);
        tx /= tangentLength; ty /= tangentLength; tz /= tangentLength;
        const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
        const dx = tmpObserver.x * cosPhi + tx * sinPhi;
        const dy = tmpObserver.y * cosPhi + ty * sinPhi;
        const dz = tmpObserver.z * cosPhi + tz * sinPhi;

        if (dx * companionDirection.x + dy * companionDirection.y + dz * companionDirection.z >= companionCos) {
          pixels[offset] = starRgb[0];
          pixels[offset + 1] = starRgb[1];
          pixels[offset + 2] = starRgb[2];
          pixels[offset + 3] = 255;
          continue;
        }

        const ex = dx * eqX.x + dy * eqX.y + dz * eqX.z;
        const ey = dx * eqY.x + dy * eqY.y + dz * eqY.z;
        const ez = dx * eqZ.x + dy * eqZ.y + dz * eqZ.z;
        const gx = GALACTIC_FROM_ICRS[0][0] * ex + GALACTIC_FROM_ICRS[0][1] * ey + GALACTIC_FROM_ICRS[0][2] * ez;
        const gy = GALACTIC_FROM_ICRS[1][0] * ex + GALACTIC_FROM_ICRS[1][1] * ey + GALACTIC_FROM_ICRS[1][2] * ez;
        const gz = Math.max(-1, Math.min(1,
          GALACTIC_FROM_ICRS[2][0] * ex + GALACTIC_FROM_ICRS[2][1] * ey + GALACTIC_FROM_ICRS[2][2] * ez));
        const longitude = -Math.atan2(gy, gx);
        const latitude = Math.asin(gz);
        const u = ((longitude / (2 * Math.PI) + 0.5) % 1 + 1) % 1;
        const v = latitude / Math.PI + 0.5;
        const imageX = Math.max(0, Math.min(sky.width - 1, Math.floor(u * sky.width)));
        const imageY = Math.max(0, Math.min(sky.height - 1, Math.round((1 - v) * (sky.height - 1))));
        const skyOffset = 4 * (imageY * sky.width + imageX);
        pixels[offset] = sky.pixels[skyOffset];
        pixels[offset + 1] = sky.pixels[skyOffset + 1];
        pixels[offset + 2] = sky.pixels[skyOffset + 2];
        pixels[offset + 3] = 255;
      }
    }
    fallbackContext.putImageData(output, 0, 0);
    fallbackCanvas.hidden = false;
  }

  function scheduleFallback() {
    if (!fallbackDirty || !assetState || performance.now() - fallbackLastRender < 350) return;
    fallbackDirty = false;
    requestAnimationFrame(() => {
      fallbackDirty = true;
      renderFallbackFrame();
    });
  }

  // --------------------------------------------------------------- modes
  function syncModeUi() {
    const overview = mode === 'overview';
    overviewSection.hidden = !overview;
    closeupSection.hidden = overview;
    overviewTab.setAttribute('aria-selected', String(overview));
    closeupTab.setAttribute('aria-selected', String(!overview));
    rig.visible = active && overview;
    reticleElement.hidden = !active || !overview;
    overviewLabels.forEach(label => { label.hidden = !active || !overview; });
    if (!active || !overview) shadowLabel.hidden = true;
    scaleContainer.hidden = !active || !overview;
    fallbackCanvas.hidden = !active || overview || !fallbackActive;
    syncBackdropVisibility();
  }

  function setMode(nextMode) {
    const normalized = nextMode === 'closeup' ? 'closeup' : 'overview';
    mode = normalized;
    syncModeUi();
    if (!active) return;
    if (mode === 'overview') {
      placeOverviewCamera();
    } else {
      ensureCloseup();
      applyPreset(activePreset === 'free' ? 'earth' : activePreset);
    }
  }

  // The rig's render-space anchor is supplied by the floating-origin owner.
  // Keeping the binary offsets as children of this anchor means AU and
  // kilometre-scale geometry is never added to the ~10^12-unit catalogue
  // coordinate before the GPU receives it.
  function setRenderAnchor(position, translateView = false) {
    if (!position?.isVector3) {
      throw new TypeError('setRenderAnchor requires a THREE.Vector3');
    }
    const dx = position.x - rig.position.x;
    const dy = position.y - rig.position.y;
    const dz = position.z - rig.position.z;
    rig.position.copy(position);
    if (translateView && active) {
      camera.position.x += dx;
      camera.position.y += dy;
      camera.position.z += dz;
      controls.target.x += dx;
      controls.target.y += dy;
      controls.target.z += dz;
    }
  }

  function getRenderAnchor(target = new THREE.Vector3()) {
    return target.copy(rig.position);
  }

  function enter(initialMode = 'overview', options = {}) {
    if (disposed) throw new Error('Cannot enter a disposed black-hole view');
    if (active) {
      setMode(initialMode);
      return;
    }
    saveView();
    if (onEnter) onEnter('black-hole');
    active = true;
    // Start the shared sky download immediately so the overview backdrop can
    // fade in during the travel sequence, before the close-up tab is opened.
    ensureSkyTexture();
    document.body.classList.add('black-hole-mode');
    currentSimDays = Number.isFinite(ctx.getSimDays?.()) ? ctx.getSimDays() : currentSimDays;
    updateOrbit(currentSimDays);
    mode = initialMode === 'closeup' ? 'closeup' : 'overview';
    syncModeUi();
    if (!options.deferCamera) resetView();
  }

  function exit() {
    if (!active) return;
    active = false;
    rig.visible = false;
    backdrop.visible = false;
    backdropOpacity = 1;
    backdropMaterial.uniforms.uOpacity.value = 1;
    fallbackCanvas.hidden = true;
    reticleElement.hidden = true;
    overviewLabels.forEach(label => { label.hidden = true; });
    shadowLabel.hidden = true;
    scaleContainer.hidden = true;
    document.body.classList.remove('black-hole-mode');
    restoreView();
    if (onExit) onExit('black-hole');
  }

  function resetView() {
    if (mode === 'overview') placeOverviewCamera();
    else {
      observerRadiusOverM = DEFAULT_OBSERVER_RADIUS_OVER_M;
      applyPreset(activePreset === 'einstein' ? 'einstein' : 'earth');
    }
  }

  function resize(width, height) {
    viewportWidth = Math.max(1, width || window.innerWidth);
    viewportHeight = Math.max(1, height || window.innerHeight);
    camera.aspect = viewportWidth / viewportHeight;
    camera.updateProjectionMatrix();
    targetWidth = targetHeight = 0;
    fallbackDirty = true;
  }

  function update(dt, simDays) {
    if (!active) return false;
    updateOrbit(Number.isFinite(simDays) ? simDays : currentSimDays);
    controls.update();
    if (mode === 'overview') {
      fallbackCanvas.hidden = true;
      backdrop.position.copy(camera.position);
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      updateReticle();
    } else {
      adaptQuality(dt);
      syncObserverRadiusFromCamera();
      reticleElement.hidden = true;
      overviewLabels.forEach(label => { label.hidden = true; });
      scaleContainer.hidden = true;
      if (closeupGpu && !fallbackActive) {
        renderCloseupGpu();
      } else {
        clearRendererBlack();
        if (fallbackActive) scheduleFallback();
      }
    }
    return true;
  }

  function onControlsStart() {
    if (active && mode === 'closeup') setPresetButtonState('free');
  }

  function onKeyDown(event) {
    if (active && event.key === 'Escape') exit();
  }

  // -------------------------------------------------------------- events
  $('#bh-exit').addEventListener('click', exit);
  overviewTab.addEventListener('click', () => setMode('overview'));
  closeupTab.addEventListener('click', () => setMode('closeup'));
  $('#bh-reset-overview').addEventListener('click', resetView);
  $('#bh-reset-closeup').addEventListener('click', resetView);
  blackHoleLabel.addEventListener('click', () => setMode('closeup'));
  ui.querySelectorAll('[data-bh-preset]').forEach(button => {
    button.addEventListener('click', () => applyPreset(button.dataset.bhPreset));
  });
  observerRadiusSlider.addEventListener('input', () => {
    setObserverRadius(observerSliderToRadius(Number(observerRadiusSlider.value)));
    setPresetButtonState('free');
  });
  qualitySelect.addEventListener('change', () => {
    qualityMode = qualitySelect.value;
    adaptiveScale = 1;
    qualityFrameCount = 0;
    qualityTime = 0;
    targetWidth = targetHeight = 0;
  });
  exposureSlider.addEventListener('input', () => {
    if (closeupGpu) {
      closeupGpu.compositeUniforms.uExposure.value = 2 ** Number(exposureSlider.value);
    }
  });
  diskToggle.addEventListener('change', () => setDiskEnabled(diskToggle.checked));
  crispToggle.addEventListener('change', () => {
    upscaleCrisp = crispToggle.checked;
    // The sampling filter is baked into the render target: recreate it.
    if (closeupTarget) {
      closeupTarget.dispose();
      closeupTarget = null;
      targetWidth = targetHeight = 0;
    }
  });
  controls.addEventListener('start', onControlsStart);
  window.addEventListener('keydown', onKeyDown);

  function dispose() {
    if (disposed) return;
    exit();
    disposed = true;
    controls.removeEventListener('start', onControlsStart);
    window.removeEventListener('keydown', onKeyDown);
    ui.remove();
    scene.remove(rig);
    scene.remove(backdrop);
    backdrop.geometry.dispose();
    backdropMaterial.dispose();
    companionGlowInner.material.dispose();
    companionGlowOuter.material.dispose();
    companionGlowTexture.dispose();
    shadowRing.geometry.dispose();
    shadowRingMaterial.dispose();
    companionMesh.geometry.dispose();
    companionMesh.material.dispose();
    horizonMesh.geometry.dispose();
    horizonMesh.material.dispose();
    locatorRing.geometry.dispose();
    locatorMaterial.dispose();
    connector.geometry.dispose();
    connector.material.dispose();
    companionOrbit.geometry.dispose();
    companionOrbit.material.dispose();
    blackHoleOrbit.geometry.dispose();
    blackHoleOrbit.material.dispose();
    if (closeupTarget) closeupTarget.dispose();
    if (closeupGpu) {
      closeupGpu.lutTexture.dispose();
      closeupGpu.material.dispose();
      closeupGpu.quadGeometry.dispose();
      closeupGpu.compositeMaterial.dispose();
      closeupGpu.compositeGeometry.dispose();
      if (closeupGpu.bloom) {
        closeupGpu.bloom.downs.forEach(target => target.dispose());
        closeupGpu.bloom.ups.forEach(target => target.dispose());
        closeupGpu.bloom.downMaterial.dispose();
        closeupGpu.bloom.upMaterial.dispose();
        closeupGpu.bloom.geometry.dispose();
      }
    }
    if (diskState) {
      diskState.trajectoryTexture.dispose();
      diskState.familyTexture.dispose();
      diskState.observerTexture.dispose();
      diskState.blackbodyTexture.dispose();
      diskState.material.dispose();
    }
    if (sharedSkyTexture) sharedSkyTexture.dispose();
  }

  updateOrbit(currentSimDays);
  syncModeUi();

  return {
    enter,
    exit,
    update,
    resize,
    resetView,
    setMode,
    setBackdropFade,
    setRenderAnchor,
    getRenderAnchor,
    getLogicalPosition: () => logicalPosition,
    getSceneUnitsPerAU: () => sceneUnitsPerAU,
    getOverviewCameraOffset: (target = new THREE.Vector3()) => target.copy(overviewCameraOffset),
    getPhysicalScales: () => ({
      gravitationalRadiusScene,
      horizonRadiusScene,
      closeupObserverRadiusScene,
      observerRadiusRangeOverM: [
        OBSERVER_RADIUS_MIN_OVER_M,
        OBSERVER_RADIUS_MAX_OVER_M,
      ],
    }),
    getMode: () => mode,
    isActive: () => active,
    dispose,
    usesOwnRendering: true,
  };
}

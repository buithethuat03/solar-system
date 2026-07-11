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

const J2000_JD = 2451545.0;
const AU_PER_SOLAR_RADIUS = 0.00465046726096;
const DEFAULT_OBSERVER_RADIUS_OVER_M = 30;
const CLOSEUP_FOV_DEG = 55;
const LUT_WIDTH = 512;
const LUT_HEIGHT = 512;
const LUT_R_MIN = 6;
const LUT_R_MAX = 100;
// The table is centre-sampled, so interactive dolly stays inside its first and
// last physical rows instead of clamping an exact endpoint to a nearby row.
const OBSERVER_RADIUS_MIN_OVER_M = LUT_R_MIN + (LUT_R_MAX - LUT_R_MIN) * 0.5 / LUT_HEIGHT;
const OBSERVER_RADIUS_MAX_OVER_M = LUT_R_MAX - (LUT_R_MAX - LUT_R_MIN) * 0.5 / LUT_HEIGHT;
const LUT_SAMPLE_MIN = 1e-6;
const LUT_SAMPLE_SPLIT = 0.08;
// C1 join between the logarithmic near-critical and linear broad-field LUT
// coordinates; must match tools/generate_blackhole_lut.mjs exactly.
const LUT_LOOKUP_SPLIT = 0.49538788727464705;
const CRITICAL_IMPACT_OVER_M = 3 * Math.sqrt(3);
const GALACTIC_FROM_ICRS = Object.freeze([
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [ 0.4941094279, -0.4448296300,  0.7469822445],
  [-0.8676661490, -0.1980763734,  0.4559837762],
]);

const FULLSCREEN_VERTEX = /* glsl */ `
  precision highp float;
  in vec3 position;
  in vec2 uv;
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const LENSING_FRAGMENT = /* glsl */ `
  precision highp float;
  precision highp sampler2D;

  in vec2 vUv;
  out vec4 outColor;

  uniform sampler2D uDeflectionLut;
  uniform sampler2D uSky;
  uniform vec3 uObserverDir;
  uniform vec3 uCameraRight;
  uniform vec3 uCameraUp;
  uniform vec3 uEqX;
  uniform vec3 uEqY;
  uniform vec3 uEqZ;
  uniform vec3 uCompanionDir;
  uniform vec3 uCompanionColor;
  uniform float uCompanionAngularRadius;
  uniform float uObserverRadiusOverM;
  uniform float uAspect;
  uniform float uTanHalfFov;

  const float PI = 3.1415926535897932384626433832795;
  const float B_CRIT = 5.1961524227066318806;
  const float R_MIN = 6.0;
  const float R_MAX = 100.0;
  const float S_MIN = 0.000001;
  const float S_SPLIT = 0.08;
  const float Q_SPLIT = 0.49538788727464705;
  const ivec2 LUT_SIZE = ivec2(512, 512);

  vec3 srgbToLinear(vec3 color) {
    vec3 low = color / 12.92;
    vec3 high = pow((color + 0.055) / 1.055, vec3(2.4));
    return mix(low, high, step(vec3(0.04045), color));
  }

  float lookupCoordinate(float s) {
    if (s <= S_SPLIT) {
      if (s <= S_MIN) return 0.0;
      return Q_SPLIT * log(s / S_MIN) / log(S_SPLIT / S_MIN);
    }
    return Q_SPLIT + (1.0 - Q_SPLIT) * (s - S_SPLIT) / (1.0 - S_SPLIT);
  }

  vec2 sampleLutBilinear(vec2 uv) {
    vec2 pixel = uv * vec2(LUT_SIZE) - 0.5;
    ivec2 i0 = clamp(ivec2(floor(pixel)), ivec2(0), LUT_SIZE - 1);
    ivec2 i1 = min(i0 + 1, LUT_SIZE - 1);
    vec2 f = clamp(fract(pixel), 0.0, 1.0);
    vec2 a = texelFetch(uDeflectionLut, ivec2(i0.x, i0.y), 0).rg;
    vec2 b = texelFetch(uDeflectionLut, ivec2(i1.x, i0.y), 0).rg;
    vec2 c = texelFetch(uDeflectionLut, ivec2(i0.x, i1.y), 0).rg;
    vec2 d = texelFetch(uDeflectionLut, ivec2(i1.x, i1.y), 0).rg;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  vec2 gaiaEquirectangularUv(vec3 sceneDirection) {
    vec3 eq = vec3(
      dot(sceneDirection, uEqX),
      dot(sceneDirection, uEqY),
      dot(sceneDirection, uEqZ)
    );
    vec3 gal = vec3(
      -0.0548755604 * eq.x - 0.8734370902 * eq.y - 0.4838350155 * eq.z,
       0.4941094279 * eq.x - 0.4448296300 * eq.y + 0.7469822445 * eq.z,
      -0.8676661490 * eq.x - 0.1980763734 * eq.y + 0.4559837762 * eq.z
    );
    gal = normalize(gal);
    float longitude = -atan(gal.y, gal.x); // astronomical longitude grows left
    float latitude = asin(clamp(gal.z, -1.0, 1.0));
    return vec2(fract(longitude / (2.0 * PI) + 0.5), latitude / PI + 0.5);
  }

  void main() {
    vec2 screen = vUv * 2.0 - 1.0;
    vec3 ray = normalize(
      -uObserverDir
      + uCameraRight * (screen.x * uAspect * uTanHalfFov)
      + uCameraUp * (screen.y * uTanHalfFov)
    );

    float cosAlpha = clamp(dot(ray, -uObserverDir), -1.0, 1.0);
    float alpha = acos(cosAlpha);
    float shadow = asin(clamp(
      B_CRIT * sqrt(1.0 - 2.0 / uObserverRadiusOverM) / uObserverRadiusOverM,
      0.0, 1.0
    ));

    // Captured null geodesics end at the horizon. The black region is not a
    // mesh or a texture and no artificial rim is added at this branch.
    if (alpha <= shadow) {
      outColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    float s = sqrt(clamp((alpha - shadow) / (0.5 * PI - shadow), 0.0, 1.0));
    float q = lookupCoordinate(s);
    float rCoordinate = clamp(
      (uObserverRadiusOverM - R_MIN) / (R_MAX - R_MIN), 0.0, 1.0
    );
    float phi = sampleLutBilinear(vec2(q, rCoordinate)).r;

    vec3 tangent = normalize(ray + uObserverDir * cosAlpha);
    vec3 sourceDirection = normalize(
      uObserverDir * cos(phi) + tangent * sin(phi)
    );

    vec3 sky = srgbToLinear(texture(uSky, gaiaEquirectangularUv(sourceDirection)).rgb);

    // At ~1 AU the companion is millions of M from the close observer, so its
    // finite angular disc is accurately treated as a directional source before
    // the same geodesic mapping. Surface brightness is conserved by lensing.
    float sourceSeparation = acos(clamp(dot(sourceDirection, uCompanionDir), -1.0, 1.0));
    float edgeWidth = max(fwidth(sourceSeparation), 0.00002);
    float companion = 1.0 - smoothstep(
      uCompanionAngularRadius - edgeWidth,
      uCompanionAngularRadius + edgeWidth,
      sourceSeparation
    );
    vec3 color = mix(sky, uCompanionColor, companion);
    outColor = vec4(color, 1.0);
  }
`;

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
  let fallbackDirty = true;
  let fallbackLastRender = 0;
  let fallbackActive = false;
  let fallbackReason = '';
  let assetsPromise = null;
  let assetState = null;
  let closeupGpu = null;
  let closeupTarget = null;
  let targetWidth = 0;
  let targetHeight = 0;

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
          <span><i class="bh-key bh-key-star"></i>${message('bhLegendCompanion', 'Companion star · physical radius')}</span>
          <span><i class="bh-key bh-key-black-hole"></i>${message('bhLegendBlackHole', 'Black-hole position')}</span>
          <span><i class="bh-key bh-key-barycentre"></i>${message('bhLegendBarycentre', 'Shared barycentre')}</span>
          <span><i class="bh-key bh-key-orbits"></i>${message('bhLegendOrbits', 'Barycentric orbit paths')}</span>
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
          <label>${message('bhQuality', 'Render quality')}
            <select id="bh-quality">
              <option value="auto">${message('bhQualityAuto', 'Auto')}</option>
              <option value="high">${message('bhQualityHigh', 'High · 100%')}</option>
              <option value="medium">${message('bhQualityMedium', 'Medium · 75%')}</option>
              <option value="low">${message('bhQualityLow', 'Low · 50%')}</option>
            </select>
          </label>
          <button type="button" id="bh-reset-closeup">${message('bhResetView', 'Reset view')}</button>
        </div>
        <div class="bh-readout">
          <span>${message('bhObserverDistance', 'Static observer radius')}</span><output id="bh-observer-distance">—</output>
          <span>${message('bhTimeDilation', 'dτ/dt')}</span><output id="bh-time-dilation">—</output>
          <span>${message('bhShadowAngularDiameter', 'Shadow angular diameter')}</span><output id="bh-shadow-angle">—</output>
          <span>${message('bhFieldOfView', 'Vertical field of view')}</span><output>${CLOSEUP_FOV_DEG}°</output>
        </div>
        <p class="bh-warning">${message('bhStaticObserverWarning', 'This is a hypothetical static observer; remaining at any selected radius requires continuous thrust.')}</p>
        <p>${message('bhSkyCaveat', 'The Gaia map is a display-mapped reference sky observed from the Solar System. The geodesic geometry is modeled; this is not calibrated photometry or the exact sky at Gaia BH1.')}</p>
        <div class="bh-status" id="bh-status" role="status" aria-live="polite"></div>
      </section>
      <section class="bh-sources" id="bh-sources"></section>
    </main>
    <div class="bh-reticle" id="bh-reticle" aria-hidden="true"></div>
    <button class="bh-scene-label bh-label-black-hole" id="bh-label-black-hole" type="button" aria-label="${message('bhOpenCloseup', 'Open Schwarzschild close-up')}">${message('bhSceneBlackHole', 'Black hole · physical position')}</button>
    <div class="bh-scene-label bh-label-companion" id="bh-label-companion" aria-hidden="true">${message('bhSceneCompanion', 'G-type companion')}</div>
    <div class="bh-scene-label bh-label-barycentre" id="bh-label-barycentre" aria-hidden="true">${message('bhSceneBarycentre', 'Barycentre')}</div>
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
  const shadowAngleOutput = $('#bh-shadow-angle');
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
  rig.add(blackHoleAnchor);

  const connectorGeometry = new THREE.BufferGeometry();
  connectorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const connector = new THREE.Line(connectorGeometry, new THREE.LineBasicMaterial({
    color: 0x7a8da8,
    transparent: true,
    opacity: 0.24,
    toneMapped: false,
  }));
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
      opacity: key === 'star' ? 0.48 : 0.32,
      toneMapped: false,
    });
    const path = new THREE.Line(geometry, material);
    path.name = `${key} barycentric orbit`;
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
  const earthToSystem = vectorFromArray(Object.values(Physics.equatorialToSceneDirection(
    quantityValue(data.coordinates?.raDeg),
    quantityValue(data.coordinates?.decDeg ?? data.coordinates?.declinationDeg),
  )));
  const earthLineObserver = earthToSystem.clone().negate();

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

    if (closeupGpu) updateCompanionUniforms();
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
      scaleContainer.hidden = true;
      return;
    }
    locatorRing.quaternion.copy(camera.quaternion);
    const rect = renderer.domElement.getBoundingClientRect();
    placeOverviewOverlay(reticleElement, blackHoleAnchor, rect);
    placeOverviewOverlay(blackHoleLabel, blackHoleAnchor, rect);
    placeOverviewOverlay(companionLabel, companionMesh, rect);
    placeOverviewOverlay(barycentreLabel, rig, rect);
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
    camera.far = sceneUnitsPerAU * 50;
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
    if (closeupGpu) {
      closeupGpu.uniforms.uObserverRadiusOverM.value = observerRadiusOverM;
    }
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
    if (closeupGpu) {
      closeupGpu.uniforms.uObserverRadiusOverM.value = observerRadiusOverM;
    }
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
    if (closeupGpu) {
      closeupGpu.uniforms.uObserverRadiusOverM.value = observerRadiusOverM;
    }
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

  async function loadCloseupAssets() {
    const lutUrl = new URL('../textures/blackhole/schwarzschild-lut-512x512-rg32f.bin', import.meta.url);
    const skyUrl = new URL('../textures/blackhole/gaia_sky_equirectangular.jpg', import.meta.url);
    const [response, skyTexture] = await Promise.all([
      fetch(lutUrl),
      loadTexture(skyUrl.href),
    ]);
    if (!response.ok) throw new Error(`Schwarzschild LUT HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const expectedBytes = LUT_WIDTH * LUT_HEIGHT * 2 * Float32Array.BYTES_PER_ELEMENT;
    if (buffer.byteLength !== expectedBytes) {
      throw new Error(`Schwarzschild LUT has ${buffer.byteLength} bytes; expected ${expectedBytes}`);
    }
    skyTexture.colorSpace = THREE.NoColorSpace;
    skyTexture.wrapS = THREE.RepeatWrapping;
    skyTexture.wrapT = THREE.ClampToEdgeWrapping;
    skyTexture.minFilter = THREE.LinearFilter;
    skyTexture.magFilter = THREE.LinearFilter;
    skyTexture.generateMipmaps = true;
    return { lutValues: new Float32Array(buffer), skyTexture };
  }

  function createCloseupGpu(assets) {
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
    };
    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: LENSING_FRAGMENT,
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

    const blitScene = new THREE.Scene();
    const blitMaterial = new THREE.MeshBasicMaterial({
      map: null,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const blitQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMaterial);
    blitQuad.frustumCulled = false;
    blitScene.add(blitQuad);
    return {
      lutTexture,
      uniforms,
      material,
      fullscreenScene,
      fullscreenCamera,
      quadGeometry,
      blitScene,
      blitMaterial,
      blitGeometry: blitQuad.geometry,
    };
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
          closeupGpu = createCloseupGpu(assets);
          let shaderError = null;
          const previousShaderErrorHandler = renderer.debug.onShaderError;
          renderer.debug.onShaderError = (...args) => {
            shaderError = new Error('The Schwarzschild lensing shader did not compile');
            if (typeof previousShaderErrorHandler === 'function') previousShaderErrorHandler(...args);
          };
          try {
            renderer.compile(closeupGpu.fullscreenScene, closeupGpu.fullscreenCamera);
          } finally {
            renderer.debug.onShaderError = previousShaderErrorHandler;
          }
          if (shaderError) throw shaderError;
          updateCompanionUniforms();
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
    fallbackDirty = true;
  }

  function selectedRenderScale() {
    if (qualityMode === 'high') return 1;
    if (qualityMode === 'medium') return 0.75;
    if (qualityMode === 'low') return 0.5;
    return adaptiveScale;
  }

  function adaptQuality(dt) {
    if (qualityMode !== 'auto') return;
    qualityFrameCount++;
    qualityTime += Math.min(0.1, Math.max(0, dt || 0));
    if (qualityFrameCount < 90) return;
    const fps = qualityFrameCount / Math.max(0.001, qualityTime);
    const previous = adaptiveScale;
    if (fps < 42) adaptiveScale = adaptiveScale === 1 ? 0.75 : 0.5;
    else if (fps > 57) adaptiveScale = adaptiveScale === 0.5 ? 0.75 : 1;
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
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
      });
      closeupTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
      closeupTarget.texture.generateMipmaps = false;
      closeupGpu.blitMaterial.map = closeupTarget.texture;
      targetWidth = width;
      targetHeight = height;
    } else if (width !== targetWidth || height !== targetHeight) {
      closeupTarget.setSize(width, height);
      targetWidth = width;
      targetHeight = height;
    }
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
      renderer.setRenderTarget(null);
      renderer.render(closeupGpu.blitScene, closeupGpu.fullscreenCamera);
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
    scaleContainer.hidden = !active || !overview;
    fallbackCanvas.hidden = !active || overview || !fallbackActive;
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
    fallbackCanvas.hidden = true;
    reticleElement.hidden = true;
    overviewLabels.forEach(label => { label.hidden = true; });
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
      closeupGpu.blitMaterial.dispose();
      closeupGpu.blitGeometry.dispose();
    }
    if (assetState?.skyTexture) assetState.skyTexture.dispose();
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

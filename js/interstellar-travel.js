// ============================================================================
//  interstellar-travel.js — the floating-origin journey to Gaia BH1.
//
//  Moves the render origin, not kilometre/AU-scale objects, across the
//  interstellar baseline. The catalogue coordinate remains Float64 logical
//  state; only the small difference `object - worldOrigin` is uploaded to GPU
//  matrices near BH1. The overlay reports nominal and remaining distance and
//  makes explicit that this is camera motion, not a physical flight time.
// ============================================================================
import * as THREE from 'three';
import { t } from './i18n.js';

export function createInterstellarTravel(ctx) {
  const {
    camera, controls, systemRoot, blackHole,
    absolute,          // Float64-derived scene position of BH1 (Vector3)
    renderAnchor,      // shared mutable anchor blackhole.js renders around
    logical,           // interstellarScenePosition() result
    distanceLabel,     // human-readable nominal distance string
    config,            // CONFIG (DIST_REAL_K, KM_PER_AU)
    reducedMotion,
  } = ctx;

  const travel = {
    active: false,
    startedAt: 0,
    durationMs: reducedMotion ? 900 : 5200,
    worldOrigin: new THREE.Vector3(),
  };
  const cameraStart = new THREE.Vector3();
  const cameraEnd = new THREE.Vector3();

  const overlay = document.createElement('section');
  overlay.className = 'bh-travel';
  overlay.hidden = true;
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = `
    <strong>${t('bhTravelTitle')}</strong>
    <div class="bh-travel-row"><span>${t('bhTravelNominal')}</span><output id="bh-travel-nominal"></output></div>
    <div class="bh-travel-row"><span>${t('bhTravelRemaining')}</span><output id="bh-travel-remaining"></output></div>
    <div class="bh-travel-track" aria-hidden="true"><i id="bh-travel-progress"></i></div>
    <small id="bh-travel-note">${t('bhTravelNote')}</small>
  `;
  document.body.appendChild(overlay);
  const nominalOutput = overlay.querySelector('#bh-travel-nominal');
  const remainingOutput = overlay.querySelector('#bh-travel-remaining');
  const progressBar = overlay.querySelector('#bh-travel-progress');
  const note = overlay.querySelector('#bh-travel-note');
  nominalOutput.textContent = distanceLabel;

  function formatDistance(sceneDistance) {
    const au = Math.max(0, sceneDistance) / config.DIST_REAL_K;
    const auPerParsec = logical.distanceAU / logical.distancePc;
    const parsec = au / auPerParsec;
    if (parsec >= 0.01) return `${parsec.toFixed(parsec >= 100 ? 1 : 2)} pc`;
    if (au >= 0.01) return `${au.toLocaleString(undefined, { maximumFractionDigits: 2 })} AU`;
    return `${(au * config.KM_PER_AU).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
  }

  function updateOverlay(remainingSceneDistance, animationProgress) {
    remainingOutput.textContent = formatDistance(remainingSceneDistance);
    progressBar.style.width = `${Math.max(0, Math.min(1, animationProgress)) * 100}%`;
  }

  function begin() {
    travel.active = true;
    travel.startedAt = performance.now();
    travel.worldOrigin.set(0, 0, 0);
    cameraStart.copy(camera.position);
    blackHole.getOverviewCameraOffset(cameraEnd);
    systemRoot.position.set(0, 0, 0);
    renderAnchor.copy(absolute);
    blackHole.setRenderAnchor(renderAnchor);
    blackHole.setBackdropFade(0);
    document.body.classList.add('black-hole-traveling');
    overlay.hidden = false;
    overlay.classList.remove('arriving');
    note.textContent = t('bhTravelNote');
    updateOverlay(logical.distanceSceneUnits, 0);

    controls.enabled = false;
    controls.target.copy(renderAnchor);
    camera.far = logical.distanceSceneUnits * 1.05;
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
  }

  function finish() {
    travel.active = false;
    travel.worldOrigin.copy(absolute);
    systemRoot.position.copy(absolute).multiplyScalar(-1);
    renderAnchor.set(0, 0, 0);
    blackHole.setRenderAnchor(renderAnchor);
    blackHole.setBackdropFade(1);
    blackHole.resetView();
    document.body.classList.remove('black-hole-traveling');
    overlay.hidden = true;
    overlay.classList.remove('arriving');
  }

  // Abandon the journey without arriving (used when the BH mode exits).
  function cancel() {
    travel.active = false;
    travel.worldOrigin.set(0, 0, 0);
    document.body.classList.remove('black-hole-traveling');
    overlay.hidden = true;
    overlay.classList.remove('arriving');
  }

  function update() {
    if (!travel.active) return;
    // A close-up selection is an explicit request to arrive immediately; its
    // observer is then placed at the physical 30 GM/c^2 radius by blackhole.js.
    if (blackHole.getMode() !== 'overview') {
      finish();
      return;
    }

    const linear = Math.min(1,
      (performance.now() - travel.startedAt) / travel.durationMs);
    const eased = linear < 0.5
      ? 2 * linear * linear
      : 1 - Math.pow(-2 * linear + 2, 2) / 2;

    // Traverse equal logarithmic distance decades for most of the animation,
    // then close the last true-scale AU smoothly. This is camera motion through
    // the measured baseline, not a shortening of that baseline.
    const arrivalFraction = 0.94;
    let remainingFraction;
    if (eased < arrivalFraction) {
      const decadeProgress = eased / arrivalFraction;
      remainingFraction = Math.exp(Math.log(1e-8) * decadeProgress);
    } else {
      const finalProgress = (eased - arrivalFraction) / (1 - arrivalFraction);
      remainingFraction = 1e-8 * (1 - finalProgress) ** 2;
    }

    // Compute the small near-target remainder directly. Deriving it by
    // subtracting two ~10^12-unit vectors would reintroduce cancellation just
    // where the binary's kilometre/AU detail matters most.
    renderAnchor.copy(absolute).multiplyScalar(remainingFraction);
    travel.worldOrigin.copy(absolute).sub(renderAnchor);
    systemRoot.position.copy(travel.worldOrigin).multiplyScalar(-1);
    blackHole.setRenderAnchor(renderAnchor);

    camera.position.lerpVectors(cameraStart, cameraEnd, eased);
    controls.target.copy(renderAnchor);
    camera.lookAt(controls.target);

    // Blend the Gaia reference sky over the Solar System's backdrop through the
    // final ~1.4 s, so the far-plane snap at arrival only clips geometry that
    // is already fully covered — no black flash, no star pop.
    const arrivalFade = THREE.MathUtils.smoothstep(eased, 0.86, 0.985);
    blackHole.setBackdropFade(arrivalFade);
    const arriving = arrivalFade > 0;
    if (arriving !== overlay.classList.contains('arriving')) {
      overlay.classList.toggle('arriving', arriving);
      note.textContent = arriving ? t('bhTravelArriving') : t('bhTravelNote');
    }

    const solarDistance = travel.worldOrigin.length();
    const targetDistance = renderAnchor.length();
    updateOverlay(targetDistance, linear);
    camera.far = Math.max(config.DIST_REAL_K * 50, solarDistance, targetDistance) * 1.05;
    camera.updateProjectionMatrix();

    if (linear >= 1) finish();
  }

  return {
    get active() { return travel.active; },
    get durationMs() { return travel.durationMs; },
    worldOrigin: travel.worldOrigin,
    begin, update, cancel,
  };
}

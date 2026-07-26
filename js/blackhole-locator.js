// ============================================================================
//  blackhole-locator.js — the clickable on-screen marker for Gaia BH1.
//
//  Distant-object locator for the actual Float64 catalogue position. At
//  Solar-System scale its 3D geometry is necessarily sub-pixel, so this
//  projected DOM marker remains clickable; focusing it starts the
//  floating-origin journey to the real anchor.
// ============================================================================
import * as THREE from 'three';
import { equatorialToSceneDirection } from './blackhole-physics.js';

export function createBlackHoleLocator({ camera, data, distanceLabel, onSelect, isHidden }) {
  const coordValue = (quantity) => (typeof quantity === 'number' ? quantity : quantity?.value);
  const directionData = equatorialToSceneDirection(
    coordValue(data.coordinates.raDeg),
    coordValue(data.coordinates.decDeg),
  );
  const direction = new THREE.Vector3(directionData.x, directionData.y, directionData.z);
  const world = new THREE.Vector3();
  const forward = new THREE.Vector3();

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bh-orrery-locator';
  button.dataset.id = data.id;
  button.setAttribute('aria-label', `${data.name} — ${distanceLabel}`);
  button.innerHTML = `<span class="bh-locator-mark" aria-hidden="true">◎</span><span><b>${data.name}</b><small>${distanceLabel}</small></span>`;
  let lastDown = -Infinity;
  button.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    const now = performance.now();
    const focus = now - lastDown < 350;
    lastDown = focus ? -Infinity : now;
    onSelect(data, focus);
  });
  document.body.appendChild(button);

  function update() {
    camera.getWorldDirection(forward);
    const facesCamera = forward.dot(direction) > 0;
    world.copy(camera.position).addScaledVector(direction, 1.0e6).project(camera);
    const inFrame = Math.abs(world.x) <= 1.04 && Math.abs(world.y) <= 1.04
      && world.z >= -1 && world.z <= 1;
    const visible = !isHidden() && facesCamera && inFrame;
    button.style.display = visible ? '' : 'none';
    if (!visible) return;
    button.style.left = `${(world.x * 0.5 + 0.5) * window.innerWidth}px`;
    button.style.top = `${(-world.y * 0.5 + 0.5) * window.innerHeight}px`;
  }

  return { update };
}

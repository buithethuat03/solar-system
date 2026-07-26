// Orientation conventions: orbital direction of moons/belts and IAU spin
// poles. These pins encode PHYSICS (prograde sweep, real obliquities), not a
// coordinate convention, so a future convention change cannot silently
// reintroduce the backwards-moons bug or the axis-toward-−X seasons bug.
// Run: node tools/test_orientation.mjs
import assert from 'node:assert/strict';

import {
  equatorialToSceneVec,
  moonOrbitPosition,
  spinAngularMomentumDir,
  ECL_OBLIQUITY_DEG,
} from '../js/astro-math.js';
import { heliocentric } from '../js/kepler.js';
import { PLANETS, SUN, MOONS } from '../js/data.js';

let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

function close(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} +/- ${tolerance}, received ${actual}`);
}

const angleFromEclipticNorthDeg = (v) => {
  const length = Math.hypot(v.x, v.y, v.z);
  return Math.acos(v.y / length) * 180 / Math.PI;
};

console.log('\nOrientation convention tests');

check('planet heliocentric motion is prograde about scene +Y (ground truth)', () => {
  for (const planet of PLANETS.filter(p => !p.isDwarf && p.id !== 'pluto')) {
    const a = heliocentric(planet, 0);
    const b = heliocentric(planet, 1);
    const angularMomentumY = a.z * (b.x - a.x) - a.x * (b.z - a.z);
    assert.ok(angularMomentumY > 0,
      `${planet.id}: (r x dr).y must be positive for prograde motion`);
  }
});

check('moonOrbitPosition sweeps the same prograde direction as the planets', () => {
  const dt = 1e-3;
  const a = moonOrbitPosition(0.7, 5);
  const b = moonOrbitPosition(0.7 + dt, 5);
  const forward = a.z * (b.x - a.x) - a.x * (b.z - a.z);
  assert.ok(forward > 0, 'growing angle must be prograde (+X toward −Z)');
  // A negative period (Triton) advances the angle backwards → retrograde.
  const c = moonOrbitPosition(0.7 - dt, 5);
  const backward = a.z * (c.x - a.x) - a.x * (c.z - a.z);
  assert.ok(backward < 0, 'shrinking angle must be retrograde');
  const triton = MOONS.find(m => m.id === 'triton');
  assert.ok(triton.periodDays < 0, 'Triton keeps its retrograde period sign');
});

check('Moon data carries the orbital inclination, not the axial obliquity', () => {
  const moon = MOONS.find(m => m.id === 'moon');
  close(moon.tilt, 5.145, 1e-9, 'inclination to the ecliptic');
});

check('equatorialToSceneVec maps the celestial pole onto the tilted ecliptic frame', () => {
  const pole = equatorialToSceneVec(0, 90);
  const eps = ECL_OBLIQUITY_DEG * Math.PI / 180;
  close(pole.x, 0, 1e-12, 'pole x');
  close(pole.y, Math.cos(eps), 1e-12, 'pole y');
  close(pole.z, -Math.sin(eps), 1e-12, 'pole z');
  const equinox = equatorialToSceneVec(0, 0);
  close(equinox.x, 1, 1e-12, 'vernal equinox stays on +X');
});

check('IAU poles + signed rotation reproduce the known obliquities', () => {
  // Spin angular momentum vs ecliptic north (scene +Y). Tolerances allow for
  // ecliptic-vs-orbit-normal slack; the values pin the physics.
  const expectations = [
    ['earth', 23.44, 1.0],
    ['mars', 26.7, 2.5],      // vs ecliptic (axial tilt 25.19 is vs its own orbit)
    ['jupiter', 2.2, 2.0],
    ['saturn', 28.1, 2.5],
    ['venus', 177.4, 2.5],    // retrograde: spin L points near ecliptic south
    ['uranus', 97.8, 2.5],
    ['neptune', 28.3, 2.5],
  ];
  for (const [id, expectedDeg, tolerance] of expectations) {
    const planet = PLANETS.find(p => p.id === id);
    assert.ok(planet.pole, `${id} has an IAU pole`);
    const spin = spinAngularMomentumDir(planet.pole, planet.rotationHours);
    close(angleFromEclipticNorthDeg(spin), expectedDeg, tolerance,
      `${id} spin axis vs ecliptic north`);
  }
  // Pluto: obliquity 122.5° is measured against its own orbit, which is itself
  // inclined 17° to the ecliptic — so vs ecliptic north anything in the
  // combined band is physical (the IAU pole gives ≈112.8°).
  const pluto = PLANETS.find(p => p.id === 'pluto');
  const plutoAngle = angleFromEclipticNorthDeg(
    spinAngularMomentumDir(pluto.pole, pluto.rotationHours));
  assert.ok(plutoAngle > 100 && plutoAngle < 140,
    `Pluto spin axis vs ecliptic north in (100, 140): received ${plutoAngle}`);
  const sunSpin = spinAngularMomentumDir(SUN.pole, SUN.rotationHours);
  close(angleFromEclipticNorthDeg(sunSpin), 7.25, 1.0, 'Sun spin axis');
});

check('no body double-counts retrograde (obliquity > 90 with negative hours)', () => {
  for (const planet of [...PLANETS, SUN]) {
    if (!planet.pole) continue;
    const spinAngle = angleFromEclipticNorthDeg(
      spinAngularMomentumDir(planet.pole, planet.rotationHours));
    if (planet.axialTilt > 90) {
      assert.ok(spinAngle > 90,
        `${planet.id}: listed obliquity > 90 must yield a southward spin axis`);
    }
  }
  // Pluto's IAU right-hand-rule pole already encodes the sense: positive hours.
  const pluto = PLANETS.find(p => p.id === 'pluto');
  assert.ok(pluto.rotationHours > 0, 'Pluto spin is positive about its IAU pole');
});

console.log(`\n  ${passed} passed, 0 failed`);

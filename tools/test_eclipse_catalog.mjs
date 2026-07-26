// Eclipse catalog schema + the headline cross-check: every canon row must be
// reproduced by the app's OWN ephemeris chain (Meeus Moon + kepler Sun + ΔT)
// to tight tolerances. A silently corrupted catalog row, table typo, or
// timescale bug fails loudly here. Run: node tools/test_eclipse_catalog.mjs
import assert from 'node:assert/strict';

import { ECLIPSES } from '../js/eclipse_catalog.js';
import {
  apparentGeometry,
  antisolarSeparationDeg,
  solarEventGeometry,
  lunarEventGeometry,
  nextEclipse,
  isoToSimDays,
} from '../js/eclipse_math.js';
import { findPhaseNear } from '../js/moon.js';

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

console.log('\nEclipse catalog tests');

check('catalog schema is sound and chronological', () => {
  assert.ok(ECLIPSES.length > 150, `events: ${ECLIPSES.length}`);
  let previous = -Infinity;
  for (const ev of ECLIPSES) {
    const t = isoToSimDays(ev.d);
    assert.ok(Number.isFinite(t) && t > previous, `ordered at ${ev.d}`);
    previous = t;
    assert.ok(ev.t === 'S' || ev.t === 'L');
    assert.ok((ev.t === 'S' ? 'TAHP' : 'TPN').includes(ev.k), `kind ${ev.k}`);
    assert.ok(Math.abs(ev.g) <= 1.9, `gamma ${ev.g} at ${ev.d}`);
    assert.ok(ev.s >= 90 && ev.s <= 160, `saros ${ev.s}`);
    if (ev.t === 'S') assert.ok(ev.m > 0 && ev.m < 1.12, `solar mag ${ev.m}`);
  }
  const solar = ECLIPSES.filter(e => e.t === 'S').length;
  assert.ok(solar > 80 && ECLIPSES.length - solar > 80, 'both catalogs present');
});

check('known anchors match the canon exactly', () => {
  const find = d => ECLIPSES.find(e => e.d.startsWith(d));
  const e2024 = find('2024-04-08');
  assert.equal(e2024.k, 'T');
  assert.equal(e2024.s, 139);
  assert.ok(Math.abs(e2024.g - 0.3431) < 1e-3 && Math.abs(e2024.m - 1.0566) < 1e-3);
  assert.ok(Math.abs(e2024.dur - 268) <= 1, '4m28s totality');
  const e2027 = find('2027-08-02');
  assert.ok(e2027.k === 'T' && e2027.s === 136 && Math.abs(e2027.dur - 383) <= 1);
  const l2025 = find('2025-09-07');
  assert.ok(l2025 && l2025.t === 'L' && l2025.k === 'T' && Math.abs(l2025.m - 1.362) < 5e-3);
});

check('every solar row is reproduced by the app ephemeris (gamma < 0.05 off)', () => {
  let maxGammaError = 0;
  let maxPhaseOffsetMin = 0;
  for (const ev of ECLIPSES) {
    if (ev.t !== 'S') continue;
    const t = isoToSimDays(ev.d);
    const geom = apparentGeometry(t);
    // Shadow-axis distance from the geocentre in Earth radii ≈ sep / parallax.
    const gammaComputed = geom.sepDeg / geom.moonParallaxDeg;
    const err = Math.abs(gammaComputed - Math.abs(ev.g));
    maxGammaError = Math.max(maxGammaError, err);
    assert.ok(err < 0.05, `gamma mismatch ${err.toFixed(4)} at ${ev.d}`);
    const newMoon = findPhaseNear(t, 0);
    const offset = Math.abs(newMoon - t) * 1440;
    maxPhaseOffsetMin = Math.max(maxPhaseOffsetMin, offset);
    assert.ok(offset < 60, `new moon ${offset.toFixed(1)} min from greatest at ${ev.d}`);
  }
  console.log(`    max |Δgamma| = ${maxGammaError.toFixed(4)}, `
    + `max new-moon offset = ${maxPhaseOffsetMin.toFixed(1)} min`);
});

check('every lunar row is reproduced (umbral magnitude < 0.08 off)', () => {
  let maxMagError = 0;
  for (const ev of ECLIPSES) {
    if (ev.t !== 'L') continue;
    const t = isoToSimDays(ev.d);
    assert.ok(antisolarSeparationDeg(t) < 1.6, `near opposition at ${ev.d}`);
    const geom = lunarEventGeometry(ev);
    const err = Math.abs(geom.umbralMagnitude - ev.m);
    maxMagError = Math.max(maxMagError, err);
    assert.ok(err < 0.08, `umbral magnitude off ${err.toFixed(3)} at ${ev.d}`);
    assert.ok(geom.umbraFrac > 2.2 && geom.umbraFrac < 3.0, `umbra ratio ${geom.umbraFrac}`);
    assert.ok(geom.penumbraFrac > 4.2 && geom.penumbraFrac < 5.2,
      `penumbra ratio ${geom.penumbraFrac}`);
  }
  console.log(`    max |Δmagnitude| = ${maxMagError.toFixed(4)}`);
});

check('solar geometry yields sane POV windows and classes', () => {
  for (const d of ['2024-04-08', '2026-08-12', '2027-08-02', '2030-06-01']) {
    const ev = ECLIPSES.find(e => e.d.startsWith(d));
    const g = solarEventGeometry(ev);
    assert.ok(g.tC1 < g.tMax && g.tMax < g.tC4, `ordered contacts at ${d}`);
    const hours = (g.tC4 - g.tC1) * 24;
    // High-|gamma| grazers (2026-08-12, g=0.898) have legitimately long
    // geocentric windows — the separation dips shallowly.
    assert.ok(hours > 1 && hours < 7, `window ${hours.toFixed(2)} h at ${d}`);
    if (ev.k === 'T') assert.ok(g.k > 1, `Moon appears larger for a total (${d})`);
    if (ev.k === 'A') assert.ok(g.k < 1, `Moon appears smaller for an annular (${d})`);
    if (ev.k === 'T' || ev.k === 'A') assert.equal(g.sepMinFrac, 0);
  }
});

check('nextEclipse navigates the catalog both ways', () => {
  const t0 = isoToSimDays('2026-01-01T00:00:00Z');
  const next = nextEclipse(t0, 1);
  assert.ok(isoToSimDays(next.d) >= t0);
  const prev = nextEclipse(t0, -1);
  assert.ok(isoToSimDays(prev.d) < t0);
  const nextSolar = nextEclipse(t0, 1, 'S');
  assert.equal(nextSolar.t, 'S');
});

console.log(`\n  ${passed} passed, 0 failed`);

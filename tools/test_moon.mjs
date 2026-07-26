// Lunar ephemeris + timescale pins. The Meeus worked-example pin verifies the
// whole chapter-47 table transcription; the almanac new/full-moon pins verify
// the Sun/Moon/ΔT chain end to end. Run: node tools/test_moon.mjs
import assert from 'node:assert/strict';

import {
  moonEclipticPosition,
  moonMeanElements,
  moonHorizontalParallaxDeg,
  moonSemidiameterDeg,
  moonNodeLongitudeDeg,
  moonPhaseInfo,
  findPhaseNear,
  precessEclipticDateToJ2000,
  precessEclipticJ2000ToDate,
} from '../js/moon.js';
import { deltaTSeconds, simDaysUTCtoTT, simDaysToJdTT } from '../js/timescales.js';
import { geocentricSunEcliptic, dateToJD } from '../js/kepler.js';

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

const simDaysOfUTC = iso => dateToJD(new Date(iso)) - 2451545.0;

console.log('\nLunar ephemeris and timescale tests');

check('Meeus example 47.a reproduces to table precision (mean equinox of date)', () => {
  const jdTT = 2448724.5;   // 1992 April 12.0 TD
  const p = moonEclipticPosition(jdTT, 'date');
  close(p.lonDeg, 133.162655, 1e-4, 'geocentric longitude');
  close(p.latDeg, -3.229126, 1e-4, 'geocentric latitude');
  close(p.distKm, 368409.7, 0.5, 'distance');
  close(moonHorizontalParallaxDeg(p.distKm), 0.991990, 1e-4, 'horizontal parallax');
});

check('mean longitude epoch phase is exact at J2000', () => {
  close(moonMeanElements(0).Lp, 218.3164477, 1e-9,
    'Lp(T=0) — the old circular model started every moon at 0°');
});

check('ecliptic precession round-trips and advances longitudes forward', () => {
  const T = 0.77;
  const there = precessEclipticJ2000ToDate(211.3, 4.2, T);
  const back = precessEclipticDateToJ2000(there.lonDeg, there.latDeg, T);
  close(back.lonDeg, 211.3, 1e-9, 'longitude round-trip');
  close(back.latDeg, 4.2, 1e-9, 'latitude round-trip');
  // A fixed J2000 direction gains ~1.3969°/century of ecliptic longitude.
  const drift = precessEclipticJ2000ToDate(100, 0, 1);
  close(drift.lonDeg - 100, 1.3969, 0.01, 'general precession over one century');
});

check('ΔT matches the published model and measured values', () => {
  close(deltaTSeconds(1900), -2.79, 0.15, 'ΔT(1900)');
  close(deltaTSeconds(2000), 63.86, 0.15, 'ΔT(2000)');
  close(deltaTSeconds(2020), 69.36, 0.3, 'ΔT(2020) — measured overlay');
  close(deltaTSeconds(2026), 69.25, 0.4, 'ΔT(2026) — plateau, not the E–M overshoot');
  assert.ok(deltaTSeconds(2050) > 85 && deltaTSeconds(2050) < 100, 'ΔT(2050) extrapolation');
  close(simDaysUTCtoTT(0) - 0, deltaTSeconds(2000.0037) / 86400, 1e-12, 'TT offset wiring');
  close(simDaysToJdTT(0), 2451545.0 + deltaTSeconds(2000.0037) / 86400, 1e-9, 'JD TT wiring');
});

check('new and full moons land on the almanac minutes', () => {
  // 2024-04-08 total-eclipse new moon: 18:21 UTC.
  const newMoon = findPhaseNear(simDaysOfUTC('2024-04-08T12:00:00Z'), 0);
  close(newMoon, simDaysOfUTC('2024-04-08T18:21:00Z'), 5 / 1440, '2024-04-08 new moon');
  // 2000-01-06 new moon: 18:14 UTC.
  const newMoon2000 = findPhaseNear(simDaysOfUTC('2000-01-06T12:00:00Z'), 0);
  close(newMoon2000, simDaysOfUTC('2000-01-06T18:14:00Z'), 5 / 1440, '2000-01-06 new moon');
  // 2025-09-07 total-lunar-eclipse full moon: 18:09 UTC.
  const fullMoon = findPhaseNear(simDaysOfUTC('2025-09-07T12:00:00Z'), 180);
  close(fullMoon, simDaysOfUTC('2025-09-07T18:09:00Z'), 5 / 1440, '2025-09-07 full moon');
  // Phase info agrees with the solved epochs.
  assert.ok(moonPhaseInfo(newMoon).illuminatedFraction < 0.005, 'new moon is dark');
  assert.ok(moonPhaseInfo(fullMoon).illuminatedFraction > 0.995, 'full moon is lit');
});

check('distance sweeps a realistic perigee/apogee range across 2026', () => {
  let min = Infinity;
  let max = -Infinity;
  for (let d = 0; d < 366; d += 0.25) {
    const jd = simDaysToJdTT(simDaysOfUTC('2026-01-01T00:00:00Z') + d);
    const { distKm } = moonEclipticPosition(jd);
    min = Math.min(min, distKm);
    max = Math.max(max, distKm);
  }
  assert.ok(min > 356000 && min < 370000, `perigee ${min}`);
  assert.ok(max > 404000 && max < 407500, `apogee ${max}`);
  const semidiameter = moonSemidiameterDeg(min);
  assert.ok(semidiameter > 0.26 && semidiameter < 0.29, `semidiameter at perigee ${semidiameter}`);
});

check('node regresses ~19.34°/yr and the Sun stays on the ecliptic', () => {
  const nodeNow = moonNodeLongitudeDeg(2451545.0);
  const nodeLater = moonNodeLongitudeDeg(2451545.0 + 365.25);
  const drift = ((nodeNow - nodeLater) % 360 + 360) % 360;
  close(drift, 19.34, 0.2, 'nodal regression per year');
  const sun = geocentricSunEcliptic(8000);
  assert.ok(Math.abs(sun.latDeg) < 0.01, 'geocentric solar latitude ~0');
  assert.ok(sun.distAU > 0.98 && sun.distAU < 1.02, 'Sun distance ~1 AU');
});

console.log(`\n  ${passed} passed, 0 failed`);

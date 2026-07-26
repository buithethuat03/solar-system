// ============================================================================
//  eclipse_math.js — event geometry derived from the app's own ephemerides
//  (moon.js + kepler.js Sun + timescales ΔT), parameterizing the eclipse
//  module's POV painter for real catalog events. Everything here is
//  geocentric; the UI labels contact times as approximations (~±10 min).
//
//  Dependency-free of three; Node suite: tools/test_eclipse_catalog.mjs
//  cross-checks every catalog row against these functions.
// ============================================================================

import {
  moonEclipticPosition,
  moonHorizontalParallaxDeg,
  moonSemidiameterDeg,
} from './moon.js';
import { geocentricSunEcliptic } from './kepler.js';
import { simDaysUTCtoTT } from './timescales.js';
import { ECLIPSES } from './eclipse_catalog.js';

const DEG = Math.PI / 180;
const J2000_JD = 2451545.0;
const SUN_SEMIDIAMETER_1AU_DEG = 959.63 / 3600;
const SUN_PARALLAX_DEG = 8.794 / 3600;
const SHADOW_ENLARGEMENT = 1.02;   // Danjon-style umbra/penumbra enlargement

export const isoToSimDays = iso => Date.parse(iso) / 86400000 - 10957.5;

function unitFromEcliptic(lonDeg, latDeg, out) {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  out[0] = Math.cos(lat) * Math.cos(lon);
  out[1] = Math.cos(lat) * Math.sin(lon);
  out[2] = Math.sin(lat);
  return out;
}

const _a = [0, 0, 0];
const _b = [0, 0, 0];

/** Geocentric apparent geometry of the Sun and Moon at a UTC simDays epoch. */
export function apparentGeometry(simDays) {
  const jdTT = simDaysUTCtoTT(simDays) + J2000_JD;
  const moon = moonEclipticPosition(jdTT, 'J2000');
  const sun = geocentricSunEcliptic(simDaysUTCtoTT(simDays));
  const sSunDeg = SUN_SEMIDIAMETER_1AU_DEG / sun.distAU;
  const sMoonDeg = moonSemidiameterDeg(moon.distKm);
  unitFromEcliptic(moon.lonDeg, moon.latDeg, _a);
  unitFromEcliptic(sun.lonDeg, sun.latDeg, _b);
  const dot = Math.max(-1, Math.min(1, _a[0] * _b[0] + _a[1] * _b[1] + _a[2] * _b[2]));
  const relLonDeg = (((moon.lonDeg - sun.lonDeg) % 360) + 540) % 360 - 180;
  return {
    sepDeg: Math.acos(dot) / DEG,
    oppositionSepDeg: 180 - Math.acos(-dot) / DEG === 0 ? 0 : Math.acos(-dot) / DEG,
    sSunDeg,
    sMoonDeg,
    k: sMoonDeg / sSunDeg,
    moonParallaxDeg: moonHorizontalParallaxDeg(moon.distKm),
    sunParallaxDeg: SUN_PARALLAX_DEG / sun.distAU,
    relLonDeg,
    relLatDeg: moon.latDeg - sun.latDeg,
    moonDistKm: moon.distKm,
  };
}

/** Angular separation Moon ↔ anti-Sun point (for lunar eclipses), degrees. */
export function antisolarSeparationDeg(simDays) {
  const jdTT = simDaysUTCtoTT(simDays) + J2000_JD;
  const moon = moonEclipticPosition(jdTT, 'J2000');
  const sun = geocentricSunEcliptic(simDaysUTCtoTT(simDays));
  unitFromEcliptic(moon.lonDeg, moon.latDeg, _a);
  unitFromEcliptic(sun.lonDeg + 180, -sun.latDeg, _b);
  const dot = Math.max(-1, Math.min(1, _a[0] * _b[0] + _a[1] * _b[1] + _a[2] * _b[2]));
  return Math.acos(dot) / DEG;
}

function solveCrossing(fn, target, tStart, dir, stepDays = 20 / 1440) {
  // March until fn crosses target, then bisect. Robust against the shallow
  // extrema around greatest eclipse.
  let t0 = tStart;
  let v0 = fn(t0) - target;
  for (let i = 0; i < 600; i++) {
    const t1 = t0 + dir * stepDays;
    const v1 = fn(t1) - target;
    if ((v0 <= 0 && v1 >= 0) || (v0 >= 0 && v1 <= 0)) {
      let lo = t0;
      let hi = t1;
      for (let j = 0; j < 40; j++) {
        const mid = (lo + hi) / 2;
        if (((fn(lo) - target) <= 0) === ((fn(mid) - target) <= 0)) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }
    t0 = t1;
    v0 = v1;
  }
  return null;
}

/**
 * POV parameterization for a solar catalog event. All lengths are fractions
 * of the drawn solar radius R, matching eclipse.js's painter inputs.
 */
export function solarEventGeometry(ev) {
  const tMax = isoToSimDays(ev.d);
  const geom = apparentGeometry(tMax);
  const central = ev.k === 'T' || ev.k === 'A' || ev.k === 'H';
  // Central events assume a centreline observer (sep 0); partials encode the
  // catalog magnitude: m = (1 + k − sep/R) / 2  →  sep/R = 1 + k − 2m.
  const sepMinFrac = central ? 0 : Math.max(0, 1 + geom.k - 2 * ev.m);
  // Chord slope from the relative-motion vector ±30 minutes around maximum.
  const before = apparentGeometry(tMax - 30 / 1440);
  const after = apparentGeometry(tMax + 30 / 1440);
  const dLon = (after.relLonDeg - before.relLonDeg) * Math.cos(0);
  const dLat = after.relLatDeg - before.relLatDeg;
  const slope = dLon !== 0 ? dLat / Math.abs(dLon) : 0;
  // Geocentric partial-phase window: separation equals the summed radii.
  const contact = geom.sSunDeg + geom.sMoonDeg;
  const tC1 = solveCrossing(t => apparentGeometry(t).sepDeg, contact, tMax, -1);
  const tC4 = solveCrossing(t => apparentGeometry(t).sepDeg, contact, tMax, +1);
  return {
    kind: ev.k,
    k: geom.k,
    sepMinFrac,
    slope,
    tMax,
    tC1: tC1 ?? tMax - 0.125,
    tC4: tC4 ?? tMax + 0.125,
  };
}

/**
 * POV parameterization for a lunar catalog event: shadow radii at the Moon's
 * distance as fractions of the drawn Moon radius, and the penumbral window.
 */
export function lunarEventGeometry(ev) {
  const tMax = isoToSimDays(ev.d);
  const geom = apparentGeometry(tMax);
  const umbraDeg = SHADOW_ENLARGEMENT
    * (geom.moonParallaxDeg + geom.sunParallaxDeg - geom.sSunDeg);
  const penumbraDeg = SHADOW_ENLARGEMENT
    * (geom.moonParallaxDeg + geom.sunParallaxDeg + geom.sSunDeg);
  const dMinDeg = Math.abs(ev.g) * geom.moonParallaxDeg;
  const contact = penumbraDeg + geom.sMoonDeg;
  const tP1 = solveCrossing(t => antisolarSeparationDeg(t), contact, tMax, -1);
  const tP4 = solveCrossing(t => antisolarSeparationDeg(t), contact, tMax, +1);
  return {
    kind: ev.k,
    umbraFrac: umbraDeg / geom.sMoonDeg,          // replaces the hardcoded 2.6
    penumbraFrac: penumbraDeg / geom.sMoonDeg,    // replaces the hardcoded 4.9
    dMinFrac: dMinDeg / geom.sMoonDeg,
    umbralMagnitude: (umbraDeg + geom.sMoonDeg - dMinDeg) / (2 * geom.sMoonDeg),
    tMax,
    tP1: tP1 ?? tMax - 0.16,
    tP4: tP4 ?? tMax + 0.16,
  };
}

/** Next catalog event at/after (dir=+1) or before (dir=−1) a UTC simDays. */
export function nextEclipse(simDays, dir = 1, type = null) {
  const list = type ? ECLIPSES.filter(e => e.t === type) : ECLIPSES;
  if (dir >= 0) {
    for (const ev of list) if (isoToSimDays(ev.d) >= simDays) return ev;
    return list[list.length - 1] ?? null;
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (isoToSimDays(list[i].d) < simDays) return list[i];
  }
  return list[0] ?? null;
}

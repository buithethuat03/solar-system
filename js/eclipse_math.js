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
  precessEclipticJ2000ToDate,
} from './moon.js';
import { geocentricSunEcliptic } from './kepler.js';
import { simDaysUTCtoTT, gmstDeg } from './timescales.js';
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

// ---------------------------------------------------------------------------
//  Ground track — where the Moon's shadow axis pierces the Earth ellipsoid.
//
//  Worked in the equatorial frame of date: Moon from the ELP series ('date'
//  frame), Sun precessed from J2000, both rotated by the mean obliquity of
//  date. Longitudes then follow from GMST. Everything geocentric-axis based:
//  this is the central line, not the umbra outline, and carries the same
//  ~±0.02-gamma / ±2-minute honesty budget as the rest of the module.
// ---------------------------------------------------------------------------
const KM_PER_AU = 149597870.7;
const EARTH_EQ_RADIUS_KM = 6378.137;
const EARTH_FLATTENING = 1 / 298.257223563;

/** Mean obliquity of the ecliptic of date, degrees (Meeus 22.2, truncated). */
const meanObliquityDeg = (T) => 23.43929111 - 0.01300417 * T - 1.64e-7 * T * T;

// Geocentric equatorial-of-date position vectors of the Sun and Moon in km.
function equatorialState(simDays) {
  const ttDays = simDaysUTCtoTT(simDays);
  const jdTT = ttDays + J2000_JD;
  const T = ttDays / 36525;
  const eps = meanObliquityDeg(T) * DEG;
  const cosE = Math.cos(eps);
  const sinE = Math.sin(eps);
  const toEq = (lonDeg, latDeg, distKm) => {
    const lon = lonDeg * DEG;
    const lat = latDeg * DEG;
    const x = Math.cos(lat) * Math.cos(lon) * distKm;
    const y = Math.cos(lat) * Math.sin(lon) * distKm;
    const z = Math.sin(lat) * distKm;
    return [x, y * cosE - z * sinE, y * sinE + z * cosE];
  };
  const moon = moonEclipticPosition(jdTT, 'date');
  const sun0 = geocentricSunEcliptic(ttDays);
  const sun = precessEclipticJ2000ToDate(sun0.lonDeg, sun0.latDeg, T);
  return {
    moonKm: toEq(moon.lonDeg, moon.latDeg, moon.distKm),
    sunKm: toEq(sun.lonDeg, sun.latDeg, sun0.distAU * KM_PER_AU),
    gmst: gmstDeg(simDays + J2000_JD),
  };
}

const wrapLon = (deg) => ((deg % 360) + 540) % 360 - 180;

/** Sub-solar point (geodetic latitude = solar declination), degrees. */
export function subsolarPoint(simDays) {
  const { sunKm, gmst } = equatorialState(simDays);
  const r = Math.hypot(sunKm[0], sunKm[1], sunKm[2]);
  return {
    latDeg: Math.asin(sunKm[2] / r) / DEG,
    lonDeg: wrapLon(Math.atan2(sunKm[1], sunKm[0]) / DEG - gmst),
  };
}

/**
 * Geodetic point where the Sun→Moon shadow axis meets the Earth ellipsoid,
 * or null when the axis misses (partial eclipses, outside the central window).
 */
export function shadowAxisGroundPoint(simDays) {
  const { moonKm, sunKm, gmst } = equatorialState(simDays);
  const dx = moonKm[0] - sunKm[0];
  const dy = moonKm[1] - sunKm[1];
  const dz = moonKm[2] - sunKm[2];
  // Stretch z by 1/(1−f) so the WGS84 ellipsoid becomes a sphere of the
  // equatorial radius; intersect there; the unscaled point lies on the ellipsoid.
  const zk = 1 / (1 - EARTH_FLATTENING);
  const mx = moonKm[0], my = moonKm[1], mz = moonKm[2] * zk;
  const ddz = dz * zk;
  const A = dx * dx + dy * dy + ddz * ddz;
  const B = 2 * (mx * dx + my * dy + mz * ddz);
  const C = mx * mx + my * my + mz * mz - EARTH_EQ_RADIUS_KM * EARTH_EQ_RADIUS_KM;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const s = (-B - Math.sqrt(disc)) / (2 * A);   // near (day-side) surface
  if (s < 0) return null;
  const px = moonKm[0] + s * dx;
  const py = moonKm[1] + s * dy;
  const pz = moonKm[2] + s * dz;
  const rho = Math.hypot(px, py);
  return {
    latDeg: Math.atan2(pz, rho * (1 - EARTH_FLATTENING) ** 2) / DEG,
    lonDeg: wrapLon(Math.atan2(py, px) / DEG - gmst),
  };
}

/**
 * The central-line ground track of a solar catalog event: samples of
 * { sd (UTC simDays), latDeg, lonDeg } every stepMinutes across ±4 h of
 * greatest eclipse. Empty for partial/non-central events.
 */
export function solarGroundTrack(ev, stepMinutes = 1.5) {
  if (ev.t !== 'S') return [];
  const tMax = isoToSimDays(ev.d);
  const step = stepMinutes / 1440;
  const points = [];
  for (let sd = tMax - 0.17; sd <= tMax + 0.17; sd += step) {
    const p = shadowAxisGroundPoint(sd);
    if (p) points.push({ sd, latDeg: p.latDeg, lonDeg: p.lonDeg });
  }
  return points;
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

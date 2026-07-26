// ============================================================================
//  moon.js — truncated ELP2000-82B lunar ephemeris (Meeus, Astronomical
//  Algorithms 2nd ed., chapter 47: 60 longitude/distance + 60 latitude
//  periodic terms). Accuracy ≈ 10″ in longitude, 4″ in latitude, and a few
//  tens of km in distance — far below one on-screen pixel, and enough to
//  reproduce eclipse gammas to ~±0.02.
//
//  Conventions:
//  * Input epochs are TT Julian Dates (convert UTC via timescales.js).
//  * Chapter 47 yields mean-equinox-OF-DATE ecliptic coordinates; the scene
//    frame is the J2000 ecliptic, so a rigid ecliptic-precession rotation
//    (Meeus ch. 21) reduces them. Nutation is deliberately omitted: it
//    rotates the Sun and Moon together, cancels in all Sun−Moon relative
//    geometry, and is ≤17″ absolute against the stars.
//
//  Dependency-free; Node test suite: tools/test_moon.mjs pins the book's
//  worked example 47.a and real new/full-moon times.
// ============================================================================

import { geocentricSunEcliptic } from './kepler.js';
import { simDaysUTCtoTT } from './timescales.js';

const DEG = Math.PI / 180;
const J2000_JD = 2451545.0;

// Meeus Table 47.A — arguments [D, M, M', F], Σl (1e-6 deg), Σr (1e-3 km).
const LR_TERMS = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751], [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0], [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0], [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0], [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165], [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];

// Meeus Table 47.B — arguments [D, M, M', F], Σb (1e-6 deg).
const B_TERMS = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794], [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107], [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777], [4, 0, -2, 1, 671], [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596], [2, -1, 1, -1, 491], [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439], [2, 0, 2, 1, 422], [2, 0, -3, -1, 421],
  [2, 1, -1, 1, -366], [2, 1, 0, 1, -351], [4, 0, 0, 1, 331],
  [2, -1, 1, 1, 315], [2, -2, 0, -1, 302], [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229], [1, 1, 0, -1, 223], [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220], [2, 1, -1, -1, -220], [1, 0, 1, 1, -185],
  [2, -1, -2, -1, 181], [0, 1, 2, 1, -177], [4, 0, -2, -1, 176],
  [4, -1, -1, -1, 166], [1, 0, 1, -1, -164], [4, 0, 1, -1, 132],
  [1, 0, -1, -1, -119], [4, -1, 0, -1, 115], [2, -2, 0, 1, 107],
];

/** Mean lunar/solar elements at T Julian centuries TT since J2000 (degrees). */
export function moonMeanElements(T) {
  const wrap = d => ((d % 360) + 360) % 360;
  return {
    Lp: wrap(218.3164477 + 481267.88123421 * T - 0.0015786 * T ** 2
      + T ** 3 / 538841 - T ** 4 / 65194000),
    D: wrap(297.8501921 + 445267.1114034 * T - 0.0018819 * T ** 2
      + T ** 3 / 545868 - T ** 4 / 113065000),
    M: wrap(357.5291092 + 35999.0502909 * T - 0.0001536 * T ** 2 + T ** 3 / 24490000),
    Mp: wrap(134.9633964 + 477198.8675055 * T + 0.0087414 * T ** 2
      + T ** 3 / 69699 - T ** 4 / 14712000),
    F: wrap(93.2720950 + 483202.0175233 * T - 0.0036539 * T ** 2
      - T ** 3 / 3526000 + T ** 4 / 863310000),
    Om: wrap(125.0445479 - 1934.1362891 * T + 0.0020754 * T ** 2
      + T ** 3 / 467441 - T ** 4 / 60616000),
    A1: wrap(119.75 + 131.849 * T),
    A2: wrap(53.09 + 479264.290 * T),
    A3: wrap(313.45 + 481266.484 * T),
    E: 1 - 0.002516 * T - 0.0000074 * T ** 2,
  };
}

// --- Ecliptic precession, mean-of-date <-> J2000 (Meeus ch. 21) -------------
// Rigid rotation (not a longitude shift) so the ~47″/cy drift of the ecliptic
// pole never leaks into Sun−Moon relative latitude.
function precessionAngles(T) {
  const arcsec = 1 / 3600;
  const pA = (5029.0966 * T + 1.11113 * T * T - 0.000006 * T ** 3) * arcsec;
  const Pi = 174.876384 - (869.8089 * T - 0.03536 * T * T) * arcsec;
  const eta = (47.0029 * T - 0.03302 * T * T + 0.000060 * T ** 3) * arcsec;
  return { pA: pA * DEG, Pi: Pi * DEG, eta: eta * DEG };
}

function rotateEcliptic(lonDeg, latDeg, T, toJ2000) {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  let v = [
    Math.cos(lat) * Math.cos(lon),
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
  ];
  const { pA, Pi, eta } = precessionAngles(T);
  // of-date vector = Rz(-(Pi + pA)) · Rx(-eta) · Rz(Pi) · J2000 vector
  // (fixed directions gain ecliptic longitude at the general-precession rate;
  // the sign convention is pinned by tools/test_moon.mjs).
  const rz = (vec, ang) => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return [c * vec[0] - s * vec[1], s * vec[0] + c * vec[1], vec[2]];
  };
  const rx = (vec, ang) => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return [vec[0], c * vec[1] - s * vec[2], s * vec[1] + c * vec[2]];
  };
  if (toJ2000) {
    // inverse order/signs of the forward rotation below
    v = rz(v, -(Pi + pA));
    v = rx(v, -eta);
    v = rz(v, Pi);
  } else {
    v = rz(v, -Pi);
    v = rx(v, eta);
    v = rz(v, Pi + pA);
  }
  const outLat = Math.asin(Math.max(-1, Math.min(1, v[2])));
  const outLon = Math.atan2(v[1], v[0]);
  return {
    lonDeg: ((outLon / DEG) % 360 + 360) % 360,
    latDeg: outLat / DEG,
  };
}

export function precessEclipticDateToJ2000(lonDeg, latDeg, T) {
  return rotateEcliptic(lonDeg, latDeg, T, true);
}

export function precessEclipticJ2000ToDate(lonDeg, latDeg, T) {
  return rotateEcliptic(lonDeg, latDeg, T, false);
}

/**
 * Geocentric ecliptic position of the Moon at a TT Julian Date.
 * frame: 'J2000' (default — the scene frame) or 'date' (mean equinox of date,
 * the raw chapter-47 output used for the book-example test pins).
 */
export function moonEclipticPosition(jdTT, frame = 'J2000') {
  const T = (jdTT - J2000_JD) / 36525;
  const { Lp, D, M, Mp, F, A1, A2, A3, E } = moonMeanElements(T);
  const E2 = E * E;
  let sumL = 0;
  let sumR = 0;
  for (const [d, m, mp, f, l, r] of LR_TERMS) {
    const arg = (d * D + m * M + mp * Mp + f * F) * DEG;
    const eFactor = m === 0 ? 1 : (m === 1 || m === -1 ? E : E2);
    sumL += l * eFactor * Math.sin(arg);
    sumR += r * eFactor * Math.cos(arg);
  }
  let sumB = 0;
  for (const [d, m, mp, f, b] of B_TERMS) {
    const arg = (d * D + m * M + mp * Mp + f * F) * DEG;
    const eFactor = m === 0 ? 1 : (m === 1 || m === -1 ? E : E2);
    sumB += b * eFactor * Math.sin(arg);
  }
  sumL += 3958 * Math.sin(A1 * DEG) + 1962 * Math.sin((Lp - F) * DEG)
    + 318 * Math.sin(A2 * DEG);
  sumB += -2235 * Math.sin(Lp * DEG) + 382 * Math.sin(A3 * DEG)
    + 175 * Math.sin((A1 - F) * DEG) + 175 * Math.sin((A1 + F) * DEG)
    + 127 * Math.sin((Lp - Mp) * DEG) - 115 * Math.sin((Lp + Mp) * DEG);

  const lonDate = ((Lp + sumL / 1e6) % 360 + 360) % 360;
  const latDate = sumB / 1e6;
  const distKm = 385000.56 + sumR / 1e3;
  if (frame === 'date') return { lonDeg: lonDate, latDeg: latDate, distKm };
  const reduced = precessEclipticDateToJ2000(lonDate, latDate, T);
  return { lonDeg: reduced.lonDeg, latDeg: reduced.latDeg, distKm };
}

/** Longitude of the mean ascending node (degrees, of date). */
export function moonNodeLongitudeDeg(jdTT) {
  return moonMeanElements((jdTT - J2000_JD) / 36525).Om;
}

/** Equatorial horizontal parallax (degrees) at a geocentric distance. */
export function moonHorizontalParallaxDeg(distKm) {
  return Math.asin(6378.14 / distKm) / DEG;
}

/** Apparent geocentric semidiameter (degrees). */
export function moonSemidiameterDeg(distKm) {
  return Math.asin(0.272481 * Math.sin(moonHorizontalParallaxDeg(distKm) * DEG)) / DEG;
}

// --- Phases -----------------------------------------------------------------

function sunMoonElongationDeg(simDays) {
  const jdTT = simDaysUTCtoTT(simDays) + J2000_JD;
  const moon = moonEclipticPosition(jdTT, 'J2000');
  const sun = geocentricSunEcliptic(simDaysUTCtoTT(simDays));
  return ((moon.lonDeg - sun.lonDeg) % 360 + 360) % 360;
}

/**
 * Phase / illumination summary at a UTC simDays epoch.
 * elongationDeg 0 = new, 180 = full (ecliptic-longitude difference).
 */
export function moonPhaseInfo(simDays) {
  const elongationDeg = sunMoonElongationDeg(simDays);
  const illuminatedFraction = (1 - Math.cos(elongationDeg * DEG)) / 2;
  return {
    elongationDeg,
    illuminatedFraction,
    waxing: elongationDeg < 180,
    ageDays: elongationDeg / 360 * 29.530588861,
  };
}

/**
 * Newton-solve the UTC simDays near a guess at which the Sun–Moon elongation
 * equals targetElongationDeg (0 new, 180 full, 90/270 quarters).
 */
export function findPhaseNear(simDaysGuess, targetElongationDeg) {
  const MEAN_RATE = 12.190749;   // deg/day of elongation growth
  let t = simDaysGuess;
  for (let i = 0; i < 6; i++) {
    let diff = sunMoonElongationDeg(t) - targetElongationDeg;
    diff = ((diff % 360) + 540) % 360 - 180;   // shortest signed distance
    t -= diff / MEAN_RATE;
    if (Math.abs(diff) < 1e-6) break;
  }
  return t;
}

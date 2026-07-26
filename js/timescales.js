// ============================================================================
//  timescales.js — ΔT (TT − UTC) and Terrestrial-Time helpers.
//
//  Ephemerides (the Moon, eclipse geometry) are functions of dynamical time,
//  while the app's master clock and every display run on UTC. The ~69 s
//  offset is invisible for planets but moves the Moon ~38″ — about two
//  minutes of eclipse contact time — so conversions happen here, once.
//
//  Model: Espenak & Meeus polynomial expressions (NASA eclipse site,
//  −1999…+3000), with one correction — their 2005–2050 segment was fitted
//  before ΔT plateaued after 2016 and overshoots reality by ~6 s today, so
//  measured IERS values (interpolated yearly, 2005–2026) override it and
//  blend linearly back into the polynomial by 2050.
//
//  Dependency-free; Node test suite: tools/test_moon.mjs.
// ============================================================================

// Measured ΔT at 2005.0 … 2026.0 (IERS; seconds).
const MEASURED_DELTA_T = [
  64.69, 64.85, 65.15, 65.46, 65.78, 66.07, 66.32, 66.60, 66.91, 67.28,
  67.64, 68.10, 68.59, 68.97, 69.22, 69.36, 69.36, 69.29, 69.20, 69.18,
  69.20, 69.25,
];
const MEASURED_FIRST_YEAR = 2005;
const MEASURED_LAST_YEAR = MEASURED_FIRST_YEAR + MEASURED_DELTA_T.length - 1;

function espenakMeeus(year) {
  const u = (year - 1820) / 100;
  if (year < -500 || year >= 2150) return -20 + 32 * u * u;
  if (year < 500) {
    const t = year / 100;
    return 10583.6 - 1014.41 * t + 33.78311 * t ** 2 - 5.952053 * t ** 3
      - 0.1798452 * t ** 4 + 0.022174192 * t ** 5 + 0.0090316521 * t ** 6;
  }
  if (year < 1600) {
    const t = (year - 1000) / 100;
    return 1574.2 - 556.01 * t + 71.23472 * t ** 2 + 0.319781 * t ** 3
      - 0.8503463 * t ** 4 - 0.005050998 * t ** 5 + 0.0083572073 * t ** 6;
  }
  if (year < 1700) {
    const t = year - 1600;
    return 120 - 0.9808 * t - 0.01532 * t ** 2 + t ** 3 / 7129;
  }
  if (year < 1800) {
    const t = year - 1700;
    return 8.83 + 0.1603 * t - 0.0059285 * t ** 2 + 0.00013336 * t ** 3 - t ** 4 / 1174000;
  }
  if (year < 1860) {
    const t = year - 1800;
    return 13.72 - 0.332447 * t + 0.0068612 * t ** 2 + 0.0041116 * t ** 3
      - 0.00037436 * t ** 4 + 0.0000121272 * t ** 5 - 0.0000001699 * t ** 6
      + 0.000000000875 * t ** 7;
  }
  if (year < 1900) {
    const t = year - 1860;
    return 7.62 + 0.5737 * t - 0.251754 * t ** 2 + 0.01680668 * t ** 3
      - 0.0004473624 * t ** 4 + t ** 5 / 233174;
  }
  if (year < 1920) {
    const t = year - 1900;
    return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4;
  }
  if (year < 1941) {
    const t = year - 1920;
    return 21.20 + 0.84493 * t - 0.076100 * t ** 2 + 0.0020936 * t ** 3;
  }
  if (year < 1961) {
    const t = year - 1950;
    return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547;
  }
  if (year < 1986) {
    const t = year - 1975;
    return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718;
  }
  if (year < 2005) {
    const t = year - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3
      + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
  }
  if (year < 2050) {
    const t = year - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t ** 2;
  }
  // 2050–2150
  return -20 + 32 * u * u - 0.5628 * (2150 - year);
}

/** ΔT = TT − UTC in seconds at a decimal year. */
export function deltaTSeconds(decimalYear) {
  if (decimalYear >= MEASURED_FIRST_YEAR && decimalYear <= MEASURED_LAST_YEAR) {
    const f = decimalYear - MEASURED_FIRST_YEAR;
    const i = Math.min(MEASURED_DELTA_T.length - 2, Math.floor(f));
    return MEASURED_DELTA_T[i] + (MEASURED_DELTA_T[i + 1] - MEASURED_DELTA_T[i]) * (f - i);
  }
  if (decimalYear > MEASURED_LAST_YEAR && decimalYear < 2050) {
    // Blend the last measured value into the Espenak–Meeus curve by 2050.
    const w = (decimalYear - MEASURED_LAST_YEAR) / (2050 - MEASURED_LAST_YEAR);
    return MEASURED_DELTA_T[MEASURED_DELTA_T.length - 1] * (1 - w)
      + espenakMeeus(decimalYear) * w;
  }
  return espenakMeeus(decimalYear);
}

const DAYS_PER_YEAR = 365.2425;

/** Decimal year of a simDays value (days since J2000.0 UTC). */
export function simDaysToDecimalYear(simDays) {
  return 2000.0037 + simDays / DAYS_PER_YEAR;   // J2000.0 = 2000 Jan 1.5
}

/** UTC simDays → simDays on the TT scale (for ephemeris evaluation only). */
export function simDaysUTCtoTT(simDays) {
  return simDays + deltaTSeconds(simDaysToDecimalYear(simDays)) / 86400;
}

/** UTC simDays → Julian Date on the TT scale. */
export function simDaysToJdTT(simDays) {
  return simDaysUTCtoTT(simDays) + 2451545.0;
}

/**
 * Greenwich Mean Sidereal Time in degrees (IAU 1982) for a UT Julian Date.
 * Good to well under a second of time across 1900–2100 — far tighter than
 * the ±2-minute geocentric budget of the eclipse module that consumes it.
 */
export function gmstDeg(jdUT) {
  const d = jdUT - 2451545.0;
  const T = d / 36525;
  const gmst = 280.46061837 + 360.98564736629 * d
    + 0.000387933 * T * T - (T * T * T) / 38710000;
  return ((gmst % 360) + 360) % 360;
}

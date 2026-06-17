// ============================================================================
//  kepler.js  —  Orbital mechanics
//  Converts J2000 Keplerian elements + a simulated date into 3D positions.
//  Coordinates are returned in the three.js frame (Y = up), with the ecliptic
//  lying close to the X-Z plane.
// ============================================================================
import { CONFIG, RATES } from './data.js';
import { VOYAGER_EPHEM } from './voyager_ephem.js';

const DEG = Math.PI / 180;

// --- Calendar date -> Julian Date (treats the date as UTC) -----------------
export function dateToJD(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

// Days elapsed since the J2000.0 epoch for a given JS Date.
export function daysSinceJ2000(date) {
  return dateToJD(date) - CONFIG.J2000_JD;
}

// Convert "days since J2000" back to a JS Date (UTC).
export function j2000DaysToDate(days) {
  return new Date((days + CONFIG.J2000_JD - 2440587.5) * 86400000);
}

// --- Solve Kepler's equation  M = E - e·sin(E)  (Newton-Raphson) -----------
function solveKepler(M, e) {
  // Normalise M to [-PI, PI] for fast convergence.
  M = M % (2 * Math.PI);
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;
  let E = e < 0.8 ? M : Math.PI;          // initial guess
  for (let k = 0; k < 12; k++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  return E;
}

// --- Distance mapping (AU -> scene units) ----------------------------------
export function makeDistanceFn(mode) {
  if (mode === 'realistic' || mode === 'accurate') {
    // True relative spacing (linear in AU). "accurate" shares this scaling.
    return (au) => CONFIG.DIST_REAL_K * au;
  }
  // "visual" (default): compressed so every orbit is visible at once.
  return (au) => CONFIG.DIST_VISUAL_K * Math.pow(au, CONFIG.DIST_VISUAL_EXP);
}

// --- Secular-rate–adjusted orbital elements at a given time ----------------
// Uses the JPL element-rate model (elements drift with the secular rates), which
// is far more accurate than fixed J2000 elements. BOTH the live position and the
// drawn orbit ellipse pull their elements from here, so a planet always sits
// exactly on its own orbit line (at any date, at any distance scale).
export function elementsAt(el, days) {
  const T = days / 36525;                          // Julian centuries since J2000
  const rt = RATES[el.id];
  let a = el.a, e = el.e, i = el.i, wbar = el.wbar, om = el.om, L;
  if (rt) {
    a += rt.a * T; e += rt.e * T; i += rt.i * T;
    wbar += rt.wbar * T; om += rt.om * T;
    L = el.L0 + rt.L * T;                           // mean longitude (deg)
  } else {
    L = el.L0 + (360 / el.periodDays) * days;       // fallback: fixed mean motion
  }
  return { a, e, i, wbar, om, L };
}

// --- Heliocentric ecliptic position (in AU) at a given time ----------------
// Returns the real (unscaled) position plus the true anomaly.
export function heliocentric(el, days) {
  const { a, e, i: iDeg, wbar, om: omDeg, L } = elementsAt(el, days);
  // Mean anomaly, wrapped to [-180,180] for stable Kepler convergence.
  const M = (((L - wbar) % 360) + 540) % 360 - 180;
  const E = solveKepler(M * DEG, e);

  // True anomaly & heliocentric distance
  const xv = Math.cos(E) - e;
  const yv = Math.sqrt(1 - e * e) * Math.sin(E);
  const nu = Math.atan2(yv, xv);
  const r = a * (1 - e * Math.cos(E));            // AU

  const o = (wbar - omDeg) * DEG + nu;            // arg. perihelion + true anomaly
  const Om = omDeg * DEG;
  const inc = iDeg * DEG;

  // Heliocentric ecliptic coordinates (X toward vernal equinox, Z = north)
  const X = r * (Math.cos(Om) * Math.cos(o) - Math.sin(Om) * Math.sin(o) * Math.cos(inc));
  const Y = r * (Math.sin(Om) * Math.cos(o) + Math.cos(Om) * Math.sin(o) * Math.cos(inc));
  const Z = r * (Math.sin(o) * Math.sin(inc));

  // Map ecliptic -> three.js (Y up): scene = (X, Z, -Y)
  return { x: X, y: Z, z: -Y, r, nu };
}

// --- Scaled scene position (units) -----------------------------------------
export function scenePosition(el, days, distFn) {
  const p = heliocentric(el, days);
  const k = distFn(el.a) / el.a;     // uniform per-orbit scale -> keeps ellipse shape
  return { x: p.x * k, y: p.y * k, z: p.z * k, r: p.r * k };
}

// --- Interstellar spacecraft (Voyagers): real-ephemeris interpolation --------
// The old model propagated a single state vector linearly (r0 + v·Δt). That is
// fine for the post-encounter cruise but WRONG for the historical trajectory: a
// straight line never curves through the planetary flybys, never starts at
// Earth, and exists for all time (even before launch). We instead carry the real
// NASA/JPL HORIZONS trajectory as a table of sampled state vectors and reproduce
// the true curved path with cubic-Hermite interpolation, using each sample's
// velocity as the exact local tangent. Heliocentric ecliptic-J2000 AU & AU/day.
//
//   • before the first sample (launch)  → returns null: the craft does not exist
//   • between samples                   → cubic Hermite (position + velocity)
//   • beyond the last sample (~2055)     → linear coast (truly ballistic by then)
const SEC_PER_AU_LIGHT = 499.004784;   // one-way light time of 1 AU, in seconds

export function voyagerState(v, days) {
  const eph = v._ephem || (v._ephem = VOYAGER_EPHEM[v.id]);
  if (!eph) return null;
  const S = eph.samples;
  if (days < eph.t0) return null;                 // not launched / tracked yet

  let x, y, z, vx, vy, vz;
  if (days >= eph.t1) {
    // Past the table: constant-velocity coast from the final state vector.
    const f = S[S.length - 1], dt = days - f[0];
    vx = f[4]; vy = f[5]; vz = f[6];
    x = f[1] + vx * dt; y = f[2] + vy * dt; z = f[3] + vz * dt;
  } else {
    // Binary-search the bracketing segment [a, b] with a.t ≤ days < b.t.
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m][0] <= days) lo = m; else hi = m; }
    const a = S[lo], b = S[hi];
    const h = b[0] - a[0];
    const s = (days - a[0]) / h, s2 = s * s, s3 = s2 * s;
    // Hermite basis (position) and its t-derivative (velocity).
    const h00 = 2*s3 - 3*s2 + 1, h10 = s3 - 2*s2 + s, h01 = -2*s3 + 3*s2, h11 = s3 - s2;
    const d00 = 6*s2 - 6*s,      d10 = 3*s2 - 4*s + 1, d01 = -6*s2 + 6*s,  d11 = 3*s2 - 2*s;
    x = h00*a[1] + h10*h*a[4] + h01*b[1] + h11*h*b[4];
    y = h00*a[2] + h10*h*a[5] + h01*b[2] + h11*h*b[5];
    z = h00*a[3] + h10*h*a[6] + h01*b[3] + h11*h*b[6];
    vx = (d00*a[1] + d01*b[1])/h + d10*a[4] + d11*b[4];
    vy = (d00*a[2] + d01*b[2])/h + d10*a[5] + d11*b[5];
    vz = (d00*a[3] + d01*b[3])/h + d10*a[6] + d11*b[6];
  }

  const distAU = Math.sqrt(x*x + y*y + z*z);
  const speedAUd = Math.sqrt(vx*vx + vy*vy + vz*vz);
  return {
    // Heliocentric ecliptic AU → three.js scene axes (X, Z, −Y), as in heliocentric().
    x, y: z, z: -y,
    distAU,
    speedKms: speedAUd * CONFIG.KM_PER_AU / 86400,
    speedAUyr: speedAUd * 365.25,
    lightHours: distAU * SEC_PER_AU_LIGHT / 3600,
  };
}

// Scene-space position (units) for a Voyager at the true-scale ruler. Voyagers
// are only drawn in the realistic/accurate views, whose ruler is always
// DIST_REAL_K units per AU, so the mapping is a plain linear scale. Returns null
// before launch (the craft does not exist yet) so callers can hide it.
export function voyagerScenePosition(v, days) {
  const s = voyagerState(v, days);
  if (!s) return null;
  const k = CONFIG.DIST_REAL_K;
  return { x: s.x * k, y: s.y * k, z: s.z * k, state: s };
}

// --- Sample the full orbit as an array of scene points (for orbit lines) ----
// `days` selects the epoch: the ellipse is drawn from the SAME time-adjusted
// elements the body's position uses, so the body lies exactly on its orbit line.
// The sweep STARTS at the body's current eccentric anomaly, so vertex 0 sits
// exactly on the body — the line then passes through it at any zoom and any
// segment count (otherwise, at true scale, the body floats off the polyline's
// chords by the per-segment sagitta, which is many body-radii for big orbits).
export function orbitPoints(el, distFn, days = 0, segments = 512) {
  const pts = [];
  const k = distFn(el.a) / el.a;                     // scale tied to the base a (matches scenePosition)
  const { a, e, i, wbar, om, L } = elementsAt(el, days);
  const Om = om * DEG;
  const inc = i * DEG;
  const argp = (wbar - om) * DEG;
  const M = (((L - wbar) % 360) + 540) % 360 - 180;  // body's mean anomaly now
  const E0 = solveKepler(M * DEG, e);                // body's eccentric anomaly now
  for (let s = 0; s <= segments; s++) {
    const E = E0 + (s / segments) * 2 * Math.PI;     // one full revolution, starting AT the body
    const xv = Math.cos(E) - e;
    const yv = Math.sqrt(1 - e * e) * Math.sin(E);
    const nu = Math.atan2(yv, xv);
    const r = a * (1 - e * Math.cos(E));
    const o = argp + nu;
    const X = r * (Math.cos(Om) * Math.cos(o) - Math.sin(Om) * Math.sin(o) * Math.cos(inc));
    const Y = r * (Math.sin(Om) * Math.cos(o) + Math.cos(Om) * Math.sin(o) * Math.cos(inc));
    const Z = r * (Math.sin(o) * Math.sin(inc));
    pts.push(X * k, Z * k, -Y * k);
  }
  return pts;
}

#!/usr/bin/env node
// Generate the master-trajectory tables used by the opt-in illustrative
// accretion disk in js/blackhole.js. Schwarzschild null geodesics form a
// one-parameter family (impact parameter b) up to rotation, so a camera ray
// from any observer radius is a segment of a master trajectory:
//
//   File T  schwarzschild-disk-trajectory-512x512-rg32f.bin
//     rows:    ray family w in (0,1). w < 0.5 is the captured half,
//              b = b_crit (1 - eps), eps log-uniform in [epsMin, 1);
//              w >= 0.5 is the escaping half, b = b_crit (1 + delta),
//              delta log-uniform in [deltaMin, bMax/b_crit - 1].
//     columns: normalized azimuth t in (0,1), phi = t * phiDom(w) measured
//              from the incoming asymptote at infinity. Escaping rows store
//              only the ingoing half (phiDom = phi_turn; the outgoing half is
//              the mirror u(2 phi_turn - phi)); captured rows integrate to
//              u_end just inside the horizon (phiDom = phi_end).
//     R: inverse radius u = 1/r at phi.   G: du/dphi = +sqrt(R(u)) there,
//        enabling cubic Hermite interpolation in t.
//   File F  schwarzschild-disk-families-512x1-rg32f.bin
//     R: phiDom(w).   G: b(w) (redundant but test- and shader-convenient).
//   File O  schwarzschild-disk-observer-512x512-rg32f.bin
//     rows:    static-observer radius r_O/M in (6, 100), linear cell-centred
//              (identical semantics to the main lensing LUT).
//     columns: viewing angle around the per-row shadow angle. Left half is
//              the captured side, alpha = alpha_shadow (1 - epsAlpha),
//              epsAlpha log-uniform; right half is the escaping side reusing
//              the main LUT's C1 s(q) mapping.
//     R: phi_O (azimuth from infinity to the observer, ingoing branch).
//     G: dphiEnd (azimuth remaining from the observer to the trajectory end:
//        the outgoing asymptote for escaping rays, u_end for captured ones).
//        Stored directly to avoid differencing two ~29 rad interpolants.
//
// All values are the numerical integrals of the Schwarzschild orbit equation
// in G = c = M = 1; no artistic tuning is stored in these tables.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LUT_GRID,
  legendreQuadrature,
  impactParameter,
  turningRadius,
  shadowAngularRadius,
  alphaFromSampleCoordinate,
  sampleCoordinateFromLookupCoordinate,
  lookupCoordinateFromSampleCoordinate,
  traceEscapingRay,
} from './generate_blackhole_lut.mjs';
import * as DiskConstants from '../js/blackhole-lut-constants.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'textures', 'blackhole');
const OUT_TRAJECTORY_BIN = resolve(OUT_DIR, 'schwarzschild-disk-trajectory-512x512-rg32f.bin');
const OUT_FAMILY_BIN = resolve(OUT_DIR, 'schwarzschild-disk-families-512x1-rg32f.bin');
const OUT_OBSERVER_BIN = resolve(OUT_DIR, 'schwarzschild-disk-observer-512x512-rg32f.bin');
const OUT_META = resolve(OUT_DIR, 'schwarzschild-disk-lut.json');

const B_CRIT = LUT_GRID.criticalImpactParameterOverM;

export const DISK_LUT_GRID = Object.freeze({
  trajectoryWidth: DiskConstants.DISK_LUT_WIDTH,
  trajectoryHeight: DiskConstants.DISK_LUT_HEIGHT,
  familyWidth: DiskConstants.DISK_LUT_HEIGHT,
  observerWidth: DiskConstants.DISK_LUT_WIDTH,
  observerHeight: DiskConstants.DISK_LUT_HEIGHT,
  channels: 2,
  bytesPerChannel: Float32Array.BYTES_PER_ELEMENT,
  criticalImpactParameterOverM: B_CRIT,
  capturedEpsilonMin: DiskConstants.DISK_CAPTURED_EPSILON_MIN,
  escapingDeltaMin: DiskConstants.DISK_ESCAPING_DELTA_MIN,
  impactParameterMaxOverM: DiskConstants.DISK_IMPACT_MAX_OVER_M,
  capturedEndInverseRadius: DiskConstants.DISK_CAPTURED_END_INVERSE_RADIUS,
  observerRadiusMin: LUT_GRID.observerRadiusMin,
  observerRadiusMax: LUT_GRID.observerRadiusMax,
  observerAlphaEpsilonMin: DiskConstants.DISK_OBSERVER_ALPHA_EPSILON_MIN,
  maxCrossings: DiskConstants.DISK_MAX_CROSSINGS,
  diskInnerRadiusOverM: DiskConstants.DISK_INNER_RADIUS_OVER_M,
});

const GL = legendreQuadrature(192);
const GL_REFERENCE = legendreQuadrature(384);
const DENSE_INVERSION_SAMPLES = 2048;
const CAPTURED_SIMPSON_INTERVALS = 8192;

function radialPotential(u, inverseB2) {
  return inverseB2 - u * u + 2 * u * u * u;
}

// Azimuth accumulated between u = uTurning - sExtent^2 and the turning point,
// for an escaping family. Algebraically identical to the main generator's
// integralToTurning, but evaluated through the exact cubic factorization
//   R(u) = 2 (u - u_T) (u^2 + p u + q),  p = u_T - 1/2,  q = -1/(2 b^2 u_T),
// so with u = u_T - sigma^2 the sigma^2 factor is analytic:
//   dphi = 2 dsigma / sqrt(-2 Q(u_T - sigma^2)).
// The direct R(u) difference cancels catastrophically for the tiny
// near-turning intervals this generator needs (R ~ 1e-18 under 1e-16 float64
// noise); the factorized form is cancellation-free there.
function azimuthFromTurning(b, uTurning, sExtent, quadrature = GL) {
  if (!(sExtent > 0)) return 0;
  const p = uTurning - 0.5;
  const q = -1 / (2 * b * b * uTurning);
  const scale = sExtent * 0.5;
  let sum = 0;
  for (let i = 0; i < quadrature.x.length; i++) {
    const sigma = scale * (quadrature.x[i] + 1);
    const u = uTurning - sigma * sigma;
    const quadraticValue = u * u + p * u + q;
    sum += quadrature.w[i] * 2 / Math.sqrt(Math.max(1e-30, -2 * quadraticValue));
  }
  return scale * sum;
}

// d(azimuthFromTurning)/dsExtent — the same factorized integrand, exact.
function azimuthFromTurningDerivative(b, uTurning, s) {
  const p = uTurning - 0.5;
  const q = -1 / (2 * b * b * uTurning);
  const u = uTurning - s * s;
  return 2 / Math.sqrt(Math.max(1e-30, -2 * (u * u + p * u + q)));
}

// ------------------------------------------------------------- family maps

export function familyImpactParameter(familyCoordinate) {
  const grid = DISK_LUT_GRID;
  if (familyCoordinate < 0.5) {
    const v = familyCoordinate * 2;
    const eps = Math.exp(Math.log(grid.capturedEpsilonMin) * v);
    return B_CRIT * (1 - eps);
  }
  const v = (familyCoordinate - 0.5) * 2;
  const deltaMax = grid.impactParameterMaxOverM / B_CRIT - 1;
  const delta = grid.escapingDeltaMin
    * Math.exp(Math.log(deltaMax / grid.escapingDeltaMin) * v);
  return B_CRIT * (1 + delta);
}

export function familyCoordinateFromImpactParameter(b) {
  const grid = DISK_LUT_GRID;
  if (b < B_CRIT) {
    const eps = Math.min(1, Math.max(grid.capturedEpsilonMin, 1 - b / B_CRIT));
    return 0.5 * (Math.log(eps) / Math.log(grid.capturedEpsilonMin));
  }
  const deltaMax = grid.impactParameterMaxOverM / B_CRIT - 1;
  const delta = Math.min(deltaMax, Math.max(grid.escapingDeltaMin, b / B_CRIT - 1));
  return 0.5 + 0.5 * (Math.log(delta / grid.escapingDeltaMin)
    / Math.log(deltaMax / grid.escapingDeltaMin));
}

// ------------------------------------------------- captured-family azimuth

// For b < b_crit the radial potential stays positive but dips sharply near
// u = 1/3 as b -> b_crit. The substitution u = 1/3 + sqrt(R(1/3)) sinh(x)
// turns the near-Lorentzian 1/sqrt(R) peak into a smooth O(1) integrand, so
// fixed-order Gauss-Legendre converges for every family down to eps = 1e-6.
function capturedTransform(b) {
  const inverseB2 = 1 / (b * b);
  const potentialAtPeak = radialPotential(1 / 3, inverseB2);
  const scale = Math.sqrt(potentialAtPeak);
  return {
    inverseB2,
    xOf: u => Math.asinh((u - 1 / 3) / scale),
    uOf: x => 1 / 3 + scale * Math.sinh(x),
    integrand(x) {
      const u = 1 / 3 + scale * Math.sinh(x);
      return scale * Math.cosh(x)
        / Math.sqrt(radialPotential(u, inverseB2));
    },
  };
}

export function capturedAzimuth(b, uFrom, uTo, quadrature = GL) {
  const transform = capturedTransform(b);
  const x0 = transform.xOf(uFrom);
  const x1 = transform.xOf(uTo);
  const scale = (x1 - x0) * 0.5;
  const mid = (x1 + x0) * 0.5;
  let sum = 0;
  for (let i = 0; i < quadrature.x.length; i++) {
    sum += quadrature.w[i] * transform.integrand(mid + scale * quadrature.x[i]);
  }
  return scale * sum;
}

// -------------------------------------------------------- trajectory rows

// Deterministic full-row computation shared by the generator and the Node
// regression suite (which recomputes selected rows and compares bit for bit
// after Float32 rounding).
export function trajectoryRowValues(rowIndex) {
  const grid = DISK_LUT_GRID;
  const w = (rowIndex + 0.5) / grid.trajectoryHeight;
  const b = familyImpactParameter(w);
  const width = grid.trajectoryWidth;
  const uValues = new Float64Array(width);
  const gValues = new Float64Array(width);
  const inverseB2 = 1 / (b * b);

  if (w >= 0.5) {
    // Escaping family: invert psi(s) (azimuth back from the turning point,
    // with the endpoint-regularizing substitution u = u_t - s^2).
    const uTurning = 1 / turningRadius(b, b + 3);
    const phiDom = azimuthFromTurning(b, uTurning, Math.sqrt(uTurning), GL);
    const sMax = Math.sqrt(uTurning);
    const dense = new Float64Array(DENSE_INVERSION_SAMPLES);
    const denseS = new Float64Array(DENSE_INVERSION_SAMPLES);
    for (let j = 0; j < DENSE_INVERSION_SAMPLES; j++) {
      const s = sMax * j / (DENSE_INVERSION_SAMPLES - 1);
      denseS[j] = s;
      dense[j] = azimuthFromTurning(b, uTurning, s, GL);
    }
    for (let i = 0; i < width; i++) {
      const t = (i + 0.5) / width;
      const psiTarget = phiDom * (1 - t);
      // Monotone bracket then Newton refinement on psi(s) = psiTarget.
      let lo = 0;
      let hi = DENSE_INVERSION_SAMPLES - 1;
      while (hi - lo > 1) {
        const midIndex = (lo + hi) >> 1;
        if (dense[midIndex] < psiTarget) lo = midIndex;
        else hi = midIndex;
      }
      const span = dense[hi] - dense[lo];
      let s = span > 0
        ? denseS[lo] + (denseS[hi] - denseS[lo]) * (psiTarget - dense[lo]) / span
        : denseS[lo];
      for (let iteration = 0; iteration < 3; iteration++) {
        const psi = azimuthFromTurning(b, uTurning, s, GL);
        s -= (psi - psiTarget) / azimuthFromTurningDerivative(b, uTurning, s);
        s = Math.min(sMax, Math.max(0, s));
      }
      const u = uTurning - s * s;
      uValues[i] = u;
      // du/dphi = sqrt(R) = s * sqrt(-2 Q(u)) through the same stable
      // factorization (the direct difference cancels near the turning point).
      const stableQ = u * u + (uTurning - 0.5) * u - 1 / (2 * b * b * uTurning);
      gValues[i] = s * Math.sqrt(Math.max(0, -2 * stableQ));
    }
    return { familyCoordinate: w, b, phiDom, uValues, gValues };
  }

  // Captured family: cumulative Simpson over the sinh-transformed variable,
  // then monotone inversion with Newton refinement (dphi/dx is analytic).
  const transform = capturedTransform(b);
  const x0 = transform.xOf(0);
  const x1 = transform.xOf(DISK_LUT_GRID.capturedEndInverseRadius);
  const intervals = CAPTURED_SIMPSON_INTERVALS;
  const step = (x1 - x0) / intervals;
  const cumulative = new Float64Array(intervals / 2 + 1);
  let previousF = transform.integrand(x0);
  for (let pair = 0; pair < intervals / 2; pair++) {
    const xMid = x0 + step * (2 * pair + 1);
    const xEnd = x0 + step * (2 * pair + 2);
    const fMid = transform.integrand(xMid);
    const fEnd = transform.integrand(xEnd);
    cumulative[pair + 1] = cumulative[pair]
      + (step / 3) * (previousF + 4 * fMid + fEnd);
    previousF = fEnd;
  }
  const phiDom = cumulative[intervals / 2];
  for (let i = 0; i < width; i++) {
    const t = (i + 0.5) / width;
    const phiTarget = phiDom * t;
    let lo = 0;
    let hi = intervals / 2;
    while (hi - lo > 1) {
      const midIndex = (lo + hi) >> 1;
      if (cumulative[midIndex] < phiTarget) lo = midIndex;
      else hi = midIndex;
    }
    const span = cumulative[hi] - cumulative[lo];
    let x = x0 + step * 2 * (span > 0
      ? lo + (phiTarget - cumulative[lo]) / span
      : lo);
    for (let iteration = 0; iteration < 3; iteration++) {
      const phi = capturedAzimuth(b, 0, transform.uOf(x));
      x -= (phi - phiTarget) / transform.integrand(x);
      x = Math.min(x1, Math.max(x0, x));
    }
    const u = transform.uOf(x);
    uValues[i] = u;
    gValues[i] = Math.sqrt(Math.max(0, radialPotential(u, transform.inverseB2)));
  }
  return { familyCoordinate: w, b, phiDom, uValues, gValues };
}

// ---------------------------------------------------------- observer maps

export function observerAlphaFromColumn(columnCoordinate, observerRadius) {
  const grid = DISK_LUT_GRID;
  const shadow = shadowAngularRadius(observerRadius);
  if (columnCoordinate < 0.5) {
    const v = columnCoordinate * 2;
    const eps = Math.exp(Math.log(grid.observerAlphaEpsilonMin) * v);
    return shadow * (1 - eps);
  }
  const q = (columnCoordinate - 0.5) * 2;
  const s = sampleCoordinateFromLookupCoordinate(q);
  return alphaFromSampleCoordinate(s, observerRadius);
}

export function observerColumnFromAlpha(alpha, observerRadius) {
  const grid = DISK_LUT_GRID;
  const shadow = shadowAngularRadius(observerRadius);
  if (alpha < shadow) {
    const eps = Math.min(1, Math.max(grid.observerAlphaEpsilonMin, 1 - alpha / shadow));
    return 0.5 * (Math.log(eps) / Math.log(grid.observerAlphaEpsilonMin));
  }
  const s = Math.sqrt(Math.min(1,
    Math.max(0, (alpha - shadow) / (Math.PI / 2 - shadow))));
  return 0.5 + 0.5 * lookupCoordinateFromSampleCoordinate(s);
}

// Deterministic texel computation shared with the regression suite.
export function observerTexelValues(x, y) {
  const grid = DISK_LUT_GRID;
  const observerRadius = grid.observerRadiusMin
    + (grid.observerRadiusMax - grid.observerRadiusMin) * (y + 0.5) / grid.observerHeight;
  const columnCoordinate = (x + 0.5) / grid.observerWidth;
  const alpha = observerAlphaFromColumn(columnCoordinate, observerRadius);
  const b = impactParameter(alpha, observerRadius);
  const uObserver = 1 / observerRadius;
  const inverseB2 = 1 / (b * b);
  if (columnCoordinate < 0.5) {
    // Captured side: the ingoing arc to the observer stays well clear of the
    // u = 1/3 potential dip (u_O <= 1/6), but the continuation to u_end
    // crosses it, hence the transformed integrator for dphiEnd.
    const phiObserver = capturedAzimuth(b, 0, uObserver);
    const phiEndRemaining = capturedAzimuth(b, uObserver, grid.capturedEndInverseRadius);
    return { observerRadius, alpha, b, phiObserver, phiEndRemaining };
  }
  const uTurning = 1 / turningRadius(b, observerRadius);
  const farSide = azimuthFromTurning(b, uTurning, Math.sqrt(uTurning), GL);
  const nearSide = azimuthFromTurning(b, uTurning,
    Math.sqrt(Math.max(0, uTurning - uObserver)), GL);
  return {
    observerRadius,
    alpha,
    b,
    phiObserver: farSide - nearSide,
    phiEndRemaining: farSide + nearSide,
  };
}

// -------------------------------------------------- Node sampling mirrors

function sideClampedIndices(coordinate, size, boundary) {
  const pixel = Math.max(0, Math.min(size - 1, coordinate * size - 0.5));
  let i0 = Math.floor(pixel);
  let i1 = Math.min(size - 1, i0 + 1);
  const f = pixel - i0;
  if (i0 < boundary && i1 >= boundary) {
    if (coordinate < boundary / size) i1 = boundary - 1;
    else i0 = boundary;
  }
  return { i0, i1, f };
}

/** Hermite sample of u(phiTraj) for family b from the packed trajectory data. */
export function sampleTrajectoryU(buffers, b, phiTraj) {
  const grid = DISK_LUT_GRID;
  const width = grid.trajectoryWidth;
  const w = familyCoordinateFromImpactParameter(b);
  const rows = sideClampedIndices(w, grid.trajectoryHeight, grid.trajectoryHeight / 2);
  const sampleRow = (row) => {
    const phiDom = buffers.family[2 * row];
    let t = phiTraj / phiDom;
    if (b >= B_CRIT && t > 1) t = 2 - t; // mirror across the turning point
    t = Math.min(1, Math.max(0, t));
    const pixel = Math.max(0, Math.min(width - 1, t * width - 0.5));
    const j0 = Math.floor(pixel);
    const j1 = Math.min(width - 1, j0 + 1);
    const f = pixel - j0;
    const u0 = buffers.trajectory[2 * (row * width + j0)];
    const u1 = buffers.trajectory[2 * (row * width + j1)];
    const g0 = buffers.trajectory[2 * (row * width + j0) + 1];
    const g1 = buffers.trajectory[2 * (row * width + j1) + 1];
    const nodeSpacing = phiDom / width;
    const m0 = g0 * nodeSpacing;
    const m1 = g1 * nodeSpacing;
    const f2 = f * f;
    const f3 = f2 * f;
    return (2 * f3 - 3 * f2 + 1) * u0 + (f3 - 2 * f2 + f) * m0
      + (-2 * f3 + 3 * f2) * u1 + (f3 - f2) * m1;
  };
  const uA = sampleRow(rows.i0);
  const uB = rows.i1 === rows.i0 ? uA : sampleRow(rows.i1);
  return uA * (1 - rows.f) + uB * rows.f;
}

/** Side-clamped bilinear sample of {phi_O, dphiEnd} from the observer table. */
export function sampleObserver(buffers, alpha, observerRadius) {
  const grid = DISK_LUT_GRID;
  const width = grid.observerWidth;
  const columnCoordinate = observerColumnFromAlpha(alpha, observerRadius);
  const columns = sideClampedIndices(columnCoordinate, width, width / 2);
  const rowCoordinate = (observerRadius - grid.observerRadiusMin)
    / (grid.observerRadiusMax - grid.observerRadiusMin);
  const rowPixel = Math.max(0, Math.min(grid.observerHeight - 1,
    rowCoordinate * grid.observerHeight - 0.5));
  const y0 = Math.floor(rowPixel);
  const y1 = Math.min(grid.observerHeight - 1, y0 + 1);
  const fy = rowPixel - y0;
  const at = (x, y, channel) => buffers.observer[2 * (y * width + x) + channel];
  const blend = channel => {
    const top = at(columns.i0, y0, channel) * (1 - columns.f)
      + at(columns.i1, y0, channel) * columns.f;
    const bottom = at(columns.i0, y1, channel) * (1 - columns.f)
      + at(columns.i1, y1, channel) * columns.f;
    return top * (1 - fy) + bottom * fy;
  };
  return { phiObserver: blend(0), phiEndRemaining: blend(1) };
}

/**
 * Full float64 mirror of the shader's disk-crossing loop. e1DotZ/e2DotZ are
 * the dot products of the observer radial direction and the ray tangent with
 * the disk axis; the returned crossings carry the master azimuth and radius.
 */
export function computeDiskCrossings(buffers, alpha, observerRadius, e1DotZ, e2DotZ, {
  innerRadius = DISK_LUT_GRID.diskInnerRadiusOverM,
  outerRadius = 30,
} = {}) {
  const b = impactParameter(alpha, observerRadius);
  const { phiObserver, phiEndRemaining } = sampleObserver(buffers, alpha, observerRadius);
  let phi0 = Math.atan2(-e1DotZ, e2DotZ);
  phi0 = ((phi0 % Math.PI) + Math.PI) % Math.PI;
  if (phi0 === 0) phi0 = Math.PI;
  const crossings = [];
  for (let k = 0; k < DISK_LUT_GRID.maxCrossings; k++) {
    const phi = phi0 + k * Math.PI;
    if (phi > phiEndRemaining) break;
    const u = sampleTrajectoryU(buffers, b, phiObserver + phi);
    const radius = 1 / u;
    crossings.push({
      order: k,
      phi,
      radius,
      hit: radius >= innerRadius && radius <= outerRadius,
    });
  }
  return crossings;
}

// ------------------------------------------------------------- validation

function verifyGenerated(buffers) {
  const grid = DISK_LUT_GRID;
  let nonFinite = 0;
  for (const array of [buffers.trajectory, buffers.family, buffers.observer]) {
    for (let i = 0; i < array.length; i++) {
      if (!Number.isFinite(array[i])) nonFinite++;
    }
  }

  // Trajectory rows must be strictly monotone in t (u rises toward the
  // turning point or the horizon) with non-negative slopes stored in G.
  let monotoneViolations = 0;
  let negativeSlopes = 0;
  for (let row = 0; row < grid.trajectoryHeight; row++) {
    for (let i = 0; i < grid.trajectoryWidth; i++) {
      const offset = 2 * (row * grid.trajectoryWidth + i);
      if (buffers.trajectory[offset + 1] < 0) negativeSlopes++;
      if (i > 0 && buffers.trajectory[offset] < buffers.trajectory[offset - 2]) {
        monotoneViolations++;
      }
    }
  }

  // Hermite interpolation against the independent 384-point reference, on
  // off-grid azimuths of representative escaping and captured families.
  let maxEscapingUError = 0;
  let maxCapturedUError = 0;
  for (const w of [0.531, 0.62, 0.75, 0.93]) {
    const b = familyImpactParameter(w);
    const uTurning = 1 / turningRadius(b, b + 3);
    const phiDom = azimuthFromTurning(b, uTurning, Math.sqrt(uTurning), GL_REFERENCE);
    for (const t of [0.11, 0.37, 0.68, 0.955]) {
      const phi = phiDom * t;
      const psi = phiDom * (1 - t);
      // Reference: solve psi(s) = psi with bisection on the reference rule.
      let lo = 0;
      let hi = Math.sqrt(uTurning);
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) * 0.5;
        const value = azimuthFromTurning(b, uTurning, mid, GL_REFERENCE);
        if (value < psi) lo = mid;
        else hi = mid;
      }
      const uReference = uTurning - ((lo + hi) * 0.5) ** 2;
      const uTable = sampleTrajectoryU(buffers, b, phi);
      maxEscapingUError = Math.max(maxEscapingUError, Math.abs(uTable - uReference));
    }
  }
  for (const w of [0.07, 0.21, 0.36, 0.478]) {
    const b = familyImpactParameter(w);
    const phiDom = capturedAzimuth(b, 0, grid.capturedEndInverseRadius, GL_REFERENCE);
    for (const t of [0.11, 0.37, 0.68, 0.955]) {
      const phi = phiDom * t;
      let lo = 0;
      let hi = grid.capturedEndInverseRadius;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) * 0.5;
        const value = capturedAzimuth(b, 0, mid, GL_REFERENCE);
        if (value < phi) lo = mid;
        else hi = mid;
      }
      const uReference = (lo + hi) * 0.5;
      const uTable = sampleTrajectoryU(buffers, b, phi);
      maxCapturedUError = Math.max(maxCapturedUError, Math.abs(uTable - uReference));
    }
  }

  // Observer escaping side, against the independent 384-point stable rule
  // (all columns) and against the main generator's direct tracer away from
  // the critical curve (its unfactorized potential is the noisier of the two
  // exactly at the near-critical columns, so it is no reference there).
  let maxPhiEndReferenceError = 0;
  let maxPhiEndDirectError = 0;
  for (const y of [0, 130, 255, 384, 511]) {
    for (const x of [256, 280, 330, 400, 470, 511]) {
      const texel = observerTexelValues(x, y);
      const uTurning = 1 / turningRadius(texel.b, texel.observerRadius);
      const reference = azimuthFromTurning(texel.b, uTurning, Math.sqrt(uTurning), GL_REFERENCE)
        + azimuthFromTurning(texel.b, uTurning,
          Math.sqrt(Math.max(0, uTurning - 1 / texel.observerRadius)), GL_REFERENCE);
      maxPhiEndReferenceError = Math.max(maxPhiEndReferenceError,
        Math.abs(texel.phiEndRemaining - reference));
      if (x >= 330) {
        const direct = traceEscapingRay(texel.alpha, texel.observerRadius);
        if (direct.escaped) {
          maxPhiEndDirectError = Math.max(maxPhiEndDirectError,
            Math.abs(texel.phiEndRemaining - direct.phi));
        }
      }
    }
  }

  return {
    nonFiniteScalars: nonFinite,
    trajectoryMonotoneViolations: monotoneViolations,
    trajectoryNegativeSlopes: negativeSlopes,
    maxEscapingInverseRadiusAbsError: maxEscapingUError,
    maxCapturedInverseRadiusAbsError: maxCapturedUError,
    maxObserverPhiEndAbsErrorVsReference: maxPhiEndReferenceError,
    maxObserverPhiEndAbsErrorVsDirectTracerBroadField: maxPhiEndDirectError,
    referenceIntegrator: 'factorized/sinh-transformed 384-point Gauss-Legendre',
  };
}

export function generateBuffers() {
  const grid = DISK_LUT_GRID;
  const trajectory = new Float32Array(grid.trajectoryWidth * grid.trajectoryHeight * 2);
  const family = new Float32Array(grid.familyWidth * 2);
  for (let row = 0; row < grid.trajectoryHeight; row++) {
    const values = trajectoryRowValues(row);
    family[2 * row] = values.phiDom;
    family[2 * row + 1] = values.b;
    for (let i = 0; i < grid.trajectoryWidth; i++) {
      trajectory[2 * (row * grid.trajectoryWidth + i)] = values.uValues[i];
      trajectory[2 * (row * grid.trajectoryWidth + i) + 1] = values.gValues[i];
    }
  }
  const observer = new Float32Array(grid.observerWidth * grid.observerHeight * 2);
  for (let y = 0; y < grid.observerHeight; y++) {
    for (let x = 0; x < grid.observerWidth; x++) {
      const texel = observerTexelValues(x, y);
      observer[2 * (y * grid.observerWidth + x)] = texel.phiObserver;
      observer[2 * (y * grid.observerWidth + x) + 1] = texel.phiEndRemaining;
    }
  }
  return { trajectory, family, observer };
}

async function main() {
  console.log('Generating disk master-trajectory tables (this takes a while)...');
  const startedAt = Date.now();
  const buffers = generateBuffers();
  const validation = verifyGenerated(buffers);
  if (validation.nonFiniteScalars > 0
      || validation.trajectoryMonotoneViolations > 0
      || validation.trajectoryNegativeSlopes > 0
      || validation.maxEscapingInverseRadiusAbsError > 5e-5
      || validation.maxCapturedInverseRadiusAbsError > 5e-4
      || validation.maxObserverPhiEndAbsErrorVsReference > 1e-8
      || validation.maxObserverPhiEndAbsErrorVsDirectTracerBroadField > 1e-6) {
    throw new Error(`invalid table: ${JSON.stringify(validation)}`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_TRAJECTORY_BIN, Buffer.from(buffers.trajectory.buffer));
  await writeFile(OUT_FAMILY_BIN, Buffer.from(buffers.family.buffer));
  await writeFile(OUT_OBSERVER_BIN, Buffer.from(buffers.observer.buffer));
  await writeFile(OUT_META, JSON.stringify({
    format: 'RG32F little-endian, tightly packed, row-major',
    files: {
      trajectory: 'schwarzschild-disk-trajectory-512x512-rg32f.bin',
      family: 'schwarzschild-disk-families-512x1-rg32f.bin',
      observer: 'schwarzschild-disk-observer-512x512-rg32f.bin',
    },
    grid: DISK_LUT_GRID,
    metric: 'Schwarzschild; geometric units G=c=M=1',
    integrator: 'endpoint-regularized / sinh-transformed 192-point Gauss-Legendre'
      + `; ${CAPTURED_SIMPSON_INTERVALS}-interval cumulative Simpson for captured rows`,
    generator: 'tools/generate_blackhole_disk_lut.mjs',
    generationSeconds: (Date.now() - startedAt) / 1000,
    validation,
  }, null, 2) + '\n');
  console.log(`Wrote ${OUT_TRAJECTORY_BIN} (${buffers.trajectory.byteLength} bytes)`);
  console.log(`Wrote ${OUT_FAMILY_BIN} (${buffers.family.byteLength} bytes)`);
  console.log(`Wrote ${OUT_OBSERVER_BIN} (${buffers.observer.byteLength} bytes)`);
  console.log(`Max escaping |du| vs reference: ${validation.maxEscapingInverseRadiusAbsError.toExponential(3)}`);
  console.log(`Max captured |du| vs reference: ${validation.maxCapturedInverseRadiusAbsError.toExponential(3)}`);
  console.log(`Max observer dphiEnd vs 384-pt reference: ${validation.maxObserverPhiEndAbsErrorVsReference.toExponential(3)}`);
  console.log(`Max observer dphiEnd vs direct tracer (broad field): ${validation.maxObserverPhiEndAbsErrorVsDirectTracerBroadField.toExponential(3)}`);
}

// Stable near-turning integrator, shared with the regression suite as an
// independent reference path.
export { azimuthFromTurning };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

#!/usr/bin/env node
// Generate the finite-observer Schwarzschild null-geodesic lookup used by
// js/blackhole.js. The output has no artistic tuning: every escaping entry is
// the numerical integral of the Schwarzschild orbit equation (G = c = M = 1).
//
// Binary layout: tightly packed little-endian Float32 RG pairs, row-major.
//   x: a piecewise lookup coordinate q in (0, 1). It maps logarithmically to
//      s near the critical curve, then linearly through the broad field. The
//      physical angle is alpha = alpha_shadow
//      + (pi/2 - alpha_shadow) s^2. Texels are sampled at cell centres.
//   y: static-observer radius r_O/M in (6, 100), sampled at cell centres
//   R: total azimuth Phi between observer radial direction and the outgoing
//      asymptote at infinity
//   G: 1 for an escaping ray, 0 for a captured ray

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'textures', 'blackhole');
const OUT_BIN = resolve(OUT_DIR, 'schwarzschild-lut-512x512-rg32f.bin');
const OUT_META = resolve(OUT_DIR, 'schwarzschild-lut-512x512.json');

const WIDTH = 512;
const HEIGHT = 512;
const R_MIN = 6;
const R_MAX = 100;
const ALPHA_MAX = Math.PI / 2;
const B_CRIT = 3 * Math.sqrt(3);
const QUADRATURE_ORDER = 192;
const SAMPLE_MIN = 1e-6;
const SAMPLE_SPLIT = 0.08;
// Choose qSplit so the logarithmic and linear branches have the same ds/dq at
// their join. A merely C0 mapping creates a visible interpolation kink in Phi.
const SAMPLE_LOG_RANGE = Math.log(SAMPLE_SPLIT / SAMPLE_MIN);
const LOOKUP_SPLIT = SAMPLE_SPLIT * SAMPLE_LOG_RANGE
  / (SAMPLE_SPLIT * SAMPLE_LOG_RANGE + 1 - SAMPLE_SPLIT);

// Public grid contract used by the Node regression suite. Keeping this next to
// the generator constants prevents tests from silently re-implementing a stale
// shader mapping. The runtime has the same literal constants because it cannot
// import this Node-only module.
export const LUT_GRID = Object.freeze({
  width: WIDTH,
  height: HEIGHT,
  channels: 2,
  bytesPerChannel: Float32Array.BYTES_PER_ELEMENT,
  observerRadiusMin: R_MIN,
  observerRadiusMax: R_MAX,
  alphaMax: ALPHA_MAX,
  criticalImpactParameterOverM: B_CRIT,
  sampleMin: SAMPLE_MIN,
  sampleSplit: SAMPLE_SPLIT,
  lookupSplit: LOOKUP_SPLIT,
  sampleLogRange: SAMPLE_LOG_RANGE,
});

function legendreQuadrature(order) {
  const x = new Float64Array(order);
  const w = new Float64Array(order);
  const half = Math.ceil(order / 2);

  for (let i = 0; i < half; i++) {
    let z = Math.cos(Math.PI * (i + 0.75) / (order + 0.5));
    let zPrev;
    let derivative = 0;
    do {
      let p0 = 1;
      let p1 = z;
      for (let n = 2; n <= order; n++) {
        const p2 = ((2 * n - 1) * z * p1 - (n - 1) * p0) / n;
        p0 = p1;
        p1 = p2;
      }
      derivative = order * (z * p1 - p0) / (z * z - 1);
      zPrev = z;
      z -= p1 / derivative;
    } while (Math.abs(z - zPrev) > 2e-15);

    x[i] = -z;
    x[order - 1 - i] = z;
    const weight = 2 / ((1 - z * z) * derivative * derivative);
    w[i] = weight;
    w[order - 1 - i] = weight;
  }
  return { x, w };
}

const GL = legendreQuadrature(QUADRATURE_ORDER);
const GL_REFERENCE = legendreQuadrature(384);

function impactParameter(alpha, observerRadius) {
  return observerRadius * Math.sin(alpha) / Math.sqrt(1 - 2 / observerRadius);
}

export function shadowAngularRadius(observerRadius) {
  return Math.asin(B_CRIT * Math.sqrt(1 - 2 / observerRadius) / observerRadius);
}

// The outer positive root of b^2 = r^3 / (r - 2) is the periapsis of an
// escaping inward ray. Bisection is deterministic and remains stable close to
// the double root at the photon sphere (r = 3M).
function turningRadius(b, observerRadius) {
  const b2 = b * b;
  let lo = 3;
  let hi = observerRadius;
  if (Math.abs(Math.sin(Math.asin(Math.min(1, b * Math.sqrt(1 - 2 / observerRadius) / observerRadius))) - 1) < 1e-14) {
    return observerRadius;
  }
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) * 0.5;
    const value = (mid * mid * mid) / (mid - 2) - b2;
    if (value > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) * 0.5;
}

// Integrate dPhi/du from a to the turning point. u = u_t - s^2 removes the
// square-root endpoint singularity, after which high-order Gauss-Legendre is
// smooth and rapidly convergent.
function integralToTurning(uStart, uTurning, inverseB2, quadrature = GL) {
  const extent = Math.sqrt(Math.max(0, uTurning - uStart));
  if (extent === 0) return 0;
  const scale = extent * 0.5;
  let sum = 0;
  for (let i = 0; i < quadrature.x.length; i++) {
    const s = scale * (quadrature.x[i] + 1);
    const u = uTurning - s * s;
    const radial = Math.max(1e-30, inverseB2 - u * u + 2 * u * u * u);
    sum += quadrature.w[i] * (2 * s / Math.sqrt(radial));
  }
  return scale * sum;
}

export function traceEscapingRay(alpha, observerRadius, quadrature = GL) {
  const critical = shadowAngularRadius(observerRadius);
  if (!(alpha > critical)) return { escaped: false, phi: 0 };

  const b = impactParameter(alpha, observerRadius);
  const rTurning = turningRadius(b, observerRadius);
  const uTurning = 1 / rTurning;
  const inverseB2 = 1 / (b * b);
  const farSide = integralToTurning(0, uTurning, inverseB2, quadrature);
  const nearSide = integralToTurning(1 / observerRadius, uTurning, inverseB2, quadrature);
  return { escaped: true, phi: farSide + nearSide };
}

// Independent higher-order reference used by tests and metadata validation.
// Keeping this path out of the generated table makes accidental solver/LUT
// agreement less likely to hide an integration regression.
export function traceEscapingRayReference(alpha, observerRadius) {
  return traceEscapingRay(alpha, observerRadius, GL_REFERENCE);
}

export function alphaFromSampleCoordinate(sampleCoordinate, observerRadius) {
  const critical = shadowAngularRadius(observerRadius);
  return critical + (ALPHA_MAX - critical) * sampleCoordinate * sampleCoordinate;
}

export function sampleCoordinateFromLookupCoordinate(lookupCoordinate) {
  if (lookupCoordinate <= LOOKUP_SPLIT) {
    return SAMPLE_MIN * Math.pow(
      SAMPLE_SPLIT / SAMPLE_MIN,
      lookupCoordinate / LOOKUP_SPLIT,
    );
  }
  return SAMPLE_SPLIT + (1 - SAMPLE_SPLIT)
    * (lookupCoordinate - LOOKUP_SPLIT) / (1 - LOOKUP_SPLIT);
}

/**
 * Analytic continuity audit for the piecewise q <-> s map.
 *
 * `s(q)` is logarithmic below the join and linear above it. LOOKUP_SPLIT is
 * solved so both ds/dq values match, making the coordinate transform C1. This
 * matters visually because Phi changes very quickly close to the critical
 * curve; a C0-only remap would put a false crease in the lensed sky.
 */
export function lookupJoinContinuity() {
  const sampleFromNear = SAMPLE_MIN * Math.exp(SAMPLE_LOG_RANGE);
  const sampleFromBroad = SAMPLE_SPLIT;
  const dsDqNear = SAMPLE_SPLIT * SAMPLE_LOG_RANGE / LOOKUP_SPLIT;
  const dsDqBroad = (1 - SAMPLE_SPLIT) / (1 - LOOKUP_SPLIT);
  const dqDsNear = LOOKUP_SPLIT / (SAMPLE_SPLIT * SAMPLE_LOG_RANGE);
  const dqDsBroad = (1 - LOOKUP_SPLIT) / (1 - SAMPLE_SPLIT);
  return {
    continuityClass: 'C1',
    lookupCoordinate: LOOKUP_SPLIT,
    sampleCoordinate: SAMPLE_SPLIT,
    sampleValueAbsError: Math.abs(sampleFromNear - sampleFromBroad),
    dsDqNear,
    dsDqBroad,
    dsDqAbsError: Math.abs(dsDqNear - dsDqBroad),
    dqDsNear,
    dqDsBroad,
    dqDsAbsError: Math.abs(dqDsNear - dqDsBroad),
  };
}

export function lookupCoordinateFromSampleCoordinate(sampleCoordinate) {
  if (sampleCoordinate <= SAMPLE_SPLIT) {
    if (sampleCoordinate <= SAMPLE_MIN) return 0;
    return LOOKUP_SPLIT * Math.log(sampleCoordinate / SAMPLE_MIN)
      / Math.log(SAMPLE_SPLIT / SAMPLE_MIN);
  }
  return LOOKUP_SPLIT + (1 - LOOKUP_SPLIT)
    * (sampleCoordinate - SAMPLE_SPLIT) / (1 - SAMPLE_SPLIT);
}

export function sampleGeneratedLut(values, sampleCoordinate, observerRadius) {
  // Match WebGL's bilinear sampling of centre-sampled texels with clamp-to-edge.
  const lookupCoordinate = lookupCoordinateFromSampleCoordinate(sampleCoordinate);
  const fx = Math.max(0, Math.min(WIDTH - 1, lookupCoordinate * WIDTH - 0.5));
  const fy = Math.max(0, Math.min(HEIGHT - 1,
    ((observerRadius - R_MIN) / (R_MAX - R_MIN)) * HEIGHT - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(WIDTH - 1, x0 + 1), y1 = Math.min(HEIGHT - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const at = (x, y) => values[2 * (y * WIDTH + x)];
  const a = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const b = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return a * (1 - ty) + b * ty;
}

function verifyBeforeGeneration() {
  const rO = 30;
  const expectedShadow = 9.632732 * Math.PI / 180;
  const actualShadow = shadowAngularRadius(rO);
  if (Math.abs(actualShadow - expectedShadow) > 2e-6) {
    throw new Error(`shadow-angle check failed: ${actualShadow * 180 / Math.PI} deg`);
  }

  // At alpha = pi/2 the ray is initially tangent. The two independent
  // quadrature orders must agree well below Float32 output precision.
  for (const alphaDeg of [12, 20, 35, 60, 89.5]) {
    const result = traceEscapingRay(alphaDeg * Math.PI / 180, rO);
    if (!result.escaped || !Number.isFinite(result.phi) || result.phi <= 0) {
      throw new Error(`invalid escaping ray at ${alphaDeg} deg`);
    }
  }

  // In flat spacetime Phi = pi - alpha. Reconstructing the asymptotic source
  // direction with that Phi must return the original ray (the m -> 0 identity).
  let flatIdentityError = 0;
  for (const alphaDeg of [0.01, 5, 25, 55, 89.9]) {
    const alpha = alphaDeg * Math.PI / 180;
    const phi = Math.PI - alpha;
    const reconstructed = [-Math.cos(phi), Math.sin(phi)];
    const original = [Math.cos(alpha), Math.sin(alpha)];
    flatIdentityError = Math.max(flatIdentityError,
      Math.hypot(reconstructed[0] - original[0], reconstructed[1] - original[1]));
  }
  if (flatIdentityError > 1e-14) throw new Error('flat-space identity check failed');

  const lookupJoin = lookupJoinContinuity();
  if (lookupJoin.sampleValueAbsError > 2e-16
      || lookupJoin.dsDqAbsError > 2e-14
      || lookupJoin.dqDsAbsError > 2e-16) {
    throw new Error(`piecewise lookup is not C1: ${JSON.stringify(lookupJoin)}`);
  }
  return {
    shadowAngleDeg: actualShadow * 180 / Math.PI,
    flatIdentityError,
    lookupJoin,
  };
}

function verifyGeneratedLut(values, initialValidation, escaped) {
  const rO = 30;
  // The 0.005..0.04 samples cover the visible critical-curve neighbourhood
  // at the default 55 degree view; 0.079..0.081 straddle the C1 grid join.
  const samples = [
    { s: 0.002, region: 'near-critical' },
    { s: 0.005, region: 'visible-critical-curve' },
    { s: 0.01, region: 'visible-critical-curve' },
    { s: 0.02, region: 'visible-critical-curve' },
    { s: 0.04, region: 'visible-critical-curve' },
    { s: 0.079, region: 'join-left' },
    { s: 0.08, region: 'join' },
    { s: 0.081, region: 'join-right' },
    { s: 0.1, region: 'broad-field' },
    { s: 0.35, region: 'broad-field' },
    { s: 0.8, region: 'broad-field' },
  ];
  const errors = samples.map(({ s, region }) => {
    const alpha = alphaFromSampleCoordinate(s, rO);
    const reference = traceEscapingRay(alpha, rO, GL_REFERENCE).phi;
    const lookup = sampleGeneratedLut(values, s, rO);
    return {
      s,
      region,
      alphaDeg: alpha * 180 / Math.PI,
      reference,
      lookup,
      absError: Math.abs(lookup - reference),
    };
  });

  let nonFiniteScalars = 0;
  let invalidEscapeMasks = 0;
  let minPhi = Infinity;
  let maxPhi = -Infinity;
  for (let index = 0; index < values.length; index += 2) {
    const phi = values[index];
    const mask = values[index + 1];
    if (!Number.isFinite(phi) || !Number.isFinite(mask)) nonFiniteScalars++;
    if (mask !== 1) invalidEscapeMasks++;
    minPhi = Math.min(minPhi, phi);
    maxPhi = Math.max(maxPhi, phi);
  }

  const firstQ = 0.5 / WIDTH;
  const lastQ = (WIDTH - 0.5) / WIDTH;
  return {
    ...initialValidation,
    referenceIntegrator: 'endpoint-regularized 384-point Gauss-Legendre',
    interpolationChecksAtROverM30: errors,
    maxInterpolationAbsErrorRad: Math.max(...errors.map((entry) => entry.absError)),
    grid: {
      scalarCount: values.length,
      byteLength: values.byteLength,
      escapingTexels: escaped,
      nonFiniteScalars,
      invalidEscapeMasks,
      phiRangeRad: { min: minPhi, max: maxPhi },
      texelCentres: {
        lookupCoordinate: { first: firstQ, last: lastQ },
        sampleCoordinate: {
          first: sampleCoordinateFromLookupCoordinate(firstQ),
          last: sampleCoordinateFromLookupCoordinate(lastQ),
        },
        observerRadiusOverM: {
          first: R_MIN + (R_MAX - R_MIN) * 0.5 / HEIGHT,
          last: R_MIN + (R_MAX - R_MIN) * (HEIGHT - 0.5) / HEIGHT,
        },
      },
    },
  };
}

async function main() {
  const initialValidation = verifyBeforeGeneration();
  const values = new Float32Array(WIDTH * HEIGHT * 2);
  let escaped = 0;
  for (let y = 0; y < HEIGHT; y++) {
    const rO = R_MIN + (R_MAX - R_MIN) * (y + 0.5) / HEIGHT;
    for (let x = 0; x < WIDTH; x++) {
      const q = (x + 0.5) / WIDTH;
      const s = sampleCoordinateFromLookupCoordinate(q);
      const alpha = alphaFromSampleCoordinate(s, rO);
      const result = traceEscapingRay(alpha, rO);
      const offset = 2 * (y * WIDTH + x);
      values[offset] = result.phi;
      values[offset + 1] = result.escaped ? 1 : 0;
      escaped += result.escaped ? 1 : 0;
    }
  }

  const validation = verifyGeneratedLut(values, initialValidation, escaped);

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_BIN, Buffer.from(values.buffer));
  await writeFile(OUT_META, JSON.stringify({
    format: 'RG32F little-endian, tightly packed, row-major',
    width: WIDTH,
    height: HEIGHT,
    raySampleCoordinate: {
      min: SAMPLE_MIN,
      max: 1,
      axis: 'x',
      texels: 'cell-centred',
      angleMapping: 'alpha = alpha_shadow(r_O) + (pi/2 - alpha_shadow(r_O)) * s^2',
      lookupMapping: {
        continuity: 'C1 at sSplit',
        qSplit: LOOKUP_SPLIT,
        sMin: SAMPLE_MIN,
        sSplit: SAMPLE_SPLIT,
        nearCritical: 'q = qSplit * log(s/sMin) / log(sSplit/sMin)',
        broadField: 'q = qSplit + (1-qSplit) * (s-sSplit) / (1-sSplit)',
      },
    },
    observerRadiusOverM: { min: R_MIN, max: R_MAX, axis: 'y', spacing: 'linear cell-centred' },
    channels: { r: 'total escaping azimuth Phi (radians)', g: 'escape mask (0 or 1)' },
    metric: 'Schwarzschild; geometric units G=c=M=1',
    criticalImpactParameterOverM: B_CRIT,
    integrator: `endpoint-regularized ${QUADRATURE_ORDER}-point Gauss-Legendre`,
    generator: 'tools/generate_blackhole_lut.mjs',
    validation,
  }, null, 2) + '\n');
  console.log(`Wrote ${OUT_BIN} (${values.byteLength} bytes, ${escaped} escaping samples)`);
  console.log(`Shadow at rO=30M: ${validation.shadowAngleDeg.toFixed(9)} deg`);
  console.log(`Max checked LUT interpolation error: ${validation.maxInterpolationAbsErrorRad.toExponential(3)} rad`);
}

// Shared quadrature machinery for sibling generators (the disk-trajectory
// tool). Exporting these does not change this generator's committed output.
export { legendreQuadrature, impactParameter, turningRadius, integralToTurning };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

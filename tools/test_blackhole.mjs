import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BLACK_HOLES, CONFIG } from '../js/data.js';
import {
  AU_PER_PARSEC,
  C_M_S,
  GM_SUN_NOMINAL,
  IAU_NOMINAL_SOLAR_MASS_PARAMETER,
  SPEED_OF_LIGHT_M_S,
  binaryOrbitState,
  binaryOrbitalPlaneNormal,
  circularOrbitAngularVelocity,
  criticalImpactParameterOverM,
  deriveBlackHoleSystem,
  deriveSemimajorAxisAU,
  diskEmitterGFactor,
  equatorialToSceneDirection,
  gravitationalBlueshiftFactor,
  icrsToSceneDirection,
  interstellarScenePosition,
  isPhotonCaptured,
  photonAzimuthalImpactParameter,
  receivedBolometricIntensityFactor,
  thinDiskTemperatureK,
  observerShadowAngularRadius,
  schwarzschildDerived,
  schwarzschildShadowAngularRadius,
  staticObserverTimeDilation,
  weakFieldDeflectionRadians,
} from '../js/blackhole-physics.js';
import {
  LUT_GRID,
  alphaFromSampleCoordinate,
  lookupCoordinateFromSampleCoordinate,
  lookupJoinContinuity,
  sampleCoordinateFromLookupCoordinate,
  sampleGeneratedLut,
  shadowAngularRadius as generatorShadowAngularRadius,
  traceEscapingRay,
  traceEscapingRayReference,
} from './generate_blackhole_lut.mjs';
import * as LutConstants from '../js/blackhole-lut-constants.js';
import {
  DISK_LUT_GRID,
  azimuthFromTurning,
  capturedAzimuth,
  computeDiskCrossings,
  familyCoordinateFromImpactParameter,
  familyImpactParameter,
  observerTexelValues,
  sampleObserver,
  sampleTrajectoryU,
  trajectoryRowValues,
} from './generate_blackhole_disk_lut.mjs';
import {
  impactParameter as generatorImpactParameter,
  turningRadius as generatorTurningRadius,
} from './generate_blackhole_lut.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LUT_BINARY_PATH = resolve(
  ROOT,
  'textures',
  'blackhole',
  'schwarzschild-lut-512x512-rg32f.bin',
);
const LUT_METADATA_PATH = resolve(
  ROOT,
  'textures',
  'blackhole',
  'schwarzschild-lut-512x512.json',
);
const SKY_EQUIRECTANGULAR_PATH = resolve(
  ROOT, 'textures', 'blackhole', 'gaia_sky_equirectangular.jpg',
);
const SKY_EQUIRECTANGULAR_METADATA_PATH = resolve(
  ROOT, 'textures', 'blackhole', 'gaia_sky_equirectangular.json',
);
const BLACK_HOLE_RENDERER_PATH = resolve(ROOT, 'js', 'blackhole.js');
const BLACK_HOLE_SHADERS_PATH = resolve(ROOT, 'js', 'blackhole-shaders.js');

let passed = 0;

function test(name, callback) {
  try {
    callback();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

function close(actual, expected, tolerance, message = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message || 'values differ'}: expected ${expected} +/- ${tolerance}, received ${actual}`,
  );
}

function vectorClose(actual, expected, tolerance, message = '') {
  assert.equal(actual.length, expected.length, `${message}: vector lengths differ`);
  for (let index = 0; index < actual.length; index++) {
    close(actual[index], expected[index], tolerance, `${message} component ${index}`);
  }
}

function relativeClose(actual, expected, relativeTolerance, message = '') {
  const scale = Math.max(Math.abs(actual), Math.abs(expected), Number.MIN_VALUE);
  assert.ok(
    Math.abs(actual - expected) <= relativeTolerance * scale,
    `${message || 'values differ'}: expected relative error <= ${relativeTolerance}, received ${Math.abs(actual - expected) / scale}`,
  );
}

function measurementObjects(root) {
  const found = [];
  const visited = new Set();
  function visit(value, path) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (value.provenance === 'measured') found.push([path, value]);
    for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
  }
  visit(root, '');
  return found;
}

console.log('\nGaia BH1 data and physics tests');

const gaiaBh1 = BLACK_HOLES.find(object => object.id === 'gaia-bh1');
const lutBinary = readFileSync(LUT_BINARY_PATH);
const lutValues = new Float32Array(
  lutBinary.buffer.slice(lutBinary.byteOffset, lutBinary.byteOffset + lutBinary.byteLength),
);
const lutMetadata = JSON.parse(readFileSync(LUT_METADATA_PATH, 'utf8'));
const skyEquirectangular = readFileSync(SKY_EQUIRECTANGULAR_PATH);
const skyMetadata = JSON.parse(readFileSync(SKY_EQUIRECTANGULAR_METADATA_PATH, 'utf8'));
const blackHoleRendererSource = readFileSync(BLACK_HOLE_RENDERER_PATH, 'utf8');
const blackHoleShaderSource = readFileSync(BLACK_HOLE_SHADERS_PATH, 'utf8');

function readFloat32(path) {
  const raw = readFileSync(path);
  return new Float32Array(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
  );
}
const DISK_DIR = resolve(ROOT, 'textures', 'blackhole');
const diskBuffers = {
  trajectory: readFloat32(resolve(DISK_DIR, 'schwarzschild-disk-trajectory-512x512-rg32f.bin')),
  family: readFloat32(resolve(DISK_DIR, 'schwarzschild-disk-families-512x1-rg32f.bin')),
  observer: readFloat32(resolve(DISK_DIR, 'schwarzschild-disk-observer-512x512-rg32f.bin')),
};
const diskMetadata = JSON.parse(
  readFileSync(resolve(DISK_DIR, 'schwarzschild-disk-lut.json'), 'utf8'),
);
// The disk feature must never change the main lensing table.
const MAIN_LUT_SHA256 = '2d8808ed1698edc9bae4259f9aa94c149ead4e6b91186b3b438814687f677135';

test('schema identifies exactly one Gaia BH1 black hole', () => {
  assert.equal(BLACK_HOLES.length, 1);
  assert.ok(gaiaBh1);
  assert.equal(gaiaBh1.kind, 'black-hole');
  assert.equal(gaiaBh1.sourceId, '4373465352415301632');
  assert.equal(typeof gaiaBh1.sourceId, 'string');
  assert.equal(gaiaBh1.spin, null);
  assert.equal(gaiaBh1.blackHole.spin, null);
  assert.equal(gaiaBh1.accretionEvidence, 'none_detected');
});

test('published measurements carry uncertainty, units and valid provenance', () => {
  const sourceIds = new Set(gaiaBh1.sources.map(source => source.id));
  const quantities = measurementObjects(gaiaBh1);
  assert.ok(quantities.length >= 14, 'expected all coordinate, mass, companion and orbit quantities');
  for (const [path, quantity] of quantities) {
    assert.ok(Number.isFinite(quantity.value), `${path} has a finite value`);
    assert.ok(quantity.uncertainty === null || Number.isFinite(quantity.uncertainty), `${path} uncertainty`);
    assert.equal(typeof quantity.unit, 'string', `${path} unit`);
    assert.ok(quantity.sourceIds.length > 0, `${path} cites at least one source`);
    for (const id of quantity.sourceIds) assert.ok(sourceIds.has(id), `${path} cites known source ${id}`);
  }
  for (const source of gaiaBh1.sources) {
    assert.match(source.url, /^https:\/\//);
    assert.ok(source.supports.length > 0);
  }
  assert.equal(gaiaBh1.modelAssumptions.schwarzschild.provenance, 'model-assumption');
  assert.equal(gaiaBh1.modelAssumptions.compactObjectMultiplicity.provenance, 'model-assumption');
  assert.equal(gaiaBh1.modelAssumptions.compactObjectMultiplicity.value, 'single');
  assert.ok(gaiaBh1.modelAssumptions.compactObjectMultiplicity.sourceIds.includes('nagarajan-2024'));
  assert.equal(gaiaBh1.modelAssumptions.locator.screenSpaceProxy, true);
  assert.equal(gaiaBh1.modelAssumptions.locator.markerToScale, false);
  assert.equal(gaiaBh1.modelAssumptions.locator.logicalDistanceToScale, true);
  assert.equal(gaiaBh1.modelAssumptions.locator.floatingOrigin, true);
});

test('runtime sky is a validated seamless equirectangular derivative', () => {
  assert.equal(skyMetadata.projection,
    'equirectangular, Galactic coordinates, longitude increases left');
  assert.deepEqual(skyMetadata.dimensions, { height: 2048, width: 4096 });
  assert.equal(skyMetadata.validation.pureBlackPixels, 0);
  assert.ok(skyMetadata.validation.meanSeamChannelDifference <= 2);
  assert.ok(skyMetadata.validation.maxSeamChannelDifference <= 8);
  assert.equal(
    createHash('sha256').update(skyEquirectangular).digest('hex').toUpperCase(),
    skyMetadata.validation.outputSha256,
  );
  assert.match(blackHoleRendererSource, /gaia_sky_equirectangular\.jpg/);
  assert.match(blackHoleRendererSource, /skyTexture\.wrapS = THREE\.RepeatWrapping/);
  assert.doesNotMatch(blackHoleRendererSource, /gaiaHammerUv|GAIA_CROP/);
});

test('runtime LUT constants are single-sourced and match the generator exactly', () => {
  assert.equal(LutConstants.LUT_WIDTH, LUT_GRID.width);
  assert.equal(LutConstants.LUT_HEIGHT, LUT_GRID.height);
  assert.equal(LutConstants.LUT_R_MIN, LUT_GRID.observerRadiusMin);
  assert.equal(LutConstants.LUT_R_MAX, LUT_GRID.observerRadiusMax);
  assert.equal(LutConstants.LUT_SAMPLE_MIN, LUT_GRID.sampleMin);
  assert.equal(LutConstants.LUT_SAMPLE_SPLIT, LUT_GRID.sampleSplit);
  assert.equal(LutConstants.LUT_SAMPLE_LOG_RANGE, LUT_GRID.sampleLogRange);
  assert.equal(LutConstants.LUT_LOOKUP_SPLIT, LUT_GRID.lookupSplit);
  assert.equal(LutConstants.CRITICAL_IMPACT_OVER_M, LUT_GRID.criticalImpactParameterOverM);
  // The GLSL receives its constants by interpolation from that module; a
  // hardcoded copy of the C1 join constant must not reappear anywhere.
  assert.match(blackHoleShaderSource, /Q_SPLIT = \$\{/);
  assert.doesNotMatch(blackHoleShaderSource, /0\.49538788727464/);
  assert.doesNotMatch(blackHoleRendererSource, /0\.49538788727464/);
  assert.match(blackHoleRendererSource, /from '\.\/blackhole-lut-constants\.js'/);
});

test('overview backdrop reuses the validated sky through one shared GLSL chunk', () => {
  // The camera-centred backdrop sphere must stay inside the overview far
  // plane, and both must be single-sourced constants.
  const backdropMatch = blackHoleRendererSource.match(/BACKDROP_RADIUS_AU = (\d+)/);
  const farMatch = blackHoleRendererSource.match(/OVERVIEW_FAR_AU = (\d+)/);
  assert.ok(backdropMatch, 'BACKDROP_RADIUS_AU constant exists');
  assert.ok(farMatch, 'OVERVIEW_FAR_AU constant exists');
  assert.equal(Number(backdropMatch[1]), 40);
  assert.equal(Number(farMatch[1]), 60);
  assert.ok(Number(backdropMatch[1]) < Number(farMatch[1]),
    'backdrop sphere must sit inside the overview far plane');
  // One definition and two interpolations (lensing + backdrop) of the shared
  // direction->UV chunk keep both views on the same sky mapping.
  const chunkUses = blackHoleShaderSource.match(/GAIA_SKY_DIRECTION_GLSL/g) || [];
  assert.ok(chunkUses.length >= 3,
    `expected the shared sky chunk defined and interpolated twice, found ${chunkUses.length} references`);
  assert.match(blackHoleShaderSource, /logdepthbuf_pars_fragment/);
  assert.match(blackHoleShaderSource, /tonemapping_fragment/);
  assert.match(blackHoleShaderSource, /colorspace_fragment/);
});

test('renderer sources keep the mipmapped HDR pipeline contracts', () => {
  assert.match(blackHoleRendererSource, /LinearMipmapLinearFilter/);
  assert.match(blackHoleRendererSource, /anisotropy/);
  assert.match(blackHoleRendererSource, /HalfFloatType/);
  assert.match(blackHoleRendererSource, /EXT_color_buffer_float/);
  assert.match(blackHoleShaderSource, /textureGrad/);
  // The stable near-critical formulation must not regress to the
  // cancellation-prone acos path.
  assert.doesNotMatch(blackHoleShaderSource, /float alpha = acos/);
  assert.match(blackHoleShaderSource, /sinAlpha \* uCosShadow - cosAlpha \* uSinShadow/);
});

test('stable sin(alpha - shadow) beats the acos difference in emulated float32', () => {
  const f = Math.fround;
  let maxStable = 0;
  let maxNaive = 0;
  for (const radius of [6.1, 30, 99]) {
    const sinShadow = Math.min(1,
      LUT_GRID.criticalImpactParameterOverM * Math.sqrt(1 - 2 / radius) / radius);
    const shadow = Math.asin(sinShadow);
    const cosShadow = Math.sqrt(1 - sinShadow * sinShadow);
    for (let step = 0; step <= 40; step++) {
      const delta = 1e-7 * 10 ** (step / 10); // 1e-7 .. 1e-3 rad
      const alpha = shadow + delta;
      // Both formulations receive float32-rounded sin/cos of alpha, as the
      // shader derives them from the fragment's tangent-plane coordinates.
      const sinA = f(Math.sin(alpha));
      const cosA = f(Math.cos(alpha));
      // Stable path (shader): fp32 products of well-conditioned factors, with
      // the shadow terms precomputed in float64 and rounded once.
      const deltaSin = f(f(sinA * f(cosShadow)) - f(cosA * f(sinShadow)));
      const stable = Math.abs(Math.asin(Math.min(1, Math.max(0, deltaSin))) - delta);
      // Former path: acos of the rounded cosine minus the rounded angle.
      const naive = Math.abs(f(f(Math.acos(cosA)) - f(shadow)) - delta);
      maxStable = Math.max(maxStable, stable);
      maxNaive = Math.max(maxNaive, naive);
    }
  }
  assert.ok(maxStable <= 3e-7,
    `stable formulation error ${maxStable} exceeds 3e-7 rad`);
  assert.ok(maxNaive >= 3 * maxStable,
    `expected >= 3x improvement, received ${maxNaive / maxStable}x (naive ${maxNaive}, stable ${maxStable})`);
});

test('disk emitter g-factor matches Schwarzschild circular-orbit kinematics', () => {
  close(circularOrbitAngularVelocity(6), 0.06804138174397717, 1e-16, 'ISCO angular velocity');
  close(diskEmitterGFactor(6, 1e12, 0), Math.SQRT1_2, 1e-9,
    'face-on ISCO emission to a distant observer redshifts by sqrt(1/2)');
  relativeClose(diskEmitterGFactor(6, 30, 0), Math.SQRT1_2 / Math.sqrt(1 - 2 / 30), 1e-14,
    'a static observer at 30M receives the same emission blueshifted');
  close(diskEmitterGFactor(6, 30, 0), 0.7319250547113999, 1e-13, 'pinned value');
  const rEmit = 10;
  const rObserver = 30;
  const lambda = 3;
  const omega = circularOrbitAngularVelocity(rEmit);
  relativeClose(
    diskEmitterGFactor(rEmit, rObserver, lambda) * diskEmitterGFactor(rEmit, rObserver, -lambda),
    (1 - 3 / rEmit) / ((1 - 2 / rObserver) * (1 - (omega * lambda) ** 2)),
    1e-13,
    'g(lambda) * g(-lambda) identity',
  );
  assert.ok(
    diskEmitterGFactor(rEmit, rObserver, lambda) > diskEmitterGFactor(rEmit, rObserver, -lambda),
    'the approaching side (positive lambda) is blueshifted relative to the receding side',
  );
  // The single sign convention: physical-photon L_z opposes the backward
  // ray's plane normal.
  assert.equal(photonAzimuthalImpactParameter(5, 0.5), -2.5);
  close(diskEmitterGFactor(1e8, 1e8, 0), 1, 1e-7, 'far-field limit');
  assert.throws(() => circularOrbitAngularVelocity(5.9), RangeError);
  assert.throws(() => diskEmitterGFactor(6, 30, 1 / circularOrbitAngularVelocity(6)), RangeError);
  assert.throws(() => photonAzimuthalImpactParameter(-1, 0), RangeError);
});

test('thin-disk temperature profile peaks at 49/36 of the inner edge', () => {
  assert.equal(thinDiskTemperatureK(6, 8000), 0, 'zero-torque inner edge');
  close(thinDiskTemperatureK(49 / 6, 8000), 8000, 1e-9, 'peak value at r = 49/6');
  relativeClose(thinDiskTemperatureK(12, 8000) / 8000, 0.8966016358667303, 1e-12,
    'pinned mid-disk ratio');
  for (let radius = 6.01; radius < 40; radius += 0.13) {
    assert.ok(thinDiskTemperatureK(radius, 8000) <= 8000 + 1e-9,
      `no radius may exceed the normalized peak (r = ${radius})`);
  }
  assert.throws(() => thinDiskTemperatureK(5, 8000), RangeError);
});

test('binary orbital-plane normal is unit, perpendicular and prograde', () => {
  const normal = binaryOrbitalPlaneNormal(gaiaBh1);
  close(Math.hypot(normal[0], normal[1], normal[2]), 1, 1e-12, 'unit length');
  const periastron = gaiaBh1.orbit.periastronJulianDate.value;
  const period = gaiaBh1.orbit.periodDays.value;
  for (const fraction of [0, 0.13, 0.31, 0.5, 0.77, 0.92]) {
    const state = binaryOrbitState(gaiaBh1, periastron + fraction * period);
    const dot = normal[0] * state.relative[0]
      + normal[1] * state.relative[1]
      + normal[2] * state.relative[2];
    assert.ok(Math.abs(dot) < 1e-10 * state.separationAU,
      `normal is perpendicular to the orbit at phase ${fraction}`);
  }
  // Prograde orientation: the normal must align with the numerical r x v of
  // the actual time-parameterized motion.
  const before = binaryOrbitState(gaiaBh1, periastron + 10);
  const after = binaryOrbitState(gaiaBh1, periastron + 10.001);
  const velocity = [
    after.relative[0] - before.relative[0],
    after.relative[1] - before.relative[1],
    after.relative[2] - before.relative[2],
  ];
  const angularMomentum = [
    before.relative[1] * velocity[2] - before.relative[2] * velocity[1],
    before.relative[2] * velocity[0] - before.relative[0] * velocity[2],
    before.relative[0] * velocity[1] - before.relative[1] * velocity[0],
  ];
  const length = Math.hypot(angularMomentum[0], angularMomentum[1], angularMomentum[2]);
  const alignment = (normal[0] * angularMomentum[0]
    + normal[1] * angularMomentum[1]
    + normal[2] * angularMomentum[2]) / length;
  assert.ok(alignment > 0.999,
    `plane normal must be prograde with the binary motion, alignment ${alignment}`);
});

test('disk tables satisfy the grid contract and analytic invariants', () => {
  const grid = DISK_LUT_GRID;
  assert.equal(diskBuffers.trajectory.byteLength,
    grid.trajectoryWidth * grid.trajectoryHeight * 2 * 4);
  assert.equal(diskBuffers.family.byteLength, grid.familyWidth * 2 * 4);
  assert.equal(diskBuffers.observer.byteLength,
    grid.observerWidth * grid.observerHeight * 2 * 4);
  assert.deepEqual(diskMetadata.grid, { ...grid });
  assert.equal(diskMetadata.validation.nonFiniteScalars, 0);
  assert.equal(diskMetadata.validation.trajectoryMonotoneViolations, 0);
  assert.equal(diskMetadata.validation.trajectoryNegativeSlopes, 0);
  assert.ok(diskMetadata.validation.maxEscapingInverseRadiusAbsError <= 5e-5);
  assert.ok(diskMetadata.validation.maxCapturedInverseRadiusAbsError <= 5e-4);
  assert.ok(diskMetadata.validation.maxObserverPhiEndAbsErrorVsReference <= 1e-8);
  for (const array of Object.values(diskBuffers)) {
    for (let index = 0; index < array.length; index++) {
      assert.ok(Number.isFinite(array[index]), `scalar ${index} is finite`);
    }
  }
  // u rises monotonically along every trajectory row; slopes are stored
  // non-negative; family b is strictly increasing across rows.
  for (let row = 0; row < grid.trajectoryHeight; row++) {
    for (let i = 0; i < grid.trajectoryWidth; i++) {
      const offset = 2 * (row * grid.trajectoryWidth + i);
      assert.ok(diskBuffers.trajectory[offset + 1] >= 0);
      if (i > 0) {
        assert.ok(diskBuffers.trajectory[offset] >= diskBuffers.trajectory[offset - 2],
          `row ${row} column ${i} keeps u monotone`);
      }
    }
    if (row > 0 && row !== grid.trajectoryHeight / 2) {
      // Non-strict: near the critical curve adjacent family steps fall below
      // one float32 ulp of b_crit and legitimately round to equal values.
      assert.ok(diskBuffers.family[2 * row + 1] >= diskBuffers.family[2 * (row - 1) + 1],
        `family impact parameter grows with the row (row ${row})`);
    }
    assert.ok(diskBuffers.family[2 * row] > 0, `phiDom positive (row ${row})`);
  }
  // G is the analytic du/dphi away from the flat turning-point tail.
  for (const row of [10, 130, 300, 470]) {
    const b = diskBuffers.family[2 * row + 1];
    for (const column of [5, 128, 300, 450]) {
      const offset = 2 * (row * grid.trajectoryWidth + column);
      const u = diskBuffers.trajectory[offset];
      const slope = Math.sqrt(Math.max(0, 1 / (b * b) - u * u + 2 * u ** 3));
      close(diskBuffers.trajectory[offset + 1], slope, 1e-4,
        `du/dphi at row ${row} column ${column}`);
    }
  }
  assert.equal(
    createHash('sha256').update(lutBinary).digest('hex'),
    MAIN_LUT_SHA256,
    'the committed main lensing LUT is untouched by the disk feature',
  );
});

test('selected disk texels reproduce the generator bit for bit', () => {
  for (const row of [0, 200, 255, 256, 257, 511]) {
    const recomputed = trajectoryRowValues(row);
    assert.equal(diskBuffers.family[2 * row], Math.fround(recomputed.phiDom),
      `family phiDom row ${row}`);
    assert.equal(diskBuffers.family[2 * row + 1], Math.fround(recomputed.b),
      `family b row ${row}`);
    for (const column of [0, 100, 300, 511]) {
      const offset = 2 * (row * DISK_LUT_GRID.trajectoryWidth + column);
      assert.equal(diskBuffers.trajectory[offset],
        Math.fround(recomputed.uValues[column]), `u row ${row} column ${column}`);
      assert.equal(diskBuffers.trajectory[offset + 1],
        Math.fround(recomputed.gValues[column]), `g row ${row} column ${column}`);
    }
  }
  for (const [x, y] of [[0, 0], [255, 130], [256, 130], [400, 300], [511, 511]]) {
    const texel = observerTexelValues(x, y);
    const offset = 2 * (y * DISK_LUT_GRID.observerWidth + x);
    assert.equal(diskBuffers.observer[offset], Math.fround(texel.phiObserver),
      `phi_O texel ${x},${y}`);
    assert.equal(diskBuffers.observer[offset + 1], Math.fround(texel.phiEndRemaining),
      `dphiEnd texel ${x},${y}`);
  }
});

test('disk-plane crossings agree with dense independent integration', () => {
  const observerRadius = 30;
  const shadow = observerShadowAngularRadius(observerRadius);
  const configurations = [
    { alpha: shadow * 0.55, e1DotZ: 0.42, e2DotZ: -0.55 }, // captured, front-of-shadow
    { alpha: shadow * 0.92, e1DotZ: 0.2, e2DotZ: 0.75 },   // captured, near-critical
    { alpha: shadow + 0.002, e1DotZ: 0.31, e2DotZ: 0.6 },  // escaping, deep whirl
    { alpha: shadow + 0.03, e1DotZ: 0.42, e2DotZ: -0.55 }, // escaping, whirl region
    { alpha: 0.42, e1DotZ: 0.31, e2DotZ: 0.6 },            // broad field
  ];
  let totalCrossings = 0;
  for (const { alpha, e1DotZ, e2DotZ } of configurations) {
    const b = generatorImpactParameter(alpha, observerRadius);
    const crossings = computeDiskCrossings(
      diskBuffers, alpha, observerRadius, e1DotZ, e2DotZ,
      { outerRadius: 30 },
    );
    totalCrossings += crossings.length;
    for (const crossing of crossings) {
      // Independent reference for the master azimuth and inverse radius.
      let phiObserverReference;
      let uReference;
      const GL_REF = { order: 384 };
      if (b < DISK_LUT_GRID.criticalImpactParameterOverM) {
        phiObserverReference = capturedAzimuth(b, 0, 1 / observerRadius);
        const target = phiObserverReference + crossing.phi;
        let lo = 0;
        let hi = DISK_LUT_GRID.capturedEndInverseRadius;
        for (let i = 0; i < 60; i++) {
          const mid = (lo + hi) * 0.5;
          if (capturedAzimuth(b, 0, mid) < target) lo = mid;
          else hi = mid;
        }
        uReference = (lo + hi) * 0.5;
      } else {
        const uTurning = 1 / generatorTurningRadius(b, observerRadius);
        const sMax = Math.sqrt(uTurning);
        const phiTurn = azimuthFromTurning(b, uTurning, sMax);
        const nearSide = azimuthFromTurning(b, uTurning,
          Math.sqrt(Math.max(0, uTurning - 1 / observerRadius)));
        phiObserverReference = phiTurn - nearSide;
        let target = phiObserverReference + crossing.phi;
        if (target > phiTurn) target = 2 * phiTurn - target; // mirror
        const psiTarget = phiTurn - target;
        let lo = 0;
        let hi = sMax;
        for (let i = 0; i < 60; i++) {
          const mid = (lo + hi) * 0.5;
          if (azimuthFromTurning(b, uTurning, mid) < psiTarget) lo = mid;
          else hi = mid;
        }
        uReference = uTurning - ((lo + hi) * 0.5) ** 2;
      }
      const radiusReference = 1 / uReference;
      close(crossing.radius, radiusReference, 0.02,
        `crossing order ${crossing.order} radius (alpha ${alpha.toFixed(4)})`);
      assert.ok(crossing.radius > 2 || !crossing.hit,
        'no disk hit can lie inside the horizon');
      void GL_REF;
    }
  }
  assert.ok(totalCrossings >= 7,
    `the configuration set must exercise several crossings, found ${totalCrossings}`);
});

test('disk observer table is consistent with the main lensing LUT', () => {
  for (const observerRadius of [12.3, 30, 71.5]) {
    for (const s of [0.01, 0.05, 0.2, 0.55, 0.9]) {
      const alpha = alphaFromSampleCoordinate(s, observerRadius);
      const mainPhi = sampleGeneratedLut(lutValues, s, observerRadius);
      const observed = sampleObserver(diskBuffers, alpha, observerRadius);
      close(observed.phiEndRemaining, mainPhi, 2e-3,
        `dphiEnd matches the main table at s=${s}, rO=${observerRadius}`);
      assert.ok(observed.phiObserver > 0
        && observed.phiObserver < observed.phiEndRemaining,
        'the observer sits strictly between the asymptote and the ray end');
    }
  }
  // Family maps invert exactly across both halves.
  for (const w of [0.03, 0.21, 0.499, 0.5, 0.62, 0.97]) {
    const b = familyImpactParameter(w);
    close(familyCoordinateFromImpactParameter(b), w, 1e-9, `family round-trip w=${w}`);
  }
});

test('illustrative disk stays opt-in, labeled and single-sourced', () => {
  // Runtime wiring: persisted opt-in key, compile-time variant, caveat text.
  assert.match(blackHoleRendererSource, /solar\.bhDisk/);
  assert.match(blackHoleRendererSource, /bhDiskCaveat/);
  assert.match(blackHoleRendererSource, /bhDiskUnavailableFallback/);
  assert.match(blackHoleShaderSource, /BH_DISK/);
  assert.match(blackHoleShaderSource, /photonAzimuthalImpactParameter/);
  // Disk constants agree across the data schema, the generator grid and the
  // shader module's exports.
  const assumption = gaiaBh1.modelAssumptions.illustrativeAccretionDisk;
  assert.equal(assumption.provenance, 'model-assumption');
  assert.equal(assumption.optIn, true);
  assert.equal(assumption.defaultEnabled, false);
  assert.equal(assumption.innerRadiusOverM, DISK_LUT_GRID.diskInnerRadiusOverM);
  assert.equal(assumption.outerRadiusOverM, 30);
  assert.equal(assumption.peakTemperatureK, 8000);
  assert.match(blackHoleShaderSource, /DISK_PEAK_TEMPERATURE_K = 8000/);
  assert.match(blackHoleRendererSource, /uDiskOuterR: \{ value: 30 \}/);
});

test('static-observer reception factors are reciprocal and quartic', () => {
  const blueshift30 = gravitationalBlueshiftFactor(30);
  assert.equal(blueshift30, 1 / staticObserverTimeDilation(30));
  relativeClose(receivedBolometricIntensityFactor(30), blueshift30 ** 4, 1e-15,
    'intensity gain is the fourth power of the blueshift');
  close(gravitationalBlueshiftFactor(1e9), 1, 2e-9, 'far-field limit');
  assert.throws(() => gravitationalBlueshiftFactor(2), RangeError);
  assert.throws(() => receivedBolometricIntensityFactor(1.5), RangeError);
});

test('nominal SI constants and aliases are exact', () => {
  assert.equal(IAU_NOMINAL_SOLAR_MASS_PARAMETER, 1.3271244e20);
  assert.equal(GM_SUN_NOMINAL, IAU_NOMINAL_SOLAR_MASS_PARAMETER);
  assert.equal(SPEED_OF_LIGHT_M_S, 299792458);
  assert.equal(C_M_S, SPEED_OF_LIGHT_M_S);
});

test('one-solar-mass Schwarzschild radius is about 2.95325 km', () => {
  const derived = schwarzschildDerived(1);
  close(derived.schwarzschildRadiusKm, 2.95325, 0.00001);
  close(derived.eventHorizonRadiusKm, derived.schwarzschildRadiusKm, 1e-15);
  close(derived.photonSphereRadiusKm, 1.5 * derived.schwarzschildRadiusKm, 1e-12);
  close(
    derived.criticalImpactParameterKm,
    3 * Math.sqrt(3) * derived.gravitationalRadiusKm,
    1e-12,
  );
});

test('Gaia BH1 radii are derived from mass rather than stored display numbers', () => {
  const gr = schwarzschildDerived(gaiaBh1.blackHole.massSolar);
  close(gr.eventHorizonRadiusKm, 27.37663, 0.00002);
  close(gr.photonSphereRadiusKm, 41.06494, 0.00002);
  close(gr.shadowDiameterKm, 142.25313, 0.00003);
  assert.equal(gr.provenance, 'derived');
});

test('ICRS conversion follows the repository scene convention and stays normalized', () => {
  const equinox = equatorialToSceneDirection(0, 0);
  close(equinox.x, 1, 1e-15);
  close(equinox.y, 0, 1e-15);
  close(equinox.z, 0, 1e-15);

  const northPole = equatorialToSceneDirection(0, 90);
  const obliquity = 23.4392911 * Math.PI / 180;
  close(northPole.x, 0, 1e-15);
  close(northPole.y, Math.cos(obliquity), 1e-15);
  close(northPole.z, -Math.sin(obliquity), 1e-15);

  const direction = equatorialToSceneDirection(
    gaiaBh1.coordinates.raDeg,
    gaiaBh1.coordinates.decDeg,
  );
  close(Math.hypot(direction.x, direction.y, direction.z), 1, 2e-15);
  assert.deepEqual(icrsToSceneDirection(0, 0), equinox);
});

test('interstellar anchor preserves Gaia direction and true AU distance with a floating origin', () => {
  const anchor = interstellarScenePosition(gaiaBh1, CONFIG.DIST_REAL_K);
  const expectedDirection = equatorialToSceneDirection(
    gaiaBh1.coordinates.raDeg,
    gaiaBh1.coordinates.decDeg,
  );
  const expectedDistancePc = 1000 / gaiaBh1.coordinates.parallaxMas.value;
  const expectedDistanceUncertaintyPc = 1000 * gaiaBh1.coordinates.parallaxMas.uncertainty
    / gaiaBh1.coordinates.parallaxMas.value ** 2;
  const expectedDistanceAU = expectedDistancePc * AU_PER_PARSEC;
  close(anchor.distancePc, expectedDistancePc, 1e-12);
  close(anchor.distanceUncertaintyPc, expectedDistanceUncertaintyPc, 1e-12);
  relativeClose(anchor.distanceAU, expectedDistanceAU, 2e-16);
  relativeClose(
    anchor.distanceSceneUnits,
    expectedDistanceAU * CONFIG.DIST_REAL_K,
    2e-16,
  );
  relativeClose(Math.hypot(...anchor.positionScene), anchor.distanceSceneUnits, 3e-16);
  vectorClose(
    anchor.positionScene.map(component => component / anchor.distanceSceneUnits),
    [expectedDirection.x, expectedDirection.y, expectedDirection.z],
    2e-16,
    'normalized floating-origin anchor',
  );
  assert.equal(anchor.renderingRequirement, 'floating-origin');
  assert.equal(anchor.provenance, 'derived');
});

const massBh = gaiaBh1.blackHole.massSolar.value;
const massStar = gaiaBh1.companion.massSolar.value;
const period = gaiaBh1.orbit.periodDays.value;
const eccentricity = gaiaBh1.orbit.eccentricity.value;
const periastronJd = gaiaBh1.orbit.periastronJulianDate.value;

test('Kepler derivation gives the measured system scale, periapsis and apoapsis', () => {
  const semimajorAxis = deriveSemimajorAxisAU(massBh, massStar, period);
  close(semimajorAxis, 1.37992, 0.00002);
  const derived = deriveBlackHoleSystem(gaiaBh1);
  assert.equal(derived.provenance, 'derived');
  close(derived.semimajorAxisAU, semimajorAxis, 1e-14);
  close(derived.periapsisAU, semimajorAxis * (1 - eccentricity), 1e-14);
  close(derived.apoapsisAU, semimajorAxis * (1 + eccentricity), 1e-14);
  close(derived.periapsisAU, 0.78338, 0.00002);
  close(derived.apoapsisAU, 1.97646, 0.00002);
  close(derived.distancePc, 1000 / 2.09, 1e-12);
  close(derived.shadowAngularDiameterNanoarcsec, 1.98739, 0.00001);
});

test('binary positions preserve the barycentre', () => {
  const state = binaryOrbitState(gaiaBh1, periastronJd + 37.25);
  const weighted = state.blackHole.map((component, index) => (
    massBh * component + massStar * state.star[index]
  ));
  vectorClose(weighted, [0, 0, 0], 2e-15, 'mass-weighted barycentre');
  const relative = state.star.map((component, index) => component - state.blackHole[index]);
  vectorClose(relative, state.relative, 2e-15, 'star minus black-hole position');
  close(Math.hypot(...state.relative), state.separationAU, 3e-15);
});

test('binary state is periodic and reaches the expected apsides', () => {
  const peri = binaryOrbitState(gaiaBh1, periastronJd);
  const nextPeri = binaryOrbitState(gaiaBh1, periastronJd + period);
  const apo = binaryOrbitState(gaiaBh1, periastronJd + period / 2);
  vectorClose(peri.relative, nextPeri.relative, 2e-10, 'one-period state');
  close(peri.separationAU, peri.semimajorAxisAU * (1 - eccentricity), 1e-13);
  close(apo.separationAU, apo.semimajorAxisAU * (1 + eccentricity), 1e-13);
});

test('static observer factors and exact rO=30M shadow angle match Schwarzschild geometry', () => {
  close(staticObserverTimeDilation(30), Math.sqrt(1 - 2 / 30), 1e-15);
  const angle = schwarzschildShadowAngularRadius(30);
  close(angle * 180 / Math.PI, 9.63273228269725, 1e-12);
  close(observerShadowAngularRadius(30), angle, 0);
  close(schwarzschildShadowAngularRadius(3), Math.PI / 2, 1e-15);
  assert.ok(schwarzschildShadowAngularRadius(2.1) > Math.PI / 2);
});

test('capture threshold and weak-field helper preserve analytic invariants', () => {
  const critical = 3 * Math.sqrt(3);
  close(criticalImpactParameterOverM(), critical, 1e-15);
  assert.equal(isPhotonCaptured(critical - 1e-9), true);
  assert.equal(isPhotonCaptured(critical + 1e-9), false);
  assert.equal(isPhotonCaptured(critical), false, 'critical ray asymptotes to the photon sphere');
  close(weakFieldDeflectionRadians(1e6), 4e-6, 1e-20);
  assert.ok(weakFieldDeflectionRadians(1e8) < weakFieldDeflectionRadians(1e6));
});

test('piecewise near-critical lookup coordinate is analytically and numerically C1', () => {
  const continuity = lookupJoinContinuity();
  assert.equal(continuity.continuityClass, 'C1');
  close(continuity.lookupCoordinate, LUT_GRID.lookupSplit, 0);
  close(continuity.sampleCoordinate, LUT_GRID.sampleSplit, 0);
  close(continuity.sampleValueAbsError, 0, 2e-16);
  relativeClose(continuity.dsDqNear, continuity.dsDqBroad, 2e-15);
  relativeClose(continuity.dqDsNear, continuity.dqDsBroad, 2e-15);

  const q = LUT_GRID.lookupSplit;
  const h = 1e-7;
  const atJoin = sampleCoordinateFromLookupCoordinate(q);
  const leftDerivative = (atJoin - sampleCoordinateFromLookupCoordinate(q - h)) / h;
  const rightDerivative = (sampleCoordinateFromLookupCoordinate(q + h) - atJoin) / h;
  relativeClose(leftDerivative, continuity.dsDqNear, 2e-6, 'left numerical ds/dq');
  relativeClose(rightDerivative, continuity.dsDqBroad, 2e-6, 'right numerical ds/dq');
  relativeClose(leftDerivative, rightDerivative, 2e-6, 'C1 numerical join');

  for (const sample of [
    LUT_GRID.sampleMin,
    2e-6,
    1e-4,
    0.02,
    LUT_GRID.sampleSplit,
    0.081,
    0.5,
    1,
  ]) {
    const roundTrip = sampleCoordinateFromLookupCoordinate(
      lookupCoordinateFromSampleCoordinate(sample),
    );
    close(roundTrip, sample, 4e-16, `q(s) inverse at s=${sample}`);
  }
});

test('committed RG32F file and metadata exactly implement the centre-sampled grid contract', () => {
  const expectedByteLength = LUT_GRID.width * LUT_GRID.height
    * LUT_GRID.channels * LUT_GRID.bytesPerChannel;
  assert.equal(lutBinary.byteLength, expectedByteLength);
  assert.equal(lutValues.length, LUT_GRID.width * LUT_GRID.height * LUT_GRID.channels);
  assert.equal(lutMetadata.width, LUT_GRID.width);
  assert.equal(lutMetadata.height, LUT_GRID.height);
  assert.equal(lutMetadata.format, 'RG32F little-endian, tightly packed, row-major');
  assert.equal(lutMetadata.raySampleCoordinate.texels, 'cell-centred');
  assert.equal(lutMetadata.raySampleCoordinate.lookupMapping.continuity, 'C1 at sSplit');
  close(lutMetadata.raySampleCoordinate.lookupMapping.qSplit, LUT_GRID.lookupSplit, 0);
  close(lutMetadata.raySampleCoordinate.lookupMapping.sMin, LUT_GRID.sampleMin, 0);
  close(lutMetadata.raySampleCoordinate.lookupMapping.sSplit, LUT_GRID.sampleSplit, 0);
  close(lutMetadata.observerRadiusOverM.min, LUT_GRID.observerRadiusMin, 0);
  close(lutMetadata.observerRadiusOverM.max, LUT_GRID.observerRadiusMax, 0);
  assert.equal(lutMetadata.validation.grid.byteLength, expectedByteLength);
  assert.equal(lutMetadata.validation.grid.scalarCount, lutValues.length);
  assert.equal(lutMetadata.validation.grid.escapingTexels, LUT_GRID.width * LUT_GRID.height);
  assert.equal(lutMetadata.validation.grid.nonFiniteScalars, 0);
  assert.equal(lutMetadata.validation.grid.invalidEscapeMasks, 0);
  relativeClose(
    lutMetadata.validation.lookupJoin.dsDqNear,
    lutMetadata.validation.lookupJoin.dsDqBroad,
    2e-15,
  );

  let minPhi = Infinity;
  let maxPhi = -Infinity;
  for (let offset = 0; offset < lutValues.length; offset += 2) {
    const phi = lutValues[offset];
    const escapeMask = lutValues[offset + 1];
    assert.ok(Number.isFinite(phi) && phi > 0, `finite positive Phi at texel ${offset / 2}`);
    assert.equal(escapeMask, 1, `escape mask at texel ${offset / 2}`);
    minPhi = Math.min(minPhi, phi);
    maxPhi = Math.max(maxPhi, phi);
  }
  close(lutMetadata.validation.grid.phiRangeRad.min, minPhi, 0);
  close(lutMetadata.validation.grid.phiRangeRad.max, maxPhi, 0);
});

test('selected LUT texel centres reproduce the direct null-geodesic solver bit for bit', () => {
  const rowNear30 = Math.round(
    (30 - LUT_GRID.observerRadiusMin)
      / (LUT_GRID.observerRadiusMax - LUT_GRID.observerRadiusMin)
      * LUT_GRID.height - 0.5,
  );
  const columnAtJoin = Math.round(LUT_GRID.lookupSplit * LUT_GRID.width - 0.5);
  const coordinates = [
    [0, 0],
    [7, rowNear30],
    [columnAtJoin - 1, rowNear30],
    [columnAtJoin, rowNear30],
    [columnAtJoin + 1, rowNear30],
    [LUT_GRID.width - 1, rowNear30],
    [LUT_GRID.width - 1, LUT_GRID.height - 1],
  ];

  for (const [x, y] of coordinates) {
    const q = (x + 0.5) / LUT_GRID.width;
    const s = sampleCoordinateFromLookupCoordinate(q);
    const observerRadius = LUT_GRID.observerRadiusMin
      + (LUT_GRID.observerRadiusMax - LUT_GRID.observerRadiusMin)
        * (y + 0.5) / LUT_GRID.height;
    const alpha = alphaFromSampleCoordinate(s, observerRadius);
    const direct = traceEscapingRay(alpha, observerRadius);
    assert.equal(direct.escaped, true);
    const offset = 2 * (y * LUT_GRID.width + x);
    assert.equal(lutValues[offset], Math.fround(direct.phi), `Phi at texel (${x}, ${y})`);
    assert.equal(lutValues[offset + 1], 1, `escape mask at texel (${x}, ${y})`);
  }
});

test('direct solver and bilinear LUT agree around the visible critical curve and C1 join', () => {
  const observerRadius = 30;
  const shadow = generatorShadowAngularRadius(observerRadius);
  assert.equal(traceEscapingRay(shadow, observerRadius).escaped, false);
  assert.equal(traceEscapingRay(shadow - 1e-12, observerRadius).escaped, false);

  let previousPhi = Infinity;
  for (const sample of [1e-5, 1e-4, 1e-3, 0.005, 0.01, 0.02, 0.04]) {
    const alpha = alphaFromSampleCoordinate(sample, observerRadius);
    const direct = traceEscapingRay(alpha, observerRadius);
    assert.equal(direct.escaped, true, `ray escapes for s=${sample}`);
    assert.ok(direct.phi < previousPhi, `Phi decreases away from critical curve at s=${sample}`);
    previousPhi = direct.phi;
  }

  // One vertical pixel outside the shadow at 55 degrees / 1080 px is within
  // this range. It is the part of the critical curve that can actually be seen,
  // rather than the mathematical logarithmic divergence at a sub-pixel delta.
  const onePixelAlpha = 55 * Math.PI / 180 / 1080;
  const onePixelSample = Math.sqrt(
    onePixelAlpha / (Math.PI / 2 - shadow),
  );
  assert.ok(onePixelSample > 0.02 && onePixelSample < 0.03);

  for (const sample of [0.005, 0.01, 0.02, onePixelSample, 0.04]) {
    const alpha = alphaFromSampleCoordinate(sample, observerRadius);
    const reference = traceEscapingRayReference(alpha, observerRadius);
    const lookup = sampleGeneratedLut(lutValues, sample, observerRadius);
    assert.equal(reference.escaped, true);
    assert.ok(
      Math.abs(lookup - reference.phi) <= 5e-5,
      `visible critical-curve LUT error at s=${sample}`,
    );
  }

  for (const sample of [0.079, 0.08, 0.081]) {
    const alpha = alphaFromSampleCoordinate(sample, observerRadius);
    const reference = traceEscapingRayReference(alpha, observerRadius).phi;
    const lookup = sampleGeneratedLut(lutValues, sample, observerRadius);
    assert.ok(Math.abs(lookup - reference) <= 5e-4, `join LUT error at s=${sample}`);
  }
});

test('direct geodesics approach 4M/b and the identity ray map as M/b tends to zero', () => {
  let previousDeflection = Infinity;
  let previousIdentityError = Infinity;
  for (const impactParameterOverM of [1_000, 2_000, 5_000, 10_000, 100_000]) {
    // Holding the physical impact parameter fixed while increasing b/M is the
    // same dimensionless limit as M -> 0. A very distant finite observer makes
    // the omitted incoming tail negligible relative to the tested 4M/b term.
    const observerRadius = impactParameterOverM * 100_000;
    const alpha = Math.asin(
      impactParameterOverM * Math.sqrt(1 - 2 / observerRadius) / observerRadius,
    );
    const result = traceEscapingRay(alpha, observerRadius);
    assert.equal(result.escaped, true);
    const deflection = result.phi + alpha - Math.PI;
    const weakField = 4 / impactParameterOverM;
    assert.ok(deflection > 0);
    assert.ok(
      Math.abs(deflection / weakField - 1) < 0.0031,
      `weak-field limit at b/M=${impactParameterOverM}`,
    );

    const ray = [-Math.cos(alpha), Math.sin(alpha)];
    const mappedSource = [Math.cos(result.phi), Math.sin(result.phi)];
    const identityError = Math.hypot(
      mappedSource[0] - ray[0],
      mappedSource[1] - ray[1],
    );
    assert.ok(deflection < previousDeflection);
    assert.ok(identityError < previousIdentityError);
    previousDeflection = deflection;
    previousIdentityError = identityError;
  }
  assert.ok(previousIdentityError < 4.1e-5, 'M -> 0 ray map tends to identity');
});

test('invalid physical domains fail explicitly', () => {
  assert.throws(() => schwarzschildDerived(0), RangeError);
  assert.throws(() => equatorialToSceneDirection(0, 91), RangeError);
  assert.throws(() => staticObserverTimeDilation(2), RangeError);
  assert.throws(() => schwarzschildShadowAngularRadius(1.9), RangeError);
  assert.throws(() => isPhotonCaptured(-1), RangeError);
});

console.log(`\n  ${passed} passed, 0 failed\n`);

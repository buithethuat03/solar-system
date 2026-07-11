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
  criticalImpactParameterOverM,
  deriveBlackHoleSystem,
  deriveSemimajorAxisAU,
  equatorialToSceneDirection,
  icrsToSceneDirection,
  interstellarScenePosition,
  isPhotonCaptured,
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

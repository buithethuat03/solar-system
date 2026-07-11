// Pure numerical helpers for Gaia BH1 and other detached black-hole binaries.
// This module deliberately imports neither three.js nor browser globals so it
// can be validated directly with Node and reused by offline asset generators.

export const SPEED_OF_LIGHT_M_S = 299792458;          // exact, SI
export const IAU_NOMINAL_SOLAR_MASS_PARAMETER = 1.3271244e20; // m^3 s^-2
export const METRES_PER_AU = 149597870700;             // exact, IAU 2012
export const METRES_PER_PARSEC = METRES_PER_AU * 648000 / Math.PI;
export const AU_PER_PARSEC = 648000 / Math.PI;
export const SECONDS_PER_DAY = 86400;
export const J2000_MEAN_OBLIQUITY_DEG = 23.4392911;

// Short aliases are useful in equations while the long names keep call sites
// self-documenting.
export const GM_SUN_NOMINAL = IAU_NOMINAL_SOLAR_MASS_PARAMETER;
export const C_M_S = SPEED_OF_LIGHT_M_S;

const DEG_TO_RAD = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
const CRITICAL_IMPACT_PARAMETER_OVER_M = 3 * Math.sqrt(3);

function finiteNumber(value, label) {
  const number = typeof value === 'number' ? value : value?.value;
  if (!Number.isFinite(number)) {
    throw new TypeError(`${label} must be a finite number or a quantity with a finite value`);
  }
  return number;
}

function positiveNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number <= 0) throw new RangeError(`${label} must be greater than zero`);
  return number;
}

function unitVector(x, y, z) {
  const length = Math.hypot(x, y, z);
  if (!(length > 0)) throw new RangeError('Cannot normalize a zero-length vector');
  return { x: x / length, y: y / length, z: z / length };
}

function equatorialCartesianToScene(xEquatorial, yEquatorial, zEquatorial) {
  const obliquity = J2000_MEAN_OBLIQUITY_DEG * DEG_TO_RAD;
  const cosObliquity = Math.cos(obliquity);
  const sinObliquity = Math.sin(obliquity);

  // Equatorial -> mean ecliptic J2000, then use the app's established
  // ecliptic (X,Y,Z) -> scene (X,Z,-Y) convention.
  const xEcliptic = xEquatorial;
  const yEcliptic = yEquatorial * cosObliquity + zEquatorial * sinObliquity;
  const zEcliptic = -yEquatorial * sinObliquity + zEquatorial * cosObliquity;
  return unitVector(xEcliptic, zEcliptic, -yEcliptic);
}

/**
 * Convert an ICRS right ascension/declination to the app's unit scene vector.
 * The app uses Y-up and maps J2000 ecliptic coordinates as (X, Z, -Y).
 */
export function equatorialToSceneDirection(raDeg, decDeg) {
  const ra = finiteNumber(raDeg, 'right ascension') * DEG_TO_RAD;
  const decNumber = finiteNumber(decDeg, 'declination');
  if (decNumber < -90 || decNumber > 90) {
    throw new RangeError('declination must be in the range [-90, 90] degrees');
  }
  const dec = decNumber * DEG_TO_RAD;
  const cosDec = Math.cos(dec);
  return equatorialCartesianToScene(
    cosDec * Math.cos(ra),
    cosDec * Math.sin(ra),
    Math.sin(dec),
  );
}

// Terminology alias: ICRS is the equatorial frame used by the Gaia entry.
export const icrsToSceneDirection = equatorialToSceneDirection;

/**
 * Logical interstellar position on the same AU ruler as the true-scale orrery.
 *
 * The returned coordinates intentionally remain JavaScript Float64 values and
 * must be rendered relative to a moving origin. Uploading this ~10^12-unit
 * translation directly to a Float32 GPU matrix would erase the binary's local
 * kilometre/AU detail.
 */
export function interstellarScenePosition(system, sceneUnitsPerAU) {
  if (!system || typeof system !== 'object') {
    throw new TypeError('system must be a black-hole data object');
  }
  const unitsPerAU = positiveNumber(sceneUnitsPerAU, 'scene units per AU');
  const parallaxMas = positiveNumber(system.coordinates?.parallaxMas, 'parallax');
  const distancePc = 1000 / parallaxMas;
  const parallaxUncertaintyMas = system.coordinates?.parallaxMas?.uncertainty;
  const distanceUncertaintyPc = Number.isFinite(parallaxUncertaintyMas)
    ? 1000 * parallaxUncertaintyMas / (parallaxMas * parallaxMas)
    : null;
  const distanceAU = distancePc * AU_PER_PARSEC;
  const distanceSceneUnits = distanceAU * unitsPerAU;
  const direction = equatorialToSceneDirection(
    system.coordinates?.raDeg,
    system.coordinates?.decDeg ?? system.coordinates?.declinationDeg,
  );
  return {
    provenance: 'derived',
    frame: system.coordinates?.frame ?? 'ICRS',
    coordinateEpoch: system.coordinates?.epoch ?? null,
    distancePc,
    distanceUncertaintyPc,
    distanceAU,
    distanceSceneUnits,
    direction,
    positionScene: [
      direction.x * distanceSceneUnits,
      direction.y * distanceSceneUnits,
      direction.z * distanceSceneUnits,
    ],
    renderingRequirement: 'floating-origin',
  };
}

/** Return all standard Schwarzschild length scales for a mass in solar masses. */
export function schwarzschildDerived(massSolar) {
  const mass = positiveNumber(massSolar, 'black-hole mass');
  const gravitationalRadiusM = GM_SUN_NOMINAL * mass / (C_M_S * C_M_S);
  const eventHorizonRadiusM = 2 * gravitationalRadiusM;
  const photonSphereRadiusM = 3 * gravitationalRadiusM;
  const criticalImpactParameterM = CRITICAL_IMPACT_PARAMETER_OVER_M * gravitationalRadiusM;
  const shadowDiameterM = 2 * criticalImpactParameterM;

  return {
    provenance: 'derived',
    model: 'Schwarzschild',
    massSolar: mass,
    gravitationalRadiusM,
    gravitationalRadiusKm: gravitationalRadiusM / 1000,
    eventHorizonRadiusM,
    eventHorizonRadiusKm: eventHorizonRadiusM / 1000,
    schwarzschildRadiusM: eventHorizonRadiusM,
    schwarzschildRadiusKm: eventHorizonRadiusM / 1000,
    photonSphereRadiusM,
    photonSphereRadiusKm: photonSphereRadiusM / 1000,
    criticalImpactParameterM,
    criticalImpactParameterKm: criticalImpactParameterM / 1000,
    shadowDiameterM,
    shadowDiameterKm: shadowDiameterM / 1000,
  };
}

/**
 * Relative semimajor axis from the Newtonian two-body form of Kepler's law.
 * Masses are in nominal solar masses, period in SI days, result in exact AU.
 */
export function deriveSemimajorAxisAU(blackHoleMassSolar, companionMassSolar, periodDays) {
  const blackHoleMass = positiveNumber(blackHoleMassSolar, 'black-hole mass');
  const companionMass = positiveNumber(companionMassSolar, 'companion mass');
  const periodSeconds = positiveNumber(periodDays, 'orbital period') * SECONDS_PER_DAY;
  const totalMu = GM_SUN_NOMINAL * (blackHoleMass + companionMass);
  const semimajorAxisM = Math.cbrt(totalMu * (periodSeconds / TWO_PI) ** 2);
  return semimajorAxisM / METRES_PER_AU;
}

function solveKeplerEquation(meanAnomalyRad, eccentricity) {
  let meanAnomaly = meanAnomalyRad % TWO_PI;
  if (meanAnomaly > Math.PI) meanAnomaly -= TWO_PI;
  if (meanAnomaly < -Math.PI) meanAnomaly += TWO_PI;

  let eccentricAnomaly = eccentricity < 0.8 ? meanAnomaly : Math.PI;
  for (let iteration = 0; iteration < 20; iteration++) {
    const residual = eccentricAnomaly
      - eccentricity * Math.sin(eccentricAnomaly)
      - meanAnomaly;
    const derivative = 1 - eccentricity * Math.cos(eccentricAnomaly);
    const correction = residual / derivative;
    eccentricAnomaly -= correction;
    if (Math.abs(correction) < 1e-13) break;
  }
  return eccentricAnomaly;
}

function scaleArray(vector, scalar) {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

function addScaledBasis(a, aScale, b, bScale, c, cScale) {
  return [
    a.x * aScale + b.x * bScale + c.x * cScale,
    a.y * aScale + b.y * bScale + c.y * cScale,
    a.z * aScale + b.z * bScale + c.z * cScale,
  ];
}

function skyBasis(system) {
  const raDeg = finiteNumber(system.coordinates?.raDeg, 'right ascension');
  const decDeg = finiteNumber(
    system.coordinates?.decDeg ?? system.coordinates?.declinationDeg,
    'declination',
  );
  const ra = raDeg * DEG_TO_RAD;
  const dec = decDeg * DEG_TO_RAD;

  // Tangent vectors in ICRS: north, east, and away from the Solar System.
  const north = equatorialCartesianToScene(
    -Math.sin(dec) * Math.cos(ra),
    -Math.sin(dec) * Math.sin(ra),
    Math.cos(dec),
  );
  const east = equatorialCartesianToScene(-Math.sin(ra), Math.cos(ra), 0);
  const away = equatorialToSceneDirection(raDeg, decDeg);
  return { north, east, away };
}

/**
 * Barycentric state of a detached binary at an observation Julian Date.
 *
 * Returned positions are AU offsets from the binary barycentre in the app's
 * scene axes.  Omega is interpreted as position angle east of north; positive
 * line-of-sight displacement points away from the Solar-System observer.  The
 * ephemeris describes the phase inferred from observations received here, not
 * a claim about simultaneity across the system's ~478 pc light-travel distance.
 */
export function binaryOrbitState(system, observationJulianDate) {
  if (!system || typeof system !== 'object') {
    throw new TypeError('system must be a black-hole binary data object');
  }
  const jd = finiteNumber(observationJulianDate, 'observation Julian Date');
  const blackHoleMass = positiveNumber(
    system.blackHole?.massSolar ?? system.massSolar,
    'black-hole mass',
  );
  const companionMass = positiveNumber(system.companion?.massSolar, 'companion mass');
  const periodDays = positiveNumber(system.orbit?.periodDays, 'orbital period');
  const eccentricity = finiteNumber(system.orbit?.eccentricity, 'eccentricity');
  if (eccentricity < 0 || eccentricity >= 1) {
    throw new RangeError('binaryOrbitState requires an elliptical orbit with 0 <= e < 1');
  }
  const periastronJulianDate = finiteNumber(
    system.orbit?.periastronJulianDate,
    'periastron Julian Date',
  );

  const semimajorAxisAU = deriveSemimajorAxisAU(blackHoleMass, companionMass, periodDays);
  const cycles = (jd - periastronJulianDate) / periodDays;
  const phase = ((cycles % 1) + 1) % 1;
  const meanAnomalyRad = phase * TWO_PI;
  const eccentricAnomalyRad = solveKeplerEquation(meanAnomalyRad, eccentricity);
  const trueAnomalyRad = 2 * Math.atan2(
    Math.sqrt(1 + eccentricity) * Math.sin(eccentricAnomalyRad / 2),
    Math.sqrt(1 - eccentricity) * Math.cos(eccentricAnomalyRad / 2),
  );
  const separationAU = semimajorAxisAU * (1 - eccentricity * Math.cos(eccentricAnomalyRad));

  const inclination = finiteNumber(system.orbit?.inclinationDeg, 'inclination') * DEG_TO_RAD;
  const ascendingNode = finiteNumber(
    system.orbit?.ascendingNodeDeg,
    'longitude of ascending node',
  ) * DEG_TO_RAD;
  const argumentOfPeriastron = finiteNumber(
    system.orbit?.argumentOfPeriastronDeg,
    'argument of periastron',
  ) * DEG_TO_RAD;
  const argumentOfLatitude = argumentOfPeriastron + trueAnomalyRad;

  // Conventional apparent-orbit coordinates: X north, Y east, Z away.
  const localNorth = separationAU * (
    Math.cos(ascendingNode) * Math.cos(argumentOfLatitude)
    - Math.sin(ascendingNode) * Math.sin(argumentOfLatitude) * Math.cos(inclination)
  );
  const localEast = separationAU * (
    Math.sin(ascendingNode) * Math.cos(argumentOfLatitude)
    + Math.cos(ascendingNode) * Math.sin(argumentOfLatitude) * Math.cos(inclination)
  );
  const localAway = separationAU * Math.sin(argumentOfLatitude) * Math.sin(inclination);
  const basis = skyBasis(system);
  const relative = addScaledBasis(
    basis.north, localNorth,
    basis.east, localEast,
    basis.away, localAway,
  );

  const totalMass = blackHoleMass + companionMass;
  const blackHole = scaleArray(relative, -companionMass / totalMass);
  const star = scaleArray(relative, blackHoleMass / totalMass);

  return {
    provenance: 'derived',
    observationJulianDate: jd,
    phase,
    meanAnomalyRad,
    eccentricAnomalyRad,
    trueAnomalyRad,
    semimajorAxisAU,
    separationAU,
    relative,
    blackHole,
    star,
  };
}

/** Derive display-ready Newtonian and Schwarzschild properties from source data. */
export function deriveBlackHoleSystem(system) {
  if (!system || typeof system !== 'object') {
    throw new TypeError('system must be a black-hole binary data object');
  }
  const blackHoleMass = positiveNumber(
    system.blackHole?.massSolar ?? system.massSolar,
    'black-hole mass',
  );
  const companionMass = positiveNumber(system.companion?.massSolar, 'companion mass');
  const periodDays = positiveNumber(system.orbit?.periodDays, 'orbital period');
  const eccentricity = finiteNumber(system.orbit?.eccentricity, 'eccentricity');
  const parallax = positiveNumber(system.coordinates?.parallaxMas, 'parallax');
  const parallaxUncertainty = system.coordinates?.parallaxMas?.uncertainty;
  const semimajorAxisAU = deriveSemimajorAxisAU(blackHoleMass, companionMass, periodDays);
  const distancePc = 1000 / parallax;
  const distanceUncertaintyPc = Number.isFinite(parallaxUncertainty)
    ? 1000 * parallaxUncertainty / (parallax * parallax)
    : null;
  const schwarzschild = schwarzschildDerived(blackHoleMass);
  const observerRadiusOverM = distancePc * METRES_PER_PARSEC
    / schwarzschild.gravitationalRadiusM;
  const shadowAngularDiameterRad = 2 * schwarzschildShadowAngularRadius(observerRadiusOverM);
  const shadowAngularDiameterNanoarcsec = shadowAngularDiameterRad
    * 180 / Math.PI * 3600 * 1e9;

  return {
    provenance: 'derived',
    inputs: {
      mass: 'blackHole.massSolar + companion.massSolar',
      orbit: 'orbit.periodDays + orbit.eccentricity',
      distance: 'coordinates.parallaxMas (simple reciprocal)',
    },
    distancePc,
    distanceUncertaintyPc,
    semimajorAxisAU,
    periapsisAU: semimajorAxisAU * (1 - eccentricity),
    apoapsisAU: semimajorAxisAU * (1 + eccentricity),
    shadowAngularDiameterRad,
    shadowAngularDiameterNanoarcsec,
    schwarzschild,
  };
}

/** Proper-time / Schwarzschild-coordinate-time ratio for a static observer. */
export function staticObserverTimeDilation(radiusOverM) {
  const radius = positiveNumber(radiusOverM, 'observer radius in GM/c^2');
  if (radius <= 2) {
    throw new RangeError('A static Schwarzschild observer must be outside r = 2 GM/c^2');
  }
  return Math.sqrt(1 - 2 / radius);
}

/**
 * Exact angular radius of the Schwarzschild shadow for a local static observer.
 * `radiusOverM` is r_O / (GM/c^2); the result is radians.
 */
export function schwarzschildShadowAngularRadius(radiusOverM) {
  const radius = positiveNumber(radiusOverM, 'observer radius in GM/c^2');
  if (radius <= 2) {
    throw new RangeError('A static Schwarzschild observer must be outside r = 2 GM/c^2');
  }
  const sine = CRITICAL_IMPACT_PARAMETER_OVER_M
    * Math.sqrt(1 - 2 / radius)
    / radius;
  // Roundoff at the photon sphere can put the mathematically exact value 1 a
  // few ulps above 1.  Clamp only for asin's numerical domain.
  const acuteAngle = Math.asin(Math.min(1, Math.max(-1, sine)));
  // Outside the photon sphere the shadow occupies less than half the sky.  A
  // (necessarily accelerated) static observer inside it sees the complementary
  // obtuse angle, approaching a full sky at the horizon.
  return radius >= 3 ? acuteAngle : Math.PI - acuteAngle;
}

export const observerShadowAngularRadius = schwarzschildShadowAngularRadius;

export function criticalImpactParameterOverM() {
  return CRITICAL_IMPACT_PARAMETER_OVER_M;
}

/** Whether an incoming null ray from infinity is below the capture threshold. */
export function isPhotonCaptured(impactParameterOverM) {
  const impactParameter = finiteNumber(impactParameterOverM, 'impact parameter in GM/c^2');
  if (impactParameter < 0) throw new RangeError('impact parameter cannot be negative');
  return impactParameter < CRITICAL_IMPACT_PARAMETER_OVER_M;
}

/** Leading weak-field Schwarzschild deflection, alpha = 4M/b, in radians. */
export function weakFieldDeflectionRadians(impactParameterOverM) {
  const impactParameter = positiveNumber(impactParameterOverM, 'impact parameter in GM/c^2');
  return 4 / impactParameter;
}

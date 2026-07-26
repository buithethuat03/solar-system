// ============================================================================
//  astro-math.js — frame conversions and orientation math shared by the
//  renderer, the offline generators, and the Node regression suites.
//
//  Dependency-free on purpose (no three import; plain {x, y, z} objects),
//  following the blackhole-physics.js precedent, so tools/test_*.mjs can
//  exercise every convention that has previously hidden sign bugs.
//
//  Scene frame: kepler.js maps ecliptic (X, Y, Z) → scene (X, Z, −Y). That is
//  a proper rotation, so prograde ecliptic motion sweeps +X → −Z in scene
//  coordinates and orbital angular momentum points along scene +Y.
// ============================================================================

const DEG2RAD = Math.PI / 180;

// Mean obliquity of the ecliptic at J2000 (same constant kepler.js/bodies.js use).
export const ECL_OBLIQUITY_DEG = 23.4392911;

/** J2000 equatorial RA/Dec (deg) → unit direction in the scene frame. */
export function equatorialToSceneVec(raDeg, decDeg) {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const xe = Math.cos(dec) * Math.cos(ra);
  const ye = Math.cos(dec) * Math.sin(ra);
  const ze = Math.sin(dec);
  // equatorial → ecliptic (rotate about the vernal-equinox axis by the obliquity)
  const c = Math.cos(ECL_OBLIQUITY_DEG * DEG2RAD);
  const s = Math.sin(ECL_OBLIQUITY_DEG * DEG2RAD);
  const xc = xe;
  const yc = ye * c + ze * s;
  const zc = -ye * s + ze * c;
  // ecliptic (X, Y, Z) → scene (X, Z, −Y) — identical to kepler.js
  return { x: xc, y: zc, z: -yc };
}

/**
 * Position on a circular parent-relative orbit at phase angle `angRad`,
 * in the parent's local frame. Prograde motion (growing angle) must sweep
 * +X → −Z to match the planets' heliocentric direction — the +sin variant
 * of this formula is exactly the sign bug that made every moon and belt
 * particle revolve backwards.
 */
export function moonOrbitPosition(angRad, dist, out = { x: 0, y: 0, z: 0 }) {
  out.x = Math.cos(angRad) * dist;
  out.y = 0;
  out.z = -Math.sin(angRad) * dist;
  return out;
}

/**
 * Unit spin angular-momentum direction in the scene frame for a body with an
 * IAU J2000 north pole and a signed rotation period (negative hours = the
 * body spins retrograde about its IAU north pole, e.g. Venus and Uranus).
 */
export function spinAngularMomentumDir(pole, rotationHours) {
  const dir = equatorialToSceneVec(pole.ra, pole.dec);
  const sign = rotationHours < 0 ? -1 : 1;
  return { x: dir.x * sign, y: dir.y * sign, z: dir.z * sign };
}

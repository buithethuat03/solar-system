// ============================================================================
//  blackhole-shaders.js — GLSL sources for the Gaia BH1 relativistic view.
//
//  Every numeric grid constant is interpolated from
//  js/blackhole-lut-constants.js so the lookup mapping has exactly one
//  runtime copy; the Node suite asserts no hardcoded duplicate survives here.
//  Modules stay dependency-free (no three import) so tools/test_blackhole.mjs
//  can read and grep them under Node.
// ============================================================================

import {
  LUT_WIDTH,
  LUT_HEIGHT,
  LUT_R_MIN,
  LUT_R_MAX,
  LUT_SAMPLE_MIN,
  LUT_SAMPLE_SPLIT,
  LUT_SAMPLE_LOG_RANGE,
  LUT_LOOKUP_SPLIT,
  CRITICAL_IMPACT_OVER_M,
  DISK_LUT_WIDTH,
  DISK_LUT_HEIGHT,
  DISK_CAPTURED_EPSILON_MIN,
  DISK_ESCAPING_DELTA_MIN,
  DISK_IMPACT_MAX_OVER_M,
  DISK_OBSERVER_ALPHA_EPSILON_MIN,
  DISK_MAX_CROSSINGS,
  DISK_INNER_RADIUS_OVER_M,
} from './blackhole-lut-constants.js';
import { thinDiskTemperatureK } from './blackhole-physics.js';

// JavaScript prints the shortest decimal that round-trips the exact double,
// so interpolating String(value) preserves full precision in the GLSL literal.
function glslFloat(value) {
  const text = String(value);
  return /[.e]/i.test(text) ? text : `${text}.0`;
}

export const FULLSCREEN_VERTEX = /* glsl */ `
  precision highp float;
  in vec3 position;
  in vec2 uv;
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Scene direction -> Gaia equirectangular UV. Shared verbatim by the lensing
// fragment and the overview backdrop so both views agree by construction.
// Host shaders must declare `uniform vec3 uEqX, uEqY, uEqZ;` and a `PI`
// constant before including this chunk. Pure math: valid in GLSL1 and GLSL3.
// gaiaGalacticLinear is the rotation alone (no normalize); it doubles as the
// exact differential of the direction map for analytic texture gradients.
export const GAIA_SKY_DIRECTION_GLSL = /* glsl */ `
  vec3 gaiaGalacticLinear(vec3 sceneDirection) {
    vec3 eq = vec3(
      dot(sceneDirection, uEqX),
      dot(sceneDirection, uEqY),
      dot(sceneDirection, uEqZ)
    );
    return vec3(
      -0.0548755604 * eq.x - 0.8734370902 * eq.y - 0.4838350155 * eq.z,
       0.4941094279 * eq.x - 0.4448296300 * eq.y + 0.7469822445 * eq.z,
      -0.8676661490 * eq.x - 0.1980763734 * eq.y + 0.4559837762 * eq.z
    );
  }

  vec2 gaiaUvFromGalactic(vec3 gal) {
    float longitude = -atan(gal.y, gal.x); // astronomical longitude grows left
    float latitude = asin(clamp(gal.z, -1.0, 1.0));
    return vec2(fract(longitude / (2.0 * PI) + 0.5), latitude / PI + 0.5);
  }

  vec2 gaiaEquirectangularUv(vec3 sceneDirection) {
    return gaiaUvFromGalactic(normalize(gaiaGalacticLinear(sceneDirection)));
  }
`;

// Interleaved gradient noise: a stable per-pixel dither shared by the lensing
// and composite passes (Jimenez 2014). One call per fragment, no texture.
const IGN_GLSL = /* glsl */ `
  float interleavedGradientNoise(vec2 fragCoord) {
    return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
  }
`;

const SRGB_GLSL = /* glsl */ `
  vec3 linearToSrgb(vec3 color) {
    vec3 low = color * 12.92;
    vec3 high = 1.055 * pow(max(color, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(low, high, step(vec3(0.0031308), color));
  }
`;

// The exact ACES filmic fit three.js applies with ACESFilmicToneMapping
// (Stephen Hill's approximation), with uExposure playing toneMappingExposure.
// Copied by value so the close-up matches the orrery's global tone mapping.
const ACES_GLSL = /* glsl */ `
  vec3 RRTAndODTFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }

  vec3 acesFilmic(vec3 color) {
    const mat3 ACESInputMat = mat3(
      vec3(0.59719, 0.07600, 0.02840),
      vec3(0.35458, 0.90834, 0.13383),
      vec3(0.04823, 0.01566, 0.83777)
    );
    const mat3 ACESOutputMat = mat3(
      vec3( 1.60475, -0.10208, -0.00327),
      vec3(-0.53108,  1.10813, -0.07276),
      vec3(-0.07367, -0.00605,  1.07602)
    );
    color = ACESInputMat * (color / 0.6);
    color = RRTAndODTFit(color);
    return clamp(ACESOutputMat * color, 0.0, 1.0);
  }
`;

// Blackbody display range of the disk's 1D colour ramp (Kelvin).
export const DISK_BLACKBODY_MIN_K = 1000;
export const DISK_BLACKBODY_MAX_K = 16000;
export const DISK_PEAK_TEMPERATURE_K = 8000;

// GLSL for the opt-in illustrative accretion disk: master-trajectory lookup
// (see tools/generate_blackhole_disk_lut.mjs for the table layout), first-hit
// selection over up to DISK_MAX_CROSSINGS disk-plane crossings, and
// Cunningham g-factor shading with a thin-disk temperature profile. Every
// mapping constant is injected from js/blackhole-lut-constants.js.
function diskChunk() {
  const deltaMax = DISK_IMPACT_MAX_OVER_M / CRITICAL_IMPACT_OVER_M - 1;
  // 1 / profile(r_peak) for the normalized thin-disk temperature profile,
  // derived from the same physics helper the Node tests pin.
  const profileNorm = thinDiskTemperatureK(10, 1)
    / (10 ** -0.75 * (1 - Math.sqrt(6 / 10)) ** 0.25);
  return /* glsl */ `
  uniform sampler2D uTrajectoryLut;
  uniform sampler2D uFamilyLut;
  uniform sampler2D uObserverLut;
  uniform sampler2D uBlackbody;
  uniform vec3 uDiskNormal;
  uniform vec3 uDiskRef0;
  uniform float uShadowAngle;
  uniform float uDiskOuterR;
  uniform float uDiskIntensity;
  uniform float uDiskTime;

  const float W_EPS_LOG = ${glslFloat(Math.log(DISK_CAPTURED_EPSILON_MIN))};
  const float W_DELTA_MIN = ${glslFloat(DISK_ESCAPING_DELTA_MIN)};
  const float W_DELTA_LOG_RANGE = ${glslFloat(Math.log(deltaMax / DISK_ESCAPING_DELTA_MIN))};
  const float ALPHA_EPS_LOG = ${glslFloat(Math.log(DISK_OBSERVER_ALPHA_EPSILON_MIN))};
  const float DISK_R_IN = ${glslFloat(DISK_INNER_RADIUS_OVER_M)};
  const float DISK_T_NORM = ${glslFloat(DISK_PEAK_TEMPERATURE_K * profileNorm)};
  const float BB_T_MIN = ${glslFloat(DISK_BLACKBODY_MIN_K)};
  const float BB_T_MAX = ${glslFloat(DISK_BLACKBODY_MAX_K)};
  const float DISK_FEATHER = 0.12;
  const int DISK_K_MAX = ${DISK_MAX_CROSSINGS};
  const ivec2 DISK_LUT_SIZE = ivec2(${DISK_LUT_WIDTH}, ${DISK_LUT_HEIGHT});

  float diskFamilyCoordinate(float b) {
    if (b < B_CRIT) {
      float eps = clamp(1.0 - b / B_CRIT, ${glslFloat(DISK_CAPTURED_EPSILON_MIN)}, 1.0);
      return 0.5 * log(eps) / W_EPS_LOG;
    }
    float delta = clamp(b / B_CRIT - 1.0, W_DELTA_MIN, ${glslFloat(deltaMax)});
    return 0.5 + 0.5 * log(delta / W_DELTA_MIN) / W_DELTA_LOG_RANGE;
  }

  // {phi_O, dphiEnd}; bilinear clamped within the captured/escaping halves.
  vec2 sampleObserverLut(float columnCoordinate, float rowCoordinate) {
    float pixel = clamp(columnCoordinate * float(DISK_LUT_SIZE.x) - 0.5,
      0.0, float(DISK_LUT_SIZE.x) - 1.0);
    int i0 = int(floor(pixel));
    int i1 = min(i0 + 1, DISK_LUT_SIZE.x - 1);
    float f = pixel - float(i0);
    int half0 = DISK_LUT_SIZE.x / 2;
    if (i0 < half0 && i1 >= half0) {
      if (columnCoordinate < 0.5) i1 = half0 - 1;
      else i0 = half0;
    }
    float rowPixel = clamp(rowCoordinate * float(DISK_LUT_SIZE.y) - 0.5,
      0.0, float(DISK_LUT_SIZE.y) - 1.0);
    int y0 = int(floor(rowPixel));
    int y1 = min(y0 + 1, DISK_LUT_SIZE.y - 1);
    float fy = rowPixel - float(y0);
    vec2 a = texelFetch(uObserverLut, ivec2(i0, y0), 0).rg;
    vec2 b2 = texelFetch(uObserverLut, ivec2(i1, y0), 0).rg;
    vec2 c = texelFetch(uObserverLut, ivec2(i0, y1), 0).rg;
    vec2 d = texelFetch(uObserverLut, ivec2(i1, y1), 0).rg;
    return mix(mix(a, b2, f), mix(c, d, f), fy);
  }

  // Cubic Hermite in normalized azimuth within one family row (the stored
  // du/dphi slopes make 512 columns sub-pixel across the 29-rad domain).
  float sampleTrajectoryRow(int row, float phiDom, float phiTraj, bool escaping) {
    float t = phiTraj / phiDom;
    if (escaping && t > 1.0) t = 2.0 - t; // mirror across the turning point
    t = clamp(t, 0.0, 1.0);
    float pixel = clamp(t * float(DISK_LUT_SIZE.x) - 0.5,
      0.0, float(DISK_LUT_SIZE.x) - 1.0);
    int j0 = int(floor(pixel));
    int j1 = min(j0 + 1, DISK_LUT_SIZE.x - 1);
    float f = pixel - float(j0);
    vec2 a = texelFetch(uTrajectoryLut, ivec2(j0, row), 0).rg;
    vec2 b2 = texelFetch(uTrajectoryLut, ivec2(j1, row), 0).rg;
    float spacing = phiDom / float(DISK_LUT_SIZE.x);
    float m0 = a.g * spacing;
    float m1 = b2.g * spacing;
    float f2 = f * f;
    float f3 = f2 * f;
    return (2.0 * f3 - 3.0 * f2 + 1.0) * a.r + (f3 - 2.0 * f2 + f) * m0
      + (-2.0 * f3 + 3.0 * f2) * b2.r + (f3 - f2) * m1;
  }

  float diskHash(vec2 cell, float period) {
    cell.y = mod(cell.y, period);
    return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453123);
  }

  // Angularly periodic value noise so the material pattern has no seam.
  float diskNoise(float logR, float angle, float cells) {
    vec2 p = vec2(logR, angle * cells / (2.0 * PI));
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 s = f * f * (3.0 - 2.0 * f);
    float a = diskHash(i, cells);
    float b2 = diskHash(i + vec2(1.0, 0.0), cells);
    float c = diskHash(i + vec2(0.0, 1.0), cells);
    float d = diskHash(i + vec2(1.0, 1.0), cells);
    return mix(mix(a, b2, s.x), mix(c, d, s.x), s.y);
  }
`;
}

// options.hdr: true  -> writes open-range linear HDR (HalfFloat target); the
//                      composite pass applies exposure/tone map/encoding.
//               false -> encodes sRGB + dither in-shader for an 8-bit target
//                      (EXT_color_buffer_float unavailable); composite blits.
// options.disk: true -> compiles the illustrative-disk variant (#define
//                      BH_DISK); the base variant carries zero disk cost.
export function buildLensingFragment(options = {}) {
  const hdr = options.hdr !== false;
  const disk = options.disk === true;
  return /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  ${hdr ? '' : '#define OUTPUT_SRGB8 1'}
  ${disk ? '#define BH_DISK 1' : ''}

  in vec2 vUv;
  out vec4 outColor;

  uniform sampler2D uDeflectionLut;
  uniform sampler2D uSky;
  uniform vec3 uObserverDir;
  uniform vec3 uCameraRight;
  uniform vec3 uCameraUp;
  uniform vec3 uEqX;
  uniform vec3 uEqY;
  uniform vec3 uEqZ;
  uniform vec3 uCompanionDir;
  uniform vec3 uCompanionColor;
  uniform float uCompanionAngularRadius;
  uniform float uObserverRadiusOverM;
  uniform float uAspect;
  uniform float uTanHalfFov;
  // Shadow terms are computed per frame in float64 on the CPU so the shader
  // never subtracts two nearly equal float32 angles.
  uniform float uSinShadow;
  uniform float uCosShadow;
  uniform float uInvAlphaRange;
  // Tangent-plane step of one render-target pixel: 2 tan(fov/2) / heightPx.
  uniform float uPixelStep;
  // Static-observer reception factors (CPU float64): a Planckian chromatic
  // tint at g = 1/sqrt(1 - 2/r) and the Liouville intensity gain g^4.
  uniform vec3 uBlueshiftTint;
  uniform float uBlueshiftIntensity;

  const float PI = 3.1415926535897932384626433832795;
  const float B_CRIT = ${glslFloat(CRITICAL_IMPACT_OVER_M)};
  const float R_MIN = ${glslFloat(LUT_R_MIN)};
  const float R_MAX = ${glslFloat(LUT_R_MAX)};
  const float S_MIN = ${glslFloat(LUT_SAMPLE_MIN)};
  const float S_SPLIT = ${glslFloat(LUT_SAMPLE_SPLIT)};
  const float Q_SPLIT = ${glslFloat(LUT_LOOKUP_SPLIT)};
  const float LOG_RANGE = ${glslFloat(LUT_SAMPLE_LOG_RANGE)};
  const ivec2 LUT_SIZE = ivec2(${LUT_WIDTH}, ${LUT_HEIGHT});

  ${IGN_GLSL}
  ${SRGB_GLSL}

  float lookupCoordinate(float s) {
    if (s <= S_SPLIT) {
      if (s <= S_MIN) return 0.0;
      return Q_SPLIT * log(s / S_MIN) / LOG_RANGE;
    }
    return Q_SPLIT + (1.0 - Q_SPLIT) * (s - S_SPLIT) / (1.0 - S_SPLIT);
  }

  // Manual bilinear on the NearestFilter float table (no dependency on
  // OES_texture_float_linear). The x-gradient of Phi falls out of the same
  // four texels and feeds the analytic screen-space Jacobian below.
  vec2 samplePhiWithGradient(vec2 uv) {
    vec2 pixel = uv * vec2(LUT_SIZE) - 0.5;
    ivec2 i0 = clamp(ivec2(floor(pixel)), ivec2(0), LUT_SIZE - 1);
    ivec2 i1 = min(i0 + 1, LUT_SIZE - 1);
    vec2 f = clamp(fract(pixel), 0.0, 1.0);
    float a = texelFetch(uDeflectionLut, ivec2(i0.x, i0.y), 0).r;
    float b = texelFetch(uDeflectionLut, ivec2(i1.x, i0.y), 0).r;
    float c = texelFetch(uDeflectionLut, ivec2(i0.x, i1.y), 0).r;
    float d = texelFetch(uDeflectionLut, ivec2(i1.x, i1.y), 0).r;
    float phi = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    float dPhiDq = (mix(b, d, f.y) - mix(a, c, f.y)) * float(LUT_SIZE.x);
    return vec2(phi, dPhiDq);
  }

  ${GAIA_SKY_DIRECTION_GLSL}

  ${disk ? diskChunk() : ''}

  void main() {
    vec2 tc = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0) * uTanHalfFov;
    vec3 ray = normalize(-uObserverDir + uCameraRight * tc.x + uCameraUp * tc.y);

    // Exact pinhole-camera angles from the tangent-plane coordinates. The
    // camera basis is orthonormal, so cos(alpha) = 1/sqrt(1 + |tc|^2) without
    // an acos round trip and its ~6x error amplification near the shadow.
    float t2 = dot(tc, tc);
    float invHyp = inversesqrt(1.0 + t2);
    float cosAlpha = invHyp;
    float sinAlpha = sqrt(t2) * invHyp;
    // sin(alpha - shadow) via the angle-difference identity: both products
    // are well conditioned, unlike the direct difference of two ~0.17 rad
    // angles. Derivative width must precede any divergent branch.
    float deltaSin = sinAlpha * uCosShadow - cosAlpha * uSinShadow;
    float edgeW = max(fwidth(deltaSin), 1.0e-7);
    float ign = interleavedGradientNoise(gl_FragCoord.xy);

    // Captured null geodesics end at the horizon. The black region is not a
    // mesh or a texture and no artificial rim is added at this branch. The
    // coverage term is one pixel of analytic antialiasing of the critical
    // curve — a partial-coverage ramp, not a glow. With the illustrative
    // disk compiled in, captured rays keep running: they cross the disk
    // plane on the way down, drawing the near side in front of the shadow.
  #ifndef BH_DISK
    float coverage = clamp(deltaSin / edgeW + 0.5, 0.0, 1.0);
    if (coverage <= 0.0) {
      outColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
  #else
    float coverage = clamp(deltaSin / edgeW + 0.5, 0.0, 1.0);
  #endif

    float delta = asin(clamp(deltaSin, 0.0, 1.0));
    // Below the float32 resolution floor the innermost windings would
    // quantize into concentric contours; ~1 quantization step of unbiased
    // dither dissolves them into noise instead.
    delta = max(delta + (ign - 0.5) * (1.0e-7 + 2.0e-7 * delta), 0.0);
    float s = sqrt(min(delta * uInvAlphaRange, 1.0));
    float q = lookupCoordinate(s);
    float rCoordinate = clamp(
      (uObserverRadiusOverM - R_MIN) / (R_MAX - R_MIN), 0.0, 1.0
    );
    vec2 phiSample = samplePhiWithGradient(vec2(q, rCoordinate));
    float phi = phiSample.x;

    vec3 tangent = normalize(ray + uObserverDir * cosAlpha);
    vec3 sourceDirection = normalize(
      uObserverDir * cos(phi) + tangent * sin(phi)
    );

    // Analytic screen-space Jacobian of the source direction. Derivative
    // instructions are undefined past the divergent return above, and
    // screen-space fwidth of the wrapped equirect UV would also mis-select
    // mips across the fract() longitude seam; the chain rule sidesteps both.
    float dqDs = s <= S_SPLIT
      ? Q_SPLIT / (max(s, S_MIN) * LOG_RANGE)
      : (1.0 - Q_SPLIT) / (1.0 - S_SPLIT);
    float dsDalpha = uInvAlphaRange / (2.0 * max(s, 1.0e-4));
    float dAlphaPix = uPixelStep * cosAlpha * cosAlpha;
    float dPsiPix = uPixelStep / max(sqrt(t2), 1.0e-4);
    float dPhiPix = abs(phiSample.y) * dqDs * dsDalpha * dAlphaPix;
    vec3 sPerp = -uObserverDir * sin(phi) + tangent * cos(phi);
    vec3 binorm = cross(uObserverDir, tangent);
    vec3 dSdr = sPerp * dPhiPix;                 // radial screen step
    vec3 dSdt = binorm * (sin(phi) * dPsiPix);   // tangential screen step

    vec3 gal = normalize(gaiaGalacticLinear(sourceDirection));
    vec2 skyUv = gaiaUvFromGalactic(gal);
    vec3 dGalR = gaiaGalacticLinear(dSdr);
    vec3 dGalT = gaiaGalacticLinear(dSdt);
    float planeInv = 1.0 / max(gal.x * gal.x + gal.y * gal.y, 1.0e-8);
    float cosLatInv = inversesqrt(max(1.0 - gal.z * gal.z, 1.0e-8));
    vec2 dUvR = vec2(
      (gal.x * dGalR.y - gal.y * dGalR.x) * planeInv / (2.0 * PI),
      dGalR.z * cosLatInv / PI
    );
    vec2 dUvT = vec2(
      (gal.x * dGalT.y - gal.y * dGalT.x) * planeInv / (2.0 * PI),
      dGalT.z * cosLatInv / PI
    );
    vec3 sky = textureGrad(uSky, skyUv, dUvR, dUvT).rgb;
    // Gravitational blueshift of everything received from far away: at
    // r = 30M this is +15% intensity; near the table's inner edge it is x2.2
    // and visibly bluer. The companion colour arrives already shifted.
    sky *= uBlueshiftTint * uBlueshiftIntensity;

    // At ~1 AU the companion is millions of M from the close observer, so its
    // finite angular disc is accurately treated as a directional source before
    // the same geodesic mapping. Surface brightness is conserved by lensing.
    // The edge width comes from the same analytic Jacobian; the upper clamp
    // keeps strongly magnified arcs from dissolving below ~40% core contrast.
    float cosSep = clamp(dot(sourceDirection, uCompanionDir), -1.0, 1.0);
    float sourceSeparation = acos(cosSep);
    float sinSep = max(sqrt(1.0 - cosSep * cosSep), 1.0e-4);
    float dSigR = abs(dot(uCompanionDir, dSdr)) / sinSep;
    float dSigT = abs(dot(uCompanionDir, dSdt)) / sinSep;
    float edgeWidth = clamp(
      length(vec2(dSigR, dSigT)),
      2.0e-5,
      0.6 * uCompanionAngularRadius
    );
    float companion = 1.0 - smoothstep(
      uCompanionAngularRadius - edgeWidth,
      uCompanionAngularRadius + edgeWidth,
      sourceSeparation
    );
    // Standard linear limb darkening (u = 0.6, typical for a ~5850 K G star);
    // a display model, labeled in the UI alongside the PSF note.
    float limbX = clamp(sourceSeparation / max(uCompanionAngularRadius, 1.0e-6), 0.0, 1.0);
    float limbMu = sqrt(max(1.0 - limbX * limbX, 0.0));
    float limb = 1.0 - 0.6 * (1.0 - limbMu);
    // The photosphere occludes the sky behind it (mix, not add); the PSF wings
    // are applied downstream by the composite pass.
    vec3 color = mix(sky, uCompanionColor * limb, companion) * coverage;

  #ifdef BH_DISK
    // ---- illustrative accretion disk (opt-in, labeled model) ----
    // The first disk-plane crossing along the backward-traced geodesic wins
    // (optically thick disk); higher orders draw the under-disk image and the
    // photon-ring sub-images with no painted ring anywhere.
    float bImpact = B_CRIT * sinAlpha / max(uSinShadow, 1.0e-9);
    bool escaping = deltaSin >= 0.0;
    float columnCoordinate;
    if (escaping) {
      columnCoordinate = 0.5 + 0.5 * lookupCoordinate(s);
    } else {
      float epsAlpha = clamp(asin(clamp(-deltaSin, 0.0, 1.0)) / uShadowAngle,
        ${glslFloat(DISK_OBSERVER_ALPHA_EPSILON_MIN)}, 1.0);
      columnCoordinate = 0.5 * log(epsAlpha) / ALPHA_EPS_LOG;
    }
    vec2 observerSample = sampleObserverLut(columnCoordinate, rCoordinate);
    float phiObserver = observerSample.x;
    float phiEndRemaining = observerSample.y;

    float wCoord = diskFamilyCoordinate(bImpact);
    float rowPixel = clamp(wCoord * float(DISK_LUT_SIZE.y) - 0.5,
      0.0, float(DISK_LUT_SIZE.y) - 1.0);
    int row0 = int(floor(rowPixel));
    int row1 = min(row0 + 1, DISK_LUT_SIZE.y - 1);
    float rowF = rowPixel - float(row0);
    int halfRows = DISK_LUT_SIZE.y / 2;
    if (escaping) { row0 = max(row0, halfRows); row1 = max(row1, halfRows); }
    else { row0 = min(row0, halfRows - 1); row1 = min(row1, halfRows - 1); }
    vec2 family0 = texelFetch(uFamilyLut, ivec2(row0, 0), 0).rg;
    vec2 family1 = texelFetch(uFamilyLut, ivec2(row1, 0), 0).rg;

    // Disk-plane crossings at position azimuths phi0 + k*pi past the observer.
    float phi0 = atan(-dot(uObserverDir, uDiskNormal), dot(tangent, uDiskNormal));
    phi0 = phi0 - PI * floor(phi0 / PI);
    if (phi0 <= 0.0) phi0 = PI;
    float hitRadius = 0.0;
    float hitPhi = 0.0;
    bool hitFound = false;
    for (int k = 0; k < DISK_K_MAX; k++) {
      float phiK = phi0 + float(k) * PI;
      float phiMaster = phiObserver + phiK;
      float u0 = sampleTrajectoryRow(row0, family0.x, phiMaster, escaping);
      float u1 = sampleTrajectoryRow(row1, family1.x, phiMaster, escaping);
      float radius = 1.0 / max(mix(u0, u1, rowF), 1.0e-6);
      bool accept = phiK <= phiEndRemaining && !hitFound
        && radius >= DISK_R_IN - DISK_FEATHER * 3.0
        && radius <= uDiskOuterR + DISK_FEATHER * 3.0;
      if (accept) { hitFound = true; hitRadius = radius; hitPhi = phiK; }
    }
    if (hitFound) {
      float diskMask = smoothstep(DISK_R_IN - DISK_FEATHER, DISK_R_IN + DISK_FEATHER, hitRadius)
        * (1.0 - smoothstep(uDiskOuterR - DISK_FEATHER, uDiskOuterR + DISK_FEATHER, hitRadius));
      // Cunningham g-factor: Keplerian Doppler plus the gravitational shifts
      // of the emitter and the static observer. The lambda sign convention
      // lives in blackhole-physics.photonAzimuthalImpactParameter.
      float lambda = -bImpact * dot(binorm, uDiskNormal);
      float omegaKepler = pow(max(hitRadius, DISK_R_IN), -1.5);
      float doppler = max(1.0 - omegaKepler * lambda, 0.05);
      float rootObserver = uSinShadow * uObserverRadiusOverM / B_CRIT; // sqrt(1 - 2/r_O)
      float gFactor = sqrt(max(1.0 - 3.0 / max(hitRadius, 3.001), 0.0))
        / max(rootObserver * doppler, 1.0e-4);
      float taper = max(1.0 - sqrt(DISK_R_IN / max(hitRadius, DISK_R_IN)), 0.0);
      float temperatureEmit = DISK_T_NORM * pow(hitRadius, -0.75) * pow(taper, 0.25);
      // A blackbody shifted by g stays a blackbody at g*T, so the bolometric
      // beaming (g^4) and the colour shift are one statement: T_obs = g*T.
      float temperatureObs = gFactor * temperatureEmit;
      vec3 blackbody = texture(uBlackbody,
        vec2((temperatureObs - BB_T_MIN) / (BB_T_MAX - BB_T_MIN), 0.5)).rgb;
      float radiance = pow(temperatureObs / ${glslFloat(DISK_PEAK_TEMPERATURE_K)}, 4.0);
      // Differential Keplerian shear (Omega ~ r^-3/2 exact) advecting a
      // subtle two-octave pattern on a labeled slow-motion clock.
      vec3 hitDirection = uObserverDir * cos(hitPhi) + tangent * sin(hitPhi);
      vec3 diskEast = normalize(cross(uDiskNormal, uDiskRef0));
      float psiMaterial = atan(dot(hitDirection, diskEast), dot(hitDirection, uDiskRef0));
      float shearedAngle = psiMaterial - omegaKepler * uDiskTime;
      float logRadius = log(hitRadius) * 5.0;
      float turbulence = diskNoise(logRadius, shearedAngle, 12.0) * 0.65
        + diskNoise(logRadius * 2.0 + 7.31, shearedAngle * 2.0, 24.0) * 0.35;
      float material = 1.0 + 0.18 * (2.0 * turbulence - 1.0);
      vec3 diskColor = uDiskIntensity * radiance * material * blackbody;
      color = mix(color, diskColor, diskMask);
    }
  #endif
  #ifdef OUTPUT_SRGB8
    color = linearToSrgb(clamp(color, 0.0, 1.0));
    color += vec3((ign - 0.5) / 255.0);
  #endif
    outColor = vec4(color, 1.0);
  }
`;
}

// Overview backdrop: a camera-centred BackSide sphere sampling the same Gaia
// map through the same direction->UV chunk as the lensing shader, so the two
// tabs agree by construction. Built for THREE.ShaderMaterial (not raw): the
// #include chunks supply log-depth support (required — depthTest is on under
// a logarithmicDepthBuffer renderer) and the renderer's ACES tone mapping +
// output encoding, keeping its brightness consistent with both the orrery
// materials it crossfades over and the close-up composite at exposure 1.
export const BACKDROP_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

export function buildBackdropFragment() {
  return /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uSky;
  uniform float uOpacity;
  uniform vec3 uEqX;
  uniform vec3 uEqY;
  uniform vec3 uEqZ;
  varying vec3 vDir;

  ${GAIA_SKY_DIRECTION_GLSL}

  void main() {
    #include <logdepthbuf_fragment>
    vec3 color = texture2D(uSky, gaiaEquirectangularUv(normalize(vDir))).rgb;
    gl_FragColor = vec4(color, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
}

// Dual-Kawase blur pyramid for the close-up point-spread function. The PSF
// models an instrument/eye response applied to all received light (there is
// no brightness threshold); the composite pass mixes it in with a small
// energy-conserving weight. Runs only on the HalfFloat path.
export function buildDownsampleFragment() {
  return /* glsl */ `
  precision highp float;
  precision highp sampler2D;

  in vec2 vUv;
  out vec4 outColor;

  uniform sampler2D uSource;
  uniform vec2 uHalfTexel; // half a SOURCE texel

  void main() {
    vec3 sum = texture(uSource, vUv).rgb * 4.0;
    sum += texture(uSource, vUv + uHalfTexel * vec2(-1.0, -1.0)).rgb;
    sum += texture(uSource, vUv + uHalfTexel * vec2( 1.0, -1.0)).rgb;
    sum += texture(uSource, vUv + uHalfTexel * vec2(-1.0,  1.0)).rgb;
    sum += texture(uSource, vUv + uHalfTexel * vec2( 1.0,  1.0)).rgb;
    outColor = vec4(sum * 0.125, 1.0);
  }
`;
}

export function buildUpsampleFragment() {
  return /* glsl */ `
  precision highp float;
  precision highp sampler2D;

  in vec2 vUv;
  out vec4 outColor;

  uniform sampler2D uSource; // coarser pyramid level
  uniform sampler2D uAdd;    // this level's downsampled scene
  uniform vec2 uHalfTexel;   // half a SOURCE texel

  void main() {
    vec3 sum = vec3(0.0);
    sum += texture(uSource, vUv + uHalfTexel * vec2(-2.0,  0.0)).rgb;
    sum += texture(uSource, vUv + uHalfTexel * vec2( 2.0,  0.0)).rgb;
    sum += texture(uSource, vUv + uHalfTexel * vec2( 0.0, -2.0)).rgb;
    sum += texture(uSource, vUv + uHalfTexel * vec2( 0.0,  2.0)).rgb;
    sum *= 2.0;
    sum += texture(uSource, vUv + uHalfTexel * vec2(-1.0, -1.0)).rgb;
    sum += texture(uSource, vUv + uHalfTexel * vec2( 1.0, -1.0)).rgb;
    sum += texture(uSource, vUv + uHalfTexel * vec2(-1.0,  1.0)).rgb;
    sum += texture(uSource, vUv + uHalfTexel * vec2( 1.0,  1.0)).rgb;
    // Blend the widened lower level into this level's own blur so every
    // pyramid octave contributes to the final wing profile.
    outColor = vec4(mix(texture(uAdd, vUv).rgb, sum / 12.0, 0.5), 1.0);
  }
`;
}

// Composite pass: HDR scene (+ optional PSF bloom) -> exposure -> the same
// ACES fit the orrery uses -> sRGB with one dither step. In the 8-bit path
// the lensing shader already encoded sRGB, so composite is a plain blit.
export function buildCompositeFragment(options = {}) {
  const hdr = options.hdr !== false;
  return /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  ${hdr ? '' : '#define PASSTHROUGH 1'}

  in vec2 vUv;
  out vec4 outColor;

  uniform sampler2D uScene;
  uniform sampler2D uBloom;
  uniform float uPsfWeight;
  uniform float uExposure;

  ${IGN_GLSL}
  ${SRGB_GLSL}
  ${ACES_GLSL}

  void main() {
  #ifdef PASSTHROUGH
    outColor = vec4(texture(uScene, vUv).rgb, 1.0);
  #else
    vec3 hdrColor = mix(
      texture(uScene, vUv).rgb,
      texture(uBloom, vUv).rgb,
      uPsfWeight
    );
    vec3 color = acesFilmic(hdrColor * uExposure);
    color = linearToSrgb(color);
    color += vec3((interleavedGradientNoise(gl_FragCoord.xy) - 0.5) / 255.0);
    outColor = vec4(color, 1.0);
  #endif
  }
`;
}

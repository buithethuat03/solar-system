// ============================================================================
//  blackhole-lut-constants.js — the Schwarzschild LUT grid contract.
//
//  Single runtime source for every constant that must agree with
//  tools/generate_blackhole_lut.mjs (a Node-only module the browser cannot
//  import). LUT_LOOKUP_SPLIT is computed with the generator's own closed-form
//  expression rather than pasted as a literal, so the two stay bit-identical;
//  the Node suite compares this module against the generator's LUT_GRID.
//
//  This module is dependency-free on purpose: tools/test_blackhole.mjs
//  imports it directly under Node.
// ============================================================================

export const LUT_WIDTH = 512;
export const LUT_HEIGHT = 512;
export const LUT_R_MIN = 6;
export const LUT_R_MAX = 100;
export const LUT_SAMPLE_MIN = 1e-6;
export const LUT_SAMPLE_SPLIT = 0.08;
// Choose qSplit so the logarithmic and linear branches have the same ds/dq at
// their join (C1). A merely C0 mapping creates a visible interpolation kink.
export const LUT_SAMPLE_LOG_RANGE = Math.log(LUT_SAMPLE_SPLIT / LUT_SAMPLE_MIN);
export const LUT_LOOKUP_SPLIT = LUT_SAMPLE_SPLIT * LUT_SAMPLE_LOG_RANGE
  / (LUT_SAMPLE_SPLIT * LUT_SAMPLE_LOG_RANGE + 1 - LUT_SAMPLE_SPLIT);
export const CRITICAL_IMPACT_OVER_M = 3 * Math.sqrt(3);

// --------------------------------------------------------------------------
// Illustrative-disk master-trajectory tables (tools/generate_blackhole_disk_lut.mjs).
// The generator's DISK_LUT_GRID and the GLSL constants are both built from
// these, so the mapping exists in exactly one runtime copy.
export const DISK_LUT_WIDTH = 512;
export const DISK_LUT_HEIGHT = 512;
export const DISK_CAPTURED_EPSILON_MIN = 1e-6;
export const DISK_ESCAPING_DELTA_MIN = 1e-6;
export const DISK_IMPACT_MAX_OVER_M = 110;
export const DISK_CAPTURED_END_INVERSE_RADIUS = 0.52;
export const DISK_OBSERVER_ALPHA_EPSILON_MIN = 1e-6;
export const DISK_MAX_CROSSINGS = 10;
export const DISK_INNER_RADIUS_OVER_M = 6;

// Node checks for the pure UI helpers (no DOM required).
// Run: node tools/test_ui.mjs
import assert from 'node:assert/strict';

import {
  fmtSpeed,
  safeSourceHref,
  sliderToSpeed,
  speedToSlider,
  MIN_SPEED,
  MAX_SPEED,
} from '../js/ui.js';
import { t } from '../js/i18n.js';

let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

function relativeClose(actual, expected, tolerance, message) {
  const scale = Math.max(Math.abs(actual), Math.abs(expected), Number.MIN_VALUE);
  assert.ok(Math.abs(actual - expected) <= tolerance * scale,
    `${message}: expected ${expected}, received ${actual}`);
}

console.log('\nUI helper tests');

check('speed slider mapping round-trips across its range', () => {
  for (const speed of [MIN_SPEED, 1 / 24, 1, 7, 30.44, 365.25, MAX_SPEED]) {
    relativeClose(sliderToSpeed(speedToSlider(speed)), speed, 1e-9,
      `round-trip at ${speed} days/s`);
  }
  relativeClose(sliderToSpeed(0), MIN_SPEED, 1e-12, 'slider 0 is real-time');
  relativeClose(sliderToSpeed(1000), MAX_SPEED, 1e-12, 'slider 1000 is max speed');
});

check('safeSourceHref only ever emits http(s) links', () => {
  const BASE = 'https://example.invalid/';
  assert.equal(safeSourceHref('javascript:alert(1)', BASE), '');
  assert.equal(safeSourceHref('data:text/html,<script>1</script>', BASE), '');
  assert.equal(safeSourceHref({ url: 'vbscript:evil' }, BASE), '');
  assert.equal(safeSourceHref({ url: 'ftp://host/file' }, BASE), '');
  assert.equal(safeSourceHref({ url: 'javascript:alert(1)' }, BASE), '');
  assert.equal(safeSourceHref('   ', BASE), '');
  assert.equal(safeSourceHref({}, BASE), '');
  assert.equal(safeSourceHref('https://example.com/paper', BASE),
    'https://example.com/paper');
  assert.equal(safeSourceHref({ href: 'http://mirror.test/x' }, BASE),
    'http://mirror.test/x');
  assert.equal(safeSourceHref({ doi: '10.1088/1538-3873/ad1ba7' }, BASE),
    'https://doi.org/10.1088/1538-3873/ad1ba7');
  assert.equal(safeSourceHref({ doi: 'not-a-doi' }, BASE), '');
  // Bare strings must be absolute; object URLs may resolve against the page
  // base (existing browser behavior, pinned here on purpose).
  assert.equal(safeSourceHref('relative/path', BASE), '');
  assert.equal(safeSourceHref({ url: 'relative/path' }, BASE),
    'https://example.invalid/relative/path');
});

check('fmtSpeed picks the documented unit branches', () => {
  assert.equal(fmtSpeed(100 / 86400), t('realtime'), 'under two minutes/s is real-time');
  assert.ok(fmtSpeed(0.5).endsWith(t('unitHr')), 'sub-day speeds in hours');
  assert.ok(fmtSpeed(13.9).endsWith(t('unitDays')), 'under 14 in days');
  assert.ok(fmtSpeed(14).endsWith(t('unitWeeks')), '14 flips to weeks');
  assert.ok(fmtSpeed(69.9).endsWith(t('unitWeeks')), 'under 70 in weeks');
  assert.ok(fmtSpeed(70).endsWith(t('unitMonths')), '70 flips to months');
  assert.ok(fmtSpeed(699).endsWith(t('unitMonths')), 'under 700 in months');
  assert.ok(fmtSpeed(700).endsWith(t('unitYr')), '700 flips to years');
  assert.ok(fmtSpeed(-700).endsWith(t('unitYr')), 'reverse playback uses magnitude');
});

console.log(`\n  ${passed} passed, 0 failed`);

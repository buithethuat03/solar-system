// Node checks for js/offline_manifest.js (generated file).
// Run: node tools/test_offline_manifest.mjs
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { OFFLINE_ASSETS, OFFLINE_TOTAL_BYTES } from '../js/offline_manifest.js';

const root = fileURLToPath(new URL('..', import.meta.url));
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

console.log('\nOffline manifest tests');

check('every listed asset exists on disk', () => {
  const missing = OFFLINE_ASSETS.filter((p) => {
    try { return !statSync(join(root, p)).isFile(); } catch { return true; }
  });
  assert.deepEqual(missing, [], `missing files: ${missing}`);
});

check('the byte total matches the on-disk sizes (regenerate if stale)', () => {
  const actual = OFFLINE_ASSETS.reduce((sum, p) => sum + statSync(join(root, p)).size, 0);
  assert.equal(actual, OFFLINE_TOTAL_BYTES,
    'run: node tools/generate_offline_manifest.mjs');
});

check('the pack ships the core runtime and no 8K textures', () => {
  assert.ok(OFFLINE_ASSETS.includes('index.html'));
  assert.ok(OFFLINE_ASSETS.includes('js/main.js'));
  assert.ok(OFFLINE_ASSETS.includes('lib/three.module.js'));
  assert.ok(OFFLINE_ASSETS.includes('textures/earth_day.jpg'));
  assert.ok(OFFLINE_ASSETS.includes('models/Voyager.glb'));
  assert.deepEqual(OFFLINE_ASSETS.filter((p) => p.includes('/8k/')), []);
});

console.log(`\n  ${passed} passed, 0 failed`);

// Node checks for the persisted-preferences blob (js/prefs.js).
// Run: node tools/test_prefs.mjs
//
// prefs.js caches at module scope, so each scenario imports a fresh instance
// via a cache-busting query string against a stubbed localStorage.
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const prefsUrl = new URL('../js/prefs.js', import.meta.url).href;
const freshPrefs = (tag) => import(`${prefsUrl}?${tag}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

console.log('\nPrefs tests');

await check('empty storage loads as empty prefs', async () => {
  const { loadPrefs } = await freshPrefs('empty');
  assert.deepEqual(loadPrefs(), {});
});

await check('savePref persists valid keys and drops invalid ones', async () => {
  store.clear();
  const { savePref } = await freshPrefs('save');
  savePref('speed', 12);
  savePref('distanceMode', 'realistic');
  savePref('bloom', false);
  savePref('selectedId', 'saturn');
  savePref('speed', -5);                    // out of range → ignored
  savePref('distanceMode', 'warp');         // unknown mode → ignored
  savePref('selectedId', 'x'.repeat(50));   // over length cap → ignored
  savePref('evil', true);                   // unknown key → ignored
  await sleep(400);                          // past the 250ms debounce
  const blob = JSON.parse(store.get('solar.prefs'));
  assert.equal(blob.v, 1);
  assert.deepEqual(blob.data, {
    speed: 12, distanceMode: 'realistic', bloom: false, selectedId: 'saturn',
  });
});

await check('corrupted blob degrades to defaults without throwing', async () => {
  store.set('solar.prefs', '{not json');
  const { loadPrefs } = await freshPrefs('corrupt');
  assert.deepEqual(loadPrefs(), {});
});

await check('stale schema versions are discarded wholesale', async () => {
  store.set('solar.prefs', JSON.stringify({ v: 0, data: { speed: 5 } }));
  const { loadPrefs } = await freshPrefs('stale');
  assert.deepEqual(loadPrefs(), {});
});

await check('loading whitelists per-key: bad values dropped, good kept', async () => {
  store.set('solar.prefs', JSON.stringify({
    v: 1,
    data: {
      speed: 5,                 // valid
      bloom: false,             // valid
      distanceMode: 'warp',     // invalid enum
      showOrbits: 'yes',        // wrong type
      direction: 0,             // invalid enum
      paused: true,             // valid
      junk: 123,                // unknown key
    },
  }));
  const { loadPrefs } = await freshPrefs('mixed');
  assert.deepEqual(loadPrefs(), { speed: 5, bloom: false, paused: true });
});

console.log(`\n  ${passed} passed, 0 failed`);

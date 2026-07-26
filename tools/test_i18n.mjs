// Node checks for the i18n layer: EN/VI key parity, data-i18n resolution,
// body-glossary coverage, and the language-driven overlay machinery.
// Run: node tools/test_i18n.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { I18N_TABLES } from '../js/i18n.js';
import { BODIES_VI } from '../js/i18n.bodies.js';
import { SUN, PLANETS, MOONS, VOYAGERS, BLACK_HOLES } from '../js/data.js';

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

console.log('\ni18n tests');

const en = I18N_TABLES.en;
const vi = I18N_TABLES.vi;
const ALL_BODIES = [SUN, ...PLANETS, ...MOONS, ...VOYAGERS, ...BLACK_HOLES];

await check('EN and VI string tables carry identical key sets', () => {
  const enKeys = Object.keys(en).sort();
  const viKeys = Object.keys(vi).sort();
  const missingInVi = enKeys.filter((k) => !viKeys.includes(k));
  const missingInEn = viKeys.filter((k) => !enKeys.includes(k));
  assert.deepEqual(missingInVi, [], `keys missing in vi: ${missingInVi}`);
  assert.deepEqual(missingInEn, [], `keys missing in en: ${missingInEn}`);
});

await check('array-valued keys stay parallel between languages', () => {
  for (const [key, value] of Object.entries(en)) {
    if (Array.isArray(value)) {
      assert.ok(Array.isArray(vi[key]), `${key} must also be an array in vi`);
      assert.equal(vi[key].length, value.length, `${key} length differs`);
      assert.ok(value.length > 0, `${key} must not be empty`);
    }
  }
});

await check('placeholders like {pct} survive translation', () => {
  const holes = (text) => (typeof text === 'string' ? (text.match(/\{\w+\}/g) ?? []).sort() : []);
  for (const [key, value] of Object.entries(en)) {
    assert.deepEqual(holes(vi[key]), holes(value), `${key} placeholder mismatch`);
  }
});

await check('every data-i18n attribute in index.html resolves to a key', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-html|-title|-label|-list)?="([^"]+)"/g)]
    .map((m) => m[1]);
  assert.ok(keys.length >= 30, `expected plenty of data-i18n hooks, saw ${keys.length}`);
  const unresolved = keys.filter((k) => !(k in en));
  assert.deepEqual(unresolved, [], `unresolved i18n keys: ${unresolved}`);
});

await check('every body in the dataset has a Vietnamese entry', () => {
  const missing = ALL_BODIES.filter((b) => !BODIES_VI[b.id]).map((b) => b.id);
  assert.deepEqual(missing, [], `bodies without VI translation: ${missing}`);
});

await check('VI body entries are real translations, not copies', () => {
  for (const b of ALL_BODIES) {
    const tr = BODIES_VI[b.id];
    if (b.description && tr.description) {
      assert.notEqual(tr.description, b.description, `${b.id} description is an EN copy`);
    }
    if (b.facts && tr.facts) {
      assert.equal(tr.facts.length, b.facts.length, `${b.id} facts count differs`);
    }
  }
});

await check('the VI overlay applies through the language-driven glossary', async () => {
  // Import a fresh i18n instance that believes the stored language is 'vi'.
  globalThis.localStorage = {
    getItem: (k) => (k === 'solar.lang' ? 'vi' : null),
    setItem: () => {},
  };
  const m = await import(`${new URL('../js/i18n.js', import.meta.url).href}?vi`);
  assert.equal(m.LANG, 'vi');
  const earth = { ...PLANETS.find((p) => p.id === 'earth') };
  earth.info = { ...earth.info };
  m.applyBodyTranslations(null, [earth]);
  assert.equal(earth.name, 'Trái Đất');
  assert.equal(earth.nameEn, 'Earth', 'English name kept for search');
  assert.notEqual(earth.description, PLANETS.find((p) => p.id === 'earth').description);
  assert.ok(m.MONTHS.length === 12 && m.DAYS.length === 7, 'Intl date labels built');
  assert.notDeepEqual(m.MONTHS, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    'VI months must differ from EN');
  delete globalThis.localStorage;
});

await check('unsupported stored languages fall back to English', async () => {
  globalThis.localStorage = {
    getItem: (k) => (k === 'solar.lang' ? 'xx' : null),
    setItem: () => {},
  };
  const m = await import(`${new URL('../js/i18n.js', import.meta.url).href}?xx`);
  assert.equal(m.LANG, 'en');
  assert.equal(m.t('brandTitle'), en.brandTitle);
  delete globalThis.localStorage;
});

console.log(`\n  ${passed} passed, 0 failed`);

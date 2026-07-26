// Star-catalog integrity + colour math. Run: node tools/test_starcatalog.mjs
import assert from 'node:assert/strict';

import { STARS, STAR_STRIDE, STAR_COUNT } from '../js/starcatalog.js';
import { bvToTemperature, bvToRGB, magToBrightness } from '../js/astro-math.js';

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

const star = (hr) => {
  for (let i = 0; i < STAR_COUNT; i++) {
    if (STARS[i * STAR_STRIDE] === hr) {
      const o = i * STAR_STRIDE;
      return { hr, ra: STARS[o + 1], dec: STARS[o + 2], v: STARS[o + 3], bv: STARS[o + 4] };
    }
  }
  return null;
};

console.log('\nStar catalog tests');

check('catalog is complete and well-formed', () => {
  assert.ok(STAR_COUNT >= 8000 && STAR_COUNT <= 9500, `count ${STAR_COUNT}`);
  assert.equal(STARS.length, STAR_COUNT * STAR_STRIDE);
  for (let i = 0; i < STAR_COUNT; i++) {
    const o = i * STAR_STRIDE;
    assert.ok(STARS[o + 1] >= 0 && STARS[o + 1] < 360, `RA in range (row ${i})`);
    assert.ok(STARS[o + 2] >= -90 && STARS[o + 2] <= 90, `Dec in range (row ${i})`);
    assert.ok(STARS[o + 3] <= 6.5, `Vmag cut (row ${i})`);
  }
});

check('the bright anchors are present at their J2000 places', () => {
  const sirius = star(2491);
  assert.ok(sirius, 'Sirius (HR 2491)');
  assert.ok(Math.abs(sirius.ra - 101.287) < 0.02 && Math.abs(sirius.dec + 16.716) < 0.02);
  assert.ok(Math.abs(sirius.v + 1.46) < 0.02, 'Sirius is the brightest star');
  const betelgeuse = star(2061);
  assert.ok(betelgeuse && betelgeuse.bv > 1.4, 'Betelgeuse is red (B−V > 1.4)');
  const rigel = star(1713);
  assert.ok(rigel && rigel.bv < 0.1, 'Rigel is blue-white');
});

check('colour and flux math behave physically', () => {
  assert.ok(bvToTemperature(-0.3) > 10000, 'early types are hot');
  assert.ok(bvToTemperature(1.5) < 4500, 'late types are cool');
  const blue = bvToRGB(-0.3);
  const red = bvToRGB(1.5);
  assert.ok(blue[2] > blue[0], 'negative B−V renders blue-ish');
  assert.ok(red[0] > red[2], 'large B−V renders red-ish');
  const ratio = magToBrightness(0) / magToBrightness(5);
  assert.ok(Math.abs(ratio - 100) < 1e-9, 'five magnitudes = 100x flux');
});

console.log(`\n  ${passed} passed, 0 failed`);

// Numerical validation of the rebuilt Voyager trajectory model.
// Imports the REAL voyagerState() from kepler.js (Node-safe: kepler.js only
// pulls in pure data modules). Run: node tools/test_voyager.mjs
import { voyagerState, daysSinceJ2000 } from '../js/kepler.js';
import { VOYAGERS } from '../js/data.js';
import { VOYAGER_EPHEM } from '../js/voyager_ephem.js';

const V1 = VOYAGERS.find(v => v.id === 'voyager1');
const V2 = VOYAGERS.find(v => v.id === 'voyager2');
const D = (iso) => daysSinceJ2000(new Date(iso + 'T00:00:00Z'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  (cond ? (pass++, console.log(`  ✅ ${name}${detail ? '  — ' + detail : ''}`))
        : (fail++, console.log(`  ❌ ${name}${detail ? '  — ' + detail : ''}`)));
}

console.log('\n=== 1. Hidden before launch ===');
check('V1 null at 1977-01-01', voyagerState(V1, D('1977-01-01')) === null);
check('V2 null at 1977-01-01', voyagerState(V2, D('1977-01-01')) === null);
check('V1 null one day before launch', voyagerState(V1, D('1977-09-04')) === null);
check('V2 null one day before launch', voyagerState(V2, D('1977-08-19')) === null);

console.log('\n=== 2. Starts at Earth (~1 AU) at launch ===');
for (const [v, iso, name] of [[V1, '1977-09-06', 'V1'], [V2, '1977-08-21', 'V2']]) {
  const s = voyagerState(v, D(iso));
  check(`${name} exists just after launch`, !!s);
  check(`${name} r ≈ 1 AU at launch`, s && Math.abs(s.distAU - 1) < 0.05, s && `r=${s.distAU.toFixed(3)} AU`);
}

console.log('\n=== 3. Passes the planets at the encounter dates ===');
const ENC = [
  [V1, '1979-03-05', 5.20, 'V1·Jupiter'],
  [V1, '1980-11-12', 9.54, 'V1·Saturn'],
  [V2, '1979-07-09', 5.20, 'V2·Jupiter'],
  [V2, '1981-08-26', 9.54, 'V2·Saturn'],
  [V2, '1986-01-24', 19.2, 'V2·Uranus'],
  [V2, '1989-08-25', 30.1, 'V2·Neptune'],
];
for (const [v, iso, rPlanet, name] of ENC) {
  const s = voyagerState(v, D(iso));
  check(`${name} near ${rPlanet} AU`, s && Math.abs(s.distAU - rPlanet) < 1.2, s && `r=${s.distAU.toFixed(2)} AU`);
}

console.log('\n=== 4. Hermite passes exactly through tabulated samples ===');
for (const [v, name] of [[V1, 'V1'], [V2, 'V2']]) {
  const S = VOYAGER_EPHEM[v.id].samples;
  const smp = S[Math.floor(S.length / 2)];        // a mid-table control point
  const s = voyagerState(v, smp[0]);
  // Recover ecliptic coords from scene mapping (x, y=z_ecl, z=-y_ecl).
  const xe = s.x, ye = -s.z, ze = s.y;
  const err = Math.hypot(xe - smp[1], ye - smp[2], ze - smp[3]);
  check(`${name} interpolation hits control point`, err < 1e-6, `err=${err.toExponential(2)} AU`);
}

console.log('\n=== 5. Present day (2026-06-17) sane distances & speeds ===');
const today = D('2026-06-17');
const s1 = voyagerState(V1, today), s2 = voyagerState(V2, today);
check('V1 distance 160–175 AU', s1.distAU > 160 && s1.distAU < 175, `r=${s1.distAU.toFixed(1)} AU`);
check('V1 speed 15–18 km/s', s1.speedKms > 15 && s1.speedKms < 18, `${s1.speedKms.toFixed(1)} km/s`);
check('V2 distance 130–145 AU', s2.distAU > 130 && s2.distAU < 145, `r=${s2.distAU.toFixed(1)} AU`);
check('V2 speed 14–17 km/s', s2.speedKms > 14 && s2.speedKms < 17, `${s2.speedKms.toFixed(1)} km/s`);
check('V1 farther than V2 (most distant object)', s1.distAU > s2.distAU);

console.log('\n=== 6. Monotonic outward + future extrapolation continuity ===');
for (const [v, name] of [[V1, 'V1'], [V2, 'V2']]) {
  let mono = true, prev = -1;
  for (const iso of ['1990-01-01', '2000-01-01', '2012-01-01', '2026-01-01', '2040-01-01', '2055-01-01', '2080-01-01', '2120-01-01']) {
    const r = voyagerState(v, D(iso)).distAU;
    if (r < prev) mono = false;
    prev = r;
  }
  check(`${name} distance increases monotonically to 2120`, mono);
  // Continuity across the table→linear boundary t1.
  const t1 = VOYAGER_EPHEM[v.id].t1;
  const a = voyagerState(v, t1 - 0.001).distAU, b = voyagerState(v, t1 + 0.001).distAU;
  check(`${name} continuous at table end`, Math.abs(a - b) < 1e-3, `Δ=${Math.abs(a - b).toExponential(2)} AU`);
}

console.log('\n=== 7. V2 ends south of the ecliptic (Neptune bent it down) ===');
// In scene axes y = z_ecliptic; the Neptune flyby drives V2 to large negative z_ecliptic.
const v2late = voyagerState(V2, D('2026-06-17'));
check('V2 well below the ecliptic plane', v2late.y < 0, `z_ecl(scene y)=${v2late.y.toFixed(1)} AU`);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail ? 1 : 0);

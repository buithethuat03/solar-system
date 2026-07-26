// ============================================================================
//  permalink.js — shareable URL-hash state.
//
//  Schema (all optional):  #b=<bodyId>&d=YYYY-MM-DD&m=v|r|a&l=olmdsbkg
//                          &s=<daysPerSec>&p=1&dbg=1
//  l-flags: o orbits, l labels, m moons, d dwarfs, s spacecraft,
//           b black holes, k belts, g bloom (missing flag = off).
//  Hash state wins over saved prefs; applying a link never writes prefs.
//
//  Pure helpers are exported for tools/test_ui.mjs.
// ============================================================================

const MODES = { v: 'visual', r: 'realistic', a: 'accurate' };
const MODE_CODES = { visual: 'v', realistic: 'r', accurate: 'a' };
const LAYERS = [
  ['o', 'showOrbits'], ['l', 'showLabels'], ['m', 'showMoons'],
  ['d', 'showDwarfs'], ['s', 'showSpacecraft'], ['b', 'showBlackHoles'],
  ['k', 'showBelts'], ['g', 'bloom'],
];

export function parseHash(hash) {
  const out = {};
  const text = (hash || '').replace(/^#/, '');
  if (!text) return out;
  const params = new URLSearchParams(text);
  const body = params.get('b');
  if (body && /^[\w-]{1,40}$/.test(body)) out.body = body;
  const date = params.get('d');
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parsed = Date.parse(`${date}T00:00:00Z`);
    if (Number.isFinite(parsed)) out.date = date;
  }
  if (params.get('m') in MODES) out.mode = MODES[params.get('m')];
  const layers = params.get('l');
  if (layers !== null && /^[olmdsbkg]*$/.test(layers)) {
    out.layers = {};
    for (const [code, key] of LAYERS) out.layers[key] = layers.includes(code);
  }
  const speed = Number(params.get('s'));
  if (Number.isFinite(speed) && speed > 0 && speed <= 3650) out.speed = speed;
  if (params.get('p') === '1') out.paused = true;
  if (params.get('dbg') === '1') out.debug = true;
  return out;
}

export function serializeState(state, selectedId) {
  const params = new URLSearchParams();
  if (selectedId) params.set('b', selectedId);
  const date = new Date((state.simDays + 10957.5) * 86400000);
  if (!Number.isNaN(date.getTime())) params.set('d', date.toISOString().slice(0, 10));
  params.set('m', MODE_CODES[state.distanceMode] ?? 'v');
  params.set('l', LAYERS.filter(([, key]) => state[key]).map(([c]) => c).join(''));
  params.set('s', String(+state.speed.toPrecision(4)));
  if (state.paused) params.set('p', '1');
  return params.toString();
}

let writeTimer = null;

/** Throttled, history-friendly hash update (never pushes history entries). */
export function scheduleHashWrite(state, selectedId) {
  if (typeof window === 'undefined' || writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const hash = '#' + serializeState(state, selectedId);
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash);
    }
  }, 600);
}

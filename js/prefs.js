// ============================================================================
//  prefs.js — persisted view settings (single versioned localStorage blob).
//
//  Every value passes a whitelist validator on load, so a corrupted or stale
//  blob degrades to defaults instead of breaking boot. simDays is deliberately
//  NOT persisted — the app always boots at "now".
//
//  Node-safe (no localStorage → no-ops); tested by tools/test_prefs.mjs.
// ============================================================================

const KEY = 'solar.prefs';
const VERSION = 1;
const DEBOUNCE_MS = 250;

const VALIDATORS = {
  showOrbits: v => typeof v === 'boolean',
  showLabels: v => typeof v === 'boolean',
  showBelts: v => typeof v === 'boolean',
  showMoons: v => typeof v === 'boolean',
  showDwarfs: v => typeof v === 'boolean',
  showSpacecraft: v => typeof v === 'boolean',
  showBlackHoles: v => typeof v === 'boolean',
  bloom: v => typeof v === 'boolean',
  paused: v => typeof v === 'boolean',
  distanceMode: v => v === 'visual' || v === 'realistic' || v === 'accurate',
  speed: v => typeof v === 'number' && v > 0 && v <= 3650,
  direction: v => v === 1 || v === -1,
  selectedId: v => typeof v === 'string' && v.length <= 40,
};

const hasStorage = typeof localStorage !== 'undefined';
let cache = null;
let timer = null;

export function loadPrefs() {
  if (cache) return cache;
  cache = {};
  if (!hasStorage) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && raw.v === VERSION && raw.data && typeof raw.data === 'object') {
      for (const [key, value] of Object.entries(raw.data)) {
        if (VALIDATORS[key]?.(value)) cache[key] = value;
      }
    }
  } catch { /* corrupted blob → defaults */ }
  return cache;
}

function flush() {
  timer = null;
  if (!hasStorage) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, data: cache }));
  } catch { /* quota/private mode: persistence silently off */ }
}

export function savePref(key, value) {
  if (!VALIDATORS[key]?.(value)) return;
  loadPrefs();
  cache[key] = value;
  if (!timer && hasStorage) timer = setTimeout(flush, DEBOUNCE_MS);
}

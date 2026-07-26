import assert from 'node:assert/strict';
import { bindFullscreenToggle } from '../js/fullscreen.js';

// Counted wrappers so the final summary reflects reality instead of a literal.
let passed = 0;
const eq = (actual, expected, message) => { assert.equal(actual, expected, message); passed++; };
const deepEq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); passed++; };

class EventTargetMock {
  listeners = new Map();

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(h => h !== handler));
  }

  async dispatch(type) {
    await Promise.all((this.listeners.get(type) || []).map(handler => handler()));
  }
}

class ClassListMock {
  values = new Set();
  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }
  contains(name) { return this.values.has(name); }
}

function fixture({ rejectRequest = false } = {}) {
  const toggle = new EventTargetMock();
  toggle.checked = false;
  const body = { classList: new ClassListMock() };
  const doc = new EventTargetMock();
  doc.body = body;
  doc.fullscreenElement = null;
  doc.exitFullscreen = async () => {
    doc.fullscreenElement = null;
    await doc.dispatch('fullscreenchange');
  };
  const root = {
    requestFullscreen: async () => {
      if (rejectRequest) throw new Error('blocked');
      doc.fullscreenElement = root;
      await doc.dispatch('fullscreenchange');
    },
  };
  doc.documentElement = root;
  return { toggle, body, doc, root };
}

console.log('Fullscreen UI tests');

{
  const { toggle, body, doc, root } = fixture();
  const settings = { showOrbits: false, distanceMode: 'accurate', bloom: true };
  const snapshot = structuredClone(settings);
  let beforeEnterCalls = 0;
  const cleanup = bindFullscreenToggle(toggle, {
    document: doc, root, body, beforeEnter: () => { beforeEnterCalls++; },
  });

  eq(toggle.checked, false, 'starts outside fullscreen');
  toggle.checked = true;
  await toggle.dispatch('change');
  eq(doc.fullscreenElement, root, 'requests fullscreen for the page root');
  eq(body.classList.contains('fullscreen-mode'), true, 'hides the UI in fullscreen');
  eq(beforeEnterCalls, 1, 'closes the View popover before entering');

  doc.fullscreenElement = null;
  await doc.dispatch('fullscreenchange');
  eq(toggle.checked, false, 'syncs when Esc exits browser fullscreen');
  eq(body.classList.contains('fullscreen-mode'), false, 'restores the UI after exit');
  deepEq(settings, snapshot, 'does not mutate existing View settings');
  cleanup();
}

{
  const { toggle, body, doc, root } = fixture({ rejectRequest: true });
  const originalWarn = console.warn;
  console.warn = () => {};
  bindFullscreenToggle(toggle, { document: doc, root, body });
  toggle.checked = true;
  await toggle.dispatch('change');
  console.warn = originalWarn;
  eq(toggle.checked, false, 'reverts the toggle when fullscreen is blocked');
  eq(body.classList.contains('fullscreen-mode'), false, 'keeps the UI visible on failure');
}

console.log(`  ${passed} passed, 0 failed`);

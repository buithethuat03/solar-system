// Keep browser fullscreen and the distraction-free UI in sync. This module is
// separate from simulation state so entering/exiting cannot alter View options.
export function bindFullscreenToggle(toggle, options = {}) {
  if (!toggle) return () => {};

  const doc = options.document || document;
  const root = options.root || doc.documentElement;
  const body = options.body || doc.body;
  const beforeEnter = options.beforeEnter || (() => {});

  const sync = () => {
    const active = Boolean(doc.fullscreenElement);
    body.classList.toggle('fullscreen-mode', active);
    toggle.checked = active;
  };

  const onToggle = async () => {
    try {
      if (toggle.checked) {
        beforeEnter();
        await root.requestFullscreen();
      } else if (doc.fullscreenElement) {
        await doc.exitFullscreen();
      }
    } catch (error) {
      console.warn('Fullscreen request failed:', error);
    } finally {
      sync();
    }
  };

  toggle.addEventListener('change', onToggle);
  doc.addEventListener('fullscreenchange', sync);
  doc.addEventListener('fullscreenerror', sync);
  sync();

  return () => {
    toggle.removeEventListener('change', onToggle);
    doc.removeEventListener('fullscreenchange', sync);
    doc.removeEventListener('fullscreenerror', sync);
  };
}

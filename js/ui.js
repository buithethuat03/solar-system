// ============================================================================
//  ui.js  —  Builds the body navigator and binds all on-screen controls.
// ============================================================================
import { t, MONTHS, DAYS } from './i18n.js';

const $ = (id) => document.getElementById(id);

function fmtDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function fmtSpeed(v) {
  const av = Math.abs(v);
  if (av * 86400 < 120) return t('realtime');
  if (av < 1) return (av * 24).toFixed(1) + ' ' + t('unitHr');
  if (av < 14) return av.toFixed(1) + ' ' + t('unitDays');
  if (av < 70) return (av / 7).toFixed(1) + ' ' + t('unitWeeks');
  if (av < 700) return (av / 30.44).toFixed(1) + ' ' + t('unitMonths');
  return (av / 365.25).toFixed(2) + ' ' + t('unitYr');
}

// Logarithmic speed slider mapping (slider 0..1000  <->  days/sec).
const MIN_SPEED = 1 / 86400;     // ~ real-time
const MAX_SPEED = 3650;          // ~ 10 years / second
const sliderToSpeed = (t) => MIN_SPEED * Math.pow(MAX_SPEED / MIN_SPEED, t / 1000);
const speedToSlider = (v) => 1000 * Math.log(v / MIN_SPEED) / Math.log(MAX_SPEED / MIN_SPEED);

const PRESETS = [
  { label: t('preRealtime'), days: MIN_SPEED },
  { label: t('pre1hr'), days: 1 / 24 },
  { label: t('pre1day'), days: 1 },
  { label: t('pre1wk'), days: 7 },
  { label: t('pre1mo'), days: 30.44 },
  { label: t('pre1yr'), days: 365.25 },
];

export function initUI(controller) {
  const s = controller.state;
  let following = false;

  // ---- Build the body navigator -----------------------------------------
  const list = $('body-list');
  function addGroup(title) {
    const h = document.createElement('div');
    h.className = 'nav-group';
    h.textContent = title;
    list.appendChild(h);
    return h;
  }
  function addItem(body, kind, cls) {
    const item = document.createElement('button');
    item.className = 'nav-item ' + (cls || '');
    item.dataset.id = body.id;
    const dot = document.createElement('span');
    dot.className = 'nav-dot';
    dot.style.background = '#' + (body.color ?? 0x888888).toString(16).padStart(6, '0');
    const name = document.createElement('span');
    name.textContent = body.name;
    item.append(dot, name);
    item.addEventListener('click', () => controller.focusById(body.id));
    list.appendChild(item);
    return item;
  }

  addGroup(t('navStar'));
  addItem(controller.bodies.sun, 'sun', 'is-sun');
  addGroup(t('navPlanets'));
  controller.bodies.planets.filter(p => !p.isDwarf).forEach(p => addItem(p, 'planet'));
  addGroup(t('navDwarfs'));
  controller.bodies.planets.filter(p => p.isDwarf).forEach(p => addItem(p, 'planet', 'is-dwarf'));
  addGroup(t('navMoons'));
  controller.bodies.moons.forEach(m => addItem(m, 'moon', 'is-moon'));
  // Spacecraft live only in the true-scale views, so the whole group is hidden in
  // the compressed view (and revealed by setSpacecraftNavVisible on a mode switch).
  const spacecraftNavEls = [];
  if (controller.bodies.voyagers && controller.bodies.voyagers.length) {
    spacecraftNavEls.push(addGroup(t('navSpacecraft')));
    controller.bodies.voyagers.forEach(v => spacecraftNavEls.push(addItem(v, 'spacecraft', 'is-spacecraft')));
    const scOn = s.distanceMode !== 'visual';
    spacecraftNavEls.forEach(el => { if (el) el.style.display = scOn ? '' : 'none'; });
  }

  // ---- Time controls ----------------------------------------------------
  const playBtn = $('btn-play');
  const revBtn = $('btn-reverse');
  const slider = $('speed-slider');
  const readout = $('speed-readout');

  function refreshPlay() { playBtn.innerHTML = s.paused ? '▶' : '❚❚'; playBtn.title = s.paused ? t('play') : t('pause'); }
  playBtn.addEventListener('click', () => { controller.togglePause(!s.paused); refreshPlay(); });
  refreshPlay();

  revBtn.title = t('reverseTitle');
  revBtn.addEventListener('click', () => {
    controller.setDirection(s.direction === 1 ? -1 : 1);
    revBtn.classList.toggle('active', s.direction === -1);
    revBtn.title = s.direction === -1 ? t('playingBack') : t('playingFwd');
    refreshSpeed();
  });

  slider.min = 0; slider.max = 1000; slider.step = 1;
  slider.value = Math.max(0, Math.min(1000, speedToSlider(s.speed)));
  function refreshSpeed() { readout.textContent = (s.direction === -1 ? '◄ ' : '') + fmtSpeed(s.speed); }
  slider.addEventListener('input', () => {
    controller.setSpeed(sliderToSpeed(+slider.value));
    refreshSpeed();
  });
  refreshSpeed();

  // speed presets
  const presetWrap = $('speed-presets');
  PRESETS.forEach(p => {
    const b = document.createElement('button');
    b.className = 'preset';
    b.textContent = p.label;
    b.addEventListener('click', () => {
      controller.setSpeed(p.days);
      slider.value = Math.max(0, Math.min(1000, speedToSlider(p.days)));
      refreshSpeed();
      if (s.paused) { controller.togglePause(false); refreshPlay(); }
    });
    presetWrap.appendChild(b);
  });

  $('btn-now').addEventListener('click', () => controller.goToNow());
  const dateInput = $('date-input');
  if (dateInput) dateInput.addEventListener('change', () => {
    if (dateInput.value) controller.setDate(new Date(dateInput.value + 'T00:00:00Z'));
  });

  // ---- View toggles -----------------------------------------------------
  const bind = (id, key) => {
    const el = $(id); if (!el) return;
    el.checked = s[key];
    el.addEventListener('change', () => controller.setToggle(key, el.checked));
  };
  bind('tg-orbits', 'showOrbits');
  bind('tg-labels', 'showLabels');
  bind('tg-belts', 'showBelts');
  bind('tg-moons', 'showMoons');
  bind('tg-dwarfs', 'showDwarfs');
  bind('tg-spacecraft', 'showSpacecraft');

  const bloomTg = $('tg-bloom');
  if (bloomTg) { bloomTg.checked = s.bloom; bloomTg.addEventListener('change', () => controller.setBloom(bloomTg.checked)); }

  const distSel = $('dist-mode');
  if (distSel) { distSel.value = s.distanceMode; distSel.addEventListener('change', () => controller.setDistanceMode(distSel.value)); }

  // Texture quality: persist the choice and reload, which replays the normal
  // loading-screen animation while the chosen 2K/8K set downloads.
  const texSel = $('tex-res');
  if (texSel) {
    texSel.value = (localStorage.getItem('solar.texRes') === '8k') ? '8k' : '2k';
    texSel.addEventListener('change', () => {
      localStorage.setItem('solar.texRes', texSel.value);
      // Re-show the loading overlay right away for instant feedback, then reload.
      const le = $('loading'), lt = $('loading-text'), lb = $('loading-bar');
      if (le) le.classList.remove('hidden');
      if (lb) lb.style.width = '0%';
      if (lt) lt.textContent = t('loadingTextures') + ' 0%';
      setTimeout(() => location.reload(), 50);
    });
  }

  $('btn-reset-view').addEventListener('click', () => controller.resetView());

  // Language: persist + reload so all content rebuilds in the chosen language.
  const langSel = $('lang-sel');
  if (langSel) {
    langSel.value = (localStorage.getItem('solar.lang') === 'vi') ? 'vi' : 'en';
    langSel.addEventListener('change', () => {
      localStorage.setItem('solar.lang', langSel.value);
      location.reload();
    });
  }

  // ---- Info panel -------------------------------------------------------
  const focusBtn = $('btn-focus');
  focusBtn.textContent = t('focusFollow');   // localise the default label
  focusBtn.addEventListener('click', () => {
    if (following) controller.stopFollow();
    else controller.focusSelected();
  });

  // ---- View options popover ---------------------------------------------
  const viewBtn = $('btn-view'), togglesPanel = $('toggles');
  if (viewBtn) viewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglesPanel.classList.toggle('hidden');
    viewBtn.classList.toggle('active', !togglesPanel.classList.contains('hidden'));
  });
  // Capture phase so a 3D label's stopPropagation can't keep the popover open.
  document.addEventListener('pointerdown', (e) => {
    if (!togglesPanel.classList.contains('hidden') &&
        !togglesPanel.contains(e.target) && e.target !== viewBtn) {
      togglesPanel.classList.add('hidden'); viewBtn.classList.remove('active');
    }
  }, true);

  // ---- Help panel -------------------------------------------------------
  const helpBtn = $('btn-help'), helpPanel = $('help-panel');
  if (helpBtn) helpBtn.addEventListener('click', () => helpPanel.classList.toggle('hidden'));
  const helpClose = $('btn-help-close');
  if (helpClose) helpClose.addEventListener('click', () => helpPanel.classList.add('hidden'));

  // ---- Collapse panels on small screens ---------------------------------
  const navToggle = $('btn-nav-toggle');
  if (navToggle) navToggle.addEventListener('click', () => $('nav-panel').classList.toggle('collapsed'));

  // Info panel collapse/expand (mirrors the EXPLORE panel's toggle).
  const infoToggle = $('btn-info-toggle');
  if (infoToggle) infoToggle.addEventListener('click', () => {
    const collapsed = $('info-panel').classList.toggle('collapsed');
    infoToggle.title = collapsed ? t('expand') : t('collapse');
  });

  // =======================================================================
  //  Public display API
  // =======================================================================
  return {
    showInfo(ref, kind) {
      const typeLabel = ref.type || (kind === 'moon' ? t('typeMoon') : kind === 'sun' ? t('typeStar') : '');
      $('info-name').textContent = ref.name;
      $('info-type').textContent = typeLabel;
      $('info-desc').textContent = ref.description || '';

      const table = $('info-table');
      table.innerHTML = '';
      const info = ref.info || {};
      for (const [k, v] of Object.entries(info)) {
        const row = document.createElement('div'); row.className = 'info-row';
        const a = document.createElement('span'); a.className = 'k'; a.textContent = k;
        const b = document.createElement('span'); b.className = 'v'; b.textContent = v;
        row.append(a, b); table.appendChild(row);
      }

      const facts = $('info-facts');
      facts.innerHTML = '';
      (ref.facts || []).forEach(f => {
        const li = document.createElement('li'); li.textContent = f; facts.appendChild(li);
      });
      $('info-facts-wrap').style.display = (ref.facts && ref.facts.length) ? '' : 'none';

      // Selecting a body always reveals its full details (expand if collapsed).
      const panel = $('info-panel');
      panel.classList.remove('hidden');
      panel.classList.remove('collapsed');
      const it = $('btn-info-toggle'); if (it) it.title = t('collapse');
    },

    highlight(id) {
      document.querySelectorAll('.nav-item').forEach(el =>
        el.classList.toggle('active', el.dataset.id === id));
    },

    // Show/hide the whole "Spacecraft" navigator group (true-scale views only).
    setSpacecraftNavVisible(on) {
      spacecraftNavEls.forEach(el => { if (el) el.style.display = on ? '' : 'none'; });
    },

    setFollowing(on) {
      following = on;
      focusBtn.textContent = on ? t('stopFollowing') : t('focusFollow');
      focusBtn.classList.toggle('active', on);
    },

    setPaused(p) { refreshPlay(); },

    // Disable/restore the Orbit-paths toggle (used by the Accurate mode).
    lockOrbits(locked) {
      const el = $('tg-orbits'); if (!el) return;
      el.disabled = locked;
      el.checked = locked ? false : s.showOrbits;
      const row = el.closest('.switch'); if (row) row.classList.toggle('disabled', locked);
    },
    // Show/hide the "LIVE" badge and the distance-mode hint line.
    setLive(on, hint) {
      const live = $('hud-live');
      if (live) { live.textContent = on ? t('live') : ''; live.style.display = on ? '' : 'none'; }
      const h = $('dist-hint'); if (h) h.textContent = hint || '';
    },

    setHUD({ date, fps, following: who }) {
      $('sim-date').textContent = fmtDate(date);
      const f = $('hud-fps'); if (f) f.textContent = fps + ' ' + t('fps');
      const fol = $('hud-follow');
      if (fol) { fol.textContent = who ? '⌖ ' + t('following') + ' ' + who : ''; fol.style.display = who ? '' : 'none'; }
    },
  };
}

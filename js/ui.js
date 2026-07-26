// ============================================================================
//  ui.js  —  Builds the body navigator and binds all on-screen controls.
// ============================================================================
import { t, LANG, MONTHS, DAYS } from './i18n.js';
import { bindFullscreenToggle } from './fullscreen.js';
import { deriveBlackHoleSystem } from './blackhole-physics.js';

const $ = (id) => document.getElementById(id);

// Pure helpers live at module scope (and are exported) so the Node test
// suite can exercise them without a DOM.
export function safeSourceHref(source, base = (typeof document !== 'undefined'
  ? document.baseURI
  : 'https://example.invalid/')) {
  let candidate = '';
  if (typeof source === 'string') {
    if (/^https?:\/\//i.test(source.trim())) candidate = source.trim();
  } else {
    candidate = source.url ?? source.href ?? source.link ?? '';
    if (!candidate && typeof source.doi === 'string' && /^10\.\d{4,9}\//.test(source.doi)) {
      candidate = `https://doi.org/${source.doi}`;
    }
  }
  if (!candidate) return '';
  try {
    const url = new URL(candidate, base);
    return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : '';
  } catch {
    return '';
  }
}

export function fmtDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function fmtSpeed(v) {
  const av = Math.abs(v);
  if (av * 86400 < 120) return t('realtime');
  if (av < 1) return (av * 24).toFixed(1) + ' ' + t('unitHr');
  if (av < 14) return av.toFixed(1) + ' ' + t('unitDays');
  if (av < 70) return (av / 7).toFixed(1) + ' ' + t('unitWeeks');
  if (av < 700) return (av / 30.44).toFixed(1) + ' ' + t('unitMonths');
  return (av / 365.25).toFixed(2) + ' ' + t('unitYr');
}

// Logarithmic speed slider mapping (slider 0..1000  <->  days/sec).
export const MIN_SPEED = 1 / 86400;     // ~ real-time
export const MAX_SPEED = 3650;          // ~ 10 years / second
export const sliderToSpeed = (t) => MIN_SPEED * Math.pow(MAX_SPEED / MIN_SPEED, t / 1000);
export const speedToSlider = (v) => 1000 * Math.log(v / MIN_SPEED) / Math.log(MAX_SPEED / MIN_SPEED);

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
  // Type-ahead filter over the navigator. Matches the localized name, the
  // English name (kept by applyBodyTranslations) and the id, so both
  // "Sao Kim" and "Venus" find the same row under either language.
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.id = 'nav-search';
  searchInput.placeholder = t('searchPlaceholder');
  searchInput.setAttribute('aria-label', t('searchPlaceholder'));
  $('nav-panel').querySelector('.panel-head')?.after(searchInput);
  function applySearch() {
    const q = searchInput.value.trim().toLowerCase();
    let group = null;
    let groupHasHit = false;
    const flushGroup = () => { if (group) group.hidden = !groupHasHit && q !== ''; };
    for (const el of list.children) {
      if (el.classList.contains('nav-group')) {
        flushGroup();
        group = el; groupHasHit = false;
        continue;
      }
      const hit = q === '' || (el.dataset.search ?? '').includes(q);
      el.hidden = !hit;
      if (hit) groupHasHit = true;
    }
    flushGroup();
  }
  searchInput.addEventListener('input', applySearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = list.querySelector('.nav-item:not([hidden])');
      if (first) controller.focusById(first.dataset.id);
    } else if (e.key === 'Escape') {
      searchInput.value = ''; applySearch(); searchInput.blur();
      e.stopPropagation();
    }
  });

  function addItem(body, kind, cls) {
    const item = document.createElement('button');
    item.className = 'nav-item ' + (cls || '');
    item.dataset.id = body.id;
    item.dataset.kind = kind;
    const dot = document.createElement('span');
    dot.className = 'nav-dot';
    dot.style.background = '#' + (body.color ?? 0x888888).toString(16).padStart(6, '0');
    const name = document.createElement('span');
    name.textContent = body.name;
    item.append(dot, name);
    item.dataset.search = [body.name, body.nameEn ?? '', body.id].join(' ').toLowerCase();
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
  if (controller.bodies.blackHoles && controller.bodies.blackHoles.length) {
    addGroup(t('navBlackHoles'));
    controller.bodies.blackHoles.forEach(b => addItem(b, 'black-hole', 'is-black-hole'));
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
  bind('tg-black-holes', 'showBlackHoles');

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
    langSel.value = LANG;
    langSel.addEventListener('change', () => {
      localStorage.setItem('solar.lang', langSel.value);
      location.reload();
    });
  }

  // ---- Info panel -------------------------------------------------------
  // On phones the panel becomes a bottom sheet; dragging its handle down
  // dismisses it (the handle is display:none on desktop, so this stays inert).
  const sheetHandle = document.querySelector('#info-panel .sheet-handle');
  if (sheetHandle) {
    let dragStartY = null;
    sheetHandle.addEventListener('pointerdown', (e) => {
      dragStartY = e.clientY;
      sheetHandle.setPointerCapture(e.pointerId);
    });
    sheetHandle.addEventListener('pointermove', (e) => {
      if (dragStartY !== null && e.clientY - dragStartY > 60) {
        dragStartY = null;
        $('info-panel').classList.add('hidden');
      }
    });
    sheetHandle.addEventListener('pointerup', () => { dragStartY = null; });
  }

  const focusBtn = $('btn-focus');
  focusBtn.textContent = t('focusFollow');   // localise the default label
  focusBtn.addEventListener('click', () => {
    if (following) controller.stopFollow();
    else controller.focusSelected();
  });

  // ---- View options popover ---------------------------------------------
  const viewBtn = $('btn-view'), togglesPanel = $('toggles');
  const closeViewPopover = () => {
    togglesPanel.classList.add('hidden');
    viewBtn.classList.remove('active');
  };
  if (viewBtn) viewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglesPanel.classList.toggle('hidden');
    viewBtn.classList.toggle('active', !togglesPanel.classList.contains('hidden'));
  });
  bindFullscreenToggle($('tg-fullscreen'), { beforeEnter: closeViewPopover });
  // Capture phase so a 3D label's stopPropagation can't keep the popover open.
  document.addEventListener('pointerdown', (e) => {
    if (!togglesPanel.classList.contains('hidden') &&
        !togglesPanel.contains(e.target) && e.target !== viewBtn) {
      closeViewPopover();
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
  function provenanceLabel(value) {
    if (typeof value !== 'string') return null;
    const key = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (['measured', 'measurement', 'observed', 'observation'].includes(key)) return { key: 'measured', text: t('evidenceMeasured') };
    if (['derived', 'inferred', 'calculated', 'computed'].includes(key)) return { key: 'derived', text: t('evidenceDerived') };
    if (['assumed', 'assumption', 'model', 'model-assumption', 'hypothetical'].includes(key)) return { key: 'model', text: t('evidenceModel') };
    return null;
  }

  function appendProvenanceBadge(parent, value) {
    const label = provenanceLabel(value);
    if (!label) return;
    const badge = document.createElement('small');
    badge.className = 'info-provenance info-provenance-' + label.key;
    badge.textContent = label.text;
    parent.appendChild(badge);
  }

  function infoValueParts(raw) {
    if (raw == null) return { text: '—', provenance: '' };
    if (Array.isArray(raw)) return { text: raw.join(', '), provenance: '' };
    if (typeof raw !== 'object') return { text: String(raw), provenance: '' };

    const provenance = raw.provenance ?? raw.evidence ?? raw.category ?? raw.status ?? raw.kind ?? '';
    if (raw.display != null) return { text: String(raw.display), provenance };
    if (raw.text != null) return { text: String(raw.text), provenance };

    let value = raw.value ?? raw.nominal ?? raw.label;
    if (value && typeof value === 'object') {
      const nested = value;
      value = nested.value ?? nested.nominal ?? nested.text ?? nested.display;
    }
    if (value == null) {
      try { value = JSON.stringify(raw); } catch { value = '—'; }
    }
    let text = String(value);
    const uncertainty = raw.uncertainty ?? raw.error ?? raw.sigma;
    if (uncertainty != null && uncertainty !== '') text += ` ± ${uncertainty}`;
    const units = {
      deg: '°', 'solar-mass': 'M☉', 'solar-radius': 'R☉',
      'solar-luminosity': 'L☉', day: t('bhUnitDay'), dimensionless: '',
    };
    const unit = raw.unit ? (units[raw.unit] ?? raw.unit) : '';
    if (unit) text += unit === '°' ? unit : ` ${unit}`;
    return { text, provenance };
  }

  function blackHoleInfo(ref) {
    const coordinates = ref.coordinates || {};
    const blackHole = ref.blackHole || {};
    const companion = ref.companion || {};
    const orbit = ref.orbit || {};
    const info = {};
    const add = (label, value) => { if (value != null) info[label] = value; };
    const derivedEntry = (value, digits, unit, uncertainty) => {
      if (!Number.isFinite(value)) return null;
      const entry = { value: value.toFixed(digits), unit, provenance: 'derived' };
      if (Number.isFinite(uncertainty)) entry.uncertainty = uncertainty.toFixed(digits);
      return entry;
    };

    add(t('bhSourceId'), ref.sourceId);
    add(t('bhSourceCatalog'), ref.sourceCatalog);
    add(t('bhCoordinateFrame'), coordinates.frame);
    add(t('bhCoordinateEpoch'), coordinates.epoch);
    add(t('bhRightAscension'), coordinates.raDeg);
    add(t('bhDeclination'), coordinates.decDeg ?? coordinates.declinationDeg);
    add(t('bhParallax'), coordinates.parallaxMas);
    add(t('bhBlackHoleMass'), blackHole.massSolar ?? ref.massSolar);
    add(t('bhCompanionMass'), companion.massSolar);
    add(t('bhCompanionRadius'), companion.radiusSolar);
    add(t('bhCompanionTemperature'), companion.effectiveTemperatureK);
    add(t('bhCompanionLuminosity'), companion.luminositySolar);
    add(t('bhOrbitalPeriod'), orbit.periodDays);
    add(t('bhEccentricity'), orbit.eccentricity);
    add(t('bhInclination'), orbit.inclinationDeg);
    add(t('bhAscendingNode'), orbit.ascendingNodeDeg);
    add(t('bhArgumentPeriastron'), orbit.argumentOfPeriastronDeg);
    add(t('bhPeriastronEpoch'), orbit.periastronJulianDate);

    try {
      const derived = deriveBlackHoleSystem(ref);
      add(t('bhDistance'), derivedEntry(derived.distancePc, 2, 'pc', derived.distanceUncertaintyPc));
      add(t('bhSemiMajorAxis'), derivedEntry(derived.semimajorAxisAU, 5, 'AU'));
      add(t('bhPeriapsis'), derivedEntry(derived.periapsisAU, 5, 'AU'));
      add(t('bhApoapsis'), derivedEntry(derived.apoapsisAU, 5, 'AU'));
      add(t('bhEventHorizon'), derivedEntry(derived.schwarzschild?.eventHorizonRadiusKm, 3, 'km'));
      add(t('bhPhotonSphere'), derivedEntry(derived.schwarzschild?.photonSphereRadiusKm, 3, 'km'));
      add(t('bhShadowDiameter'), derivedEntry(derived.schwarzschild?.shadowDiameterKm, 2, 'km'));
      add(t('bhAngularShadow'), derivedEntry(derived.shadowAngularDiameterNanoarcsec, 5, 'nanoarcsec'));
    } catch (error) {
      console.warn('Unable to derive Gaia BH1 info-panel values:', error);
    }

    const spin = blackHole.spin ?? ref.spin;
    add(t('bhSpin'), spin == null ? t('bhSpinUnknown') : spin);
    const accretion = blackHole.accretionEvidence ?? ref.accretionEvidence;
    if (accretion === 'none_detected') {
      add(t('bhAccretionEvidence'), { value: t('bhNoAccretionDetected'), provenance: 'measured' });
    } else {
      add(t('bhAccretionEvidence'), accretion);
    }
    if (ref.modelAssumptions && ref.modelAssumptions.schwarzschild) {
      add(t('bhCloseupModel'), { value: t('bhSchwarzschildAssumption'), provenance: 'model-assumption' });
    }
    if (ref.modelAssumptions && ref.modelAssumptions.compactObjectMultiplicity) {
      add(t('bhCompactObjectModel'), { value: t('bhSingleObjectAssumption'), provenance: 'model-assumption' });
    }
    if (ref.modelAssumptions && ref.modelAssumptions.locator) {
      add(t('bhLocatorScale'), { value: t('bhDirectionOnly'), provenance: 'model-assumption' });
    }
    return info;
  }

  function renderSources(ref) {
    const old = document.querySelector('#info-panel .info-sources');
    if (old) old.remove();
    const sourceList = Array.isArray(ref.sources) ? ref.sources : (ref.sources ? [ref.sources] : []);
    if (!sourceList.length) return;

    const section = document.createElement('section');
    section.className = 'info-sources';
    const heading = document.createElement('h3');
    heading.textContent = t('sources');
    const listEl = document.createElement('ul');

    if (ref.coordinates && ref.coordinates.epoch) {
      const context = document.createElement('p');
      context.className = 'info-source-context';
      context.textContent = `${t('sourceEpoch')}: ${ref.coordinates.epoch}`;
      section.appendChild(context);
    }

    sourceList.forEach((source, index) => {
      if (source == null) return;
      const item = document.createElement('li');
      const href = safeSourceHref(source);
      const label = typeof source === 'string'
        ? source
        : (source.title ?? source.label ?? source.name ?? source.citation ?? source.doi ?? href ?? `${t('source')} ${index + 1}`);
      const textEl = href ? document.createElement('a') : document.createElement('span');
      textEl.textContent = String(label);
      if (href) {
        textEl.href = href;
        textEl.target = '_blank';
        textEl.rel = 'noopener noreferrer';
      }
      item.appendChild(textEl);

      if (typeof source === 'object') {
        const metadata = [];
        if (source.epoch) metadata.push(`${t('sourceEpoch')}: ${source.epoch}`);
        if (source.citation && source.citation !== label) metadata.push(String(source.citation));
        if (source.doi && !String(label).includes(source.doi)) metadata.push(`DOI ${source.doi}`);
        if (source.note) metadata.push(String(source.note));
        if (metadata.length) {
          const meta = document.createElement('small');
          meta.textContent = metadata.join(' · ');
          item.appendChild(meta);
        }
        appendProvenanceBadge(item, source.provenance ?? source.evidence ?? source.category ?? source.kind);
      }
      listEl.appendChild(item);
    });

    if (!listEl.children.length) return;
    section.prepend(heading);
    section.appendChild(listEl);
    $('info-panel').appendChild(section);
  }

  function syncToggle(id, value) {
    const el = $(id);
    if (el) el.checked = value;
  }
  function refreshSpeedUi() {
    slider.value = Math.max(0, Math.min(1000, speedToSlider(s.speed)));
    readout.textContent = (s.direction === -1 ? '◄ ' : '') + fmtSpeed(s.speed);
  }

  return {
    showInfo(ref, kind) {
      const typeLabel = ref.type || (kind === 'moon' ? t('typeMoon') : kind === 'sun' ? t('typeStar') : kind === 'black-hole' ? t('typeBlackHole') : '');
      $('info-name').textContent = ref.name;
      $('info-type').textContent = typeLabel;
      $('info-desc').textContent = ref.description || '';

      const table = $('info-table');
      table.innerHTML = '';
      const isBlackHole = kind === 'black-hole' || ref.kind === 'black-hole';
      // The black-hole dataset keeps legacy strings for simple consumers, but
      // this panel reads its structured quantities so uncertainty/provenance
      // are never flattened or lost.
      const info = isBlackHole ? blackHoleInfo(ref) : (ref.info || {});
      for (const [k, v] of Object.entries(info)) {
        const row = document.createElement('div'); row.className = 'info-row';
        const a = document.createElement('span'); a.className = 'k'; a.textContent = k;
        const b = document.createElement('span'); b.className = 'v';
        const parts = infoValueParts(v);
        const valueText = document.createElement('span'); valueText.textContent = parts.text;
        b.appendChild(valueText);
        appendProvenanceBadge(b, parts.provenance);
        row.append(a, b); table.appendChild(row);
      }

      const facts = $('info-facts');
      facts.innerHTML = '';
      (ref.facts || []).forEach(f => {
        const li = document.createElement('li'); li.textContent = f; facts.appendChild(li);
      });
      $('info-facts-wrap').style.display = (ref.facts && ref.facts.length) ? '' : 'none';
      renderSources(ref);

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

    syncToggle,
    refreshSpeedUi,
  };
}

// ============================================================================
//  eclipse.js  —  Solar & Lunar eclipse modes
//  * A 3D Sun–Earth–Moon rig with umbra/penumbra shadow cones (the geometry).
//  * A "View from Earth's surface" 2D canvas (the experience): a crossing Moon
//    with corona at totality for solar; a blood-red Moon for lunar.
//  * Timeline scrubber, live phase readout, and detailed English descriptions.
// ============================================================================
import * as THREE from 'three';
import { resolveTexture, highResTexture } from './bodies.js';

const DPR = Math.min(window.devicePixelRatio || 1, 2);
const DURATION = 22;            // seconds for one full pass of the timeline

// Rig dimensions (didactic scale — not the true Solar-System scale).
const SUN_R = 12, SUN_X = -78, EARTH_R = 3.6, MOON_R = 1.25;
const SOLAR_EM = 26;            // Earth–Moon gap (Moon toward the Sun)
const LUNAR_EM = 28;            // Earth–Moon gap (Moon away from the Sun)
const LUNAR_UMBRA_LEN = 86;     // length of Earth's umbra cone

const DESCRIPTIONS = {
  solar: {
    title: 'Solar Eclipse',
    type: 'The Moon hides the Sun',
    html: `
      <p>A <b>solar eclipse</b> happens when the <b>Moon passes directly between
      the Sun and the Earth</b>, casting its shadow onto Earth's surface and
      blocking the Sun's light for observers underneath.</p>
      <h3>The shadow has two parts</h3>
      <ul>
        <li><b>Umbra</b> — the dark inner cone. Observers here see a <b>total</b>
        eclipse: the Sun is completely covered and its pearly <b>corona</b> appears.</li>
        <li><b>Penumbra</b> — the lighter outer cone. Observers here see only a
        <b>partial</b> eclipse.</li>
      </ul>
      <h3>Total vs. Annular</h3>
      <p>When the Moon is near perigee (closest) it looks slightly larger than the
      Sun → <b>total eclipse</b>. Near apogee it looks smaller, leaving a bright
      <b>"ring of fire"</b> → <b>annular eclipse</b>. Try the toggle below.</p>
      <h3>Why is it rare?</h3>
      <p>The Moon's orbit is tilted about <b>5°</b> to Earth's orbit, so a perfect
      line-up only occurs at the orbital <i>nodes</i> — roughly twice a year.</p>
      <p class="ecl-warn">⚠ Never look directly at the Sun without certified eclipse
      glasses — only the few minutes of <i>totality</i> are safe to view unaided.</p>`,
  },
  lunar: {
    title: 'Lunar Eclipse',
    type: 'The Earth hides the Sun from the Moon',
    html: `
      <p>A <b>lunar eclipse</b> happens when the <b>Earth passes between the Sun
      and a full Moon</b>, so Earth's shadow falls across the Moon.</p>
      <h3>Why does the Moon turn red? 🔴</h3>
      <p>Even inside the umbra the Moon doesn't go black. Sunlight grazing the edge
      of Earth is <b>refracted (bent) through our atmosphere</b>, which scatters
      away blue light and bends the remaining <b>red light</b> onto the Moon — the
      same effect that makes sunsets red. The result is the famous
      <b>"Blood Moon"</b>.</p>
      <h3>Phases</h3>
      <ul>
        <li><b>Penumbral</b> — the Moon dims subtly.</li>
        <li><b>Partial</b> — a dark, curved bite (the umbra) crosses the Moon.</li>
        <li><b>Totality</b> — the whole Moon glows coppery red.</li>
      </ul>
      <h3>Good to know</h3>
      <p>A lunar eclipse is <b>completely safe</b> to watch with the naked eye, can
      last <b>over an hour</b>, and is visible from the entire night side of Earth
      at once.</p>`,
  },
};

function darkConeMaterial(opacity) {
  return new THREE.MeshBasicMaterial({
    color: 0x05060a, transparent: true, opacity,
    side: THREE.DoubleSide, depthWrite: false,
  });
}

// A cone whose axis runs along +X (apex toward +X), base at local origin.
function makeConeX(baseR, apexR, length, opacity) {
  // CylinderGeometry(radiusTop, radiusBottom, height): axis +Y, top at +Y.
  const geo = new THREE.CylinderGeometry(apexR, baseR, length, 40, 1, true);
  geo.translate(0, length / 2, 0);            // base at origin, extends +Y
  geo.rotateZ(-Math.PI / 2);                  // +Y -> +X (apex toward +X)
  const m = new THREE.Mesh(geo, darkConeMaterial(opacity));
  m.renderOrder = 3;
  return m;
}

export function createEclipse(ctx) {
  const { scene, camera, controls, onEnter, onExit } = ctx;
  const loader = new THREE.TextureLoader();
  const SRGB = THREE.SRGBColorSpace;

  // Bitmaps for the 2D "view from Earth" (real Sun / Moon surfaces).
  const sunImg = new Image(); let sunReady = false; sunImg.onload = () => { sunReady = true; }; sunImg.src = resolveTexture('textures/sun.jpg');
  const moonImg = new Image(); let moonReady = false; moonImg.onload = () => { moonReady = true; }; moonImg.src = resolveTexture('textures/moon.jpg');

  // ---------------------------------------------------------------- 3D rig
  const rig = new THREE.Group();
  rig.visible = false;
  scene.add(rig);

  const sunTex = loader.load(resolveTexture('textures/sun.jpg')); sunTex.colorSpace = SRGB;
  const sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 48, 48),
    new THREE.MeshBasicMaterial({ map: sunTex }));
  sun.position.set(SUN_X, 0, 0);
  rig.add(sun);

  const glowTex = makeGlowTexture();
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffffff, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sunGlow.scale.setScalar(SUN_R * 3.6);
  sun.add(sunGlow);
  // Tag the eclipse Sun onto the bloom layer (BLOOM_LAYER = 1 in main.js) so the
  // selective-bloom pass still makes it glow, while the sky backdrop never does.
  sun.layers.enable(1);
  sunGlow.layers.enable(1);

  const light = new THREE.PointLight(0xfff4e2, 2.6, 0, 0);
  light.position.set(SUN_X, 0, 0);
  rig.add(light);
  const amb = new THREE.AmbientLight(0xffffff, 0.05);
  rig.add(amb);

  const earthTex = loader.load(highResTexture('textures/earth_day.jpg')); earthTex.colorSpace = SRGB;
  const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 64, 64),
    new THREE.MeshStandardMaterial({ map: earthTex, roughness: 1, metalness: 0 }));
  rig.add(earth);
  const cloudTex = loader.load(highResTexture('textures/earth_clouds.jpg'));
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.015, 48, 48),
    new THREE.MeshStandardMaterial({ alphaMap: cloudTex, transparent: true, color: 0xffffff, depthWrite: false, opacity: 0.85 }));
  earth.add(clouds);

  const moonTex = loader.load(resolveTexture('textures/moon.jpg')); moonTex.colorSpace = SRGB;
  const moonMat = new THREE.MeshStandardMaterial({ map: moonTex, roughness: 1, bumpMap: moonTex, bumpScale: 1 });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_R, 48, 48), moonMat);
  rig.add(moon);

  let umbra = null, penumbra = null;
  function clearShadow() {
    for (const m of [umbra, penumbra]) {
      if (m) { rig.remove(m); m.geometry.dispose(); m.material.dispose(); }
    }
    umbra = penumbra = null;
  }
  function buildShadow(type) {
    clearShadow();
    if (type === 'solar') {
      umbra = makeConeX(MOON_R, 0.02, SOLAR_EM, 0.5);            // converges at Earth
      penumbra = makeConeX(MOON_R, EARTH_R * 1.7, SOLAR_EM, 0.16);
    } else {
      umbra = makeConeX(EARTH_R, 0.02, LUNAR_UMBRA_LEN, 0.5);     // Earth's long umbra
      penumbra = makeConeX(EARTH_R, EARTH_R * 2.4, LUNAR_EM + 16, 0.16);
    }
    rig.add(umbra); rig.add(penumbra);
  }

  // ----- Orbit paths -------------------------------------------------------
  // The Moon's orbit is tilted, with its line of nodes along the Sun–Earth
  // axis, so the Moon only crosses the Sun–Earth line (→ eclipse) at the node.
  const MOON_INC = THREE.MathUtils.degToRad(9);   // exaggerated for clarity (real ≈ 5°)
  const SWEEP = 0.62;                              // radians of orbit travelled across the timeline

  function moonPoint(em, phi) {
    const px = em * Math.cos(phi), pz = em * Math.sin(phi);
    return new THREE.Vector3(px, -pz * Math.sin(MOON_INC), pz * Math.cos(MOON_INC));
  }
  function moonPos(kind, tt) {
    const em = kind === 'solar' ? SOLAR_EM : LUNAR_EM;
    const base = kind === 'solar' ? Math.PI : 0;   // azimuth of the eclipse alignment
    return moonPoint(em, base + (2 * tt - 1) * SWEEP);
  }

  let moonOrbit = null, earthArc = null;
  function clearOrbits() {
    for (const o of [moonOrbit, earthArc]) if (o) { rig.remove(o); o.geometry.dispose(); o.material.dispose(); }
    moonOrbit = earthArc = null;
  }
  function buildOrbits(kind) {
    clearOrbits();
    const em = kind === 'solar' ? SOLAR_EM : LUNAR_EM;
    // Moon's tilted orbit around Earth (full ring)
    const mp = [];
    for (let i = 0; i <= 240; i++) { const v = moonPoint(em, (i / 240) * Math.PI * 2); mp.push(v.x, v.y, v.z); }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
    moonOrbit = new THREE.Line(mg, new THREE.LineBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0.55 }));
    rig.add(moonOrbit);
    // Earth's FULL orbit around the Sun (a complete loop centred on the Sun).
    const ep = [], Rr = Math.abs(SUN_X);
    for (let i = 0; i <= 256; i++) { const a = (i / 256) * Math.PI * 2; ep.push(SUN_X + Rr * Math.cos(a), 0, Rr * Math.sin(a)); }
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
    earthArc = new THREE.Line(eg, new THREE.LineBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.3 }));
    rig.add(earthArc);
  }

  // --------------------------------------------------------------- DOM / UI
  const ui = document.createElement('div');
  ui.className = 'eclipse-ui';
  ui.id = 'eclipse-ui';
  ui.innerHTML = `
    <div class="ecl-top">
      <div class="ecl-title"><h2 id="ecl-title">Eclipse</h2><div id="ecl-type" class="ecl-type"></div></div>
      <button id="ecl-exit" class="ghost-btn">✕ Exit eclipse view</button>
    </div>
    <aside class="ecl-desc-panel">
      <div class="panel-head"><span>ABOUT</span></div>
      <div id="ecl-desc" class="ecl-desc"></div>
    </aside>
    <aside class="ecl-pov-panel">
      <div class="panel-head"><span>VIEW FROM EARTH'S SURFACE</span></div>
      <canvas id="ecl-canvas" class="ecl-canvas"></canvas>
      <div class="ecl-phase">
        <span id="ecl-phase-name">—</span>
        <span id="ecl-phase-pct"></span>
      </div>
    </aside>
    <footer class="ecl-timeline">
      <button id="ecl-play" class="round-btn">❚❚</button>
      <div class="ecl-track">
        <input type="range" id="ecl-scrub" min="0" max="1000" value="0" />
        <div class="ecl-time-readout"><span id="ecl-clock">Eclipse timeline</span></div>
      </div>
      <div id="ecl-seg" class="ecl-seg">
        <button data-m="total" class="active">Total</button>
        <button data-m="annular">Annular</button>
      </div>
    </footer>`;
  document.body.appendChild(ui);

  const $ = (id) => ui.querySelector('#' + id);
  const canvas = $('ecl-canvas');
  const g = canvas.getContext('2d');
  const playBtn = $('ecl-play');
  const scrub = $('ecl-scrub');
  const phaseName = $('ecl-phase-name');
  const phasePct = $('ecl-phase-pct');
  const seg = $('ecl-seg');

  // ----------------------------------------------------------- POV starfields
  function makeStars(n) {
    const a = [];
    for (let i = 0; i < n; i++) a.push({ x: Math.random(), y: Math.random(), r: 0.4 + Math.random() * 1.3, a: 0.3 + Math.random() * 0.7 });
    return a;
  }
  const solarStars = makeStars(90);
  const lunarStars = makeStars(220);

  // Film-grain tile (built once) — breaks up the flat "plastic" gradients.
  const grainCv = document.createElement('canvas'); grainCv.width = grainCv.height = 160;
  { const gg = grainCv.getContext('2d'); const im = gg.createImageData(160, 160);
    for (let i = 0; i < im.data.length; i += 4) { const v = 150 + Math.floor(Math.random() * 105); im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    gg.putImageData(im, 0, 0); }

  // ------------------------------------------------------------------- state
  let active = false, type = 'solar', t = 0.0, playing = true, annular = false;
  let cw = 400, ch = 400;
  const saved = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };

  function resizeCanvas() {
    const box = canvas.getBoundingClientRect();
    cw = Math.max(120, box.width); ch = Math.max(120, box.height);
    canvas.width = Math.round(cw * DPR);
    canvas.height = Math.round(ch * DPR);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', () => { if (active) resizeCanvas(); });

  // ------------------------------------------------------------- enter / exit
  function enter(kind) {
    type = kind; active = true; t = 0; playing = true;
    document.body.classList.add('eclipse-mode');
    ui.dataset.type = kind;
    $('ecl-title').textContent = DESCRIPTIONS[kind].title;
    $('ecl-type').textContent = DESCRIPTIONS[kind].type;
    $('ecl-desc').innerHTML = DESCRIPTIONS[kind].html;
    rig.visible = true;
    buildShadow(kind);
    buildOrbits(kind);
    saved.pos.copy(camera.position); saved.tgt.copy(controls.target);
    placeCamera(kind);
    if (onEnter) onEnter();
    refreshPlay();
    resizeCanvas();
    updateRig(); drawPOV(); updatePhase();
  }

  function exit() {
    active = false;
    document.body.classList.remove('eclipse-mode');
    rig.visible = false;
    clearShadow();
    clearOrbits();
    camera.position.copy(saved.pos); controls.target.copy(saved.tgt);
    if (onExit) onExit();
  }

  function placeCamera(kind) {
    // Framed so the Sun, Earth, Moon and shadow cone all sit in the central
    // band that is not covered by the side panels.
    if (kind === 'solar') { controls.target.set(-38, 0, 0); camera.position.set(-38, 42, 120); }
    else { controls.target.set(-12, 0, 0); camera.position.set(-12, 42, 122); }
  }

  // ------------------------------------------------------------- per-frame 3D
  const copper = new THREE.Color(0x86310f);
  const white = new THREE.Color(0xffffff);
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  const sunPos = new THREE.Vector3(SUN_X, 0, 0);
  const _q = new THREE.Quaternion();
  const _d = new THREE.Vector3();
  function updateRig() {
    const mp = moonPos(type, t);
    moon.position.copy(mp);
    if (type === 'solar') {
      moonMat.color.copy(white); moonMat.emissive.setRGB(0, 0, 0);
      if (umbra && penumbra) {
        _d.copy(mp).sub(sunPos).normalize();        // the shadow points away from the Sun
        _q.setFromUnitVectors(X_AXIS, _d);
        for (const m of [umbra, penumbra]) { m.position.copy(mp); m.quaternion.copy(_q); }
      }
    } else {
      if (umbra && penumbra) for (const m of [umbra, penumbra]) { m.position.set(0, 0, 0); m.quaternion.identity(); }
      // How far the Moon is from Earth's shadow axis (the +X line) -> redness.
      const off = Math.hypot(mp.y, mp.z);
      const umbraRatMoon = EARTH_R * (1 - LUNAR_EM / LUNAR_UMBRA_LEN);
      const inside = THREE.MathUtils.clamp(1 - off / (umbraRatMoon + MOON_R), 0, 1);
      moonMat.color.copy(white).lerp(copper, inside);
      moonMat.emissive.copy(copper).multiplyScalar(inside * 0.5);
    }
    moon.rotation.y = t * 0.4;
    earth.rotation.y = t * 0.5;
    clouds.rotation.y = t * 0.55;
  }

  // ------------------------------------------------------------- POV geometry
  function solarGeom() {
    const cx = cw / 2, cy = ch * 0.40;   // higher up → room for the flare/ghosts below
    const R = Math.min(cw, ch) * 0.155;
    const rM = (annular ? 0.9 : 1.06) * R;
    const maxSep = R + rM;
    const off = (2 * t - 1) * maxSep * 1.02;
    const mx = cx + off, my = cy + off * 0.10;
    const sep = Math.hypot(mx - cx, my - cy);
    return { cx, cy, R, rM, mx, my, sep, maxSep };
  }
  function lunarGeom() {
    const cx = cw / 2, cy = ch * 0.45;
    const R = Math.min(cw, ch) * 0.135;
    const umbraR = R * 2.6, penumbraR = R * 4.9;
    const travel = penumbraR + R;
    const sx = cx + (2 * t - 1) * travel, sy = cy + (2 * t - 1) * R * 0.22;
    const d = Math.hypot(sx - cx, sy - cy);
    return { cx, cy, R, umbraR, penumbraR, sx, sy, d };
  }

  // ------------------------------------------------------------------ POV draw
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function lerpC(a, b, k) { return a.map((v, i) => Math.round(v + (b[i] - v) * k)); }
  function rgb(c, a = 1) { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

  // Draw an equirectangular texture into a disk (a centred square crop).
  function diskTexture(img, ready, x, y, r, fb0, fb1) {
    g.save(); g.beginPath(); g.arc(x, y, r, 0, 7); g.closePath(); g.clip();
    if (ready && img.width) {
      const s = img.height, sx = (img.width - s) / 2;
      g.drawImage(img, sx, 0, s, s, x - r, y - r, 2 * r, 2 * r);
    } else {
      const gd = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);
      gd.addColorStop(0, fb0); gd.addColorStop(1, fb1);
      g.fillStyle = gd; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    g.restore();
  }
  // Limb darkening so a flat disk reads as a sphere.
  function sphereShade(x, y, r, edge) {
    g.save(); g.beginPath(); g.arc(x, y, r, 0, 7); g.clip();
    const sh = g.createRadialGradient(x - r * 0.28, y - r * 0.3, r * 0.2, x, y, r * 1.04);
    sh.addColorStop(0, 'rgba(255,255,255,0.10)');
    sh.addColorStop(0.62, 'rgba(0,0,0,0)');
    sh.addColorStop(1, `rgba(0,0,0,${edge})`);
    g.fillStyle = sh; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    g.restore();
  }

  function drawPOV() {
    g.clearRect(0, 0, cw, ch);
    if (type === 'solar') drawSolar(); else drawLunar();
    drawLandscape();   // foreground horizon silhouette ("from Earth's surface")
    drawGrain();       // subtle film grain → kills the flat plastic look
    drawVignette();    // cinematic vignette
  }

  function drawLandscape() {
    const hy = ch * 0.865;
    g.fillStyle = '#000';
    g.beginPath(); g.moveTo(0, ch); g.lineTo(0, hy);
    const pts = [[0, 0], [0.12, -0.016], [0.24, 0.004], [0.37, -0.03], [0.5, -0.006], [0.63, -0.034], [0.76, -0.01], [0.88, -0.026], [1, 0.002]];
    for (const [fx, fy] of pts) g.lineTo(fx * cw, hy + fy * ch);
    g.lineTo(cw, ch); g.closePath(); g.fill();
  }

  function drawGrain() {
    g.save(); g.globalAlpha = 0.05; g.globalCompositeOperation = 'overlay';
    for (let y = 0; y < ch; y += 160) for (let x = 0; x < cw; x += 160) g.drawImage(grainCv, x, y);
    g.restore();
  }

  function drawVignette() {
    const v = g.createRadialGradient(cw / 2, ch * 0.46, Math.min(cw, ch) * 0.3, cw / 2, ch * 0.5, Math.max(cw, ch) * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = v; g.fillRect(0, 0, cw, ch);
  }

  // --- Sky / atmosphere ---------------------------------------------------
  function drawSolarSky(tw) {                             // tw = 0 day … 1 deep twilight
    const top = lerpC([66, 120, 200], [7, 9, 30], tw);
    const mid = lerpC([126, 170, 226], [13, 18, 52], tw);
    const hor = lerpC([192, 210, 236], [40, 30, 66], tw);
    const sky = g.createLinearGradient(0, 0, 0, ch);
    sky.addColorStop(0, rgb(top)); sky.addColorStop(0.6, rgb(mid)); sky.addColorStop(1, rgb(hor));
    g.fillStyle = sky; g.fillRect(0, 0, cw, ch);
  }
  function drawHorizonGlow(I) {                           // the 360° sunrise/sunset glow at totality
    I = clamp(I, 0, 1); if (I <= 0.03) return;
    const hy = ch * 0.865, y0 = ch * 0.42;
    const gg = g.createLinearGradient(0, y0, 0, hy);
    gg.addColorStop(0, 'rgba(255,120,40,0)');
    gg.addColorStop(0.55, `rgba(255,122,48,${0.10 * I})`);
    gg.addColorStop(0.85, `rgba(255,104,44,${0.30 * I})`);
    gg.addColorStop(1, `rgba(255,140,68,${0.52 * I})`);
    g.fillStyle = gg; g.fillRect(0, y0, cw, hy - y0);
  }
  function planetDot(x, y, r, I, col) {
    g.save(); g.globalCompositeOperation = 'lighter';
    const gd = g.createRadialGradient(x, y, 0, x, y, r * 4);
    gd.addColorStop(0, `rgba(${col},${(0.95 * I).toFixed(3)})`);
    gd.addColorStop(0.3, `rgba(${col},${(0.4 * I).toFixed(3)})`);
    gd.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gd; g.beginPath(); g.arc(x, y, r * 4, 0, 7); g.fill();
    g.fillStyle = `rgba(255,255,255,${I.toFixed(3)})`; g.beginPath(); g.arc(x, y, r * 0.8, 0, 7); g.fill();
    g.restore();
  }
  function drawSolarStars(I, cx, cy, R) {
    I = clamp(I, 0, 1); if (I <= 0) return;
    for (const s of solarStars) { g.fillStyle = `rgba(255,255,255,${(s.a * I).toFixed(3)})`; g.beginPath(); g.arc(s.x * cw, s.y * ch * 0.82, s.r, 0, 7); g.fill(); }
    planetDot(cx + R * 3.1, cy - R * 1.9, 2.6, I, '255,250,235');   // Venus
    planetDot(cx - R * 3.6, cy + R * 1.5, 2.1, I, '255,238,205');   // Jupiter
  }

  // --- The Sun (partial phase) -------------------------------------------
  function drawSunGlow(ox, oy, R, B) {                    // wide soft halo (drawn behind the disk)
    B = clamp(B, 0, 1); if (B <= 0.02) return;
    g.save(); g.globalCompositeOperation = 'lighter';
    const rad = R * (2.6 + 4.2 * B);
    const gr = g.createRadialGradient(ox, oy, R * 0.4, ox, oy, rad);
    gr.addColorStop(0, `rgba(255,253,245,${0.52 * B})`);
    gr.addColorStop(0.2, `rgba(255,248,228,${0.24 * B})`);
    gr.addColorStop(0.55, `rgba(255,238,208,${0.08 * B})`);
    gr.addColorStop(1, 'rgba(255,230,194,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(ox, oy, rad, 0, 7); g.fill();
    g.restore();
  }
  // Full white-out drawn OVER the disk — makes the uncovered Sun unviewable.
  function drawSunBlowout(ox, oy, R, BO) {
    if (BO <= 0.02) return;
    g.save(); g.globalCompositeOperation = 'lighter';
    const rad = R * (1.5 + 0.8 * BO);
    const gr = g.createRadialGradient(ox, oy, R * 0.35, ox, oy, rad);
    gr.addColorStop(0, `rgba(255,255,255,${0.98 * BO})`);
    gr.addColorStop(0.6, `rgba(255,255,255,${0.68 * BO})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(ox, oy, rad, 0, 7); g.fill();
    g.restore();
  }
  // A brilliant white-hot disk with a defined edge, so the crescent reads during
  // the partial phase. (Near 0% the tight glow above blows the whole thing out.)
  function drawSunDisk(cx, cy, R) {
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
    diskTexture(sunImg, sunReady, cx, cy, R, '#ffe0b0', '#ff9b30');
    g.globalCompositeOperation = 'lighter';
    const wr = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    wr.addColorStop(0, 'rgba(255,255,255,0.92)');
    wr.addColorStop(0.6, 'rgba(255,250,235,0.6)');
    wr.addColorStop(1, 'rgba(255,238,205,0.4)');
    g.fillStyle = wr; g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    g.globalCompositeOperation = 'source-over'; g.restore();
  }
  function diskBlack(x, y, r) { g.fillStyle = '#050507'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }

  // --- Corona: gossamer, asymmetric (long equatorial streamers, short poles) --
  function drawCorona(x, y, r, alpha = 1) {
    g.save(); g.translate(x, y); g.globalCompositeOperation = 'lighter';
    const inner = g.createRadialGradient(0, 0, r * 0.96, 0, 0, r * 2.4);
    inner.addColorStop(0, `rgba(255,255,255,${0.8 * alpha})`);
    inner.addColorStop(0.22, `rgba(238,242,255,${0.3 * alpha})`);
    inner.addColorStop(1, 'rgba(220,228,255,0)');
    g.fillStyle = inner; g.beginPath(); g.arc(0, 0, r * 2.4, 0, 7); g.fill();
    const axis = 0.6;                                     // streamer (equatorial) orientation
    let seed = 7; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < 150; i++) {
      const a = (i / 150) * Math.PI * 2 + (rnd() - 0.5) * 0.05;
      const eq = Math.abs(Math.cos(a - axis));            // 1 at streamers, 0 at the poles
      const len = r * (1.2 + (0.4 + 1.0 * eq) * (0.5 + rnd() * 0.8));
      const w = r * (0.004 + rnd() * 0.018);
      const al = (0.035 + rnd() * 0.09) * alpha * (0.45 + 0.55 * eq);
      g.save(); g.rotate(a);
      const lg = g.createLinearGradient(r * 0.96, 0, len, 0);
      lg.addColorStop(0, `rgba(255,255,255,${al})`); lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg;
      g.beginPath(); g.moveTo(r * 0.96, -w); g.lineTo(len, 0); g.lineTo(r * 0.96, w); g.closePath(); g.fill();
      g.restore();
    }
    for (const s of [axis, axis + Math.PI]) {             // two broad equatorial lobes
      g.save(); g.rotate(s);
      const len = r * 3.6;
      const lg = g.createLinearGradient(r, 0, len, 0);
      lg.addColorStop(0, `rgba(245,247,255,${0.1 * alpha})`); lg.addColorStop(1, 'rgba(245,247,255,0)');
      g.fillStyle = lg;
      g.beginPath(); g.moveTo(r * 0.95, -r * 0.42); g.lineTo(len, 0); g.lineTo(r * 0.95, r * 0.42); g.closePath(); g.fill();
      g.restore();
    }
    g.restore();
  }
  function chromosphere(x, y, r, I) {                     // crimson arc at the limb
    I = clamp(I, 0, 1); if (I <= 0.03) return;
    g.save(); g.globalCompositeOperation = 'lighter';
    g.strokeStyle = `rgba(255,55,50,${0.85 * I})`; g.lineWidth = Math.max(1.4, r * 0.045);
    g.beginPath(); g.arc(x, y, r * 1.004, 0, 7); g.stroke();
    g.restore();
  }
  function drawProminences(x, y, r) {                     // red flame loops
    const proms = [[0.55, 1.0], [2.2, 1.3], [3.5, 0.7], [4.7, 1.0], [5.6, 0.6]];
    g.save(); g.globalCompositeOperation = 'lighter';
    for (const [a, sf] of proms) {
      const px = x + Math.cos(a) * r * 1.004, py = y + Math.sin(a) * r * 1.004, s = r * 0.05 * sf;
      const gd = g.createRadialGradient(px, py, 0, px, py, s * 2.8);
      gd.addColorStop(0, 'rgba(255,80,70,0.95)'); gd.addColorStop(0.5, 'rgba(255,45,45,0.5)'); gd.addColorStop(1, 'rgba(255,30,30,0)');
      g.fillStyle = gd; g.beginPath(); g.ellipse(px, py, s * 1.2, s * 2.4, a, 0, 7); g.fill();
    }
    g.restore();
  }
  function bailysBeads(cx, cy, R, rM, mx, my, gap) {      // beads of light through lunar valleys
    const ang0 = Math.atan2(cy - my, cx - mx);
    const spread = clamp(gap / (R * 0.18), 0, 1);
    const n = Math.max(2, Math.round(2 + spread * 6));
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const a = ang0 + (i / (n - 1) - 0.5) * spread * 1.4;
      const bx = mx + Math.cos(a) * rM, by = my + Math.sin(a) * rM;
      const s = R * (0.03 + 0.035 * (((i * 7) % 5) / 5));
      const gd = g.createRadialGradient(bx, by, 0, bx, by, s * 3);
      gd.addColorStop(0, 'rgba(255,255,250,0.98)'); gd.addColorStop(0.3, 'rgba(255,248,225,0.6)'); gd.addColorStop(1, 'rgba(255,245,215,0)');
      g.fillStyle = gd; g.beginPath(); g.arc(bx, by, s * 3, 0, 7); g.fill();
    }
    g.restore();
  }
  function diamondRing(cx, cy, R, rM, mx, my, gap) {      // single brilliant bead on the pearly ring
    const flash = clamp(1 - gap / (R * 0.05), 0, 1);
    const a = Math.atan2(cy - my, cx - mx);
    const bx = mx + Math.cos(a) * rM, by = my + Math.sin(a) * rM;
    g.save(); g.globalCompositeOperation = 'lighter';
    const sz = R * (0.7 + 0.9 * flash);
    const dg = g.createRadialGradient(bx, by, 0, bx, by, sz);
    dg.addColorStop(0, 'rgba(255,255,255,1)');
    dg.addColorStop(0.12, 'rgba(255,252,240,0.7)');
    dg.addColorStop(0.5, `rgba(255,246,222,${0.2 * flash})`);
    dg.addColorStop(1, 'rgba(255,244,216,0)');
    g.fillStyle = dg; g.beginPath(); g.arc(bx, by, sz, 0, 7); g.fill();
    g.strokeStyle = `rgba(255,255,250,${0.45 * flash})`; g.lineWidth = 1.3;
    const fl = R * (0.8 + 0.8 * flash);
    g.beginPath(); g.moveTo(bx - fl, by); g.lineTo(bx + fl, by); g.moveTo(bx, by - fl); g.lineTo(bx, by + fl); g.stroke();
    g.restore();
  }

  // --- Camera-filmed look (you view the Sun through a lens/filter) -----------
  function drawVeil(sx, sy, B) {                          // milky veiling glare → low-contrast "filmed" haze
    B = clamp(B, 0, 1); if (B <= 0.02) return;
    g.save(); g.globalCompositeOperation = 'screen';
    const rad = Math.max(cw, ch) * (0.5 + 0.32 * B);
    const gr = g.createRadialGradient(sx, sy, 0, sx, sy, rad);
    gr.addColorStop(0, `rgba(250,250,255,${0.62 * B})`);
    gr.addColorStop(0.4, `rgba(236,238,248,${0.3 * B})`);
    gr.addColorStop(1, 'rgba(224,228,240,0)');
    g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
    g.fillStyle = `rgba(232,235,244,${0.06 * B})`; g.fillRect(0, 0, cw, ch);   // faint flat haze
    g.restore();
  }
  function drawCrescentBloom(cx, cy, R, mx, my, B, c) {   // bright sunlight bleeding over the Moon's edge
    const w = clamp(c * 4, 0, 1) * B; if (w <= 0.02) return;
    const ux = cx - mx, uy = cy - my, ul = Math.hypot(ux, uy) || 1;
    const px = cx + (ux / ul) * R * 0.85, py = cy + (uy / ul) * R * 0.85;
    g.save(); g.globalCompositeOperation = 'lighter';
    const gr = g.createRadialGradient(px, py, 0, px, py, R * 1.25);
    gr.addColorStop(0, `rgba(255,255,255,${0.7 * w})`);
    gr.addColorStop(0.5, `rgba(246,249,255,${0.2 * w})`);
    gr.addColorStop(1, 'rgba(246,249,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(px, py, R * 1.25, 0, 7); g.fill();
    g.restore();
  }
  function drawLensFlare(sx, sy, R, B) {                  // anamorphic streak + coloured ghost reflections
    B = clamp(B, 0, 1); if (B <= 0.06) return;
    const cx = cw / 2;
    const dx = (cx - sx) * 1.0, dy = ch * 0.24;           // axis: from the Sun marching downward
    g.save(); g.globalCompositeOperation = 'screen';
    const hs = g.createLinearGradient(0, sy, cw, sy);     // horizontal anamorphic streak
    hs.addColorStop(0, 'rgba(214,206,255,0)');
    hs.addColorStop(0.5, `rgba(226,222,255,${0.34 * B})`);
    hs.addColorStop(1, 'rgba(214,206,255,0)');
    g.fillStyle = hs; g.fillRect(0, sy - R * 0.06, cw, R * 0.12);
    const ghosts = [
      { k: 0.42, r: 0.55, a: 0.22, c: [190, 150, 255], ring: true },
      { k: 0.68, r: 0.30, a: 0.30, c: [255, 250, 235], ring: false },
      { k: 1.00, r: 1.05, a: 0.32, c: [110, 235, 215], ring: true },   // teal arc (the signature ghost)
      { k: 1.30, r: 0.45, a: 0.26, c: [255, 195, 135], ring: false },
      { k: 1.62, r: 0.70, a: 0.18, c: [130, 180, 255], ring: true },
      { k: 1.90, r: 0.25, a: 0.40, c: [255, 255, 255], ring: false },
    ];
    for (const gh of ghosts) {
      const gx = sx + dx * gh.k, gy = sy + dy * gh.k, rr = R * gh.r * (0.8 + 0.4 * B);
      const col = gh.c, a = (gh.a * B).toFixed(3);
      if (gh.ring) {
        const rg = g.createRadialGradient(gx, gy, rr * 0.62, gx, gy, rr);
        rg.addColorStop(0, `rgba(${col},0)`); rg.addColorStop(0.72, `rgba(${col},${a})`); rg.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = rg;
      } else {
        const dg = g.createRadialGradient(gx, gy, 0, gx, gy, rr);
        dg.addColorStop(0, `rgba(${col},${a})`); dg.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = dg;
      }
      g.beginPath(); g.arc(gx, gy, rr, 0, 7); g.fill();
    }
    g.restore();
  }

  function drawSolar() {
    const { cx, cy, R, rM, mx, my, sep } = solarGeom();
    const c = clamp((R + rM - sep) / (2 * R), 0, 1);          // ~coverage of the Sun
    const isTotal = !annular && sep <= (rM - R);
    const isAnnularMax = annular && sep <= (R - rM);
    const gap = sep - (rM - R);                                // >0 partial, ≤0 total
    // Eerie twilight only ramps in over the last ~18% of coverage.
    const tw = isTotal ? 1 : (annular ? clamp((c - 0.6) / 0.4, 0, 1) * 0.4 : clamp((c - 0.82) / 0.18, 0, 1));

    drawSolarSky(tw);
    drawHorizonGlow(tw);
    drawSolarStars(isTotal ? 1 : clamp((tw - 0.45) * 1.8, 0, 1), cx, cy, R);

    if (isTotal) {
      const depth = clamp(((rM - R) - sep) / Math.max(0.0001, rM - R), 0, 1);  // 0 at edge → 1 deep
      drawCorona(mx, my, rM, 1);
      diskBlack(mx, my, rM);
      drawProminences(mx, my, rM);
      chromosphere(mx, my, rM, clamp(1 - depth * 2.2, 0, 1));   // crimson arc only near the edges of totality
      return;
    }

    const B = Math.pow(1 - c, 0.25);   // remaining sunlight stays high until near totality
    const BO = clamp(1 - c * 5, 0, 1); // full white-out only when the Sun is nearly uncovered
    const ux = cx - mx, uy = cy - my, ul = Math.hypot(ux, uy) || 1;   // toward the bright crescent
    const ox = cx + (ux / ul) * R * 0.55 * c, oy = cy + (uy / ul) * R * 0.55 * c;

    // Exposing a camera for the bright Sun crushes the sky to a flat warm-grey haze.
    const gsky = g.createLinearGradient(0, 0, 0, ch);
    gsky.addColorStop(0, 'rgb(150,158,172)'); gsky.addColorStop(1, 'rgb(118,126,143)');
    g.fillStyle = gsky; g.fillRect(0, 0, cw, ch);
    drawVeil(ox, oy, B);               // milky veiling glare (the "filmed through a lens" look)
    drawSunGlow(ox, oy, R, B);         // soft bloom behind the disk
    drawSunDisk(cx, cy, R);            // overexposed white-hot disk
    // Moon silhouette (dark, veiled) — only once it actually touches the Sun
    if (sep < R + rM) {
      g.save(); g.beginPath(); g.arc(cx, cy, R * 1.9, 0, 7); g.clip();
      g.fillStyle = '#1b1c21'; g.beginPath(); g.arc(mx, my, rM, 0, 7); g.fill();
      g.restore();
    }
    drawCrescentBloom(cx, cy, R, mx, my, B, c);   // bright crescent bleeds over the Moon's edge
    drawSunBlowout(ox, oy, R, BO);     // over the disk → blinding when nearly uncovered
    drawLensFlare(ox, oy, R, B);       // ghosts, teal arc, anamorphic streak

    // Last/first moments: inner corona emerges, then Baily's beads → diamond ring.
    if (!annular && gap < R * 0.18) {
      drawCorona(mx, my, rM, clamp(1 - gap / (R * 0.18), 0, 1) * 0.6);
      diskBlack(mx, my, rM);                 // keep the Moon dark over the corona's inner glow
      if (gap < R * 0.05) diamondRing(cx, cy, R, rM, mx, my, gap);
      else bailysBeads(cx, cy, R, rM, mx, my, gap);
    }
  }

  function drawLunar() {
    const { cx, cy, R, umbraR, penumbraR, sx, sy } = lunarGeom();
    const sky = g.createLinearGradient(0, 0, 0, ch);
    sky.addColorStop(0, '#01020a'); sky.addColorStop(1, '#070912');
    g.fillStyle = sky; g.fillRect(0, 0, cw, ch);
    for (const s of lunarStars) { g.fillStyle = `rgba(255,255,255,${s.a.toFixed(3)})`; g.beginPath(); g.arc(s.x * cw, s.y * ch * 0.8, s.r, 0, 7); g.fill(); }

    // faint glow around the Moon
    const halo = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.9);
    halo.addColorStop(0, 'rgba(220,225,255,0.12)'); halo.addColorStop(1, 'rgba(220,225,255,0)');
    g.fillStyle = halo; g.beginPath(); g.arc(cx, cy, R * 1.9, 0, 7); g.fill();

    // real lunar surface + sphere shading
    diskTexture(moonImg, moonReady, cx, cy, R, '#e8e8ea', '#9a99a0');
    sphereShade(cx, cy, R, 0.5);

    // Earth's shadow, clipped to the Moon
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
    g.globalCompositeOperation = 'multiply';
    const pen = g.createRadialGradient(sx, sy, umbraR * 0.5, sx, sy, penumbraR);
    pen.addColorStop(0, 'rgb(120,85,85)');
    pen.addColorStop(umbraR / penumbraR, 'rgb(150,122,122)');
    pen.addColorStop(1, 'rgb(250,250,252)');
    g.fillStyle = pen; g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    const um = g.createRadialGradient(sx, sy, 0, sx, sy, umbraR);
    um.addColorStop(0, 'rgb(120,38,24)');           // deep blood red at umbra centre
    um.addColorStop(0.62, 'rgb(150,56,33)');        // brighter copper toward the edge
    um.addColorStop(1, 'rgb(236,236,238)');         // no change outside the umbra
    g.fillStyle = um; g.beginPath(); g.arc(sx, sy, umbraR, 0, 7); g.fill();
    g.globalCompositeOperation = 'lighter';
    const gl = g.createRadialGradient(sx, sy, 0, sx, sy, umbraR * 0.95);
    gl.addColorStop(0, 'rgba(95,24,9,0.5)'); gl.addColorStop(1, 'rgba(40,10,4,0)');
    g.fillStyle = gl; g.beginPath(); g.arc(sx, sy, umbraR * 0.95, 0, 7); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.restore();

    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = Math.max(1, R * 0.03);
    g.beginPath(); g.arc(cx, cy, R - R * 0.015, 0, 7); g.stroke();
  }

  // --------------------------------------------------------------- phase text
  function updatePhase() {
    let name = '—', pct = '';
    if (type === 'solar') {
      const { R, rM, sep } = solarGeom();
      const covered = Math.min(1, Math.max(0, (R + rM - sep) / (2 * R)));
      pct = Math.round(covered * 100) + '% covered';
      if (!annular && sep <= rM - R) name = '🌑 Totality — corona visible';
      else if (annular && sep <= R - rM) name = '💍 Annularity — “ring of fire”';
      else if (sep >= R + rM) name = 'Before / after eclipse';
      else name = (t < 0.5 ? 'Partial phase (beginning)' : 'Partial phase (ending)');
      if (Math.abs(t - 0.5) < 0.012) name = annular ? '💍 Maximum (annular)' : '🌑 Maximum (totality)';
    } else {
      const { R, umbraR, penumbraR, d } = lunarGeom();
      if (d <= umbraR - R) name = '🔴 Totality — Blood Moon';
      else if (d <= umbraR + R) name = '🌗 Partial (umbral) phase';
      else if (d <= penumbraR + R) name = '🌘 Penumbral phase';
      else name = 'Before / after eclipse';
      const into = Math.min(1, Math.max(0, (umbraR + R - d) / (2 * R)));
      pct = Math.round(into * 100) + '% in umbra';
    }
    phaseName.textContent = name;
    phasePct.textContent = pct;
  }

  // --------------------------------------------------------------- controls
  function refreshPlay() { playBtn.innerHTML = playing ? '❚❚' : '▶'; }
  playBtn.addEventListener('click', () => {
    if (!playing && t >= 1) t = 0;
    playing = !playing; refreshPlay();
  });
  scrub.addEventListener('input', () => { t = +scrub.value / 1000; playing = false; refreshPlay(); updateRig(); drawPOV(); updatePhase(); });
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]'); if (!b) return;
    annular = b.dataset.m === 'annular';
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    drawPOV(); updatePhase();
  });
  $('ecl-exit').addEventListener('click', exit);

  function togglePlay() { if (!playing && t >= 1) t = 0; playing = !playing; refreshPlay(); }

  // ------------------------------------------------------------------- update
  function update(dt) {
    if (!active) return;
    if (playing) { t += dt / DURATION; if (t > 1) t -= 1; scrub.value = Math.round(t * 1000); }
    updateRig();
    drawPOV();
    updatePhase();
  }

  return { enter, exit, update, togglePlay, isActive: () => active };
}

// Soft radial glow used by the rig Sun sprite.
function makeGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,245,210,1)');
  grad.addColorStop(0.3, 'rgba(255,210,120,0.5)');
  grad.addColorStop(1, 'rgba(255,150,40,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

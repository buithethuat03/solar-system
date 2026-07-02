// ============================================================================
//  eclipse.js  —  Solar & Lunar eclipse modes
//  * A 3D Sun–Earth–Moon rig with umbra/penumbra shadow cones (the geometry).
//  * A "View from Earth's surface" 2D canvas (the experience): a crossing Moon
//    with corona at totality for solar; a blood-red Moon for lunar.
//  * Timeline scrubber, live phase readout, and detailed English descriptions.
// ============================================================================
import * as THREE from 'three';
import { resolveTexture, highResTexture, makeEarthMaterial, makeAtmosphere } from './bodies.js';
import { t as tr } from './i18n.js';

const DPR = Math.min(window.devicePixelRatio || 1, 2);
const DURATION = 22;            // seconds for one full pass of the timeline

// Rig dimensions (didactic scale — not the true Solar-System scale).
const SUN_R = 12, SUN_X = -78, EARTH_R = 3.6, MOON_R = 1.25;
const SOLAR_EM = 26;            // Earth–Moon gap (Moon toward the Sun)
const LUNAR_EM = 28;            // Earth–Moon gap (Moon away from the Sun)
const LUNAR_UMBRA_LEN = 86;     // length of Earth's umbra cone

const DESCRIPTION_KEYS = {
  solar: {
    title: 'eclSolarDetailTitle',
    type: 'eclSolarDetailType',
    html: 'eclSolarDescHtml',
  },
  lunar: {
    title: 'eclLunarDetailTitle',
    type: 'eclLunarDetailType',
    html: 'eclLunarDescHtml',
  },
};

function fmt(key, values) {
  return tr(key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
}

// ---------------------------------------------------------------------------
//  GLSL — the rig's custom shaders. The renderer uses a logarithmic depth
//  buffer, so every fragment/vertex pair MUST carry the logdepthbuf chunks
//  (same pattern as bodies.js) or the mesh z-fights / vanishes with distance.
// ---------------------------------------------------------------------------
const NOISE_GLSL = `
float hash(vec3 p){ p = fract(p*0.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)), hash(i+vec3(1,0,0)), f.x),
                 mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                 mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a*vnoise(p); p *= 2.03; a *= 0.5; } return v; }
`;

// Animated photosphere: texture base + boiling granulation, temperature ramp
// toward a deep-orange limb, limb darkening and a hot fresnel rim. Output is
// HDR (× uEmissive, no tonemapping chunk) so the selective bloom pass fires.
const SUN_VERT = `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv; varying vec3 vPos; varying vec3 vN; varying vec3 vView;
void main(){
  vUv = uv;
  vPos = position / ${SUN_R.toFixed(1)};
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const SUN_FRAG = `
#include <logdepthbuf_pars_fragment>
uniform sampler2D sunTex; uniform float uTime; uniform float uEmissive;
varying vec2 vUv; varying vec3 vPos; varying vec3 vN; varying vec3 vView;
${NOISE_GLSL}
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(vView);
  float mu = max(dot(N, V), 0.0);
  vec3 tex = texture2D(sunTex, vUv).rgb;
  float g1 = fbm(vPos*6.6 + vec3(0.0, uTime*0.05, 0.0));
  float g2 = fbm(vPos*17.8 - vec3(uTime*0.08, 0.0, 0.0));
  float gran = g1*0.6 + g2*0.4;
  vec3 base = mix(tex, tex*(0.75 + 0.9*gran), 0.55);
  vec3 ramp = mix(vec3(1.0, 0.42, 0.13), vec3(1.05, 0.95, 0.72), pow(mu, 0.5));
  float limb = 0.35 + 0.65*pow(mu, 0.6);
  vec3 col = base * ramp * limb;
  col += pow(1.0 - mu, 3.0) * vec3(1.0, 0.36, 0.12) * 1.8;
  gl_FragColor = vec4(col * uEmissive, 1.0);
  #include <logdepthbuf_fragment>
}`;

// Volumetric-looking shadow cones: soft fresnel rim so the silhouette reads
// against the near-black sky, a dissolving tip, and faint drifting dust noise.
const CONE_VERT = `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uLength;
varying float vAxial; varying vec3 vN; varying vec3 vView;
void main(){
  vAxial = clamp(position.x / uLength, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const CONE_FRAG = `
#include <logdepthbuf_pars_fragment>
uniform float uTime; uniform float uCore; uniform float uRim; uniform float uRimPow; uniform float uOpacity;
uniform vec3 uCoreColor; uniform vec3 uRimColor;
varying float vAxial; varying vec3 vN; varying vec3 vView;
${NOISE_GLSL}
void main(){
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), uRimPow);
  float apexFade = 1.0 - smoothstep(0.82, 1.0, vAxial);
  float dust = (vnoise(vec3(vAxial*7.0, fres*4.0, uTime*0.15)) - 0.5) * 0.06;
  float alpha = clamp(uCore*apexFade + uRim*fres + dust, 0.0, 1.0) * uOpacity;
  vec3 col = mix(uCoreColor, uRimColor, fres);
  gl_FragColor = vec4(col, alpha);
  #include <logdepthbuf_fragment>
}`;

const CONE_PRESETS = {
  umbra:    { core: 0.55, rim: 0.55, rimPow: 2.5, coreColor: [0.000, 0.006, 0.020], rimColor: [0.22, 0.30, 0.55] },
  penumbra: { core: 0.10, rim: 0.35, rimPow: 3.0, coreColor: [0.010, 0.020, 0.045], rimColor: [0.13, 0.19, 0.38] },
};

// A cone whose axis runs along +X (apex toward +X), base at local origin.
function makeShadowCone(baseR, apexR, length, preset) {
  // CylinderGeometry(radiusTop, radiusBottom, height): axis +Y, top at +Y.
  const geo = new THREE.CylinderGeometry(apexR, baseR, length, 48, 1, true);
  geo.translate(0, length / 2, 0);            // base at origin, extends +Y
  geo.rotateZ(-Math.PI / 2);                  // +Y -> +X (apex toward +X)
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLength: { value: length },
      uCore: { value: preset.core },
      uRim: { value: preset.rim },
      uRimPow: { value: preset.rimPow },
      uOpacity: { value: 1.0 },
      uCoreColor: { value: new THREE.Color(...preset.coreColor) },
      uRimColor: { value: new THREE.Color(...preset.rimColor) },
    },
    vertexShader: CONE_VERT,
    fragmentShader: CONE_FRAG,
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

// ---------------------------------------------------------------------------
//  Seeded 1D value noise for the POV canvas (corona rays, ridgelines).
//  Built once — all heavy POV texture work happens in the build*() functions
//  at enter/resize time, never per frame.
// ---------------------------------------------------------------------------
function makeNoise1D(seed) {
  const N = 256, a = new Float32Array(N); let s = seed || 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < N; i++) a[i] = rnd();
  return (x) => {
    const f = x * N, i = Math.floor(f), t = f - i, u = t * t * (3 - 2 * t);
    return a[((i % N) + N) % N] * (1 - u) + a[(((i + 1) % N) + N) % N] * u;
  };
}
const _n1 = makeNoise1D(11), _n2 = makeNoise1D(29), _n3 = makeNoise1D(53);
const fbmA = (x) => 0.55 * _n1(x) + 0.30 * _n2(x * 2) + 0.15 * _n3(x * 4);

export function createEclipse(ctx) {
  const { scene, camera, controls, onEnter, onExit } = ctx;
  const loader = new THREE.TextureLoader();
  const SRGB = THREE.SRGBColorSpace;

  // Bitmaps for the 2D "view from Earth" (real Sun / Moon surfaces).
  const sunImg = new Image(); let sunReady = false; sunImg.onload = () => { sunReady = true; }; sunImg.src = resolveTexture('textures/sun.jpg');
  const moonImg = new Image(); let moonReady = false;
  moonImg.onload = () => { moonReady = true; if (active) { buildMoonDark(); buildMoonBase(); } };
  moonImg.src = resolveTexture('textures/moon.jpg');

  // ---------------------------------------------------------------- 3D rig
  const rig = new THREE.Group();
  rig.visible = false;
  scene.add(rig);

  const sunTex = loader.load(resolveTexture('textures/sun.jpg')); sunTex.colorSpace = SRGB;
  const sunUniforms = { uTime: { value: 0 }, sunTex: { value: sunTex }, uEmissive: { value: 1.7 } };
  const sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 64, 64),
    new THREE.ShaderMaterial({ uniforms: sunUniforms, vertexShader: SUN_VERT, fragmentShader: SUN_FRAG }));
  sun.position.set(SUN_X, 0, 0);
  rig.add(sun);

  // Soft fresnel glow shell hugging the disc — the wide outer glow now comes
  // from the bloom pass instead of one big flat sprite.
  const sunShell = makeAtmosphere(SUN_R * 1.28, 0xffb15a, 2.2, 1.2);
  sun.add(sunShell);

  const glowTex = makeGlowTexture();
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffffff, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sunGlow.scale.setScalar(SUN_R * 2.6);
  sun.add(sunGlow);
  // Tag the eclipse Sun onto the bloom layer (BLOOM_LAYER = 1 in main.js) so the
  // selective-bloom pass still makes it glow, while the sky backdrop never does.
  // The shell must be tagged too: otherwise the bloom pass black-swaps it into
  // an opaque sphere that would occlude the Sun's own bloom.
  sun.layers.enable(1);
  sunGlow.layers.enable(1);
  sunShell.layers.enable(1);

  const light = new THREE.PointLight(0xfff4e2, 2.6, 0, 0);
  light.position.set(SUN_X, 0, 0);
  rig.add(light);
  const amb = new THREE.AmbientLight(0xffffff, 0.03);
  rig.add(amb);

  // Earth: same self-lit day/night shader as the main scene (city lights on the
  // night side, terminator, ocean glint) + a fresnel atmosphere rim.
  const dayT = loader.load(highResTexture('textures/earth_day.jpg')); dayT.colorSpace = SRGB;
  const nightT = loader.load(highResTexture('textures/earth_night.jpg')); nightT.colorSpace = SRGB;
  const specT = loader.load(highResTexture('textures/earth_specular.png')); specT.colorSpace = THREE.NoColorSpace;
  const earthMat = makeEarthMaterial(dayT, nightT, specT);
  earthMat.uniforms.sunDir.value.set(-1, 0, 0);   // rig Sun sits at -X, fixed
  const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 64, 64), earthMat);
  rig.add(earth);
  earth.add(makeAtmosphere(EARTH_R * 1.06, 0x5aa0ff, 3.2, 0.9));
  const cloudTex = loader.load(highResTexture('textures/earth_clouds.jpg'));
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.015, 48, 48),
    new THREE.MeshStandardMaterial({ alphaMap: cloudTex, transparent: true, color: 0xffffff, depthWrite: false, opacity: 0.85 }));
  earth.add(clouds);

  // Moon: strong bump relief + emissiveMap so the totality copper glow is
  // modulated by the craters instead of flattening into a rusty ball.
  const moonTex = loader.load(resolveTexture('textures/moon.jpg')); moonTex.colorSpace = SRGB;
  const moonMat = new THREE.MeshStandardMaterial({
    map: moonTex, color: 0xf4ede2, roughness: 0.98, metalness: 0,
    bumpMap: moonTex, bumpScale: 2.6,
    emissiveMap: moonTex, emissive: new THREE.Color(0, 0, 0),
  });
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
      umbra = makeShadowCone(MOON_R, 0.02, SOLAR_EM, CONE_PRESETS.umbra);            // converges at Earth
      penumbra = makeShadowCone(MOON_R, EARTH_R * 1.7, SOLAR_EM, CONE_PRESETS.penumbra);
    } else {
      umbra = makeShadowCone(EARTH_R, 0.02, LUNAR_UMBRA_LEN, CONE_PRESETS.umbra);     // Earth's long umbra
      penumbra = makeShadowCone(EARTH_R, EARTH_R * 2.4, LUNAR_EM + 16, CONE_PRESETS.penumbra);
    }
    penumbra.renderOrder = 2;
    umbra.renderOrder = 3;
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
      <div class="ecl-title"><h2 id="ecl-title">${tr('eclTitleFallback')}</h2><div id="ecl-type" class="ecl-type"></div></div>
      <button id="ecl-exit" class="ghost-btn">${tr('eclExit')}</button>
    </div>
    <aside class="ecl-desc-panel">
      <div class="panel-head"><span>${tr('eclAbout')}</span></div>
      <div id="ecl-desc" class="ecl-desc"></div>
    </aside>
    <aside class="ecl-pov-panel">
      <div class="panel-head"><span>${tr('eclViewFromEarth')}</span></div>
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
        <div class="ecl-time-readout"><span id="ecl-clock">${tr('eclTimeline')}</span></div>
      </div>
      <div id="ecl-seg" class="ecl-seg">
        <button data-m="total" class="active">${tr('eclModeTotal')}</button>
        <button data-m="annular">${tr('eclModeAnnular')}</button>
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
    for (let i = 0; i < n; i++) {
      const p = Math.random();   // a few blue-white and warm K-type stars
      const tint = p < 0.08 ? [180, 200, 255] : p < 0.15 ? [255, 225, 190] : [255, 255, 255];
      a.push({ x: Math.random(), y: Math.random(), r: 0.4 + Math.random() * 1.3, a: 0.3 + Math.random() * 0.7, tint });
    }
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
  let clock = 0;                 // drives sun granulation + cone dust (runs while paused)
  let horizonWarm = 0;           // 0..1: warms the far-ridge haze during solar totality
  const saved = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };

  // Offscreen canvases, rebuilt at enter/resize — never touched per frame.
  let coronaCv = null, moonDarkCv = null, moonBaseCv = null, starFieldCv = null;

  // Resize the drawing surface (cheap — safe to run per resize event).
  function applyCanvasSize() {
    const box = canvas.getBoundingClientRect();
    const w = Math.max(120, box.width), h = Math.max(120, box.height);
    if (w === cw && h === ch) return false;
    cw = w; ch = h;
    canvas.width = Math.round(cw * DPR);
    canvas.height = Math.round(ch * DPR);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    return true;
  }
  // Rebuild the offscreen sprites (heavy: ~1600 corona strokes + starfield).
  function rebuildPOVAssets() {
    if (type === 'solar') buildCorona(Math.min(cw, ch) * 0.155 * 1.06);   // rM of the totality Moon
    buildMoonDark();
    buildMoonBase();
    buildStarField();
  }
  function resizeCanvas() {
    applyCanvasSize();
    rebuildPOVAssets();
  }
  // Debounced: dragging the window edge fires resize per frame — the surface
  // resizes live, but the expensive sprite rebuilds wait for the drag to stop.
  let rebuildTimer = 0;
  window.addEventListener('resize', () => {
    if (!active || !applyCanvasSize()) return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuildPOVAssets, 150);
  });

  // ----------------------------------------------------- POV offscreen builds
  // Multi-scale corona: a K-corona sheath + ~1600 fbm-modulated fine rays with
  // long equatorial streamers, short polar brushes and two broad lobes. Built
  // once per resize (~few ms), composited per frame with one drawImage.
  function buildCorona(rM) {
    if (!(rM > 4)) return;
    const size = Math.ceil(rM * 8 * DPR);
    coronaCv = document.createElement('canvas');
    coronaCv.width = coronaCv.height = size;
    const c = coronaCv.getContext('2d');
    c.setTransform(DPR, 0, 0, DPR, size / 2, size / 2);
    c.globalCompositeOperation = 'lighter';
    const axis = 0.5;                       // streamer (equatorial) orientation
    // inner sheath
    const inner = c.createRadialGradient(0, 0, rM * 0.98, 0, 0, rM * 2.6);
    inner.addColorStop(0, 'rgba(255,253,248,0.55)');
    inner.addColorStop(0.18, 'rgba(236,240,255,0.22)');
    inner.addColorStop(0.50, 'rgba(210,222,255,0.07)');
    inner.addColorStop(1, 'rgba(210,222,255,0)');
    c.fillStyle = inner; c.beginPath(); c.arc(0, 0, rM * 2.6, 0, 7); c.fill();
    // fine rays
    for (let i = 0; i < 1600; i++) {
      const th = (i / 1600) * Math.PI * 2;
      const u = th / (Math.PI * 2);
      const eq = Math.pow(Math.abs(Math.cos(th - axis)), 1.3);   // 1 at streamers, 0 at poles
      const nz = fbmA(u);
      const big = 0.6 + 0.8 * fbmA(u * 0.5 + 0.13);
      const reach = rM * (1.12 + eq * (0.7 + 1.7 * nz * big) + (1 - eq) * 0.28 * nz);
      const alpha = (0.018 + 0.05 * nz) * (0.35 + 0.65 * eq);
      const curl = (fbmA(u * 3 + 0.5) - 0.5) * 0.10 * (reach / rM);
      const x0 = Math.cos(th) * rM * 0.98, y0 = Math.sin(th) * rM * 0.98;
      const x1 = Math.cos(th + curl) * reach, y1 = Math.sin(th + curl) * reach;
      const lg = c.createLinearGradient(x0, y0, x1, y1);
      lg.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(4)})`);
      lg.addColorStop(1, 'rgba(210,222,255,0)');
      c.strokeStyle = lg;
      c.lineWidth = rM * (0.006 + 0.012 * nz);
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
    // short polar brushes
    let seed = 7; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (const pole of [axis + Math.PI / 2, axis + Math.PI * 1.5]) {
      for (let i = 0; i < 29; i++) {
        const a = pole + (rnd() - 0.5) * 0.9;
        const len = rM * (1.08 + 0.30 * fbmA(i * 0.07 + 0.3));
        const x0 = Math.cos(a) * rM * 0.98, y0 = Math.sin(a) * rM * 0.98;
        const x1 = Math.cos(a) * len, y1 = Math.sin(a) * len;
        const lg = c.createLinearGradient(x0, y0, x1, y1);
        lg.addColorStop(0, 'rgba(235,240,255,0.05)'); lg.addColorStop(1, 'rgba(235,240,255,0)');
        c.strokeStyle = lg; c.lineWidth = rM * 0.008;
        c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      }
    }
    // two broad equatorial lobes
    for (const s of [axis, axis + Math.PI]) {
      c.save(); c.rotate(s);
      const len = rM * 3.6;
      const lg = c.createLinearGradient(rM, 0, len, 0);
      lg.addColorStop(0, 'rgba(245,247,255,0.05)'); lg.addColorStop(1, 'rgba(245,247,255,0)');
      c.fillStyle = lg;
      c.beginPath(); c.moveTo(rM * 0.95, -rM * 0.42); c.lineTo(len, 0); c.lineTo(rM * 0.95, rM * 0.42); c.closePath(); c.fill();
      c.restore();
    }
  }

  // Device-pixel size for the baked Moon discs — tracks the on-screen disc
  // (≈0.33·min(cw,ch) CSS px) so it stays crisp on wide panels at DPR 2.
  function moonSpriteSize() {
    return Math.max(128, Math.min(640, Math.ceil(Math.min(cw, ch) * 0.34 * DPR)));
  }

  // The Moon's night side: the real surface crushed to ~6% luminance, with limb
  // darkening — faint earthshine mare instead of a flat black sticker.
  function buildMoonDark() {
    const S = moonSpriteSize(), r = S / 2;
    moonDarkCv = document.createElement('canvas');
    moonDarkCv.width = moonDarkCv.height = S;
    const c = moonDarkCv.getContext('2d');
    c.beginPath(); c.arc(r, r, r, 0, 7); c.closePath(); c.clip();
    if (moonReady && moonImg.width) {
      const s = moonImg.height, sx = (moonImg.width - s) / 2;
      c.drawImage(moonImg, sx, 0, s, s, 0, 0, S, S);
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = 'rgba(6,9,18,0.93)';
      c.fillRect(0, 0, S, S);
    } else {
      c.fillStyle = '#060912'; c.fillRect(0, 0, S, S);
    }
    c.globalCompositeOperation = 'source-atop';
    const lg = c.createRadialGradient(r, r, r * 0.5, r, r, r);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.6)');
    c.fillStyle = lg; c.fillRect(0, 0, S, S);
  }

  // The full-Moon base for the lunar view: texture + limb darkening + a cool
  // moonlight cast. One drawImage per frame replaces the old per-frame crop.
  function buildMoonBase() {
    const S = moonSpriteSize(), r = S / 2;
    moonBaseCv = document.createElement('canvas');
    moonBaseCv.width = moonBaseCv.height = S;
    const c = moonBaseCv.getContext('2d');
    c.beginPath(); c.arc(r, r, r, 0, 7); c.closePath(); c.clip();
    if (moonReady && moonImg.width) {
      const s = moonImg.height, sx = (moonImg.width - s) / 2;
      c.drawImage(moonImg, sx, 0, s, s, 0, 0, S, S);
    } else {
      const gd = c.createRadialGradient(r * 0.7, r * 0.7, r * 0.2, r, r, r);
      gd.addColorStop(0, '#e8e8ea'); gd.addColorStop(1, '#9a99a0');
      c.fillStyle = gd; c.fillRect(0, 0, S, S);
    }
    const sh = c.createRadialGradient(r - r * 0.28, r - r * 0.3, r * 0.2, r, r, r * 1.04);
    sh.addColorStop(0, 'rgba(255,255,255,0.10)');
    sh.addColorStop(0.62, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = sh; c.fillRect(0, 0, S, S);
    c.globalCompositeOperation = 'screen';
    c.fillStyle = 'rgba(210,222,255,0.06)';
    c.fillRect(0, 0, S, S);
  }

  // Lunar-night starfield rendered once: soft gaussian sprites, some tinted.
  function buildStarField() {
    starFieldCv = document.createElement('canvas');
    starFieldCv.width = Math.max(1, Math.round(cw * DPR));
    starFieldCv.height = Math.max(1, Math.round(ch * DPR));
    const c = starFieldCv.getContext('2d');
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (const s of lunarStars) {
      const x = s.x * cw, y = s.y * ch * 0.8, rr = s.r * 2.2;
      const gd = c.createRadialGradient(x, y, 0, x, y, rr);
      gd.addColorStop(0, rgb(s.tint, s.a));
      gd.addColorStop(0.5, rgb(s.tint, s.a * 0.35));
      gd.addColorStop(1, rgb(s.tint, 0));
      c.fillStyle = gd; c.beginPath(); c.arc(x, y, rr, 0, 7); c.fill();
    }
  }

  // ------------------------------------------------------------- enter / exit
  function enter(kind) {
    type = kind; active = true; t = 0; playing = true;
    document.body.classList.add('eclipse-mode');
    ui.dataset.type = kind;
    $('ecl-title').textContent = tr(DESCRIPTION_KEYS[kind].title);
    $('ecl-type').textContent = tr(DESCRIPTION_KEYS[kind].type);
    $('ecl-desc').innerHTML = tr(DESCRIPTION_KEYS[kind].html);
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
  const darkBrick = new THREE.Color(0x1a0d07);
  const white = new THREE.Color(0xffffff);
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  const sunPos = new THREE.Vector3(SUN_X, 0, 0);
  const _q = new THREE.Quaternion();
  const _d = new THREE.Vector3();
  function updateRig() {
    sunUniforms.uTime.value = clock;
    if (umbra && penumbra) {
      umbra.material.uniforms.uTime.value = clock;
      penumbra.material.uniforms.uTime.value = clock;
    }
    const mp = moonPos(type, t);
    moon.position.copy(mp);
    if (type === 'solar') {
      moonMat.color.setHex(0xf4ede2); moonMat.emissive.setRGB(0, 0, 0);
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
      // Darken the lit surface toward brick while the crater texture keeps
      // modulating the copper emissive — never a uniform rusty ball.
      moonMat.color.copy(white).lerp(darkBrick, inside * 0.75);
      moonMat.emissive.copy(copper).multiplyScalar(inside * 1.5);
    }
    moon.rotation.y = t * 0.4;
    earth.rotation.y = t * 0.5;
    clouds.rotation.y = t * 0.55;
  }

  // ------------------------------------------------------------- POV geometry
  function solarGeom() {
    const cx = cw / 2, cy = ch * 0.40;   // higher up → room for the glare below
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

  function diskBlack(x, y, r) { g.fillStyle = '#050507'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  // The Moon silhouette with faint earthshine detail (falls back to flat black).
  function drawMoonDark(x, y, r) {
    if (moonDarkCv) g.drawImage(moonDarkCv, x - r, y - r, 2 * r, 2 * r);
    else diskBlack(x, y, r);
  }

  function drawPOV() {
    g.clearRect(0, 0, cw, ch);
    if (type === 'solar') drawSolar(); else drawLunar();
    drawLandscape();   // foreground horizon silhouette ("from Earth's surface")
    drawGrain();       // subtle film grain → kills the flat plastic look
    drawVignette();    // cinematic vignette
  }

  // Three hazed ridgelines instead of one flat black polygon: a sky-tinted far
  // ridge, a mid ridge and a black foreground, each with a soft haze band.
  const RIDGES = [
    { y: 0.800, jag: 0.010, col: '#1a2030', haze: [120, 140, 180], hazeA: 0.35, seed: 0.0 },
    { y: 0.835, jag: 0.020, col: '#0a0d16', haze: [60, 70, 100], hazeA: 0.25, seed: 3.7 },
    { y: 0.870, jag: 0.034, col: '#000000', haze: null, hazeA: 0, seed: 7.9 },
  ];
  function drawLandscape() {
    for (const rd of RIDGES) {
      const hy = ch * rd.y;
      if (rd.haze) {
        let hcol = rd.haze;
        if (horizonWarm > 0.03 && rd === RIDGES[0]) hcol = lerpC(rd.haze, [255, 140, 80], horizonWarm * 0.8);
        const hz = g.createLinearGradient(0, hy - ch * 0.05, 0, hy);
        hz.addColorStop(0, rgb(hcol, 0)); hz.addColorStop(1, rgb(hcol, rd.hazeA));
        g.fillStyle = hz; g.fillRect(0, hy - ch * 0.05, cw, ch * 0.05);
      }
      g.fillStyle = rd.col;
      g.beginPath(); g.moveTo(0, ch);
      for (let i = 0; i <= 10; i++) {
        const fx = i / 10;
        const fy = (fbmA(fx * 2.3 + rd.seed) - 0.5) * 2 * rd.jag;
        g.lineTo(fx * cw, hy + fy * ch);
      }
      g.lineTo(cw, ch); g.closePath(); g.fill();
    }
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
    const k = 1 - 0.65 * tw;                              // overall exposure falls with coverage
    const top = lerpC([70, 124, 205], [14, 18, 40], tw).map((v) => Math.round(v * k));
    const mid = lerpC([120, 165, 222], [26, 34, 66], tw).map((v) => Math.round(v * k));
    const hor = lerpC([200, 214, 236], [70, 60, 86], tw).map((v) => Math.round(v * k));
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
    // Deep totality: the shadow edge glows warm on EVERY horizon, not just
    // below. Soft radial pools at the horizon corners — never a hard band.
    const S = clamp((I - 0.55) / 0.45, 0, 1);
    if (S > 0.02) {
      for (const gx of [0, cw]) {
        const rg = g.createRadialGradient(gx, hy, 0, gx, hy, ch * 0.55);
        rg.addColorStop(0, `rgba(255,120,50,${0.26 * S})`);
        rg.addColorStop(0.5, `rgba(255,110,45,${0.09 * S})`);
        rg.addColorStop(1, 'rgba(255,110,45,0)');
        g.fillStyle = rg; g.beginPath(); g.arc(gx, hy, ch * 0.55, 0, 7); g.fill();
      }
    }
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
    for (const s of solarStars) { g.fillStyle = rgb(s.tint, +(s.a * I).toFixed(3)); g.beginPath(); g.arc(s.x * cw, s.y * ch * 0.82, s.r, 0, 7); g.fill(); }
    planetDot(cx + R * 3.1, cy - R * 1.9, 2.6, I, '255,250,235');   // Venus
    planetDot(cx - R * 3.6, cy + R * 1.5, 2.1, I, '255,238,205');   // Jupiter
  }

  // --- The Sun (partial phase) -------------------------------------------
  // Tight glare that SHRINKS as coverage grows, so the crescent becomes
  // readable, plus four soft diffraction spikes. Replaces the old huge halo +
  // full-frame veil + white blowout (the "flat grey wash").
  function drawSunGlare(ox, oy, R, B) {
    B = clamp(B, 0, 1); if (B <= 0.02) return;
    g.save(); g.globalCompositeOperation = 'lighter';
    const rad = R * (1.6 + 3.4 * B);
    const gr = g.createRadialGradient(ox, oy, 0, ox, oy, rad);
    gr.addColorStop(0, `rgba(255,255,252,${0.95 * B})`);
    gr.addColorStop(0.10, `rgba(255,250,235,${0.55 * B})`);
    gr.addColorStop(0.35, `rgba(255,240,210,${0.18 * B})`);
    gr.addColorStop(1, 'rgba(255,240,210,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(ox, oy, rad, 0, 7); g.fill();
    const sp = R * (2.2 + 2.4 * B);
    for (const a of [0, Math.PI / 2]) {
      g.save(); g.translate(ox, oy); g.rotate(a);
      const lg = g.createLinearGradient(-sp, 0, sp, 0);
      lg.addColorStop(0, 'rgba(255,250,240,0)');
      lg.addColorStop(0.5, `rgba(255,250,240,${0.10 * B})`);
      lg.addColorStop(1, 'rgba(255,250,240,0)');
      g.fillStyle = lg; g.fillRect(-sp, -R * 0.02, 2 * sp, R * 0.04);
      g.restore();
    }
    g.restore();
  }
  // A brilliant white-hot disk with a defined edge, so the crescent reads during
  // the partial phase.
  function drawSunDisk(cx, cy, R) {
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
    diskTexture(sunImg, sunReady, cx, cy, R, '#ffe0b0', '#ff9b30');
    g.globalCompositeOperation = 'lighter';
    const wr = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    wr.addColorStop(0, 'rgba(255,255,255,0.92)');
    wr.addColorStop(0.6, 'rgba(255,250,235,0.35)');
    wr.addColorStop(1, 'rgba(255,238,205,0.4)');
    g.fillStyle = wr; g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    g.globalCompositeOperation = 'source-over'; g.restore();
  }

  // --- Corona: one precomputed sprite (see buildCorona) --------------------
  function drawCoronaSprite(x, y, r, alpha = 1) {
    if (!coronaCv) return;
    g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = alpha;
    g.drawImage(coronaCv, x - 4 * r, y - 4 * r, 8 * r, 8 * r);
    g.restore();
  }
  function chromosphere(x, y, r, I) {                     // crimson arc at the limb
    I = clamp(I, 0, 1); if (I <= 0.03) return;
    g.save(); g.globalCompositeOperation = 'lighter';
    g.strokeStyle = `rgba(255,40,40,${0.4 * I})`; g.lineWidth = Math.max(2.2, r * 0.09);
    g.beginPath(); g.arc(x, y, r * 1.004, 0, 7); g.stroke();
    g.strokeStyle = `rgba(255,120,110,${0.9 * I})`; g.lineWidth = Math.max(1.0, r * 0.02);
    g.beginPath(); g.arc(x, y, r * 1.004, 0, 7); g.stroke();
    g.restore();
  }
  function drawProminences(x, y, r) {                     // red flame loops
    const proms = [[0.55, 1.0], [2.2, 1.3], [3.5, 0.7], [4.7, 1.0], [5.6, 0.6]];
    g.save(); g.globalCompositeOperation = 'lighter';
    for (const [a, sf] of proms) {
      const px = x + Math.cos(a) * r * 1.004, py = y + Math.sin(a) * r * 1.004, s = r * 0.05 * sf;
      const gd = g.createRadialGradient(px, py, 0, px, py, s * 2.8);
      gd.addColorStop(0, 'rgba(255,150,140,1)'); gd.addColorStop(0.5, 'rgba(255,45,45,0.5)'); gd.addColorStop(1, 'rgba(255,30,30,0)');
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
      const wide = g.createRadialGradient(bx, by, 0, bx, by, s * 6);   // photographic bloom
      wide.addColorStop(0, 'rgba(255,250,240,0.15)'); wide.addColorStop(1, 'rgba(255,250,240,0)');
      g.fillStyle = wide; g.beginPath(); g.arc(bx, by, s * 6, 0, 7); g.fill();
      const gd = g.createRadialGradient(bx, by, 0, bx, by, s * 3);
      gd.addColorStop(0, 'rgba(255,255,255,1)');
      gd.addColorStop(0.06, 'rgba(255,255,250,0.9)');
      gd.addColorStop(0.25, 'rgba(255,240,210,0.35)');
      gd.addColorStop(1, 'rgba(255,245,215,0)');
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
    const wide = g.createRadialGradient(bx, by, 0, bx, by, sz * 2);   // photographic bloom
    wide.addColorStop(0, `rgba(255,250,240,${0.2 * flash})`); wide.addColorStop(1, 'rgba(255,250,240,0)');
    g.fillStyle = wide; g.beginPath(); g.arc(bx, by, sz * 2, 0, 7); g.fill();
    const dg = g.createRadialGradient(bx, by, 0, bx, by, sz);
    dg.addColorStop(0, 'rgba(255,255,255,1)');
    dg.addColorStop(0.12, 'rgba(255,252,240,0.7)');
    dg.addColorStop(0.5, `rgba(255,246,222,${0.2 * flash})`);
    dg.addColorStop(1, 'rgba(255,244,216,0)');
    g.fillStyle = dg; g.beginPath(); g.arc(bx, by, sz, 0, 7); g.fill();
    // glint streaks: hot in the middle, fading to the tips
    const fl = R * (0.8 + 0.8 * flash);
    for (const rot of [0, Math.PI / 2]) {
      g.save(); g.translate(bx, by); g.rotate(rot);
      const lg = g.createLinearGradient(-fl, 0, fl, 0);
      lg.addColorStop(0, 'rgba(255,255,250,0)');
      lg.addColorStop(0.5, `rgba(255,255,250,${0.75 * flash})`);
      lg.addColorStop(1, 'rgba(255,255,250,0)');
      g.strokeStyle = lg; g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(-fl, 0); g.lineTo(fl, 0); g.stroke();
      g.restore();
    }
    g.restore();
  }

  function drawCrescentBloom(cx, cy, R, mx, my, B, c) {   // bright sunlight bleeding over the Moon's edge
    const w = clamp(c * 4, 0, 1) * B; if (w <= 0.02) return;
    const ux = cx - mx, uy = cy - my, ul = Math.hypot(ux, uy) || 1;
    const px = cx + (ux / ul) * R * 0.85, py = cy + (uy / ul) * R * 0.85;
    const rad = R * 1.25 * (0.4 + 0.6 * B);
    g.save(); g.globalCompositeOperation = 'lighter';
    const gr = g.createRadialGradient(px, py, 0, px, py, rad);
    gr.addColorStop(0, `rgba(255,255,255,${0.7 * w})`);
    gr.addColorStop(0.5, `rgba(246,249,255,${0.2 * w})`);
    gr.addColorStop(1, 'rgba(246,249,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(px, py, rad, 0, 7); g.fill();
    g.restore();
  }

  function drawSolar() {
    const { cx, cy, R, rM, mx, my, sep } = solarGeom();
    const c = clamp((R + rM - sep) / (2 * R), 0, 1);          // ~coverage of the Sun
    const isTotal = !annular && sep <= (rM - R);
    const gap = sep - (rM - R);                                // >0 partial, ≤0 total
    // Perceptual dimming: the eye barely notices until ~60% coverage, then the
    // light drains fast (annular never gets fully dark — a ring remains).
    const dusk = Math.pow(clamp((c - 0.55) / 0.45, 0, 1), 1.6) * (annular ? 0.55 : 1);
    const tw = isTotal ? 1 : dusk;
    horizonWarm = tw;

    drawSolarSky(tw);
    drawHorizonGlow(tw);
    drawSolarStars(isTotal ? 1 : clamp((tw - 0.45) * 1.8, 0, 1), cx, cy, R);

    if (isTotal) {
      const depth = clamp(((rM - R) - sep) / Math.max(0.0001, rM - R), 0, 1);  // 0 at edge → 1 deep
      drawCoronaSprite(mx, my, rM, 1);
      drawMoonDark(mx, my, rM);
      drawProminences(mx, my, rM);
      chromosphere(mx, my, rM, clamp(1 - depth * 2.2, 0, 1));   // crimson arc only near the edges of totality
      return;
    }

    const B = Math.pow(1 - c, 0.25);   // remaining sunlight stays high until near totality
    const ux = cx - mx, uy = cy - my, ul = Math.hypot(ux, uy) || 1;   // toward the bright crescent
    const ox = cx + (ux / ul) * R * 0.55 * c, oy = cy + (uy / ul) * R * 0.55 * c;

    drawSunGlare(ox, oy, R, B);        // tight glare + diffraction spikes
    drawSunDisk(cx, cy, R);            // overexposed white-hot disk
    // Moon silhouette (earthshine texture, veiled) — clipped to the Sun's disc:
    // to the naked eye the Moon is only visible as a bite out of the Sun, never
    // as a dark disc floating in the bright sky.
    if (sep < R + rM) {
      g.save(); g.beginPath(); g.arc(cx, cy, R * 1.002, 0, 7); g.clip();
      drawMoonDark(mx, my, rM);
      g.fillStyle = 'rgba(6,8,14,0.4)'; g.beginPath(); g.arc(mx, my, rM, 0, 7); g.fill();
      // warm rim where sunlight grazes the Moon's edge
      const ra = Math.atan2(cy - my, cx - mx);
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(255,190,120,${0.25 * B})`; g.lineWidth = Math.max(1, rM * 0.02);
      g.beginPath(); g.arc(mx, my, rM * 1.01, ra - 1.05, ra + 1.05); g.stroke();
      g.restore();
    }
    drawCrescentBloom(cx, cy, R, mx, my, B, c);   // bright crescent bleeds over the Moon's edge

    // Last/first moments: inner corona emerges, then Baily's beads → diamond ring.
    if (!annular && gap < R * 0.18) {
      drawCoronaSprite(mx, my, rM, clamp(1 - gap / (R * 0.18), 0, 1) * 0.6);
      drawMoonDark(mx, my, rM);              // keep the Moon dark over the corona's inner glow
      if (gap < R * 0.05) diamondRing(cx, cy, R, rM, mx, my, gap);
      else bailysBeads(cx, cy, R, rM, mx, my, gap);
    }
  }

  function drawLunar() {
    const { cx, cy, R, umbraR, penumbraR, sx, sy, d } = lunarGeom();
    horizonWarm = 0;
    const u1 = umbraR - R, u2 = umbraR + R;
    const partialFrac = clamp((u2 - d) / (u2 - u1), 0, 1);   // 0 outside umbra → 1 fully inside
    const bright = 1 - partialFrac;                          // remaining direct moonlight
    const dl = Math.hypot(cx - sx, cy - sy) || 1;
    const dirx = (cx - sx) / dl, diry = (cy - sy) / dl;      // shadow centre → moon centre

    // Sky: near a full Moon it is blue-grey, deepening as the light dies.
    const top = lerpC([16, 24, 46], [3, 5, 13], partialFrac);
    const mid = lerpC([9, 13, 28], [2, 3, 9], partialFrac);
    const bot = lerpC([12, 15, 30], [4, 5, 12], partialFrac);
    const sky = g.createLinearGradient(0, 0, 0, ch);
    sky.addColorStop(0, rgb(top)); sky.addColorStop(0.55, rgb(mid)); sky.addColorStop(1, rgb(bot));
    g.fillStyle = sky; g.fillRect(0, 0, cw, ch);
    const sg = g.createRadialGradient(cx, cy, 0, cx, cy, R * 6);
    sg.addColorStop(0, `rgba(120,140,190,${(0.10 * bright).toFixed(3)})`);
    sg.addColorStop(1, 'rgba(120,140,190,0)');
    g.fillStyle = sg; g.fillRect(0, 0, cw, ch);

    // Stars wash out beside the full Moon and pop during totality.
    if (starFieldCv) {
      g.save(); g.globalAlpha = 0.35 + 0.65 * partialFrac;
      g.drawImage(starFieldCv, 0, 0, cw, ch);
      g.restore();
    }

    // Halos behind the disc: cool moonlight halo + a faint copper one at totality.
    const haloR = R * (1.7 + 1.6 * bright);
    const halo = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, haloR);
    halo.addColorStop(0, `rgba(214,224,255,${(0.04 + 0.16 * bright).toFixed(3)})`);
    halo.addColorStop(1, 'rgba(214,224,255,0)');
    g.fillStyle = halo; g.beginPath(); g.arc(cx, cy, haloR, 0, 7); g.fill();
    if (partialFrac > 0.02) {
      const cop = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.4);
      cop.addColorStop(0, `rgba(150,50,24,${(0.12 * partialFrac).toFixed(3)})`);
      cop.addColorStop(1, 'rgba(150,50,24,0)');
      g.fillStyle = cop; g.beginPath(); g.arc(cx, cy, R * 1.4, 0, 7); g.fill();
    }

    // The disc: real surface, then the shadow as three luminance-preserving
    // passes over it (multiply colour field / screen limb-lift / copper glow) —
    // the craters stay visible all the way through totality.
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.closePath(); g.clip();
    if (moonBaseCv) g.drawImage(moonBaseCv, cx - R, cy - R, 2 * R, 2 * R);
    else diskTexture(moonImg, moonReady, cx, cy, R, '#e8e8ea', '#9a99a0');
    g.globalCompositeOperation = 'multiply';
    const A = g.createRadialGradient(sx, sy, 0, sx, sy, penumbraR);
    // The umbra edge is a WIDE fuzzy smear (real shadow edges are never crisp):
    // brick → copper → neutral spread over roughly 1.5 moon radii.
    A.addColorStop(0, 'rgb(84,34,26)');          // deepest umbra: dark brick
    A.addColorStop(0.30, 'rgb(122,50,30)');
    A.addColorStop(0.42, 'rgb(168,84,48)');
    A.addColorStop(0.52, 'rgb(205,140,100)');
    A.addColorStop(0.62, 'rgb(228,205,190)');
    A.addColorStop(0.75, 'rgb(244,242,242)');
    A.addColorStop(1, 'rgb(255,255,255)');
    g.fillStyle = A; g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    if (bright > 0.01) {
      g.globalCompositeOperation = 'screen';
      const B = g.createRadialGradient(sx, sy, 0, sx, sy, penumbraR);
      B.addColorStop(0, 'rgba(255,255,255,0)');
      B.addColorStop(0.52, 'rgba(255,255,255,0)');
      B.addColorStop(0.66, `rgba(255,252,248,${(0.10 * bright).toFixed(3)})`);
      B.addColorStop(0.82, `rgba(255,255,255,${(0.26 * bright).toFixed(3)})`);
      B.addColorStop(1, `rgba(255,255,255,${(0.42 * bright).toFixed(3)})`);
      g.fillStyle = B; g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    }
    if (partialFrac > 0.02) {
      g.globalCompositeOperation = 'lighter';
      const C = g.createRadialGradient(sx, sy, 0, sx, sy, umbraR * 0.9);
      C.addColorStop(0, `rgba(120,34,14,${(0.35 * partialFrac).toFixed(3)})`);
      C.addColorStop(1, 'rgba(120,34,14,0)');
      g.fillStyle = C; g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    }
    g.restore();

    // Overexposure bloom at the still-lit limb, bleeding past the disc edge.
    if (bright > 0.02) {
      const bx = cx + dirx * R, by = cy + diry * R;
      g.save(); g.globalCompositeOperation = 'lighter';
      const fb = g.createRadialGradient(bx, by, 0, bx, by, R * 1.3);
      fb.addColorStop(0, `rgba(255,253,250,${(0.30 * bright).toFixed(3)})`);
      fb.addColorStop(0.4, `rgba(255,250,240,${(0.10 * bright).toFixed(3)})`);
      fb.addColorStop(1, 'rgba(255,250,240,0)');
      g.fillStyle = fb; g.beginPath(); g.arc(bx, by, R * 1.3, 0, 7); g.fill();
      g.restore();
    }
  }

  // --------------------------------------------------------------- phase text
  function updatePhase() {
    let name = '—', pct = '';
    if (type === 'solar') {
      const { R, rM, sep } = solarGeom();
      const covered = Math.min(1, Math.max(0, (R + rM - sep) / (2 * R)));
      pct = fmt('eclPctCovered', { pct: Math.round(covered * 100) });
      if (!annular && sep <= rM - R) name = tr('eclPhaseSolarTotal');
      else if (annular && sep <= R - rM) name = tr('eclPhaseSolarAnnular');
      else if (sep >= R + rM) name = tr('eclPhaseBeforeAfter');
      else name = tr(t < 0.5 ? 'eclPhasePartialBeginning' : 'eclPhasePartialEnding');
      if (Math.abs(t - 0.5) < 0.012) name = tr(annular ? 'eclPhaseSolarMaxAnnular' : 'eclPhaseSolarMaxTotal');
    } else {
      const { R, umbraR, penumbraR, d } = lunarGeom();
      if (d <= umbraR - R) name = tr('eclPhaseLunarTotal');
      else if (d <= umbraR + R) name = tr('eclPhaseLunarPartial');
      else if (d <= penumbraR + R) name = tr('eclPhaseLunarPenumbral');
      else name = tr('eclPhaseBeforeAfter');
      const into = Math.min(1, Math.max(0, (umbraR + R - d) / (2 * R)));
      pct = fmt('eclPctInUmbra', { pct: Math.round(into * 100) });
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
    clock += dt;
    if (playing) { t += dt / DURATION; if (t > 1) t -= 1; scrub.value = Math.round(t * 1000); }
    updateRig();
    drawPOV();
    updatePhase();
  }

  return { enter, exit, update, togglePlay, isActive: () => active };
}

// Soft radial glow used by the rig Sun sprite (tighter than before — the wide
// halo now comes from the bloom pass and the fresnel shell).
function makeGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,240,205,0.9)');
  grad.addColorStop(0.35, 'rgba(255,205,120,0.35)');
  grad.addColorStop(1, 'rgba(255,150,40,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

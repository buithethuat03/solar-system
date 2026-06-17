// ============================================================================
//  bodies.js  —  Builds every 3D object in the scene and updates them.
// ============================================================================
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SUN, PLANETS, MOONS, BELTS, CONFIG, VOYAGERS } from './data.js';
import { scenePosition, orbitPoints, makeDistanceFn, voyagerScenePosition } from './kepler.js';

const TWO_PI = Math.PI * 2;
const MIN_RADIUS = 0.34;          // minimum visible radius for tiny bodies
const ROCKY = new Set(['mercury', 'venus', 'mars', 'pluto']);   // get albedo-based bump relief
const DEG2RAD = Math.PI / 180;
// Calibration so Earth's prime meridian lines up with the texture (tuned visually).
const EARTH_PHASE = 0;
// Galactic drift (live "accurate" view): the whole system translates through space.
// Direction is tilted like the real ecliptic-vs-galactic motion; the rate is
// stylised so the planets trace visible helices (true galactic motion is ~45 AU/yr,
// far too fast to render as a spiral).
const DRIFT_DIR = new THREE.Vector3(0.52, 0.80, 0.30).normalize();
// Drift rate scales with the true-scale ruler so the accurate-view helices keep
// the same look they had when an AU was 140 units (now it is ~37,570).
const DRIFT_RATE = CONFIG.DIST_REAL_K * (0.62 / 140);   // scene-units per simulated day
// Trails are sampled by SIMULATED TIME (not frame rate). Each body shows ~3
// orbits of wake (the Sun: 10 years of drift), and its point count is set by
// TRAIL_DENSITY (samples per orbit) so the segment angle is ~1° for EVERY body
// — fast inner planets included — without wasting points on the straight Sun
// wake or the slow outer planets. (The old "3-year floor" crammed ~12 Mercury
// orbits into 420 uniform pts → a broken ~14°/segment polygon when zoomed in.)
const TRAIL_DENSITY = 400;            // samples per orbit  (~0.9°/segment)
const TRAIL_MAX_POINTS = 1400;        // safety clamp for the per-trail count
const SUN_TRAIL_DAYS = 10 * 365.25;
// Cap the wake length (in sim-days) to ~10 years. At true scale an un-capped
// multi-orbit trail for an outer body spans tens of millions of units, which
// clutters the view and loses precision; 10 yr is a long but clean local wake.
const MAX_TRAIL_DAYS = 10 * 365.25;

// Voyager rendering. A real spacecraft is ~10 m across — at true scale (1 unit ≈
// 3,982 km) that is ~2.5e-6 units, far below a pixel. The model size depends on
// how close the camera is to the craft, in three regimes (smoothly blended):
//   • INSPECT  (d ≤ VOY_INSPECT_DIST): a fixed-size gizmo (VOY_INSPECT_UNITS) you
//     can examine — smaller than any giant planet, so it never engulfs one, and
//     it grows as you dolly in. This is where the focus/follow button lands.
//   • REAL     (mid range): the true physical size — a sub-pixel speck, correctly
//     dwarfed by the planets when you are looking at a planet from outside.
//   • ICON     (d ≥ VOY_ICON_DIST): a small constant on-screen locator so the
//     craft is findable in a whole-system view.
// The text label is drawn at every zoom, so the craft is always locatable even
// when its model is too small to see. So: click the craft → fly in → inspect it;
// pull back out → it shrinks to its honest size next to the planets.
const VOY_TRUE_RADIUS_M  = 10;       // Voyager bounding radius in metres (~13 m boom span)
const VOY_KM_PER_UNIT    = CONFIG.KM_PER_AU / CONFIG.DIST_REAL_K;          // ≈ 3,982 km/unit
const VOY_TRUE_UNITS     = (VOY_TRUE_RADIUS_M / 1000) / VOY_KM_PER_UNIT;   // real model radius (≈ 2.5e-6 u)
const VOY_INSPECT_DIST   = 12;       // camera within this (≈ 48,000 km) → inspect gizmo
const VOY_INSPECT_UNITS  = 2.7;      // inspect-gizmo world radius (≈ 10,700 km; < any giant planet)
const VOY_ICON_DIST      = 150000;   // camera beyond this (≈ 4 AU) → small locator icon
const VOY_ICON_FRAC      = 0.04;     // locator radius as a fraction of viewport half-height
const VOY_BLEND          = 4;        // multiplicative width of the smoothstep transitions
const VOY_FOCUS_RADIUS   = 2;        // focus framing radius → lands inside the inspect range (≈ 11 u)

// Texture resolution. 'low' = the default 2K set in textures/; 'high' = the
// high-res (up to 8K) set in textures/8k/ with identical file names. Every
// texture load goes through resolveTexture() so a single switch re-points them.
let TEX_RES = 'low';
export function resolveTexture(path) {
  return TEX_RES === 'high' ? path.replace(/^textures\//, 'textures/8k/') : path;
}
// Always use the high-res (8K) set, regardless of the toggle — for the visually
// dominant "hero" surfaces (the Milky-Way sky and Earth) we want them crisp at
// all times, even in the lightweight 2K mode.
export function highResTexture(path) {
  return path.replace(/^textures\//, 'textures/8k/');
}

// ---------------------------------------------------------------------------
//  Galactic-plane geometry — so the Milky Way sits where it really is.
// ---------------------------------------------------------------------------
// The band of the Milky Way lies on the galactic plane, inclined ~60.2° to the
// ecliptic, with its bright bulge toward the Galactic Centre in Sagittarius.
// These are the standard J2000 equatorial directions; we convert them into the
// scene frame using the SAME ecliptic→three.js mapping kepler.js uses, so the
// real photo can be rotated off the ecliptic and onto the true galactic plane.
const ECL_OBLIQUITY = 23.4392911 * DEG2RAD;     // mean obliquity of the ecliptic at J2000
const NGP_RA = 192.85948, NGP_DEC = 27.12825;   // North Galactic Pole (J2000)
const GC_RA  = 266.40499, GC_DEC = -28.93617;   // Galactic Centre / Sgr A* (J2000)

// Equatorial RA/Dec (deg) → unit direction in the scene's coordinate frame.
function equatorialToScene(raDeg, decDeg) {
  const ra = raDeg * DEG2RAD, dec = decDeg * DEG2RAD;
  const xe = Math.cos(dec) * Math.cos(ra);
  const ye = Math.cos(dec) * Math.sin(ra);
  const ze = Math.sin(dec);
  // equatorial → ecliptic (rotate about the vernal-equinox axis by the obliquity)
  const c = Math.cos(ECL_OBLIQUITY), s = Math.sin(ECL_OBLIQUITY);
  const xc = xe, yc = ye * c + ze * s, zc = -ye * s + ze * c;
  // ecliptic (X,Y,Z) → scene (X, Z, -Y)  — identical to kepler.js
  return new THREE.Vector3(xc, zc, -yc);
}

// ---------------------------------------------------------------------------
//  Small texture helpers
// ---------------------------------------------------------------------------
function radialGlowTexture(inner = 'rgba(255,240,200,1)', outer = 'rgba(255,150,40,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0.0, inner);
  grad.addColorStop(0.25, 'rgba(255,210,120,0.55)');
  grad.addColorStop(1.0, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Soft round sprite for stars (white core, smooth falloff -> no square dots).
function starSpriteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.22, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.32)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Realistic stellar colours by spectral class, weighted toward white/yellow.
const STAR_PALETTE = [
  [0.61, 0.72, 1.0],                                   // O/B blue
  [0.79, 0.85, 1.0], [0.79, 0.85, 1.0],                // A blue-white
  [1.0, 1.0, 1.0], [1.0, 1.0, 1.0], [1.0, 1.0, 1.0],   // F/white
  [1.0, 0.96, 0.86], [1.0, 0.96, 0.86],                // G yellow-white (Sun-like)
  [1.0, 0.91, 0.74],                                   // K yellow-orange
  [1.0, 0.8, 0.62], [1.0, 0.72, 0.58],                 // M orange/red
];

// Build a deep, color-varied star field on a large shell.
function buildStarfield(scene, count, rInner, rOuter, dpr) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const siz = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = rInner + Math.random() * (rOuter - rInner);
    const th = Math.random() * TWO_PI, ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph);
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    const c = STAR_PALETTE[(Math.random() * STAR_PALETTE.length) | 0];
    let bright = 0.25 + Math.pow(Math.random(), 2.6) * 0.50;
    let size = 0.8 + Math.pow(Math.random(), 3.2) * 3.4;
    if (Math.random() < 0.010) { bright = 0.85; size += 2.6; }   // rare bright stars
    col[i * 3] = c[0] * bright; col[i * 3 + 1] = c[1] * bright; col[i * 3 + 2] = c[2] * bright;
    siz[i] = size * dpr;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('sColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(siz, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: starSpriteTexture() } },
    // logdepthbuf_* chunks: custom shaders must opt in to the logarithmic depth
    // buffer, otherwise they write linear depth and fail the depth test/sort.
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float size; attribute vec3 sColor; varying vec3 vColor;
      void main(){
        vColor = sColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D uTex; varying vec3 vColor;
      void main(){
        vec4 t = texture2D(uTex, gl_PointCoord);
        gl_FragColor = vec4(vColor * t.rgb, t.a);
        #include <logdepthbuf_fragment>
      }`,
    transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return pts;
}

// Procedural Pluto-like map (Pluto ships without a real photo texture). Renders
// its recognisable features: the dark-red equatorial belt (Cthulhu Macula), the
// bright nitrogen-ice "heart" (Tombaugh Regio) and pale frost poles. Artistic.
function proceduralPlanet(seedColor = [200, 180, 150]) {
  const w = 1024, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  let s = 1234.5;
  const rnd = () => { s = Math.sin(s * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
  // Soft elliptical blob with a radial falloff (centre opaque → edge transparent).
  const blob = (x, y, rx, ry, rot, r, gg, b, a) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.scale(rx, ry);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grd.addColorStop(0, `rgba(${r},${gg},${b},${a})`);
    grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grd; g.beginPath(); g.arc(0, 0, 1, 0, TWO_PI); g.fill(); g.restore();
  };
  // Base tan + fine mottling.
  g.fillStyle = `rgb(${seedColor[0]},${seedColor[1]},${seedColor[2]})`;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    const d = (rnd() - 0.5) * 60;
    blob(rnd() * w, rnd() * h, 8 + rnd() * 34, 8 + rnd() * 28, 0,
      seedColor[0] + d, seedColor[1] + d * 0.8, seedColor[2] + d * 0.6, 0.10);
  }
  // Cthulhu Macula — dark reddish belt across one equatorial hemisphere.
  for (let i = 0; i < 16; i++) {
    blob(w * (0.02 + rnd() * 0.38), h * (0.46 + (rnd() - 0.5) * 0.24), 70 + rnd() * 95, 32 + rnd() * 46,
      (rnd() - 0.5) * 0.5, 80 + rnd() * 28, 48 + rnd() * 16, 42 + rnd() * 14, 0.15);
  }
  // Tombaugh Regio — the bright nitrogen-ice "heart".
  blob(w * 0.63, h * 0.60, 150, 122, 0.15, 240, 233, 214, 0.55);
  blob(w * 0.71, h * 0.58, 98, 112, -0.20, 244, 238, 222, 0.50);
  blob(w * 0.56, h * 0.57, 92, 104, 0.30, 240, 233, 214, 0.45);
  // Scattered bright frost patches and a few dark spots.
  for (let i = 0; i < 10; i++) blob(rnd() * w, h * (0.25 + rnd() * 0.5), 18 + rnd() * 40, 14 + rnd() * 28, 0, 232, 226, 208, 0.16);
  for (let i = 0; i < 8; i++)  blob(rnd() * w, h * (0.30 + rnd() * 0.4), 12 + rnd() * 26, 10 + rnd() * 20, 0, 96, 70, 58, 0.15);
  // Pale frost poles (brighter north).
  blob(w * 0.5, 0, w * 0.7, h * 0.18, 0, 248, 244, 232, 0.5);
  blob(w * 0.5, h, w * 0.7, h * 0.14, 0, 236, 230, 216, 0.4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Ring mesh with radial UVs so a strip texture maps from inner -> outer edge.
function makeRing(innerR, outerR, opts, loader) {
  const seg = 128;
  const geo = new THREE.RingGeometry(innerR, outerR, seg, 4);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const radius = v.length();
    const u = (radius - innerR) / (outerR - innerR);
    uv.setXY(i, u, 1);   // sample across the texture's width
  }
  let mat;
  if (opts.texture) {
    const tex = loader.load(resolveTexture(opts.texture));
    tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.DoubleSide, transparent: true,
      opacity: 1.0, depthWrite: false,
    });
  } else {
    mat = new THREE.MeshBasicMaterial({
      color: opts.color ?? 0xaaaaaa, side: THREE.DoubleSide,
      transparent: true, opacity: opts.opacity ?? 0.4, depthWrite: false,
    });
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;   // lay flat in the equatorial (X-Z) plane
  return mesh;
}

// Soft atmospheric rim (additive fresnel shell), used for Earth / Venus.
function makeAtmosphere(radius, color, power = 3.0, intensity = 1.0) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: power }, uIntensity: { value: intensity } },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vN; varying vec3 vView;
      void main(){
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      varying vec3 vN; varying vec3 vView;
      uniform vec3 uColor; uniform float uPower; uniform float uIntensity;
      void main(){
        float f = pow(1.0 - abs(dot(vN, vView)), uPower);
        gl_FragColor = vec4(uColor, f * uIntensity);
        #include <logdepthbuf_fragment>
      }`,
    transparent: true, blending: THREE.AdditiveBlending,
    side: THREE.BackSide, depthWrite: false,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 48), mat);
}

// Custom Earth material: day/night blend driven by a live sun direction.
// When a real water mask (Solar System Scope specular map) is supplied the
// ocean glint is masked precisely to water; otherwise it falls back to a cheap
// estimate from the day map's blue channel.
function makeEarthMaterial(dayTex, nightTex, specTex) {
  const uniforms = {
    dayMap: { value: dayTex },
    nightMap: { value: nightTex },
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
  };
  if (specTex) uniforms.specMap = { value: specTex };
  const oceanExpr = specTex
    ? 'texture2D(specMap, vUv).r'                              // true land/water mask
    : 'clamp((day.b - max(day.r, day.g)) * 6.0, 0.0, 1.0)';   // fallback estimate
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv; varying vec3 vWorldN; varying vec3 vWorldPos;
      void main(){
        vUv = uv;
        vWorldN = normalize(mat3(modelMatrix) * normal);
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D dayMap; uniform sampler2D nightMap; uniform vec3 sunDir;
      ${specTex ? 'uniform sampler2D specMap;' : ''}
      varying vec2 vUv; varying vec3 vWorldN; varying vec3 vWorldPos;
      void main(){
        vec3 N = normalize(vWorldN);
        vec3 L = normalize(sunDir);
        float d = dot(N, L);
        float mixv = smoothstep(-0.12, 0.30, d);
        vec3 day = texture2D(dayMap, vUv).rgb;
        vec3 night = texture2D(nightMap, vUv).rgb * 1.4;
        vec3 col = mix(night, day, mixv);
        // Ocean specular glint (Blinn-Phong), masked to water, day side only.
        float ocean = ${oceanExpr};
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 60.0) * ocean * clamp(d, 0.0, 1.0);
        col += vec3(1.0, 0.95, 0.85) * spec * 1.6;
        gl_FragColor = vec4(col, 1.0);
        #include <logdepthbuf_fragment>
      }`,
  });
}

// Ring of points for a circular moon orbit of the given radius (X-Z plane).
function moonCirclePts(dist) {
  const pts = [];
  for (let s = 0; s <= 96; s++) { const a = (s / 96) * TWO_PI; pts.push(Math.cos(a) * dist, 0, Math.sin(a) * dist); }
  return pts;
}

function makeLabel(text, cls, onClick) {
  const div = document.createElement('div');
  div.className = 'body-label ' + cls;
  div.textContent = text;
  div.addEventListener('pointerdown', (e) => { e.stopPropagation(); onClick(); });
  const obj = new CSS2DObject(div);
  obj.center.set(0.5, 1.2);
  obj.element = div;
  return obj;
}

// ---------------------------------------------------------------------------
//  Main builder
// ---------------------------------------------------------------------------
export function buildSolarSystem(scene, loader, onSelect, distMode = 'visual', texRes = 'low') {
  TEX_RES = texRes === 'high' ? 'high' : 'low';
  let distFn = makeDistanceFn(distMode);
  const selectable = [];          // meshes for raycasting
  const planets = [];
  const orbitLines = [];
  const labels = [];

  // ----- The real Milky Way, on its true plane -----------------------------
  // Galactic basis expressed in scene coordinates (all orthonormal).
  const galN = equatorialToScene(NGP_RA, NGP_DEC).normalize();            // galactic north pole
  const galC = equatorialToScene(GC_RA, GC_DEC).normalize();             // galactic centre
  galC.sub(galN.clone().multiplyScalar(galC.dot(galN))).normalize();      // force ⟂ to the pole

  // Real photographic Milky Way (Solar System Scope). Always loaded at 8K — it
  // is the dominant backdrop yet only ~1.9 MB, so it stays hi-res even in 2K
  // mode. Rotated so its galactic plane matches the true one (~60° to the
  // ecliptic) with the bulge aimed at the Galactic Centre.
  const skyTex = loader.load('textures/8k/stars_milky_way.jpg');
  skyTex.colorSpace = THREE.SRGBColorSpace;
  skyTex.anisotropy = 8;               // crisper at grazing angles
  // The shell must sit beyond the OUTERMOST body even in the true-scale view
  // (Eris reaches ~3.7M units from the Sun, and the camera can be millions out),
  // so it is built very large. It follows the camera and is a flat backdrop, so
  // the radius affects nothing visually — only that nothing real falls outside it.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2.0e7, 64, 64),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide })
  );
  // The photo is very dark (real night sky); lift it so the band reads richly.
  // ACES tone-mapping rolls off the brightest stars, so they stay crisp.
  sky.material.color.setScalar(1.8);
  // Equirectangular UVs: the texture's centre maps to the sphere's local +X and
  // its top edge to local +Y. Aim +X at the Galactic Centre and +Y at the pole.
  const skyZ = new THREE.Vector3().crossVectors(galC, galN).normalize();
  sky.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(galC.clone(), galN.clone(), skyZ));
  scene.add(sky);

  // A light scatter of crisp foreground stars adds depth over the photo; kept
  // sparse and dim so the real image stays the star of the show.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Foreground star shell — placed beyond the farthest body but inside the sky
  // sphere. Point sizes are in pixels, so the large radius does not change how
  // the stars look; it only keeps them behind the real (true-scale) planets.
  const stars = buildStarfield(scene, 5000, 1.3e7, 1.55e7, dpr);

  // ----- The Sun -----------------------------------------------------------
  // The Sun is BUILT at its true radius (109.2 Earth radii) so the realistic /
  // accurate views are correctly to scale. In the compressed view the whole Sun
  // group (mesh + corona + glow + label) is simply scaled down to the friendly
  // SUN_RADIUS_UNITS so a single geometry serves both regimes.
  const sunTex = loader.load(resolveTexture(SUN.texture));
  sunTex.colorSpace = THREE.SRGBColorSpace;
  const sunRadius = SUN.radiusEarth * CONFIG.EARTH_RADIUS_UNITS;   // true scale
  const SUN_VISUAL_SCALE = CONFIG.SUN_RADIUS_UNITS / sunRadius;    // shrink for the compressed view
  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(sunRadius, 64, 64),
    new THREE.MeshBasicMaterial({ map: sunTex })
  );
  sunMesh.userData = { kind: 'sun', ref: SUN };
  scene.add(sunMesh);                          // initial scale applied by setScaleMode() below
  selectable.push(sunMesh);

  // Wide, faint outer corona + brighter inner glow (both additive sprites).
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialGlowTexture('rgba(255,225,170,0.9)', 'rgba(255,120,30,0)'),
    color: 0xffb061, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  corona.scale.setScalar(sunRadius * 5);
  corona.material.opacity = 0.38;
  sunMesh.add(corona);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialGlowTexture(), color: 0xfff1d8, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.scale.setScalar(sunRadius * 2.8);
  sunMesh.add(glow);

  const sunLight = new THREE.PointLight(0xfff3e0, 3.0, 0, 0);   // no distance falloff
  scene.add(sunLight);
  const ambient = new THREE.AmbientLight(0xffffff, 0.035);
  scene.add(ambient);

  const sunLabel = makeLabel(SUN.name, 'label-sun', () => onSelect({ kind: 'sun', ref: SUN }, sunMesh));
  sunLabel.position.set(0, sunRadius * 1.15, 0);
  sunMesh.add(sunLabel);
  labels.push({ obj: sunLabel, type: 'sun' });

  // ----- Planets -----------------------------------------------------------
  for (const data of PLANETS) {
    // TRUE radius (no clamp) so the true-scale views are accurate. The tiny dwarf
    // planets are scaled up to MIN_RADIUS only in the compressed view (so they
    // stay visible/clickable) via bodyVisualScale applied to the `tilt` group.
    const radius = data.radiusEarth * CONFIG.EARTH_RADIUS_UNITS;
    const bodyVisualScale = Math.max(MIN_RADIUS, radius) / radius;   // >1 only for dwarfs

    const pivot = new THREE.Group();          // sits at the heliocentric position
    scene.add(pivot);

    const tilt = new THREE.Group();           // applies axial tilt
    tilt.rotation.z = THREE.MathUtils.degToRad(data.axialTilt);
    pivot.add(tilt);

    // Planet surface
    let mat, mesh;
    const geo = new THREE.SphereGeometry(radius, 64, 64);
    if (data.id === 'earth') {
      // Earth always uses the 8K maps (hero body) — independent of the 2K/8K toggle.
      const dayT = loader.load(highResTexture(data.texture)); dayT.colorSpace = THREE.SRGBColorSpace;
      const nightT = loader.load(highResTexture(data.nightTexture)); nightT.colorSpace = THREE.SRGBColorSpace;
      let specT = null;
      if (data.specularTexture) { specT = loader.load(highResTexture(data.specularTexture)); specT.colorSpace = THREE.NoColorSpace; }
      mat = makeEarthMaterial(dayT, nightT, specT);
      mesh = new THREE.Mesh(geo, mat);
    } else {
      let map;
      if (data.texture) { map = loader.load(resolveTexture(data.texture)); map.colorSpace = THREE.SRGBColorSpace; }
      else if (data.procedural === 'pluto') { map = proceduralPlanet([200, 178, 150]); }
      mat = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : data.color, roughness: 1.0, metalness: 0.0 });
      // Surface relief from the albedo map for rocky worlds (cheap normal detail).
      if (ROCKY.has(data.id) && map) { mat.bumpMap = map; mat.bumpScale = data.id === 'mars' ? 1.6 : 1.2; }
      mesh = new THREE.Mesh(geo, mat);
    }
    mesh.userData = { kind: 'planet', ref: data };
    tilt.add(mesh);
    selectable.push(mesh);

    // Clouds (Earth) — also always 8K to match the Earth surface.
    let clouds = null;
    if (data.cloudsTexture) {
      const cT = loader.load(data.id === 'earth' ? highResTexture(data.cloudsTexture) : resolveTexture(data.cloudsTexture));
      clouds = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.015, 64, 64),
        new THREE.MeshStandardMaterial({ alphaMap: cT, transparent: true, color: 0xffffff, depthWrite: false, opacity: 0.9 })
      );
      tilt.add(clouds);
    }
    // Atmosphere (Earth)
    if (data.id === 'earth') tilt.add(makeAtmosphere(radius * 1.06, 0x5aa0ff, 3.2, 0.9));
    // Subtle limb haze for the gas / ice giants
    const GIANT_ATMO = { jupiter: 0xe0c39a, saturn: 0xe8dcab, uranus: 0xa6e6ec, neptune: 0x6f8cff };
    if (GIANT_ATMO[data.id]) tilt.add(makeAtmosphere(radius * 1.03, GIANT_ATMO[data.id], 4.5, 0.55));
    // Venus haze layer
    let atmoLayer = null;
    if (data.atmosphereTexture) {
      const aT = loader.load(resolveTexture(data.atmosphereTexture)); aT.colorSpace = THREE.SRGBColorSpace;
      atmoLayer = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.02, 64, 64),
        new THREE.MeshStandardMaterial({ map: aT, transparent: true, opacity: 0.55, depthWrite: false })
      );
      tilt.add(atmoLayer);
      tilt.add(makeAtmosphere(radius * 1.07, 0xffe0a0, 3.0, 0.6));
    }

    // Rings
    let ring = null;
    if (data.ring) {
      ring = makeRing(radius * data.ring.inner, radius * data.ring.outer, data.ring, loader);
      tilt.add(ring);
    }

    // Orbit line
    const op = orbitPoints(data, distFn);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(op, 3).setUsage(THREE.DynamicDrawUsage));
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({
      color: data.color, transparent: true, opacity: data.isDwarf ? 0.25 : 0.4,
    }));
    line.frustumCulled = false;   // spans the whole orbit; re-sampled in place each frame
    scene.add(line);
    orbitLines.push({ line, data });

    // Label
    const label = makeLabel(data.name, data.isDwarf ? 'label-dwarf' : 'label-planet',
      () => onSelect({ kind: 'planet', ref: data }, mesh));
    label.position.set(0, radius * 1.4 + 0.6, 0);
    pivot.add(label);
    labels.push({ obj: label, type: data.isDwarf ? 'dwarf' : 'planet', planetId: data.id });

    // Moons of this planet
    const moonObjs = [];
    for (const md of MOONS.filter(m => m.parent === data.id)) {
      const mr = Math.max(0.22, md.radiusEarth * CONFIG.EARTH_RADIUS_UNITS);
      const mPivot = new THREE.Group();
      mPivot.rotation.x = THREE.MathUtils.degToRad(md.tilt ?? 0);
      pivot.add(mPivot);
      const mTex = loader.load(resolveTexture(md.texture)); mTex.colorSpace = THREE.SRGBColorSpace;
      const mMat = new THREE.MeshStandardMaterial({ map: mTex, color: md.tint ?? 0xffffff, roughness: 1, bumpMap: mTex, bumpScale: 1.2 });
      const mMesh = new THREE.Mesh(new THREE.SphereGeometry(mr, 32, 32), mMat);
      // Compressed keeps the moon close to its planet; true scale uses the real
      // semi-major axis on the shared ruler (1 unit = 6371/1.6 km).
      const distVisual = radius * md.dist + mr;
      const distTrue = md.aKm * (CONFIG.EARTH_RADIUS_UNITS / CONFIG.KM_PER_EARTH_RADIUS);
      const dist = (distMode === 'visual') ? distVisual : distTrue;
      mMesh.position.set(dist, 0, 0);
      mMesh.userData = { kind: 'moon', ref: md, parentId: data.id };
      mPivot.add(mMesh);
      selectable.push(mMesh);

      // faint moon orbit circle
      const circGeo = new THREE.BufferGeometry();
      circGeo.setAttribute('position', new THREE.Float32BufferAttribute(moonCirclePts(dist), 3));
      const circ = new THREE.Line(circGeo, new THREE.LineBasicMaterial({ color: 0x666677, transparent: true, opacity: 0.25 }));
      mPivot.add(circ);

      const mLabel = makeLabel(md.name, 'label-moon', () => onSelect({ kind: 'moon', ref: md }, mMesh));
      mLabel.position.set(0, mr * 1.6 + 0.3, 0);
      mMesh.add(mLabel);
      labels.push({ obj: mLabel, type: 'moon', planetId: data.id });

      moonObjs.push({ data: md, pivot: mPivot, mesh: mMesh, orbit: circ, dist, distVisual, distTrue });
    }

    planets.push({
      data, pivot, tilt, mesh, clouds, ring, atmoLayer, bodyVisualScale,
      moons: moonObjs, radius, worldPos: new THREE.Vector3(),
    });
  }

  // Apply the per-mode visual scaling. In the compressed view the Sun and the
  // tiny dwarf planets are enlarged for visibility and moons hug their planet; in
  // the true-scale views everything is left at its real size and real distance.
  function setScaleMode(mode) {
    const visual = (mode === 'visual');
    sunMesh.scale.setScalar(visual ? SUN_VISUAL_SCALE : 1);
    for (const p of planets) {
      p.tilt.scale.setScalar(visual ? p.bodyVisualScale : 1);
      for (const m of p.moons) {
        m.dist = visual ? m.distVisual : m.distTrue;
        m.mesh.position.set(m.dist, 0, 0);
        m.orbit.geometry.setAttribute('position', new THREE.Float32BufferAttribute(moonCirclePts(m.dist), 3));
        m.orbit.geometry.attributes.position.needsUpdate = true;
        m.orbit.geometry.computeBoundingSphere();
      }
    }
  }
  setScaleMode(distMode);

  // ----- Interstellar spacecraft (Voyager 1 & 2) ---------------------------
  // Each craft is a group anchored at its true scene position. A child pivot
  // holds the model and is rescaled for apparent size every frame. The real NASA
  // glTF model (public-domain, NASA/VTAD) is loaded once and cloned into each.
  const voyagers = [];
  const gltfLoader = new GLTFLoader(loader.manager);   // shares the loading-screen manager
  for (const data of VOYAGERS) {
    const group = new THREE.Group();
    group.visible = (distMode !== 'visual');           // true-scale views only
    group.userData = { kind: 'spacecraft', ref: data, focusRadius: VOY_FOCUS_RADIUS };
    scene.add(group);
    // Make the craft findable by id (nav list, selectById/focusById) up front —
    // independent of the async glTF load, and robust if the model ever fails to
    // load. A Group has no geometry, so it is never hit by ray-picking; the
    // clicked-on model meshes are added to `selectable` separately on load.
    selectable.push(group);

    const modelPivot = new THREE.Group();
    group.add(modelPivot);

    const label = makeLabel(data.name, 'label-spacecraft',
      () => onSelect({ kind: 'spacecraft', ref: data, object3D: group }, group));
    group.add(label);

    // baseVisible = the master on/off (set by the Spacecraft toggle + scale mode);
    // update() ANDs it with "does the craft exist at this date yet" each frame.
    const voyager = {
      data, group, modelPivot, label,
      model: null, meshes: [],
      baseVisible: group.visible,
      labelBaseVisible: group.visible,
      launched: false,
      trail: null,
    };
    labels.push({ obj: label, type: 'spacecraft', voyager });
    voyagers.push(voyager);
  }

  // Single shared load of the NASA Voyager model, then clone it into each craft.
  function cloneVoyagerMaterial(material) {
    if (Array.isArray(material)) return material.map(cloneVoyagerMaterial);
    if (!material) return material;

    const mat = material.clone();
    // GLTF textured materials usually keep material.color at white and put the
    // real albedo in material.map. Using that white color as emissive flattens
    // Voyager into a pale silhouette, so the visibility lift must be texture-led.
    if (mat.emissive) {
      if (mat.map) {
        mat.emissive.setScalar(0.06);
        mat.emissiveMap = mat.map;
      } else if (mat.color) {
        mat.emissive.copy(mat.color).multiplyScalar(0.08);
      }
      mat.needsUpdate = true;
    }
    return mat;
  }

  gltfLoader.load('models/Voyager.glb', (gltf) => {
    const src = gltf.scene;
    src.updateMatrixWorld(true);
    // Centre on the model's bounding sphere and normalise so its radius = 1 unit,
    // giving the apparent-size scaling a known, model-independent basis.
    const sphere = new THREE.Box3().setFromObject(src).getBoundingSphere(new THREE.Sphere());
    const norm = 1 / (sphere.radius || 1);
    for (const vo of voyagers) {
      const m = src.clone(true);
      m.position.copy(sphere.center).multiplyScalar(-norm);
      m.scale.setScalar(norm);
      m.traverse((o) => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        if (o.material) {
          // Isolate clones and keep the readability boost from washing out the
          // GLB's own texture colors.
          o.material = cloneVoyagerMaterial(o.material);
        }
        o.userData = { kind: 'spacecraft', ref: vo.data, object3D: vo.group };
        selectable.push(o);
        vo.meshes.push(o);
      });
      vo.model = m;
      vo.modelPivot.add(m);
    }
  }, undefined, (err) => console.warn('Voyager model failed to load:', err));

  // ----- Asteroid & Kuiper belts ------------------------------------------
  function buildBelt(cfg, color) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true, vertexColors: false });
    const mesh = new THREE.InstancedMesh(geo, mat, cfg.count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const au = new Float32Array(cfg.count);
    const ang0 = new Float32Array(cfg.count);
    const yfrac = new Float32Array(cfg.count);   // unit-less; scaled by distFn each frame
    const sx = new Float32Array(cfg.count), sy = new Float32Array(cfg.count), sz = new Float32Array(cfg.count);
    for (let i = 0; i < cfg.count; i++) {
      const a = cfg.innerAU + Math.random() * (cfg.outerAU - cfg.innerAU);
      au[i] = a;
      ang0[i] = Math.random() * TWO_PI;
      yfrac[i] = (Math.random() - 0.5) * cfg.thickness * 0.05;
      const base = cfg.size[0] + Math.random() * (cfg.size[1] - cfg.size[0]);
      sx[i] = base * (0.6 + Math.random()); sy[i] = base * (0.6 + Math.random()); sz[i] = base * (0.6 + Math.random());
    }
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, au, ang0, yfrac, sx, sy, sz, cfg };
  }
  const asteroidBelt = buildBelt(BELTS.asteroid, 0x9b8b78);
  const kuiperBelt = buildBelt(BELTS.kuiper, 0x6b7a8f);
  const belts = [asteroidBelt, kuiperBelt];
  const dummy = new THREE.Object3D();

  function updateBelt(b, simDays) {
    const { mesh, au, ang0, yfrac, sx, sy, sz, cfg } = b;
    for (let i = 0; i < cfg.count; i++) {
      const a = au[i];
      const period = 365.25 * Math.pow(a, 1.5);     // Kepler's 3rd law (days)
      const ang = ang0[i] + (TWO_PI / period) * simDays;
      const R = distFn(a);
      dummy.position.set(Math.cos(ang) * R, yfrac[i] * R, Math.sin(ang) * R);
      dummy.scale.set(sx[i], sy[i], sz[i]);
      dummy.rotation.set(0, ang, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  // ----- Galactic drift state ----------------------------------------------
  let driftMode = false, driftEpoch = 0, lastSimDays = 0, trailDir = 1;
  // Orbit ellipses are drawn from the time-adjusted elements at this epoch; they
  // are rebuilt whenever the simulated date drifts far enough (or the scale
  // changes) so every body keeps sitting exactly on its own orbit line.
  // Re-sample every visible orbit ellipse from the bodies' CURRENT (secular-rate
  // adjusted) elements, so each planet stays exactly on its own orbit line as the
  // elements slowly drift. Done in place each frame; hidden lines are skipped.
  function rebuildOrbits(simDays) {
    for (const o of orbitLines) {
      if (!o.line.visible) continue;
      const op = orbitPoints(o.data, distFn, simDays);    // absolute; op[0..2] = body's position now
      // Anchor the line AT the body (vertex 0) and store vertices relative to it,
      // so the near-body section keeps full float32 precision even for the far
      // dwarfs (whose orbits run to millions of units) — body sits exactly on it.
      const hx = op[0], hy = op[1], hz = op[2];
      for (let i = 0; i < op.length; i += 3) { op[i] -= hx; op[i + 1] -= hy; op[i + 2] -= hz; }
      o.line.position.set(hx, hy, hz);
      const attr = o.line.geometry.getAttribute('position');
      if (attr && attr.array.length === op.length) { attr.array.set(op); attr.needsUpdate = true; }
      else o.line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(op, 3).setUsage(THREE.DynamicDrawUsage));
    }
  }
  const drift = new THREE.Vector3();

  // ----- Motion trails (the "wake" through space; live accurate view only) --
  // Each frame the whole wake is RECOMPUTED from posAt() over the body's span,
  // sampled behind the current travel direction. This is exact at any speed /
  // frame-rate and identical forward or backward (no buffer to get out of sync).
  // posAt(t, out) writes the body's world position at sim-day t.
  const hexRGB = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  const trails = [];
  // visRef (optional): an Object3D whose .visible mirrors whether the body is
  // shown; the trail is hidden whenever its body is hidden (e.g. dwarf planets
  // toggled off), and reappears when shown again.
  function makeTrail(posRef, hex, span, points, posAt, visRef = null, visibleWhen = null) {
    const buf = points + 8;
    const geom = new THREE.BufferGeometry();
    const posArr = new Float32Array(buf * 3);
    const colArr = new Float32Array(buf * 3);
    geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage));
    geom.setAttribute('color', new THREE.BufferAttribute(colArr, 3).setUsage(THREE.DynamicDrawUsage));
    geom.setDrawRange(0, 0);
    const line = new THREE.Line(geom, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    line.frustumCulled = false; line.visible = false; line.renderOrder = 2;
    scene.add(line);
    const trail = { posAt, base: hexRGB(hex), geom, posArr, colArr, line, span, points, interval: span / points, visRef, visibleWhen };
    trails.push(trail);
    return trail;
  }
  // The Sun only drifts (a straight line) — a handful of points is plenty.
  makeTrail(sunMesh.position, 0xffcc66, SUN_TRAIL_DAYS, 64,
    (t, out) => out.copy(DRIFT_DIR).multiplyScalar(DRIFT_RATE * (t - driftEpoch)));
  for (const p of planets) {
    const pdata = p.data;
    // ~3 orbits of wake, capped at 10 yr; point count = orbits shown × density, so
    // the segment angle (~1°) is uniform for every planet — fast inner ones too.
    const span = Math.min(3 * pdata.periodDays, MAX_TRAIL_DAYS);
    const pts = Math.max(64, Math.min(TRAIL_MAX_POINTS, Math.ceil((span / pdata.periodDays) * TRAIL_DENSITY)));
    makeTrail(p.pivot.position, pdata.color, span, pts, (t, out) => {
      const sp = scenePosition(pdata, t, distFn);
      const dr = DRIFT_RATE * (t - driftEpoch);
      out.set(DRIFT_DIR.x * dr + sp.x, DRIFT_DIR.y * dr + sp.y, DRIFT_DIR.z * dr + sp.z);
    }, p.pivot);
  }
  // Voyager wakes — they coast in nearly straight lines, so a short, sparse trail
  // is plenty. Shown only in the live "accurate" view (driftMode), like the planets'.
  for (const vo of voyagers) {
    vo.trail = makeTrail(vo.group.position, vo.data.color, MAX_TRAIL_DAYS, 96, (t, out) => {
      const sp = voyagerScenePosition(vo.data, t);
      // Before launch the craft has no position — collapse this wake point onto
      // the head so the segment is zero-length (the wake never predates launch).
      if (!sp) { out.copy(vo.group.position); return; }
      const dr = DRIFT_RATE * (t - driftEpoch);
      out.set(DRIFT_DIR.x * dr + sp.x, DRIFT_DIR.y * dr + sp.y, DRIFT_DIR.z * dr + sp.z);
    }, vo.group, () => vo.launched && vo.group.visible);
  }

  function clearTrails() { for (const tr of trails) tr.geom.setDrawRange(0, 0); }
  function setDriftMode(on, simDays) {
    driftMode = on; driftEpoch = simDays; lastSimDays = simDays;
    clearTrails();
    for (const tr of trails) {
      const bodyVisible = tr.visibleWhen ? tr.visibleWhen() : (tr.visRef ? tr.visRef.visible : true);
      tr.line.visible = on && bodyVisible;
      if (!tr.line.visible) tr.geom.setDrawRange(0, 0);
    }
    if (!on) {
      drift.set(0, 0, 0);
      sunMesh.position.set(0, 0, 0); sunLight.position.set(0, 0, 0);
      asteroidBelt.mesh.position.set(0, 0, 0); kuiperBelt.mesh.position.set(0, 0, 0);
    }
  }
  const _wp = new THREE.Vector3(), _head = new THREE.Vector3();
  function updateTrails(simDays, dir) {
    for (const tr of trails) {
      // Hide a body's wake the moment the body itself is hidden (e.g. dwarfs off).
      tr.line.visible = tr.visibleWhen ? tr.visibleWhen() : (tr.visRef ? tr.visRef.visible : true);
      if (!tr.line.visible) { tr.geom.setDrawRange(0, 0); continue; }
      const n = tr.points;
      const pos = tr.posArr, col = tr.colArr, b = tr.base, step = dir * tr.interval;
      // Anchor the wake at the body's CURRENT position and store every vertex
      // RELATIVE to it. The float32 vertex buffer then holds small numbers, so at
      // true scale (absolute coords in the millions) the wake stays smooth instead
      // of snapping to a coarse precision grid (the "jittery / broken" trail).
      tr.posAt(simDays, _head);
      tr.line.position.copy(_head);
      for (let j = 0; j <= n; j++) {
        tr.posAt(simDays - step * j, _wp);     // j=0 → head (at the body); j=n → tail
        _wp.sub(_head);                        // store relative to the anchored head
        const idx = (n - j) * 3;               // stored tail→head so the line fades in order
        pos[idx] = _wp.x; pos[idx + 1] = _wp.y; pos[idx + 2] = _wp.z;
        const a = Math.pow(1 - j / n, 0.75);   // head bright → tail faint
        col[idx] = b[0] * a; col[idx + 1] = b[1] * a; col[idx + 2] = b[2] * a;
      }
      tr.geom.attributes.position.needsUpdate = true;
      tr.geom.attributes.color.needsUpdate = true;
      tr.geom.setDrawRange(0, n + 1);
    }
  }

  // ----- Public update -----------------------------------------------------
  const sunDirTmp = new THREE.Vector3();
  const _sv = new THREE.Vector3(), _iq = new THREE.Quaternion();
  function update(simDays) {
    // Keep the drawn orbit ellipses matched to the bodies' current elements.
    rebuildOrbits(simDays);   // keep every visible orbit line glued to its body

    // Galactic drift offset (only in the live "accurate" view).
    if (driftMode) drift.copy(DRIFT_DIR).multiplyScalar(DRIFT_RATE * (simDays - driftEpoch));
    else drift.set(0, 0, 0);
    sunMesh.position.copy(drift);
    sunLight.position.copy(drift);

    for (const p of planets) {
      const sp = scenePosition(p.data, simDays, distFn);
      p.pivot.position.set(drift.x + sp.x, drift.y + sp.y, drift.z + sp.z);
      p.worldPos.copy(p.pivot.position);

      if (p.data.id === 'earth') {
        // True Sun direction from the ORBITAL offset (drift cancels Sun↔Earth).
        sunDirTmp.set(-sp.x, -sp.y, -sp.z).normalize();
        p.mesh.material.uniforms.sunDir.value.copy(sunDirTmp);
        // Calibrated spin: orient Earth so the sub-solar longitude matches the
        // real UTC clock (so the day/night terminator is geographically correct).
        const utcH = (((simDays + 0.5) % 1) + 1) % 1 * 24;        // hours since 00:00 UTC
        const lonSun = (15 * (12 - utcH)) * DEG2RAD;              // sub-solar longitude (East +)
        _sv.copy(sunDirTmp).applyQuaternion(_iq.copy(p.tilt.quaternion).invert());
        const sunAz = Math.atan2(_sv.z, _sv.x);                   // Sun azimuth in the tilted frame
        const phi = -lonSun - sunAz + EARTH_PHASE;
        p.mesh.rotation.y = phi;
        if (p.clouds) p.clouds.rotation.y = phi + simDays * 0.08; // gentle cloud drift
        if (p.atmoLayer) p.atmoLayer.rotation.y = phi;
      } else {
        // Physically accurate axial spin: one turn per rotation period.
        // Sign of rotationHours encodes prograde (+) / retrograde (-) spin.
        const rot = TWO_PI * simDays * (24 / p.data.rotationHours);
        p.mesh.rotation.y = rot;
        if (p.clouds) p.clouds.rotation.y = rot * 1.06;
        if (p.atmoLayer) p.atmoLayer.rotation.y = rot * 0.9;
      }

      // moons (near-circular orbits; sign of period = orbit direction)
      for (const m of p.moons) {
        const md = m.data;
        const ang = (TWO_PI / md.periodDays) * simDays;
        m.mesh.position.set(Math.cos(ang) * m.dist, 0, Math.sin(ang) * m.dist);
        m.mesh.rotation.y = ang;   // keep one face toward the planet (tidal lock)
      }
    }
    sunMesh.rotation.y = (simDays / 25.38) * TWO_PI;   // Sun rotates ~every 25.4 days
    asteroidBelt.mesh.position.copy(drift);
    kuiperBelt.mesh.position.copy(drift);
    updateBelt(asteroidBelt, simDays);
    updateBelt(kuiperBelt, simDays);

    // Voyagers: real-ephemeris position on the true-scale ruler, + galactic drift
    // (so they ride along with the system in the accurate view). Before launch
    // the craft does not exist (sp === null), so it is hidden; otherwise its
    // visibility follows the master toggle (baseVisible).
    for (const vo of voyagers) {
      const sp = voyagerScenePosition(vo.data, simDays);
      vo.launched = !!sp;
      if (sp) {
        vo.group.position.set(drift.x + sp.x, drift.y + sp.y, drift.z + sp.z);
        vo.group.visible = vo.baseVisible;
      } else {
        vo.group.visible = false;
      }
      // CSS2D labels are DOM nodes; their own visibility must mirror the craft.
      vo.label.visible = vo.labelBaseVisible && vo.group.visible;
      if (!vo.launched && vo.trail) {
        vo.trail.line.visible = false;
        vo.trail.geom.setDrawRange(0, 0);
      }
    }

    // Track the playback direction so the wake trails behind the motion.
    if (simDays > lastSimDays + 1e-9) trailDir = 1;
    else if (simDays < lastSimDays - 1e-9) trailDir = -1;
    if (driftMode) updateTrails(simDays, trailDir);
    lastSimDays = simDays;
  }

  // Distance-aware sizing for the Voyager models. Called every frame from main.js
  // (which owns the camera). Three regimes by camera↔craft distance, blended with
  // smoothstep: INSPECT (very close → a fixed gizmo you can examine, < any giant
  // planet); REAL (mid → true physical size, honestly tiny next to a planet); ICON
  // (very far → a small on-screen locator). No feedback loop — size depends only on
  // the distance, never on the craft's own size. Also aims the dish toward the Sun.
  const _vw = new THREE.Vector3();
  const _smooth = (u) => u * u * (3 - 2 * u);
  function scaleVoyagersToCamera(camera) {
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    for (const vo of voyagers) {
      if (!vo.group.visible) continue;
      vo.group.getWorldPosition(_vw);
      const d = camera.position.distanceTo(_vw);
      const sIcon = d * halfH * VOY_ICON_FRAC;                 // far locator (constant on-screen size)
      let s;
      if (d <= VOY_INSPECT_DIST) {
        s = VOY_INSPECT_UNITS;                                 // inspect: fixed gizmo (grows as you dolly in)
      } else if (d <= VOY_INSPECT_DIST * VOY_BLEND) {          // inspect → real
        const e = _smooth((d - VOY_INSPECT_DIST) / (VOY_INSPECT_DIST * (VOY_BLEND - 1)));
        s = VOY_INSPECT_UNITS * (1 - e) + VOY_TRUE_UNITS * e;
      } else if (d < VOY_ICON_DIST) {
        s = VOY_TRUE_UNITS;                                    // real: honest physical scale, tiny vs planets
      } else if (d < VOY_ICON_DIST * VOY_BLEND) {              // real → icon
        const e = _smooth((d - VOY_ICON_DIST) / (VOY_ICON_DIST * (VOY_BLEND - 1)));
        s = VOY_TRUE_UNITS * (1 - e) + sIcon * e;
      } else {
        s = sIcon;                                             // far: small locator icon
      }
      vo.modelPivot.scale.setScalar(s);
      vo.modelPivot.lookAt(sunMesh.position);   // dish roughly toward the Sun (≈ Earth)
    }
  }

  // Rebuild orbit geometry when the distance mode changes.
  function setDistanceMode(mode) {
    distFn = makeDistanceFn(mode);
    // Resize the Sun & dwarfs and move the moons to the right orbital distance.
    setScaleMode(mode);
    // Orbit ellipses are re-sampled every frame in update() (which main.js calls
    // immediately after this), so they pick up the new scale automatically.
    // Belt radius AND thickness derive from distFn live in updateBelt(), so the
    // belts re-scale correctly on a mode change with nothing to recompute here.
  }

  return {
    sunMesh, sunLabel, sunLight, glow, ambient, sky, stars,
    planets, orbitLines, labels, selectable, belts,
    asteroidBelt, kuiperBelt, drift, trails, voyagers,
    update, setDistanceMode, setDriftMode, scaleVoyagersToCamera,
    getDistFn: () => distFn,
  };
}

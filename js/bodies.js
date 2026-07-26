// ============================================================================
//  bodies.js  —  Builds every 3D object in the scene and updates them.
// ============================================================================
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SUN, PLANETS, MOONS, BELTS, CONFIG, VOYAGERS } from './data.js';
import { scenePosition, orbitPoints, makeDistanceFn, voyagerScenePosition } from './kepler.js';
import { equatorialToSceneVec, moonOrbitPosition, bvToRGB, magToBrightness } from './astro-math.js';
import { STARS, STAR_STRIDE, STAR_COUNT } from './starcatalog.js';
import { moonEclipticPosition } from './moon.js';
import { simDaysToJdTT } from './timescales.js';

const TWO_PI = Math.PI * 2;
const Y_UP = new THREE.Vector3(0, 1, 0);
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
const _sunSpin = new THREE.Quaternion();
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

// Voyager rendering. NASA lists a 3.7 m high-gain dish and a 13 m magnetometer
// boom. That makes the craft sub-pixel at planetary zoom, so the mesh must stay
// physically tiny while its separate CSS label keeps the location discoverable.
// The official NASA glTF uses metres. Keep its mesh on the same physical ruler
// as the planets; the CSS label, rather than an enlarged mesh, is the locator.
const VOY_KM_PER_UNIT     = CONFIG.KM_PER_AU / CONFIG.DIST_REAL_K; // ≈ 3,982 km/unit
const VOY_METRES_TO_UNITS = 1 / (1000 * VOY_KM_PER_UNIT);         // ≈ 2.51e-7 unit/m

// Texture resolution. 'low' = the default 2K set in textures/; 'high' = the
// high-res (up to 8K) set in textures/8k/ with identical file names. Every
// texture load goes through resolveTexture() so a single switch re-points them.
let TEX_RES = 'low';
export function resolveTexture(path) {
  return TEX_RES === 'high' ? path.replace(/^textures\//, 'textures/8k/') : path;
}
// (The old highResTexture() "always 8K for hero surfaces" override is gone: it
// forced ~20 MB of 8K Earth JPEGs onto the 2K setting. The Milky-Way sky keeps
// its explicit 8K path below — at 1.9 MB it is a deliberate exception.)

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
// Thin Vector3 wrapper over the Node-tested implementation in astro-math.js.
function equatorialToScene(raDeg, decDeg) {
  const d = equatorialToSceneVec(raDeg, decDeg);
  return new THREE.Vector3(d.x, d.y, d.z);
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

// Real-sky starfield: the Yale Bright Star Catalogue (V ≤ 6.5) placed with
// the same equatorial→scene mapping as the Milky-Way photo, so Orion, Crux
// and the bright stars sit exactly on their photographic counterparts.
// Sizes/brightness follow Vmag; colours follow B−V. Point sizes multiply a
// uPixelRatio uniform (baking devicePixelRatio into the buffer broke on
// monitor changes).
function buildStarfield(scene, shellRadius, dpr) {
  const count = STAR_COUNT;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const siz = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * STAR_STRIDE;
    const raDeg = STARS[o + 1];
    const decDeg = STARS[o + 2];
    const vmag = STARS[o + 3];
    const bv = STARS[o + 4];
    const d = equatorialToSceneVec(raDeg, decDeg);
    pos[i * 3] = d.x * shellRadius;
    pos[i * 3 + 1] = d.y * shellRadius;
    pos[i * 3 + 2] = d.z * shellRadius;
    // Compressed flux → size/brightness so Sirius dominates without the
    // faint 6th-magnitude carpet vanishing entirely.
    const flux = magToBrightness(vmag, 0.5);
    const bright = Math.min(1, 0.16 + 0.5 * Math.pow(flux, 0.42));
    const rgb = bvToRGB(bv);
    col[i * 3] = rgb[0] * bright;
    col[i * 3 + 1] = rgb[1] * bright;
    col[i * 3 + 2] = rgb[2] * bright;
    siz[i] = Math.min(5.2, 1.05 + 2.4 * Math.pow(flux, 0.30));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('sColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(siz, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: starSpriteTexture() }, uPixelRatio: { value: dpr } },
    // logdepthbuf_* chunks: custom shaders must opt in to the logarithmic depth
    // buffer, otherwise they write linear depth and fail the depth test/sort.
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float size; attribute vec3 sColor; varying vec3 vColor;
      uniform float uPixelRatio;
      void main(){
        vColor = sColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uPixelRatio;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D uTex; varying vec3 vColor;
      void main(){
        vec4 t = texture2D(uTex, gl_PointCoord);
        gl_FragColor = vec4(vColor * t.rgb, t.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
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

// Ring mesh with radial UVs so a strip texture maps from inner -> outer edge.
// Physically shaded: an analytic planet shadow (sphere-vs-sunray with a soft
// penumbra band and a 0.06 planet-shine floor) and a two-lobe phase function
// (rings brighten strongly toward backscatter). uSunPos/uPlanetPos are world
// positions refreshed each frame, so floating-origin rebases are safe.
function makeRing(innerR, outerR, opts, loader, maxAniso = 1) {
  const seg = 128;
  const geo = new THREE.RingGeometry(innerR, outerR, seg, 4);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const radius = v.length();
    const u = (radius - innerR) / (outerR - innerR);
    uv.setXY(i, u, 0.5);   // sample the strip's centre row (v=1 hit the edge texels)
  }
  let tex;
  if (opts.texture) {
    tex = loader.load(resolveTexture(opts.texture));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
  } else {
    // Flat-colour rings (Uranus) go through the same shader via a 1x1 texel.
    const c = new THREE.Color(opts.color ?? 0xaaaaaa);
    tex = new THREE.DataTexture(new Uint8Array([
      Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255),
      Math.round((opts.opacity ?? 0.4) * 255),
    ]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex },
      uSunPos: { value: new THREE.Vector3() },
      uPlanetPos: { value: new THREE.Vector3() },
      uPlanetRadius: { value: opts.planetRadius ?? 1 },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv; varying vec3 vWorldPos;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D map;
      uniform vec3 uSunPos; uniform vec3 uPlanetPos; uniform float uPlanetRadius;
      varying vec2 vUv; varying vec3 vWorldPos;
      void main(){
        vec4 tex = texture2D(map, vec2(vUv.x, 0.5));
        vec3 L = normalize(uSunPos - vWorldPos);
        vec3 C = uPlanetPos - vWorldPos;              // fragment -> planet centre
        float b = dot(C, L);
        float d = sqrt(max(dot(C, C) - b * b, 0.0));
        float lit = (b > 0.0)
          ? smoothstep(uPlanetRadius * 0.985, uPlanetRadius * 1.04, d)
          : 1.0;
        vec3 V = normalize(cameraPosition - vWorldPos);
        float mu = dot(V, L);
        float phase = 0.42 + 0.58 * max(mu, 0.0) + 0.15 * pow(max(-mu, 0.0), 3.0);
        vec3 col = tex.rgb * (0.06 + 0.94 * lit) * phase;
        gl_FragColor = vec4(col, tex.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <logdepthbuf_fragment>
      }`,
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;   // lay flat in the equatorial (X-Z) plane

  return mesh;
}

// Soft atmospheric rim (additive fresnel shell), used for Earth / Venus.
// Exported: the eclipse rig reuses it for Earth's limb and the Sun's glow shell.
// opts.sunTerm (default off — the eclipse rig keeps the omnidirectional rim):
// darkens the night limb and paints a warm band along the terminator, driven
// by a per-frame world-space uSunDir.
export function makeAtmosphere(radius, color, power = 3.0, intensity = 1.0, opts = {}) {
  const sunTerm = opts.sunTerm === true;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: power },
      uIntensity: { value: intensity },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vN; varying vec3 vView; varying vec3 vWorldN;
      void main(){
        vN = normalize(normalMatrix * normal);
        vWorldN = normalize(mat3(modelMatrix) * normal);
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      varying vec3 vN; varying vec3 vView; varying vec3 vWorldN;
      uniform vec3 uColor; uniform float uPower; uniform float uIntensity;
      uniform vec3 uSunDir;
      void main(){
        float f = pow(1.0 - abs(dot(vN, vView)), uPower);
        ${sunTerm ? `
        float dNL = dot(normalize(vWorldN), normalize(uSunDir));
        float day = smoothstep(-0.25, 0.15, dNL);
        float band = 1.0 - smoothstep(0.0, 0.35, abs(dNL));
        vec3 col = mix(uColor * 0.06, uColor, day)
          + vec3(1.0, 0.45, 0.22) * band * 0.35;
        gl_FragColor = vec4(col, f * uIntensity * mix(0.12, 1.0, day));` : `
        gl_FragColor = vec4(uColor, f * uIntensity);`}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <logdepthbuf_fragment>
      }`,
    transparent: true, blending: THREE.AdditiveBlending,
    side: THREE.BackSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 48), mat);
  mesh.renderOrder = 6;
  return mesh;
}

// Custom Earth material: day/night blend driven by a live sun direction.
// When a real water mask (Solar System Scope specular map) is supplied the
// ocean glint is masked precisely to water; otherwise it falls back to a cheap
// estimate from the day map's blue channel.
// Exported: the eclipse rig uses the same day/night Earth as the main scene.
export function makeEarthMaterial(dayTex, nightTex, specTex) {
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
        // Tone map + encode here so the bloom-OFF direct render matches the
        // bloom path (both chunks no-op when rendering into composer targets).
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <logdepthbuf_fragment>
      }`,
  });
}

// Ring of points for a circular moon orbit of the given radius (X-Z plane),
// wound in the prograde direction to match moonOrbitPosition.
function moonCirclePts(dist) {
  const pts = [];
  for (let s = 0; s <= 96; s++) { const a = (s / 96) * TWO_PI; pts.push(Math.cos(a) * dist, 0, -Math.sin(a) * dist); }
  return pts;
}

// onClick receives `focus`: true on a double click/tap (→ fly the camera to the
// body, mirroring dblclick on the body itself — the only way to focus while the
// UI is hidden in fullscreen), false on a single click (→ select only).
// Double-taps are detected manually: PointerEvent.detail is 0 in some browsers
// and 'dblclick' never fires on touch.
function makeLabel(text, cls, onClick) {
  const div = document.createElement('div');
  div.className = 'body-label ' + cls;
  div.textContent = text;
  let lastDown = -Infinity;
  div.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const now = performance.now();
    const dbl = now - lastDown < 350;
    lastDown = dbl ? -Infinity : now;   // a triple click must not focus twice
    onClick(dbl);
  });
  const obj = new CSS2DObject(div);
  obj.center.set(0.5, 1.2);
  obj.element = div;
  return obj;
}

// ---------------------------------------------------------------------------
//  Main builder
// ---------------------------------------------------------------------------
export function buildSolarSystem(scene, loader, onSelect, distMode = 'visual', texRes = 'low', maxAniso = 1) {
  TEX_RES = texRes === 'high' ? 'high' : 'low';
  let distFn = makeDistanceFn(distMode);
  const selectable = [];          // meshes for raycasting
  const planets = [];
  const orbitLines = [];
  const labels = [];

  // Shared map loader: resolution routing + full anisotropy (planet limbs and
  // the ring plane blur badly at grazing angles with the default of 1).
  function loadMap(path, { srgb = true } = {}) {
    const tex = loader.load(resolveTexture(path));
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = maxAniso;
    return tex;
  }

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
  sky.material.color.setScalar(1.5);   // dimmed: catalog points now carry the bright stars
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
  const stars = buildStarfield(scene, 1.45e7, dpr);

  // ----- The Sun -----------------------------------------------------------
  // The Sun is BUILT at its true radius (109.2 Earth radii) so the realistic /
  // accurate views are correctly to scale. In the compressed view the whole Sun
  // group (mesh + corona + glow + label) is simply scaled down to the friendly
  // SUN_RADIUS_UNITS so a single geometry serves both regimes.
  const sunTex = loadMap(SUN.texture);
  const sunRadius = SUN.radiusEarth * CONFIG.EARTH_RADIUS_UNITS;   // true scale
  const SUN_VISUAL_SCALE = CONFIG.SUN_RADIUS_UNITS / sunRadius;    // shrink for the compressed view
  // Granulating photosphere: two counter-scrolling warped samples of the map,
  // value-noise cell brightness, limb darkening and a warm limb — modeled on
  // the eclipse rig's proven sun shader, but tone-mapped/encoded so the
  // bloom-off path stays correct.
  const sunUniforms = { map: { value: sunTex }, uTime: { value: 0 } };
  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(sunRadius, 64, 64),
    new THREE.ShaderMaterial({
      uniforms: sunUniforms,
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec2 vUv; varying vec3 vN; varying vec3 vView;
        void main(){
          vUv = uv;
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D map; uniform float uTime;
        varying vec2 vUv; varying vec3 vN; varying vec3 vView;
        float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
                     mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        void main(){
          vec2 warp = vec2(vnoise(vUv * 24.0 + uTime * 0.015),
                           vnoise(vUv * 24.0 - uTime * 0.011)) - 0.5;
          vec3 a = texture2D(map, vUv + warp * 0.004 + vec2(uTime * 0.0008, 0.0)).rgb;
          vec3 b = texture2D(map, vUv - warp * 0.006 - vec2(uTime * 0.0005, 0.0)).rgb;
          vec3 col = mix(a, b, 0.5);
          float gran = vnoise(vUv * vec2(160.0, 80.0) + warp * 8.0 + uTime * 0.05);
          col *= 0.9 + 0.2 * gran;
          float mu = clamp(abs(dot(normalize(vN), normalize(vView))), 0.0, 1.0);
          col *= 0.35 + 0.65 * pow(mu, 0.6);
          col += vec3(1.0, 0.55, 0.25) * pow(1.0 - mu, 2.5) * 0.6;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <logdepthbuf_fragment>
        }`,
    })
  );
  // The Sun's rotation axis is tilted ~7.25° to the ecliptic (IAU pole);
  // per-frame spin composes with this base orientation in update().
  const sunPoleQuat = new THREE.Quaternion().setFromUnitVectors(
    Y_UP, equatorialToScene(SUN.pole.ra, SUN.pole.dec),
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

  const sunLabel = makeLabel(SUN.name, 'label-sun', (focus) => onSelect({ kind: 'sun', ref: SUN }, sunMesh, focus));
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
    if (data.pole) {
      // IAU J2000 north pole → minimal-arc rotation from scene +Y. The old
      // rotation.z leaned every axis toward scene −X regardless of the real
      // pole direction, which shifted Earth's seasons by ~3 months and mis-set
      // Saturn's ring opening angle against the simulated date.
      tilt.quaternion.setFromUnitVectors(Y_UP, equatorialToScene(data.pole.ra, data.pole.dec));
    } else {
      // Small dwarfs without a measured IAU pole keep the legacy magnitude-only tilt.
      tilt.rotation.z = THREE.MathUtils.degToRad(data.axialTilt);
    }
    pivot.add(tilt);

    // Planet surface
    let mat, mesh;
    const geo = new THREE.SphereGeometry(radius, 64, 64);
    if (data.id === 'earth') {
      // Earth honors the 2K/8K texture setting like every other body. The old
      // always-8K special case made the "2K · standard" mode download ~20 MB
      // of 8K JPEGs (decoding to ~900 MB of VRAM) on every visit.
      const dayT = loadMap(data.texture);
      const nightT = loadMap(data.nightTexture);
      const specT = data.specularTexture ? loadMap(data.specularTexture, { srgb: false }) : null;
      mat = makeEarthMaterial(dayT, nightT, specT);
      mesh = new THREE.Mesh(geo, mat);
    } else {
      let map;
      if (data.texture) map = loadMap(data.texture);
      mat = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : data.color, roughness: 1.0, metalness: 0.0 });
      // Surface relief from the albedo map for rocky worlds (cheap normal detail).
      if (ROCKY.has(data.id) && map) { mat.bumpMap = map; mat.bumpScale = data.id === 'mars' ? 1.6 : 1.2; }
      mesh = new THREE.Mesh(geo, mat);
    }
    mesh.userData = { kind: 'planet', ref: data };
    tilt.add(mesh);
    selectable.push(mesh);

    // Clouds — follow the texture-resolution setting (the 8K cloud map alone
    // is 11.6 MB, larger than the entire 2K planet set).
    let clouds = null;
    if (data.cloudsTexture) {
      const cT = loadMap(data.cloudsTexture, { srgb: false });   // alpha map — data, not color
      clouds = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.015, 64, 64),
        new THREE.MeshStandardMaterial({ alphaMap: cT, transparent: true, color: 0xffffff, depthWrite: false, opacity: 0.9 })
      );
      clouds.renderOrder = 4;
      tilt.add(clouds);
    }
    // Atmosphere shells that track the Sun (night limb goes dark, warm terminator)
    const atmos = [];
    const addAtmo = (shell) => { tilt.add(shell); atmos.push(shell); };
    if (data.id === 'earth') addAtmo(makeAtmosphere(radius * 1.06, 0x5aa0ff, 3.2, 0.9, { sunTerm: true }));
    // Subtle limb haze for the gas / ice giants
    const GIANT_ATMO = { jupiter: 0xe0c39a, saturn: 0xe8dcab, uranus: 0xa6e6ec, neptune: 0x6f8cff };
    if (GIANT_ATMO[data.id]) addAtmo(makeAtmosphere(radius * 1.03, GIANT_ATMO[data.id], 4.5, 0.55, { sunTerm: true }));
    // Venus haze layer
    let atmoLayer = null;
    if (data.atmosphereTexture) {
      const aT = loadMap(data.atmosphereTexture);
      atmoLayer = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.02, 64, 64),
        new THREE.MeshStandardMaterial({ map: aT, transparent: true, opacity: 0.55, depthWrite: false })
      );
      atmoLayer.renderOrder = 4;
      tilt.add(atmoLayer);
      addAtmo(makeAtmosphere(radius * 1.07, 0xffe0a0, 3.0, 0.6, { sunTerm: true }));
    }

    // Rings
    let ring = null;
    if (data.ring) {
      ring = makeRing(radius * data.ring.inner, radius * data.ring.outer,
        { ...data.ring, planetRadius: radius }, loader, maxAniso);
      ring.renderOrder = 5;
      tilt.add(ring);
    }

    // Orbit line, with a static per-vertex brightness ramp: full strength at
    // the body (orbitPoints starts its sweep there, and rebuildOrbits keeps
    // vertex 0 anchored on it) fading to a faint far side — the wake reads as
    // direction instead of a uniform hairline ring. Positions are rewritten
    // each resample; this shade attribute never changes.
    const op = orbitPoints(data, distFn);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(op, 3).setUsage(THREE.DynamicDrawUsage));
    const vertexCount = op.length / 3;
    const shade = new Float32Array(vertexCount * 3);
    for (let vi = 0; vi < vertexCount; vi++) {
      const f = vi / (vertexCount - 1);
      const w = 0.18 + 0.82 * Math.pow(0.5 * (1 + Math.cos(2 * Math.PI * f)), 1.5);
      shade[vi * 3] = shade[vi * 3 + 1] = shade[vi * 3 + 2] = w;
    }
    lineGeo.setAttribute('color', new THREE.BufferAttribute(shade, 3));
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({
      color: data.color, vertexColors: true, transparent: true,
      opacity: data.isDwarf ? 0.3 : 0.5,
    }));
    line.frustumCulled = false;   // spans the whole orbit; re-sampled in place each frame
    scene.add(line);
    orbitLines.push({ line, data });

    // Label
    const label = makeLabel(data.name, data.isDwarf ? 'label-dwarf' : 'label-planet',
      (focus) => onSelect({ kind: 'planet', ref: data }, mesh, focus));
    label.position.set(0, radius * 1.4 + 0.6, 0);
    pivot.add(label);
    labels.push({ obj: label, type: data.isDwarf ? 'dwarf' : 'planet', planetId: data.id });

    // Moons of this planet
    const moonObjs = [];
    for (const md of MOONS.filter(m => m.parent === data.id)) {
      const mr = Math.max(0.22, md.radiusEarth * CONFIG.EARTH_RADIUS_UNITS);
      const mPivot = new THREE.Group();
      // Earth's Moon is positioned by a real ephemeris carrying the full 3D
      // direction (longitude AND latitude), so its pivot stays unrotated; the
      // simplified circular moons tip their plane by the data inclination.
      mPivot.rotation.x = md.id === 'moon' ? 0 : THREE.MathUtils.degToRad(md.tilt ?? 0);
      pivot.add(mPivot);
      const mTex = loadMap(md.texture);
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

      const mLabel = makeLabel(md.name, 'label-moon', (focus) => onSelect({ kind: 'moon', ref: md }, mMesh, focus));
      mLabel.position.set(0, mr * 1.6 + 0.3, 0);
      mMesh.add(mLabel);
      labels.push({ obj: mLabel, type: 'moon', planetId: data.id });

      moonObjs.push({ data: md, pivot: mPivot, mesh: mMesh, orbit: circ, dist, distVisual, distTrue });
    }

    planets.push({
      data, pivot, tilt, mesh, clouds, ring, atmoLayer, atmos, bodyVisualScale,
      moons: moonObjs, radius, worldPos: new THREE.Vector3(),
    });
  }

  // Apply the per-mode visual scaling. In the compressed view the Sun and the
  // tiny dwarf planets are enlarged for visibility and moons hug their planet; in
  // the true-scale views everything is left at its real size and real distance.
  // Voyager's 3 MB glTF is only visible in the true-scale views, so its load
  // is deferred until the first switch away from 'visual' (reassigned below).
  let requestVoyagerModel = () => {};
  function setScaleMode(mode) {
    const visual = (mode === 'visual');
    if (!visual) requestVoyagerModel();
    sunMesh.scale.setScalar(visual ? SUN_VISUAL_SCALE : 1);
    // In the compressed view the old 5x corona spanned ~110 units — engulfing
    // every orbit out to Mars. Tighter sprites there; full glory at true scale.
    corona.scale.setScalar(sunRadius * (visual ? 1.8 : 5));
    glow.scale.setScalar(sunRadius * (visual ? 2.2 : 2.8));
    for (const p of planets) {
      p.tilt.scale.setScalar(visual ? p.bodyVisualScale : 1);
      for (const m of p.moons) {
        m.dist = visual ? m.distVisual : m.distTrue;
        m.mesh.position.set(m.dist, 0, 0);
        m.orbit.geometry.setAttribute('position', new THREE.Float32BufferAttribute(moonCirclePts(m.dist), 3));
        // The ephemeris Moon resamples its own (non-circular) orbit line.
        if (m.data.id === 'moon') m.orbitEpoch = undefined;
        m.orbit.geometry.attributes.position.needsUpdate = true;
        m.orbit.geometry.computeBoundingSphere();
      }
    }
  }
  setScaleMode(distMode);

  // ----- Interstellar spacecraft (Voyager 1 & 2) ---------------------------
  // Each craft is a group anchored at its true scene position. A child pivot
  // holds the model at one fixed physical scale. The real NASA glTF model
  // (public-domain, NASA/VTAD) is loaded once and cloned into each.
  const voyagers = [];
  const gltfLoader = new GLTFLoader(loader.manager);   // shares the loading-screen manager
  for (const data of VOYAGERS) {
    const group = new THREE.Group();
    group.visible = (distMode !== 'visual');           // true-scale views only
    // focusRadius is filled from the loaded model's real metre-scale bounds.
    group.userData = { kind: 'spacecraft', ref: data, focusRadius: null };
    scene.add(group);
    // Make the craft findable by id (nav list, selectById/focusById) up front —
    // independent of the async glTF load, and robust if the model ever fails to
    // load. A Group has no geometry, so it is never hit by ray-picking; the
    // clicked-on model meshes are added to `selectable` separately on load.
    selectable.push(group);

    const modelPivot = new THREE.Group();
    group.add(modelPivot);

    const label = makeLabel(data.name, 'label-spacecraft',
      (focus) => onSelect({ kind: 'spacecraft', ref: data, object3D: group }, group, focus));
    group.add(label);

    // baseVisible = the master on/off (set by the Spacecraft toggle + scale mode);
    // update() ANDs it with "does the craft exist at this date yet" each frame.
    const voyager = {
      data, group, modelPivot, label,
      model: null, meshes: [],
      trueRadiusUnits: 0,
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

  let voyagerModelRequested = false;
  requestVoyagerModel = () => {
    if (voyagerModelRequested) return;
    voyagerModelRequested = true;
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
      // The normalised child has radius 1. Restore the NASA model's source radius
      // (metres) on the shared physical scene ruler; this scale stays constant.
      vo.trueRadiusUnits = sphere.radius * VOY_METRES_TO_UNITS;
      vo.modelPivot.scale.setScalar(vo.trueRadiusUnits);
      vo.group.userData.focusRadius = vo.trueRadiusUnits;
      vo.modelPivot.add(m);
    }
    }, undefined, (err) => console.warn('Voyager model failed to load:', err));
  };
  if (distMode !== 'visual') requestVoyagerModel();

  // ----- Asteroid & Kuiper belts ------------------------------------------
  function buildBelt(cfg, color) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true, vertexColors: false });
    const mesh = new THREE.InstancedMesh(geo, mat, cfg.count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const au = new Float32Array(cfg.count);
    const ang0 = new Float32Array(cfg.count);
    const omega = new Float32Array(cfg.count);   // rad/day (Kepler's 3rd law), fixed per rock
    const scaledR = new Float32Array(cfg.count); // distFn(a) — refreshed on mode change only
    const yfrac = new Float32Array(cfg.count);   // unit-less; scaled by R each frame
    const sx = new Float32Array(cfg.count), sy = new Float32Array(cfg.count), sz = new Float32Array(cfg.count);
    for (let i = 0; i < cfg.count; i++) {
      const a = cfg.innerAU + Math.random() * (cfg.outerAU - cfg.innerAU);
      au[i] = a;
      ang0[i] = Math.random() * TWO_PI;
      omega[i] = TWO_PI / (365.25 * Math.pow(a, 1.5));
      yfrac[i] = (Math.random() - 0.5) * cfg.thickness * 0.05;
      const base = cfg.size[0] + Math.random() * (cfg.size[1] - cfg.size[0]);
      sx[i] = base * (0.6 + Math.random()); sy[i] = base * (0.6 + Math.random()); sz[i] = base * (0.6 + Math.random());
    }
    mesh.frustumCulled = false;
    scene.add(mesh);
    const belt = { mesh, au, ang0, omega, scaledR, yfrac, sx, sy, sz, cfg, lastSim: NaN };
    refreshBeltScale(belt);
    return belt;
  }
  // distFn(a) is invariant per rock between scale-mode switches; caching it
  // removes ~9,600 Math.pow calls per frame across the two belts.
  function refreshBeltScale(b) {
    for (let i = 0; i < b.cfg.count; i++) b.scaledR[i] = distFn(b.au[i]);
    b.lastSim = NaN;   // force one matrix rebuild at the new scale
  }
  const asteroidBelt = buildBelt(BELTS.asteroid, 0x9b8b78);
  const kuiperBelt = buildBelt(BELTS.kuiper, 0x6b7a8f);
  const belts = [asteroidBelt, kuiperBelt];
  const dummy = new THREE.Object3D();

  function updateBelt(b, simDays) {
    if (b.lastSim === simDays) return;   // paused sim → belts cost nothing
    b.lastSim = simDays;
    const { mesh, ang0, omega, scaledR, yfrac, sx, sy, sz, cfg } = b;
    for (let i = 0; i < cfg.count; i++) {
      const ang = ang0[i] + omega[i] * simDays;
      const R = scaledR[i];
      // −sin matches the planets' prograde +X → −Z sweep (see astro-math.js).
      dummy.position.set(Math.cos(ang) * R, yfrac[i] * R, -Math.sin(ang) * R);
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
  // elements slowly drift. Throttled: a full resample (513 Kepler solves per
  // line) only runs when the body has moved ≳1/2000 of its orbit (≈0.18°,
  // below the line's own segment resolution) or the scale mode changed — the
  // unthrottled version cost ~7,200 solves per frame even while paused.
  let orbitsDirty = true;
  function rebuildOrbits(simDays) {
    for (const o of orbitLines) {
      if (!o.line.visible) {
        // A hidden line must not swallow a pending scale change.
        if (orbitsDirty) o.lastRebuilt = undefined;
        continue;
      }
      if (!orbitsDirty && o.lastRebuilt !== undefined
          && Math.abs(simDays - o.lastRebuilt) < o.data.periodDays / 2000) continue;
      o.lastRebuilt = simDays;
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
    orbitsDirty = false;
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

  function clearTrails() {
    for (const tr of trails) { tr.geom.setDrawRange(0, 0); tr.lastFull = undefined; }
  }
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
      if (!tr.line.visible) { tr.geom.setDrawRange(0, 0); tr.lastFull = undefined; continue; }
      // A full wake recompute costs up to 1,400 Kepler solves per body; it is
      // only due when the sim has advanced one sample interval (or reversed).
      // Between recomputes the anchored head keeps the wake glued to the body.
      const due = tr.lastFull === undefined || tr.lastDir !== dir
        || Math.abs(simDays - tr.lastFull) >= tr.interval;
      if (!due) {
        tr.posAt(simDays, _head);
        tr.line.position.copy(_head);
        continue;
      }
      tr.lastFull = simDays;
      tr.lastDir = dir;
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

  // ----- Earth's Moon: real ephemeris ---------------------------------------
  const KM_TO_UNITS = CONFIG.EARTH_RADIUS_UNITS / CONFIG.KM_PER_EARTH_RADIUS;
  function moonSceneOffset(simDays, compressedDist, out) {
    const e = moonEclipticPosition(simDaysToJdTT(simDays));
    const lat = e.latDeg * DEG2RAD;
    const lon = e.lonDeg * DEG2RAD;
    const cosLat = Math.cos(lat);
    // In the compressed view the DIRECTION is real but the distance stays
    // didactic; the true-scale views use the real eccentric distance.
    const dist = compressedDist ?? e.distKm * KM_TO_UNITS;
    out.set(
      cosLat * Math.cos(lon) * dist,
      Math.sin(lat) * dist,
      -cosLat * Math.sin(lon) * dist,
    );
    return out;
  }
  function updateEarthMoon(m, simDays) {
    const compressed = m.dist === m.distVisual ? m.dist : null;
    moonSceneOffset(simDays, compressed, m.mesh.position);
    // Tidal lock: same convention as the circular moons (near side inward).
    m.mesh.rotation.y = -Math.atan2(m.mesh.position.z, m.mesh.position.x);
    // Resample the drawn orbit (one anomalistic month around now) sparsely.
    if (m.orbitEpoch === undefined || Math.abs(simDays - m.orbitEpoch) > 0.25) {
      m.orbitEpoch = simDays;
      const attr = m.orbit.geometry.getAttribute('position');
      const count = attr.count;
      for (let s = 0; s < count; s++) {
        const t = simDays - 13.66 + (27.32 * s) / (count - 1);
        moonSceneOffset(t, compressed, _moonPt);
        attr.setXYZ(s, _moonPt.x, _moonPt.y, _moonPt.z);
      }
      attr.needsUpdate = true;
    }
  }
  const _moonPt = new THREE.Vector3();

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

      // Sun-tracking uniforms: atmosphere shells (night limb darkening) and
      // the ring shader's analytic planet shadow. World positions, so the
      // floating-origin rebases are handled for free.
      if (p.atmos.length || p.ring) {
        sunDirTmp.set(-sp.x, -sp.y, -sp.z).normalize();
        for (const shell of p.atmos) shell.material.uniforms.uSunDir.value.copy(sunDirTmp);
        if (p.ring) {
          sunMesh.getWorldPosition(p.ring.material.uniforms.uSunPos.value);
          p.mesh.getWorldPosition(p.ring.material.uniforms.uPlanetPos.value);
        }
      }

      // Moons. Earth's Moon runs on the truncated ELP2000 ephemeris (real
      // phase, latitude, and — at true scale — the real eccentric distance);
      // the others are circular with a HORIZONS-derived J2000 epoch phase.
      // moonOrbitPosition carries the prograde +X → −Z scene convention; the
      // former +sin variant made every moon (and Triton doubly so) revolve
      // backwards relative to its planet.
      for (const m of p.moons) {
        const md = m.data;
        if (md.id === 'moon') {
          updateEarthMoon(m, simDays);
          continue;
        }
        const ang = (md.M0 ?? 0) * DEG2RAD + (TWO_PI / md.periodDays) * simDays;
        moonOrbitPosition(ang, m.dist, m.mesh.position);
        m.mesh.rotation.y = ang;   // keep one face toward the planet (tidal lock)
      }
    }
    sunUniforms.uTime.value = performance.now() / 1000;
    // Sun rotates ~every 25.4 days about its IAU-tilted axis.
    _sunSpin.setFromAxisAngle(Y_UP, (simDays / 25.38) * TWO_PI);
    sunMesh.quaternion.copy(sunPoleQuat).multiply(_sunSpin);
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

  // The model scale is deliberately camera-independent. This prevents a locator
  // aid from masquerading as a planet-sized spacecraft; only aim it at the Sun.
  const _voySunWorld = new THREE.Vector3();
  function orientVoyagers() {
    sunMesh.getWorldPosition(_voySunWorld);
    for (const vo of voyagers) {
      if (!vo.group.visible) continue;
      vo.modelPivot.lookAt(_voySunWorld);   // dish roughly toward the Sun (≈ Earth)
    }
  }

  // Rebuild orbit geometry when the distance mode changes.
  function setDistanceMode(mode) {
    distFn = makeDistanceFn(mode);
    // Resize the Sun & dwarfs and move the moons to the right orbital distance.
    setScaleMode(mode);
    // Orbit resampling and the belts' cached radii are throttled; a scale
    // change is the one event that must force both to recompute.
    orbitsDirty = true;
    refreshBeltScale(asteroidBelt);
    refreshBeltScale(kuiperBelt);
  }

  return {
    sunMesh, sunLabel, sunLight, glow, ambient, sky, stars,
    planets, orbitLines, labels, selectable, belts,
    asteroidBelt, kuiperBelt, drift, trails, voyagers,
    update, setDistanceMode, setDriftMode, orientVoyagers,
    setStarPixelRatio: (v) => { stars.material.uniforms.uPixelRatio.value = v; },
    getDistFn: () => distFn,
  };
}

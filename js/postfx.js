// ============================================================================
//  postfx.js — selective-bloom post-processing pipeline.
//
//  Only objects tagged on BLOOM_LAYER glow (the Sun and its corona/glow
//  sprites; the eclipse rig tags its own Sun). The bright Milky-Way sky and
//  starfield must never bloom, regardless of the "Sun glow" toggle: the bloom
//  pass renders with the camera masked to BLOOM_LAYER alone — ~3 draw calls
//  instead of darkening the whole scene with per-frame material swaps.
// ============================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const BLOOM_LAYER = 1;

export function createPostFX({ renderer, scene, camera, getBloomEnabled }) {
  const renderScene = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 0.95, 0.55, 0.82
  );
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(renderScene);
  bloomComposer.addPass(bloomPass);
  // The glow is low-frequency: half resolution quarters the blur-chain cost
  // with no visible difference.
  bloomComposer.setSize(window.innerWidth / 2, window.innerHeight / 2);

  const mixPass = new ShaderPass(new THREE.ShaderMaterial({
    uniforms: { baseTexture: { value: null }, bloomTexture: { value: bloomComposer.renderTarget2.texture } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv;
      void main(){ gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv); }`,
  }), 'baseTexture');
  mixPass.needsSwap = true;

  // MSAA for the composer path: the canvas' own antialiasing does not apply to
  // render-target passes, so with bloom enabled (the default) edges aliased.
  const composerSamples = renderer.capabilities.isWebGL2 ? 4 : 0;
  const drawSize = renderer.getDrawingBufferSize(new THREE.Vector2());
  const finalTarget = new THREE.WebGLRenderTarget(drawSize.x, drawSize.y, {
    type: THREE.HalfFloatType,
    samples: composerSamples,
  });
  const finalComposer = new EffectComposer(renderer, finalTarget);
  finalComposer.addPass(renderScene);
  finalComposer.addPass(mixPass);
  finalComposer.addPass(new OutputPass());

  return {
    // Render one frame: selective bloom when enabled, else a plain render.
    renderFrame() {
      if (getBloomEnabled()) {
        camera.layers.set(BLOOM_LAYER);   // bloom sources only
        bloomComposer.render();
        camera.layers.set(0);             // everything for the base render
        finalComposer.render();
      } else {
        renderer.render(scene, camera);
      }
    },
    setSize(width, height) {
      bloomComposer.setSize(width / 2, height / 2);
      finalComposer.setSize(width, height);
      bloomPass.resolution.set(width, height);
    },
  };
}

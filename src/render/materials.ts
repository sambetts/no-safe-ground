import * as THREE from 'three';

/** Uniforms shared by every patched material (time for animation, night factor for bioluminescence). */
export const shared = {
  uTime: { value: 0 },
  uNight: { value: 0 },
};

export function envMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
}

/**
 * Unlit emissive material for glowing bits (eyes, crystals, bulbs). Brightness rises at night and
 * vertices with aRig.z > 0 pulse gently (phase varies per instance position).
 */
export function glowMaterial(dayLevel = 0.9, nightLevel = 2.4, opts: { transparent?: boolean; opacity?: number } = {}): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    toneMapped: false,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    depthWrite: !(opts.transparent ?? false),
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uNight = shared.uNight;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aRig;
        uniform float uTime;
        uniform float uNight;
        varying float vBright;`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        float ph = 0.0;
        #ifdef USE_INSTANCING
          ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
        #endif
        float pulse = 1.0 + aRig.z * 0.35 * sin(uTime * 2.2 + ph);
        vBright = mix(${dayLevel.toFixed(3)}, ${nightLevel.toFixed(3)}, uNight) * pulse;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBright;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vBright;');
  };
  mat.customProgramCacheKey = () => `glow-${dayLevel}-${nightLevel}-${opts.transparent ? 1 : 0}`;
  return mat;
}

/**
 * Creature body material. Per-instance attribute iAnim = (gaitPhase, flash, pulse, unused).
 * Per-vertex aRig = (legPhaseOffset, legAmplitude, pulseWeight).
 */
export function creatureMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aRig;
        attribute vec4 iAnim;
        varying float vFlash;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float legT = iAnim.x + aRig.x;
        transformed.y += aRig.y * max(0.0, sin(legT)) * 0.3;
        transformed.z += aRig.y * cos(legT) * 0.24;
        transformed *= 1.0 + aRig.z * iAnim.z * 0.16;
        vFlash = iAnim.y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlash;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vFlash * 0.7);
        totalEmissiveRadiance += vec3(1.0, 0.95, 0.9) * vFlash * 1.2;`,
      );
  };
  mat.customProgramCacheKey = () => 'creature-body';
  return mat;
}

export function creatureGlowMaterial(): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = shared.uNight;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aRig;
        attribute vec4 iAnim;
        uniform float uNight;
        varying float vBright;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float legT = iAnim.x + aRig.x;
        transformed.y += aRig.y * max(0.0, sin(legT)) * 0.3;
        transformed.z += aRig.y * cos(legT) * 0.24;
        transformed *= 1.0 + aRig.z * iAnim.z * 0.16;
        vBright = mix(1.6, 3.2, uNight) * (1.0 + aRig.z * iAnim.z * 1.5 + iAnim.y);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBright;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vBright;');
  };
  mat.customProgramCacheKey = () => 'creature-glow';
  return mat;
}

/** Simple animated acid/bile pool surface. */
export function poolMaterial(color: THREE.ColorRepresentation): THREE.ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uNight: { value: 0 } },
  ]);
  uniforms.uTime = shared.uTime;
  uniforms.uNight = shared.uNight;
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vW;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uNight;
      varying vec2 vUv;
      varying vec3 vW;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0) discard;
        float w = sin(vW.x * 1.7 + uTime * 1.9) * sin(vW.z * 1.3 - uTime * 1.4) * 0.5 + 0.5;
        float bub = step(0.985, fract(sin(dot(floor(vW.xz * 3.0), vec2(12.9898, 78.233)) + floor(uTime * 2.0)) * 43758.5453));
        float edge = smoothstep(1.0, 0.82, r);
        vec3 col = uColor * (0.45 + 0.45 * w + bub * 1.5) * mix(1.1, 2.4, uNight);
        col += uColor * smoothstep(0.75, 0.98, r) * 1.5;
        gl_FragColor = vec4(col, 0.88 * edge);
        #include <fog_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    fog: true,
    toneMapped: false,
  });
}

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clamp, damp } from '../core/math';
import { Sky } from './sky';

export type Quality = 'high' | 'medium' | 'low';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.35 },
    uAberration: { value: 0 },
    uDesat: { value: 0 },
    uGrain: { value: 0.018 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uPulse: { value: 0 },
    uPulseColor: { value: new THREE.Color(1, 0, 0) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uAberration, uDesat, uGrain, uPulse;
    uniform vec3 uTint, uPulseColor;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec3 col;
      if (uAberration > 0.001) {
        vec2 off = c * uAberration * 0.02;
        col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }
      col *= uTint;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l), uDesat);
      float vig = 1.0 - smoothstep(0.12, 0.62, r2) * uVignette;
      col *= vig;
      float edge = smoothstep(0.08, 0.5, r2);
      col = mix(col, uPulseColor * (0.25 + l), uPulse * edge);
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

/** Pooled point lights: a fixed set of lights (so shaders never recompile) shared by transient and static emitters. */
export class LightPool {
  readonly lights: THREE.PointLight[] = [];
  private reqs: { x: number; y: number; z: number; color: THREE.Color; intensity: number; distance: number; score: number }[] = [];
  private flashes: { x: number; y: number; z: number; color: THREE.Color; intensity: number; distance: number; t: number; dur: number }[] = [];
  private reqPool: { x: number; y: number; z: number; color: THREE.Color; intensity: number; distance: number; score: number }[] = [];

  constructor(scene: THREE.Scene, count: number) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 1.6);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
    }
  }

  request(x: number, y: number, z: number, color: THREE.ColorRepresentation, intensity: number, distance: number, priority = 1): void {
    const r = this.reqPool.pop() ?? { x: 0, y: 0, z: 0, color: new THREE.Color(), intensity: 0, distance: 0, score: 0 };
    r.x = x;
    r.y = y;
    r.z = z;
    r.color.set(color);
    r.intensity = intensity;
    r.distance = distance;
    r.score = priority;
    this.reqs.push(r);
  }

  flash(x: number, y: number, z: number, color: THREE.ColorRepresentation, intensity: number, distance: number, dur: number): void {
    if (this.flashes.length > 24) this.flashes.shift();
    this.flashes.push({ x, y, z, color: new THREE.Color(color), intensity, distance, t: 0, dur });
  }

  flush(dt: number, fx: number, fz: number): void {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      if (f.t >= f.dur) {
        this.flashes.splice(i, 1);
        continue;
      }
      const k = 1 - f.t / f.dur;
      this.request(f.x, f.y, f.z, f.color, f.intensity * k * k, f.distance, 3);
    }
    for (const r of this.reqs) {
      const d = Math.hypot(r.x - fx, r.z - fz);
      r.score = r.score * 40 - d + r.intensity * 0.2;
    }
    this.reqs.sort((a, b) => b.score - a.score);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const r = this.reqs[i];
      if (r && Math.hypot(r.x - fx, r.z - fz) < 55) {
        l.position.set(r.x, r.y, r.z);
        l.color.copy(r.color);
        l.intensity = r.intensity;
        l.distance = r.distance;
      } else {
        l.intensity = 0;
      }
    }
    for (const r of this.reqs) this.reqPool.push(r);
    this.reqs.length = 0;
  }
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3();
  private smooth = new THREE.Vector3();
  distance = 30;
  targetDistance = 30;
  pitch = 0.98; // radians from horizontal
  trauma = 0;
  shakeEnabled = true;
  private kick = new THREE.Vector2();
  private t = 0;
  override: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.5, 900);
  }

  addTrauma(v: number): void {
    this.trauma = clamp(this.trauma + v, 0, 1);
  }

  addKick(dx: number, dz: number): void {
    this.kick.x += dx;
    this.kick.y += dz;
  }

  snap(): void {
    this.smooth.copy(this.target);
  }

  update(dt: number): void {
    this.t += dt;
    this.distance = damp(this.distance, this.targetDistance, 6, dt);
    if (this.override) {
      this.camera.position.copy(this.override.pos);
      this.camera.lookAt(this.override.look);
      return;
    }
    this.smooth.x = damp(this.smooth.x, this.target.x, 7, dt);
    this.smooth.y = damp(this.smooth.y, this.target.y, 5, dt);
    this.smooth.z = damp(this.smooth.z, this.target.z, 7, dt);
    this.kick.x = damp(this.kick.x, 0, 14, dt);
    this.kick.y = damp(this.kick.y, 0, 14, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.shakeEnabled ? this.trauma * this.trauma : 0;
    const shx = s * 1.2 * (Math.sin(this.t * 47.3) + Math.sin(this.t * 31.7) * 0.5);
    const shy = s * 0.8 * Math.sin(this.t * 39.1 + 1.3);
    const shz = s * 1.2 * (Math.sin(this.t * 43.9 + 2.1) + Math.sin(this.t * 27.1) * 0.5);
    const lx = this.smooth.x + this.kick.x;
    const lz = this.smooth.z + this.kick.y;
    this.camera.position.set(
      lx + shx,
      this.smooth.y + Math.sin(this.pitch) * this.distance + shy,
      lz + Math.cos(this.pitch) * this.distance + shz,
    );
    this.camera.lookAt(lx + shx * 0.3, this.smooth.y, lz + shz * 0.3);
  }
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly grade: ShaderPass;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly lights: LightPool;
  readonly fog: THREE.FogExp2;
  readonly sky: Sky;
  quality: Quality = 'high';
  private renderPass: RenderPass;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'gl';

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.scene.add(this.rig.camera);
    this.fog = new THREE.FogExp2(0x2a2230, 0.012);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0x2a2230);
    this.sky = new Sky(this.scene);

    this.sun = new THREE.DirectionalLight(0xffe2c0, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -42;
    sc.right = 42;
    sc.top = 42;
    sc.bottom = -42;
    sc.near = 1;
    sc.far = 200;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xb8a8ff, 0x3a2418, 0.9);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.08);
    this.scene.add(this.ambient);
    this.lights = new LightPool(this.scene, 8);

    const w = window.innerWidth;
    const h = window.innerHeight;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.rig.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.85, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const pr = q === 'high' ? Math.min(window.devicePixelRatio, 1.5) : q === 'medium' ? 1 : 0.75;
    this.renderer.setPixelRatio(pr);
    this.sun.shadow.mapSize.set(q === 'low' ? 1024 : 2048, q === 'low' ? 1024 : 2048);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.bloom.enabled = q !== 'low';
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  /** Pixel scale factor for size-attenuated points. */
  get pointScale(): number {
    const h = this.renderer.domElement.height;
    return h / (2 * Math.tan(THREE.MathUtils.degToRad(this.rig.camera.fov / 2)));
  }

  render(dt: number, draw = true): void {
    this.rig.update(dt);
    this.sky.follow(this.rig.camera.position);
    (this.grade.uniforms.uTime as { value: number }).value += dt;
    if (draw) this.composer.render(dt);
  }
}

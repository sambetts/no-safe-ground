import * as THREE from 'three';

export interface ParticleOpts {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  sizeEnd?: number;
  color: THREE.ColorRepresentation;
  colorEnd?: THREE.ColorRepresentation;
  alpha?: number;
  gravity?: number;
  drag?: number;
  /** Clamp particles at the given ground height (bounces off it slightly). */
  ground?: number;
}

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

/** CPU-simulated, GPU-drawn point sprites. One draw call per system. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private max: number;
  private count = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private a0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private ground: Float32Array;
  private geo: THREE.BufferGeometry;
  readonly uniforms = { uScale: { value: 500 } };

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.ground = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aColor;
        attribute float aSize;
        uniform float uScale;
        varying vec4 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * uScale / -mv.z, 0.0, 512.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: additive
        ? /* glsl */ `
        varying vec4 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c) * 4.0;
          if (d > 1.0) discard;
          float a = 1.0 - d;
          gl_FragColor = vec4(vColor.rgb * a * a * vColor.a, 1.0);
        }`
        : /* glsl */ `
        varying vec4 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c) * 4.0;
          if (d > 1.0) discard;
          float a = 1.0 - d;
          gl_FragColor = vec4(vColor.rgb, vColor.a * a * a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: !additive,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
  }

  spawn(o: ParticleOpts): void {
    let i: number;
    if (this.count < this.max) i = this.count++;
    else i = Math.floor(Math.random() * this.max); // overwrite a random particle when saturated
    const i3 = i * 3;
    this.pos[i3] = o.x;
    this.pos[i3 + 1] = o.y;
    this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx ?? 0;
    this.vel[i3 + 1] = o.vy ?? 0;
    this.vel[i3 + 2] = o.vz ?? 0;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.s0[i] = o.size;
    this.s1[i] = o.sizeEnd ?? o.size;
    tmpA.set(o.color);
    tmpB.set(o.colorEnd ?? o.color);
    this.c0[i3] = tmpA.r;
    this.c0[i3 + 1] = tmpA.g;
    this.c0[i3 + 2] = tmpA.b;
    this.c1[i3] = tmpB.r;
    this.c1[i3 + 1] = tmpB.g;
    this.c1[i3 + 2] = tmpB.b;
    this.a0[i] = o.alpha ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.ground[i] = o.ground ?? -1e9;
  }

  /** Multiplies colours of subsequently spawned particles; used to brighten additive effects above the bloom threshold. */
  update(dt: number): void {
    let n = this.count;
    const P = this.pos;
    const V = this.vel;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove with the last live particle
        n--;
        if (i !== n) this.copy(n, i);
        i--;
        continue;
      }
      const i3 = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      V[i3] *= dr;
      V[i3 + 1] = V[i3 + 1] * dr - this.grav[i] * dt;
      V[i3 + 2] *= dr;
      P[i3] += V[i3] * dt;
      P[i3 + 1] += V[i3 + 1] * dt;
      P[i3 + 2] += V[i3 + 2] * dt;
      if (P[i3 + 1] < this.ground[i]) {
        P[i3 + 1] = this.ground[i];
        V[i3 + 1] *= -0.3;
        V[i3] *= 0.6;
        V[i3 + 2] *= 0.6;
      }
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const i4 = i * 4;
      this.col[i4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      this.col[i4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      this.col[i4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      // fade in quickly, fade out smoothly
      const fin = Math.min(1, t * 12);
      this.col[i4 + 3] = this.a0[i] * fin * (1 - t * t);
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }

  private copy(from: number, to: number): void {
    const f3 = from * 3;
    const t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[t3 + k] = this.pos[f3 + k];
      this.vel[t3 + k] = this.vel[f3 + k];
      this.c0[t3 + k] = this.c0[f3 + k];
      this.c1[t3 + k] = this.c1[f3 + k];
    }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.s0[to] = this.s0[from];
    this.s1[to] = this.s1[from];
    this.a0[to] = this.a0[from];
    this.grav[to] = this.grav[from];
    this.drag[to] = this.drag[from];
    this.ground[to] = this.ground[from];
  }
}

/** Ground decals (ichor splats, scorch marks, light pools) as instanced quads with per-instance colour + alpha. */
export class Decals {
  readonly mesh: THREE.InstancedMesh;
  private max: number;
  private next = 0;
  private data: { life: number; maxLife: number; alpha: number; fade: number }[] = [];
  private colorAttr: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(max: number, texture: THREE.Texture, additive: boolean) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iCol', this.colorAttr);
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]);
    uniforms.map.value = texture;
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        attribute vec4 iCol;
        varying vec4 vCol;
        varying vec2 vUv;
        #include <common>
        #include <fog_pars_vertex>
        void main() {
          vCol = iCol;
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec4 vCol;
        varying vec2 vUv;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          vec4 t = texture2D(map, vUv);
          gl_FragColor = vec4(vCol.rgb * t.rgb, t.a * vCol.a);
          ${additive ? 'gl_FragColor.rgb *= gl_FragColor.a;' : ''}
          #include <fog_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
    for (let i = 0; i < max; i++) {
      this.data.push({ life: 0, maxLife: 1, alpha: 0, fade: 1 });
      this.m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m);
    }
  }

  /** Adds a decal; returns its slot (usable with setAlpha for persistent decals like lamp glows). */
  add(x: number, y: number, z: number, size: number, color: THREE.ColorRepresentation, alpha: number, life: number, rot = Math.random() * Math.PI * 2): number {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.e.set(0, rot, 0);
    this.q.setFromEuler(this.e);
    this.v.set(x, y, z);
    this.s.set(size, 1, size);
    this.m.compose(this.v, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    tmpA.set(color);
    this.colorAttr.setXYZW(i, tmpA.r, tmpA.g, tmpA.b, alpha);
    const d = this.data[i];
    d.life = life;
    d.maxLife = life;
    d.alpha = alpha;
    d.fade = Math.min(life * 0.4, 6);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    return i;
  }

  /** Writes a persistent decal into a specific slot (callers manage slot ownership). */
  set(i: number, x: number, y: number, z: number, size: number, color: THREE.ColorRepresentation, alpha: number): void {
    this.e.set(0, 0, 0);
    this.q.setFromEuler(this.e);
    this.v.set(x, y, z);
    this.s.set(size, 1, size);
    this.m.compose(this.v, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    tmpA.set(color);
    this.colorAttr.setXYZW(i, tmpA.r, tmpA.g, tmpA.b, alpha);
    const d = this.data[i];
    d.life = Infinity;
    d.maxLife = Infinity;
    d.alpha = alpha;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  setAlpha(i: number, alpha: number): void {
    this.colorAttr.setW(i, alpha);
    this.colorAttr.needsUpdate = true;
  }

  update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.max; i++) {
      const d = this.data[i];
      if (d.life <= 0 || d.maxLife === Infinity) continue;
      d.life -= dt;
      const a = d.life <= 0 ? 0 : d.alpha * Math.min(1, d.life / d.fade);
      this.colorAttr.setW(i, a);
      dirty = true;
    }
    if (dirty) this.colorAttr.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < this.max; i++) {
      this.data[i].life = 0;
      this.colorAttr.setW(i, 0);
    }
    this.colorAttr.needsUpdate = true;
  }
}

/** Generates a soft blotchy splat texture. */
export function makeSplatTexture(seed = 1, soft = false): THREE.Texture {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  if (soft) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  } else {
    for (let i = 0; i < 18; i++) {
      const a = rnd() * Math.PI * 2;
      const r = i === 0 ? 0 : rnd() * 38;
      const x = 64 + Math.cos(a) * r;
      const y = 64 + Math.sin(a) * r;
      const rad = i === 0 ? 30 : 6 + rnd() * 16;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.8)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

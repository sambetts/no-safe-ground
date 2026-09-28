import * as THREE from 'three';
import { Noise2D } from '../core/noise';
import { clamp, len, smoothstep } from '../core/math';
import { WORLD } from '../config';

export const B_ASH = 0;
export const B_RUST = 1;
export const B_MARSH = 2;
export const B_CRYSTAL = 3;
export const B_FUNGAL = 4;
export const B_HIVE = 5;
export type BiomeId = 0 | 1 | 2 | 3 | 4 | 5;
export const BIOME_COUNT = 6;

export interface BiomeDef {
  id: BiomeId;
  name: string;
  colA: THREE.Color;
  colB: THREE.Color;
  glow: THREE.Color; // night bioluminescence tint of the ground
  map: string; // minimap colour
}

const c = (hex: number) => new THREE.Color(hex);

export const BIOMES: BiomeDef[] = [
  { id: B_ASH, name: 'Ashfall Plain', colA: c(0x625d58), colB: c(0x77706a), glow: c(0x000000), map: '#6a645e' },
  { id: B_RUST, name: 'Rust Flats', colA: c(0x7c3f25), colB: c(0x9a5a34), glow: c(0x000000), map: '#8a4a2c' },
  { id: B_MARSH, name: 'Acid Marsh', colA: c(0x33431f), colB: c(0x4a5526), glow: c(0x58ff2a), map: '#3d4d22' },
  { id: B_CRYSTAL, name: 'Crystal Barrens', colA: c(0x6a6488), colB: c(0x8b86a8), glow: c(0x3fd8ff), map: '#77709a' },
  { id: B_FUNGAL, name: 'Fungal Deep', colA: c(0x33234a), colB: c(0x46305c), glow: c(0x2affc6), map: '#3c2a52' },
  { id: B_HIVE, name: 'The Hive', colA: c(0x4a2629), colB: c(0x5f3336), glow: c(0xff2a55), map: '#5a2a30' },
];

/** Sector centre angles (atan2(z, x)) for the four outer biomes. Screen-up is -Z. */
export const SECTORS: { biome: BiomeId; angle: number }[] = [
  { biome: B_MARSH, angle: -Math.PI / 4 }, // north-east
  { biome: B_CRYSTAL, angle: Math.PI / 4 }, // south-east
  { biome: B_FUNGAL, angle: (3 * Math.PI) / 4 }, // south-west
  { biome: B_HIVE, angle: (-3 * Math.PI) / 4 }, // north-west
];

export interface TerrainModifier {
  x: number;
  z: number;
  r: number;
  kind: 'pool' | 'flatten' | 'crater' | 'mound';
  depth: number;
}

export class Terrain {
  readonly noise: Noise2D;
  private n2: Noise2D;
  readonly size = WORLD.terrainSize;
  readonly cell = WORLD.terrainCell;
  readonly verts: number; // vertices per side
  heights!: Float32Array;
  private mods: TerrainModifier[] = [];
  private w = new Float32Array(BIOME_COUNT);

  constructor(seed: number) {
    this.noise = new Noise2D(seed);
    this.n2 = new Noise2D(seed ^ 0x5bd1e995);
    this.verts = Math.floor(this.size / this.cell) + 1;
  }

  addModifier(m: TerrainModifier): void {
    this.mods.push(m);
  }

  /** Biome blend weights at a point (writes into `out`, returns it). */
  weights(x: number, z: number, out: Float32Array = this.w): Float32Array {
    const n = this.noise;
    const r = len(x, z);
    const warp = n.fbm(x * 0.006 + 11.3, z * 0.006 - 7.1, 3) * 1.1;
    const a = Math.atan2(z, x) + warp;
    let sum = 0;
    const k = 6;
    const sw = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const v = Math.exp(k * Math.cos(a - SECTORS[i].angle));
      sw[i] = v;
      sum += v;
    }
    const ash = smoothstep(44, 24, r + n.noise(x * 0.03 + 5, z * 0.03) * 9);
    const rustN = n.fbm(x * 0.017 - 3, z * 0.017 + 9, 3);
    const rust = smoothstep(98, 58, r + rustN * 26) * (1 - ash);
    const rest = Math.max(0, 1 - ash - rust);
    out.fill(0);
    out[B_ASH] = ash;
    out[B_RUST] = rust;
    for (let i = 0; i < 4; i++) out[SECTORS[i].biome] += (sw[i] / sum) * rest;
    return out;
  }

  biomeAt(x: number, z: number): BiomeId {
    const w = this.weights(x, z);
    let best = 0;
    for (let i = 1; i < BIOME_COUNT; i++) if (w[i] > w[best]) best = i;
    return best as BiomeId;
  }

  private rawHeight(x: number, z: number): number {
    const n = this.noise;
    const w = this.weights(x, z);
    const r = len(x, z);
    let h = n.fbm(x * 0.011, z * 0.011, 4) * 2.4 + n.noise(x * 0.06 + 3.3, z * 0.06 - 1.7) * 0.28;
    h += w[B_RUST] * (n.ridged(x * 0.02, z * 0.02, 3) * 2.2 - 0.6);
    h += w[B_MARSH] * -1.0;
    h += w[B_CRYSTAL] * (n.ridged(x * 0.03 + 7, z * 0.03, 3) * 2.8 - 0.4);
    h += w[B_FUNGAL] * (this.n2.fbm(x * 0.03, z * 0.03, 3) * 1.6);
    h += w[B_HIVE] * (Math.pow(n.ridged(x * 0.045 - 2, z * 0.045 + 4, 2), 2) * 2.6 - 0.3);
    // boundary mountains
    const edgeN = n.fbm(x * 0.02 + 40, z * 0.02 - 40, 3);
    const edge = smoothstep(WORLD.radius - 4, WORLD.radius + 34, r + edgeN * 10);
    h += edge * edge * (20 + n.ridged(x * 0.025, z * 0.025, 4) * 34);
    // modifiers
    for (const m of this.mods) {
      const dx = x - m.x;
      const dz = z - m.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > m.r * 1.8) continue;
      const t = d / m.r;
      if (m.kind === 'pool') {
        h = h * smoothstep(0.7, 1.6, t) + (1 - smoothstep(0.7, 1.6, t)) * (h * 0.2) - m.depth * (1 - smoothstep(0.0, 1.05, t));
      } else if (m.kind === 'flatten') {
        const k2 = smoothstep(1.6, 0.9, t);
        h = h * (1 - k2) + m.depth * k2;
      } else if (m.kind === 'crater') {
        const bowl = t < 1 ? -m.depth * (1 - t * t) : 0;
        const rim = Math.exp(-((t - 1.05) * (t - 1.05)) / 0.03) * m.depth * 0.45;
        h = h * smoothstep(0.4, 1.4, t) + bowl + rim;
      } else if (m.kind === 'mound') {
        h += m.depth * Math.max(0, 1 - t * t);
      }
    }
    return h;
  }

  /** Analytic height (including modifiers added so far). Used before the grid is built. */
  sampleRaw(x: number, z: number): number {
    return this.rawHeight(x, z);
  }

  /** Samples raw heights into the grid. Call after all modifiers are added. */
  build(): void {
    const N = this.verts;
    this.heights = new Float32Array(N * N);
    const half = this.size / 2;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        this.heights[j * N + i] = this.rawHeight(-half + i * this.cell, -half + j * this.cell);
      }
    }
  }

  /** Height matching the rendered triangles exactly. */
  heightAt(x: number, z: number): number {
    const N = this.verts;
    const half = this.size / 2;
    const gx = clamp((x + half) / this.cell, 0, N - 1.001);
    const gz = clamp((z + half) / this.cell, 0, N - 1.001);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const H = this.heights;
    const a = H[j * N + i];
    const b = H[j * N + i + 1];
    const cc = H[(j + 1) * N + i];
    const d = H[(j + 1) * N + i + 1];
    if (fx + fz <= 1) return a + (b - a) * fx + (cc - a) * fz;
    return d + (cc - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  /** Smooth per-vertex normals sampled from the height grid (central differences). */
  private smoothNormals(pos: Float32Array): Float32Array {
    const out = new Float32Array(pos.length);
    const e = this.cell;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i];
      const z = pos[i + 2];
      const nx = this.heightAt(x - e, z) - this.heightAt(x + e, z);
      const nz = this.heightAt(x, z - e) - this.heightAt(x, z + e);
      const ny = 2 * e;
      const l = Math.hypot(nx, ny, nz) || 1;
      out[i] = nx / l;
      out[i + 1] = ny / l;
      out[i + 2] = nz / l;
    }
    return out;
  }

  /** Builds the flat-shaded low-poly terrain mesh with per-face colours and a night-glow attribute. */
  buildMesh(glowUniform: { value: number }, timeUniform: { value: number }): THREE.Mesh {
    const N = this.verts;
    const half = this.size / 2;
    const quads = (N - 1) * (N - 1);
    const pos = new Float32Array(quads * 6 * 3);
    const col = new Float32Array(quads * 6 * 3);
    const glow = new Float32Array(quads * 6 * 3);
    const vcol: THREE.Color[] = [];
    const vglow: THREE.Color[] = [];
    const tmp = new THREE.Color();
    const w = new Float32Array(BIOME_COUNT);
    const n = this.noise;
    // per-vertex colours
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = -half + i * this.cell;
        const z = -half + j * this.cell;
        this.weights(x, z, w);
        const col2 = new THREE.Color(0, 0, 0);
        const g = new THREE.Color(0, 0, 0);
        const v = n.fbm(x * 0.05 + 100, z * 0.05, 2) * 0.5 + 0.5;
        for (let b = 0; b < BIOME_COUNT; b++) {
          if (w[b] < 0.001) continue;
          tmp.copy(BIOMES[b].colA).lerp(BIOMES[b].colB, v);
          col2.r += tmp.r * w[b];
          col2.g += tmp.g * w[b];
          col2.b += tmp.b * w[b];
        }
        const r = len(x, z);
        // biome ground patterns that glow at night
        const vein = Math.pow(n.ridged(x * 0.09 + 50, z * 0.09 - 20, 2), 6);
        const spots = smoothstep(0.55, 0.8, this.n2.noise(x * 0.14, z * 0.14));
        g.r += BIOMES[B_HIVE].glow.r * w[B_HIVE] * vein * 1.4;
        g.g += BIOMES[B_HIVE].glow.g * w[B_HIVE] * vein * 1.4;
        g.b += BIOMES[B_HIVE].glow.b * w[B_HIVE] * vein * 1.4;
        col2.lerp(tmp.setHex(0x9a2f3c), w[B_HIVE] * vein * 0.6);
        g.r += BIOMES[B_FUNGAL].glow.r * w[B_FUNGAL] * spots * 0.55;
        g.g += BIOMES[B_FUNGAL].glow.g * w[B_FUNGAL] * spots * 0.55;
        g.b += BIOMES[B_FUNGAL].glow.b * w[B_FUNGAL] * spots * 0.55;
        col2.lerp(tmp.setHex(0x2d6b6a), w[B_FUNGAL] * spots * 0.35);
        const crystalSpark = smoothstep(0.7, 0.9, n.noise(x * 0.2 - 9, z * 0.2 + 4));
        g.r += BIOMES[B_CRYSTAL].glow.r * w[B_CRYSTAL] * crystalSpark * 0.4;
        g.g += BIOMES[B_CRYSTAL].glow.g * w[B_CRYSTAL] * crystalSpark * 0.4;
        g.b += BIOMES[B_CRYSTAL].glow.b * w[B_CRYSTAL] * crystalSpark * 0.4;
        // crash scorch around the ship
        const scorch = smoothstep(15, 4, r + n.noise(x * 0.18, z * 0.18) * 6);
        col2.multiplyScalar(1 - scorch * 0.42);
        const ember = scorch * smoothstep(0.62, 0.9, n.noise(x * 0.5 + 7, z * 0.5 - 3)) * smoothstep(3, 8, r);
        g.r += ember * 0.3;
        g.g += ember * 0.07;
        g.b += ember * 0.01;
        // mountains: rocky, darker, snow-less dusty tops
        const edge = smoothstep(WORLD.radius, WORLD.radius + 30, r);
        col2.lerp(tmp.setHex(0x3a302e), edge * 0.7);
        vcol.push(col2);
        vglow.push(g);
      }
    }
    // pools: tint ground near modifiers
    let k = 0;
    const jitterNoise = this.n2;
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const ia = j * N + i;
        const ib = j * N + i + 1;
        const ic = (j + 1) * N + i;
        const id = (j + 1) * N + i + 1;
        const x0 = -half + i * this.cell;
        const z0 = -half + j * this.cell;
        const x1 = x0 + this.cell;
        const z1 = z0 + this.cell;
        const tris: [number, number, number][] = [
          [ia, ic, ib],
          [ib, ic, id],
        ];
        for (let t = 0; t < 2; t++) {
          const [p, q, s] = tris[t];
          const jit = 0.95 + 0.1 * (jitterNoise.noise((x0 + t * 0.7) * 1.3, z0 * 1.3) * 0.5 + 0.5);
          const cr = ((vcol[p].r + vcol[q].r + vcol[s].r) / 3) * jit;
          const cg = ((vcol[p].g + vcol[q].g + vcol[s].g) / 3) * jit;
          const cb = ((vcol[p].b + vcol[q].b + vcol[s].b) / 3) * jit;
          for (const vi of [p, q, s]) {
            const vx = vi === ia || vi === ic ? x0 : x1;
            const vz = vi === ia || vi === ib ? z0 : z1;
            pos[k] = vx;
            pos[k + 1] = this.heights[vi];
            pos[k + 2] = vz;
            col[k] = cr;
            col[k + 1] = cg;
            col[k + 2] = cb;
            // glow is interpolated per vertex so it reads as soft light rather than lit facets
            glow[k] = vglow[vi].r;
            glow[k + 1] = vglow[vi].g;
            glow[k + 2] = vglow[vi].b;
            k += 3;
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.smoothNormals(pos), 3));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uGlow = glowUniform;
      shader.uniforms.uTime = timeUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aGlow;\nvarying vec3 vGlow;\nvarying vec3 vWp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;\nvWp = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uGlow;\nuniform float uTime;\nvarying vec3 vGlow;\nvarying vec3 vWp;')
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\nfloat pulse = 0.65 + 0.35 * sin(uTime * 1.3 + vWp.x * 0.15 + vWp.z * 0.11);\ntotalEmissiveRadiance += vGlow * uGlow * pulse * 1.6;',
        );
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }
}

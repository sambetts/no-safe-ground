import * as THREE from 'three';
import { Rng } from '../core/rng';
import { B_ASH, B_CRYSTAL, B_FUNGAL, B_HIVE, B_MARSH, B_RUST, BiomeId } from '../world/terrain';
import type { WorldLayout } from '../world/worldgen';
import {
  crystalClusterGeo,
  geyserGeo,
  mushroomGeo,
  reedGeo,
  ribcageGeo,
  rockGeo,
  smallShroomGeo,
  spireGeo,
  tendrilGeo,
  tuftGeo,
  wreckGeo,
} from './models';
import { envMaterial, glowMaterial, poolMaterial, shared } from './materials';

interface Variant {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  shadow: boolean;
  items: { m: THREE.Matrix4; c: THREE.Color }[];
}

const CHUNK = 48;

/** Collects static instances and emits chunked InstancedMeshes so off-screen chunks are frustum culled. */
export class StaticInstancer {
  private variants = new Map<string, Variant>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  register(key: string, geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true): void {
    this.variants.set(key, { geo, mat, shadow, items: [] });
  }

  has(key: string): boolean {
    return this.variants.has(key);
  }

  add(key: string, x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation = 0xffffff, tiltX = 0, tiltZ = 0): void {
    const va = this.variants.get(key);
    if (!va) throw new Error(`unknown variant ${key}`);
    this.e.set(tiltX, rotY, tiltZ, 'YXZ');
    this.q.setFromEuler(this.e);
    this.v.set(x, y, z);
    this.s.set(sx, sy, sz);
    this.m.compose(this.v, this.q, this.s);
    va.items.push({ m: this.m.clone(), c: new THREE.Color(color) });
  }

  build(parent: THREE.Object3D): void {
    for (const [key, va] of this.variants) {
      const chunks = new Map<number, { m: THREE.Matrix4; c: THREE.Color }[]>();
      for (const it of va.items) {
        const cx = Math.floor(it.m.elements[12] / CHUNK);
        const cz = Math.floor(it.m.elements[14] / CHUNK);
        const k = cx * 1000 + cz;
        let arr = chunks.get(k);
        if (!arr) chunks.set(k, (arr = []));
        arr.push(it);
      }
      for (const arr of chunks.values()) {
        const im = new THREE.InstancedMesh(va.geo, va.mat, arr.length);
        for (let i = 0; i < arr.length; i++) {
          im.setMatrixAt(i, arr[i].m);
          im.setColorAt(i, arr[i].c);
        }
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = va.shadow;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        im.name = key;
        parent.add(im);
      }
    }
  }
}

const ROCK_COL: Record<BiomeId, number> = {
  [B_ASH]: 0x5d5f66,
  [B_RUST]: 0x8e5234,
  [B_MARSH]: 0x4a5540,
  [B_CRYSTAL]: 0x8d88ad,
  [B_FUNGAL]: 0x45385a,
  [B_HIVE]: 0x6e2c38,
};
const TUFT_COL: Record<BiomeId, number> = {
  [B_ASH]: 0x77736a,
  [B_RUST]: 0xb07a3a,
  [B_MARSH]: 0x7a9a3a,
  [B_CRYSTAL]: 0x9a8ac0,
  [B_FUNGAL]: 0x5a7ab0,
  [B_HIVE]: 0x9a3a4a,
};

export interface EnvironmentHandles {
  group: THREE.Group;
  terrain: THREE.Mesh;
  glowMaterials: THREE.Material[];
}

export function buildEnvironment(layout: WorldLayout): EnvironmentHandles {
  const group = new THREE.Group();
  group.name = 'environment';
  const t = layout.terrain;
  const terrainMesh = t.buildMesh(shared.uNight, shared.uTime);
  group.add(terrainMesh);

  const inst = new StaticInstancer();
  const env = envMaterial();
  const glowSoft = glowMaterial(0.9, 2.2);
  const glowCrystal = glowMaterial(0.55, 1.8);
  for (let i = 0; i < 4; i++) inst.register(`rock${i}`, rockGeo(100 + i), env);
  for (let i = 0; i < 3; i++) inst.register(`pebble${i}`, rockGeo(200 + i, 0), env, false);
  for (let i = 0; i < 3; i++) inst.register(`spire${i}`, spireGeo(300 + i), env);
  for (let i = 0; i < 4; i++) {
    const m = mushroomGeo(400 + i);
    inst.register(`mushroom${i}`, m.body, env);
    inst.register(`mushroom${i}g`, m.glow, glowSoft, false);
  }
  for (let i = 0; i < 3; i++) inst.register(`tuft${i}`, tuftGeo(500 + i), env, false);
  for (let i = 0; i < 2; i++) {
    const r = reedGeo(600 + i);
    inst.register(`reed${i}`, r.body, env, false);
    inst.register(`reed${i}g`, r.glow, glowSoft, false);
  }
  for (let i = 0; i < 2; i++) {
    const s = smallShroomGeo(700 + i);
    inst.register(`shroomlet${i}`, s.body, env, false);
    inst.register(`shroomlet${i}g`, s.glow, glowSoft, false);
  }
  for (let i = 0; i < 3; i++) {
    const s = tendrilGeo(800 + i);
    inst.register(`tendril${i}`, s.body, env, false);
    inst.register(`tendril${i}g`, s.glow, glowSoft, false);
  }
  for (let i = 0; i < 2; i++) inst.register(`shardling${i}`, crystalClusterGeo(900 + i, 4), glowCrystal, false);
  inst.register('ribcage', ribcageGeo(), env);
  inst.register('geyser', geyserGeo(), env, false);

  const rng = new Rng(layout.seed ^ 0xabcdef);
  const col = new THREE.Color();
  for (const o of layout.obstacles) {
    const y = t.heightAt(o.x, o.z);
    const rot = rng.range(0, Math.PI * 2);
    const base = ROCK_COL[o.biome];
    col.setHex(base).multiplyScalar(rng.range(0.85, 1.12));
    switch (o.kind) {
      case 'rock': {
        const k = `rock${rng.int(0, 3)}`;
        const h = o.r * rng.range(0.75, 1.25);
        inst.add(k, o.x, y - 0.25 * o.r, o.z, rot, o.r * 1.08, h, o.r * 1.08, col, rng.range(-0.1, 0.1), rng.range(-0.1, 0.1));
        break;
      }
      case 'pillar': {
        const k = `rock${rng.int(0, 3)}`;
        inst.add(k, o.x, y - 0.2, o.z, rot, o.r * 1.05, o.r * rng.range(1.6, 2.4), o.r * 1.05, col);
        const tk = `tendril${rng.int(0, 2)}`;
        inst.add(tk, o.x, y + o.r * 0.9, o.z, rot, 0.8, 0.8, 0.8, 0xffffff);
        inst.add(`${tk}g`, o.x, y + o.r * 0.9, o.z, rot, 0.8, 0.8, 0.8, 0xffffff);
        break;
      }
      case 'spire': {
        const k = `spire${rng.int(0, 2)}`;
        const s = o.r * 0.95;
        inst.add(k, o.x, y - 0.2, o.z, rot, s, s * rng.range(1.0, 1.9), s, col, rng.range(-0.08, 0.08), rng.range(-0.08, 0.08));
        break;
      }
      case 'mushroom': {
        const i = rng.int(0, 3);
        const s = o.r / 0.45;
        const sc = Math.min(1.5, s * 0.8);
        inst.add(`mushroom${i}`, o.x, y - 0.1, o.z, rot, sc, sc, sc, 0xffffff);
        const hue = rng.chance(0.5) ? 0xffffff : 0xb0c0ff;
        inst.add(`mushroom${i}g`, o.x, y - 0.1, o.z, rot, sc, sc, sc, hue);
        break;
      }
      default:
        break;
    }
  }

  for (const d of layout.decor) {
    const y = t.heightAt(d.x, d.z);
    const s = d.scale;
    switch (d.kind) {
      case 'pebble': {
        col.setHex(ROCK_COL[d.biome]).multiplyScalar(rng.range(0.7, 1.0));
        const ps = s * rng.range(0.18, 0.45);
        inst.add(`pebble${rng.int(0, 2)}`, d.x, y, d.z, d.rot, ps, ps * 0.7, ps, col);
        break;
      }
      case 'tuft':
        col.setHex(TUFT_COL[d.biome]).multiplyScalar(rng.range(0.8, 1.15));
        inst.add(`tuft${rng.int(0, 2)}`, d.x, y, d.z, d.rot, s, s, s, col, d.tilt ?? 0, 0);
        break;
      case 'reed': {
        const k = `reed${rng.int(0, 1)}`;
        inst.add(k, d.x, y, d.z, d.rot, s, s, s, 0xffffff, d.tilt ?? 0, 0);
        inst.add(`${k}g`, d.x, y, d.z, d.rot, s, s, s, 0xffffff, d.tilt ?? 0, 0);
        break;
      }
      case 'shroomlet': {
        const k = `shroomlet${rng.int(0, 1)}`;
        inst.add(k, d.x, y, d.z, d.rot, s, s, s, 0xffffff);
        inst.add(`${k}g`, d.x, y, d.z, d.rot, s, s, s, 0xffffff);
        break;
      }
      case 'tendril': {
        const k = `tendril${rng.int(0, 2)}`;
        inst.add(k, d.x, y - 0.1, d.z, d.rot, s * 0.7, s * 0.7, s * 0.7, 0xffffff, d.tilt ?? 0, 0);
        inst.add(`${k}g`, d.x, y - 0.1, d.z, d.rot, s * 0.7, s * 0.7, s * 0.7, 0xffffff, d.tilt ?? 0, 0);
        break;
      }
      case 'shardling': {
        const tint = rng.chance(0.6) ? 0xb46aff : 0xff5ad8;
        inst.add(`shardling${rng.int(0, 1)}`, d.x, y - 0.05, d.z, d.rot, s * 0.5, s * 0.5, s * 0.5, tint, d.tilt ?? 0, 0);
        break;
      }
      case 'ribcage':
        inst.add('ribcage', d.x, y - 0.3, d.z, d.rot, s, s, s, 0xffffff, 0, rng.range(-0.08, 0.08));
        break;
    }
  }

  for (const gz of layout.geysers) inst.add('geyser', gz.x, t.heightAt(gz.x, gz.z), gz.z, rng.range(0, 6), 1, 1, 1, 0xffffff);

  inst.build(group);

  // wrecks
  for (let i = 0; i < layout.wrecks.length; i++) {
    const w = layout.wrecks[i];
    const mesh = new THREE.Mesh(wreckGeo(1000 + i), env);
    mesh.position.set(w.x, t.heightAt(w.x, w.z) - 0.4, w.z);
    mesh.rotation.y = w.rot;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // acid pools
  const acid = poolMaterial(0x6dff2a);
  const poolGeo = new THREE.CircleGeometry(1, 28);
  poolGeo.rotateX(-Math.PI / 2);
  for (const p of layout.pools) {
    const m = new THREE.Mesh(poolGeo, acid);
    let minH = Infinity;
    for (let a = 0; a < 8; a++) minH = Math.min(minH, t.heightAt(p.x + Math.cos(a) * p.r * 0.9, p.z + Math.sin(a) * p.r * 0.9));
    m.position.set(p.x, Math.min(minH - 0.05, t.heightAt(p.x, p.z) + 0.55), p.z);
    m.scale.setScalar(p.r * 1.05);
    m.renderOrder = 4;
    group.add(m);
  }

  return { group, terrain: terrainMesh, glowMaterials: [glowSoft, glowCrystal] };
}

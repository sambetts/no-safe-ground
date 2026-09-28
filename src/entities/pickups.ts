import * as THREE from 'three';
import { clamp, dist, rand, TAU } from '../core/math';
import { audio } from '../audio/audio';
import { scrapGeo, shardGeo } from '../render/models';
import { envMaterial } from '../render/materials';
import type { Game } from '../game';

export type PickupKind = 'scrap' | 'xenite' | 'health';

interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  value: number;
  age: number;
  settled: boolean;
  magnet: boolean;
  spin: number;
  alive: boolean;
}

const MAX = 700;

export class PickupSystem {
  private list: Pickup[] = [];
  private meshes: Record<PickupKind, THREE.InstancedMesh>;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(private game: Game) {
    const shard = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3ff0ff).multiplyScalar(2.6), toneMapped: false });
    const health = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3a5a).multiplyScalar(2.6), toneMapped: false });
    this.meshes = {
      scrap: new THREE.InstancedMesh(scrapGeo(), envMaterial(), MAX),
      xenite: new THREE.InstancedMesh(shardGeo(), shard, MAX),
      health: new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.22, 1), health, 60),
    };
    for (const k of Object.keys(this.meshes) as PickupKind[]) {
      const im = this.meshes[k];
      im.frustumCulled = false;
      im.count = 0;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = k === 'scrap';
      game.renderer.scene.add(im);
    }
  }

  clear(): void {
    this.list.length = 0;
  }

  /** Scatter `total` units of a resource as individual pickups flying out from a point. */
  burst(kind: PickupKind, x: number, z: number, total: number, y?: number): void {
    if (total <= 0) return;
    const g = this.game;
    const y0 = y ?? g.terrain.heightAt(x, z) + 0.8;
    let remaining = Math.round(total);
    while (remaining > 0 && this.list.length < MAX) {
      const v = kind === 'health' ? 1 : kind === 'scrap' ? Math.min(remaining, remaining > 12 ? 3 : 2) : Math.min(remaining, remaining > 16 ? 2 : 1);
      remaining -= v;
      const a = rand(0, TAU);
      const sp = rand(1.5, 4.5);
      this.list.push({ kind, x, y: y0, z, vx: Math.cos(a) * sp, vy: rand(4, 8), vz: Math.sin(a) * sp, value: v, age: 0, settled: false, magnet: false, spin: rand(0, TAU), alive: true });
    }
  }

  place(kind: PickupKind, x: number, z: number, value: number): void {
    const y = this.game.terrain.heightAt(x, z) + 0.15;
    this.list.push({ kind, x, y, z, vx: 0, vy: 0, vz: 0, value, age: 0, settled: true, magnet: false, spin: rand(0, TAU), alive: true });
  }

  /** Pull everything nearby toward the player (used when entering the ship field). */
  vacuum(x: number, z: number, r: number): void {
    for (const p of this.list) if (dist(p.x, p.z, x, z) < r) p.magnet = true;
  }

  update(dt: number): void {
    const g = this.game;
    const pl = g.player;
    const magnet = g.stats.magnet;
    for (const p of this.list) {
      if (!p.alive) continue;
      p.age += dt;
      p.spin += dt * 2.5;
      const gh = g.terrain.heightAt(p.x, p.z) + 0.15;
      if (pl.alive) {
        const d = dist(p.x, p.z, pl.x, pl.z);
        if (!p.magnet && d < magnet && p.age > 0.35) p.magnet = true;
        if (p.magnet) {
          const dx = pl.x - p.x;
          const dz = pl.z - p.z;
          const dy = pl.y + 1 - p.y;
          const l = Math.hypot(dx, dz, dy) || 1;
          const sp = clamp(8 + p.age * 6, 8, 26);
          p.vx += ((dx / l) * sp - p.vx) * Math.min(1, dt * 10);
          p.vz += ((dz / l) * sp - p.vz) * Math.min(1, dt * 10);
          p.vy += ((dy / l) * sp - p.vy) * Math.min(1, dt * 10);
          p.settled = false;
          if (d < 0.9) {
            this.collect(p);
            continue;
          }
        }
      }
      if (!p.settled) {
        if (!p.magnet) p.vy -= 22 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (!p.magnet && p.y < gh) {
          p.y = gh;
          if (Math.abs(p.vy) < 2) {
            p.vy = 0;
            p.vx = 0;
            p.vz = 0;
            p.settled = true;
          } else {
            p.vy *= -0.35;
            p.vx *= 0.55;
            p.vz *= 0.55;
          }
        }
      } else {
        p.y = gh;
      }
      if (p.age > 150) p.alive = false;
    }
    this.list = this.list.filter((p) => p.alive);
    this.render(g.time);
  }

  private collect(p: Pickup): void {
    const g = this.game;
    p.alive = false;
    if (p.kind === 'scrap') {
      g.inventory.scrap += p.value;
      g.record.scrap += p.value;
      audio.play('pickupScrap', { volume: 0.5 });
      g.hud.bump('scrap');
    } else if (p.kind === 'xenite') {
      g.inventory.xenite += p.value;
      g.record.xenite += p.value;
      audio.play('pickupXenite', { volume: 0.45 });
      g.hud.bump('xenite');
    } else {
      g.player.heal(12);
      audio.play('pickupHealth', { volume: 0.7 });
      g.fx.sparks(g.player.x, g.player.y + 1.2, g.player.z, 0xff5a7a, 8, 3, 0.4);
    }
    g.fx.glow.spawn({ x: p.x, y: p.y, z: p.z, life: 0.2, size: 0.8, sizeEnd: 0, color: p.kind === 'xenite' ? 0x7ff8ff : p.kind === 'scrap' ? 0xffe0b0 : 0xff5a7a });
  }

  private render(time: number): void {
    const counts: Record<PickupKind, number> = { scrap: 0, xenite: 0, health: 0 };
    for (const p of this.list) {
      const im = this.meshes[p.kind];
      const i = counts[p.kind];
      if (i >= im.instanceMatrix.count) continue;
      const blink = p.age > 140 && Math.floor(time * 8) % 2 === 0;
      const bob = p.settled ? 0.18 + Math.sin(time * 3 + p.spin) * 0.08 : 0;
      this.e.set(p.kind === 'scrap' ? 0.3 : 0, p.spin, 0);
      this.q.setFromEuler(this.e);
      this.v.set(p.x, p.y + bob + (p.kind === 'xenite' ? 0.15 : 0), p.z);
      const sc = blink ? 0 : p.kind === 'scrap' ? 1 + (p.value - 1) * 0.25 : p.kind === 'xenite' ? 1 + (p.value - 1) * 0.35 : 1;
      this.s.set(sc, sc, sc);
      this.m.compose(this.v, this.q, this.s);
      im.setMatrixAt(i, this.m);
      counts[p.kind]++;
    }
    for (const k of Object.keys(this.meshes) as PickupKind[]) {
      const im = this.meshes[k];
      im.count = counts[k];
      im.instanceMatrix.needsUpdate = true;
    }
  }
}

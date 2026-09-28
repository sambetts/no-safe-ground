import * as THREE from 'three';
import { dist, rand, TAU } from '../core/math';
import { Rng } from '../core/rng';
import { audio } from '../audio/audio';
import { bulbPlantGeo, crateGeo, crystalClusterGeo, healPodGeo, oreGeo, rockGeo } from '../render/models';
import { envMaterial, glowMaterial } from '../render/materials';
import type { Game } from '../game';
import type { Obstacle, WorldLayout } from '../world/worldgen';

interface Node {
  kind: 'xenite' | 'ore' | 'crate';
  x: number;
  z: number;
  y: number;
  rot: number;
  scale: number;
  hp: number;
  maxHp: number;
  total: number;
  yielded: number;
  alive: boolean;
  shake: number;
  obstacle: Obstacle | null;
}

interface Plant {
  kind: 'bulb' | 'pod';
  x: number;
  z: number;
  y: number;
  rot: number;
  ready: boolean;
  regrow: number;
  grow: number;
}

/** Harvestable resource nodes, supply crates, and the useful flora (O2 bulbs, healing pods). */
export class ResourceSystem {
  nodes: Node[] = [];
  plants: Plant[] = [];
  private xenBody: THREE.InstancedMesh;
  private xenBase: THREE.InstancedMesh;
  private oreBody: THREE.InstancedMesh;
  private oreGlow: THREE.InstancedMesh;
  private crateMesh: THREE.InstancedMesh;
  private bulbBody: THREE.InstancedMesh;
  private bulbGlow: THREE.InstancedMesh;
  private podBody: THREE.InstancedMesh;
  private podGlow: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private nodeIndex: Map<number, number> = new Map(); // obstacle.ref -> node index
  private dirty = true;

  constructor(private game: Game) {
    const sc = game.worldRoot;
    const env = envMaterial();
    const layout = game.layout;
    const xen = layout.resources.filter((r) => r.kind === 'xenite').length;
    const ore = layout.resources.length - xen;
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow = true) => {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
      im.count = 0;
      im.castShadow = shadow;
      im.receiveShadow = true;
      im.frustumCulled = false;
      sc.add(im);
      return im;
    };
    this.xenBody = mk(crystalClusterGeo(55, 7, 0x3fdcff), glowMaterial(1.0, 2.2), xen, false);
    this.xenBase = mk(rockGeo(56), env, xen);
    const og = oreGeo(57);
    this.oreBody = mk(og.body, env, ore);
    this.oreGlow = mk(og.glow, glowMaterial(1.2, 2.6), ore, false);
    this.crateMesh = mk(crateGeo(), env, layout.crates.length);
    const bg = bulbPlantGeo();
    this.bulbBody = mk(bg.body, env, layout.bulbs.length, false);
    this.bulbGlow = mk(bg.glow, glowMaterial(1.3, 2.8), layout.bulbs.length, false);
    const pg = healPodGeo();
    this.podBody = mk(pg.body, env, layout.pods.length, false);
    this.podGlow = mk(pg.glow, glowMaterial(1.2, 2.6), layout.pods.length, false);
    this.xenBase.setColorAt(0, new THREE.Color(0x4a4c58));
  }

  init(layout: WorldLayout): void {
    const g = this.game;
    const rng = new Rng(layout.seed ^ 0x1234);
    this.nodes = [];
    this.nodeIndex.clear();
    for (const o of layout.obstacles) {
      if (o.kind !== 'node') continue;
      const r = layout.resources[o.ref];
      const isX = r.kind === 'xenite';
      const total = Math.round((isX ? rng.range(10, 15) : rng.range(15, 22)) * r.scale * g.difficulty.resourceMult);
      const hp = (isX ? 60 : 85) * r.scale;
      this.nodeIndex.set(o.ref, this.nodes.length);
      this.nodes.push({ kind: r.kind, x: r.x, z: r.z, y: g.terrain.heightAt(r.x, r.z), rot: r.rot, scale: r.scale, hp, maxHp: hp, total, yielded: 0, alive: true, shake: 0, obstacle: o });
    }
    // crates are obstacles too
    for (const c of layout.crates) {
      const o: Obstacle = { id: layout.obstacles.length + 5000 + this.nodes.length, x: c.x, z: c.z, r: 0.55, kind: 'crate', biome: 0, alive: true, ref: -1 };
      const idx = this.nodes.length;
      o.ref = 100000 + idx;
      this.nodeIndex.set(o.ref, idx);
      this.nodes.push({ kind: 'crate', x: c.x, z: c.z, y: g.terrain.heightAt(c.x, c.z), rot: c.rot, scale: 1, hp: 25, maxHp: 25, total: Math.round(rng.range(10, 16) * g.difficulty.resourceMult), yielded: 0, alive: true, shake: 0, obstacle: o });
      g.grid.add(o);
    }
    this.plants = [];
    for (const b of layout.bulbs) this.plants.push({ kind: 'bulb', x: b.x, z: b.z, y: g.terrain.heightAt(b.x, b.z), rot: rng.range(0, TAU), ready: true, regrow: 0, grow: 1 });
    for (const p of layout.pods) this.plants.push({ kind: 'pod', x: p.x, z: p.z, y: g.terrain.heightAt(p.x, p.z), rot: rng.range(0, TAU), ready: true, regrow: 0, grow: 1 });
    this.dirty = true;
  }

  /** Called when a bolt hits an obstacle registered as a node or crate. */
  hitNode(ref: number, dmg: number, hx: number, hz: number): void {
    const idx = this.nodeIndex.get(ref);
    if (idx === undefined) {
      // crates share the same path via obstacle.ref >= 100000
      return;
    }
    this.damageNode(this.nodes[idx], dmg, hx, hz);
  }

  private damageNode(n: Node, dmg: number, hx: number, hz: number): void {
    if (!n.alive) return;
    const g = this.game;
    n.hp -= dmg;
    n.shake = 1;
    this.dirty = true;
    const kindRes = n.kind === 'xenite' ? 'xenite' : 'scrap';
    const col = n.kind === 'xenite' ? 0x7ff8ff : n.kind === 'ore' ? 0xffb070 : 0xffe0a0;
    g.fx.sparks(hx, n.y + 0.8, hz, col, 4, 5, 0.3, 0.14);
    audio.play(n.kind === 'xenite' ? 'pickupXenite' : 'hitArmor', { x: n.x, z: n.z, volume: 0.25, pitch: n.kind === 'xenite' ? 0.5 : 0.8 });
    const frac = Math.max(0, 1 - n.hp / n.maxHp);
    const due = Math.floor(frac * n.total * 0.6) - n.yielded;
    if (due > 0 && n.kind !== 'crate') {
      n.yielded += due;
      g.pickups.burst(kindRes, n.x, n.z, due, n.y + 1);
    }
    if (n.hp <= 0) {
      n.alive = false;
      if (n.obstacle) {
        n.obstacle.alive = false;
        g.grid.remove(n.obstacle);
      }
      const rest = n.total - n.yielded;
      g.pickups.burst(kindRes, n.x, n.z, rest, n.y + 1);
      if (n.kind === 'crate' && Math.random() < 0.35) g.pickups.burst('xenite', n.x, n.z, 4, n.y + 1);
      g.fx.sparks(n.x, n.y + 1, n.z, col, 18, 8, 0.6);
      g.fx.dust(n.x, n.z, 8, n.kind === 'xenite' ? 0x6a7a9a : 0x6a5a4a, 1.2, 1.5);
      g.fx.flash(n.x, n.y + 1.5, n.z, col, 12, 8, 0.25);
      audio.play(n.kind === 'xenite' ? 'shieldBreak' : 'shipHit', { x: n.x, z: n.z, volume: 0.6 });
      g.fx.shake(0.12);
      if (n.kind === 'xenite') g.hints.done('mine');
    }
  }

  blast(x: number, z: number, r: number, dmg: number): void {
    for (const n of this.nodes) if (n.alive && dist(n.x, n.z, x, z) < r + 1) this.damageNode(n, dmg * 0.6, n.x, n.z);
  }

  nearestNode(x: number, z: number, r: number, kind?: 'xenite' | 'ore'): Node | null {
    let best: Node | null = null;
    let bd = r;
    for (const n of this.nodes) {
      if (!n.alive || (kind && n.kind !== kind)) continue;
      const d = dist(n.x, n.z, x, z);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  update(dt: number): void {
    const g = this.game;
    const p = g.player;
    for (const n of this.nodes) {
      if (n.shake > 0) {
        n.shake = Math.max(0, n.shake - dt * 6);
        this.dirty = true;
      }
    }
    for (const pl of this.plants) {
      if (!pl.ready) {
        pl.regrow -= dt;
        pl.grow = Math.min(1, pl.grow + dt / (pl.kind === 'bulb' ? 70 : 110));
        if (pl.regrow <= 0) {
          pl.ready = true;
          pl.grow = 1;
        }
        this.dirty = true;
        continue;
      }
      if (!p.alive) continue;
      const d = dist(pl.x, pl.z, p.x, p.z);
      if (d < 1.4) {
        if (pl.kind === 'bulb') {
          if (p.o2 < g.stats.o2Max - 3) this.popBulb(pl);
        } else if (p.hp < g.stats.maxHp - 2) {
          pl.ready = false;
          pl.regrow = 110;
          pl.grow = 0;
          p.heal(30);
          audio.play('pickupHealth');
          g.fx.sparks(pl.x, pl.y + 0.9, pl.z, 0xff5a7a, 16, 4, 0.6);
          g.fx.ring(pl.x, pl.z, 0.3, 2.5, 0xff5a7a, 0.5);
          this.dirty = true;
          g.messages.toast('+30 integrity', 'good');
        }
      }
    }
    if (this.dirty) this.render(g.time);
  }

  private popBulb(pl: Plant): void {
    const g = this.game;
    const p = g.player;
    pl.ready = false;
    pl.regrow = 70;
    pl.grow = 0;
    this.dirty = true;
    const gain = g.stats.o2Max * 0.45;
    p.o2 = Math.min(g.stats.o2Max, p.o2 + gain);
    audio.play('bulbPop');
    for (let i = 0; i < 26; i++) {
      const a = rand(0, TAU);
      const s = rand(1, 4);
      g.fx.glow.spawn({ x: pl.x, y: pl.y + 1.2, z: pl.z, vx: Math.cos(a) * s, vy: rand(0.5, 3), vz: Math.sin(a) * s, life: rand(0.5, 1), size: 0.35, sizeEnd: 0.05, color: 0x5fd8ff, drag: 2 });
    }
    g.fx.ring(pl.x, pl.z, 0.3, 3, 0x5fd8ff, 0.5);
    g.messages.toast(`+${Math.round(gain)}s O₂`, 'air');
    g.hints.done('bulb');
  }

  private render(time: number): void {
    this.dirty = false;
    let xi = 0;
    let oi = 0;
    let ci = 0;
    for (const n of this.nodes) {
      if (!n.alive) continue;
      const sh = n.shake * 0.08;
      const hpS = 0.65 + 0.35 * (n.hp / n.maxHp);
      this.e.set(Math.sin(time * 60) * sh, n.rot, Math.cos(time * 55) * sh);
      this.q.setFromEuler(this.e);
      if (n.kind === 'xenite') {
        this.v.set(n.x, n.y - 0.1, n.z);
        this.s.setScalar(n.scale * hpS * 1.05);
        this.m.compose(this.v, this.q, this.s);
        this.xenBody.setMatrixAt(xi, this.m);
        this.s.set(n.scale * 1.1, n.scale * 0.45, n.scale * 1.1);
        this.v.y = n.y - 0.15;
        this.m.compose(this.v, this.q, this.s);
        this.xenBase.setMatrixAt(xi, this.m);
        xi++;
      } else if (n.kind === 'ore') {
        this.v.set(n.x, n.y - 0.2, n.z);
        this.s.setScalar(n.scale * (0.75 + 0.25 * hpS));
        this.m.compose(this.v, this.q, this.s);
        this.oreBody.setMatrixAt(oi, this.m);
        this.oreGlow.setMatrixAt(oi, this.m);
        oi++;
      } else {
        this.v.set(n.x, n.y, n.z);
        this.s.setScalar(1);
        this.m.compose(this.v, this.q, this.s);
        this.crateMesh.setMatrixAt(ci, this.m);
        ci++;
      }
    }
    this.xenBody.count = xi;
    this.xenBase.count = xi;
    this.oreBody.count = oi;
    this.oreGlow.count = oi;
    this.crateMesh.count = ci;
    let bi = 0;
    let pi = 0;
    for (const pl of this.plants) {
      this.e.set(0, pl.rot, 0);
      this.q.setFromEuler(this.e);
      this.v.set(pl.x, pl.y, pl.z);
      this.s.setScalar(1);
      this.m.compose(this.v, this.q, this.s);
      const body = pl.kind === 'bulb' ? this.bulbBody : this.podBody;
      const glow = pl.kind === 'bulb' ? this.bulbGlow : this.podGlow;
      const i = pl.kind === 'bulb' ? bi++ : pi++;
      body.setMatrixAt(i, this.m);
      this.s.setScalar(pl.ready ? 1 : 0.15 + pl.grow * 0.5);
      this.m.compose(this.v, this.q, this.s);
      glow.setMatrixAt(i, this.m);
    }
    this.bulbBody.count = bi;
    this.bulbGlow.count = bi;
    this.podBody.count = pi;
    this.podGlow.count = pi;
    for (const im of [this.xenBody, this.xenBase, this.oreBody, this.oreGlow, this.crateMesh, this.bulbBody, this.bulbGlow, this.podBody, this.podGlow]) im.instanceMatrix.needsUpdate = true;
  }

  /** Nearest ready O2 bulb (for hints / radar). */
  nearestBulb(x: number, z: number): Plant | null {
    let best: Plant | null = null;
    let bd = Infinity;
    for (const p of this.plants) {
      if (p.kind !== 'bulb' || !p.ready) continue;
      const d = dist(p.x, p.z, x, z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  get rawPlants(): readonly Plant[] {
    return this.plants;
  }
}

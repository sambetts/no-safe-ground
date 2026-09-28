import * as THREE from 'three';
import { STRUCTURE_STATS, STRUCTURES, StructureDef, StructureKind, WORLD } from '../config';
import { angleDamp, dist, heading, rand } from '../core/math';
import { audio } from '../audio/audio';
import { beaconGeo, lampGeo, teslaGeo, turretBaseGeo, turretHeadGeo, wallGeo } from '../render/models';
import { envMaterial, glowMaterial } from '../render/materials';
import { Decals, makeSplatTexture } from '../render/particles';
import type { Game } from '../game';
import type { Enemy } from './enemies';
import type { Obstacle } from '../world/worldgen';

export interface Structure {
  id: number;
  kind: StructureKind;
  x: number;
  z: number;
  y: number;
  rot: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  group: THREE.Group;
  head: THREE.Object3D | null;
  cd: number;
  target: Enemy | null;
  obstacle: Obstacle;
  decal: number;
  lastHit: number;
  flash: number;
}

const env = envMaterial();
const glow = glowMaterial(1.4, 2.6);

// structure geometry is identical for every instance, so it is built once per kind and shared
const geoCache = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key) as T;
}

function buildModel(kind: StructureKind): { group: THREE.Group; head: THREE.Object3D | null } {
  const group = new THREE.Group();
  let head: THREE.Object3D | null = null;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = group, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  switch (kind) {
    case 'turret': {
      add(cached('turretBase', turretBaseGeo), env);
      head = new THREE.Group();
      const hg = cached('turretHead', turretHeadGeo);
      add(hg.body, env, head);
      add(hg.glow, glow, head, false);
      group.add(head);
      break;
    }
    case 'wall':
      add(cached('wall', wallGeo), env);
      break;
    case 'lamp': {
      const g = cached('lamp', lampGeo);
      add(g.body, env);
      add(g.glow, glow, group, false);
      break;
    }
    case 'beacon': {
      const g = cached('beacon', beaconGeo);
      add(g.body, env);
      head = add(g.glow, glow, group, false);
      break;
    }
    case 'tesla': {
      const g = cached('tesla', teslaGeo);
      add(g.body, env);
      head = add(g.glow, glow, group, false);
      break;
    }
  }
  return { group, head };
}

export class StructureSystem {
  list: Structure[] = [];
  placing: StructureKind | null = null;
  private nextId = 1;
  private ghost: THREE.Group | null = null;
  private ghostRing: THREE.Mesh;
  private ghostMat = new THREE.MeshBasicMaterial({ color: 0x5aff8a, transparent: true, opacity: 0.45, depthWrite: false });
  private ringMat = new THREE.MeshBasicMaterial({ color: 0x5aff8a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  ghostValid = false;
  ghostReason = '';
  private grot = 0;
  private decals: Decals;
  private freeSlots: number[] = [];
  private flowDirty = false;
  private flowT = 0;

  constructor(private game: Game) {
    this.decals = new Decals(48, makeSplatTexture(5, true), true);
    game.renderer.scene.add(this.decals.mesh);
    for (let i = 47; i >= 0; i--) this.freeSlots.push(i);
    const rg = new THREE.RingGeometry(0.95, 1, 64);
    rg.rotateX(-Math.PI / 2);
    this.ghostRing = new THREE.Mesh(rg, this.ringMat);
    this.ghostRing.visible = false;
    this.ghostRing.renderOrder = 30;
    game.renderer.scene.add(this.ghostRing);
  }

  def(kind: StructureKind): StructureDef {
    return STRUCTURES.find((s) => s.kind === kind)!;
  }

  count(kind: StructureKind): number {
    let n = 0;
    for (const s of this.list) if (s.kind === kind && s.alive) n++;
    return n;
  }

  canAfford(kind: StructureKind): boolean {
    const d = this.def(kind);
    return this.game.inventory.scrap >= d.scrap && this.game.inventory.xenite >= d.xenite;
  }

  select(kind: StructureKind): void {
    const g = this.game;
    if (this.placing === kind) {
      this.cancel();
      return;
    }
    this.cancel();
    this.placing = kind;
    const { group } = buildModel(kind);
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.material = this.ghostMat;
        o.castShadow = false;
      }
    });
    this.ghost = group;
    g.renderer.scene.add(group);
    const range = kind === 'turret' ? STRUCTURE_STATS.turret.range : kind === 'lamp' ? STRUCTURE_STATS.lamp.radius : kind === 'beacon' ? STRUCTURE_STATS.beacon.radius : kind === 'tesla' ? STRUCTURE_STATS.tesla.range : 0;
    this.ghostRing.visible = range > 0;
    this.ghostRing.scale.set(range, 1, range);
    audio.play('uiOpen', { volume: 0.5 });
  }

  cancel(): void {
    if (this.ghost) this.game.renderer.scene.remove(this.ghost);
    this.ghost = null;
    this.placing = null;
    this.ghostRing.visible = false;
  }

  private validate(kind: StructureKind, x: number, z: number): string {
    const g = this.game;
    const d = this.def(kind);
    if (g.inventory.scrap < d.scrap) return `Need ${d.scrap} scrap`;
    if (g.inventory.xenite < d.xenite) return `Need ${d.xenite} xenite`;
    if (d.max && this.count(kind) >= d.max) return `Limit ${d.max}`;
    if (dist(x, z, g.player.x, g.player.z) > STRUCTURE_STATS.buildRange) return 'Too far';
    if (Math.hypot(x, z) > WORLD.radius - 3) return 'Out of bounds';
    let blocked = false;
    g.grid.query(x, z, d.radius + 0.4, (o) => {
      if (dist(x, z, o.x, o.z) < o.r + d.radius + 0.15) {
        blocked = true;
        return true;
      }
    });
    if (blocked) return 'Blocked';
    if (g.hazards.inPool(x, z)) return 'Unstable ground';
    if (g.player.alive && dist(x, z, g.player.x, g.player.z) < d.radius + 0.6) return 'Too close';
    return '';
  }

  update(dt: number): void {
    const g = this.game;
    const p = g.player;
    // placement ghost
    if (this.placing && this.ghost) {
      const kind = this.placing;
      let x = p.aimX;
      let z = p.aimZ;
      const d = dist(p.x, p.z, x, z);
      if (d > STRUCTURE_STATS.buildRange) {
        x = p.x + ((x - p.x) / d) * STRUCTURE_STATS.buildRange;
        z = p.z + ((z - p.z) / d) * STRUCTURE_STATS.buildRange;
      }
      this.grot = kind === 'wall' ? heading(x - p.x, z - p.z) + Math.PI / 2 : heading(x - p.x, z - p.z);
      const y = g.terrain.heightAt(x, z);
      this.ghost.position.set(x, y, z);
      this.ghost.rotation.y = this.grot;
      this.ghostRing.position.set(x, y + 0.2, z);
      this.ghostReason = this.validate(kind, x, z);
      this.ghostValid = this.ghostReason === '';
      const col = this.ghostValid ? 0x5aff8a : 0xff4a4a;
      this.ghostMat.color.setHex(col);
      this.ringMat.color.setHex(col);
      if (g.input.mousePressed && (!g.hud.pointerOverUi || g.input.usingGamepad)) {
        if (this.ghostValid) this.place(kind, x, z, this.grot);
        else {
          audio.play('uiError', { volume: 0.6 });
          g.messages.toast(this.ghostReason, 'bad');
        }
      }
      if (g.input.rightPressed || g.input.pressed('cancel')) this.cancel();
    }

    const night = g.cycle.darkness;
    for (const s of this.list) {
      if (!s.alive) continue;
      s.flash = Math.max(0, s.flash - dt * 5);
      // daytime self-repair
      if (night < 0.3 && g.time - s.lastHit > 5 && s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.03 * dt);
      switch (s.kind) {
        case 'turret':
          this.turret(s, dt);
          break;
        case 'tesla':
          this.tesla(s, dt);
          break;
        case 'lamp': {
          const on = night > 0.05;
          if (on) g.renderer.lights.request(s.x, s.y + 3.2, s.z, 0xffe6b0, 26 * night, 17, 4);
          this.decals.setAlpha(s.decal, 0.5 * night);
          break;
        }
        case 'beacon': {
          if (s.head) s.head.rotation.y += dt * 1.5;
          this.decals.setAlpha(s.decal, 0.16 + 0.06 * Math.sin(g.time * 2 + s.id));
          if (Math.random() < 0.25) {
            const a = rand(0, Math.PI * 2);
            const r = rand(0, STRUCTURE_STATS.beacon.radius);
            g.fx.glow.spawn({ x: s.x + Math.cos(a) * r, y: s.y + 0.2, z: s.z + Math.sin(a) * r, vy: rand(0.4, 1.2), life: 1.4, size: 0.2, sizeEnd: 0, color: 0x46c8ff, alpha: 0.7 });
          }
          if (night > 0.05) g.renderer.lights.request(s.x, s.y + 3, s.z, 0x46c8ff, 8 * night, 9, 2);
          break;
        }
      }
    }
    if (this.flowDirty) {
      this.flowT -= dt;
      if (this.flowT <= 0) {
        this.flowDirty = false;
        g.recomputeShipFlow();
      }
    }
  }

  private turret(s: Structure, dt: number): void {
    const g = this.game;
    const st = STRUCTURE_STATS.turret;
    s.cd -= dt;
    if (!s.target || !s.target.alive || dist(s.x, s.z, s.target.x, s.target.z) > st.range + 1 || (g.frame + s.id) % 20 === 0) {
      s.target = g.enemies.nearest(s.x, s.z, st.range, true);
    }
    if (s.head) {
      const want = s.target ? heading(s.target.x - s.x, s.target.z - s.z) : s.head.rotation.y + dt * 0.4;
      s.head.rotation.y = angleDamp(s.head.rotation.y, want, 10, dt);
      if (s.target && s.cd <= 0) {
        s.cd = 1 / st.rate;
        const a = s.head.rotation.y + rand(-0.03, 0.03);
        const side = (g.frame % 2 ? 1 : -1) * 0.14;
        const mx = s.x + Math.sin(a) * 0.9 + Math.cos(a) * side;
        const mz = s.z + Math.cos(a) * 0.9 - Math.sin(a) * side;
        g.projectiles.bolt(mx, mz, Math.sin(a), Math.cos(a), st.damage, 0, 'turret', 40, st.range + 3);
        audio.play('turretShoot', { x: s.x, z: s.z, volume: 0.4 });
        g.fx.flash(mx, s.y + 1.4, mz, 0xffd04a, 3, 5, 0.05);
      }
    }
  }

  private tesla(s: Structure, dt: number): void {
    const g = this.game;
    const st = STRUCTURE_STATS.tesla;
    s.cd -= dt;
    if (s.cd > 0) return;
    const first = g.enemies.nearest(s.x, s.z, st.range);
    if (!first) {
      s.cd = 0.2;
      return;
    }
    s.cd = 1 / st.rate;
    const hit: Enemy[] = [first];
    let cur = first;
    for (let i = 1; i < st.chains; i++) {
      let best: Enemy | null = null;
      let bd = 5.5;
      g.enemies.forEachInRadius(cur.x, cur.z, 5.5, (e, d) => {
        if (hit.includes(e)) return;
        if (d < bd) {
          bd = d;
          best = e;
        }
      });
      if (!best) break;
      hit.push(best);
      cur = best;
    }
    let px = s.x;
    let py = s.y + 2.8;
    let pz = s.z;
    let dmg = st.damage;
    for (const e of hit) {
      const ey = e.y + 0.8 * e.scale;
      g.fx.arc(px, py, pz, e.x, ey, e.z, 0x9fdcff, 0.14, 0.18, 0.6);
      g.fx.arc(px, py, pz, e.x, ey, e.z, 0xffffff, 0.05, 0.12, 0.4);
      g.enemies.damage(e, dmg, px, pz, 'tesla');
      e.stun = Math.max(e.stun, 0.25);
      g.fx.sparks(e.x, ey, e.z, 0x9fdcff, 6, 5, 0.3, 0.14);
      px = e.x;
      py = ey;
      pz = e.z;
      dmg *= 0.85;
    }
    g.fx.flash(s.x, s.y + 3, s.z, 0x9fdcff, 20, 12, 0.15);
    audio.play('teslaZap', { x: s.x, z: s.z, volume: 0.7 });
  }

  place(kind: StructureKind, x: number, z: number, rot: number, free = false): Structure {
    const g = this.game;
    const d = this.def(kind);
    if (!free) {
      g.inventory.scrap -= d.scrap;
      g.inventory.xenite -= d.xenite;
      g.record.built++;
    }
    const { group, head } = buildModel(kind);
    const y = g.terrain.heightAt(x, z);
    group.position.set(x, y, z);
    group.rotation.y = rot;
    g.renderer.scene.add(group);
    const id = this.nextId++;
    const obstacle: Obstacle = { id: 900000 + id, x, z, r: d.radius, kind: 'structure', biome: 0, alive: true, ref: id };
    g.grid.add(obstacle);
    let decal = -1;
    if ((kind === 'lamp' || kind === 'beacon') && this.freeSlots.length) {
      decal = this.freeSlots.pop()!;
      const r = kind === 'lamp' ? STRUCTURE_STATS.lamp.radius : STRUCTURE_STATS.beacon.radius;
      this.decals.set(decal, x, y + 0.08, z, r * 2.2, kind === 'lamp' ? 0xffd9a0 : 0x46c8ff, 0);
    }
    const s: Structure = { id, kind, x, z, y, rot, hp: d.hp, maxHp: d.hp, alive: true, group, head, cd: 0, target: null, obstacle, decal, lastHit: -99, flash: 0 };
    this.list.push(s);
    g.flowShip.setCostCircle(x, z, d.radius, kind === 'wall' ? 14 : 8);
    this.flowDirty = true;
    this.flowT = 0.25;
    if (!free) {
      audio.play('build', { x, z });
      g.fx.dust(x, z, 10, 0x9a8a7a, 1, 1);
      g.fx.ring(x, z, 0.3, 2.2, 0xffd04a, 0.4);
      g.hints.done('build');
      const keepPlacing = kind === 'wall' && this.canAfford('wall');
      if (!keepPlacing) this.cancel();
    }
    return s;
  }

  damage(id: number, amount: number, fx: number, fz: number): void {
    const s = this.list.find((q) => q.id === id);
    if (!s || !s.alive) return;
    const g = this.game;
    s.hp -= amount;
    s.lastHit = g.time;
    s.flash = 1;
    if (Math.random() < 0.4) g.fx.sparks(s.x, s.y + 1, s.z, 0xffc070, 4, 4, 0.3, 0.12);
    if (Math.random() < 0.3) audio.play('hitArmor', { x: s.x, z: s.z, volume: 0.35 });
    if (s.hp <= 0) this.destroy(s);
  }

  damageRadius(x: number, z: number, r: number, amount: number): void {
    for (const s of this.list) if (s.alive && dist(s.x, s.z, x, z) < r + 0.8) this.damage(s.id, amount, x, z);
  }

  private destroy(s: Structure): void {
    const g = this.game;
    s.alive = false;
    s.obstacle.alive = false;
    g.grid.remove(s.obstacle);
    g.renderer.scene.remove(s.group);
    if (s.decal >= 0) {
      this.decals.setAlpha(s.decal, 0);
      this.freeSlots.push(s.decal);
    }
    g.flowShip.setCostCircle(s.x, s.z, s.obstacle.r, 0);
    this.flowDirty = true;
    this.flowT = 0.25;
    g.fx.explosion(s.x, s.z, 2.2, 0xffa040);
    audio.play('explosion', { x: s.x, z: s.z, volume: 0.6 });
    g.messages.toast(`${this.def(s.kind).name} destroyed`, 'bad');
    this.list = this.list.filter((q) => q.alive);
  }

  /** 0 = dark, 1 = in lamp light. */
  lightAt(x: number, z: number): number {
    const r = STRUCTURE_STATS.lamp.radius;
    for (const s of this.list) if (s.kind === 'lamp' && s.alive && (s.x - x) ** 2 + (s.z - z) ** 2 < r * r) return 1;
    return 0;
  }

  inBeaconField(x: number, z: number): boolean {
    const r = STRUCTURE_STATS.beacon.radius;
    for (const s of this.list) if (s.kind === 'beacon' && s.alive && (s.x - x) ** 2 + (s.z - z) ** 2 < r * r) return true;
    return false;
  }

  clear(): void {
    this.cancel();
    const g = this.game;
    for (const s of this.list) {
      g.renderer.scene.remove(s.group);
      if (s.alive) {
        s.alive = false;
        s.obstacle.alive = false;
        g.grid.remove(s.obstacle);
        g.flowShip.setCostCircle(s.x, s.z, s.obstacle.r, 0);
      }
      if (s.decal >= 0) {
        this.decals.setAlpha(s.decal, 0);
        this.freeSlots.push(s.decal);
      }
    }
    this.list = [];
    this.flowDirty = false;
  }
}

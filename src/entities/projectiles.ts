import * as THREE from 'three';
import { BLASTER, GRENADE } from '../config';
import { clamp, dist, rand, segDist } from '../core/math';
import { audio } from '../audio/audio';
import { boltGeo, globGeo } from '../render/models';
import type { Game } from '../game';
import type { Enemy } from './enemies';
import type { Obstacle } from '../world/worldgen';

type Owner = 'player' | 'turret' | 'ship';

interface Bolt {
  x: number;
  z: number;
  y: number;
  dx: number;
  dz: number;
  speed: number;
  life: number;
  dmg: number;
  pierce: number;
  owner: Owner;
  hits: number[];
  alive: boolean;
}

interface Lob {
  sx: number;
  sy: number;
  sz: number;
  tx: number;
  tz: number;
  x: number;
  y: number;
  z: number;
  t: number;
  dur: number;
  arc: number;
  dmg: number;
  radius: number;
  kind: 'acid' | 'boss' | 'grenade';
  alive: boolean;
}

interface Seeker {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  target: Enemy | null;
  life: number;
  dmg: number;
  delay: number;
  alive: boolean;
}

const OWNER_COL: Record<Owner, THREE.Color> = {
  player: new THREE.Color(0x7fe8ff).multiplyScalar(3.2),
  turret: new THREE.Color(0xffd04a).multiplyScalar(3.2),
  ship: new THREE.Color(0xff9a3a).multiplyScalar(3.2),
};

const cand: Enemy[] = [];
const hitOut = { o: null as Obstacle | null };

export class ProjectileSystem {
  private bolts: Bolt[] = [];
  private lobs: Lob[] = [];
  private seekers: Seeker[] = [];
  private boltMesh: THREE.InstancedMesh;
  private lobMesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(private game: Game) {
    const bm = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.boltMesh = new THREE.InstancedMesh(boltGeo(), bm, 600);
    this.boltMesh.frustumCulled = false;
    this.boltMesh.count = 0;
    this.boltMesh.setColorAt(0, this.c.setRGB(1, 1, 1));
    this.boltMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lobMesh = new THREE.InstancedMesh(globGeo(), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 200);
    this.lobMesh.frustumCulled = false;
    this.lobMesh.count = 0;
    this.lobMesh.setColorAt(0, this.c.setRGB(1, 1, 1));
    this.lobMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    game.renderer.scene.add(this.boltMesh, this.lobMesh);
  }

  clear(): void {
    this.bolts.length = 0;
    this.lobs.length = 0;
    this.seekers.length = 0;
  }

  bolt(x: number, z: number, dx: number, dz: number, dmg: number, pierce: number, owner: Owner, speed = BLASTER.speed, range = BLASTER.range): void {
    if (this.bolts.length > 580) return;
    const y = this.game.terrain.heightAt(x, z) + 1.24;
    this.bolts.push({ x, z, y, dx, dz, speed, life: range / speed, dmg, pierce, owner, hits: [], alive: true });
  }

  glob(sx: number, sy: number, sz: number, tx: number, tz: number, dmg: number, kind: 'acid' | 'boss'): void {
    const d = dist(sx, sz, tx, tz);
    const dur = clamp(0.55 + d * 0.035, 0.6, 1.2);
    this.lobs.push({ sx, sy, sz, tx, tz, x: sx, y: sy, z: sz, t: 0, dur, arc: 2 + d * 0.18, dmg, radius: kind === 'boss' ? 2.1 : 1.7, kind, alive: true });
    const g = this.game;
    g.fx.lightDecals.add(tx, g.terrain.heightAt(tx, tz) + 0.06, tz, kind === 'boss' ? 4.4 : 3.6, kind === 'boss' ? 0xff3a5a : 0x8dff3a, 0.55, dur);
  }

  grenade(sx: number, sy: number, sz: number, tx: number, tz: number, dmg: number, radius: number): void {
    this.lobs.push({ sx, sy, sz, tx, tz, x: sx, y: sy, z: sz, t: 0, dur: GRENADE.flight, arc: 3.5, dmg, radius, kind: 'grenade', alive: true });
  }

  seeker(x: number, y: number, z: number, dx: number, dz: number, dmg: number, delay: number): void {
    this.seekers.push({ x, y, z, vx: dx * 12, vz: dz * 12, target: null, life: 3.2, dmg, delay, alive: true });
  }

  update(dt: number): void {
    const g = this.game;
    const grid = g.grid;
    const enemies = g.enemies;
    // --- bolts ---------------------------------------------------------------------------------------
    for (const b of this.bolts) {
      if (!b.alive) continue;
      const px = b.x;
      const pz = b.z;
      const step = b.speed * dt;
      let nx = px + b.dx * step;
      let nz = pz + b.dz * step;
      b.life -= dt;
      // obstacles
      const t = grid.sweep(px, pz, nx, nz, 0.08, hitOut);
      let blocked = false;
      if (t >= 0 && hitOut.o && hitOut.o.kind !== 'structure' && !(b.owner === 'ship' && hitOut.o.kind === 'ship')) {
        nx = px + (nx - px) * t;
        nz = pz + (nz - pz) * t;
        blocked = true;
      }
      // creatures
      enemies.hash.query((px + nx) / 2, (pz + nz) / 2, step / 2 + 4, cand);
      let best: Enemy | null = null;
      let bestT = 2;
      for (const e of cand) {
        if (!e.alive || e.state === 5 || e.spawnT > 0.35 || b.hits.includes(e.id)) continue;
        const r = e.r + (e.kind === 'floater' ? 0.35 : 0.12);
        if (segDist(e.x, e.z, px, pz, nx, nz) < r) {
          const tt = ((e.x - px) * b.dx + (e.z - pz) * b.dz) / Math.max(step, 0.001);
          if (tt < bestT) {
            bestT = tt;
            best = e;
          }
        }
      }
      if (best) {
        b.hits.push(best.id);
        if (b.owner === 'player') g.record.hits++;
        const hx = best.x - b.dx * best.r;
        const hz = best.z - b.dz * best.r;
        enemies.damage(best, b.dmg, px, pz, b.owner);
        enemies.knock(best, px, pz, b.owner === 'player' ? 2.2 : 1.2);
        g.fx.spray(hx, b.y, hz, -b.dx, -b.dz, b.owner === 'player' ? 0x9ff4ff : 0xffe07a, 5, 7);
        if (b.pierce > 0) {
          b.pierce--;
        } else {
          b.alive = false;
          continue;
        }
      }
      if (blocked && hitOut.o) {
        b.alive = false;
        g.fx.spray(nx, b.y, nz, -b.dx, -b.dz, 0xffd9a0, 5, 6);
        if (hitOut.o.kind === 'node' || hitOut.o.kind === 'crate') g.resources.hitNode(hitOut.o.ref, b.dmg, nx, nz);
        else if (b.owner === 'player' && Math.random() < 0.35) audio.play('hitArmor', { x: nx, z: nz, volume: 0.25, pitch: 1.4 });
        continue;
      }
      b.x = nx;
      b.z = nz;
      b.y = g.terrain.heightAt(nx, nz) + 1.24;
      if (b.life <= 0) {
        b.alive = false;
        g.fx.glow.spawn({ x: nx, y: b.y, z: nz, life: 0.12, size: 0.35, sizeEnd: 0, color: 0x7fe8ff });
      }
    }
    this.bolts = this.bolts.filter((b) => b.alive);

    // --- lobbed projectiles ------------------------------------------------------------------------------
    for (const l of this.lobs) {
      if (!l.alive) continue;
      l.t += dt;
      const k = Math.min(1, l.t / l.dur);
      const ty = g.terrain.heightAt(l.tx, l.tz) + 0.2;
      l.x = l.sx + (l.tx - l.sx) * k;
      l.z = l.sz + (l.tz - l.sz) * k;
      l.y = l.sy + (ty - l.sy) * k + 4 * l.arc * k * (1 - k);
      if (l.kind !== 'grenade' && Math.random() < 0.7) g.fx.glow.spawn({ x: l.x, y: l.y, z: l.z, life: 0.3, size: 0.35, sizeEnd: 0.05, color: l.kind === 'boss' ? 0xff3a5a : 0x9dff3a });
      if (l.kind === 'grenade') g.fx.glow.spawn({ x: l.x, y: l.y, z: l.z, life: 0.25, size: 0.3, sizeEnd: 0.02, color: 0x7fe8ff });
      if (k >= 1) {
        l.alive = false;
        this.land(l);
      }
    }
    this.lobs = this.lobs.filter((l) => l.alive);

    // --- seekers -----------------------------------------------------------------------------------------
    for (const s of this.seekers) {
      if (!s.alive) continue;
      s.life -= dt;
      s.delay -= dt;
      if (s.delay <= 0) {
        if (!s.target || !s.target.alive) s.target = enemies.nearest(s.x, s.z, 22);
        if (s.target) {
          const dx = s.target.x - s.x;
          const dz = s.target.z - s.z;
          const d = Math.hypot(dx, dz) || 1;
          const sp = 24;
          s.vx += ((dx / d) * sp - s.vx) * Math.min(1, dt * 6);
          s.vz += ((dz / d) * sp - s.vz) * Math.min(1, dt * 6);
          if (d < s.target.r + 0.5) {
            s.alive = false;
            this.blast(s.x, s.z, 2.2, s.dmg, 0xffa040, false);
            continue;
          }
        }
      }
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      s.y = g.terrain.heightAt(s.x, s.z) + 1.6;
      g.fx.glow.spawn({ x: s.x, y: s.y, z: s.z, life: 0.25, size: 0.35, sizeEnd: 0.02, color: 0xffa040 });
      if (Math.random() < 0.4) g.fx.smokePuff(s.x, s.y, s.z, 0x606060, 0.4, 0.5, 0.3, 0.3);
      if (s.life <= 0 || g.grid.sweep(s.x - s.vx * dt, s.z - s.vz * dt, s.x, s.z, 0.1, hitOut) >= 0) {
        s.alive = false;
        this.blast(s.x, s.z, 2.0, s.dmg * 0.8, 0xffa040, false);
      }
    }
    this.seekers = this.seekers.filter((s) => s.alive);
    this.render();
  }

  private land(l: Lob): void {
    const g = this.game;
    const p = g.player;
    if (l.kind === 'grenade') {
      this.blast(l.tx, l.tz, l.radius, l.dmg, 0x7fe8ff, true);
      return;
    }
    const col = l.kind === 'boss' ? 0xff3a5a : 0x8dff3a;
    g.fx.ichor(l.tx, g.terrain.heightAt(l.tx, l.tz) + 0.3, l.tz, l.kind === 'boss' ? 0x5a1020 : 0x2f5a12, col, 10, 0);
    audio.play('acidSplash', { x: l.tx, z: l.tz, volume: 0.6 });
    if (p.alive && dist(p.x, p.z, l.tx, l.tz) < l.radius + 0.4) p.hurt(l.dmg / g.difficulty.enemyDmg, l.tx, l.tz, 4, 'acid');
    g.hazards.acidPuddle(l.tx, l.tz, l.radius * 0.85, l.kind === 'boss' ? 4 : 3.2, col);
    // spit hurts structures and the ship too
    g.structures.damageRadius(l.tx, l.tz, l.radius, l.dmg * 0.8);
    if (dist(l.tx, l.tz, g.ship.x, g.ship.z) < 6) g.ship.damage(l.dmg * 0.8, l.tx, l.tz);
  }

  /** Area damage to creatures (player ordnance). */
  blast(x: number, z: number, radius: number, dmg: number, color: number, big: boolean): void {
    const g = this.game;
    g.fx.explosion(x, z, radius, color, big);
    audio.play('explosion', { x, z, volume: big ? 0.9 : 0.55, pitch: big ? 1 : 1.3 });
    g.enemies.forEachInRadius(x, z, radius, (e, d) => {
      const k = 1 - Math.min(1, d / (radius + e.r));
      g.enemies.damage(e, dmg * (0.45 + 0.55 * k), x, z, 'blast');
      g.enemies.knock(e, x, z, 10 * k + 3);
    });
    g.resources.blast(x, z, radius, dmg);
  }

  private render(): void {
    let i = 0;
    for (const b of this.bolts) {
      if (i >= 600) break;
      this.e.set(0, Math.atan2(b.dx, b.dz), 0);
      this.q.setFromEuler(this.e);
      this.v.set(b.x, b.y, b.z);
      const len = b.owner === 'player' ? 1.25 : 1;
      this.s.set(1.3, 1.3, len);
      this.m.compose(this.v, this.q, this.s);
      this.boltMesh.setMatrixAt(i, this.m);
      this.boltMesh.setColorAt(i, OWNER_COL[b.owner]);
      i++;
    }
    for (const s of this.seekers) {
      if (i >= 600) break;
      this.e.set(0, Math.atan2(s.vx, s.vz), 0);
      this.q.setFromEuler(this.e);
      this.v.set(s.x, s.y, s.z);
      this.s.set(1.6, 1.6, 0.6);
      this.m.compose(this.v, this.q, this.s);
      this.boltMesh.setMatrixAt(i, this.m);
      this.boltMesh.setColorAt(i, this.c.setRGB(3, 1.4, 0.4));
      i++;
    }
    this.boltMesh.count = i;
    this.boltMesh.instanceMatrix.needsUpdate = true;
    if (this.boltMesh.instanceColor) this.boltMesh.instanceColor.needsUpdate = true;
    let j = 0;
    for (const l of this.lobs) {
      if (j >= 200) break;
      this.q.identity();
      this.v.set(l.x, l.y, l.z);
      const sc = l.kind === 'boss' ? 1.8 : l.kind === 'grenade' ? 0.9 : 1.2;
      const wob = 1 + Math.sin(l.t * 30) * 0.12;
      this.s.set(sc * wob, sc / wob, sc * wob);
      this.m.compose(this.v, this.q, this.s);
      this.lobMesh.setMatrixAt(j, this.m);
      if (l.kind === 'grenade') this.c.setRGB(1.2, 3, 3.6);
      else if (l.kind === 'boss') this.c.setRGB(3.4, 0.6, 1);
      else this.c.setRGB(1.6, 3.4, 0.6);
      this.lobMesh.setColorAt(j, this.c);
      j++;
    }
    this.lobMesh.count = j;
    this.lobMesh.instanceMatrix.needsUpdate = true;
    if (this.lobMesh.instanceColor) this.lobMesh.instanceColor.needsUpdate = true;
  }
}

export const randomSpread = () => rand(-BLASTER.spread, BLASTER.spread);

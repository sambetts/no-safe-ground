import * as THREE from 'three';
import { ENEMY, EnemyKind } from '../config';
import { angleDamp, clamp, damp, dist, heading, rand, randSign, TAU } from '../core/math';
import { audio } from '../audio/audio';
import { SpatialHash } from '../world/collision';
import { creatureGlowMaterial, creatureMaterial } from '../render/materials';
import {
  bruteModel,
  burrowerModel,
  CreatureModel,
  floaterModel,
  matriarchModel,
  nestModel,
  skitterModel,
  spitterModel,
} from '../render/models';
import type { Game } from '../game';
import type { Obstacle } from '../world/worldgen';

export const S_MOVE = 0;
export const S_WINDUP = 1;
export const S_ATTACK = 2;
export const S_RECOVER = 3;
export const S_STUN = 4;
export const S_BURROWED = 5;
export const S_EMERGE = 6;
export const S_IDLE = 7;
export const S_FLEE = 8;
export const S_INTRO = 9;

export type EnemyMode = 'hunt' | 'siege' | 'guard' | 'wander';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  r: number;
  hp: number;
  maxHp: number;
  speed: number;
  dmg: number;
  state: number;
  t: number;
  cd: number;
  facing: number;
  gait: number;
  flash: number;
  pulse: number;
  alive: boolean;
  mode: EnemyMode;
  aggro: boolean;
  homeX: number;
  homeZ: number;
  stun: number;
  slow: number;
  spawnT: number;
  dirX: number;
  dirZ: number;
  scale: number;
  elite: boolean;
  hitDone: boolean;
  burn: number;
  strafe: number;
  children: number;
  parent: Enemy | null;
  night: boolean;
  lastDamage: number;
  sink: number;
  phase: number; // boss phase / misc
  attackIdx: number;
  phase2Count: number;
  losFrame: number;
  /** boss only: player fled the arena, she is returning home and regrowing */
  leashed: boolean;
}

const GLOW_COL: Record<EnemyKind, number> = {
  skitter: 0xff2d6a,
  spitter: 0x8dff3a,
  brute: 0xffa21a,
  burrower: 0xff6a2a,
  floater: 0xd66bff,
  nest: 0xff3355,
  matriarch: 0xff2d55,
};
const ICHOR: Record<EnemyKind, number> = {
  skitter: 0x2a0f22,
  spitter: 0x2f4a12,
  brute: 0x3a1a10,
  burrower: 0x3a2412,
  floater: 0x3a1a4a,
  nest: 0x4a0f1a,
  matriarch: 0x4a0f1a,
};

class CreatureRenderer {
  readonly body: THREE.InstancedMesh;
  readonly glow: THREE.InstancedMesh;
  private anim: THREE.InstancedBufferAttribute;
  private count = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  readonly capacity: number;

  constructor(model: CreatureModel, capacity: number, scene: THREE.Scene, shadow = true) {
    this.capacity = capacity;
    this.anim = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.anim.setUsage(THREE.DynamicDrawUsage);
    model.body.setAttribute('iAnim', this.anim);
    model.glow.setAttribute('iAnim', this.anim);
    this.body = new THREE.InstancedMesh(model.body, creatureMaterial(), capacity);
    this.glow = new THREE.InstancedMesh(model.glow, creatureGlowMaterial(), capacity);
    for (const im of [this.body, this.glow]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      im.setColorAt(0, new THREE.Color(1, 1, 1));
      im.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      scene.add(im);
    }
    this.body.castShadow = shadow;
    this.body.receiveShadow = true;
  }

  begin(): void {
    this.count = 0;
  }

  push(x: number, y: number, z: number, rotY: number, scale: number, gait: number, flash: number, pulse: number, tint: number, tiltX = 0, tiltZ = 0, sy = 1): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.e.set(tiltX, rotY, tiltZ, 'YXZ');
    this.q.setFromEuler(this.e);
    this.v.set(x, y, z);
    this.s.set(scale, scale * sy, scale);
    this.m.compose(this.v, this.q, this.s);
    this.body.setMatrixAt(i, this.m);
    this.glow.setMatrixAt(i, this.m);
    this.anim.setXYZW(i, gait, flash, pulse, 0);
    this.c.setHex(tint);
    this.body.setColorAt(i, this.c);
    this.glow.setColorAt(i, this.c.setScalar(1));
  }

  end(): void {
    this.body.count = this.count;
    this.glow.count = this.count;
    this.body.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
    this.body.instanceColor!.needsUpdate = true;
    this.glow.instanceColor!.needsUpdate = true;
    this.anim.needsUpdate = true;
  }
}

const tmpDir = { x: 0, z: 0 };
const neighbors: Enemy[] = [];

export class EnemySystem {
  list: Enemy[] = [];
  readonly hash = new SpatialHash<Enemy>();
  private renderers: Record<EnemyKind, CreatureRenderer>;
  private nextId = 1;
  boss: Enemy | null = null;
  private roarT = 0;

  constructor(private game: Game) {
    const sc = game.renderer.scene;
    this.renderers = {
      skitter: new CreatureRenderer(skitterModel(), 320, sc),
      spitter: new CreatureRenderer(spitterModel(), 90, sc),
      brute: new CreatureRenderer(bruteModel(), 40, sc),
      burrower: new CreatureRenderer(burrowerModel(), 40, sc),
      floater: new CreatureRenderer(floaterModel(), 70, sc),
      nest: new CreatureRenderer(nestModel(), 24, sc),
      matriarch: new CreatureRenderer(matriarchModel(), 1, sc),
    };
  }

  get count(): number {
    return this.list.length;
  }

  countKind(kind: EnemyKind): number {
    let n = 0;
    for (const e of this.list) if (e.kind === kind) n++;
    return n;
  }

  spawn(kind: EnemyKind, x: number, z: number, mode: EnemyMode, opts: { elite?: boolean; emerge?: boolean; parent?: Enemy | null; night?: boolean; aggro?: boolean } = {}): Enemy {
    const g = this.game;
    const st = ENEMY[kind];
    const elite = !!opts.elite;
    const hpMult = g.difficulty.enemyHp * (1 + 0.07 * Math.max(0, g.director.threat - 1)) * (elite ? 2.4 : 1);
    const e: Enemy = {
      id: this.nextId++,
      kind,
      x,
      z,
      y: g.terrain.heightAt(x, z),
      vx: 0,
      vz: 0,
      r: st.radius * (elite ? 1.2 : 1),
      hp: st.hp * hpMult,
      maxHp: st.hp * hpMult,
      speed: st.speed * rand(0.92, 1.08) * (elite ? 1.08 : 1),
      dmg: st.damage * (elite ? 1.4 : 1),
      state: kind === 'burrower' ? S_BURROWED : mode === 'guard' ? S_IDLE : S_MOVE,
      t: 0,
      cd: rand(0.5, 2),
      facing: rand(0, TAU),
      gait: rand(0, TAU),
      flash: 0,
      pulse: 0,
      alive: true,
      mode,
      aggro: !!opts.aggro,
      homeX: x,
      homeZ: z,
      stun: 0,
      slow: 1,
      spawnT: opts.emerge ? 0.7 : 0,
      dirX: 0,
      dirZ: 0,
      scale: elite ? 1.25 : 1,
      elite,
      hitDone: false,
      burn: 0,
      strafe: randSign(),
      children: 0,
      parent: opts.parent ?? null,
      night: !!opts.night,
      lastDamage: -99,
      sink: 0,
      phase: 0,
      attackIdx: 0,
      phase2Count: 0,
      losFrame: -99,
      leashed: false,
    };
    if (kind === 'matriarch') {
      e.state = S_INTRO;
      e.t = 0;
      e.spawnT = 0;
      this.boss = e;
    }
    if (opts.emerge) {
      g.fx.dust(x, z, 6, 0x6a5a4a, 0.8 * e.scale, 1.2);
    }
    this.list.push(e);
    return e;
  }

  forEachInRadius(x: number, z: number, r: number, fn: (e: Enemy, d: number) => void): void {
    this.hash.query(x, z, r + 4, neighbors);
    const copy = neighbors.slice();
    for (const e of copy) {
      if (!e.alive || e.state === S_BURROWED) continue;
      const d = dist(x, z, e.x, e.z);
      if (d < r + e.r) fn(e, d);
    }
  }

  /** Nearest targetable enemy within range (optionally requiring line of sight). */
  nearest(x: number, z: number, range: number, los = false): Enemy | null {
    let best: Enemy | null = null;
    let bd = range;
    this.hash.query(x, z, range, neighbors);
    for (const e of neighbors) {
      if (!e.alive || e.state === S_BURROWED || e.spawnT > 0.3) continue;
      const d = dist(x, z, e.x, e.z) - e.r;
      if (d < bd) {
        if (los && !this.game.grid.lineOfSight(x, z, e.x, e.z, 0.9)) continue;
        bd = d;
        best = e;
      }
    }
    return best;
  }

  knock(e: Enemy, fromX: number, fromZ: number, force: number): void {
    const dx = e.x - fromX;
    const dz = e.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    const m = ENEMY[e.kind].mass * (e.elite ? 1.5 : 1);
    e.vx += (dx / l) * force / Math.sqrt(m);
    e.vz += (dz / l) * force / Math.sqrt(m);
  }

  damage(e: Enemy, amount: number, fromX: number, fromZ: number, source: string, crit = false): void {
    if (!e.alive || e.state === S_BURROWED || (e.kind === 'matriarch' && (e.state === S_INTRO || e.sink > 0.7))) return;
    const g = this.game;
    let dmg = amount;
    if (e.state === S_STUN && (e.kind === 'brute' || e.kind === 'matriarch')) {
      dmg *= 1.6;
      crit = true;
    }
    e.hp -= dmg;
    e.flash = 1;
    e.lastDamage = g.time;
    if (!e.aggro && g.player.alive) e.aggro = true;
    g.hud.damageNumber(e.x, e.y + 1.6 * e.scale + (e.kind === 'matriarch' ? 4 : e.kind === 'brute' ? 1.4 : 0), e.z, dmg, crit);
    if (e.hp <= 0) {
      this.kill(e, source);
      return;
    }
    if (e.kind !== 'nest') audio.play(e.kind === 'brute' || e.kind === 'matriarch' ? 'hitArmor' : 'hit', { x: e.x, z: e.z, volume: 0.5 });
    else audio.play('hit', { x: e.x, z: e.z, volume: 0.4, pitch: 0.6 });
  }

  kill(e: Enemy, source = ''): void {
    if (!e.alive) return;
    const g = this.game;
    e.alive = false;
    const big = e.kind === 'brute' || e.kind === 'nest' || e.kind === 'matriarch';
    const y = e.y + (e.kind === 'floater' ? 2.3 : 0.6) * e.scale;
    g.fx.ichor(e.x, y, e.z, ICHOR[e.kind], GLOW_COL[e.kind], big ? 40 : 14, big ? 3.5 : 1.4 * e.scale);
    g.fx.sparks(e.x, y, e.z, GLOW_COL[e.kind], big ? 20 : 8, 7, 0.4);
    g.record.kills++;
    if (source !== 'dawn') {
      const shards = Math.round(ENEMY[e.kind].xenite * (e.elite ? 3 : 1) * g.difficulty.resourceMult);
      g.pickups.burst('xenite', e.x, e.z, shards, y);
      if (e.kind === 'brute' || e.elite) {
        if (Math.random() < 0.5) g.pickups.burst('health', e.x, e.z, 1, y);
      } else if (Math.random() < 0.025) g.pickups.burst('health', e.x, e.z, 1, y);
      if (e.kind === 'nest') g.pickups.burst('scrap', e.x, e.z, 6, y);
    }
    if (e.kind === 'floater') g.hazards.sporeCloud(e.x, e.z, 3.4, 5);
    if (e.kind === 'nest') {
      g.fx.explosion(e.x, e.z, 4, 0xff3355, true);
      audio.play('bigDie', { x: e.x, z: e.z });
      g.fx.freeze(0.08);
      g.messages.toast('Nest destroyed', 'good');
    } else if (e.kind === 'matriarch') {
      g.onBossKilled(e);
    } else if (big) {
      audio.play('bigDie', { x: e.x, z: e.z });
      g.fx.shake(0.3);
      g.fx.freeze(0.05);
      g.fx.flash(e.x, y + 1, e.z, GLOW_COL[e.kind], 20, 10, 0.25);
    } else {
      audio.play('enemyDie', { x: e.x, z: e.z, volume: 0.6 });
    }
    if (e.parent) e.parent.children = Math.max(0, e.parent.children - 1);
  }

  clear(): void {
    this.list.length = 0;
    this.boss = null;
  }

  /** Dawn: night creatures burrow away. */
  retreat(): void {
    for (const e of this.list) {
      if (!e.alive || e.kind === 'nest' || e.kind === 'matriarch') continue;
      if (e.night || e.mode === 'siege') {
        e.state = S_FLEE;
        e.t = rand(0, 1.5);
      }
    }
  }

  update(dt: number): void {
    const g = this.game;
    this.hash.clear();
    for (const e of this.list) if (e.alive && e.state !== S_BURROWED) this.hash.insert(e);
    this.roarT -= dt;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (!e.alive) continue;
      this.step(e, dt);
    }
    // compact
    let w = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.alive) this.list[w++] = e;
      else if (e === this.boss) this.boss = null;
    }
    this.list.length = w;
    this.render(g.time);
  }

  private render(time: number): void {
    for (const k in this.renderers) this.renderers[k as EnemyKind].begin();
    for (const e of this.list) {
      const rd = this.renderers[e.kind];
      let y = e.y;
      let sy = 1;
      let tiltX = 0;
      if (e.spawnT > 0) y -= e.spawnT * 1.6 * e.scale;
      if (e.state === S_BURROWED) y -= 3 * e.scale;
      if (e.state === S_FLEE || e.sink > 0) y -= e.sink * 2.2 * e.scale;
      if (e.kind === 'floater') y += Math.sin(time * 2 + e.id) * 0.25;
      if (e.kind === 'skitter' && e.state === S_WINDUP) sy = 0.8;
      if (e.kind === 'brute' && e.state === S_WINDUP) tiltX = -0.15;
      if (e.kind === 'nest') sy = 1 + Math.sin(time * 2.5 + e.id) * 0.04;
      let tint = e.elite ? 0xff9a8a : 0xffffff;
      if (e.state === S_STUN) tint = 0xa0a0ff;
      rd.push(e.x, y, e.z, e.facing, e.scale, e.gait, e.flash, e.pulse, tint, tiltX, 0, sy);
    }
    for (const k in this.renderers) this.renderers[k as EnemyKind].end();
  }

  private step(e: Enemy, dt: number): void {
    const g = this.game;
    const p = g.player;
    e.flash = Math.max(0, e.flash - dt * 7);
    e.cd -= dt;
    e.t += dt;
    if (e.spawnT > 0) {
      e.spawnT -= dt;
      e.y = g.terrain.heightAt(e.x, e.z);
      if (Math.random() < 0.3) g.fx.dust(e.x, e.z, 1, 0x6a5a4a, 0.6 * e.scale, 1);
      return;
    }
    if (e.state === S_FLEE) {
      e.sink += dt * 0.9;
      if (Math.random() < 0.2) g.fx.dust(e.x, e.z, 1, 0x6a5a4a, 0.6 * e.scale, 1);
      if (e.sink >= 1) {
        e.alive = false;
        if (e.parent) e.parent.children = Math.max(0, e.parent.children - 1);
      }
      return;
    }
    // environmental effects: lamp light burns and slows night-crawlers
    e.slow = 1;
    const light = g.structures.lightAt(e.x, e.z) + g.lampExposure(e);
    if (light > 0 && e.kind !== 'nest' && e.kind !== 'matriarch' && e.state !== S_BURROWED) {
      e.slow = e.kind === 'skitter' || e.kind === 'floater' ? 0.55 : 0.8;
      if (g.cycle.darkness > 0.3 && light >= 1) {
        e.burn += dt;
        if (e.burn > 0.5) {
          e.burn = 0;
          const burnDmg = (light > 1 ? 7 : 4) * (e.kind === 'skitter' ? 1.5 : 1);
          this.damage(e, burnDmg, e.x, e.z, 'light');
          if (!e.alive) return;
          g.fx.sparks(e.x, e.y + 0.6, e.z, 0xffe0a0, 3, 3, 0.3, 0.12);
        }
      }
    }
    if (e.stun > 0) {
      e.stun -= dt;
      if (e.state !== S_STUN && e.kind !== 'nest') {
        e.state = S_STUN;
        e.t = 0;
      }
    }
    // knockback velocity decays
    e.vx = damp(e.vx, 0, 6, dt);
    e.vz = damp(e.vz, 0, 6, dt);

    // aggro management
    const dp = p.alive ? dist(e.x, e.z, p.x, p.z) : Infinity;
    const detect = e.mode === 'siege' ? 13 : g.cycle.darkness > 0.5 ? 30 : 22;
    if (!e.aggro && dp < detect && (dp < 9 || g.grid.lineOfSight(e.x, e.z, p.x, p.z, 0.9))) e.aggro = true;
    if (e.aggro && (!p.alive || dp > (e.mode === 'guard' ? 45 : 70))) {
      e.aggro = false;
      if (e.mode === 'hunt') e.mode = 'wander';
    }

    let mx = 0;
    let mz = 0;
    let spd = 0;
    let face: number | null = null;
    const k = e.kind;
    if (k === 'nest') this.nestAI(e, dt, dp);
    else if (k === 'matriarch') {
      const r = this.bossAI(e, dt, dp);
      mx = r.x;
      mz = r.z;
      spd = r.s;
      face = r.face;
    } else if (e.state === S_STUN) {
      if (e.stun <= 0) {
        e.state = S_MOVE;
        e.t = 0;
      }
      if (Math.random() < 0.15) g.fx.glow.spawn({ x: e.x + rand(-0.5, 0.5), y: e.y + 2.4 * e.scale, z: e.z + rand(-0.5, 0.5), vy: 1, life: 0.4, size: 0.3, sizeEnd: 0, color: 0xfff08a });
    } else {
      const r = this.creatureAI(e, dt, dp);
      mx = r.x;
      mz = r.z;
      spd = r.s;
      face = r.face;
    }

    // integrate
    const s = spd * e.slow;
    let nx = e.x + (mx * s + e.vx) * dt;
    let nz = e.z + (mz * s + e.vz) * dt;
    if (k !== 'nest') {
      // separation
      if (e.state !== S_BURROWED) {
        this.hash.query(nx, nz, e.r + 1.6, neighbors);
        let cnt = 0;
        for (const o of neighbors) {
          if (o === e || !o.alive || o.kind === 'floater' || o.state === S_BURROWED) continue;
          const dx = nx - o.x;
          const dz = nz - o.z;
          const min = e.r + o.r;
          const d2 = dx * dx + dz * dz;
          if (d2 < min * min && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const push = (min - d) * (o.kind === 'nest' || o.kind === 'matriarch' ? 1 : 0.5);
            nx += (dx / d) * push;
            nz += (dz / d) * push;
            if (++cnt > 6) break;
          }
        }
      }
      if (k !== 'floater' && e.state !== S_BURROWED) {
        const pos = { x: nx, z: nz };
        const hit = g.grid.resolve(pos, e.r);
        nx = pos.x;
        nz = pos.z;
        if (hit) this.onBump(e, hit);
      } else {
        const d = Math.hypot(nx, nz);
        if (d > 186) {
          nx *= 186 / d;
          nz *= 186 / d;
        }
      }
      // keep out of the player (soft)
      if (p.alive && e.state !== S_BURROWED && k !== 'floater') {
        const dx = nx - p.x;
        const dz = nz - p.z;
        const min = e.r + 0.45;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          nx += (dx / d) * (min - d);
          nz += (dz / d) * (min - d);
        }
      }
      const moved = Math.hypot(nx - e.x, nz - e.z);
      e.gait += moved * (k === 'skitter' ? 5 : k === 'brute' ? 1.6 : k === 'matriarch' ? 1.1 : 3);
      e.x = nx;
      e.z = nz;
      e.y = g.terrain.heightAt(e.x, e.z);
      if (face !== null) e.facing = angleDamp(e.facing, face, k === 'brute' ? 5 : 10, dt);
      else if (moved > 0.01) e.facing = angleDamp(e.facing, heading(mx, mz), 10, dt);
    }
  }

  private onBump(e: Enemy, o: Obstacle): void {
    const g = this.game;
    if (e.kind === 'brute' && e.state === S_ATTACK) {
      // charged into something solid: stagger
      e.state = S_STUN;
      e.stun = 1.8;
      e.t = 0;
      g.fx.shake(0.35);
      g.fx.dust(e.x, e.z, 10, 0x8a7a6a, 1.5, 1.5);
      audio.play('shipHit', { x: e.x, z: e.z, volume: 0.8, pitch: 0.7 });
      if (o.kind === 'structure') g.structures.damage(o.ref, 90, e.x, e.z);
      return;
    }
    if (e.kind === 'matriarch' && e.state === S_ATTACK && e.attackIdx === 2) {
      e.state = S_STUN;
      e.stun = 2.6;
      e.t = 0;
      g.fx.shake(0.7);
      g.fx.dust(e.x, e.z, 20, 0x8a7a6a, 3, 2);
      audio.play('explosion', { x: e.x, z: e.z, pitch: 0.6 });
      g.messages.toast('The Matriarch is stunned — hit it now!', 'good');
      if (o.kind === 'structure') g.structures.damage(o.ref, 400, e.x, e.z);
      return;
    }
    if (o.kind === 'structure' && e.cd <= 0 && (e.mode === 'siege' || e.aggro)) {
      g.structures.damage(o.ref, e.dmg * (e.kind === 'brute' ? 3 : 1.5), e.x, e.z);
      e.cd = 0.9;
      e.pulse = 1;
    }
  }

  /** Movement direction toward a point, using the flow fields around obstacles when the direct path is blocked. */
  private pathTo(e: Enemy, tx: number, tz: number, useShip: boolean): { x: number; z: number } {
    const g = this.game;
    const d = dist(e.x, e.z, tx, tz);
    if (d < 7 || (d < 18 && ((e.id + g.frame) & 7) === 0 && g.grid.lineOfSight(e.x, e.z, tx, tz, 0.5))) {
      e.dirX = (tx - e.x) / (d || 1);
      e.dirZ = (tz - e.z) / (d || 1);
      e.losFrame = g.frame;
      return { x: e.dirX, z: e.dirZ };
    }
    if (d < 18 && g.frame - e.losFrame < 16) return { x: (tx - e.x) / (d || 1), z: (tz - e.z) / (d || 1) };
    const field = useShip ? g.flowShip : g.flowPlayer;
    if (field.dir(e.x, e.z, tmpDir)) return { x: tmpDir.x, z: tmpDir.z };
    return { x: (tx - e.x) / (d || 1), z: (tz - e.z) / (d || 1) };
  }

  private creatureAI(e: Enemy, dt: number, dp: number): { x: number; z: number; s: number; face: number | null } {
    const g = this.game;
    const p = g.player;
    const k = e.kind;
    const out = { x: 0, z: 0, s: 0, face: null as number | null };
    const huntPlayer = e.aggro && p.alive;
    // choose destination
    let tx = e.homeX;
    let tz = e.homeZ;
    let useShip = false;
    if (huntPlayer) {
      tx = p.x;
      tz = p.z;
    } else if (e.mode === 'siege') {
      tx = g.ship.x;
      tz = g.ship.z;
      useShip = true;
    }
    const shipD = dist(e.x, e.z, g.ship.x, g.ship.z);

    if (e.state === S_IDLE) {
      e.pulse = 0.3 + Math.sin(g.time * 2 + e.id) * 0.2;
      if (e.aggro) {
        e.state = S_MOVE;
        e.t = 0;
        if (k === 'brute' && this.roarT <= 0) {
          audio.play('roar', { x: e.x, z: e.z, volume: 0.8 });
          this.roarT = 2;
        }
      } else if (Math.random() < dt * 0.3) {
        e.facing += rand(-1, 1);
      }
      return out;
    }

    // siege creatures bite the hull when they reach the ship
    if (!huntPlayer && e.mode === 'siege' && shipD < 6.2 + e.r && k !== 'floater') {
      out.face = heading(g.ship.x - e.x, g.ship.z - e.z);
      if (e.cd <= 0) {
        e.cd = k === 'brute' ? 1.6 : 1.0;
        g.ship.damage(e.dmg * (k === 'brute' ? 2.5 : 1), e.x, e.z);
        e.pulse = 1;
      }
      e.pulse = Math.max(0, e.pulse - dt * 3);
      return out;
    }

    switch (k) {
      case 'skitter': {
        if (e.state === S_MOVE) {
          const dir = this.pathTo(e, tx, tz, useShip && !huntPlayer);
          out.x = dir.x;
          out.z = dir.z;
          out.s = e.speed;
          // wander jitter
          if (!huntPlayer && e.mode === 'wander') {
            if (dist(e.x, e.z, e.homeX, e.homeZ) < 3 || Math.random() < dt * 0.3) {
              e.homeX = e.x + rand(-14, 14);
              e.homeZ = e.z + rand(-14, 14);
            }
            out.s = e.speed * 0.45;
          }
          if (huntPlayer && dp < 2.8 + e.r && e.cd <= 0) {
            e.state = S_WINDUP;
            e.t = 0;
          }
        } else if (e.state === S_WINDUP) {
          out.face = heading(p.x - e.x, p.z - e.z);
          if (e.t > 0.2) {
            e.state = S_ATTACK;
            e.t = 0;
            e.hitDone = false;
            const d = Math.max(0.01, dp);
            e.dirX = (p.x - e.x) / d;
            e.dirZ = (p.z - e.z) / d;
          }
        } else if (e.state === S_ATTACK) {
          out.x = e.dirX;
          out.z = e.dirZ;
          out.s = 14;
          if (!e.hitDone && dp < e.r + 0.75) {
            e.hitDone = true;
            p.hurt(e.dmg, e.x, e.z, 5, 'skitter');
          }
          if (e.t > 0.24) {
            e.state = S_RECOVER;
            e.t = 0;
          }
        } else if (e.state === S_RECOVER) {
          out.x = -e.dirX;
          out.z = -e.dirZ;
          out.s = 2;
          if (e.t > 0.35) {
            e.state = S_MOVE;
            e.cd = rand(0.7, 1.1);
          }
        }
        e.pulse = 0.5 + Math.sin(g.time * 8 + e.id) * 0.5;
        break;
      }
      case 'spitter': {
        const los = huntPlayer && dp < 18 && ((e.id + g.frame) % 6 !== 0 || g.grid.lineOfSight(e.x, e.z, p.x, p.z, 0.9));
        if (e.state === S_MOVE) {
          if (huntPlayer && dp < 17 && los) {
            const toX = (p.x - e.x) / dp;
            const toZ = (p.z - e.z) / dp;
            if (dp < 8) {
              out.x = -toX;
              out.z = -toZ;
              out.s = e.speed;
            } else {
              out.x = -toZ * e.strafe + toX * (dp > 13 ? 0.6 : 0);
              out.z = toX * e.strafe + toZ * (dp > 13 ? 0.6 : 0);
              out.s = e.speed * 0.6;
              if (Math.random() < dt * 0.4) e.strafe *= -1;
            }
            out.face = heading(toX, toZ);
            if (e.cd <= 0) {
              e.state = S_WINDUP;
              e.t = 0;
            }
          } else {
            const dir = this.pathTo(e, tx, tz, useShip && !huntPlayer);
            out.x = dir.x;
            out.z = dir.z;
            out.s = huntPlayer || e.mode === 'siege' ? e.speed : e.speed * 0.4;
            if (!huntPlayer && e.mode === 'siege' && shipD < 14 && e.cd <= 0) {
              // lob at the hull from range
              e.state = S_WINDUP;
              e.t = 0;
            }
          }
          e.pulse = Math.max(0, e.pulse - dt * 2);
        } else if (e.state === S_WINDUP) {
          e.pulse = Math.min(1, e.t / 0.55);
          const tgtX = huntPlayer ? p.x : g.ship.x;
          const tgtZ = huntPlayer ? p.z : g.ship.z;
          out.face = heading(tgtX - e.x, tgtZ - e.z);
          if (e.t > 0.55) {
            let ax = tgtX;
            let az = tgtZ;
            if (huntPlayer) {
              ax += p.vx * 0.5;
              az += p.vz * 0.5;
            }
            g.projectiles.glob(e.x, e.y + 1.2, e.z, ax, az, e.dmg * g.difficulty.enemyDmg, 'acid');
            audio.play('spit', { x: e.x, z: e.z, volume: 0.7 });
            e.state = S_RECOVER;
            e.t = 0;
            e.pulse = 0;
          }
        } else if (e.state === S_RECOVER) {
          if (e.t > 0.4) {
            e.state = S_MOVE;
            e.cd = rand(2.2, 3.2);
          }
        }
        break;
      }
      case 'brute': {
        if (e.state === S_MOVE) {
          const dir = this.pathTo(e, tx, tz, useShip && !huntPlayer);
          out.x = dir.x;
          out.z = dir.z;
          out.s = huntPlayer || e.mode === 'siege' ? e.speed : e.speed * 0.4;
          if (huntPlayer && dp < 15 && dp > 3 && e.cd <= 0 && g.grid.lineOfSight(e.x, e.z, p.x, p.z, 0.5)) {
            e.state = S_WINDUP;
            e.t = 0;
            audio.play('roar', { x: e.x, z: e.z, volume: 0.9 });
          } else if (huntPlayer && dp < e.r + 1.3 && e.cd <= 0) {
            // close-range swipe
            p.hurt(e.dmg * 0.6, e.x, e.z, 10, 'brute');
            e.cd = 1.3;
          }
          e.pulse = Math.max(0, e.pulse - dt * 2);
        } else if (e.state === S_WINDUP) {
          e.pulse = Math.min(1, e.t / 0.85);
          out.face = heading(p.x - e.x, p.z - e.z);
          if (Math.random() < 0.5) g.fx.dust(e.x - Math.sin(e.facing) * 1.2, e.z - Math.cos(e.facing) * 1.2, 1, 0x8a7a6a, 0.7, 0.6);
          if (e.t > 0.85) {
            e.state = S_ATTACK;
            e.t = 0;
            e.hitDone = false;
            const d = Math.max(0.01, dp);
            e.dirX = (p.x - e.x) / d;
            e.dirZ = (p.z - e.z) / d;
            audio.play('charge', { x: e.x, z: e.z });
          }
        } else if (e.state === S_ATTACK) {
          out.x = e.dirX;
          out.z = e.dirZ;
          out.s = 17;
          out.face = heading(e.dirX, e.dirZ);
          if (Math.random() < 0.6) g.fx.dust(e.x, e.z, 1, 0x8a7a6a, 0.9, 0.8);
          if (!e.hitDone && dp < e.r + 0.8) {
            e.hitDone = true;
            p.hurt(e.dmg, e.x, e.z, 18, 'brute');
          }
          // trample smaller creatures out of the way
          this.hash.query(e.x, e.z, e.r + 1, neighbors);
          for (const o of neighbors) {
            if (o === e || !o.alive || o.kind === 'brute' || o.kind === 'nest' || o.kind === 'matriarch') continue;
            if (dist(o.x, o.z, e.x, e.z) < e.r + o.r + 0.3) this.knock(o, e.x, e.z, 10);
          }
          if (e.t > 1.25) {
            e.state = S_RECOVER;
            e.t = 0;
          }
        } else if (e.state === S_RECOVER) {
          e.pulse = Math.max(0, e.pulse - dt * 2);
          if (e.t > 0.9) {
            e.state = S_MOVE;
            e.cd = rand(3, 4.2);
          }
        }
        break;
      }
      case 'burrower': {
        if (e.state === S_BURROWED) {
          const dir = this.pathTo(e, tx, tz, useShip && !huntPlayer);
          out.x = dir.x;
          out.z = dir.z;
          out.s = huntPlayer ? e.speed : e.mode === 'siege' ? e.speed * 0.8 : e.speed * 0.35;
          if (!huntPlayer && e.mode !== 'siege' && dist(e.x, e.z, e.homeX, e.homeZ) < 3) {
            e.homeX = e.x + rand(-16, 16);
            e.homeZ = e.z + rand(-16, 16);
          }
          if (Math.random() < 0.5) g.fx.dust(e.x, e.z, 1, 0x7a6a5a, 0.5, 0.6);
          if (e.t > 1.2 && e.cd <= 0 && ((huntPlayer && dp < 2.4) || (!huntPlayer && e.mode === 'siege' && shipD < 7.5))) {
            e.state = S_EMERGE;
            e.t = 0;
            g.fx.ring(e.x, e.z, 2.6, 2.2, 0xff6a2a, 0.75);
            audio.play('burrow', { x: e.x, z: e.z });
          }
        } else if (e.state === S_EMERGE) {
          if (huntPlayer) {
            out.x = (p.x - e.x) / Math.max(dp, 0.01);
            out.z = (p.z - e.z) / Math.max(dp, 0.01);
            out.s = 1.5;
          }
          if (Math.random() < 0.8) g.fx.dust(e.x, e.z, 1, 0x7a6a5a, 0.8, 1.2);
          if (e.t > 0.75) {
            e.state = S_ATTACK;
            e.t = 0;
            e.hitDone = false;
            g.fx.dust(e.x, e.z, 14, 0x7a6a5a, 1.6, 3);
            g.fx.shake(0.25);
            audio.play('emerge', { x: e.x, z: e.z });
            if (p.alive && dist(e.x, e.z, p.x, p.z) < 2.6) p.hurt(e.dmg, e.x, e.z, 9, 'burrower');
            if (!huntPlayer && e.mode === 'siege' && shipD < 8) g.ship.damage(e.dmg * 2, e.x, e.z);
            g.structures.damageRadius(e.x, e.z, 2.6, 40);
          }
        } else if (e.state === S_ATTACK) {
          if (huntPlayer) {
            out.face = heading(p.x - e.x, p.z - e.z);
            if (dp < e.r + 1.2 && e.cd <= 0) {
              p.hurt(e.dmg * 0.6, e.x, e.z, 6, 'burrower');
              e.cd = 0.9;
            }
          }
          e.pulse = 0.5 + 0.5 * Math.sin(g.time * 10);
          if (e.t > 2.6) {
            e.state = S_RECOVER;
            e.t = 0;
          }
        } else if (e.state === S_RECOVER) {
          e.sink = Math.min(1, e.t / 0.6);
          if (Math.random() < 0.5) g.fx.dust(e.x, e.z, 1, 0x7a6a5a, 0.8, 1);
          if (e.t > 0.6) {
            e.sink = 0;
            e.state = S_BURROWED;
            e.t = 0;
            e.cd = 1.5;
          }
        } else {
          e.state = S_BURROWED;
        }
        break;
      }
      case 'floater': {
        const dir = huntPlayer ? { x: (p.x - e.x) / Math.max(dp, 0.01), z: (p.z - e.z) / Math.max(dp, 0.01) } : this.pathTo(e, tx, tz, useShip);
        out.x = dir.x;
        out.z = dir.z;
        out.s = huntPlayer || e.mode === 'siege' ? e.speed : e.speed * 0.3;
        if (!huntPlayer && e.mode === 'wander' && dist(e.x, e.z, e.homeX, e.homeZ) < 3) {
          e.homeX = e.x + rand(-12, 12);
          e.homeZ = e.z + rand(-12, 12);
        }
        e.pulse = 0.5 + 0.5 * Math.sin(g.time * 3 + e.id);
        if ((huntPlayer && dp < 1.7) || (!huntPlayer && e.mode === 'siege' && shipD < 6)) {
          audio.play('sporeRelease', { x: e.x, z: e.z });
          g.hazards.sporeCloud(e.x, e.z, 3.4, 5);
          if (!huntPlayer) g.ship.damage(25, e.x, e.z);
          e.hp = 0;
          this.kill(e, 'self');
        }
        break;
      }
    }
    return out;
  }

  private nestAI(e: Enemy, dt: number, dp: number): void {
    const g = this.game;
    e.pulse = 0.5 + 0.5 * Math.sin(g.time * 2.2 + e.id);
    const night = g.cycle.darkness > 0.5;
    const active = dp < 38 || (night && dp < 60);
    if (!active) return;
    if (e.cd <= 0 && e.children < (night ? 7 : 5)) {
      e.cd = rand(4.5, 7) / (night ? 1.4 : 1);
      const n = Math.min(night ? 3 : 2, 7 - e.children);
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU);
        const kind = g.director.threat > 3 && Math.random() < 0.2 ? 'spitter' : 'skitter';
        const c = this.spawn(kind, e.x + Math.cos(a) * 3, e.z + Math.sin(a) * 3, 'hunt', { emerge: true, parent: e, aggro: dp < 30 });
        c.homeX = e.x;
        c.homeZ = e.z;
        e.children++;
      }
      e.pulse = 1;
      audio.play('nestSpawn', { x: e.x, z: e.z });
      g.fx.ichor(e.x, e.y + 2, e.z, ICHOR.nest, GLOW_COL.nest, 8, 0);
    }
  }

  private bossAI(e: Enemy, dt: number, dp: number): { x: number; z: number; s: number; face: number | null } {
    const g = this.game;
    const p = g.player;
    const out = { x: 0, z: 0, s: 0, face: null as number | null };
    const enraged = e.hp < e.maxHp * 0.5;
    if (enraged && e.phase === 0) {
      e.phase = 1;
      audio.play('bossRoar');
      g.fx.shake(0.8);
      g.messages.toast('The Matriarch is enraged!', 'bad');
      e.speed *= 1.25;
    }
    const toP = p.alive ? heading(p.x - e.x, p.z - e.z) : e.facing;
    switch (e.state) {
      case S_INTRO: {
        e.spawnT = 0;
        e.sink = Math.max(0, 1 - e.t / 2.6);
        if (Math.random() < 0.9) g.fx.dust(e.x + rand(-3, 3), e.z + rand(-3, 3), 2, 0x6a3a3a, 2, 3);
        g.fx.shake(0.15);
        out.face = toP;
        if (e.t > 2.6) {
          e.state = S_MOVE;
          e.t = 0;
          e.cd = 1.5;
          audio.play('bossRoar');
          g.fx.shake(0.9);
        }
        return out;
      }
      case S_MOVE: {
        // leash: if the player abandons the arena she returns to her lair and regrows
        const a = g.layout.arena;
        const pArena = dist(p.x, p.z, a.x, a.z);
        if (!e.leashed && (!p.alive || pArena > 50)) {
          e.leashed = true;
        } else if (e.leashed && p.alive && pArena < 32) {
          e.leashed = false;
          e.cd = 1;
          audio.play('bossRoar');
          g.fx.shake(0.6);
        }
        if (e.leashed) {
          const dh = dist(e.x, e.z, a.x, a.z);
          if (dh > 3) {
            out.x = (a.x - e.x) / dh;
            out.z = (a.z - e.z) / dh;
            out.s = e.speed * 0.8;
            out.face = heading(a.x - e.x, a.z - e.z);
          } else {
            e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.03 * dt);
          }
          e.pulse = Math.max(0, e.pulse - dt);
          return out;
        }
        if (p.alive) {
          const dir = this.pathTo(e, p.x, p.z, false);
          out.x = dir.x;
          out.z = dir.z;
          out.s = dp > 7 ? e.speed : e.speed * 0.3;
          out.face = toP;
          if (dp < e.r + 1.5 && e.t > 0.5) {
            p.hurt(e.dmg * 0.7, e.x, e.z, 14, 'matriarch');
          }
        }
        e.pulse = Math.max(0, e.pulse - dt);
        if (e.cd <= 0 && p.alive) {
          const options = dp > 9 ? [0, 1, 2, 3] : [0, 1, 3, 3];
          e.attackIdx = options[Math.floor(Math.random() * options.length)];
          if (e.attackIdx === 1 && this.countKind('skitter') > 30) e.attackIdx = 0;
          e.state = S_WINDUP;
          e.t = 0;
          if (e.attackIdx === 2) audio.play('roar', { x: e.x, z: e.z, pitch: 0.6 });
        }
        return out;
      }
      case S_WINDUP: {
        out.face = toP;
        const wind = e.attackIdx === 2 ? 1.1 : e.attackIdx === 3 ? 0.6 : 0.7;
        e.pulse = Math.min(1, e.t / wind);
        if (e.attackIdx === 2 && Math.random() < 0.6) g.fx.dust(e.x, e.z, 2, 0x6a3a3a, 1.5, 1);
        if (e.t > wind) {
          e.state = S_ATTACK;
          e.t = 0;
          e.hitDone = false;
          e.phase2Count = 0;
          if (e.attackIdx === 2) {
            e.dirX = Math.sin(toP);
            e.dirZ = Math.cos(toP);
            audio.play('charge', { x: e.x, z: e.z, pitch: 0.7 });
          }
          if (e.attackIdx === 3) {
            audio.play('burrow', { x: e.x, z: e.z, pitch: 0.6 });
          }
        }
        return out;
      }
      case S_ATTACK: {
        const idx = e.attackIdx;
        if (idx === 0) {
          // acid volleys
          out.face = toP;
          const volleys = enraged ? 4 : 3;
          const shots = enraged ? 7 : 5;
          if (e.t > e.phase2Count * 0.45 && e.phase2Count < volleys) {
            e.phase2Count++;
            for (let i = 0; i < shots; i++) {
              const a = toP + (i - (shots - 1) / 2) * 0.22;
              const d = clamp(dp, 6, 18) + rand(-2, 2);
              g.projectiles.glob(e.x + Math.sin(toP) * 3, e.y + 4, e.z + Math.cos(toP) * 3, e.x + Math.sin(a) * d, e.z + Math.cos(a) * d, 18 * g.difficulty.enemyDmg, 'boss');
            }
            audio.play('spit', { x: e.x, z: e.z, pitch: 0.6, volume: 1 });
            e.pulse = 1;
          }
          if (enraged && e.t > 2 && !e.hitDone) {
            e.hitDone = true;
            for (let i = 0; i < 14; i++) {
              const a = (i / 14) * TAU;
              g.projectiles.glob(e.x, e.y + 4, e.z, e.x + Math.sin(a) * 10, e.z + Math.cos(a) * 10, 16 * g.difficulty.enemyDmg, 'boss');
            }
          }
          if (e.t > 2.4) this.bossRecover(e);
        } else if (idx === 1) {
          // summon brood
          if (!e.hitDone) {
            e.hitDone = true;
            const n = enraged ? 9 : 6;
            for (let i = 0; i < n; i++) {
              const a = rand(0, TAU);
              const kind = enraged && i % 3 === 0 ? 'spitter' : 'skitter';
              this.spawn(kind, e.x + Math.cos(a) * 5, e.z + Math.sin(a) * 5, 'hunt', { emerge: true, aggro: true });
            }
            audio.play('nestSpawn', { x: e.x, z: e.z, pitch: 0.6, volume: 1 });
            audio.play('bossRoar', { volume: 0.6 });
            e.pulse = 1;
          }
          if (e.t > 1.4) this.bossRecover(e);
        } else if (idx === 2) {
          // charge
          out.x = e.dirX;
          out.z = e.dirZ;
          out.s = enraged ? 22 : 19;
          out.face = heading(e.dirX, e.dirZ);
          g.fx.dust(e.x, e.z, 2, 0x6a3a3a, 2, 1);
          if (!e.hitDone && p.alive && dp < e.r + 1) {
            e.hitDone = true;
            p.hurt(e.dmg * 1.2, e.x, e.z, 22, 'matriarch');
          }
          if (e.t > 1.6) this.bossRecover(e);
        } else {
          // burrow strike
          if (e.t < 0.8) {
            e.sink = e.t / 0.8;
            g.fx.dust(e.x + rand(-3, 3), e.z + rand(-3, 3), 2, 0x6a3a3a, 2, 2);
          } else if (e.t < 2.4) {
            e.sink = 1;
            e.state = S_ATTACK;
            if (p.alive) {
              const d = Math.max(0.01, dp);
              out.x = (p.x - e.x) / d;
              out.z = (p.z - e.z) / d;
              out.s = dp > 1 ? 12 : 0;
            }
            if (Math.random() < 0.7) g.fx.dust(e.x, e.z, 2, 0x6a3a3a, 2, 1.5);
            if (!e.hitDone && e.t > 1.4) {
              e.hitDone = true;
              g.fx.ring(e.x, e.z, 5.5, 4.5, 0xff2d55, 1.0);
            }
          } else if (e.t < 3.0) {
            e.sink = 1;
            if (Math.random() < 0.9) g.fx.dust(e.x + rand(-2, 2), e.z + rand(-2, 2), 2, 0x6a3a3a, 2, 3);
          } else {
            e.sink = 0;
            g.fx.dust(e.x, e.z, 30, 0x6a3a3a, 3, 4);
            g.fx.shake(0.8);
            audio.play('emerge', { x: e.x, z: e.z, pitch: 0.6, volume: 1 });
            if (p.alive && dist(e.x, e.z, p.x, p.z) < 5) p.hurt(40, e.x, e.z, 20, 'matriarch');
            g.structures.damageRadius(e.x, e.z, 5, 200);
            this.bossRecover(e);
          }
        }
        return out;
      }
      case S_STUN: {
        if (e.stun <= 0) this.bossRecover(e);
        if (Math.random() < 0.3) g.fx.glow.spawn({ x: e.x + rand(-2, 2), y: e.y + 6, z: e.z + rand(-2, 2), vy: 1.5, life: 0.5, size: 0.5, sizeEnd: 0, color: 0xfff08a });
        return out;
      }
      default:
        this.bossRecover(e);
        return out;
    }
  }

  private bossRecover(e: Enemy): void {
    e.state = S_MOVE;
    e.t = 0;
    e.sink = 0;
    e.cd = e.phase ? rand(1.2, 2.2) : rand(2, 3.2);
  }
}

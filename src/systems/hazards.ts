import { clamp, dist, rand, TAU } from '../core/math';
import { audio } from '../audio/audio';
import type { Game } from '../game';

interface Puddle {
  x: number;
  z: number;
  r: number;
  t: number;
  dur: number;
  color: number;
}

interface Spore {
  x: number;
  z: number;
  r: number;
  t: number;
  dur: number;
}

interface Geyser {
  x: number;
  z: number;
  y: number;
  state: 0 | 1 | 2;
  timer: number;
}

interface Strike {
  x: number;
  z: number;
  t: number;
}

/** Environmental dangers: acid pools, spit puddles, spore clouds, geysers and ion storms. */
export class HazardSystem {
  private pools: { x: number; z: number; r: number }[];
  private puddles: Puddle[] = [];
  private spores: Spore[] = [];
  private geysers: Geyser[] = [];
  private strikes: Strike[] = [];
  storm = false;
  private stormT = 0;
  private stormDur = 0;
  private strikeT = 0;
  private windA = 0;
  private stormLoop = { setVolume(_v: number) {}, stop() {} };
  private sizzleT = 0;
  stormLevel = 0;

  constructor(private game: Game) {
    this.pools = game.layout.pools;
    for (const g of game.layout.geysers) this.geysers.push({ x: g.x, z: g.z, y: game.terrain.heightAt(g.x, g.z), state: 0, timer: rand(3, 12) });
  }

  clear(): void {
    this.puddles = [];
    this.spores = [];
    this.strikes = [];
    this.endStorm();
  }

  inPool(x: number, z: number): boolean {
    for (const p of this.pools) if ((p.x - x) ** 2 + (p.z - z) ** 2 < p.r * p.r) return true;
    return false;
  }

  slowAt(x: number, z: number): number {
    return this.inPool(x, z) ? 0.7 : 1;
  }

  acidPuddle(x: number, z: number, r: number, dur: number, color: number): void {
    this.puddles.push({ x, z, r, t: 0, dur, color });
    const g = this.game;
    g.fx.lightDecals.add(x, g.terrain.heightAt(x, z) + 0.05, z, r * 2.3, color, 0.5, dur);
    g.fx.splats.add(x, g.terrain.heightAt(x, z) + 0.04, z, r * 2, 0x1a2a0a, 0.5, dur + 10);
  }

  sporeCloud(x: number, z: number, r: number, dur: number): void {
    this.spores.push({ x, z, r, t: 0, dur });
    const g = this.game;
    for (let i = 0; i < 26; i++) {
      const a = rand(0, TAU);
      const d = rand(0, r);
      g.fx.smoke.spawn({ x: x + Math.cos(a) * d, y: g.terrain.heightAt(x, z) + rand(0.3, 1.8), z: z + Math.sin(a) * d, vx: rand(-0.5, 0.5), vy: rand(0, 0.4), vz: rand(-0.5, 0.5), life: rand(1.5, 2.5), size: 1.2, sizeEnd: 2.6, color: 0x7a5a9a, alpha: 0.5, drag: 1 });
    }
    audio.play('sporeRelease', { x, z });
  }

  startStorm(dur: number): void {
    if (this.storm) return;
    this.storm = true;
    this.stormT = 0;
    this.stormDur = dur;
    this.strikeT = 3;
    this.windA = rand(0, TAU);
    this.stormLoop.stop();
    this.stormLoop = audio.loop('storm');
    this.game.messages.comms('WREN', 'Ion storm rolling in. Lightning strikes are telegraphed on the ground — keep moving.', 'warn');
    this.game.messages.announce('ION STORM', 'Watch the ground for strike markers', 'warn');
  }

  endStorm(): void {
    this.storm = false;
    this.stormLoop.stop();
  }

  update(dt: number): void {
    const g = this.game;
    const p = g.player;
    let dps = 0;
    let src = '';
    if (p.alive && p.dashT <= 0) {
      if (this.inPool(p.x, p.z)) {
        dps += 14;
        src = 'acid';
      }
    }
    // puddles
    for (const q of this.puddles) {
      q.t += dt;
      if (Math.random() < dt * 6) g.fx.glow.spawn({ x: q.x + rand(-q.r, q.r) * 0.7, y: g.terrain.heightAt(q.x, q.z) + 0.1, z: q.z + rand(-q.r, q.r) * 0.7, vy: rand(0.5, 1.5), life: 0.5, size: 0.2, sizeEnd: 0, color: q.color });
      if (p.alive && p.dashT <= 0 && dist(p.x, p.z, q.x, q.z) < q.r) {
        dps += 9;
        src = 'acid';
      }
    }
    this.puddles = this.puddles.filter((q) => q.t < q.dur);
    // spores
    for (const s of this.spores) {
      s.t += dt;
      if (Math.random() < dt * 10) {
        const a = rand(0, TAU);
        const d = rand(0, s.r);
        g.fx.smoke.spawn({ x: s.x + Math.cos(a) * d, y: g.terrain.heightAt(s.x, s.z) + rand(0.3, 1.6), z: s.z + Math.sin(a) * d, vy: 0.2, life: 1.5, size: 1, sizeEnd: 2, color: 0x6a4a8a, alpha: 0.4, drag: 1 });
      }
      if (p.alive && dist(p.x, p.z, s.x, s.z) < s.r) {
        dps += 11;
        src = 'spores';
      }
      if (Math.floor((s.t - dt) * 2) !== Math.floor(s.t * 2)) {
        g.enemies.forEachInRadius(s.x, s.z, s.r, (e) => {
          if (e.kind !== 'floater' && e.kind !== 'nest' && e.kind !== 'matriarch') g.enemies.damage(e, 10, s.x, s.z, 'spores');
        });
      }
    }
    this.spores = this.spores.filter((s) => s.t < s.dur);
    if (dps > 0) {
      p.dot(dps * dt, src);
      this.sizzleT -= dt;
      if (this.sizzleT <= 0) {
        this.sizzleT = 0.45;
        audio.play('acidSplash', { volume: 0.35 });
        g.hud.hurtFlash(0.25);
        g.fx.sparks(p.x, p.y + 0.3, p.z, src === 'spores' ? 0xb07aff : 0x8dff3a, 5, 2, 0.4, 0.15);
      }
    }
    // geysers
    for (const gy of this.geysers) {
      const near = dist(gy.x, gy.z, p.x, p.z) < 60;
      gy.timer -= dt;
      if (gy.state === 0) {
        if (near && Math.random() < dt * 2) g.fx.smokePuff(gy.x + rand(-0.4, 0.4), gy.y + 0.3, gy.z + rand(-0.4, 0.4), 0xb0a8a0, 0.6, 1.5, 1, 0.25);
        if (gy.timer <= 0) {
          gy.state = 1;
          gy.timer = 1.4;
          if (near) {
            g.fx.ring(gy.x, gy.z, 2.8, 2.4, 0xffc080, 1.4);
            audio.play('burrow', { x: gy.x, z: gy.z, volume: 0.5, pitch: 1.3 });
          }
        }
      } else if (gy.state === 1) {
        if (near && Math.random() < 0.6) g.fx.dust(gy.x, gy.z, 1, 0x8a7a6a, 0.8, 1.2);
        if (gy.timer <= 0) {
          gy.state = 2;
          gy.timer = 1.6;
          if (near) {
            audio.play('geyser', { x: gy.x, z: gy.z });
            g.fx.shake(dist(gy.x, gy.z, p.x, p.z) < 12 ? 0.25 : 0.05);
            if (p.alive && dist(gy.x, gy.z, p.x, p.z) < 2.6) p.hurt(24, gy.x, gy.z, 14, 'geyser');
            g.enemies.forEachInRadius(gy.x, gy.z, 2.6, (e) => {
              g.enemies.damage(e, 60, gy.x, gy.z, 'geyser');
              g.enemies.knock(e, gy.x, gy.z, 12);
            });
          }
        }
      } else {
        if (near) {
          for (let i = 0; i < 3; i++) g.fx.smoke.spawn({ x: gy.x + rand(-0.5, 0.5), y: gy.y + 0.5, z: gy.z + rand(-0.5, 0.5), vx: rand(-1, 1), vy: rand(9, 14), vz: rand(-1, 1), life: rand(0.8, 1.3), size: 0.8, sizeEnd: 2.8, color: 0xe8e0d8, alpha: 0.55, drag: 1.5 });
          if (Math.random() < 0.5) g.fx.glow.spawn({ x: gy.x, y: gy.y + 0.5, z: gy.z, vx: rand(-2, 2), vy: rand(6, 12), vz: rand(-2, 2), life: 0.6, size: 0.25, sizeEnd: 0, color: 0xffd0a0, gravity: 12 });
        }
        if (gy.timer <= 0) {
          gy.state = 0;
          gy.timer = rand(7, 13);
        }
      }
    }
    // ion storm
    this.stormLevel = clamp(this.stormLevel + (this.storm ? dt : -dt) * 0.4, 0, 1);
    if (this.storm) {
      this.stormT += dt;
      this.stormLoop.setVolume(0.6 * Math.min(1, this.stormT / 3) * Math.min(1, (this.stormDur - this.stormT) / 3));
      const wx = Math.cos(this.windA);
      const wz = Math.sin(this.windA);
      for (let i = 0; i < 3; i++) {
        const x = p.x + rand(-26, 26) - wx * 14;
        const z = p.z + rand(-18, 18) - wz * 14;
        g.fx.smoke.spawn({ x, y: g.terrain.heightAt(x, z) + rand(0.2, 3), z, vx: wx * rand(12, 18), vy: rand(-0.5, 0.5), vz: wz * rand(12, 18), life: rand(1.5, 2.2), size: rand(0.25, 0.6), sizeEnd: 0.8, color: 0x9a8070, alpha: 0.28 });
      }
      this.strikeT -= dt;
      if (this.strikeT <= 0 && this.stormT < this.stormDur - 2 && g.state === 'playing') {
        this.strikeT = rand(0.9, 2.1);
        let x = p.x + rand(-14, 14);
        let z = p.z + rand(-10, 10);
        const r = Math.random();
        if (r < 0.45 && p.alive) {
          x = p.x + p.vx * 0.9 + rand(-1.5, 1.5);
          z = p.z + p.vz * 0.9 + rand(-1.5, 1.5);
        } else if (r < 0.65) {
          const e = g.enemies.nearest(p.x, p.z, 22);
          if (e) {
            x = e.x;
            z = e.z;
          }
        }
        this.strikes.push({ x, z, t: 1.15 });
        g.fx.ring(x, z, 3.2, 2.6, 0x9fdcff, 1.15);
        g.fx.lightDecals.add(x, g.terrain.heightAt(x, z) + 0.07, z, 5.5, 0x6ab8ff, 0.5, 1.15);
      }
      if (this.stormT >= this.stormDur) this.endStorm();
    }
    for (const s of this.strikes) {
      s.t -= dt;
      if (Math.random() < 0.3) {
        const y = g.terrain.heightAt(s.x, s.z);
        g.fx.arc(s.x + rand(-1.5, 1.5), y + 0.2, s.z + rand(-1.5, 1.5), s.x, y + 0.2, s.z, 0x9fdcff, 0.04, 0.08, 0.3);
      }
      if (s.t <= 0) this.strike(s.x, s.z);
    }
    this.strikes = this.strikes.filter((s) => s.t > 0);
  }

  private strike(x: number, z: number): void {
    const g = this.game;
    const p = g.player;
    const y = g.terrain.heightAt(x, z);
    g.fx.arc(x + rand(-4, 4), y + 45, z + rand(-4, 4), x, y, z, 0xcfe8ff, 0.5, 0.25, 2.5);
    g.fx.arc(x + rand(-3, 3), y + 40, z + rand(-3, 3), x, y, z, 0xffffff, 0.18, 0.2, 1.5);
    g.fx.flash(x, y + 6, z, 0xbfe0ff, 120, 40, 0.3);
    g.fx.sparks(x, y + 0.3, z, 0xcfe8ff, 26, 10, 0.5);
    g.fx.ring(x, z, 0.4, 4, 0xcfe8ff, 0.35);
    g.fx.splats.add(x, y + 0.04, z, 3.4, 0x0a0a0a, 0.8, 40);
    g.fx.shake(dist(x, z, p.x, p.z) < 10 ? 0.45 : 0.15);
    g.hud.lightningFlash();
    audio.play('lightning', { x, z });
    if (p.alive && dist(x, z, p.x, p.z) < 2.6) p.hurt(32, x, z, 10, 'lightning');
    g.enemies.forEachInRadius(x, z, 2.8, (e) => g.enemies.damage(e, 80, x, z, 'lightning'));
    g.structures.damageRadius(x, z, 2.6, 40);
  }
}

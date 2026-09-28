import { EnemyKind, PartId } from '../config';
import { dist, pick, rand, TAU } from '../core/math';
import { audio } from '../audio/audio';
import { B_ASH, B_CRYSTAL, B_FUNGAL, B_HIVE, B_MARSH, B_RUST, BiomeId } from '../world/terrain';
import { WREN } from '../story';
import type { Game } from '../game';
import type { EnemyMode } from '../entities/enemies';

const DIR_NAMES = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
export const dirName = (a: number): string => {
  // a = atan2(z, x); screen-up is -Z (north)
  const idx = Math.round(((a + TAU) % TAU) / (TAU / 8)) % 8;
  return DIR_NAMES[idx];
};

/** Decides what hunts the player and when: ambient packs, guards, night sieges and the launch finale. */
export class Director {
  threat = 1;
  private ambientT = 35;
  private nightPulses: number[] = [];
  private nightBudget = 0;
  private waveDirs: number[] = [];
  private nightHunterT = 0;
  private launchT = 0;
  private guarded = new Set<string>();
  private stormChecked = -1;
  private bossSpawned = false;
  nightNumber = 0;

  constructor(private game: Game) {}

  reset(): void {
    this.threat = 1;
    this.ambientT = 40;
    this.nightPulses = [];
    this.waveDirs = [];
    this.guarded.clear();
    this.stormChecked = -1;
    this.bossSpawned = false;
    this.nightNumber = 0;
  }

  computeThreat(): number {
    const g = this.game;
    this.threat = 1 + g.playTime / 240 + g.ship.installed.length * 0.7 + (g.cycle.day - 1) * 0.5;
    return this.threat;
  }

  /** Finds a walkable point roughly `d` metres from (cx, cz) in direction `a`. */
  private spot(cx: number, cz: number, a: number, d: number, jitter = 0.5): { x: number; z: number } | null {
    const g = this.game;
    for (let i = 0; i < 12; i++) {
      const aa = a + rand(-jitter, jitter);
      const dd = d + rand(-4, 4);
      const x = cx + Math.cos(aa) * dd;
      const z = cz + Math.sin(aa) * dd;
      if (Math.hypot(x, z) > 184) continue;
      if (g.flowShip.blocked[g.flowShip.idx(x, z)]) continue;
      if (g.hazards.inPool(x, z)) continue;
      return { x, z };
    }
    return null;
  }

  private packFor(biome: BiomeId, budget: number): EnemyKind[] {
    const t = this.threat;
    const out: EnemyKind[] = [];
    const table: Record<BiomeId, [EnemyKind, number][]> = {
      [B_ASH]: [['skitter', 1]],
      [B_RUST]: [['skitter', 1], ['spitter', t > 1.5 ? 0.35 : 0], ['brute', t > 2 ? 0.12 : 0], ['burrower', t > 3 ? 0.12 : 0]],
      [B_MARSH]: [['skitter', 0.7], ['spitter', 0.7], ['floater', 0.15]],
      [B_CRYSTAL]: [['skitter', 1], ['brute', t > 1.6 ? 0.22 : 0.05], ['burrower', t > 2.5 ? 0.2 : 0]],
      [B_FUNGAL]: [['skitter', 0.8], ['floater', 0.6], ['spitter', 0.2]],
      [B_HIVE]: [['skitter', 1], ['spitter', 0.35], ['burrower', 0.2], ['brute', t > 2.5 ? 0.12 : 0.04]],
    };
    const list = table[biome];
    let total = 0;
    for (const [, w] of list) total += w;
    let b = budget;
    let guard = 0;
    while (b > 0 && guard++ < 60) {
      let r = rand(0, total);
      let kind: EnemyKind = 'skitter';
      for (const [k, w] of list) {
        r -= w;
        if (r <= 0) {
          kind = k;
          break;
        }
      }
      const cost = kind === 'skitter' ? 1 : kind === 'spitter' ? 3 : kind === 'brute' ? 9 : kind === 'burrower' ? 5 : 2;
      if (cost > b + 1) {
        if (b >= 1) {
          out.push('skitter');
          b -= 1;
        }
        continue;
      }
      out.push(kind);
      b -= cost;
    }
    return out;
  }

  spawnPack(kinds: EnemyKind[], x: number, z: number, mode: EnemyMode, opts: { night?: boolean; aggro?: boolean; eliteChance?: number; homeX?: number; homeZ?: number } = {}): void {
    const g = this.game;
    for (const k of kinds) {
      if (g.enemies.count > 300) return;
      const a = rand(0, TAU);
      const r = rand(0, 3.5);
      const e = g.enemies.spawn(k, x + Math.cos(a) * r, z + Math.sin(a) * r, mode, { emerge: true, night: opts.night, aggro: opts.aggro, elite: Math.random() < (opts.eliteChance ?? 0) });
      if (opts.homeX !== undefined && opts.homeZ !== undefined) {
        e.homeX = opts.homeX + rand(-3, 3);
        e.homeZ = opts.homeZ + rand(-3, 3);
      }
    }
  }

  update(dt: number): void {
    const g = this.game;
    this.computeThreat();
    const p = g.player;
    const night = g.cycle.phase === 'night';

    // --- guards at points of interest (spawned lazily as the player approaches) --------------------------
    for (const part of g.layout.parts) {
      const key = `part-${part.id}`;
      if (this.guarded.has(key) || g.partState[part.id] !== 'field') continue;
      if (dist(p.x, p.z, part.x, part.z) < 62) {
        this.guarded.add(key);
        this.spawnGuards(part.id, part.x, part.z);
      }
    }
    // boss
    if (!this.bossSpawned && g.partState.reactor === 'field' && p.alive) {
      const a = g.layout.arena;
      if (dist(p.x, p.z, a.x, a.z) < 21) {
        this.bossSpawned = true;
        g.onBossAppear(a.x, a.z);
      }
    }
    for (let i = 0; i < g.layout.wrecks.length; i++) {
      const w = g.layout.wrecks[i];
      const key = `wreck-${i}`;
      if (this.guarded.has(key) || i === 0) continue;
      if (dist(p.x, p.z, w.x, w.z) < 45) {
        this.guarded.add(key);
        const biome = g.terrain.biomeAt(w.x, w.z);
        const pack = this.packFor(biome, 3 + this.threat * 1.5);
        const s = this.spot(w.x, w.z, rand(0, TAU), 6, Math.PI);
        if (s) this.spawnPack(pack, s.x, s.z, 'guard');
      }
    }

    if (g.launching) {
      this.launchUpdate(dt);
      return;
    }

    // --- storms: at most one per day, more likely later ------------------------------------------------------
    if (g.cycle.phase === 'day' && this.stormChecked !== g.cycle.day && g.cycle.progress > 0.35) {
      this.stormChecked = g.cycle.day;
      if (g.cycle.day >= 2 && Math.random() < 0.45 + g.cycle.day * 0.08) g.hazards.startStorm(rand(40, 60));
    }

    // --- daytime ambient packs ------------------------------------------------------------------------------
    if (!night && g.cycle.phase !== 'dawn' && p.alive) {
      this.ambientT -= dt;
      const shipD = dist(p.x, p.z, g.ship.x, g.ship.z);
      if (this.ambientT <= 0) {
        this.ambientT = rand(15, 25) / (1 + this.threat * 0.12);
        if (shipD > 34 && g.enemies.count < 45) {
          const a = rand(0, TAU);
          const s = this.spot(p.x, p.z, a, 40);
          if (s && dist(s.x, s.z, g.ship.x, g.ship.z) > 30) {
            const biome = g.terrain.biomeAt(s.x, s.z);
            const pack = this.packFor(biome, 2 + this.threat * 1.6 + rand(0, 2));
            this.spawnPack(pack, s.x, s.z, 'hunt', { homeX: p.x, homeZ: p.z, eliteChance: this.threat > 4 ? 0.1 : 0 });
          }
        }
      }
    }

    // --- night siege --------------------------------------------------------------------------------------
    if (night) {
      const t = g.cycle.t;
      while (this.nightPulses.length && this.nightPulses[0] <= t) {
        this.nightPulses.shift();
        this.pulse(this.nightBudget / 5, true);
      }
      // anyone caught far from the ship at night is hunted
      this.nightHunterT -= dt;
      if (this.nightHunterT <= 0 && p.alive) {
        this.nightHunterT = 11;
        const shipD = dist(p.x, p.z, g.ship.x, g.ship.z);
        if (shipD > 45 && g.enemies.count < 120) {
          const s = this.spot(p.x, p.z, rand(0, TAU), 30);
          if (s) this.spawnPack(this.packFor(g.terrain.biomeAt(s.x, s.z), 3 + this.threat * 1.4), s.x, s.z, 'hunt', { night: true, aggro: true });
        }
      }
    }
  }

  private spawnGuards(id: PartId, x: number, z: number): void {
    const t = this.threat;
    const kinds: EnemyKind[] =
      id === 'coil'
        ? ['spitter', 'spitter', 'spitter', 'skitter', 'skitter', 'skitter', 'skitter']
        : id === 'cell'
          ? ['brute', 'skitter', 'skitter', 'skitter', 'skitter', 'burrower', 'burrower']
          : id === 'nav'
            ? ['floater', 'floater', 'floater', 'floater', 'skitter', 'skitter', 'skitter', 'spitter', 'spitter']
            : [];
    const extra = Math.floor(t);
    for (let i = 0; i < extra; i++) kinds.push(i % 3 === 2 ? 'spitter' : 'skitter');
    for (let i = 0; i < kinds.length; i++) {
      const a = (i / kinds.length) * TAU + rand(-0.2, 0.2);
      const r = rand(4, 9);
      const s = this.spot(x, z, a, r, 0.3);
      if (!s) continue;
      const e = this.game.enemies.spawn(kinds[i], s.x, s.z, 'guard', { elite: kinds[i] === 'brute' && t > 3 });
      e.homeX = x;
      e.homeZ = z;
    }
  }

  onNightfall(): void {
    const g = this.game;
    this.nightNumber++;
    const n = this.nightNumber;
    this.nightBudget = (20 + 17 * (n - 1) + 9 * g.ship.installed.length) * g.difficulty.waveBudget;
    const dirs = n === 1 ? 1 : n <= 3 ? 2 : 3;
    const base = rand(0, TAU);
    this.waveDirs = [];
    for (let i = 0; i < dirs; i++) this.waveDirs.push(base + (i * TAU) / dirs + rand(-0.4, 0.4));
    this.nightPulses = [4, 18, 34, 50, 66];
    this.nightHunterT = 20;
    const names = this.waveDirs.map((a) => dirName(a)).join(', ');
    g.messages.comms('WREN', `${pick(WREN.nightfall)} Contacts massing to the ${names}.`, 'warn');
    for (const a of this.waveDirs) g.hud.ping(a);
  }

  onDawn(): void {
    this.nightPulses = [];
  }

  private pulse(budget: number, night: boolean): void {
    const g = this.game;
    for (const a of this.waveDirs) {
      const s = this.spot(g.ship.x, g.ship.z, a, 48, 0.35);
      if (!s) continue;
      const kinds = this.nightPack(budget / this.waveDirs.length);
      this.spawnPack(kinds, s.x, s.z, 'siege', { night, eliteChance: this.nightNumber >= 3 ? 0.08 : 0 });
    }
    audio.play('nestSpawn', { volume: 0.4, pitch: 0.7 });
  }

  private nightPack(budget: number): EnemyKind[] {
    const n = this.nightNumber;
    const out: EnemyKind[] = [];
    let b = budget;
    while (b > 0) {
      const r = Math.random();
      if (n >= 2 && r < 0.1 && b >= 9) {
        out.push('brute');
        b -= 9;
      } else if (n >= 3 && r < 0.2 && b >= 5) {
        out.push('burrower');
        b -= 5;
      } else if (r < 0.38 && b >= 3) {
        out.push('spitter');
        b -= 3;
      } else if (n >= 2 && r < 0.46 && b >= 2) {
        out.push('floater');
        b -= 2;
      } else {
        out.push('skitter');
        b -= 1;
      }
    }
    return out;
  }

  startLaunch(): void {
    this.launchT = 0;
    const base = rand(0, TAU);
    this.waveDirs = [0, 1, 2, 3].map((i) => base + (i * TAU) / 4 + rand(-0.3, 0.3));
    for (const a of this.waveDirs) this.game.hud.ping(a);
  }

  private launchUpdate(dt: number): void {
    const g = this.game;
    this.launchT += dt;
    const prev = Math.floor((this.launchT - dt) / 7);
    const cur = Math.floor(this.launchT / 7);
    if (cur !== prev && this.launchT < 70 && g.enemies.count < 110) {
      const n = Math.max(this.nightNumber, 2) + 1;
      this.nightNumber = n;
      this.pulse((10 + cur * 2.2) * g.difficulty.waveBudget, true);
      this.nightNumber = n - 1;
    }
  }
}

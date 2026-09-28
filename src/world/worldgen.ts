import { Rng } from '../core/rng';
import { dist, len } from '../core/math';
import { PARTS, PartId, WORLD } from '../config';
import { B_ASH, B_CRYSTAL, B_FUNGAL, B_HIVE, B_MARSH, B_RUST, BiomeId, SECTORS, Terrain } from './terrain';

export type ObstacleKind = 'rock' | 'spire' | 'mushroom' | 'pillar' | 'wreck' | 'ship' | 'node' | 'structure' | 'crate';

export interface Obstacle {
  id: number;
  x: number;
  z: number;
  r: number;
  kind: ObstacleKind;
  biome: BiomeId;
  alive: boolean;
  /** Optional link back to the owning object (e.g. a resource node index). */
  ref: number;
  /** Query de-duplication stamp (owned by StaticGrid). */
  mark?: number;
}

export interface ResourceSpawn {
  x: number;
  z: number;
  kind: 'xenite' | 'ore';
  scale: number;
  rot: number;
}

export interface DecorSpawn {
  kind: string;
  x: number;
  z: number;
  rot: number;
  scale: number;
  biome: BiomeId;
  tilt?: number;
}

export interface WreckSpawn {
  x: number;
  z: number;
  rot: number;
  log: number;
  blueprint: 'nova' | 'seeker' | null;
}

export interface WorldLayout {
  seed: number;
  terrain: Terrain;
  obstacles: Obstacle[];
  resources: ResourceSpawn[];
  bulbs: { x: number; z: number }[];
  pods: { x: number; z: number }[];
  pools: { x: number; z: number; r: number }[];
  geysers: { x: number; z: number }[];
  wrecks: WreckSpawn[];
  nests: { x: number; z: number }[];
  parts: { id: PartId; x: number; z: number }[];
  debris: { x: number; z: number }[];
  crates: { x: number; z: number; rot: number }[];
  decor: DecorSpawn[];
  arena: { x: number; z: number; r: number };
  shipRot: number;
}

interface Feature {
  x: number;
  z: number;
  r: number;
}

const PART_ORDER: { id: PartId; biome: BiomeId }[] = [
  { id: 'coil', biome: B_MARSH },
  { id: 'cell', biome: B_CRYSTAL },
  { id: 'nav', biome: B_FUNGAL },
  { id: 'reactor', biome: B_HIVE },
];

export function generateWorld(seed: number): WorldLayout {
  const rng = new Rng(seed);
  const terrain = new Terrain(seed);
  const features: Feature[] = [];
  const blocked = (x: number, z: number, r: number, pad = 0): boolean => {
    for (const f of features) if (dist(x, z, f.x, f.z) < f.r + r + pad) return true;
    return false;
  };
  const inWorld = (x: number, z: number, margin: number) => len(x, z) < WORLD.radius - margin;

  // --- crash site -----------------------------------------------------------------------------------
  const shipRot = rng.range(0, Math.PI * 2);
  terrain.addModifier({ x: 0, z: 0, r: 11, kind: 'crater', depth: 1.7 });
  // skid trench behind the ship
  const tdx = -Math.sin(shipRot);
  const tdz = -Math.cos(shipRot);
  for (let i = 1; i < 7; i++) terrain.addModifier({ x: tdx * i * 5.5, z: tdz * i * 5.5, r: 3.4, kind: 'crater', depth: 0.7 - i * 0.07 });
  features.push({ x: 0, z: 0, r: WORLD.shipClearRadius });

  // --- ship part sites --------------------------------------------------------------------------------
  const parts: WorldLayout['parts'] = [];
  let arena = { x: 0, z: 0, r: 24 };
  for (const po of PART_ORDER) {
    const sector = SECTORS.find((s) => s.biome === po.biome)!;
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 60; tries++) {
      const a = sector.angle + rng.range(-0.28, 0.28);
      const d = po.id === 'reactor' ? rng.range(136, 150) : rng.range(116, 146);
      x = Math.cos(a) * d;
      z = Math.sin(a) * d;
      if (terrain.biomeAt(x, z) === po.biome) break;
    }
    parts.push({ id: po.id, x, z });
    const h = terrain.sampleRaw(x, z);
    if (po.id === 'reactor') {
      arena = { x, z, r: 25 };
      terrain.addModifier({ x, z, r: 25, kind: 'flatten', depth: h - 0.3 });
      features.push({ x, z, r: 25 });
    } else {
      terrain.addModifier({ x, z, r: 8, kind: 'flatten', depth: h });
      features.push({ x, z, r: 8 });
    }
  }

  // --- wrecks of previous expeditions (lore + loot) --------------------------------------------------
  const wrecks: WreckSpawn[] = [];
  const wreckRings: [number, number, BiomeId | -1][] = [
    [34, 60, -1],
    [55, 90, B_RUST],
    [80, 130, B_MARSH],
    [80, 130, B_CRYSTAL],
    [85, 140, B_FUNGAL],
    [95, 165, B_RUST],
    [110, 170, B_HIVE],
    [140, 175, -1],
  ];
  for (let i = 0; i < wreckRings.length; i++) {
    const [r0, r1, biome] = wreckRings[i];
    for (let tries = 0; tries < 200; tries++) {
      const a = rng.range(-Math.PI, Math.PI);
      const d = rng.range(r0, r1);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (!inWorld(x, z, 12)) continue;
      if (biome !== -1 && terrain.biomeAt(x, z) !== biome && tries < 150) continue;
      if (blocked(x, z, 7, 6)) continue;
      const h = terrain.sampleRaw(x, z);
      terrain.addModifier({ x, z, r: 6, kind: 'flatten', depth: h });
      features.push({ x, z, r: 7 });
      wrecks.push({ x, z, rot: rng.range(0, Math.PI * 2), log: i, blueprint: null });
      break;
    }
  }
  // blueprints for alternative secondary weapons
  if (wrecks[2]) wrecks[2].blueprint = 'nova';
  if (wrecks[5]) wrecks[5].blueprint = 'seeker';

  // --- acid pools (marsh) -----------------------------------------------------------------------------
  const pools: WorldLayout['pools'] = [];
  for (let tries = 0; tries < 900 && pools.length < 22; tries++) {
    const x = rng.range(-WORLD.radius, WORLD.radius);
    const z = rng.range(-WORLD.radius, WORLD.radius);
    const d = len(x, z);
    if (d < 62 || !inWorld(x, z, 14)) continue;
    const b = terrain.biomeAt(x, z);
    if (b !== B_MARSH) continue;
    const r = rng.range(2.6, 6.2);
    if (blocked(x, z, r, 3)) continue;
    let near = false;
    for (const p of pools) if (dist(x, z, p.x, p.z) < p.r + r + 3.5) near = true;
    if (near) continue;
    pools.push({ x, z, r });
    terrain.addModifier({ x, z, r, kind: 'pool', depth: 0.9 });
    features.push({ x, z, r: r + 0.6 });
  }

  // --- nests -------------------------------------------------------------------------------------------
  const nests: WorldLayout['nests'] = [];
  const nestQuota: [BiomeId, number][] = [
    [B_HIVE, 9],
    [B_MARSH, 3],
    [B_FUNGAL, 3],
    [B_CRYSTAL, 2],
  ];
  for (const [biome, count] of nestQuota) {
    let placed = 0;
    for (let tries = 0; tries < 800 && placed < count; tries++) {
      const x = rng.range(-WORLD.radius, WORLD.radius);
      const z = rng.range(-WORLD.radius, WORLD.radius);
      const d = len(x, z);
      if (d < 78 || !inWorld(x, z, 10)) continue;
      if (terrain.biomeAt(x, z) !== biome) continue;
      if (blocked(x, z, 3, 8)) continue;
      let near = false;
      for (const n of nests) if (dist(x, z, n.x, n.z) < 22) near = true;
      if (near) continue;
      nests.push({ x, z });
      features.push({ x, z, r: 3.5 });
      placed++;
    }
  }

  // --- geysers -----------------------------------------------------------------------------------------
  const geysers: WorldLayout['geysers'] = [];
  for (let tries = 0; tries < 600 && geysers.length < 13; tries++) {
    const x = rng.range(-WORLD.radius, WORLD.radius);
    const z = rng.range(-WORLD.radius, WORLD.radius);
    if (len(x, z) < 40 || !inWorld(x, z, 10)) continue;
    const b = terrain.biomeAt(x, z);
    if (b !== B_CRYSTAL && b !== B_RUST) continue;
    if (blocked(x, z, 2, 4)) continue;
    geysers.push({ x, z });
    features.push({ x, z, r: 2.2 });
  }

  terrain.build();

  // --- obstacles ---------------------------------------------------------------------------------------
  const obstacles: Obstacle[] = [];
  const addObstacle = (x: number, z: number, r: number, kind: ObstacleKind, ref = -1): Obstacle => {
    const o: Obstacle = { id: obstacles.length, x, z, r, kind, biome: terrain.biomeAt(x, z), alive: true, ref };
    obstacles.push(o);
    return o;
  };
  // the ship hull (three circles along its axis)
  const sx = Math.sin(shipRot);
  const sz = Math.cos(shipRot);
  addObstacle(sx * 2.8, sz * 2.8, 1.9, 'ship');
  addObstacle(0, 0, 2.2, 'ship');
  addObstacle(-sx * 2.9, -sz * 2.9, 2.1, 'ship');
  for (const w of wrecks) addObstacle(w.x, w.z, 2.2, 'wreck');

  const decor: DecorSpawn[] = [];
  const clusterAttempts = 780;
  for (let c = 0; c < clusterAttempts; c++) {
    const a = rng.range(-Math.PI, Math.PI);
    const d = Math.sqrt(rng.next()) * (WORLD.radius + 6);
    const cx = Math.cos(a) * d;
    const cz = Math.sin(a) * d;
    if (d < 20) continue;
    const b = terrain.biomeAt(cx, cz);
    const density = [0.3, 0.75, 0.35, 0.7, 0.8, 0.6][b];
    if (!rng.chance(density)) continue;
    let kind: ObstacleKind = 'rock';
    let count = 1;
    let rMin = 1;
    let rMax = 2;
    let spread = 3;
    switch (b) {
      case B_ASH:
        count = rng.int(1, 3);
        rMin = 0.7;
        rMax = 1.8;
        spread = 3;
        break;
      case B_RUST:
        count = rng.int(2, 7);
        rMin = 1.1;
        rMax = 3.8;
        spread = 5;
        break;
      case B_MARSH:
        count = rng.int(1, 2);
        rMin = 0.9;
        rMax = 2.1;
        spread = 3;
        break;
      case B_CRYSTAL:
        kind = 'spire';
        count = rng.int(1, 5);
        rMin = 0.8;
        rMax = 1.7;
        spread = 4.5;
        break;
      case B_FUNGAL:
        kind = 'mushroom';
        count = rng.int(1, 4);
        rMin = 0.45;
        rMax = 0.75;
        spread = 5;
        break;
      case B_HIVE:
        kind = 'pillar';
        count = rng.int(1, 4);
        rMin = 0.8;
        rMax = 1.6;
        spread = 4;
        break;
    }
    for (let i = 0; i < count; i++) {
      const x = cx + rng.range(-spread, spread);
      const z = cz + rng.range(-spread, spread);
      const r = rng.range(rMin, rMax);
      if (len(x, z) > WORLD.radius + 8) continue;
      if (blocked(x, z, r, 2.5)) continue;
      addObstacle(x, z, r, kind);
    }
  }
  // boss arena pillars: cover to bait the matriarch's charge into
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const d = rng.range(11, 16);
    addObstacle(arena.x + Math.cos(a) * d, arena.z + Math.sin(a) * d, rng.range(1.4, 2.0), 'pillar');
  }

  const clearOfObstacles = (x: number, z: number, r: number): boolean => {
    for (const o of obstacles) if (dist(x, z, o.x, o.z) < o.r + r) return false;
    return true;
  };

  // --- resource nodes ---------------------------------------------------------------------------------
  const resources: ResourceSpawn[] = [];
  const placeResource = (kind: 'xenite' | 'ore', weights: number[], target: number, minR: number) => {
    let placed = 0;
    for (let tries = 0; tries < target * 60 && placed < target; tries++) {
      const a = rng.range(-Math.PI, Math.PI);
      const d = rng.range(minR, WORLD.radius - 8);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const b = terrain.biomeAt(x, z);
      if (!rng.chance(weights[b])) continue;
      if (blocked(x, z, 1.5, 1.5) || !clearOfObstacles(x, z, 2.2)) continue;
      let near = false;
      for (const r of resources) if (dist(x, z, r.x, r.z) < 9) near = true;
      if (near) continue;
      resources.push({ x, z, kind, scale: rng.range(0.85, 1.25), rot: rng.range(0, Math.PI * 2) });
      placed++;
    }
  };
  // a couple of guaranteed nodes near the crash so the first minutes are productive
  for (let i = 0; i < 4; i++) {
    const kind: 'xenite' | 'ore' = i % 2 ? 'xenite' : 'ore';
    for (let tries = 0; tries < 100; tries++) {
      const a = rng.range(-Math.PI, Math.PI);
      const d = rng.range(20, 34);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (!clearOfObstacles(x, z, 2.5) || blocked(x, z, 1.5, 0)) continue;
      let near = false;
      for (const r of resources) if (dist(x, z, r.x, r.z) < 10) near = true;
      if (near) continue;
      resources.push({ x, z, kind, scale: 1, rot: rng.range(0, Math.PI * 2) });
      break;
    }
  }
  placeResource('xenite', [0.15, 0.3, 0.45, 1, 0.5, 0.5], 64, 34);
  placeResource('ore', [0.6, 1, 0.35, 0.3, 0.3, 0.3], 46, 26);
  for (let i = 0; i < resources.length; i++) {
    const r = resources[i];
    addObstacle(r.x, r.z, r.kind === 'xenite' ? 1.05 * r.scale : 1.15 * r.scale, 'node', i);
  }

  // --- flora: O2 bulbs and healing pods ---------------------------------------------------------------
  const bulbs: WorldLayout['bulbs'] = [];
  const pods: WorldLayout['pods'] = [];
  const freeSpot = (x: number, z: number, r: number) => clearOfObstacles(x, z, r) && !blocked(x, z, r, 0.5);
  // guaranteed breadcrumbs of air along the route to every part
  for (const p of parts) {
    const pd = len(p.x, p.z);
    for (const t of [0.33, 0.55, 0.78, 0.95]) {
      for (let tries = 0; tries < 40; tries++) {
        const off = rng.range(-7, 7);
        const nx = -p.z / pd;
        const nz = p.x / pd;
        const x = p.x * t + nx * off + rng.range(-3, 3);
        const z = p.z * t + nz * off + rng.range(-3, 3);
        if (!freeSpot(x, z, 1.2)) continue;
        bulbs.push({ x, z });
        break;
      }
    }
  }
  const bulbWeights = [0.0, 0.5, 0.7, 0.55, 1, 0.5];
  for (let tries = 0; tries < 4000 && bulbs.length < 96; tries++) {
    const a = rng.range(-Math.PI, Math.PI);
    const d = rng.range(30, WORLD.radius - 6);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!rng.chance(bulbWeights[terrain.biomeAt(x, z)])) continue;
    if (!freeSpot(x, z, 1.2)) continue;
    let near = false;
    for (const q of bulbs) if (dist(x, z, q.x, q.z) < 11) near = true;
    if (near) continue;
    bulbs.push({ x, z });
  }
  for (let tries = 0; tries < 2000 && pods.length < 30; tries++) {
    const a = rng.range(-Math.PI, Math.PI);
    const d = rng.range(28, WORLD.radius - 6);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (terrain.biomeAt(x, z) === B_ASH) continue;
    if (!freeSpot(x, z, 1)) continue;
    let near = false;
    for (const q of pods) if (dist(x, z, q.x, q.z) < 18) near = true;
    if (near) continue;
    pods.push({ x, z });
  }

  // --- crash debris: scrap bits and supply crates ------------------------------------------------------
  const debris: WorldLayout['debris'] = [];
  const crates: WorldLayout['crates'] = [];
  for (let i = 0; i < 26; i++) {
    const t = rng.range(6, 44);
    const x = tdx * t + rng.range(-7, 7) * (0.4 + t / 44);
    const z = tdz * t + rng.range(-7, 7) * (0.4 + t / 44);
    if (!clearOfObstacles(x, z, 0.6)) continue;
    debris.push({ x, z });
  }
  for (let i = 0; i < 5; i++) {
    for (let tries = 0; tries < 40; tries++) {
      const a = rng.range(-Math.PI, Math.PI);
      const d = rng.range(9, 26);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (!clearOfObstacles(x, z, 1.2)) continue;
      crates.push({ x, z, rot: rng.range(0, Math.PI * 2) });
      break;
    }
  }

  // --- decoration ----------------------------------------------------------------------------------------
  const decorKinds: Record<BiomeId, [string, number][]> = {
    [B_ASH]: [['pebble', 1], ['tuft', 0.6]],
    [B_RUST]: [['pebble', 1], ['tuft', 1]],
    [B_MARSH]: [['reed', 1.2], ['tuft', 0.8], ['pebble', 0.3]],
    [B_CRYSTAL]: [['shardling', 1], ['pebble', 0.8]],
    [B_FUNGAL]: [['shroomlet', 1.3], ['tuft', 0.5]],
    [B_HIVE]: [['tendril', 1], ['pebble', 0.4]],
  };
  for (let i = 0; i < 5200; i++) {
    const a = rng.range(-Math.PI, Math.PI);
    const d = Math.sqrt(rng.next()) * (WORLD.radius + 18);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (len(x, z) < 7) continue;
    const b = terrain.biomeAt(x, z);
    const list = decorKinds[b];
    let total = 0;
    for (const [, w] of list) total += w;
    let pickW = rng.next() * total;
    let kind = list[0][0];
    for (const [k, w] of list) {
      pickW -= w;
      if (pickW <= 0) {
        kind = k;
        break;
      }
    }
    let onPool = false;
    for (const p of pools) if (dist(x, z, p.x, p.z) < p.r + 0.4) onPool = true;
    if (onPool) continue;
    if (!clearOfObstacles(x, z, 0.3)) continue;
    decor.push({ kind, x, z, rot: rng.range(0, Math.PI * 2), scale: rng.range(0.7, 1.35), biome: b, tilt: rng.range(-0.15, 0.15) });
  }
  // fossil landmarks
  for (let i = 0, placed = 0; i < 200 && placed < 4; i++) {
    const a = rng.range(-Math.PI, Math.PI);
    const d = rng.range(45, 160);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!clearOfObstacles(x, z, 7) || blocked(x, z, 7, 2)) continue;
    decor.push({ kind: 'ribcage', x, z, rot: rng.range(0, Math.PI * 2), scale: rng.range(0.9, 1.3), biome: terrain.biomeAt(x, z) });
    features.push({ x, z, r: 7 });
    placed++;
  }

  return {
    seed,
    terrain,
    obstacles,
    resources,
    bulbs,
    pods,
    pools,
    geysers,
    wrecks,
    nests,
    parts,
    debris,
    crates,
    decor,
    arena,
    shipRot,
  };
}

export const partName = (id: PartId) => PARTS[id].name;

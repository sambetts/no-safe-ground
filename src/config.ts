// Central tuning for NO SAFE GROUND. Distances are metres (world units), times are seconds.

export const WORLD = {
  radius: 188, // playable radius around the crash site
  terrainSize: 470, // terrain mesh extent (square), extends into the boundary mountains
  terrainCell: 2, // metres per terrain quad
  shipClearRadius: 16,
};

export const CYCLE = {
  firstDay: 170,
  day: 140,
  dusk: 22,
  night: 105,
  dawn: 14,
};

export type DifficultyId = 'explorer' | 'survivor' | 'nightmare';

export interface Difficulty {
  id: DifficultyId;
  name: string;
  blurb: string;
  lives: number;
  enemyHp: number;
  enemyDmg: number;
  o2Drain: number;
  waveBudget: number;
  resourceMult: number;
}

export const DIFFICULTIES: Record<DifficultyId, Difficulty> = {
  explorer: {
    id: 'explorer',
    name: 'Explorer',
    blurb: 'Forgiving. Five reconstructions, gentler creatures, deeper air tanks.',
    lives: 5,
    enemyHp: 0.8,
    enemyDmg: 0.6,
    o2Drain: 0.75,
    waveBudget: 0.7,
    resourceMult: 1.25,
  },
  survivor: {
    id: 'survivor',
    name: 'Survivor',
    blurb: 'The intended experience. Three reconstructions. Kessra is not kind.',
    lives: 3,
    enemyHp: 1,
    enemyDmg: 1,
    o2Drain: 1,
    waveBudget: 1,
    resourceMult: 1,
  },
  nightmare: {
    id: 'nightmare',
    name: 'Nightmare',
    blurb: 'One life. Relentless nights. For those who have already escaped once.',
    lives: 1,
    enemyHp: 1.3,
    enemyDmg: 1.35,
    o2Drain: 1.2,
    waveBudget: 1.45,
    resourceMult: 0.9,
  },
};

export const PLAYER = {
  radius: 0.5,
  maxHp: 100,
  o2Seconds: 80,
  speed: 7.2,
  accel: 60,
  dashSpeed: 30,
  dashTime: 0.17,
  dashCooldown: 1.1,
  magnet: 3.2,
  shipRegen: 6, // hp/s while inside ship field
  o2Refill: 0.35, // fraction of tank per second while in breathable air
  suffocateDps: 9,
  iframes: 0.55,
  carrySpeedMult: 0.85,
};

export const BLASTER = {
  damage: 11,
  fireRate: 6.5,
  speed: 46,
  range: 27,
  heatPerShot: 0.075,
  coolRate: 0.55,
  overheatLock: 1.35,
  spread: 0.035,
};

export const GRENADE = {
  damage: 70,
  radius: 4.2,
  cooldown: 5.5,
  range: 15,
  flight: 0.6,
};

export const SHIP = {
  hull: 900,
  safeRadius: 9.5,
  interactRadius: 6,
  cannonDamage: 7,
  cannonRate: 2.2,
  cannonRange: 17,
  dayRepair: 3, // hull per second during the day
  launchTime: 75,
};

export interface EnemyStats {
  hp: number;
  speed: number;
  radius: number;
  damage: number;
  xenite: number; // shards dropped
  cost: number; // threat points for the director
  mass: number;
}

export type EnemyKind = 'skitter' | 'spitter' | 'brute' | 'burrower' | 'floater' | 'nest' | 'matriarch';

export const ENEMY: Record<EnemyKind, EnemyStats> = {
  skitter: { hp: 22, speed: 7.3, radius: 0.5, damage: 8, xenite: 1, cost: 1, mass: 1 },
  spitter: { hp: 38, speed: 4.2, radius: 0.7, damage: 13, xenite: 2, cost: 3, mass: 1.6 },
  brute: { hp: 210, speed: 3.6, radius: 1.35, damage: 30, xenite: 7, cost: 9, mass: 8 },
  burrower: { hp: 70, speed: 6.4, radius: 0.8, damage: 22, xenite: 4, cost: 5, mass: 2.5 },
  floater: { hp: 30, speed: 2.8, radius: 0.8, damage: 0, xenite: 2, cost: 2, mass: 0.6 },
  nest: { hp: 420, speed: 0, radius: 2.1, damage: 0, xenite: 18, cost: 0, mass: 999 },
  matriarch: { hp: 3400, speed: 4.2, radius: 3.6, damage: 35, xenite: 60, cost: 0, mass: 60 },
};

export type StructureKind = 'turret' | 'wall' | 'lamp' | 'beacon' | 'tesla';

export interface StructureDef {
  kind: StructureKind;
  name: string;
  key: string;
  scrap: number;
  xenite: number;
  hp: number;
  radius: number;
  desc: string;
  max?: number;
}

export const STRUCTURES: StructureDef[] = [
  { kind: 'turret', name: 'Sentry Turret', key: '1', scrap: 40, xenite: 0, hp: 170, radius: 0.9, desc: 'Auto-targets creatures within 15m.' },
  { kind: 'wall', name: 'Barricade', key: '2', scrap: 8, xenite: 0, hp: 280, radius: 1.05, desc: 'Blocks and redirects the swarm.' },
  { kind: 'lamp', name: 'Flood Lamp', key: '3', scrap: 20, xenite: 0, hp: 110, radius: 0.6, desc: 'Floods 11m with light. Night-crawlers slow and burn in it.' },
  { kind: 'beacon', name: 'O2 Beacon', key: '4', scrap: 45, xenite: 12, hp: 150, radius: 0.8, desc: 'Breathable air field (7m). Build forward outposts.', max: 4 },
  { kind: 'tesla', name: 'Tesla Coil', key: '5', scrap: 70, xenite: 25, hp: 200, radius: 0.9, desc: 'Arcs lightning through up to 4 creatures.' },
];

export const STRUCTURE_STATS = {
  turret: { range: 15, rate: 3.2, damage: 8 },
  lamp: { radius: 11 },
  beacon: { radius: 7 },
  tesla: { range: 9, rate: 0.9, damage: 26, chains: 4 },
  buildRange: 11,
};

export type PartId = 'coil' | 'cell' | 'nav' | 'reactor';

export const PARTS: Record<PartId, { name: string; short: string; color: number }> = {
  coil: { name: 'Thruster Coil', short: 'COIL', color: 0x7dff5a },
  cell: { name: 'Fuel Cell', short: 'CELL', color: 0x5ef2ff },
  nav: { name: 'Navigation Core', short: 'NAV', color: 0xffb347 },
  reactor: { name: 'Reactor Core', short: 'CORE', color: 0xff3a5c },
};

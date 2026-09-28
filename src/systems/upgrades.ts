import { BLASTER, GRENADE, PLAYER, SHIP } from '../config';

export type UpgradeId =
  | 'dmg'
  | 'rate'
  | 'cool'
  | 'multi'
  | 'pierce'
  | 'hp'
  | 'o2'
  | 'speed'
  | 'dash'
  | 'magnet'
  | 'secondary'
  | 'lamp'
  | 'regen'
  | 'hull'
  | 'cannon';

export type SecondaryId = 'grenade' | 'nova' | 'seeker';

export interface UpgradeDef {
  id: UpgradeId;
  cat: 'Blaster' | 'Suit' | 'Ship';
  name: string;
  icon: string;
  max: number;
  desc: string;
  per: (lvl: number) => string;
  cost: (lvl: number) => { xenite: number; scrap: number };
}

const curve = (base: number[]) => (lvl: number) => ({ xenite: base[Math.min(lvl, base.length - 1)], scrap: 0 });

export const UPGRADES: UpgradeDef[] = [
  { id: 'dmg', cat: 'Blaster', name: 'Plasma Amplifier', icon: '✦', max: 5, desc: 'Bolt damage', per: (l) => `+${l * 22}% damage`, cost: curve([12, 22, 36, 55, 80]) },
  { id: 'rate', cat: 'Blaster', name: 'Cyclic Accelerator', icon: '≫', max: 5, desc: 'Fire rate', per: (l) => `+${l * 14}% fire rate`, cost: curve([12, 22, 36, 55, 80]) },
  { id: 'cool', cat: 'Blaster', name: 'Cryo Heat Sink', icon: '❄', max: 4, desc: 'Less heat per shot, faster cooling', per: (l) => `-${l * 16}% heat, +${l * 18}% cooling`, cost: curve([10, 20, 32, 48]) },
  { id: 'multi', cat: 'Blaster', name: 'Splitter Lens', icon: '⋔', max: 3, desc: 'Extra bolts per shot', per: (l) => `${l + 1} bolts per shot`, cost: curve([28, 50, 85]) },
  { id: 'pierce', cat: 'Blaster', name: 'Phase Rounds', icon: '➶', max: 3, desc: 'Bolts pass through creatures', per: (l) => `pierce ${l} target${l === 1 ? '' : 's'}`, cost: curve([22, 42, 66]) },
  { id: 'secondary', cat: 'Blaster', name: 'Ordnance Rack', icon: '✺', max: 4, desc: 'Secondary weapon cooldown & power', per: (l) => `-${l * 14}% cooldown, +${l * 20}% damage`, cost: curve([14, 26, 42, 64]) },
  { id: 'hp', cat: 'Suit', name: 'Armour Weave', icon: '⛨', max: 4, desc: 'Maximum suit integrity', per: (l) => `+${l * 25} max integrity`, cost: curve([12, 24, 38, 56]) },
  { id: 'o2', cat: 'Suit', name: 'O₂ Reserve', icon: '◍', max: 4, desc: 'Air capacity', per: (l) => `+${l * 25}s of air`, cost: curve([10, 18, 30, 45]) },
  { id: 'speed', cat: 'Suit', name: 'Servo Legs', icon: '➠', max: 3, desc: 'Movement speed', per: (l) => `+${l * 7}% speed`, cost: curve([14, 28, 46]) },
  { id: 'dash', cat: 'Suit', name: 'Thruster Pack', icon: '⇶', max: 3, desc: 'Dash recharge and distance', per: (l) => `-${l * 20}% dash cooldown`, cost: curve([14, 28, 46]) },
  { id: 'magnet', cat: 'Suit', name: 'Salvage Magnet', icon: '⊛', max: 2, desc: 'Pickup attraction range', per: (l) => `+${l * 70}% pickup range`, cost: curve([8, 20]) },
  { id: 'lamp', cat: 'Suit', name: 'Photon Lamp', icon: '☀', max: 2, desc: 'Flashlight burns night-crawlers', per: (l) => (l === 1 ? 'lamp slows creatures' : 'lamp slows and burns creatures'), cost: curve([18, 40]) },
  { id: 'regen', cat: 'Suit', name: 'Med Nanites', icon: '✚', max: 2, desc: 'Regenerate integrity out of combat', per: (l) => `${l * 1.5} integrity/s after 4s unhurt`, cost: curve([26, 55]) },
  { id: 'hull', cat: 'Ship', name: 'Hull Plating', icon: '▣', max: 3, desc: 'Ship hull strength', per: (l) => `+${l * 300} hull`, cost: (l) => ({ xenite: [6, 14, 24][l], scrap: [40, 70, 110][l] }) },
  { id: 'cannon', cat: 'Ship', name: 'Point Defence', icon: '⌖', max: 3, desc: "Ship auto-cannon damage & fire rate", per: (l) => `+${l * 45}% cannon output`, cost: (l) => ({ xenite: [10, 22, 36][l], scrap: [25, 45, 70][l] }) },
];

export type Levels = Record<UpgradeId, number>;

export const emptyLevels = (): Levels => ({
  dmg: 0,
  rate: 0,
  cool: 0,
  multi: 0,
  pierce: 0,
  hp: 0,
  o2: 0,
  speed: 0,
  dash: 0,
  magnet: 0,
  secondary: 0,
  lamp: 0,
  regen: 0,
  hull: 0,
  cannon: 0,
});

export interface Stats {
  damage: number;
  fireRate: number;
  heatPerShot: number;
  coolRate: number;
  bolts: number;
  pierce: number;
  maxHp: number;
  o2Max: number;
  speed: number;
  dashCooldown: number;
  dashSpeed: number;
  magnet: number;
  secondaryCooldown: number;
  secondaryDamage: number;
  lamp: number;
  regen: number;
  shipHull: number;
  cannonMult: number;
}

export function computeStats(l: Levels): Stats {
  return {
    damage: BLASTER.damage * (1 + 0.22 * l.dmg),
    fireRate: BLASTER.fireRate * (1 + 0.14 * l.rate),
    heatPerShot: BLASTER.heatPerShot * (1 - 0.16 * l.cool),
    coolRate: BLASTER.coolRate * (1 + 0.18 * l.cool),
    bolts: 1 + l.multi,
    pierce: l.pierce,
    maxHp: PLAYER.maxHp + 25 * l.hp,
    o2Max: PLAYER.o2Seconds + 25 * l.o2,
    speed: PLAYER.speed * (1 + 0.07 * l.speed),
    dashCooldown: PLAYER.dashCooldown * (1 - 0.2 * l.dash),
    dashSpeed: PLAYER.dashSpeed * (1 + 0.08 * l.dash),
    magnet: PLAYER.magnet * (1 + 0.7 * l.magnet),
    secondaryCooldown: GRENADE.cooldown * (1 - 0.14 * l.secondary),
    secondaryDamage: 1 + 0.2 * l.secondary,
    lamp: l.lamp,
    regen: 1.5 * l.regen,
    shipHull: SHIP.hull + 300 * l.hull,
    cannonMult: 1 + 0.45 * l.cannon,
  };
}

export const SECONDARIES: Record<SecondaryId, { name: string; desc: string; icon: string; cooldownMult: number }> = {
  grenade: { name: 'Plasma Grenade', desc: 'Lobbed charge. Big blast at the cursor.', icon: '✺', cooldownMult: 1 },
  nova: { name: 'Arc Nova', desc: 'Shockwave around you. Stuns and hurls creatures back.', icon: '◎', cooldownMult: 1.35 },
  seeker: { name: 'Seeker Swarm', desc: 'Six micro-missiles that hunt the nearest creatures.', icon: '➹', cooldownMult: 1.2 },
};

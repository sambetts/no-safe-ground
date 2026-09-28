// Narrative content: the ship AI's lines and the logs left by the lost Kestrel survey team.

export const AI_NAME = 'WREN';
export const SHIP_NAME = 'ISV Kittiwake';
export const PLANET = 'Kessra';

export interface LogEntry {
  title: string;
  author: string;
  text: string;
  tip: string;
}

export const LOGS: LogEntry[] = [
  {
    title: 'Kestrel Survey — Log 1',
    author: 'Dr. Imani Okafor',
    text: "Touchdown on Kessra. The air is poison but the ground is rich — xenite crystals glow right out of the soil. The wildlife keeps its distance in daylight. Almost shy.",
    tip: 'Shoot xenite crystals to harvest them. Xenite buys upgrades at the ship.',
  },
  {
    title: 'Kestrel Survey — Log 2',
    author: 'Dr. Imani Okafor',
    text: "They are not shy. They were waiting for dark. Harlan's suit lamp failed and they took him in seconds. Whatever you do, stay in the light.",
    tip: 'Flood lamps (key 3) slow and burn night-crawlers. So does an upgraded suit lamp.',
  },
  {
    title: 'Kestrel Survey — Log 3',
    author: 'Sgt. Tomas Reyes',
    text: "The green ones spit. Watch the ground — it glows where the acid will land — and MOVE. Found a prototype arc emitter in cargo. Might buy us some time.",
    tip: 'Blueprint recovered: ARC NOVA. Equip it at the fabricator.',
  },
  {
    title: 'Kestrel Survey — Log 4',
    author: 'Dr. Imani Okafor',
    text: "The big ones — we call them rams — charge in a straight line and cannot turn. Put a rock between you and them. They hit it like a freight hauler and stagger. That is your moment.",
    tip: 'Rams that charge into rocks or barricades are stunned and take extra damage.',
  },
  {
    title: 'Kestrel Survey — Log 5',
    author: 'Tech. Ansel Voight',
    text: "The blue bulbs are full of oxygen. Pop one and you get half a tank back. I mapped a trail of them. Don't touch the purple drifters — their spores eat through filters.",
    tip: 'Walk into blue bulbs to refill O₂. Shoot drifters from range — their spores hurt creatures too.',
  },
  {
    title: 'Kestrel Survey — Log 6',
    author: 'Sgt. Tomas Reyes',
    text: "Something moves under the sand. You feel it before you see it — the ground shivers, then a ring. Dash out of the ring. Finished the seeker rack. Take it. I won't need it.",
    tip: 'Blueprint recovered: SEEKER SWARM. Equip it at the fabricator.',
  },
  {
    title: 'Kestrel Survey — Log 7',
    author: 'Dr. Imani Okafor',
    text: "The hive breathes. There is something enormous beneath it. It heard our reactor and came up to meet us. The Commander went in alone. The Commander did not come out.",
    tip: 'The Matriarch guards the reactor core. Bait her charge into the stone pillars.',
  },
  {
    title: 'Kestrel Survey — Log 8',
    author: 'Dr. Imani Okafor',
    text: "If you are reading this, you crashed too. I think the storms pull ships down. Fix your ship. Don't stay. Every night they come back in greater numbers. Don't stay.",
    tip: 'Every night is worse than the last. Don\'t linger.',
  },
];

export const WREN = {
  intro: [
    'Hull breach sealed. You are alive. That is the good news.',
    'Atmosphere: four percent oxygen. Do not open your helmet. Your tank holds about eighty seconds; the hull field refills it.',
    'Four components were torn loose on the way down. I have their signals. We are not leaving without them.',
  ],
  duskWarn: 'Sunset in under a minute. Local fauna appears to be... nocturnal. I strongly suggest being near the ship.',
  nightfall: ['Nightfall. Movement on every sensor.', 'Here they come again.', 'Night. Stay close to the lights.', 'They are back. More of them this time.'],
  dawn: ['Dawn. They are retreating from the light.', 'Sunrise. The swarm is pulling back.', 'Morning. We made it through another one.'],
  partPicked: 'Got it. Bring it home — and quickly. The signal is attracting attention.',
  partInstalled: (name: string, left: number) => (left > 0 ? `${name} installed. ${left} to go.` : `${name} installed. All systems nominal.`),
  reactorWarn: 'The reactor core is in the hive, beneath a very large bio-signature. Recommend upgrades before you go in there.',
  bossSeen: 'That is... a very large lifeform.',
  bossDown: 'It is down. The core should be right there. Take it and run.',
  launch: 'Reactor online. Engines need seventy-five seconds to spool up. Everything on this planet just heard that.',
  launchHalf: 'Halfway there. Keep them off the hull!',
  launchFinal: 'Ten seconds. Get to the ramp!',
  death: (left: number) => (left > 0 ? `Vital signs lost. Reconstructing you. ${left} reconstruction${left === 1 ? '' : 's'} remaining — please be more careful.` : 'Vital signs lost.'),
  lowAir: 'Your oxygen is critical. Find a blue bulb or get back to air.',
  shipCritical: 'Hull integrity critical! Get back here!',
  storm: 'Ion storm rolling in. Strikes are marked on the ground a moment before they land.',
};

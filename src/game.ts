import * as THREE from 'three';
import { DIFFICULTIES, Difficulty, DifficultyId, PARTS, PartId, SHIP, STRUCTURES } from './config';
import { clamp, damp, dist, easeInCubic, easeInOutCubic, lerp, rand, TAU } from './core/math';
import { audio, LoopHandle, MusicMood } from './audio/audio';
import { Input } from './input';
import { Renderer } from './render/renderer';
import { shared } from './render/materials';
import { buildEnvironment, EnvironmentHandles } from './render/environment';
import { partGeo } from './render/models';
import { generateWorld, WorldLayout } from './world/worldgen';
import { FlowField, StaticGrid } from './world/collision';
import type { Terrain } from './world/terrain';
import { Fx } from './systems/fx';
import { Cycle } from './systems/daynight';
import { Director } from './systems/director';
import { HazardSystem } from './systems/hazards';
import { computeStats, emptyLevels, Levels, SECONDARIES, SecondaryId, Stats, UpgradeId, UPGRADES } from './systems/upgrades';
import { Player } from './entities/player';
import { Enemy, EnemySystem } from './entities/enemies';
import { ProjectileSystem } from './entities/projectiles';
import { PickupSystem } from './entities/pickups';
import { ResourceSystem } from './entities/resources';
import { StructureSystem } from './entities/structures';
import { Ship } from './entities/ship';
import { Hud } from './ui/hud';
import { Hints, Messages } from './ui/messages';
import { Screens, Settings } from './ui/screens';
import { LOGS, WREN } from './story';

export type GameState = 'title' | 'intro' | 'playing' | 'paused' | 'fabricator' | 'map' | 'gameover' | 'outro' | 'victory';
type PartState = 'field' | 'carried' | 'dropped' | 'installed';

export interface RunRecord {
  kills: number;
  shots: number;
  hits: number;
  damageTaken: number;
  xenite: number;
  scrap: number;
  built: number;
  logs: number;
  nights: number;
}

const newRecord = (): RunRecord => ({ kills: 0, shots: 0, hits: 0, damageTaken: 0, xenite: 0, scrap: 0, built: 0, logs: 0, nights: 0 });

interface PartObject {
  id: PartId;
  group: THREE.Group;
  beam: THREE.Mesh;
}

export class Game {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly fx: Fx;
  readonly hud: Hud;
  readonly messages: Messages;
  readonly hints: Hints;
  readonly screens: Screens;
  readonly cycle = new Cycle();
  readonly director: Director;
  readonly enemies: EnemySystem;
  readonly projectiles: ProjectileSystem;
  readonly pickups: PickupSystem;
  readonly structures: StructureSystem;
  readonly ship: Ship;
  readonly player: Player;
  worldRoot = new THREE.Group();
  layout!: WorldLayout;
  terrain!: Terrain;
  grid!: StaticGrid;
  flowShip!: FlowField;
  flowPlayer!: FlowField;
  resources!: ResourceSystem;
  hazards!: HazardSystem;
  private env: EnvironmentHandles | null = null;

  state: GameState = 'title';
  seed = 1;
  time = 0;
  playTime = 0;
  frame = 0;
  difficulty: Difficulty = DIFFICULTIES.survivor;
  levels: Levels = emptyLevels();
  stats: Stats = computeStats(emptyLevels());
  record: RunRecord = newRecord();
  inventory = { scrap: 0, xenite: 0 };
  lives = 3;
  secondary: SecondaryId = 'grenade';
  unlockedSecondaries = new Set<SecondaryId>(['grenade']);
  partState: Record<PartId, PartState> = { coil: 'field', cell: 'field', nav: 'field', reactor: 'field' };
  droppedPart: { x: number; z: number; id: PartId } | null = null;
  wreckSeen: boolean[] = [];
  wreckLooted: boolean[] = [];
  launching = false;
  launchRemaining = SHIP.launchTime;
  nearHatch = false;
  private partObjects: PartObject[] = [];
  private flowPlayerT = 0;
  private stateT = 0;
  private respawnT = 0;
  private endT = 0;
  private endReason = '';
  private slowmo = 0;
  private titleAngle = 0;
  private windLoop: LoopHandle | null = null;
  private breathLoop: LoopHandle | null = null;
  private heartT = 0;
  private music: MusicMood = 'silent';
  private introShip = { p0: new THREE.Vector3(), p1: new THREE.Vector3(), impact: false };
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private launchMilestones = new Set<string>();
  private bossEngaged = false;

  constructor(container: HTMLElement) {
    this.renderer = new Renderer(container);
    this.renderer.scene.add(this.worldRoot);
    this.input = new Input(this.renderer.renderer.domElement);
    this.seed = Math.floor(Math.random() * 1e9);
    this.buildWorld(this.seed);
    this.fx = new Fx(this.renderer, this.terrain);
    this.hud = new Hud(this, document.body);
    this.messages = new Messages(this);
    this.hints = new Hints(this);
    this.director = new Director(this);
    this.enemies = new EnemySystem(this);
    this.projectiles = new ProjectileSystem(this);
    this.pickups = new PickupSystem(this);
    this.structures = new StructureSystem(this);
    this.ship = new Ship(this);
    this.player = new Player(this);
    this.resources.init(this.layout);
    this.screens = new Screens(this);
    this.screens.apply();
    this.enterTitle();
  }

  get secondaryDef() {
    return SECONDARIES[this.secondary];
  }

  // ------------------------------------------------------------------------------------------------ world

  private buildWorld(seed: number): void {
    // dispose the previous world
    if (this.env) {
      this.worldRoot.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      this.renderer.scene.remove(this.worldRoot);
      this.worldRoot = new THREE.Group();
      this.renderer.scene.add(this.worldRoot);
    }
    this.seed = seed;
    this.layout = generateWorld(seed);
    this.terrain = this.layout.terrain;
    this.grid = new StaticGrid(this.layout.obstacles);
    this.flowShip = new FlowField(this.grid);
    this.flowPlayer = new FlowField(this.grid);
    this.flowShip.compute([{ x: 0, z: 0 }]);
    this.env = buildEnvironment(this.layout);
    this.worldRoot.add(this.env.group);
    this.resources = new ResourceSystem(this);
    this.hazards = new HazardSystem(this);
    if (this.fx) this.fx.terrain = this.terrain;
    // part objects: floating component with a tall signal beam
    this.partObjects = [];
    for (const p of this.layout.parts) {
      const po = this.makePartObject(p.id);
      po.group.position.set(p.x, this.terrain.heightAt(p.x, p.z), p.z);
      po.group.visible = p.id !== 'reactor';
      this.worldRoot.add(po.group);
      this.partObjects.push(po);
    }
    this.wreckSeen = this.layout.wrecks.map(() => false);
    this.wreckLooted = this.layout.wrecks.map(() => false);
  }

  private makePartObject(id: PartId): PartObject {
    const group = new THREE.Group();
    const g = partGeo(id);
    const body = new THREE.Mesh(g.body, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    const glow = new THREE.Mesh(g.glow, new THREE.MeshBasicMaterial({ color: new THREE.Color(PARTS[id].color).multiplyScalar(2.6), toneMapped: false }));
    const holder = new THREE.Group();
    holder.add(body, glow);
    holder.position.y = 1.6;
    holder.name = 'holder';
    group.add(holder);
    const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PARTS[id].color).multiplyScalar(0.6), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.6, 70, 10, 1, true), beamMat);
    beam.position.y = 35;
    group.add(beam);
    const pad = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(PARTS[id].color).multiplyScalar(1.5), transparent: true, opacity: 0.6, toneMapped: false, side: THREE.DoubleSide }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.12;
    group.add(pad);
    return { id, group, beam };
  }

  recomputeShipFlow(): void {
    this.flowShip.compute([{ x: this.ship.x, z: this.ship.z }]);
  }

  // ------------------------------------------------------------------------------------------------ states

  private enterTitle(): void {
    this.state = 'title';
    this.stateT = 0;
    this.hud.setVisible(false);
    this.screens.hideAll();
    this.screens.showTitle(true);
    this.cycle.reset();
    this.cycle.frozen = { phase: 'dusk', k: 0.5 };
    this.player.alive = false;
    this.player.model.root.visible = false;
    this.ship.model.group.visible = false;
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.structures.clear();
    this.hazards.clear();
    this.fx.glow.clear();
    this.fx.smoke.clear();
    this.fx.splats.clear();
    this.messages.clear();
    this.hud.showBoss(false);
    this.renderer.rig.override = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    // a few creatures wander the vista
    for (let i = 0; i < 10; i++) {
      const a = rand(0, TAU);
      const d = rand(18, 50);
      const e = this.enemies.spawn(i % 4 === 0 ? 'floater' : 'skitter', Math.cos(a) * d, Math.sin(a) * d, 'wander');
      e.homeX = e.x;
      e.homeZ = e.z;
    }
    this.setMusic('title');
    this.hud.fade(0, false, 1.5);
    this.stopLoops();
  }

  toTitle(): void {
    this.hud.fade(1, false, 0.5);
    setTimeout(() => {
      this.ship.dispose();
      this.enterTitle();
    }, 520);
  }

  startRun(diff: DifficultyId): void {
    audio.unlock();
    this.hud.fade(1, false, 0.45);
    this.screens.hideAll();
    setTimeout(() => {
      // fresh world for every run after the first (the title vista world is used for the first run)
      if (this.state !== 'title') this.buildWorld(Math.floor(Math.random() * 1e9));
      this.resetRun(diff);
      this.enterIntro();
    }, 480);
  }

  private resetRun(diff: DifficultyId): void {
    this.difficulty = DIFFICULTIES[diff];
    this.levels = emptyLevels();
    this.stats = computeStats(this.levels);
    this.record = newRecord();
    this.inventory = { scrap: 0, xenite: 0 };
    this.lives = this.difficulty.lives;
    this.secondary = 'grenade';
    this.unlockedSecondaries = new Set(['grenade']);
    this.partState = { coil: 'field', cell: 'field', nav: 'field', reactor: 'field' };
    this.droppedPart = null;
    this.launching = false;
    this.launchRemaining = SHIP.launchTime;
    this.launchMilestones.clear();
    this.bossEngaged = false;
    this.playTime = 0;
    this.slowmo = 0;
    this.cycle.reset();
    this.cycle.frozen = null;
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.structures.clear();
    this.hazards.clear();
    this.fx.glow.clear();
    this.fx.smoke.clear();
    this.fx.splats.clear();
    this.messages.clear();
    this.hints.reset();
    this.director.reset();
    this.hud.showBoss(false);
    this.hud.resetWorldMap();
    this.resources.init(this.layout);
    this.ship.init(this.layout.shipRot);
    this.ship.model.group.visible = true;
    this.recomputeShipFlow();
    for (const po of this.partObjects) {
      po.group.visible = po.id !== 'reactor';
      const p = this.layout.parts.find((q) => q.id === po.id)!;
      po.group.position.set(p.x, this.terrain.heightAt(p.x, p.z), p.z);
    }
    this.wreckSeen = this.layout.wrecks.map(() => false);
    this.wreckLooted = this.layout.wrecks.map(() => false);
    // crash debris and nests
    for (const d of this.layout.debris) this.pickups.place('scrap', d.x, d.z, 3);
    for (const n of this.layout.nests) this.enemies.spawn('nest', n.x, n.z, 'guard');
    const h = this.ship.hatch();
    this.player.reset(h.x, h.z);
    this.player.alive = false;
    this.player.model.root.visible = false;
  }

  private enterIntro(): void {
    this.state = 'intro';
    this.stateT = 0;
    this.hud.setVisible(false);
    this.hud.fade(0, false, 0.8);
    this.screens.showSkip(true);
    this.setMusic('silent');
    const rot = this.layout.shipRot;
    const back = new THREE.Vector3(-Math.sin(rot), 0, -Math.cos(rot));
    this.introShip.p1.set(0, this.ship.y - 0.5, 0);
    this.introShip.p0.copy(this.introShip.p1).addScaledVector(back, 150).add(new THREE.Vector3(0, 80, 0));
    this.introShip.impact = false;
    this.ship.model.group.position.copy(this.introShip.p0);
    this.cycle.set('day', 30);
    audio.play('engineRoar', { volume: 0.8 });
    // camera looks along the approach from the side
    const side = new THREE.Vector3(Math.cos(rot), 0, -Math.sin(rot));
    this.camPos.set(0, 9, 0).addScaledVector(side, 34).addScaledVector(back, -14);
    this.renderer.rig.override = { pos: this.camPos.clone(), look: new THREE.Vector3() };
  }

  private finishIntro(): void {
    this.screens.showSkip(false);
    this.screens.setSubtitle(null);
    this.ship.model.group.position.copy(this.introShip.p1);
    this.ship.model.group.rotation.set(0.04, this.layout.shipRot, -0.06);
    if (!this.introShip.impact) this.impact();
    this.renderer.rig.override = null;
    const h = this.ship.hatch();
    this.player.reset(h.x, h.z);
    this.player.facing = Math.atan2(h.x, h.z);
    this.renderer.rig.target.set(this.player.x, this.player.y, this.player.z);
    this.renderer.rig.snap();
    this.state = 'playing';
    this.stateT = 0;
    this.hud.setVisible(true);
    this.setMusic('explore');
    this.startLoops();
    WREN.intro.forEach((l) => this.messages.comms('WREN', l, 'info'));
    this.messages.announce('KESSRA', 'Day 1 · find the four missing components', 'info', 4);
  }

  private impact(): void {
    this.introShip.impact = true;
    this.fx.explosion(0, 0, 7, 0xffa040, true);
    this.fx.explosion(-Math.sin(this.layout.shipRot) * 5, -Math.cos(this.layout.shipRot) * 5, 5, 0xff7a2a, true);
    this.fx.dust(0, 0, 40, 0x8a7a6a, 4, 3);
    this.fx.shake(1);
    this.hud.lightningFlash();
    audio.play('crash', { volume: 1 });
  }

  setPaused(v: boolean): void {
    if (v && this.state === 'playing') {
      this.state = 'paused';
      this.screens.showPause(true);
      audio.setPaused(true);
      this.hud.setVisible(false);
    } else if (!v && this.state === 'paused') {
      this.state = 'playing';
      this.screens.showPause(false);
      audio.setPaused(false);
      this.hud.setVisible(true);
    }
  }

  openFabricator(): void {
    if (this.state !== 'playing') return;
    this.structures.cancel();
    this.state = 'fabricator';
    this.screens.showFabricator(true);
    audio.play('uiOpen');
    audio.setPaused(true);
    this.hints.markFabricatorUsed();
  }

  closeFabricator(): void {
    if (this.state !== 'fabricator') return;
    this.state = 'playing';
    this.screens.showFabricator(false);
    audio.play('uiClose');
    audio.setPaused(false);
  }

  applySettings(s: Settings): void {
    this.renderer.setQuality(s.quality);
    this.renderer.rig.shakeEnabled = s.shake;
    this.hud.showDamageNumbers = s.damageNumbers;
    this.hints.enabled = s.hints;
  }

  buyUpgrade(id: UpgradeId): boolean {
    const u = UPGRADES.find((q) => q.id === id)!;
    const lvl = this.levels[id];
    if (lvl >= u.max) return false;
    const c = u.cost(lvl);
    if (this.inventory.xenite < c.xenite || this.inventory.scrap < c.scrap) {
      audio.play('uiError');
      return false;
    }
    this.inventory.xenite -= c.xenite;
    this.inventory.scrap -= c.scrap;
    this.levels[id]++;
    const prevHull = this.stats.shipHull;
    const prevHp = this.stats.maxHp;
    this.stats = computeStats(this.levels);
    if (id === 'hull') this.ship.hull += this.stats.shipHull - prevHull;
    if (id === 'hp') this.player.hp += this.stats.maxHp - prevHp;
    if (id === 'o2') this.player.o2 = this.stats.o2Max;
    audio.play('upgrade');
    return true;
  }

  repairShip(): boolean {
    const missing = this.stats.shipHull - this.ship.hull;
    if (missing <= 0 || this.inventory.scrap <= 0) {
      audio.play('uiError');
      return false;
    }
    const cost = Math.min(this.inventory.scrap, Math.ceil(missing / 6));
    this.inventory.scrap -= cost;
    this.ship.hull = Math.min(this.stats.shipHull, this.ship.hull + cost * 6);
    audio.play('build');
    return true;
  }

  // ------------------------------------------------------------------------------------------------ events

  lampExposure(e: Enemy): number {
    const lvl = this.stats.lamp;
    const p = this.player;
    if (lvl <= 0 || !p.alive || this.cycle.darkness < 0.3) return 0;
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 20 || d < 0.1) return 0;
    const fx = Math.sin(p.facing);
    const fz = Math.cos(p.facing);
    const cos = (dx * fx + dz * fz) / d;
    if (cos < Math.cos(0.5)) return 0;
    return lvl >= 2 ? 1 : 0.5;
  }

  onPlayerDeath(source: string): void {
    const p = this.player;
    if (!p.alive) return;
    p.die();
    this.structures.cancel();
    if (p.carrying) {
      const id = p.carrying;
      p.setCarry(null);
      this.partState[id] = 'dropped';
      this.droppedPart = { x: p.x, z: p.z, id };
      const po = this.partObjects.find((q) => q.id === id)!;
      po.group.visible = true;
      po.group.position.set(p.x, this.terrain.heightAt(p.x, p.z), p.z);
    }
    this.lives--;
    this.slowmo = 1.2;
    this.fx.freeze(0.15);
    const reasons: Record<string, string> = {
      suffocation: 'Your air ran out.',
      acid: 'Dissolved in acid.',
      spores: 'Choked on drifter spores.',
      lightning: 'Struck by lightning.',
      geyser: 'Caught in a geyser.',
      skitter: 'Torn apart by skitterers.',
      brute: 'Trampled by a ram.',
      burrower: 'Taken from below.',
      matriarch: 'Crushed by the Matriarch.',
    };
    this.endReason = reasons[source] ?? 'Killed on Kessra.';
    if (this.lives > 0) {
      this.respawnT = 3.2;
      this.messages.comms('WREN', WREN.death(this.lives), 'bad');
      this.messages.announce('VITAL SIGNS LOST', this.endReason, 'bad', 2.8);
    } else {
      this.messages.announce('VITAL SIGNS LOST', this.endReason, 'bad', 4);
      this.gameOver(this.endReason);
    }
  }

  onShipDestroyed(): void {
    if (this.state !== 'playing') return;
    for (let i = 0; i < 5; i++) this.fx.explosion(rand(-5, 5), rand(-5, 5), 6, 0xffa040, true);
    audio.play('crash');
    this.gameOver('The Kittiwake was torn apart.');
  }

  private gameOver(reason: string): void {
    this.state = 'gameover';
    this.endT = 0;
    this.endReason = reason;
    this.setMusic('gameover');
    audio.play('defeat');
    this.stopLoops();
  }

  onBossAppear(x: number, z: number): void {
    this.enemies.spawn('matriarch', x, z, 'hunt', { aggro: true });
    this.hud.showBoss(true);
    this.messages.announce('THE MATRIARCH', 'She has been waiting', 'bad', 4);
    this.messages.comms('WREN', WREN.bossSeen, 'warn');
    this.setMusic('boss');
    audio.play('bossRoar');
    this.fx.shake(1);
  }

  onBossKilled(e: Enemy): void {
    this.slowmo = 2;
    this.hud.showBoss(false);
    for (let i = 0; i < 6; i++) setTimeout(() => this.fx.explosion(e.x + rand(-4, 4), e.z + rand(-4, 4), 5, 0xff2d55, true), i * 180);
    audio.play('bossRoar', { pitch: 0.7 });
    audio.play('bigDie');
    this.pickups.burst('xenite', e.x, e.z, 60, e.y + 3);
    this.pickups.burst('health', e.x, e.z, 4, e.y + 3);
    // the reactor core drops where she fell
    const po = this.partObjects.find((q) => q.id === 'reactor')!;
    const rp = this.layout.parts.find((q) => q.id === 'reactor')!;
    rp.x = e.x;
    rp.z = e.z;
    po.group.position.set(e.x, this.terrain.heightAt(e.x, e.z), e.z);
    po.group.visible = true;
    this.messages.announce('MATRIARCH SLAIN', 'The reactor core is exposed', 'good', 4);
    this.messages.comms('WREN', WREN.bossDown, 'info');
    this.setMusic(this.cycle.phase === 'night' ? 'night' : 'explore');
  }

  private pickUpPart(id: PartId): void {
    this.partState[id] = 'carried';
    if (this.droppedPart?.id === id) this.droppedPart = null;
    this.player.setCarry(id);
    const po = this.partObjects.find((q) => q.id === id)!;
    po.group.visible = false;
    audio.play('partPickup');
    this.fx.ring(this.player.x, this.player.z, 0.5, 8, PARTS[id].color, 0.7);
    this.fx.flash(this.player.x, this.player.y + 2, this.player.z, PARTS[id].color, 40, 16, 0.6);
    this.slowmo = 0.6;
    this.messages.announce(PARTS[id].name.toUpperCase(), 'Recovered — bring it to the ship', 'good', 3.5);
    this.messages.comms('WREN', WREN.partPicked, 'info');
    // the planet notices
    if (this.state === 'playing') {
      const p = this.player;
      for (let i = 0; i < 2; i++) {
        const a = rand(0, TAU);
        const x = p.x + Math.cos(a) * 30;
        const z = p.z + Math.sin(a) * 30;
        if (Math.hypot(x, z) < 180) this.director.spawnPack(['skitter', 'skitter', 'skitter', 'skitter', 'spitter'], x, z, 'hunt', { aggro: true });
      }
    }
  }

  private installPart(id: PartId): void {
    this.partState[id] = 'installed';
    this.player.setCarry(null);
    this.ship.install(id);
    const left = 4 - this.ship.installed.length;
    this.messages.comms('WREN', WREN.partInstalled(PARTS[id].name, left), 'info');
    this.messages.announce(`${PARTS[id].name.toUpperCase()} INSTALLED`, `${this.ship.installed.length} of 4 components`, 'good', 3.5);
    this.inventory.xenite += 10;
    this.ship.repairFull();
    if (left === 1 && this.partState.reactor === 'field') this.messages.comms('WREN', WREN.reactorWarn, 'warn');
    if (left === 0) this.startLaunch();
  }

  private startLaunch(): void {
    this.launching = true;
    this.launchRemaining = SHIP.launchTime;
    this.ship.launching = true;
    this.director.startLaunch();
    this.setMusic('launch');
    audio.play('engineRoar');
    this.messages.announce('LAUNCH SEQUENCE', 'Hold out for 75 seconds', 'warn', 4);
    this.messages.comms('WREN', WREN.launch, 'warn');
    this.cycle.set('dusk', 0);
  }

  private lootWreck(i: number): void {
    const w = this.layout.wrecks[i];
    this.wreckLooted[i] = true;
    const log = LOGS[w.log];
    this.record.logs++;
    this.pickups.burst('scrap', w.x, w.z, Math.round(rand(28, 42) * this.difficulty.resourceMult), this.terrain.heightAt(w.x, w.z) + 1.5);
    this.pickups.burst('xenite', w.x, w.z, Math.round(rand(8, 14) * this.difficulty.resourceMult), this.terrain.heightAt(w.x, w.z) + 1.5);
    this.messages.comms(`${log.title} · ${log.author}`, `“${log.text}”`, 'log', log.tip);
    this.fx.ring(w.x, w.z, 0.5, 6, 0xffc34a, 0.6);
    if (w.blueprint) {
      this.unlockedSecondaries.add(w.blueprint);
      this.messages.announce('BLUEPRINT RECOVERED', `${SECONDARIES[w.blueprint].name} — equip it at the fabricator`, 'good', 4);
      audio.play('upgrade');
    }
  }

  // ------------------------------------------------------------------------------------------------ audio helpers

  private setMusic(m: MusicMood): void {
    if (this.music === m) return;
    this.music = m;
    audio.setMusic(m);
  }

  private startLoops(): void {
    this.stopLoops();
    this.windLoop = audio.loop('wind');
    this.breathLoop = audio.loop('breathing');
    this.windLoop.setVolume(0.25);
    this.breathLoop.setVolume(0);
  }

  private stopLoops(): void {
    this.windLoop?.stop();
    this.breathLoop?.stop();
    this.windLoop = null;
    this.breathLoop = null;
  }

  // ------------------------------------------------------------------------------------------------ frame

  /** Debug/test helper: advance the simulation quickly without drawing. */
  step(seconds: number, dt = 1 / 30): void {
    const n = Math.ceil(seconds / dt);
    for (let i = 0; i < n; i++) this.update(dt, false);
  }

  update(realDt: number, draw = true): void {
    const inp = this.input;
    inp.pollGamepad();
    if (inp.anyPressed) audio.unlock();
    this.frame++;
    let dt = realDt;
    if (this.fx.hitstop > 0) {
      this.fx.hitstop -= realDt;
      dt *= 0.08;
    }
    if (this.slowmo > 0) {
      this.slowmo -= realDt;
      dt *= this.slowmo > 0.3 ? 0.35 : 0.35 + (0.3 - this.slowmo) * 2.1;
    }
    this.time += dt;
    shared.uTime.value = this.time;

    switch (this.state) {
      case 'title':
        this.updateTitle(realDt);
        break;
      case 'intro':
        this.updateIntro(realDt);
        break;
      case 'playing':
        this.updatePlaying(dt);
        break;
      case 'paused':
        if (inp.pressed('pause')) this.setPaused(false);
        break;
      case 'fabricator':
        if (inp.pressed('interact') || inp.pressed('cancel')) this.closeFabricator();
        break;
      case 'map':
        if (inp.pressed('map') || inp.pressed('cancel')) {
          this.screens.toggleMap(false);
          this.state = 'playing';
          audio.setPaused(false);
        }
        break;
      case 'gameover':
        this.updateGameOver(dt, realDt);
        break;
      case 'outro':
        this.updateOutro(realDt);
        break;
      case 'victory':
        this.updateWorldSim(dt * 0.5, false);
        break;
    }
    this.fx.update(this.state === 'paused' || this.state === 'fabricator' || this.state === 'map' ? 0 : dt);
    this.messages.update(realDt);
    const focus = this.state === 'title' || this.state === 'intro' ? this.renderer.rig.camera.position : this.player;
    this.cycle.apply(this.renderer, focus.x, focus.z, this.hazards.stormLevel);
    this.renderer.lights.flush(dt, this.renderer.rig.target.x, this.renderer.rig.target.z);
    this.renderer.render(realDt, draw);
    inp.endFrame();
  }

  private updateTitle(dt: number): void {
    this.titleAngle += dt * 0.035;
    const r = 58;
    const pos = new THREE.Vector3(Math.cos(this.titleAngle) * r, 0, Math.sin(this.titleAngle) * r);
    pos.y = Math.max(this.terrain.heightAt(pos.x, pos.z), 0) + 16;
    const look = new THREE.Vector3(Math.cos(this.titleAngle + 2.2) * 22, 3, Math.sin(this.titleAngle + 2.2) * 22);
    this.renderer.rig.override = { pos, look };
    this.renderer.rig.target.copy(look);
    audio.setListener(pos.x, pos.z);
    this.enemies.update(dt);
    this.resources.update(dt);
    audio.update(dt);
  }

  private updateIntro(dt: number): void {
    this.stateT += dt;
    const t = this.stateT;
    const ship = this.ship.model.group;
    const T_IMPACT = 3.4;
    if (t < T_IMPACT) {
      const k = easeInCubic(t / T_IMPACT) * 0.7 + (t / T_IMPACT) * 0.3;
      ship.position.lerpVectors(this.introShip.p0, this.introShip.p1, k);
      const rot = this.layout.shipRot;
      ship.rotation.set(0.45 - k * 0.3, rot, Math.sin(t * 7) * 0.08);
      // fire trail
      for (let i = 0; i < 6; i++) {
        this.fx.glow.spawn({ x: ship.position.x + rand(-1.5, 1.5), y: ship.position.y + rand(0, 3), z: ship.position.z + rand(-1.5, 1.5), vx: rand(-2, 2), vy: rand(-1, 2), vz: rand(-2, 2), life: rand(0.3, 0.7), size: rand(1.5, 3), sizeEnd: 0.2, color: 0xffa040, colorEnd: 0xff3010 });
        this.fx.smokePuff(ship.position.x, ship.position.y + 1, ship.position.z, 0x3a3434, 3, 3, 0.3, 0.5);
      }
      this.fx.shake(0.02 + k * 0.05);
    } else if (!this.introShip.impact) {
      ship.position.copy(this.introShip.p1);
      ship.rotation.set(0.04, this.layout.shipRot, -0.06);
      this.impact();
    }
    // camera
    const rig = this.renderer.rig;
    if (t < 5.4) {
      const look = t < T_IMPACT ? ship.position.clone().lerp(this.introShip.p1, 0.35) : this.introShip.p1.clone().add(new THREE.Vector3(0, 2, 0));
      this.camLook.lerp(look, t < 0.1 ? 1 : Math.min(1, dt * 4));
      rig.override = { pos: this.camPos.clone().add(new THREE.Vector3(rand(-1, 1) * rig.trauma, rand(-1, 1) * rig.trauma, 0)), look: this.camLook.clone() };
    } else {
      // swoop to the gameplay camera
      const k = easeInOutCubic((t - 5.4) / 2);
      const h = this.ship.hatch();
      const y = this.terrain.heightAt(h.x, h.z);
      const endPos = new THREE.Vector3(h.x, y + Math.sin(rig.pitch) * rig.distance, h.z + Math.cos(rig.pitch) * rig.distance);
      const endLook = new THREE.Vector3(h.x, y, h.z);
      rig.override = { pos: this.camPos.clone().lerp(endPos, k), look: this.camLook.clone().lerp(endLook, k) };
      if (t > 5.6 && !this.player.alive) {
        this.player.reset(h.x, h.z);
        this.player.model.root.visible = true;
        this.player.model.root.position.set(h.x, y, h.z);
        this.fx.dust(h.x, h.z, 8, 0x9a8a7a, 1, 1);
      }
    }
    if (t > 4 && t < 5.5) this.screens.setSubtitle('WREN: “Impact survived. Hull breached. We are not alone out there.”');
    if (t >= 5.5) this.screens.setSubtitle(null);
    this.ship.update(dt);
    this.enemies.update(dt);
    this.resources.update(dt);
    audio.setListener(this.introShip.p1.x, this.introShip.p1.z);
    audio.update(dt);
    if (t > 7.4 || (t > 0.5 && (this.input.pressed('skip') || this.input.mousePressed))) this.finishIntro();
  }

  /** Simulation shared by playing / victory / game over states. */
  private updateWorldSim(dt: number, withPlayer: boolean): void {
    this.flowPlayerT -= dt;
    if (this.flowPlayerT <= 0 && this.player.alive) {
      this.flowPlayerT = 0.35;
      this.flowPlayer.compute([{ x: this.player.x, z: this.player.z }], 110);
    }
    if (withPlayer) this.player.update(dt);
    this.enemies.update(dt);
    this.projectiles.update(dt);
    this.pickups.update(dt);
    this.resources.update(dt);
    this.structures.update(dt);
    this.ship.update(dt);
    this.hazards.update(dt);
    // part objects bob and spin
    for (const po of this.partObjects) {
      if (!po.group.visible) continue;
      const holder = po.group.getObjectByName('holder')!;
      holder.rotation.y += dt * 1.2;
      holder.position.y = 1.6 + Math.sin(this.time * 2 + po.group.position.x) * 0.25;
      (po.beam.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.1 * Math.sin(this.time * 3);
      this.renderer.lights.request(po.group.position.x, po.group.position.y + 2, po.group.position.z, PARTS[po.id].color, 8, 10, 2);
    }
    audio.update(dt);
  }

  private updatePlaying(dt: number): void {
    const inp = this.input;
    const p = this.player;
    const rig = this.renderer.rig;
    this.playTime += dt;

    // --- input: menus & building ----------------------------------------------------------------------------
    if (inp.pressed('pause')) {
      if (this.structures.placing) this.structures.cancel();
      else {
        this.setPaused(true);
        return;
      }
    }
    if (inp.pressed('map')) {
      this.state = 'map';
      this.screens.toggleMap(true);
      audio.setPaused(true);
      this.hints.done('map');
      return;
    }
    if (inp.wheel) rig.targetDistance = clamp(rig.targetDistance + inp.wheel * 2, 22, 42);
    const buildKeys = ['build1', 'build2', 'build3', 'build4', 'build5'] as const;
    for (let i = 0; i < buildKeys.length; i++) if (inp.pressed(buildKeys[i]) && p.alive) this.structures.select(STRUCTURES[i].kind);

    // --- cycle ---------------------------------------------------------------------------------------------
    if (!this.launching) {
      const ev = this.cycle.update(dt);
      if (ev === 'dusk') {
        this.messages.comms('WREN', WREN.duskWarn, 'warn');
        this.messages.announce('DUSK', 'Night falls in 20 seconds', 'warn', 3);
        this.setMusic('dusk');
      } else if (ev === 'night') {
        this.messages.announce(`NIGHT ${this.director.nightNumber + 1}`, 'Survive until dawn', 'bad', 3.5);
        audio.play('nightfall');
        this.director.onNightfall();
        this.setMusic(this.enemies.boss ? 'boss' : 'night');
      } else if (ev === 'dawn') {
        this.record.nights++;
        this.enemies.retreat();
        this.director.onDawn();
        audio.play('dawn');
        this.messages.announce('DAWN', `Night ${this.director.nightNumber} survived`, 'good', 3.5);
        this.messages.comms('WREN', WREN.dawn[Math.floor(Math.random() * WREN.dawn.length)], 'info');
        this.setMusic(this.enemies.boss ? 'boss' : 'explore');
      }
    } else {
      this.launchRemaining -= dt;
      const d = this.cycle;
      d.set('night', 30);
      if (this.launchRemaining < SHIP.launchTime / 2 && !this.launchMilestones.has('half')) {
        this.launchMilestones.add('half');
        this.messages.comms('WREN', WREN.launchHalf, 'warn');
      }
      if (this.launchRemaining < 10 && !this.launchMilestones.has('final')) {
        this.launchMilestones.add('final');
        this.messages.comms('WREN', WREN.launchFinal, 'warn');
        this.messages.announce('10 SECONDS', 'Get to the ship!', 'warn', 3);
      }
      if (this.launchRemaining <= 0) {
        this.launchRemaining = 0;
        if (p.alive && dist(p.x, p.z, this.ship.x, this.ship.z) < SHIP.safeRadius + 1.5) {
          this.beginOutro();
          return;
        }
        if (!this.launchMilestones.has('board')) {
          this.launchMilestones.add('board');
          this.messages.announce('ENGINES HOT', 'Get back to the ship!', 'warn', 3.5);
        }
      }
    }

    // --- simulation -------------------------------------------------------------------------------------------
    this.director.update(dt);
    this.updateWorldSim(dt, true);

    // --- interactions ------------------------------------------------------------------------------------------
    this.nearHatch = false;
    if (p.alive) {
      const shipD = dist(p.x, p.z, this.ship.x, this.ship.z);
      this.nearHatch = shipD < SHIP.safeRadius;
      // parts
      for (const part of this.layout.parts) {
        const st = this.partState[part.id];
        if (st !== 'field' && st !== 'dropped') continue;
        if (part.id === 'reactor' && st === 'field' && (this.enemies.boss || !this.partObjects.find((q) => q.id === 'reactor')!.group.visible)) continue;
        const pos = st === 'dropped' && this.droppedPart ? this.droppedPart : part;
        if (!p.carrying && dist(p.x, p.z, pos.x, pos.z) < 2.2) this.pickUpPart(part.id);
      }
      if (p.carrying && shipD < SHIP.interactRadius + 1.5) this.installPart(p.carrying);
      // wrecks
      for (let i = 0; i < this.layout.wrecks.length; i++) {
        const w = this.layout.wrecks[i];
        const d = dist(p.x, p.z, w.x, w.z);
        if (d < 70) this.wreckSeen[i] = true;
        if (!this.wreckLooted[i] && d < 5.2) this.lootWreck(i);
      }
      // fabricator
      if (this.nearHatch && !this.structures.placing) {
        this.hud.setPrompt('<kbd>E</kbd> Fabricator — upgrades &amp; repairs');
        if (inp.pressed('interact')) this.openFabricator();
        this.pickups.vacuum(p.x, p.z, 14);
      } else if (this.structures.placing) {
        const d = this.structures.def(this.structures.placing);
        const reason = this.structures.ghostValid ? '' : ` · <span style="color:#ff8a9a">${this.structures.ghostReason}</span>`;
        this.hud.setPrompt(`<b>${d.name}</b> — <kbd>LMB</kbd> place · <kbd>RMB</kbd> cancel${reason}`);
      } else {
        this.hud.setPrompt(null);
      }
      if (p.o2Frac < 0.2 && !p.inAir && !this.launchMilestones.has('air' + Math.floor(this.playTime / 60))) {
        this.launchMilestones.add('air' + Math.floor(this.playTime / 60));
        this.messages.comms('WREN', WREN.lowAir, 'bad');
      }
    } else {
      this.hud.setPrompt(null);
      this.respawnT -= dt;
      if (this.respawnT <= 0 && this.lives > 0) {
        const h = this.ship.hatch();
        this.player.reset(h.x, h.z);
        this.fx.ring(h.x, h.z, 0.3, 5, 0x46e8ff, 0.6);
        this.fx.flash(h.x, this.player.y + 2, h.z, 0x46e8ff, 30, 12, 0.5);
        audio.play('install', { volume: 0.6 });
        this.messages.announce('RECONSTRUCTED', `${this.lives} reconstruction${this.lives === 1 ? '' : 's'} left`, 'info', 2.5);
      }
    }
    if (this.ship.hull < this.stats.shipHull * 0.25 && !this.launchMilestones.has('hull' + this.cycle.day)) {
      this.launchMilestones.add('hull' + this.cycle.day);
      this.messages.comms('WREN', WREN.shipCritical, 'bad');
    }
    const boss = this.enemies.boss;
    const engaged = !!boss && !boss.leashed;
    if (engaged !== this.bossEngaged) {
      this.bossEngaged = engaged;
      this.hud.showBoss(engaged);
      if (boss) {
        if (!engaged) this.messages.toast('The Matriarch retreats to her lair', 'info');
        this.setMusic(engaged ? 'boss' : this.cycle.phase === 'night' ? 'night' : 'explore');
      }
    }

    // --- camera ------------------------------------------------------------------------------------------------
    if (p.alive) {
      const ax = clamp(p.aimX - p.x, -12, 12) * 0.22;
      const az = clamp(p.aimZ - p.z, -9, 9) * 0.22;
      rig.target.set(p.x + ax, p.y, p.z + az);
    }
    // --- audio mix -------------------------------------------------------------------------------------------------
    audio.setListener(p.x, p.z);
    let threat = 0;
    for (const e of this.enemies.list) {
      if (e.kind === 'nest') continue;
      const d = dist(e.x, e.z, p.x, p.z);
      if (d < 26) threat += e.aggro ? (e.kind === 'brute' ? 0.3 : 0.08) : 0.02;
    }
    audio.setIntensity(clamp(threat + (this.cycle.phase === 'night' ? 0.25 : 0) + (this.launching ? 0.5 : 0), 0, 1));
    const o2 = p.o2Frac;
    this.breathLoop?.setVolume(!p.inAir && o2 < 0.35 && p.alive ? (0.35 - o2) * 2.2 : 0);
    this.windLoop?.setVolume(0.18 + this.hazards.stormLevel * 0.3 + this.cycle.darkness * 0.1);
    const hpK = p.hp / this.stats.maxHp;
    audio.setMuffled(p.alive ? clamp((p.suffocating ? 0.6 : 0) + (hpK < 0.25 ? (0.25 - hpK) * 2 : 0), 0, 0.8) : 0.5);
    this.heartT -= dt;
    if (p.alive && hpK < 0.3 && this.heartT <= 0) {
      this.heartT = 0.75 + hpK * 2;
      audio.play('heartbeat', { volume: 0.6 });
    }
    this.hud.update(dt);
    this.hints.update(dt);
  }

  private updateGameOver(dt: number, realDt: number): void {
    this.endT += realDt;
    this.updateWorldSim(dt * 0.4, false);
    const rig = this.renderer.rig;
    rig.targetDistance = 20;
    audio.setMuffled(0.5);
    this.hud.update(dt);
    if (this.endT > 2.8 && !document.getElementById('end')!.classList.contains('show')) {
      this.hud.setVisible(false);
      this.screens.showEnd(false, this.endReason);
    }
  }

  private beginOutro(): void {
    this.state = 'outro';
    this.stateT = 0;
    this.launching = false;
    this.player.model.root.visible = false;
    this.player.alive = false;
    this.hud.setVisible(false);
    this.enemies.retreat();
    audio.play('engineRoar', { volume: 1 });
    this.messages.announce('LIFT-OFF', '', 'good', 3);
  }

  private updateOutro(dt: number): void {
    this.stateT += dt;
    const t = this.stateT;
    this.ship.liftoff = clamp((t - 0.8) / 6, 0, 1);
    this.fx.shake(0.12 * (1 - this.ship.liftoff));
    const sp = this.ship.model.group.position;
    const rig = this.renderer.rig;
    const camPos = new THREE.Vector3(18, this.ship.y + 10 + sp.y * 0.35, 28);
    rig.override = { pos: camPos, look: sp.clone().add(new THREE.Vector3(0, 3, 0)) };
    this.updateWorldSim(dt, false);
    if (t > 1 && t < 1.1) this.setMusic('victory');
    if (t > 5.5 && t - dt <= 5.5) this.hud.fade(1, true, 1.6);
    if (t > 7.4 && this.state === 'outro') {
      this.state = 'victory';
      audio.play('victory');
      this.hud.fade(0, true, 2);
      rig.override = { pos: new THREE.Vector3(0, 60, 80), look: new THREE.Vector3(0, 0, 0) };
      this.screens.showEnd(true, `Escaped on day ${this.cycle.day} · ${this.difficulty.name}`);
    }
  }
}

export const lerpAngle = (a: number, b: number, t: number) => lerp(a, b, t);
export const dampV = damp;

import * as THREE from 'three';
import { BLASTER, GRENADE, PARTS, PartId, PLAYER, SHIP } from '../config';
import { angleDamp, clamp, clamp01, damp, dist, heading, rand } from '../core/math';
import { audio } from '../audio/audio';
import { playerModel, PlayerModel } from '../render/playerModel';
import { partGeo } from '../render/models';
import type { Game } from '../game';

const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _hit = new THREE.Vector3();

export class Player {
  x = 0;
  z = 0;
  y = 0;
  vx = 0;
  vz = 0;
  facing = 0;
  aimX = 0;
  aimZ = 5;
  hp = PLAYER.maxHp;
  o2 = PLAYER.o2Seconds;
  heat = 0;
  overheated = false;
  private overheatT = 0;
  private fireCd = 0;
  dashT = 0;
  dashCd = 0;
  private dashDx = 0;
  private dashDz = 1;
  iframes = 0;
  secondaryCd = 0;
  carrying: PartId | null = null;
  alive = true;
  deadT = 0;
  inAir = true;
  inShipField = true;
  lastHurt = -99;
  lastShot = -99;
  suffocating = false;
  speedMult = 1;
  private gait = 0;
  private stepT = 0;
  private bob = 0;
  private lean = 0;
  private o2WarnT = 0;
  private recoil = 0;
  readonly model: PlayerModel;
  readonly flashlight: THREE.SpotLight;
  private carryMesh: THREE.Group | null = null;
  private carryId: PartId | null = null;

  constructor(private game: Game) {
    this.model = playerModel();
    game.renderer.scene.add(this.model.root);
    this.flashlight = new THREE.SpotLight(0xdff4ff, 0, 30, 0.5, 0.45, 1.2);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.5;
    this.flashlight.shadow.camera.far = 32;
    this.flashlight.shadow.bias = -0.0008;
    this.flashlight.shadow.normalBias = 0.05;
    game.renderer.scene.add(this.flashlight, this.flashlight.target);
  }

  get stats() {
    return this.game.stats;
  }

  get dashing(): boolean {
    return this.dashT > 0;
  }

  reset(x: number, z: number): void {
    this.x = x;
    this.z = z;
    this.vx = 0;
    this.vz = 0;
    this.hp = this.stats.maxHp;
    this.o2 = this.stats.o2Max;
    this.heat = 0;
    this.overheated = false;
    this.dashT = 0;
    this.dashCd = 0;
    this.iframes = 1.5;
    this.secondaryCd = 0;
    this.alive = true;
    this.deadT = 0;
    this.model.root.visible = true;
    this.setCarry(null);
  }

  setCarry(id: PartId | null): void {
    this.carrying = id;
    if (this.carryMesh) {
      this.model.carry.remove(this.carryMesh);
      // the carried model's geometry and materials are unique to this pickup
      this.carryMesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      this.carryMesh = null;
    }
    this.carryId = id;
    if (id) {
      const g = partGeo(id);
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(g.body, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
      grp.add(new THREE.Mesh(g.glow, new THREE.MeshBasicMaterial({ color: new THREE.Color(PARTS[id].color).multiplyScalar(2.5), toneMapped: false })));
      grp.scale.setScalar(0.55);
      this.model.carry.add(grp);
      this.carryMesh = grp;
    }
  }

  /** Converts the mouse position to a world-space aim point on the player's gun plane. */
  private updateAim(): void {
    const g = this.game;
    const inp = g.input;
    if (inp.usingGamepad) {
      if (Math.abs(inp.padAimX) > 0.2 || Math.abs(inp.padAimY) > 0.2) {
        const l = Math.hypot(inp.padAimX, inp.padAimY);
        this.aimX = this.x + (inp.padAimX / l) * 9;
        this.aimZ = this.z + (inp.padAimY / l) * 9;
      } else if (Math.hypot(this.vx, this.vz) > 0.5) {
        this.aimX = this.x + this.vx;
        this.aimZ = this.z + this.vz;
      }
      return;
    }
    const cam = g.renderer.rig.camera;
    _ndc.set((inp.mouseX / window.innerWidth) * 2 - 1, -(inp.mouseY / window.innerHeight) * 2 + 1);
    _ray.setFromCamera(_ndc, cam);
    _plane.constant = -(this.y + 1.2);
    if (_ray.ray.intersectPlane(_plane, _hit)) {
      this.aimX = _hit.x;
      this.aimZ = _hit.z;
    }
  }

  hurt(amount: number, fromX: number, fromZ: number, knock = 6, source = ''): void {
    const g = this.game;
    if (!this.alive || this.iframes > 0 || this.dashT > 0 || g.state !== 'playing') return;
    const dmg = amount * g.difficulty.enemyDmg;
    this.hp -= dmg;
    this.lastHurt = g.time;
    this.iframes = PLAYER.iframes;
    const dx = this.x - fromX;
    const dz = this.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    this.vx += (dx / l) * knock;
    this.vz += (dz / l) * knock;
    g.fx.shake(clamp(0.25 + dmg / 60, 0.25, 0.7));
    g.fx.freeze(0.04);
    g.fx.sparks(this.x, this.y + 1.2, this.z, 0xff5a3a, 10, 6);
    g.hud.hurtFlash(clamp(dmg / 30, 0.35, 1));
    g.record.damageTaken += dmg;
    audio.play('playerHurt', { volume: 0.9 });
    if (this.hp <= 0) {
      this.hp = 0;
      g.onPlayerDeath(source);
    }
  }

  /** Damage over time from hazards (ignores i-frames). */
  dot(amount: number, source: string): void {
    const g = this.game;
    if (!this.alive || g.state !== 'playing') return;
    this.hp -= amount;
    this.lastHurt = g.time;
    g.record.damageTaken += amount;
    if (this.hp <= 0) {
      this.hp = 0;
      g.onPlayerDeath(source);
    }
  }

  heal(v: number): void {
    this.hp = Math.min(Math.max(this.stats.maxHp, this.hp), this.hp + v);
  }

  update(dt: number): void {
    const g = this.game;
    const st = this.stats;
    if (!this.alive) {
      this.deadT += dt;
      this.flashlight.intensity = 0;
      return;
    }
    this.updateAim();
    const inp = g.input;
    const mv = g.state === 'playing' ? inp.move() : { x: 0, y: 0 };

    // --- air & ship field -------------------------------------------------------------------------
    const shipD = dist(this.x, this.z, g.ship.x, g.ship.z);
    this.inShipField = shipD < SHIP.safeRadius;
    this.inAir = this.inShipField || g.structures.inBeaconField(this.x, this.z);
    if (this.inAir) {
      this.o2 = Math.min(st.o2Max, this.o2 + st.o2Max * PLAYER.o2Refill * dt);
      this.suffocating = false;
    } else {
      this.o2 -= dt * g.difficulty.o2Drain;
      if (this.o2 <= 0) {
        this.o2 = 0;
        this.suffocating = true;
        this.hp -= PLAYER.suffocateDps * dt;
        this.lastHurt = g.time;
        if (this.hp <= 0) {
          this.hp = 0;
          g.onPlayerDeath('suffocation');
          return;
        }
      }
      const frac = this.o2 / st.o2Max;
      if (frac < 0.25) {
        this.o2WarnT -= dt;
        if (this.o2WarnT <= 0) {
          audio.play('o2Warning', { volume: 0.5 });
          this.o2WarnT = frac < 0.1 ? 0.5 : 1.1;
        }
      }
    }
    if (this.inShipField && g.time - this.lastHurt > 1.5) this.heal(PLAYER.shipRegen * dt);
    else if (st.regen > 0 && g.time - this.lastHurt > 4) this.heal(st.regen * dt);

    // --- movement -----------------------------------------------------------------------------------
    this.iframes = Math.max(0, this.iframes - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    const hazardSlow = g.hazards.slowAt(this.x, this.z);
    let maxSpeed = st.speed * (this.carrying ? PLAYER.carrySpeedMult : 1) * hazardSlow * this.speedMult;
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.dashDx * st.dashSpeed;
      this.vz = this.dashDz * st.dashSpeed;
      if (Math.random() < 0.9) {
        g.fx.glow.spawn({ x: this.x + rand(-0.2, 0.2), y: this.y + rand(0.5, 1.5), z: this.z + rand(-0.2, 0.2), life: 0.3, size: 0.5, sizeEnd: 0.1, color: 0x46e8ff, alpha: 0.6 });
        g.fx.glow.spawn({ x: this.x - this.dashDx * 0.5, y: this.y + 1.2, z: this.z - this.dashDz * 0.5, vx: -this.dashDx * 4, vz: -this.dashDz * 4, life: 0.25, size: 0.4, sizeEnd: 0.05, color: 0xffa040 });
      }
    } else {
      const tx = mv.x * maxSpeed;
      const tz = mv.y * maxSpeed;
      const a = PLAYER.accel * dt;
      const dvx = tx - this.vx;
      const dvz = tz - this.vz;
      const dl = Math.hypot(dvx, dvz);
      if (dl <= a) {
        this.vx = tx;
        this.vz = tz;
      } else {
        this.vx += (dvx / dl) * a;
        this.vz += (dvz / dl) * a;
      }
      if (g.state === 'playing' && inp.pressed('dash') && this.dashCd <= 0) {
        let dx = mv.x;
        let dz = mv.y;
        if (Math.hypot(dx, dz) < 0.1) {
          dx = this.aimX - this.x;
          dz = this.aimZ - this.z;
        }
        const l = Math.hypot(dx, dz) || 1;
        this.dashDx = dx / l;
        this.dashDz = dz / l;
        this.dashT = PLAYER.dashTime;
        this.dashCd = st.dashCooldown;
        this.iframes = Math.max(this.iframes, PLAYER.dashTime + 0.05);
        audio.play('dash', { volume: 0.7 });
        g.fx.dust(this.x, this.z, 6, 0x9a8a7a, 0.6, 0.5);
        g.hints.done('dash');
      }
    }
    maxSpeed = Math.max(maxSpeed, 0.01);
    const p = { x: this.x + this.vx * dt, z: this.z + this.vz * dt };
    g.grid.resolve(p, PLAYER.radius);
    this.x = p.x;
    this.z = p.z;
    this.y = g.terrain.heightAt(this.x, this.z);
    const speed = Math.hypot(this.vx, this.vz);
    if (speed > 0.5) g.hints.done('move');

    // --- facing & animation ---------------------------------------------------------------------------
    const aimH = heading(this.aimX - this.x, this.aimZ - this.z);
    this.facing = angleDamp(this.facing, aimH, 22, dt);
    this.gait += dt * speed * 1.55;
    this.bob = damp(this.bob, speed > 0.5 ? 1 : 0, 8, dt);
    this.lean = damp(this.lean, this.dashT > 0 ? 1 : 0, 14, dt);
    this.recoil = damp(this.recoil, 0, 18, dt);
    const m = this.model;
    m.root.position.set(this.x, this.y, this.z);
    m.root.rotation.y = this.facing;
    const swing = Math.sin(this.gait) * 0.7 * this.bob;
    m.legL.rotation.x = swing;
    m.legR.rotation.x = -swing;
    m.armL.rotation.x = -swing * 0.5;
    m.body.position.y = Math.abs(Math.cos(this.gait)) * 0.06 * this.bob;
    m.body.rotation.x = this.lean * 0.35 + speed * 0.008;
    m.gun.position.z = 0.1 - this.recoil * 0.12;
    // heat glow on the blaster coil
    const hc = this.overheated ? 1 : this.heat;
    m.heatMat.color.setRGB(0.28 + hc * 3.2, 0.9 + hc * 0.6 - (this.overheated ? 0.7 : 0), 1.0 - hc * 0.9).multiplyScalar(1.3);
    const o2f = this.o2 / st.o2Max;
    m.tankMat.color.setRGB(o2f < 0.25 ? 3 : 0.4, o2f < 0.25 ? 0.4 : 2.2 * o2f + 0.3, o2f < 0.25 ? 0.3 : 2.6);
    // invulnerability flicker
    m.root.visible = !(this.iframes > 0 && this.iframes < PLAYER.iframes && Math.floor(g.time * 30) % 2 === 0) || this.dashT > 0;
    if (this.carryMesh) {
      this.carryMesh.rotation.y += dt * 1.6;
      this.carryMesh.position.y = Math.sin(g.time * 3) * 0.1;
      if (Math.random() < 0.3 && this.carryId) g.fx.glow.spawn({ x: this.x + rand(-0.3, 0.3), y: this.y + 2.6, z: this.z + rand(-0.3, 0.3), vy: 1, life: 0.6, size: 0.25, sizeEnd: 0, color: PARTS[this.carryId].color });
    }

    // footsteps
    if (speed > 1 && this.dashT <= 0) {
      this.stepT -= dt * speed;
      if (this.stepT <= 0) {
        this.stepT = 2.4;
        audio.play('step', { volume: 0.22 });
        if (Math.random() < 0.5) g.fx.dust(this.x, this.z, 1, 0x8a7a6a, 0.3, 0.3);
      }
    }

    // --- flashlight ---------------------------------------------------------------------------------------
    const fx = Math.sin(this.facing);
    const fz = Math.cos(this.facing);
    const night = g.cycle.darkness;
    this.flashlight.position.set(this.x + fx * 0.3, this.y + 1.5, this.z + fz * 0.3);
    this.flashlight.target.position.set(this.x + fx * 12, this.y, this.z + fz * 12);
    this.flashlight.intensity = night * (70 + st.lamp * 25);
    this.flashlight.distance = 26 + st.lamp * 5;
    this.flashlight.angle = 0.5 + st.lamp * 0.06;
    this.flashlight.shadow.autoUpdate = night > 0.05;
    if (night > 0.05) g.renderer.lights.request(this.x, this.y + 2.2, this.z, 0xbfd8ff, night * 9, 9, 50);

    // --- weapons -------------------------------------------------------------------------------------
    this.fireCd -= dt;
    if (this.overheated) {
      this.overheatT -= dt;
      this.heat = Math.max(0, this.heat - st.coolRate * 0.6 * dt);
      if (this.overheatT <= 0) {
        this.overheated = false;
        audio.play('cooled', { volume: 0.45 });
      }
    } else if (g.time - this.lastShot > 0.12) {
      this.heat = Math.max(0, this.heat - st.coolRate * dt);
    } else {
      this.heat = Math.max(0, this.heat - st.coolRate * 0.25 * dt);
    }
    const wantFire = g.state === 'playing' && !g.structures.placing && (inp.mouseDown || inp.padFire) && (!g.hud.pointerOverUi || inp.usingGamepad);
    if (wantFire && !this.overheated && this.fireCd <= 0 && this.dashT <= 0) {
      this.fire();
    }
    if (this.fireCd < 0) this.fireCd = 0;
    this.secondaryCd = Math.max(0, this.secondaryCd - dt);
    if (g.state === 'playing' && inp.rightPressed && !g.structures.placing) {
      if (this.secondaryCd <= 0) this.useSecondary();
      else audio.play('uiError', { volume: 0.3 });
    }
  }

  private muzzlePos(): { x: number; y: number; z: number } {
    const fx = Math.sin(this.facing);
    const fz = Math.cos(this.facing);
    // gun sits to the right of the body: right vector = (fz, -fx)
    return { x: this.x + fx * 0.95 + fz * 0.3, y: this.y + 1.24, z: this.z + fz * 0.95 - fx * 0.3 };
  }

  private fire(): void {
    const g = this.game;
    const st = this.stats;
    this.fireCd += 1 / st.fireRate;
    this.lastShot = g.time;
    const mp = this.muzzlePos();
    let dx = this.aimX - mp.x;
    let dz = this.aimZ - mp.z;
    // if aiming very close, use facing
    if (Math.hypot(dx, dz) < 1.2) {
      dx = Math.sin(this.facing);
      dz = Math.cos(this.facing);
    }
    const base = Math.atan2(dx, dz);
    const n = st.bolts;
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * 0.1 + rand(-BLASTER.spread, BLASTER.spread);
      g.projectiles.bolt(mp.x, mp.z, Math.sin(a), Math.cos(a), st.damage, st.pierce, 'player');
    }
    this.heat += st.heatPerShot * (n > 1 ? 1 + (n - 1) * 0.25 : 1);
    g.record.shots++;
    if (this.heat >= 1) {
      this.heat = 1;
      this.overheated = true;
      this.overheatT = BLASTER.overheatLock;
      audio.play('overheat', { volume: 0.7 });
      for (let i = 0; i < 12; i++) g.fx.smokePuff(mp.x, mp.y, mp.z, 0xd0d8e0, 0.5, 0.8, 1.5, 0.35);
      g.hints.show('overheat');
    }
    audio.play(n > 1 ? 'shootSpread' : 'shoot', { volume: 0.55 });
    this.recoil = 1;
    g.renderer.rig.addKick(-Math.sin(base) * 0.08, -Math.cos(base) * 0.08);
    g.fx.flash(mp.x, mp.y + 0.3, mp.z, 0x7fe8ff, 6, 7, 0.06);
    g.fx.glow.spawn({ x: mp.x, y: mp.y, z: mp.z, life: 0.05, size: 0.9, sizeEnd: 0.3, color: 0xbff8ff });
    for (let i = 0; i < 3; i++) {
      const s = rand(3, 8);
      g.fx.glow.spawn({ x: mp.x, y: mp.y, z: mp.z, vx: Math.sin(base + rand(-0.5, 0.5)) * s, vy: rand(0, 2), vz: Math.cos(base + rand(-0.5, 0.5)) * s, life: 0.12, size: 0.15, sizeEnd: 0.02, color: 0x7fe8ff, drag: 5 });
    }
  }

  private useSecondary(): void {
    const g = this.game;
    const st = this.stats;
    const kind = g.secondary;
    const def = g.secondaryDef;
    this.secondaryCd = st.secondaryCooldown * def.cooldownMult;
    const mp = this.muzzlePos();
    if (kind === 'grenade') {
      let dx = this.aimX - this.x;
      let dz = this.aimZ - this.z;
      const d = Math.hypot(dx, dz);
      const r = Math.min(GRENADE.range, Math.max(2.5, d));
      dx /= d || 1;
      dz /= d || 1;
      g.projectiles.grenade(mp.x, mp.y, mp.z, this.x + dx * r, this.z + dz * r, GRENADE.damage * st.secondaryDamage, GRENADE.radius);
      audio.play('grenadeThrow');
    } else if (kind === 'nova') {
      const R = 6.5;
      g.fx.ring(this.x, this.z, 0.5, R, 0x7fd8ff, 0.45);
      g.fx.ring(this.x, this.z, 0.3, R * 0.7, 0xffffff, 0.3);
      g.fx.flash(this.x, this.y + 1.5, this.z, 0x7fd8ff, 40, 16, 0.35);
      g.fx.shake(0.35);
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        g.fx.glow.spawn({ x: this.x + Math.cos(a) * 0.8, y: this.y + 0.8, z: this.z + Math.sin(a) * 0.8, vx: Math.cos(a) * 16, vz: Math.sin(a) * 16, life: 0.35, size: 0.4, sizeEnd: 0.05, color: 0x9fe8ff, drag: 3 });
      }
      g.enemies.forEachInRadius(this.x, this.z, R, (e, d) => {
        const k = 1 - d / R;
        g.enemies.damage(e, 38 * st.secondaryDamage * (0.5 + k * 0.5), this.x, this.z, 'nova');
        g.enemies.knock(e, this.x, this.z, 16 * k + 6);
        e.stun = Math.max(e.stun, 1.4);
      });
      audio.play('teslaZap', { volume: 1 });
      audio.play('explosion', { volume: 0.5, pitch: 1.4 });
    } else {
      audio.play('grenadeThrow', { pitch: 1.5 });
      for (let i = 0; i < 6; i++) {
        const a = this.facing + (i - 2.5) * 0.35;
        g.projectiles.seeker(mp.x, mp.y + 0.3, mp.z, Math.sin(a), Math.cos(a), 30 * st.secondaryDamage, i * 0.05);
      }
    }
    g.hints.done('secondary');
  }

  die(): void {
    const g = this.game;
    this.alive = false;
    this.deadT = 0;
    this.model.root.visible = false;
    g.fx.explosion(this.x, this.z, 2.5, 0x46e8ff);
    g.fx.sparks(this.x, this.y + 1, this.z, 0xffffff, 30, 10, 0.8);
    for (let i = 0; i < 20; i++) g.fx.smokePuff(this.x, this.y + 1, this.z, 0x9aa0a8, 1.2, 2, 2);
    audio.play('shieldBreak');
    audio.play('explosion', { volume: 0.7 });
  }

  get o2Frac(): number {
    return clamp01(this.o2 / this.stats.o2Max);
  }
}

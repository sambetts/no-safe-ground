import * as THREE from 'three';
import { PARTS, PartId, SHIP } from '../config';
import { angleDamp, clamp, dist, heading, rand } from '../core/math';
import { audio } from '../audio/audio';
import { SHIP_SCALE, shipModel, ShipModel } from '../render/shipModel';
import type { Game } from '../game';
import type { Enemy } from './enemies';

export class Ship {
  x = 0;
  z = 0;
  y = 0;
  rot = 0;
  hull: number = SHIP.hull;
  installed: PartId[] = [];
  readonly model: ShipModel;
  private cannonCd = 0;
  private target: Enemy | null = null;
  private smokeT = 0;
  private alertT = 0;
  private hitT = 0;
  launching = false;
  launchT = 0;
  liftoff = 0; // 0..1 during the takeoff cinematic
  private hum = { setVolume(_v: number) {}, stop() {} };

  constructor(private game: Game) {
    this.model = shipModel();
    game.renderer.scene.add(this.model.group);
  }

  init(rot: number): void {
    const g = this.game;
    this.rot = rot;
    this.y = g.terrain.heightAt(0, 0);
    this.model.group.position.set(0, this.y - 0.5, 0);
    this.model.group.rotation.set(0.04, rot, -0.06);
    this.hull = g.stats.shipHull;
    this.installed = [];
    this.launching = false;
    this.launchT = 0;
    this.liftoff = 0;
    for (const s of this.model.sockets) (s.material as THREE.MeshBasicMaterial).color.setHex(0x1a1d22);
    this.model.engineGlow.color.setHex(0xff7a2a).multiplyScalar(0.6);
    this.hum.stop();
    this.hum = audio.loop('shipHum');
    this.hum.setVolume(0);
  }

  dispose(): void {
    this.hum.stop();
  }

  /** World position of the fabricator ramp. */
  hatch(): { x: number; z: number } {
    const h = this.model.hatch.clone().multiplyScalar(SHIP_SCALE);
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    return { x: this.x + h.x * c + h.z * s, z: this.z - h.x * s + h.z * c };
  }

  local(v: THREE.Vector3): THREE.Vector3 {
    return this.model.group.localToWorld(v.clone());
  }

  damage(amount: number, fx: number, fz: number): void {
    const g = this.game;
    if (g.state !== 'playing' || this.liftoff > 0) return;
    this.hull -= amount * g.difficulty.enemyDmg;
    this.hitT -= 1;
    if (this.hitT <= 0) {
      this.hitT = 6;
      audio.play('shipHit', { x: this.x, z: this.z, volume: 0.5 });
      g.fx.sparks(fx + (this.x - fx) * 0.3, this.y + 1.5, fz + (this.z - fz) * 0.3, 0xffc070, 8, 6, 0.4);
    }
    if (g.time - this.alertT > 12) {
      this.alertT = g.time;
      audio.play('alarm', { volume: 0.5 });
      g.messages.comms('WREN', 'Something is tearing at the hull. I would appreciate some help.', 'warn');
    }
    if (this.hull <= 0) {
      this.hull = 0;
      g.onShipDestroyed();
    }
  }

  repairFull(): void {
    this.hull = this.game.stats.shipHull;
  }

  install(id: PartId): void {
    const g = this.game;
    if (this.installed.includes(id)) return;
    this.installed.push(id);
    const idx = ['coil', 'cell', 'nav', 'reactor'].indexOf(id);
    const sock = this.model.sockets[idx];
    (sock.material as THREE.MeshBasicMaterial).color.setHex(PARTS[id].color).multiplyScalar(3);
    const wp = this.local(sock.position);
    g.fx.ring(wp.x, wp.z, 0.5, 9, PARTS[id].color, 0.8, this.y);
    g.fx.flash(wp.x, wp.y + 1, wp.z, PARTS[id].color, 60, 20, 0.8);
    g.fx.sparks(wp.x, wp.y, wp.z, PARTS[id].color, 40, 9, 0.8);
    g.fx.shake(0.4);
    audio.play('install');
  }

  update(dt: number): void {
    const g = this.game;
    const night = g.cycle.darkness;
    const m = this.model;
    // beacon blink
    const blink = Math.sin(g.time * 3.2) > 0.6;
    (m.beacon.material as THREE.MeshBasicMaterial).color.setHex(blink ? 0xff2020 : 0x300505).multiplyScalar(blink ? 3.5 : 1);
    if (blink) g.renderer.lights.request(this.x, this.y + 6, this.z, 0xff3030, 6, 10, 3);
    // floodlight around the hull
    g.renderer.lights.request(this.x + 2, this.y + 5, this.z + 2, 0xffd0a0, 6 + night * 22, 20, 10);
    // hull hum volume by distance
    const pd = dist(g.player.x, g.player.z, this.x, this.z);
    this.hum.setVolume(clamp(1 - pd / 30, 0, 1) * 0.35);
    // day repair
    if (night < 0.3 && !this.launching) this.hull = Math.min(g.stats.shipHull, this.hull + SHIP.dayRepair * dt);
    // smoke from the wrecked engine: heavier when damaged
    const dmgFrac = 1 - this.hull / g.stats.shipHull;
    this.smokeT -= dt;
    if (this.smokeT <= 0 && this.liftoff === 0) {
      this.smokeT = 0.12 - dmgFrac * 0.07;
      const sp = this.local(m.smokeL);
      g.fx.smokePuff(sp.x, sp.y, sp.z, 0x3a3634, 1.3 + dmgFrac, 3.5, 2.2, 0.4);
      if (Math.random() < 0.3 + dmgFrac) g.fx.glow.spawn({ x: sp.x + rand(-0.3, 0.3), y: sp.y, z: sp.z + rand(-0.3, 0.3), vy: rand(1, 3), life: 0.5, size: 0.4, sizeEnd: 0.05, color: 0xff7a2a });
      if (dmgFrac > 0.4 && Math.random() < 0.5) {
        const s2 = this.local(m.smokeR);
        g.fx.smokePuff(s2.x, s2.y, s2.z, 0x1a1616, 1, 3, 2, 0.5);
      }
    }
    // point-defence cannon
    this.cannonCd -= dt;
    const cm = g.stats.cannonMult;
    const range = SHIP.cannonRange;
    if (!this.target || !this.target.alive || dist(this.x, this.z, this.target.x, this.target.z) > range + 1 || g.frame % 15 === 0) {
      this.target = g.enemies.nearest(this.x, this.z, range);
    }
    const cannon = m.cannon;
    const worldYaw = this.rot;
    if (this.target) {
      const want = heading(this.target.x - this.x, this.target.z - this.z) - worldYaw;
      cannon.rotation.y = angleDamp(cannon.rotation.y, want, 8, dt);
      if (this.cannonCd <= 0 && g.state === 'playing') {
        this.cannonCd = 1 / (SHIP.cannonRate * (0.6 + 0.4 * cm));
        const a = cannon.rotation.y + worldYaw;
        const cp = this.local(cannon.position);
        g.projectiles.bolt(cp.x + Math.sin(a) * 1.2, cp.z + Math.cos(a) * 1.2, Math.sin(a), Math.cos(a), SHIP.cannonDamage * cm, 0, 'ship', 42, range + 4);
        audio.play('turretShoot', { x: this.x, z: this.z, volume: 0.45, pitch: 0.8 });
      }
    } else {
      cannon.rotation.y += dt * 0.3;
    }
    // launch
    if (this.launching) {
      this.launchT += dt;
      const k = clamp(this.launchT / SHIP.launchTime, 0, 1);
      m.engineGlow.color.setRGB(1, 0.5, 0.2).multiplyScalar(0.6 + k * 5);
      if (Math.random() < 0.3 + k) {
        for (const s of [-1, 1]) {
          const ep = this.local(new THREE.Vector3(s * 1.9, 1.5, -7.6));
          g.fx.glow.spawn({ x: ep.x, y: ep.y, z: ep.z, vx: -Math.sin(this.rot) * 6 * k, vy: rand(0, 1), vz: -Math.cos(this.rot) * 6 * k, life: 0.4, size: 0.8 + k, sizeEnd: 0.2, color: 0xffa040 });
        }
      }
      g.renderer.lights.request(this.x, this.y + 2, this.z, 0xffa040, 10 + 30 * k, 18, 20);
      if (k > 0.6) g.fx.shake(0.02 * k);
    }
    if (this.liftoff > 0) {
      const k = this.liftoff;
      m.group.position.y = this.y - 0.5 + k * k * 120;
      m.group.rotation.x = 0.04 - k * 0.5;
      m.engineGlow.color.setRGB(1, 0.6, 0.3).multiplyScalar(8);
      for (let i = 0; i < 4; i++) {
        const ep = this.local(new THREE.Vector3(rand(-2, 2), 1.5, -7.6));
        g.fx.glow.spawn({ x: ep.x, y: ep.y, z: ep.z, vy: -20, vx: rand(-3, 3), vz: rand(-3, 3), life: 0.6, size: 2.5, sizeEnd: 0.5, color: 0xffb060 });
        g.fx.smokePuff(ep.x, ep.y - 2, ep.z, 0x5a5050, 3, 3, -1, 0.4);
      }
    }
  }
}

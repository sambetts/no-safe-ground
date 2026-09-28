import * as THREE from 'three';
import { CYCLE } from '../config';
import { clamp, lerp, smoothstep } from '../core/math';
import { shared } from '../render/materials';
import type { Renderer } from '../render/renderer';

export type Phase = 'day' | 'dusk' | 'night' | 'dawn';

interface Look {
  sun: THREE.Color;
  sunI: number;
  sky: THREE.Color;
  ground: THREE.Color;
  hemiI: number;
  amb: number;
  fog: THREE.Color;
  fogD: number;
  exposure: number;
  night: number;
  zenith: THREE.Color;
}

const look = (sun: number, sunI: number, sky: number, ground: number, hemiI: number, amb: number, fog: number, fogD: number, exposure: number, night: number, zenith = 0x000000): Look => ({
  sun: new THREE.Color(sun),
  sunI,
  sky: new THREE.Color(sky),
  ground: new THREE.Color(ground),
  hemiI,
  amb,
  fog: new THREE.Color(fog),
  fogD,
  exposure,
  night,
  zenith: new THREE.Color(zenith),
});

const DAY = look(0xfff0dc, 2.4, 0xc0d0ff, 0x6a4a3a, 1.0, 0.12, 0xa89a8e, 0.0042, 1.12, 0, 0x3a5a7a);
const DUSK = look(0xff6a3a, 1.8, 0xff8a7a, 0x3a1a2a, 0.65, 0.08, 0x9a4a4a, 0.0062, 1.05, 0.3, 0x2a1638);
const NIGHT = look(0x6a7cff, 0.34, 0x2c3068, 0x0a0812, 0.3, 0.05, 0x07070f, 0.019, 1.15, 1, 0x010108);
const DAWN = look(0xffa070, 1.4, 0xb890c0, 0x3a2a2a, 0.62, 0.08, 0x7a5a70, 0.0075, 1.05, 0.3, 0x2a2a4a);
const STORM_FOG = new THREE.Color(0x3a2a2a);

const mix = (a: Look, b: Look, t: number, out: Look): Look => {
  out.sun.copy(a.sun).lerp(b.sun, t);
  out.sunI = lerp(a.sunI, b.sunI, t);
  out.sky.copy(a.sky).lerp(b.sky, t);
  out.ground.copy(a.ground).lerp(b.ground, t);
  out.hemiI = lerp(a.hemiI, b.hemiI, t);
  out.amb = lerp(a.amb, b.amb, t);
  out.fog.copy(a.fog).lerp(b.fog, t);
  out.fogD = lerp(a.fogD, b.fogD, t);
  out.exposure = lerp(a.exposure, b.exposure, t);
  out.night = lerp(a.night, b.night, t);
  out.zenith.copy(a.zenith).lerp(b.zenith, t);
  return out;
};

const cur = look(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
const sunDir = new THREE.Vector3();
const moonDir = new THREE.Vector3(-0.35, 0.85, -0.4).normalize();

/** Day/night cycle: drives phase events and the whole lighting mood. */
export class Cycle {
  day = 1;
  phase: Phase = 'day';
  t = 0;
  darkness = 0;
  /** Optional override for cinematics (title screen): fixed phase + progress. */
  frozen: { phase: Phase; k: number } | null = null;

  reset(): void {
    this.day = 1;
    this.phase = 'day';
    this.t = 0;
    this.darkness = 0;
  }

  length(phase: Phase = this.phase): number {
    if (phase === 'day') return this.day === 1 ? CYCLE.firstDay : CYCLE.day;
    return CYCLE[phase];
  }

  get progress(): number {
    return clamp(this.t / this.length(), 0, 1);
  }

  get timeLeft(): number {
    return Math.max(0, this.length() - this.t);
  }

  /** Seconds until night starts (0 during night). */
  timeToNight(): number {
    if (this.phase === 'day') return this.timeLeft + CYCLE.dusk;
    if (this.phase === 'dusk') return this.timeLeft;
    return 0;
  }

  /** Advances time and returns the new phase if a transition happened. */
  update(dt: number): Phase | null {
    if (this.frozen) return null;
    this.t += dt;
    if (this.t < this.length()) return null;
    this.t -= this.length();
    const order: Phase[] = ['day', 'dusk', 'night', 'dawn'];
    const next = order[(order.indexOf(this.phase) + 1) % 4];
    if (next === 'day') this.day++;
    this.phase = next;
    return next;
  }

  /** Skip straight to a phase (debug / launch sequence). */
  set(phase: Phase, t = 0): void {
    this.phase = phase;
    this.t = t;
  }

  apply(r: Renderer, fx: number, fz: number, storm: number): void {
    const phase = this.frozen?.phase ?? this.phase;
    const k = this.frozen?.k ?? this.progress;
    let elev = 0.9;
    let az = 0;
    switch (phase) {
      case 'day':
        mix(DAY, DAY, 0, cur);
        elev = 0.45 + Math.sin(k * Math.PI) * 0.6;
        az = lerp(-1.3, 1.1, k);
        break;
      case 'dusk':
        if (k < 0.5) mix(DAY, DUSK, smoothstep(0, 0.5, k), cur);
        else mix(DUSK, NIGHT, smoothstep(0.5, 1, k), cur);
        elev = lerp(0.45, 0.12, k);
        az = lerp(1.1, 1.5, k);
        break;
      case 'night':
        mix(NIGHT, NIGHT, 0, cur);
        break;
      case 'dawn':
        if (k < 0.5) mix(NIGHT, DAWN, smoothstep(0, 0.5, k), cur);
        else mix(DAWN, DAY, smoothstep(0.5, 1, k), cur);
        elev = lerp(0.15, 0.45, k);
        az = -1.3;
        break;
    }
    sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev) * 0.6 + 0.35).normalize();
    // blend toward the moon as night falls
    const moonW = phase === 'night' ? 1 : phase === 'dusk' ? smoothstep(0.55, 1, k) : phase === 'dawn' ? 1 - smoothstep(0, 0.45, k) : 0;
    sunDir.lerp(moonDir, moonW).normalize();
    if (storm > 0) {
      cur.sunI *= 1 - storm * 0.55;
      cur.hemiI *= 1 - storm * 0.3;
      cur.fog.lerp(STORM_FOG, storm * 0.6 * (1 - cur.night));
      cur.fogD += storm * 0.006;
    }
    r.sun.color.copy(cur.sun);
    r.sun.intensity = cur.sunI;
    r.sun.position.set(fx + sunDir.x * 90, sunDir.y * 90, fz + sunDir.z * 90);
    r.sun.target.position.set(fx, 0, fz);
    r.hemi.color.copy(cur.sky);
    r.hemi.groundColor.copy(cur.ground);
    r.hemi.intensity = cur.hemiI;
    r.ambient.intensity = cur.amb;
    r.fog.color.copy(cur.fog);
    r.fog.density = cur.fogD;
    (r.scene.background as THREE.Color).copy(cur.fog);
    r.renderer.toneMappingExposure = cur.exposure;
    const su = r.sky.uniforms;
    su.uHorizon.value.copy(cur.fog);
    su.uZenith.value.copy(cur.zenith);
    if (storm > 0) su.uZenith.value.lerp(STORM_FOG, storm * 0.5);
    su.uSunDir.value.copy(sunDir);
    su.uSunColor.value.copy(cur.sun);
    su.uNight.value = cur.night;
    this.darkness = cur.night;
    shared.uNight.value = cur.night;
  }
}

import * as THREE from 'three';
import { rand } from '../core/math';
import { Decals, makeSplatTexture, ParticleSystem } from '../render/particles';
import type { Renderer } from '../render/renderer';
import type { Terrain } from '../world/terrain';

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  r0: number;
  r1: number;
  active: boolean;
}

interface Arc {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  mat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  active: boolean;
}

const ARC_SEGS = 12;
const toCam = new THREE.Vector3(0, 0.83, 0.55).normalize();

/** Visual effects toolkit: particles, decals, shockwave rings, electric arcs, light flashes, shake. */
export class Fx {
  readonly glow: ParticleSystem; // additive sparks / fire / energy
  readonly smoke: ParticleSystem; // alpha-blended dust / smoke / ichor droplets
  readonly splats: Decals;
  readonly lightDecals: Decals;
  private rings: Ring[] = [];
  private arcs: Arc[] = [];
  hitstop = 0;
  shakeScale = 1;

  constructor(
    private r: Renderer,
    public terrain: Terrain,
  ) {
    this.glow = new ParticleSystem(5000, true);
    this.smoke = new ParticleSystem(3000, false);
    r.scene.add(this.glow.points, this.smoke.points);
    this.splats = new Decals(260, makeSplatTexture(7), false);
    this.lightDecals = new Decals(90, makeSplatTexture(3, true), true);
    r.scene.add(this.splats.mesh, this.lightDecals.mesh);
    const ringGeo = new THREE.RingGeometry(0.86, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 21;
      r.scene.add(mesh);
      this.rings.push({ mesh, mat, t: 0, dur: 1, r0: 0, r1: 1, active: false });
    }
    for (let i = 0; i < 24; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ARC_SEGS + 1) * 2 * 3), 3));
      const idx: number[] = [];
      for (let s = 0; s < ARC_SEGS; s++) {
        const a = s * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      geo.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 22;
      r.scene.add(mesh);
      this.arcs.push({ mesh, geo, mat, t: 0, dur: 0.15, active: false });
    }
  }

  h(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  update(dt: number): void {
    this.glow.uniforms.uScale.value = this.r.pointScale;
    this.smoke.uniforms.uScale.value = this.r.pointScale;
    this.glow.update(dt);
    this.smoke.update(dt);
    this.splats.update(dt);
    this.lightDecals.update(dt);
    for (const g of this.rings) {
      if (!g.active) continue;
      g.t += dt;
      const k = g.t / g.dur;
      if (k >= 1) {
        g.active = false;
        g.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      const s = g.r0 + (g.r1 - g.r0) * e;
      g.mesh.scale.set(s, 1, s);
      g.mat.opacity = (1 - k) * (1 - k);
    }
    for (const a of this.arcs) {
      if (!a.active) continue;
      a.t += dt;
      if (a.t >= a.dur) {
        a.active = false;
        a.mesh.visible = false;
        continue;
      }
      a.mat.opacity = 1 - a.t / a.dur;
    }
  }

  shake(v: number): void {
    this.r.rig.addTrauma(v * this.shakeScale);
  }

  freeze(t: number): void {
    this.hitstop = Math.max(this.hitstop, t);
  }

  ring(x: number, z: number, r0: number, r1: number, color: THREE.ColorRepresentation, dur = 0.45, y?: number): void {
    const g = this.rings.find((q) => !q.active) ?? this.rings[0];
    g.active = true;
    g.t = 0;
    g.dur = dur;
    g.r0 = r0;
    g.r1 = r1;
    g.mat.color.set(color);
    g.mesh.position.set(x, (y ?? this.h(x, z)) + 0.15, z);
    g.mesh.scale.set(r0, 1, r0);
    g.mesh.visible = true;
  }

  /** Jagged electric arc between two points. */
  arc(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, color: THREE.ColorRepresentation, width = 0.12, dur = 0.14, jag = 0.5): void {
    const a = this.arcs.find((q) => !q.active) ?? this.arcs[0];
    a.active = true;
    a.t = 0;
    a.dur = dur;
    a.mat.color.set(color);
    a.mat.opacity = 1;
    const pos = a.geo.getAttribute('position') as THREE.BufferAttribute;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const side = new THREE.Vector3().crossVectors(dir, toCam).normalize();
    if (side.lengthSq() < 0.01) side.set(1, 0, 0);
    for (let s = 0; s <= ARC_SEGS; s++) {
      const t = s / ARC_SEGS;
      const off = s === 0 || s === ARC_SEGS ? 0 : rand(-jag, jag);
      const offY = s === 0 || s === ARC_SEGS ? 0 : rand(-jag, jag) * 0.5;
      const px = x1 + dx * t + side.x * off;
      const py = y1 + dy * t + offY;
      const pz = z1 + dz * t + side.z * off;
      const w = width * (1 - Math.abs(t - 0.5) * 0.8);
      pos.setXYZ(s * 2, px - side.x * w, py - side.y * w, pz - side.z * w);
      pos.setXYZ(s * 2 + 1, px + side.x * w, py + side.y * w, pz + side.z * w);
    }
    pos.needsUpdate = true;
    a.geo.computeBoundingSphere();
    a.mesh.visible = true;
  }

  flash(x: number, y: number, z: number, color: THREE.ColorRepresentation, intensity: number, distance: number, dur: number): void {
    this.r.lights.flash(x, y, z, color, intensity, distance, dur);
  }

  sparks(x: number, y: number, z: number, color: THREE.ColorRepresentation, count: number, speed: number, life = 0.35, size = 0.22): void {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = speed * rand(0.3, 1);
      this.glow.spawn({ x, y, z, vx: Math.cos(a) * s, vy: rand(0.5, 1.5) * speed * 0.6, vz: Math.sin(a) * s, life: life * rand(0.6, 1.2), size, sizeEnd: 0.02, color, gravity: 14, drag: 2, ground: this.h(x, z) + 0.05 });
    }
  }

  /** Directional spark spray (e.g. bolt impacts). */
  spray(x: number, y: number, z: number, dx: number, dz: number, color: THREE.ColorRepresentation, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const s = speed * rand(0.3, 1);
      this.glow.spawn({
        x,
        y,
        z,
        vx: dx * s + rand(-1, 1) * speed * 0.5,
        vy: rand(0.2, 1.2) * speed * 0.5,
        vz: dz * s + rand(-1, 1) * speed * 0.5,
        life: rand(0.15, 0.35),
        size: 0.18,
        sizeEnd: 0.02,
        color,
        gravity: 16,
        drag: 3,
        ground: this.h(x, z) + 0.05,
      });
    }
  }

  ichor(x: number, y: number, z: number, color: THREE.ColorRepresentation, glowColor: THREE.ColorRepresentation, count: number, splat = 0): void {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(1.5, 6);
      this.smoke.spawn({ x, y, z, vx: Math.cos(a) * s, vy: rand(2, 6), vz: Math.sin(a) * s, life: rand(0.4, 0.8), size: rand(0.18, 0.35), sizeEnd: 0.08, color, gravity: 18, drag: 1, ground: this.h(x, z) + 0.05 });
    }
    for (let i = 0; i < count / 2; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(1, 4);
      this.glow.spawn({ x, y, z, vx: Math.cos(a) * s, vy: rand(1, 4), vz: Math.sin(a) * s, life: rand(0.3, 0.6), size: 0.25, sizeEnd: 0.02, color: glowColor, gravity: 10, drag: 2 });
    }
    if (splat > 0) this.splats.add(x, this.h(x, z) + 0.04, z, splat * rand(0.8, 1.2), color, 0.85, 45);
  }

  dust(x: number, z: number, count: number, color: THREE.ColorRepresentation = 0x8a7a6a, spread = 1, up = 1.5): void {
    const y = this.h(x, z);
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(0.5, 2.5) * spread;
      this.smoke.spawn({ x: x + Math.cos(a) * 0.3 * spread, y: y + 0.2, z: z + Math.sin(a) * 0.3 * spread, vx: Math.cos(a) * s, vy: rand(0.3, 1) * up, vz: Math.sin(a) * s, life: rand(0.6, 1.3), size: rand(0.6, 1.1) * spread, sizeEnd: rand(1.4, 2.2) * spread, color, alpha: 0.5, drag: 2.5 });
    }
  }

  smokePuff(x: number, y: number, z: number, color: THREE.ColorRepresentation, size: number, life: number, rise = 1.2, alpha = 0.55): void {
    this.smoke.spawn({ x: x + rand(-0.2, 0.2), y, z: z + rand(-0.2, 0.2), vx: rand(-0.4, 0.4), vy: rise * rand(0.7, 1.3), vz: rand(-0.4, 0.4), life, size: size * 0.6, sizeEnd: size * 1.6, color, alpha, drag: 0.5 });
  }

  explosion(x: number, z: number, radius: number, core: THREE.ColorRepresentation = 0xffa040, big = false): void {
    const y = this.h(x, z) + 0.6;
    const n = big ? 70 : 40;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(2, 9) * (radius / 3);
      this.glow.spawn({ x, y, z, vx: Math.cos(a) * s, vy: rand(1, 7), vz: Math.sin(a) * s, life: rand(0.25, 0.7), size: rand(0.5, 1.1) * (radius / 3), sizeEnd: 0.05, color: core, colorEnd: 0xff3010, gravity: 6, drag: 3 });
    }
    for (let i = 0; i < n / 2; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(1, 4) * (radius / 3);
      this.smoke.spawn({ x, y, z, vx: Math.cos(a) * s, vy: rand(1, 3), vz: Math.sin(a) * s, life: rand(0.8, 1.8), size: rand(1, 1.6) * (radius / 3), sizeEnd: rand(2.5, 3.5) * (radius / 3), color: 0x2a2626, alpha: 0.6, drag: 2 });
    }
    this.sparks(x, y, z, 0xffe0a0, big ? 30 : 16, 12, 0.6, 0.16);
    this.ring(x, z, 0.5, radius * 1.25, core, 0.4);
    this.flash(x, y + 1.5, z, core, big ? 60 : 30, radius * 5, big ? 0.5 : 0.3);
    this.splats.add(x, this.h(x, z) + 0.03, z, radius * 1.8, 0x0b0908, 0.8, 60);
    this.shake(big ? 0.7 : 0.35);
  }
}

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';

// Procedural low-poly model library. Every model is a merged, flat-shaded, vertex-coloured BufferGeometry
// with an `aRig` attribute (legPhase, legAmp, pulseWeight) consumed by the creature material.

export type Rig = [number, number, number];
type V3 = [number, number, number];

export interface PartOpts {
  p?: V3;
  r?: V3;
  s?: V3 | number;
  rig?: Rig | ((x: number, y: number, z: number) => Rig);
  jitter?: number;
  seed?: number;
  shade?: number; // random per-vertex brightness variation
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

export function part(src: THREE.BufferGeometry, color: number | THREE.Color, o: PartOpts = {}): THREE.BufferGeometry {
  let geo = src.clone();
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  if (o.jitter) {
    geo = mergeVertices(geo, 1e-4);
    const rng = new Rng(o.seed ?? 1);
    const pa = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      pa.setXYZ(
        i,
        pa.getX(i) * (1 + rng.range(-o.jitter, o.jitter)),
        pa.getY(i) * (1 + rng.range(-o.jitter, o.jitter)),
        pa.getZ(i) * (1 + rng.range(-o.jitter, o.jitter)),
      );
    }
  }
  if (geo.index) geo = geo.toNonIndexed();
  const s = o.s === undefined ? [1, 1, 1] : typeof o.s === 'number' ? [o.s, o.s, o.s] : o.s;
  tmpE.set(o.r?.[0] ?? 0, o.r?.[1] ?? 0, o.r?.[2] ?? 0);
  tmpQ.setFromEuler(tmpE);
  tmpV.set(o.p?.[0] ?? 0, o.p?.[1] ?? 0, o.p?.[2] ?? 0);
  tmpS.set(s[0], s[1], s[2]);
  tmpM.compose(tmpV, tmpQ, tmpS);
  geo.applyMatrix4(tmpM);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const rig = new Float32Array(n * 3);
  tmpC.set(color);
  const rng = new Rng((o.seed ?? 7) * 31 + n);
  for (let i = 0; i < n; i += 3) {
    // per-face shade variation for a hand-made low-poly feel
    const sh = 1 + (o.shade ? rng.range(-o.shade, o.shade) : 0);
    for (let k = 0; k < 3 && i + k < n; k++) {
      col[(i + k) * 3] = tmpC.r * sh;
      col[(i + k) * 3 + 1] = tmpC.g * sh;
      col[(i + k) * 3 + 2] = tmpC.b * sh;
    }
  }
  for (let i = 0; i < n; i++) {
    let r: Rig = [0, 0, 0];
    if (typeof o.rig === 'function') r = o.rig(pos.getX(i), pos.getY(i), pos.getZ(i));
    else if (o.rig) r = o.rig;
    rig[i * 3] = r[0];
    rig[i * 3 + 1] = r[1];
    rig[i * 3 + 2] = r[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aRig', new THREE.BufferAttribute(rig, 3));
  return geo;
}

export function build(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('mergeGeometries failed');
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// primitive shorthands
const sphere = (d = 1) => new THREE.IcosahedronGeometry(1, d);
const box = () => new THREE.BoxGeometry(1, 1, 1);
const cyl = (seg = 6, top = 1, bottom = 1) => new THREE.CylinderGeometry(top, bottom, 1, seg);
const cone = (seg = 5) => new THREE.ConeGeometry(1, 1, seg);
const octa = () => new THREE.OctahedronGeometry(1, 0);
const torus = (r = 1, t = 0.2, rs = 5, ts = 10) => new THREE.TorusGeometry(r, t, rs, ts);

// ---------------------------------------------------------------------------------------------------
// Creatures. Models face +Z. Unit ~ metres.

export interface CreatureModel {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
}

/** Leg rig helper: phase alternates for a tripod gait, amplitude grows toward the foot. */
const legRig = (phase: number, hipX: number, reach: number, amp = 1) => (x: number): Rig => {
  const t = Math.min(1, Math.max(0, (Math.abs(x) - hipX) / reach));
  return [phase, t * amp, 0];
};

function legPair(
  parts: THREE.BufferGeometry[],
  color: number,
  z: number,
  y: number,
  hipX: number,
  len1: number,
  len2: number,
  thick: number,
  phase: number,
  spreadZ = 0,
) {
  for (const side of [-1, 1]) {
    const ph = side < 0 ? phase : phase + Math.PI;
    const upX = hipX + len1 * 0.5 * Math.cos(0.6);
    const upY = y + len1 * 0.5 * Math.sin(0.6);
    const kneeX = hipX + len1 * Math.cos(0.6);
    const kneeY = y + len1 * Math.sin(0.6);
    const rig = legRig(ph, hipX, len1 + len2 * 0.7);
    parts.push(
      part(box(), color, {
        p: [side * upX, upY, z + spreadZ * 0.5],
        r: [0, side * -spreadZ * 0.4, side * 0.6],
        s: [len1, thick, thick],
        rig,
      }),
    );
    parts.push(
      part(box(), color, {
        p: [side * (kneeX + len2 * 0.28), kneeY - len2 * 0.45, z + spreadZ],
        r: [0, side * -spreadZ * 0.4, side * -1.1],
        s: [len2, thick * 0.8, thick * 0.8],
        rig,
      }),
    );
  }
}

export function skitterModel(): CreatureModel {
  const p: THREE.BufferGeometry[] = [];
  const g: THREE.BufferGeometry[] = [];
  const chitin = 0x2b2233;
  const chitin2 = 0x3d2f47;
  p.push(part(sphere(1), chitin, { p: [0, 0.45, -0.15], s: [0.42, 0.26, 0.55], shade: 0.12, seed: 2 }));
  p.push(part(sphere(1), chitin2, { p: [0, 0.5, 0.35], s: [0.28, 0.2, 0.26], shade: 0.1, seed: 3 }));
  // dorsal spikes
  for (let i = 0; i < 3; i++) p.push(part(cone(4), 0x4b3b55, { p: [0, 0.72 - i * 0.03, -0.05 - i * 0.22], r: [-0.5, 0, 0], s: [0.07, 0.22, 0.07] }));
  // mandibles
  for (const s of [-1, 1]) p.push(part(cone(4), 0xc9b79a, { p: [s * 0.11, 0.42, 0.62], r: [1.4, 0, s * 0.3], s: [0.05, 0.2, 0.05] }));
  legPair(p, chitin, 0.22, 0.42, 0.2, 0.42, 0.5, 0.06, 0, 0.25);
  legPair(p, chitin, -0.05, 0.42, 0.22, 0.46, 0.5, 0.06, Math.PI, 0);
  legPair(p, chitin, -0.32, 0.42, 0.2, 0.42, 0.5, 0.06, 0, -0.25);
  // eyes
  for (const [x, y] of [[-0.1, 0.6], [0.1, 0.6], [-0.18, 0.53], [0.18, 0.53]] as const)
    g.push(part(sphere(0), 0xff2d6a, { p: [x, y, 0.55], s: 0.05 }));
  // glowing abdomen stripe
  g.push(part(sphere(1), 0xff2d6a, { p: [0, 0.55, -0.55], s: [0.12, 0.08, 0.14], rig: [0, 0, 1] }));
  return { body: build(p), glow: build(g) };
}

export function spitterModel(): CreatureModel {
  const p: THREE.BufferGeometry[] = [];
  const g: THREE.BufferGeometry[] = [];
  const hide = 0x2c3a24;
  // abdomen sac (translucent-ish look via glow core)
  p.push(part(sphere(1), 0x3d5a2a, { p: [0, 0.95, -0.45], s: [0.55, 0.5, 0.62], shade: 0.1, rig: [0, 0, 1], seed: 4 }));
  g.push(part(sphere(1), 0x8dff3a, { p: [0, 1.08, -0.5], s: [0.3, 0.28, 0.34], rig: [0, 0, 1] }));
  // thorax + neck + head
  p.push(part(sphere(1), hide, { p: [0, 0.8, 0.15], s: [0.32, 0.28, 0.36], shade: 0.1 }));
  p.push(part(cyl(6, 0.12, 0.16), hide, { p: [0, 1.05, 0.45], r: [0.7, 0, 0], s: [1, 0.45, 1] }));
  p.push(part(sphere(1), 0x3a4a2c, { p: [0, 1.2, 0.62], s: [0.22, 0.2, 0.26] }));
  p.push(part(cyl(6, 0.09, 0.13), 0x1c2414, { p: [0, 1.2, 0.85], r: [Math.PI / 2, 0, 0], s: [1, 0.22, 1] }));
  g.push(part(sphere(0), 0xc6ff4a, { p: [0, 1.2, 0.97], s: 0.07 }));
  for (const s of [-1, 1]) g.push(part(sphere(0), 0xfff04a, { p: [s * 0.13, 1.3, 0.72], s: 0.05 }));
  legPair(p, hide, 0.2, 0.75, 0.22, 0.55, 0.8, 0.08, 0, 0.3);
  legPair(p, hide, -0.35, 0.75, 0.25, 0.55, 0.8, 0.08, Math.PI, -0.3);
  return { body: build(p), glow: build(g) };
}

export function bruteModel(): CreatureModel {
  const p: THREE.BufferGeometry[] = [];
  const g: THREE.BufferGeometry[] = [];
  const hide = 0x3b2a26;
  const bone = 0xc2b08c;
  p.push(part(sphere(1), hide, { p: [0, 1.5, -0.2], s: [1.05, 0.95, 1.35], shade: 0.12, jitter: 0.08, seed: 9 }));
  p.push(part(sphere(1), hide, { p: [0, 1.25, 1.0], s: [0.62, 0.55, 0.6], shade: 0.1, seed: 10 }));
  // armour plates along the back
  for (let i = 0; i < 4; i++)
    p.push(part(box(), bone, { p: [0, 2.35 - i * 0.08, 0.5 - i * 0.45], r: [-0.25, 0, 0], s: [1.1 - i * 0.12, 0.18, 0.5], shade: 0.1 }));
  // horns
  for (const s of [-1, 1]) {
    p.push(part(cone(5), bone, { p: [s * 0.45, 1.6, 1.35], r: [1.2, 0, s * -0.5], s: [0.16, 0.8, 0.16] }));
    p.push(part(cone(5), bone, { p: [s * 0.25, 1.05, 1.55], r: [1.7, 0, s * -0.2], s: [0.1, 0.45, 0.1] }));
  }
  // legs (thick)
  for (const [z, ph] of [[0.7, 0], [-0.9, Math.PI]] as const) {
    for (const side of [-1, 1]) {
      const phase = side < 0 ? ph : ph + Math.PI;
      const rig = (x: number, y: number): Rig => [phase, Math.min(1, Math.max(0, (1.2 - y) / 1.2)) * 0.9, 0];
      p.push(part(cyl(6, 0.28, 0.2), hide, { p: [side * 0.85, 0.7, z], r: [0, 0, side * 0.25], s: [1, 1.5, 1], rig }));
      p.push(part(box(), bone, { p: [side * 0.95, 0.08, z + 0.15], s: [0.38, 0.16, 0.55], rig }));
    }
  }
  // eyes + back vents (vents glow hot during the charge wind-up)
  for (const s of [-1, 1]) g.push(part(sphere(0), 0xffa21a, { p: [s * 0.3, 1.4, 1.52], s: 0.09 }));
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) g.push(part(box(), 0xff4a1a, { p: [s * 0.45, 2.05 - i * 0.1, 0.1 - i * 0.45], r: [-0.3, 0, s * 0.35], s: [0.3, 0.08, 0.2], rig: [0, 0, 1] }));
  return { body: build(p), glow: build(g) };
}

export function burrowerModel(): CreatureModel {
  const p: THREE.BufferGeometry[] = [];
  const g: THREE.BufferGeometry[] = [];
  const skin = 0x6a4a3a;
  for (let i = 0; i < 5; i++) {
    const r = 0.55 - i * 0.07;
    p.push(part(sphere(1), i % 2 ? skin : 0x7d5a44, { p: [0, 0.5 + i * 0.05, -i * 0.55], s: [r, r * 0.9, r * 1.05], shade: 0.1, rig: (x, y, z) => [i * 0.9, 0, 0.4] }));
  }
  // head with jaw ring
  p.push(part(cyl(8, 0.62, 0.5), 0x4a2e24, { p: [0, 0.55, 0.45], r: [Math.PI / 2, 0, 0], s: [1, 0.4, 1] }));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.push(part(cone(4), 0xe8dcc0, { p: [Math.cos(a) * 0.45, 0.55 + Math.sin(a) * 0.45, 0.7], r: [Math.PI / 2 - 0.5 * Math.sin(a), 0, -0.5 * Math.cos(a)], s: [0.07, 0.3, 0.07] }));
  }
  g.push(part(cyl(8, 0.4, 0.4), 0xff6a2a, { p: [0, 0.55, 0.6], r: [Math.PI / 2, 0, 0], s: [1, 0.05, 1] }));
  return { body: build(p), glow: build(g) };
}

export function floaterModel(): CreatureModel {
  const p: THREE.BufferGeometry[] = [];
  const g: THREE.BufferGeometry[] = [];
  const bell = new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  p.push(part(bell, 0x5b2d6b, { p: [0, 2.3, 0], s: [0.8, 0.6, 0.8], shade: 0.1, rig: [0, 0, 1] }));
  g.push(part(sphere(1), 0xd66bff, { p: [0, 2.45, 0], s: [0.42, 0.34, 0.42], rig: [0, 0, 1] }));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const r = 0.5;
    const rig = (x: number, y: number): Rig => [i * 1.3, Math.min(1, Math.max(0, (2.3 - y) / 1.6)) * 0.8, 0];
    p.push(part(cyl(4, 0.05, 0.02), 0x8a4a9a, { p: [Math.cos(a) * r, 1.55, Math.sin(a) * r], s: [1, 1.5, 1], rig }));
    g.push(part(sphere(0), 0xf08aff, { p: [Math.cos(a) * r, 0.85, Math.sin(a) * r], s: 0.05, rig }));
  }
  return { body: build(p), glow: build(g) };
}

export function nestModel(): CreatureModel {
  const p: THREE.BufferGeometry[] = [];
  const g: THREE.BufferGeometry[] = [];
  const flesh = 0x5e1f2c;
  const rng = new Rng(77);
  p.push(part(sphere(1), flesh, { p: [0, 0.9, 0], s: [1.9, 1.5, 1.9], jitter: 0.12, seed: 21, shade: 0.12, rig: [0, 0, 0.6] }));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng.range(-0.3, 0.3);
    p.push(part(sphere(1), 0x732837, { p: [Math.cos(a) * 1.7, 0.5, Math.sin(a) * 1.7], s: rng.range(0.5, 0.9), jitter: 0.15, seed: 30 + i, shade: 0.1, rig: [0, 0, 0.4] }));
    p.push(part(cone(5), 0xd8c9a8, { p: [Math.cos(a) * 1.3, 1.9, Math.sin(a) * 1.3], r: [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6], s: [0.12, 1.1, 0.12] }));
  }
  g.push(part(sphere(1), 0xff3355, { p: [0, 2.25, 0], s: [0.55, 0.3, 0.55], rig: [0, 0, 1] }));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.push(part(sphere(0), 0xff5a7a, { p: [Math.cos(a) * 1.4, 1.2, Math.sin(a) * 1.4], s: 0.18, rig: [0, 0, 1] }));
  }
  return { body: build(p), glow: build(g) };
}

export function matriarchModel(): CreatureModel {
  const p: THREE.BufferGeometry[] = [];
  const g: THREE.BufferGeometry[] = [];
  const chitin = 0x2a1b2a;
  const plate = 0x4a2a3a;
  const bone = 0xd9c7a2;
  p.push(part(sphere(1), chitin, { p: [0, 2.6, -2.4], s: [2.5, 2.1, 3.0], jitter: 0.06, seed: 41, shade: 0.1, rig: [0, 0, 0.5] }));
  g.push(part(sphere(1), 0xff2d55, { p: [0, 3.4, -2.6], s: [1.5, 1.1, 1.8], rig: [0, 0, 1] }));
  p.push(part(sphere(1), plate, { p: [0, 2.3, 0.6], s: [1.6, 1.3, 1.7], shade: 0.1, seed: 42 }));
  p.push(part(sphere(1), chitin, { p: [0, 2.4, 2.3], s: [1.05, 0.9, 1.1], shade: 0.1, seed: 43 }));
  // crown of spikes
  for (let i = 0; i < 7; i++) {
    const a = -1.2 + (i / 6) * 2.4;
    p.push(part(cone(5), bone, { p: [Math.sin(a) * 0.9, 3.2, 2.1 + Math.cos(a) * 0.2], r: [-0.4, 0, -a * 0.6], s: [0.18, 1.3 - Math.abs(a) * 0.3, 0.18] }));
  }
  // mandible tusks
  for (const s of [-1, 1]) p.push(part(cone(5), bone, { p: [s * 0.55, 2.0, 3.3], r: [1.9, 0, s * 0.3], s: [0.2, 1.3, 0.2] }));
  // 8 legs
  for (let i = 0; i < 4; i++) {
    const z = 1.6 - i * 1.1;
    const ph = i % 2 ? Math.PI : 0;
    legPair(p, plate, z, 2.2, 1.2, 2.2, 2.9, 0.26, ph, (1.5 - i) * 0.35);
  }
  // eyes
  for (let i = 0; i < 6; i++) {
    const x = (i % 3 - 1) * 0.35;
    const y = 2.6 + Math.floor(i / 3) * 0.28;
    g.push(part(sphere(0), 0xffe14a, { p: [x, y, 3.25], s: 0.12 }));
  }
  // bioluminescent stripes on the abdomen
  for (let i = 0; i < 4; i++) g.push(part(box(), 0xff2d55, { p: [0, 4.55 - i * 0.2, -1.3 - i * 0.75], r: [-0.4 - i * 0.15, 0, 0], s: [1.6 - i * 0.2, 0.08, 0.25], rig: [0, 0, 1] }));
  return { body: build(p), glow: build(g) };
}

// ---------------------------------------------------------------------------------------------------
// Environment

export function rockGeo(seed: number, detail = 1): THREE.BufferGeometry {
  return build([part(new THREE.IcosahedronGeometry(1, detail), 0xffffff, { jitter: 0.28, seed, shade: 0.12, s: [1, 0.72, 1] })]);
}

export function spireGeo(seed: number): THREE.BufferGeometry {
  const parts = [
    part(cyl(6, 0.35, 1), 0xffffff, { p: [0, 1.8, 0], s: [1, 3.6, 1], jitter: 0.12, seed, shade: 0.12 }),
    part(new THREE.IcosahedronGeometry(1, 0), 0xffffff, { p: [0, 0.2, 0], s: [1.3, 0.6, 1.3], jitter: 0.2, seed: seed + 1, shade: 0.1 }),
  ];
  return build(parts);
}

export function crystalClusterGeo(seed: number, count = 6, tint = 0xffffff): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = i === 0 ? 0 : rng.range(0.25, 0.7);
    const h = i === 0 ? 1.9 : rng.range(0.7, 1.5);
    parts.push(
      part(octa(), tint, {
        p: [Math.cos(a) * r, h * 0.45, Math.sin(a) * r],
        r: [rng.range(-0.35, 0.35), rng.range(0, 3), rng.range(-0.35, 0.35) + (i === 0 ? 0 : Math.cos(a) * 0.4)],
        s: [0.24 + rng.range(0, 0.1), h * 0.55, 0.24 + rng.range(0, 0.1)],
        shade: 0.25,
        seed: seed + i,
      }),
    );
  }
  return build(parts);
}

export function oreGeo(seed: number): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const rng = new Rng(seed);
  const body = [part(new THREE.IcosahedronGeometry(1, 1), 0x3a3c44, { jitter: 0.3, seed, shade: 0.15, s: [1.2, 0.85, 1.1] })];
  const glow: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, Math.PI * 2);
    const y = rng.range(0.1, 0.6);
    body.push(part(box(), 0xb7bcc6, { p: [Math.cos(a) * 1.0, y, Math.sin(a) * 0.95], r: [rng.range(0, 3), rng.range(0, 3), 0], s: rng.range(0.18, 0.32), shade: 0.2, seed: seed + i }));
  }
  for (let i = 0; i < 4; i++) {
    const a = rng.range(0, Math.PI * 2);
    glow.push(part(box(), 0xff7a2a, { p: [Math.cos(a) * 1.05, rng.range(0.0, 0.5), Math.sin(a) * 1.0], r: [0, a, rng.range(-0.5, 0.5)], s: [0.05, 0.4, 0.05] }));
  }
  return { body: build(body), glow: build(glow) };
}

export function mushroomGeo(seed: number): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const rng = new Rng(seed);
  const h = rng.range(2.6, 4.2);
  const capR = rng.range(1.4, 2.2);
  const body = [
    part(cyl(7, 0.3, 0.45), 0xcfc3d8, { p: [0, h / 2, 0], s: [1, h, 1], r: [rng.range(-0.1, 0.1), 0, rng.range(-0.1, 0.1)], shade: 0.08, seed }),
    part(new THREE.SphereGeometry(1, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0x4a2a6a, { p: [0, h, 0], s: [capR, capR * 0.45, capR], shade: 0.12, seed: seed + 1 }),
  ];
  const glow: THREE.BufferGeometry[] = [part(cyl(9, 1, 1), 0x2affc6, { p: [0, h - 0.02, 0], s: [capR * 0.92, 0.05, capR * 0.92] })];
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0.3, 0.85) * capR;
    glow.push(part(sphere(0), 0xffd24a, { p: [Math.cos(a) * r, h + capR * 0.45 * Math.sqrt(1 - (r / capR) ** 2) * 0.95, Math.sin(a) * r], s: rng.range(0.1, 0.18) }));
  }
  return { body: build(body), glow: build(glow) };
}

export function smallShroomGeo(seed: number): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const rng = new Rng(seed);
  const body: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0, 0.5);
    const h = rng.range(0.3, 0.8);
    body.push(part(cyl(5, 0.05, 0.07), 0xd8cfe0, { p: [Math.cos(a) * r, h / 2, Math.sin(a) * r], s: [1, h, 1] }));
    glow.push(part(new THREE.SphereGeometry(1, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), i % 2 ? 0x2affc6 : 0x7a8cff, { p: [Math.cos(a) * r, h, Math.sin(a) * r], s: [0.2, 0.12, 0.2] }));
  }
  return { body: build(body), glow: build(glow) };
}

export function tuftGeo(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0, 0.35);
    parts.push(part(cone(3), 0xffffff, { p: [Math.cos(a) * r, 0.3, Math.sin(a) * r], r: [rng.range(-0.4, 0.4), 0, rng.range(-0.4, 0.4)], s: [0.06, rng.range(0.4, 0.8), 0.06], shade: 0.2, seed: seed + i }));
  }
  return build(parts);
}

export function reedGeo(seed: number): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const rng = new Rng(seed);
  const body: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0, 0.4);
    const h = rng.range(1.2, 2.2);
    const tx = rng.range(-0.15, 0.15);
    body.push(part(cyl(4, 0.03, 0.05), 0x5a6a2a, { p: [Math.cos(a) * r, h / 2, Math.sin(a) * r], r: [tx, 0, tx], s: [1, h, 1] }));
    glow.push(part(sphere(0), 0xb6ff3a, { p: [Math.cos(a) * r + tx * h * 0.5, h, Math.sin(a) * r + tx * h * 0.5], s: [0.07, 0.16, 0.07] }));
  }
  return { body: build(body), glow: build(glow) };
}

export function tendrilGeo(seed: number): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const rng = new Rng(seed);
  const body: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const n = rng.int(2, 4);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0, 0.6);
    const h = rng.range(1.2, 2.8);
    const lean = rng.range(-0.35, 0.35);
    body.push(part(cone(5), 0x7a2a3a, { p: [Math.cos(a) * r, h / 2, Math.sin(a) * r], r: [lean, 0, -lean], s: [0.22, h, 0.22], shade: 0.15, seed: seed + i }));
    glow.push(part(sphere(0), 0xff3a5c, { p: [Math.cos(a) * r + lean * h * 0.3, h * 0.55, Math.sin(a) * r - lean * h * 0.3], s: 0.09 }));
  }
  return { body: build(body), glow: build(glow) };
}

export function ribcageGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const bone = 0xd6ccb4;
  parts.push(part(cyl(6, 0.25, 0.3), bone, { p: [0, 0.3, 0], r: [Math.PI / 2, 0, 0], s: [1, 9, 1], shade: 0.08 }));
  for (let i = 0; i < 7; i++) {
    const z = -3.6 + i * 1.2;
    const h = 3.4 - Math.abs(i - 3) * 0.35;
    for (const s of [-1, 1]) {
      parts.push(part(new THREE.TorusGeometry(h * 0.55, 0.14, 4, 8, Math.PI * 0.62), bone, { p: [s * 0.1, 0.3, z], r: [0, s > 0 ? 0 : Math.PI, Math.PI * 0.12], shade: 0.08 }));
    }
  }
  // skull
  parts.push(part(sphere(1), bone, { p: [0, 0.8, 5.4], s: [1.2, 1, 1.8], jitter: 0.1, seed: 5, shade: 0.1 }));
  parts.push(part(cone(5), bone, { p: [0.8, 1.3, 6.3], r: [1.3, 0, -0.6], s: [0.2, 1.6, 0.2] }));
  parts.push(part(cone(5), bone, { p: [-0.8, 1.3, 6.3], r: [1.3, 0, 0.6], s: [0.2, 1.6, 0.2] }));
  return build(parts);
}

export function bulbPlantGeo(): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const body = [
    part(cyl(5, 0.06, 0.1), 0x3a6a5a, { p: [0, 0.6, 0], s: [1, 1.2, 1] }),
    part(cone(5), 0x2a5a4a, { p: [0.25, 0.25, 0], r: [0, 0, -1.0], s: [0.12, 0.6, 0.12] }),
    part(cone(5), 0x2a5a4a, { p: [-0.25, 0.25, 0.1], r: [0, 0, 1.0], s: [0.12, 0.6, 0.12] }),
  ];
  const glow = [
    part(sphere(1), 0x5fd8ff, { p: [0, 1.35, 0], s: 0.34, rig: [0, 0, 1] }),
    part(sphere(1), 0x5fd8ff, { p: [0.3, 1.0, 0.1], s: 0.22, rig: [0, 0, 1] }),
    part(sphere(1), 0x5fd8ff, { p: [-0.25, 0.9, -0.15], s: 0.2, rig: [0, 0, 1] }),
  ];
  return { body: build(body), glow: build(glow) };
}

export function healPodGeo(): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const body = [
    part(cone(6), 0x2f5a2a, { p: [0, 0.35, 0], s: [0.55, 0.7, 0.55], shade: 0.1 }),
    part(cone(4), 0x3f7a35, { p: [0.4, 0.3, 0], r: [0, 0, -1.2], s: [0.15, 0.8, 0.15] }),
    part(cone(4), 0x3f7a35, { p: [-0.35, 0.3, 0.2], r: [0, 0, 1.2], s: [0.15, 0.8, 0.15] }),
  ];
  const glow = [part(sphere(1), 0xff4a6a, { p: [0, 0.85, 0], s: [0.3, 0.38, 0.3], rig: [0, 0, 1] })];
  return { body: build(body), glow: build(glow) };
}

export function geyserGeo(): THREE.BufferGeometry {
  const rng = new Rng(3);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    parts.push(part(new THREE.IcosahedronGeometry(1, 0), 0x6a5a58, { p: [Math.cos(a) * 1.1, 0.15, Math.sin(a) * 1.1], s: [0.5, rng.range(0.3, 0.6), 0.5], jitter: 0.2, seed: i, shade: 0.1 }));
  }
  parts.push(part(cyl(8, 0.9, 1.1), 0x1a1414, { p: [0, 0.02, 0], s: [1, 0.1, 1] }));
  return build(parts);
}

export function wreckGeo(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const hull = 0x8a8f96;
  const dark = 0x3a3d42;
  const accent = 0xc4642a;
  const parts: THREE.BufferGeometry[] = [];
  // broken fuselage section, half buried
  parts.push(part(cyl(8, 1.6, 1.8), hull, { p: [0, 0.6, 0], r: [Math.PI / 2, 0, 0.25], s: [1, 6, 1], shade: 0.12, jitter: 0.04, seed }));
  parts.push(part(cyl(8, 1.3, 1.3), dark, { p: [0, 0.6, 3.05], r: [Math.PI / 2, 0, 0.25], s: [1, 0.2, 1] }));
  parts.push(part(box(), accent, { p: [0.9, 1.9, -0.5], r: [0, 0, 0.2], s: [0.8, 0.1, 2.5] }));
  // snapped wing
  parts.push(part(box(), hull, { p: [2.6, 0.3, -0.8], r: [0.1, 0.3, -0.35], s: [3.6, 0.18, 1.8], shade: 0.1 }));
  // scattered panels
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(3, 5.5);
    parts.push(part(box(), rng.chance(0.5) ? hull : dark, { p: [Math.cos(a) * r, 0.1, Math.sin(a) * r], r: [rng.range(-0.4, 0.4), rng.range(0, 3), rng.range(-0.4, 0.4)], s: [rng.range(0.6, 1.6), 0.1, rng.range(0.5, 1.2)] }));
  }
  // antenna mast
  parts.push(part(cyl(4, 0.05, 0.05), dark, { p: [-0.8, 2.6, 1.2], r: [0.3, 0, -0.3], s: [1, 2.4, 1] }));
  return build(parts);
}

export function crateGeo(): THREE.BufferGeometry {
  return build([
    part(box(), 0x5a5f66, { s: [0.9, 0.7, 0.7], p: [0, 0.35, 0], shade: 0.05 }),
    part(box(), 0xe0a020, { s: [0.92, 0.12, 0.72], p: [0, 0.45, 0] }),
    part(box(), 0x2a2d31, { s: [0.2, 0.3, 0.74], p: [0.25, 0.35, 0] }),
  ]);
}

// ---------------------------------------------------------------------------------------------------
// Small dynamic objects

export function scrapGeo(): THREE.BufferGeometry {
  return build([
    part(box(), 0xa9aeb8, { s: [0.28, 0.1, 0.18], shade: 0.1 }),
    part(cyl(6, 0.08, 0.08), 0x70757e, { p: [0.05, 0.08, 0.02], s: [1, 0.12, 1] }),
    part(box(), 0xc4642a, { p: [-0.1, 0.02, 0.05], r: [0, 0.6, 0], s: [0.12, 0.12, 0.08] }),
  ]);
}

export function shardGeo(): THREE.BufferGeometry {
  return build([part(octa(), 0xffffff, { s: [0.12, 0.26, 0.12] })]);
}

export function boltGeo(): THREE.BufferGeometry {
  return build([part(new THREE.CapsuleGeometry(0.07, 0.9, 2, 6), 0xffffff, { r: [Math.PI / 2, 0, 0] })]);
}

export function globGeo(): THREE.BufferGeometry {
  return build([part(sphere(1), 0xffffff, { s: 0.28 })]);
}

export function partGeo(id: string): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const metal = 0x9aa2ad;
  const dark = 0x2c3036;
  if (id === 'coil') {
    return {
      body: build([
        part(cyl(8, 0.35, 0.35), dark, { s: [1, 1.2, 1] }),
        part(cyl(8, 0.5, 0.5), metal, { p: [0, 0.65, 0], s: [1, 0.12, 1] }),
        part(cyl(8, 0.5, 0.5), metal, { p: [0, -0.65, 0], s: [1, 0.12, 1] }),
      ]),
      glow: build([part(torus(0.42, 0.06, 4, 12), 0xffffff, { r: [Math.PI / 2, 0, 0], p: [0, 0.3, 0] }), part(torus(0.42, 0.06, 4, 12), 0xffffff, { r: [Math.PI / 2, 0, 0], p: [0, -0.3, 0] }), part(torus(0.42, 0.06, 4, 12), 0xffffff, { r: [Math.PI / 2, 0, 0] })]),
    };
  }
  if (id === 'cell') {
    return {
      body: build([part(cyl(6, 0.42, 0.42), metal, { p: [0, 0.75, 0], s: [1, 0.15, 1] }), part(cyl(6, 0.42, 0.42), metal, { p: [0, -0.75, 0], s: [1, 0.15, 1] }), part(box(), dark, { s: [0.1, 1.5, 0.9] })]),
      glow: build([part(new THREE.CapsuleGeometry(0.32, 0.9, 3, 8), 0xffffff, {})]),
    };
  }
  if (id === 'nav') {
    return {
      body: build([part(torus(0.7, 0.07, 4, 16), metal, { r: [Math.PI / 2, 0, 0] }), part(torus(0.7, 0.07, 4, 16), metal, { r: [0, 0, 0] })]),
      glow: build([part(octa(), 0xffffff, { s: [0.38, 0.5, 0.38] })]),
    };
  }
  return {
    body: build([part(new THREE.IcosahedronGeometry(0.75, 0), dark, {}), part(torus(0.8, 0.08, 4, 14), metal, { r: [Math.PI / 2, 0, 0] })]),
    glow: build([part(sphere(1), 0xffffff, { s: 0.5 })]),
  };
}

// ---------------------------------------------------------------------------------------------------
// Structures (built by the player)

export function turretBaseGeo(): THREE.BufferGeometry {
  return build([
    part(cyl(6, 0.75, 0.9), 0x4a4f57, { p: [0, 0.25, 0], s: [1, 0.5, 1], shade: 0.06 }),
    part(cyl(6, 0.3, 0.4), 0x6b717a, { p: [0, 0.75, 0], s: [1, 0.6, 1] }),
    part(box(), 0xe0a020, { p: [0, 0.52, 0.72], s: [0.6, 0.08, 0.1] }),
  ]);
}

export function turretHeadGeo(): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  return {
    body: build([
      part(box(), 0x8a9099, { p: [0, 1.25, 0], s: [0.8, 0.45, 0.8], shade: 0.06 }),
      part(cyl(6, 0.08, 0.08), 0x2a2d31, { p: [0.14, 1.25, 0.75], r: [Math.PI / 2, 0, 0], s: [1, 0.8, 1] }),
      part(cyl(6, 0.08, 0.08), 0x2a2d31, { p: [-0.14, 1.25, 0.75], r: [Math.PI / 2, 0, 0], s: [1, 0.8, 1] }),
      part(box(), 0xe0a020, { p: [0, 1.5, -0.1], s: [0.5, 0.06, 0.4] }),
    ]),
    glow: build([part(box(), 0xffffff, { p: [0, 1.3, 0.41], s: [0.3, 0.08, 0.04] })]),
  };
}

export function wallGeo(): THREE.BufferGeometry {
  return build([
    part(box(), 0x5c6168, { p: [0, 0.7, 0], s: [2.1, 1.4, 0.5], shade: 0.08 }),
    part(box(), 0x3a3e44, { p: [0.75, 0.75, 0], s: [0.25, 1.55, 0.6] }),
    part(box(), 0x3a3e44, { p: [-0.75, 0.75, 0], s: [0.25, 1.55, 0.6] }),
    part(box(), 0xe0a020, { p: [0, 1.2, 0.26], s: [1.2, 0.12, 0.02] }),
  ]);
}

export function lampGeo(): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  return {
    body: build([
      part(cyl(5, 0.35, 0.45), 0x4a4f57, { p: [0, 0.15, 0], s: [1, 0.3, 1] }),
      part(cyl(5, 0.07, 0.09), 0x6b717a, { p: [0, 1.6, 0], s: [1, 2.9, 1] }),
      part(box(), 0x3a3e44, { p: [0, 3.05, 0], s: [0.7, 0.25, 0.5] }),
    ]),
    glow: build([part(box(), 0xffffff, { p: [0, 2.92, 0], s: [0.55, 0.05, 0.38] })]),
  };
}

export function beaconGeo(): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  return {
    body: build([
      part(cyl(6, 0.6, 0.8), 0x4a4f57, { p: [0, 0.2, 0], s: [1, 0.4, 1] }),
      part(cyl(6, 0.12, 0.18), 0xc8ccd2, { p: [0, 1.6, 0], s: [1, 2.6, 1] }),
      part(cyl(6, 0.35, 0.35), 0x3a3e44, { p: [0, 0.6, 0], s: [1, 0.5, 1] }),
    ]),
    glow: build([part(sphere(1), 0xffffff, { p: [0, 3.0, 0], s: 0.22 }), part(torus(0.45, 0.04, 3, 12), 0xffffff, { p: [0, 2.2, 0], r: [Math.PI / 2, 0, 0] })]),
  };
}

export function teslaGeo(): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const body = [part(cyl(6, 0.7, 0.85), 0x4a4f57, { p: [0, 0.2, 0], s: [1, 0.4, 1] }), part(cyl(6, 0.18, 0.28), 0x6b717a, { p: [0, 1.4, 0], s: [1, 2.2, 1] })];
  for (let i = 0; i < 4; i++) body.push(part(torus(0.36 - i * 0.04, 0.06, 4, 10), 0xb87333, { p: [0, 0.8 + i * 0.4, 0], r: [Math.PI / 2, 0, 0] }));
  return { body: build(body), glow: build([part(sphere(1), 0xffffff, { p: [0, 2.8, 0], s: 0.4 })]) };
}

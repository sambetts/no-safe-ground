import * as THREE from 'three';
import { build, part } from './models';
import { envMaterial, glowMaterial } from './materials';

export interface ShipModel {
  group: THREE.Group;
  sockets: THREE.Mesh[];
  engineGlow: THREE.MeshBasicMaterial;
  beacon: THREE.Mesh;
  hatch: THREE.Vector3; // local position of the fabricator ramp
  smokeL: THREE.Vector3;
  smokeR: THREE.Vector3;
  cannon: THREE.Group;
}

export const SHIP_SCALE = 0.8;

const cyl = (seg = 10, t = 1, b = 1) => new THREE.CylinderGeometry(t, b, 1, seg);
const box = () => new THREE.BoxGeometry(1, 1, 1);

export function shipModel(): ShipModel {
  const hull = 0x9aa0a8;
  const hull2 = 0x7d838c;
  const dark = 0x2e3238;
  const accent = 0xff6a1a;
  const scorch = 0x1c1a1a;
  const p: THREE.BufferGeometry[] = [];
  // fuselage
  p.push(part(cyl(12, 1.9, 2.05), hull, { p: [0, 1.9, -0.4], r: [Math.PI / 2, 0, 0], s: [1, 9.4, 1], shade: 0.05 }));
  p.push(part(new THREE.ConeGeometry(1.9, 3.4, 12), hull, { p: [0, 1.9, 6.0], r: [Math.PI / 2, 0, 0], shade: 0.05 }));
  p.push(part(cyl(12, 2.05, 1.6), hull2, { p: [0, 1.9, -5.6], r: [Math.PI / 2, 0, 0], s: [1, 1.2, 1] }));
  // accent stripes
  p.push(part(box(), accent, { p: [1.72, 2.5, 0], r: [0, 0, -0.5], s: [0.08, 0.35, 8.6] }));
  p.push(part(box(), accent, { p: [-1.72, 2.5, 0], r: [0, 0, 0.5], s: [0.08, 0.35, 8.6] }));
  p.push(part(box(), dark, { p: [0, 3.82, -0.4], s: [1.3, 0.2, 5.5] }));
  // wings (left one snapped and bent)
  p.push(part(box(), hull2, { p: [4.2, 1.35, -1.2], r: [0, 0.18, -0.12], s: [5.2, 0.28, 3.2], shade: 0.06 }));
  p.push(part(box(), accent, { p: [6.5, 1.1, -1.5], r: [0, 0.18, -0.12], s: [0.9, 0.3, 3.0] }));
  p.push(part(box(), hull2, { p: [-3.1, 1.2, -1.0], r: [0.1, -0.1, 0.25], s: [3.0, 0.28, 3.0], shade: 0.06 }));
  p.push(part(box(), hull2, { p: [-5.6, 0.25, -1.8], r: [0.3, -0.5, 0.55], s: [2.4, 0.25, 2.2], shade: 0.06 }));
  // engines
  for (const s of [-1, 1]) {
    p.push(part(cyl(10, 0.85, 0.95), s < 0 ? scorch : hull2, { p: [s * 1.9, 1.5, -5.0], r: [Math.PI / 2, 0, 0], s: [1, 3.4, 1] }));
    p.push(part(cyl(10, 0.95, 0.7), dark, { p: [s * 1.9, 1.5, -7.0], r: [Math.PI / 2, 0, 0], s: [1, 0.7, 1] }));
  }
  // tail fin
  p.push(part(box(), hull, { p: [0, 3.9, -5.0], r: [-0.35, 0, 0], s: [0.25, 2.6, 2.4] }));
  p.push(part(box(), accent, { p: [0, 4.9, -5.4], r: [-0.35, 0, 0], s: [0.28, 0.5, 1.8] }));
  // scorch & damage
  p.push(part(box(), scorch, { p: [-1.5, 2.7, 1.8], r: [0, 0, 0.8], s: [0.1, 1.2, 2.2] }));
  p.push(part(box(), scorch, { p: [1.2, 3.2, -2.8], r: [0, 0, -0.5], s: [0.1, 1.4, 1.6] }));
  p.push(part(box(), scorch, { p: [0, 0.4, 5.0], s: [2.6, 0.2, 2.2] }));
  // landing struts (one collapsed)
  p.push(part(cyl(5, 0.12, 0.12), dark, { p: [1.5, 0.5, 3.4], r: [0, 0, 0.3], s: [1, 1.2, 1] }));
  p.push(part(cyl(5, 0.12, 0.12), dark, { p: [1.8, 0.5, -3.2], r: [0, 0, 0.3], s: [1, 1.2, 1] }));
  // side ramp (fabricator access)
  p.push(part(box(), dark, { p: [2.9, 0.55, 0.6], r: [0, 0, -0.42], s: [2.4, 0.15, 2.0] }));
  p.push(part(box(), accent, { p: [2.9, 0.62, 1.55], r: [0, 0, -0.42], s: [2.4, 0.16, 0.1] }));
  // sensor dish
  p.push(part(new THREE.SphereGeometry(0.9, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2.5), hull2, { p: [-0.9, 4.0, 2.2], r: [-0.6, 0, 0.5] }));
  // socket housings on the spine
  const socketZ = [2.2, 0.8, -0.6, -2.0];
  for (const z of socketZ) p.push(part(cyl(8, 0.45, 0.55), dark, { p: [0, 3.9, z], s: [1, 0.35, 1] }));

  const group = new THREE.Group();
  const body = new THREE.Mesh(build(p), envMaterial());
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // canopy + lights (glowing)
  const g: THREE.BufferGeometry[] = [];
  g.push(part(new THREE.IcosahedronGeometry(1, 1), 0x0e2a44, { p: [0, 3.0, 3.9], s: [1.15, 0.65, 1.7] }));
  g.push(part(box(), 0xff3a2a, { p: [6.9, 1.0, -1.5], s: [0.2, 0.12, 0.4] }));
  g.push(part(box(), 0x3aff7a, { p: [-6.6, 0.2, -2.0], s: [0.2, 0.12, 0.4] }));
  g.push(part(box(), 0xffe0a0, { p: [3.9, 1.5, 0.6], s: [0.1, 0.2, 1.6] }));
  const glowMesh = new THREE.Mesh(build(g), glowMaterial(1.2, 2.2));
  group.add(glowMesh);

  // engine nozzles glow separately so launch can ramp them up
  const engineGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a2a).multiplyScalar(0.6), toneMapped: false });
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.62, 12), engineGlow);
    m.position.set(s * 1.9, 1.5, -7.36);
    m.rotation.y = Math.PI;
    group.add(m);
  }

  const sockets: THREE.Mesh[] = [];
  for (const z of socketZ) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), new THREE.MeshBasicMaterial({ color: 0x1a1d22, toneMapped: false }));
    m.position.set(0, 4.15, z);
    group.add(m);
    sockets.push(m);
  }

  const beacon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2020).multiplyScalar(3), toneMapped: false }));
  beacon.position.set(0, 5.3, -5.6);
  group.add(beacon);

  // defensive auto-cannon on the spine
  const cannon = new THREE.Group();
  const cBody = new THREE.Mesh(
    build([
      part(cyl(8, 0.5, 0.6), dark, { s: [1, 0.5, 1] }),
      part(box(), hull2, { p: [0, 0.4, 0.1], s: [0.8, 0.45, 0.9] }),
      part(cyl(6, 0.09, 0.09), dark, { p: [0.15, 0.45, 0.9], r: [Math.PI / 2, 0, 0], s: [1, 1.2, 1] }),
      part(cyl(6, 0.09, 0.09), dark, { p: [-0.15, 0.45, 0.9], r: [Math.PI / 2, 0, 0], s: [1, 1.2, 1] }),
    ]),
    envMaterial(),
  );
  cBody.castShadow = true;
  cannon.add(cBody);
  cannon.position.set(0, 4.3, -3.2);
  group.add(cannon);

  group.scale.setScalar(SHIP_SCALE);
  return {
    group,
    sockets,
    engineGlow,
    beacon,
    hatch: new THREE.Vector3(4.6, 0, 0.6),
    smokeL: new THREE.Vector3(-1.9, 1.8, -6.5),
    smokeR: new THREE.Vector3(-1.5, 3.0, 1.8),
    cannon,
  };
}

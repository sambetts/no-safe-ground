import * as THREE from 'three';
import { build, part } from './models';

export interface PlayerModel {
  root: THREE.Group; // positioned at feet, rotated to face aim
  body: THREE.Group; // bobs
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  gun: THREE.Group;
  muzzle: THREE.Object3D;
  heatMat: THREE.MeshBasicMaterial;
  visorMat: THREE.MeshBasicMaterial;
  tankMat: THREE.MeshBasicMaterial;
  carry: THREE.Group; // holds a carried ship part
  materials: THREE.Material[];
}

export function playerModel(): PlayerModel {
  const suit = 0xc8c3b8;
  const suit2 = 0x9a968e;
  const dark = 0x2b2e33;
  const accent = 0xff6a1a;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torso = new THREE.Mesh(
    build([
      part(new THREE.CapsuleGeometry(0.3, 0.38, 3, 8), suit, { p: [0, 1.12, 0], s: [1, 1, 0.82], shade: 0.04 }),
      part(new THREE.BoxGeometry(1, 1, 1), accent, { p: [0, 1.28, 0.2], s: [0.44, 0.1, 0.12] }),
      part(new THREE.BoxGeometry(1, 1, 1), dark, { p: [0, 0.86, 0], s: [0.58, 0.1, 0.5] }),
      // backpack + tanks
      part(new THREE.BoxGeometry(1, 1, 1), suit2, { p: [0, 1.18, -0.33], s: [0.5, 0.58, 0.24], shade: 0.05 }),
      part(new THREE.CylinderGeometry(0.09, 0.09, 1, 8), accent, { p: [0.14, 1.22, -0.47], s: [1, 0.5, 1] }),
      part(new THREE.CylinderGeometry(0.09, 0.09, 1, 8), accent, { p: [-0.14, 1.22, -0.47], s: [1, 0.5, 1] }),
      // shoulders
      part(new THREE.IcosahedronGeometry(0.14, 1), suit, { p: [0.33, 1.36, 0] }),
      part(new THREE.IcosahedronGeometry(0.14, 1), suit, { p: [-0.33, 1.36, 0] }),
      // helmet
      part(new THREE.IcosahedronGeometry(0.27, 2), suit, { p: [0, 1.66, 0.02], shade: 0.03 }),
      part(new THREE.CylinderGeometry(0.2, 0.24, 1, 10), dark, { p: [0, 1.46, 0], s: [1, 0.08, 1] }),
    ]),
    mat,
  );
  torso.castShadow = true;
  body.add(torso);

  const visorMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x46e8ff).multiplyScalar(1.6), toneMapped: false });
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 6, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.28, Math.PI * 0.36), visorMat);
  visor.position.set(0, 1.66, 0.1);
  visor.scale.set(1.05, 1, 1.05);
  body.add(visor);

  const tankMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x46e8ff).multiplyScalar(1.4), toneMapped: false });
  const tankGauge = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.02), tankMat);
  tankGauge.position.set(0, 1.42, -0.46);
  body.add(tankGauge);

  const mkLeg = (x: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0.86, 0);
    const m = new THREE.Mesh(
      build([
        part(new THREE.CapsuleGeometry(0.11, 0.42, 2, 6), suit2, { p: [0, -0.34, 0] }),
        part(new THREE.BoxGeometry(1, 1, 1), dark, { p: [0, -0.8, 0.05], s: [0.2, 0.14, 0.32] }),
      ]),
      mat,
    );
    m.castShadow = true;
    g.add(m);
    return g;
  };
  const legL = mkLeg(-0.15);
  const legR = mkLeg(0.15);
  body.add(legL, legR);

  const armL = new THREE.Group();
  armL.position.set(-0.36, 1.32, 0);
  const armLMesh = new THREE.Mesh(build([part(new THREE.CapsuleGeometry(0.09, 0.4, 2, 6), suit, { p: [0.05, -0.12, 0.2], r: [1.2, 0, 0.2] })]), mat);
  armLMesh.castShadow = true;
  armL.add(armLMesh);
  body.add(armL);

  // gun arm (right) holding the plasma blaster forward
  const gun = new THREE.Group();
  gun.position.set(0.3, 1.2, 0.1);
  const heatMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x46e8ff), toneMapped: false });
  const gunMesh = new THREE.Mesh(
    build([
      part(new THREE.CapsuleGeometry(0.09, 0.32, 2, 6), suit, { p: [0.02, 0.02, 0.1], r: [1.4, 0, 0] }),
      part(new THREE.BoxGeometry(1, 1, 1), dark, { p: [0, 0.04, 0.42], s: [0.16, 0.18, 0.62] }),
      part(new THREE.BoxGeometry(1, 1, 1), 0x5a5f68, { p: [0, 0.14, 0.34], s: [0.1, 0.06, 0.4] }),
      part(new THREE.CylinderGeometry(0.05, 0.06, 1, 6), 0x5a5f68, { p: [0, 0.04, 0.78], r: [Math.PI / 2, 0, 0], s: [1, 0.2, 1] }),
    ]),
    mat,
  );
  gunMesh.castShadow = true;
  gun.add(gunMesh);
  const coil = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.3), heatMat);
  coil.position.set(0, -0.05, 0.42);
  gun.add(coil);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.04, 0.92);
  gun.add(muzzle);
  body.add(gun);

  const carry = new THREE.Group();
  carry.position.set(0, 2.5, -0.1);
  body.add(carry);

  return { root, body, legL, legR, armL, gun, muzzle, heatMat, visorMat, tankMat, carry, materials: [mat, visorMat, heatMat, tankMat] };
}

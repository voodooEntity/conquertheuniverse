import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

let NEXT_OB_ID = 1;

export class ObstacleManager {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = []; // { id, position:THREE.Vector3, radius:number, mesh }
  }

  addSphere(position, radius, materialOpts = {}) {
    const id = NEXT_OB_ID++;
    const geo = new THREE.SphereGeometry(radius, 32, 18);
    const mat = new THREE.MeshStandardMaterial({
      color: materialOpts.color ?? 0x444a66,
      roughness: 0.9,
      metalness: 0.0,
      transparent: true,
      opacity: materialOpts.opacity ?? 0.95,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.obstacleId = id;
    this.scene.add(mesh);

    const ob = { id, position: position.clone(), radius, mesh };
    this.obstacles.push(ob);
    return ob;
  }

  getAll() { return this.obstacles; }

  update() {
    // static for now
  }
}

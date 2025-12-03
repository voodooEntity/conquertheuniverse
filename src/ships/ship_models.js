import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

// Registry of ship definitions with base stats and paths
// Stats are initial placeholders; can be tuned later.
export const SHIP_DEFS = {
  // accel in units/s^2, turn in rad/s (approximate, for feel). Larger ships have lower accel/turn.
  Bob:        { path: 'assets/ships/Ultimate Spaceships - May 2021/Bob/glTF/Bob.gltf',           speed: 12, accel: 18, turn: 2.4, hp: 120, role: 'frigate' },
  Spitfire:   { path: 'assets/ships/Ultimate Spaceships - May 2021/Spitfire/glTF/Spitfire.gltf', speed: 16, accel: 28, turn: 3.2, hp: 90,  role: 'fighter' },
  Striker:    { path: 'assets/ships/Ultimate Spaceships - May 2021/Striker/glTF/Striker.gltf',   speed: 15, accel: 26, turn: 3.0, hp: 100, role: 'fighter' },
  Challenger: { path: 'assets/ships/Ultimate Spaceships - May 2021/Challenger/glTF/Challenger.gltf', speed: 10, accel: 12, turn: 1.8, hp: 220, role: 'destroyer' },
  Zenith:     { path: 'assets/ships/Ultimate Spaceships - May 2021/Zenith/glTF/Zenith.gltf',     speed: 11, accel: 16, turn: 2.0, hp: 180, role: 'corvette' },
  Dispatcher: { path: 'assets/ships/Ultimate Spaceships - May 2021/Dispatcher/glTF/Dispatcher.gltf', speed: 9,  accel: 10, turn: 1.6, hp: 260, role: 'carrier' },
  Executioner:{ path: 'assets/ships/Ultimate Spaceships - May 2021/Executioner/glTF/Executioner.gltf', speed: 8,  accel: 9,  turn: 1.4, hp: 320, role: 'cruiser' },
  Imperial:   { path: 'assets/ships/Ultimate Spaceships - May 2021/Imperial/glTF/Imperial.gltf', speed: 7,  accel: 7,  turn: 1.2, hp: 420, role: 'capital' },
  Insurgent:  { path: 'assets/ships/Ultimate Spaceships - May 2021/Insurgent/glTF/Insurgent.gltf', speed: 13, accel: 22, turn: 2.6, hp: 140, role: 'interceptor' },
  Omen:       { path: 'assets/ships/Ultimate Spaceships - May 2021/Omen/glTF/Omen.gltf',         speed: 12, accel: 18, turn: 2.2, hp: 150, role: 'gunship' },
  Pancake:    { path: 'assets/ships/Ultimate Spaceships - May 2021/Pancake/glTF/Pancake.gltf',   speed: 9,  accel: 11, turn: 1.6, hp: 260, role: 'support' },
};

export class ShipLibrary {
  constructor(scene = null) {
    this.loader = new GLTFLoader();
    this.scene = scene; // optional, not required
    this.cache = new Map(); // name -> template { mesh, radius, size, hp, speed }
  }

  async load(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    const def = SHIP_DEFS[name];
    if (!def) throw new Error(`Unknown ship: ${name}`);
    const gltf = await this._loadGLTF(def.path);
    const model = gltf.scene;
    // Ensure up axis and update matrices
    model.traverse(o => { o.up && o.up.set(0,1,0); });
    model.updateMatrixWorld(true);

    // Compute bounds
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);

    // Assume +Z is forward; if not, we can add per-asset corrections later.

    // Build a template container to instance per unit
    const template = new THREE.Group();
    template.name = `${name}_Template`;
    template.add(model);

    const entry = {
      name,
      mesh: template,
      radius: Math.max(0.8, sphere.radius * 0.55), // gameplay radius a bit tighter than visual
      size,
      hp: def.hp,
      speed: def.speed,
      accel: def.accel ?? 15,
      turn: def.turn ?? 2.0,
      role: def.role,
    };
    this.cache.set(name, entry);
    return entry;
  }

  async loadAll() {
    const names = Object.keys(SHIP_DEFS);
    const results = {};
    for (const n of names) {
      results[n] = await this.load(n);
    }
    return results;
  }

  // Create an instance (deep clone) of the ship mesh with materials shared
  async instantiate(name) {
    const entry = await this.load(name);
    const mesh = entry.mesh.clone(true);
    mesh.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        // IMPORTANT: clone materials per instance so selection highlighting
        // does not affect all ships that share the same material reference.
        if (o.material) {
          if (Array.isArray(o.material)) {
            o.material = o.material.map((m) => m && m.clone ? m.clone() : m);
          } else if (o.material.clone) {
            o.material = o.material.clone();
          }
        }
      }
    });
    return { mesh, meta: entry };
  }

  _loadGLTF(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }
}

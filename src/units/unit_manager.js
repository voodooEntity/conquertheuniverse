import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { Unit } from './unit.js';
import { CMD } from '../systems/command_bus.js';
import { SHIP_DEFS } from '../ships/ship_models.js';

export class UnitManager {
  constructor(scene, obstacles, shipLibrary = null) {
    this.scene = scene;
    this.obstacles = obstacles; // ObstacleManager
    this.units = [];
    this.shipLibrary = shipLibrary; // ShipLibrary
  }

  connectTo(commandBus) {
    commandBus.on(CMD.MOVE_SELECTED_TO, ({ target }) => {
      // Collect selected units
      const sel = this.units.filter(u => u.selected);
      if (sel.length === 0) return;

      // Compute spacing based on average unit radius
      const avgRadius = sel.reduce((s, u) => s + (u.radius ?? 0.8), 0) / sel.length;
      const spacing = Math.max(1.2, 2 * avgRadius + 0.4); // ensure some margin

      // Generate planar offsets (XZ) using a sunflower spiral pattern
      const offsets = sunflowerOffsets(sel.length, spacing);

      // Assign distinct targets preserving the commanded Y
      for (let i = 0; i < sel.length; i++) {
        const off = offsets[i];
        let t = new THREE.Vector3(
          target.x + off.x,
          target.y, // keep height as commanded
          target.z + off.z
        );
        // If target lies inside an obstacle, project it to just outside
        t = projectOutsideObstacles(t, sel[i].radius, this.obstacles?.getAll() ?? []);
        sel[i].setTarget(t);
      }
    });
  }

  spawnUnit(pos) {
    const u = new Unit(pos);
    this.units.push(u);
    this.scene.add(u.mesh);
    return u;
  }

  spawnTestFleet() {
    const n = 20;
    const spread = 8;
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * spread * 4;
      const z = (Math.random() - 0.5) * spread * 4;
      const y = Math.random() * 3;
      this.spawnUnit(new THREE.Vector3(x, y, z));
    }
  }

  async spawnUnitOfType(typeName, position) {
    if (!this.shipLibrary) throw new Error('ShipLibrary not set on UnitManager');
    const { mesh, meta } = await this.shipLibrary.instantiate(typeName);
    mesh.position.copy(position);
    const u = new Unit(position, {
      mesh,
      radius: meta.radius,
      maxSpeed: meta.speed,
      maxHp: meta.hp,
      maxAccel: meta.accel,
      maxTurnRate: meta.turn,
    });
    this.units.push(u);
    this.scene.add(u.mesh);
    return u;
  }

  async spawnFleetAllShips(center = new THREE.Vector3(0, 0, 0)) {
    if (!this.shipLibrary) throw new Error('ShipLibrary not set on UnitManager');
    // Ensure all models are loaded
    await this.shipLibrary.loadAll();

    // Determine counts based on role (more small, fewer big)
    const roleCount = {
      fighter: 6,
      interceptor: 5,
      corvette: 4,
      frigate: 3,
      support: 2,
      destroyer: 2,
      gunship: 2,
      cruiser: 1,
      carrier: 1,
      capital: 1,
    };

    // Layout parameters (dynamic to avoid overlap)
    const baseY = center.y || 2;
    let ringRadius = 10;
    let angleAccum = 0;
    const angleStep = Math.PI / 8;
    const names = Object.keys(SHIP_DEFS);
    for (const name of names) {
      const def = SHIP_DEFS[name];
      const count = roleCount[def.role] ?? 2;
      for (let i = 0; i < count; i++) {
        // Load meta to know radius
        const { meta } = await this.shipLibrary.instantiate(name);
        const r = meta.radius ?? 1.0;
        const y = baseY + (Math.random() - 0.5) * 2;
        // Try to find a non-overlapping spot
        const pos = this._findSpawnSpot(ringRadius, angleAccum, r, y);
        angleAccum += angleStep;
        if (angleAccum > Math.PI * 2) { angleAccum -= Math.PI * 2; ringRadius += Math.max(6, r * 4); }
        pos.add(center.clone().setY(0));
        await this.spawnUnitOfType(name, pos);
      }
    }
  }

  forEachNeighborPairs(fn) {
    const arr = this.units;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        fn(arr[i], arr[j]);
      }
    }
  }

  update(dt) {
    // Build neighbor lists (naive O(n^2) for prototype)
    const arr = this.units;
    for (let i = 0; i < arr.length; i++) {
      const neighbors = arr; // simple: all units
      const obs = this.obstacles?.getAll() ?? [];
      arr[i].update(dt, neighbors, obs);
    }
  }
}

// Golden-angle sunflower distribution in XZ plane with approximate spacing
function sunflowerOffsets(n, spacing) {
  const res = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  // pick scale so nearest-neighbor spacing is around the requested spacing
  const c = spacing / Math.sqrt(Math.PI); // heuristic scale
  for (let k = 0; k < n; k++) {
    const r = c * Math.sqrt(k + 0.5); // +0.5 to avoid zero overlap at center
    const theta = k * goldenAngle;
    res.push({ x: r * Math.cos(theta), z: r * Math.sin(theta) });
  }
  return res;
}

// If a desired point is inside any obstacle sphere, push it outwards to the surface + margin
function projectOutsideObstacles(point, unitRadius, obstacles) {
  const p = point.clone();
  const margin = 0.2;
  for (const ob of obstacles) {
    const dir = p.clone().sub(ob.position);
    let d = dir.length();
    const limit = ob.radius + unitRadius + margin;
    if (d < limit) {
      if (d < 1e-5) {
        // point exactly at center; choose an arbitrary direction
        dir.set(1, 0, 0);
        d = 1;
      } else {
        dir.divideScalar(d);
      }
      p.copy(ob.position).addScaledVector(dir, limit);
    }
  }
  return p;
}

// Helper: find a spawn spot on rings avoiding overlap with existing units
UnitManager.prototype._findSpawnSpot = function(baseRadius, startAngle, newRadius, y) {
  const tries = 64;
  const factor = 1.4; // distance multiplier to avoid touching
  for (let t = 0; t < tries; t++) {
    const angle = startAngle + t * (Math.PI / 12);
    const ring = baseRadius + Math.floor(t / 12) * Math.max(6, newRadius * 4);
    const x = Math.cos(angle) * ring;
    const z = Math.sin(angle) * ring;
    const p = new THREE.Vector3(x, y, z);
    let ok = true;
    for (const u of this.units) {
      const need = (newRadius + (u.radius ?? 1)) * factor;
      if (p.distanceTo(u.position) < need) { ok = false; break; }
    }
    if (ok) return p;
  }
  // fallback: push far on ring
  return new THREE.Vector3(Math.cos(startAngle) * (baseRadius + 50), y, Math.sin(startAngle) * (baseRadius + 50));
};

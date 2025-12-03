// Simple JSON map loader and applier
// Map format example:
// {
//   "name": "Demo Star Systems",
//   "size": { "halfSize": 150 },
//   "spawns": [ {"x": -60, "y": 5, "z": -60}, {"x": 60, "y": 5, "z": 60} ],
//   "obstacles": [
//     { "type": "sphere", "position": {"x": 10, "y": 0, "z": -5}, "radius": 4, "color": 3822952, "opacity": 0.95 }
//   ]
// }

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

export class MapLoader {
  async load(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Failed to load map ${url}: ${res.status}`);
    const json = await res.json();
    return json;
  }
}

export function applyMapToWorld(map, { obstacles }) {
  if (!map) return { spawns: [] };
  // Obstacles
  if (Array.isArray(map.obstacles)) {
    for (const ob of map.obstacles) {
      if (ob.type === 'sphere') {
        const p = ob.position || { x: 0, y: 0, z: 0 };
        const color = ob.color ?? 0x444a66;
        const opacity = ob.opacity ?? 0.95;
        obstacles.addSphere(new THREE.Vector3(p.x, p.y, p.z), ob.radius ?? 2, { color, opacity });
      }
    }
  }
  // Spawns
  const spawns = Array.isArray(map.spawns) ? map.spawns.map(s => new THREE.Vector3(s.x||0, s.y||0, s.z||0)) : [];
  return { spawns };
}

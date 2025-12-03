import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// Renders a semi-transparent 3D lattice/grid within a cubic volume (x = y = z)
// Default visual: hacker green with ~0.3 opacity.
export class Grid3D {
  constructor({ halfSize = 100, step = 20, color = 0x00ff66, opacity = 0.3 } = {}) {
    this.halfSize = halfSize;
    this.step = Math.max(1e-3, step);
    this.color = color;
    this.opacity = opacity;

    this.object = new THREE.LineSegments(this._buildGeometry(), this._buildMaterial());
    this.object.frustumCulled = false;
    this.object.renderOrder = 0; // behind gizmos
  }

  addTo(scene) { scene.add(this.object); }
  removeFrom(scene) { scene.remove(this.object); }
  update() { /* static */ }

  _buildMaterial() {
    const m = new THREE.LineBasicMaterial({ color: this.color, transparent: true, opacity: this.opacity });
    // Let the grid read the depth buffer so it doesn't fully obscure objects
    m.depthTest = true;
    // But don't write to it, so lines don't create harsh artifacts
    m.depthWrite = false;
    return m;
  }

  _buildGeometry() {
    const S = this.halfSize;
    const h = this.step;
    const n = Math.floor((2 * S) / h) + 1; // number of ticks per axis

    // Total lines: for each axis, n*n lines => 3*n*n
    const totalLines = 3 * n * n;
    const verts = new Float32Array(totalLines * 2 * 3);
    let i = 0;

    // Helper to push a line
    const pushLine = (x1, y1, z1, x2, y2, z2) => {
      verts[i++] = x1; verts[i++] = y1; verts[i++] = z1;
      verts[i++] = x2; verts[i++] = y2; verts[i++] = z2;
    };

    // Coordinates array for ticks
    const ticks = [];
    for (let k = 0; k < n; k++) ticks.push(-S + k * h);

    // Lines parallel to X at every (y,z)
    for (let yi = 0; yi < n; yi++) {
      const y = ticks[yi];
      for (let zi = 0; zi < n; zi++) {
        const z = ticks[zi];
        pushLine(-S, y, z, S, y, z);
      }
    }

    // Lines parallel to Y at every (x,z)
    for (let xi = 0; xi < n; xi++) {
      const x = ticks[xi];
      for (let zi = 0; zi < n; zi++) {
        const z = ticks[zi];
        pushLine(x, -S, z, x, S, z);
      }
    }

    // Lines parallel to Z at every (x,y)
    for (let xi = 0; xi < n; xi++) {
      const x = ticks[xi];
      for (let yi = 0; yi < n; yi++) {
        const y = ticks[yi];
        pushLine(x, y, -S, x, y, S);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    return g;
  }
}

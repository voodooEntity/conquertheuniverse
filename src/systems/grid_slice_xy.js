import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// Renders a semi-transparent XY grid slice that can be positioned along Z
export class GridSliceXY {
  constructor({ halfSize = 100, step = 10, color = 0x00ff66, opacity = 0.3 } = {}) {
    this.halfSize = halfSize;
    this.step = Math.max(1e-6, step);
    this.color = color;
    this.opacity = opacity;

    this.object = new THREE.LineSegments(this._buildGeometry(), this._buildMaterial());
    this.object.frustumCulled = false;
    this.object.renderOrder = 0; // behind gizmos
    this.object.position.set(0, 0, 0); // z will be adjusted via setZ
  }

  addTo(scene) { scene.add(this.object); }
  removeFrom(scene) { scene.remove(this.object); }
  update() { /* static */ }

  setZ(z) { this.object.position.z = z; }

  _buildMaterial() {
    const m = new THREE.LineBasicMaterial({ color: this.color, transparent: true, opacity: this.opacity });
    m.depthTest = true;
    m.depthWrite = false;
    return m;
  }

  _buildGeometry() {
    const S = this.halfSize;
    const h = this.step;
    const n = Math.floor((2 * S) / h) + 1;

    // Total lines: for XY slice, n lines parallel to X for each Y tick, and n lines parallel to Y for each X tick => 2*n
    const totalLines = 2 * n;
    const verts = new Float32Array(totalLines * 2 * 3);
    let i = 0;

    const pushLine = (x1, y1, z1, x2, y2, z2) => {
      verts[i++] = x1; verts[i++] = y1; verts[i++] = z1;
      verts[i++] = x2; verts[i++] = y2; verts[i++] = z2;
    };

    const ticks = [];
    for (let k = 0; k < n; k++) ticks.push(-S + k * h);

    // Lines parallel to X across Y ticks (z will be applied by object.position)
    for (let yi = 0; yi < n; yi++) {
      const y = ticks[yi];
      pushLine(-S, y, 0, S, y, 0);
    }

    // Lines parallel to Y across X ticks
    for (let xi = 0; xi < n; xi++) {
      const x = ticks[xi];
      pushLine(x, -S, 0, x, S, 0);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    return g;
  }
}

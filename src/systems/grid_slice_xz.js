import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// Renders a semi-transparent XZ grid slice that can be positioned along Y
export class GridSliceXZ {
  constructor({ halfSize = 100, step = 10, color = 0x00ff66, opacity = 0.3 } = {}) {
    this.halfSize = halfSize;
    this.step = Math.max(1e-6, step);
    this.color = color;
    this.opacity = opacity;

    this.object = new THREE.LineSegments(this._buildGeometry(), this._buildMaterial());
    this.object.frustumCulled = false;
    this.object.renderOrder = 0; // behind gizmos
    this.object.position.set(0, 0, 0); // y will be adjusted via setY

    // Add a translucent highlight rectangle for the current XZ cell under the cursor
    const plane = new THREE.PlaneGeometry(this.step, this.step);
    const mat = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.15, // requested ~0.15
      depthWrite: false,
      depthTest: true,
    });
    this.highlight = new THREE.Mesh(plane, mat);
    this.highlight.rotation.x = -Math.PI / 2; // make it lie on XZ
    this.highlight.renderOrder = 0.5; // just above the grid lines
    this.object.add(this.highlight);
  }

  addTo(scene) { scene.add(this.object); }
  removeFrom(scene) { scene.remove(this.object); }
  update() { /* static */ }

  setY(y) { this.object.position.y = y; }

  // Position the highlight quad to the grid cell containing (x,z)
  setHighlightFromXZ(x, z) {
    if (!this.highlight) return;
    const h = this.step;
    // Snap to cell center just below current coordinate (floor-based)
    const cx = Math.floor((x + this.halfSize) / h) * h - this.halfSize + h * 0.5;
    const cz = Math.floor((z + this.halfSize) / h) * h - this.halfSize + h * 0.5;
    // Clamp within bounds
    const min = -this.halfSize + h * 0.5;
    const max = this.halfSize - h * 0.5;
    this.highlight.position.set(
      THREE.MathUtils.clamp(cx, min, max),
      0.001, // tiny lift to avoid z-fighting with lines
      THREE.MathUtils.clamp(cz, min, max)
    );
  }

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

    // For XZ slice: n lines parallel to X at each Z tick, and n lines parallel to Z at each X tick => 2*n
    const totalLines = 2 * n;
    const verts = new Float32Array(totalLines * 2 * 3);
    let i = 0;

    const pushLine = (x1, y1, z1, x2, y2, z2) => {
      verts[i++] = x1; verts[i++] = y1; verts[i++] = z1;
      verts[i++] = x2; verts[i++] = y2; verts[i++] = z2;
    };

    const ticks = [];
    for (let k = 0; k < n; k++) ticks.push(-S + k * h);

    // Lines parallel to X across Z ticks (y will be applied by object.position)
    for (let zi = 0; zi < n; zi++) {
      const z = ticks[zi];
      pushLine(-S, 0, z, S, 0, z);
    }

    // Lines parallel to Z across X ticks
    for (let xi = 0; xi < n; xi++) {
      const x = ticks[xi];
      pushLine(x, 0, -S, x, 0, S);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    return g;
  }
}

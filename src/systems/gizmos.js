import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

export class GizmoRenderer {
  constructor(scene) {
    this.scene = scene;
    // Cursor drop line
    this.cursorLine = lineY(0x66ccff);
    scene.add(this.cursorLine);

    // Visible cursor marker (small semi-transparent green sphere)
    const cursorGeo = new THREE.SphereGeometry(0.35, 16, 12);
    const cursorMat = new THREE.MeshBasicMaterial({ color: 0x00ff66, transparent: true, opacity: 0.6, depthWrite: false });
    this.cursorMarker = new THREE.Mesh(cursorGeo, cursorMat);
    this.cursorMarker.renderOrder = 2;
    scene.add(this.cursorMarker);

    // Selection sphere (wireframe)
    this.sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x66ccff, wireframe: true, transparent: true, opacity: 0.5, depthWrite: false })
    );
    this.sphere.visible = false;
    scene.add(this.sphere);

    this._cursor = new THREE.Vector3();
    this._cursorHeight = 0;
    this.unitDropLines = new Map(); // unitId -> line
  }

  setCursorPosition(vec3, height) {
    this._cursor.copy(vec3);
    this._cursorHeight = height ?? vec3.y;
    updateLine(this.cursorLine, this._cursorHeight);
    this.cursorLine.position.set(this._cursor.x, 0, this._cursor.z);
    // Place the visible cursor sphere at the cursor position
    this.cursorMarker.position.set(this._cursor.x, this._cursorHeight, this._cursor.z);
  }

  showSelectionSphere(center, radius) {
    this.sphere.visible = true;
    this.sphere.position.copy(center);
    this.sphere.scale.setScalar(Math.max(0.0001, radius));
  }

  hideSelectionSphere() {
    this.sphere.visible = false;
  }

  ensureUnitDropLine(unit) {
    if (this.unitDropLines.has(unit.id)) return this.unitDropLines.get(unit.id);
    const l = lineY(0x88ffaa);
    this.unitDropLines.set(unit.id, l);
    this.scene.add(l);
    return l;
  }

  removeUnitDropLine(unit) {
    const l = this.unitDropLines.get(unit.id);
    if (l) {
      this.scene.remove(l);
      l.geometry.dispose();
      l.material.dispose();
      this.unitDropLines.delete(unit.id);
    }
  }

  updateUnitDropLine(unit) {
    const l = this.ensureUnitDropLine(unit);
    updateLine(l, unit.position.y);
    l.position.set(unit.position.x, 0, unit.position.z);
    l.visible = true;
    // Color tweak when selected
    l.material.color.setHex(unit.selected ? 0xffffff : 0x88ffaa);
  }

  update(dt) {
    // noop; lines updated by callers
  }
}

function lineY(color) {
  const g = new THREE.BufferGeometry();
  const verts = new Float32Array([
    0, 0, 0,
    0, 1, 0,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
  const line = new THREE.Line(g, m);
  line.frustumCulled = false;
  line.renderOrder = 1;
  return line;
}

function updateLine(line, height) {
  const pos = line.geometry.getAttribute('position');
  pos.setY(1, Math.max(0, height));
  pos.needsUpdate = true;
}

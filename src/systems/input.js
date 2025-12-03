import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { ndcFromMouseEvent, rayFromMouse, raycastGroundPlane } from './math.js';
import { CMD } from './command_bus.js';

export class InputSystem {
  constructor(canvas, camera, controls, gizmos, commandBus, unitManager, opts = {}) {
    this.canvas = canvas;
    this.camera = camera;
    this.controls = controls;
    this.gizmos = gizmos;
    this.commandBus = commandBus;
    this.unitManager = unitManager;
    this.gridSlice = opts.gridSlice ?? null;

    // Cursor state
    this.cursor = new THREE.Vector3(0, 0, 0);
    this.cursorHeight = 0;
    this.elevSensitivity = 0.02; // height units per wheel delta step

    // Selection state
    this.isSelecting = false;
    this.selectCenter = new THREE.Vector3();
    this.selectRadius = 0;

    // Camera interaction state (keep cursor relative to camera while moving)
    this.cameraInteracting = false;
    this._cameraCursorOffset = new THREE.Vector3();
    this._heightLock = null;

    // Right-click (RMB) click-vs-drag state
    this._rmbDown = false;
    this._rmbStartX = 0;
    this._rmbStartY = 0;
    this._rmbDragged = false;
    this._dragThreshold = 5; // pixels

    // Ctrl + RMB rotate state (manual rotate)
    this._ctrlRmbActive = false; // deprecated (kept for compatibility)
    this._suppressRmbClick = false; // prevent issuing move after special RMB interactions
    this._blockSelectionUntilPointerUp = false; // avoid accidental selection during Ctrl+RMB

    // Pointer lock (edge-free cursor) state
    this.pointerLocked = false;
    this._ndcX = 0; // accumulated NDC while locked
    this._ndcY = 0;

    // Bind events
    this._onMouseDown = (e) => this.onMouseDown(e);
    this._onMouseMove = (e) => this.onMouseMove(e);
    this._onMouseUp = (e) => this.onMouseUp(e);
    this._onContextMenu = (e) => e.preventDefault();
    this._onWheel = (e) => this.onWheel(e);
    this._onKeyDown = (e) => this.onKeyDown(e);
    this._onKeyUp = (e) => this.onKeyUp(e);
    // Capture-phase pointer handlers to take over Ctrl+RMB rotation before OrbitControls
    this._onPointerDownCapture = (e) => this.onPointerDownCapture(e);
    this._onPointerUp = (e) => this.onPointerUp(e);
    this._onPointerMove = (e) => this.onPointerMove(e);
    this._prevEnablePan = null; // no longer used for remapping pan
    this._lastClientX = 0;
    this._lastClientY = 0;
    // Manual rotation state
    this._rotateActive = false;
    this._rotateSpeed = 0.006; // radians per pixel
    this._rotateTarget = new THREE.Vector3();
    this._spherical = { r: 1, theta: 0, phi: 0 }; // yaw(theta around Y), pitch(phi from +Y)

    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('contextmenu', this._onContextMenu);
    canvas.addEventListener('mouseleave', this._onMouseUp);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    canvas.addEventListener('keydown', this._onKeyDown);
    canvas.addEventListener('keyup', this._onKeyUp);
    // Use capture so we run BEFORE OrbitControls' pointerdown handler
    canvas.addEventListener('pointerdown', this._onPointerDownCapture, true);
    canvas.addEventListener('pointerup', this._onPointerUp, false);
    canvas.addEventListener('pointermove', this._onPointerMove, false);
    // Also hook document for pointer lock scenarios where events target document instead of canvas
    document.addEventListener('pointerdown', this._onPointerDownCapture, true);
    document.addEventListener('pointerup', this._onPointerUp, false);
    document.addEventListener('pointermove', this._onPointerMove, false);
    // Also listen on document so Ctrl detection works even if canvas isn't focused or under pointer lock
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);

    // Let canvas capture keyboard
    canvas.addEventListener('click', () => canvas.focus());

    // Pointer lock events
    document.addEventListener('pointerlockchange', () => this._onPointerLockChange());
    document.addEventListener('pointerlockerror', () => console.warn('Pointer lock error'));

    // Hook unit manager to command bus
    this.unitManager.connectTo(this.commandBus);

    // Listen to OrbitControls start/end to manage camera interaction
    this.controls.addEventListener('start', () => {
      this.cameraInteracting = true;
      this._cameraCursorOffset.copy(this.cursor).setY(this.cursorHeight).sub(this.camera.position);
      this._heightLock = this.cursorHeight; // freeze height while interacting
    });
    this.controls.addEventListener('end', () => {
      this.cameraInteracting = false;
      this._heightLock = null;
    });

    // HUD readout
    this._cursorReadout = document.getElementById('cursor-readout');
  }

  dispose() {
    const c = this.canvas;
    c.removeEventListener('mousedown', this._onMouseDown);
    c.removeEventListener('mousemove', this._onMouseMove);
    c.removeEventListener('mouseup', this._onMouseUp);
    c.removeEventListener('contextmenu', this._onContextMenu);
    c.removeEventListener('mouseleave', this._onMouseUp);
    c.removeEventListener('wheel', this._onWheel);
    c.removeEventListener('keydown', this._onKeyDown);
    c.removeEventListener('keyup', this._onKeyUp);
    c.removeEventListener('pointerdown', this._onPointerDownCapture, true);
    c.removeEventListener('pointerup', this._onPointerUp, false);
    c.removeEventListener('pointermove', this._onPointerMove, false);
    document.removeEventListener('pointerdown', this._onPointerDownCapture, true);
    document.removeEventListener('pointerup', this._onPointerUp, false);
    document.removeEventListener('pointermove', this._onPointerMove, false);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    document.removeEventListener('pointerlockerror', this._onPointerLockError);
  }

  update() {
    // While camera is moving, keep cursor fixed relative to camera
    if (this.cameraInteracting) {
      const world = this.camera.position.clone().add(this._cameraCursorOffset);
      this.cursor.set(world.x, 0, world.z);
      // Keep height strictly locked during interaction to avoid grid jumping
      if (this._heightLock !== null) this.cursorHeight = this._heightLock;
    }

    // Update cursor drop line
    this.gizmos.setCursorPosition(this.cursor, this.cursorHeight);
    // Update unit drop lines
    for (const u of this.unitManager.units) this.gizmos.updateUnitDropLine(u);

    // Update grid slice Y (XZ plane) to the next lower tick under current cursor height
    if (this.gridSlice) {
      const step = this.gridSlice.step ?? 10;
      // Apply small epsilon to avoid tick flapping due to tiny float jitter
      const eps = 1e-4;
      const yTick = Math.floor((this.cursorHeight + eps) / step) * step;
      // Supports GridSliceXZ.setY
      if (typeof this.gridSlice.setY === 'function') this.gridSlice.setY(yTick);
      // Back-compat: if setZ exists (older XY slice), update it too
      else if (typeof this.gridSlice.setZ === 'function') this.gridSlice.setZ(yTick);

      // Position the translucent highlight rectangle to the cell under the virtual cursor
      if (typeof this.gridSlice.setHighlightFromXZ === 'function') {
        this.gridSlice.setHighlightFromXZ(this.cursor.x, this.cursor.z);
      }
    }

    // Update HUD readout
    if (this._cursorReadout) {
      const x = this.cursor.x;
      const y = this.cursorHeight;
      const z = this.cursor.z;
      this._cursorReadout.textContent = `(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`;
    }
  }

  onWheel(e) {
    // Use wheel to adjust cursor/plane height; prevent scroll/zoom
    e.preventDefault();
    const delta = e.deltaY; // positive when scrolling down on most devices
    const dH = -delta * this.elevSensitivity; // invert so wheel up increases height
    this.cursorHeight += dH;
    // Move camera in lockstep to preserve relative distance to the virtual cursor
    if (this.camera) this.camera.position.y += dH;
    if (this.controls && this.controls.target) this.controls.target.y += dH;
    // If height is currently locked during camera interaction, keep the lock consistent
    if (this._heightLock !== null) this._heightLock += dH;
  }

  // Capture-phase: take over Ctrl+RMB rotation before OrbitControls
  onPointerDownCapture(e) {
  // Right button is 2 across browsers. If Ctrl is held, start manual rotation
  if (e.button === 2 && (e.ctrlKey === true)) {
    // Initialize spherical from current camera relative to target
    const target = this.controls?.target || new THREE.Vector3();
    this._rotateTarget.copy(target);
    const rel = this.camera.position.clone().sub(target);
    const r = Math.max(0.001, rel.length());
    const theta = Math.atan2(rel.x, rel.z); // yaw around Y
    const phi = Math.acos(THREE.MathUtils.clamp(rel.y / r, -1, 1)); // polar angle
    this._spherical = { r, theta, phi };

    // Engage rotate mode
    this._rotateActive = true;
    this._suppressRmbClick = true;
    this._blockSelectionUntilPointerUp = true;
    this._lastClientX = e.clientX;
    this._lastClientY = e.clientY;

    // Freeze cursor height during interaction
    if (!this.cameraInteracting) {
      this.cameraInteracting = true;
      this._cameraCursorOffset.copy(this.cursor).setY(this.cursorHeight).sub(this.camera.position);
      this._heightLock = this.cursorHeight;
    }

    // Disable OrbitControls handling during our manual rotate
    this._controlsPrevEnabled = this.controls.enabled;
    this.controls.enabled = false;

    e.preventDefault();
    e.stopPropagation();
    return;
  }
    // Under pointer lock, OrbitControls may not receive events; simulate camera interaction for pan as well
    if (e.button === 2 && !e.ctrlKey && this.pointerLocked) {
      if (!this.cameraInteracting) {
        this.cameraInteracting = true;
        this._cameraCursorOffset.copy(this.cursor).setY(this.cursorHeight).sub(this.camera.position);
        this._heightLock = this.cursorHeight;
      }
      this._lastClientX = e.clientX;
      this._lastClientY = e.clientY;
      this._rmbDown = true;
      this._rmbDragged = false;
      // Allow OrbitControls to also pan, but we provide a manual fallback; no need to stopPropagation here
    }
  }

  onPointerUp(e) {
    // End manual Ctrl+RMB rotation
    if (e.button === 2 && this._rotateActive) {
      this._rotateActive = false;
      if (this._controlsPrevEnabled !== undefined) {
        this.controls.enabled = this._controlsPrevEnabled;
        this._controlsPrevEnabled = undefined;
      }
      this.cameraInteracting = false;
      this._heightLock = null;
      this._blockSelectionUntilPointerUp = false;
      this._suppressRmbClick = true; // don't treat as click
      this._rmbDown = false;
      this._rmbDragged = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // End simulated interaction for pointer-lock panning
    if (e.button === 2 && this.pointerLocked) {
      this.cameraInteracting = false;
      this._heightLock = null;
      this._rmbDown = false;
      this._rmbDragged = false;
    }
  }

  // Manual rotation handler for Ctrl + RMB
  onPointerMove(e) {
    // Determine movement deltas
    let dx = 0, dy = 0;
    if (this.pointerLocked) {
      dx = e.movementX || 0;
      dy = e.movementY || 0;
    } else {
      dx = (e.clientX - this._lastClientX) || 0;
      dy = (e.clientY - this._lastClientY) || 0;
      this._lastClientX = e.clientX;
      this._lastClientY = e.clientY;
    }

    // If manual rotate active, orbit camera around target
    if (this._rotateActive) {
      const speed = this._rotateSpeed;
      // Update spherical angles (theta yaw, phi pitch)
      this._spherical.theta -= dx * speed; // drag right -> rotate left
      this._spherical.phi   -= dy * speed; // drag up -> look up
      // Clamp phi to avoid flipping (epsilon..PI - epsilon)
      const eps = 0.001;
      this._spherical.phi = THREE.MathUtils.clamp(this._spherical.phi, eps, Math.PI - eps);

      const target = this._rotateTarget;
      const r = this._spherical.r;
      const st = Math.sin(this._spherical.phi);
      const x = r * Math.sin(this._spherical.theta) * st;
      const y = r * Math.cos(this._spherical.phi);
      const z = r * Math.cos(this._spherical.theta) * st;
      this.camera.position.set(target.x + x, target.y + y, target.z + z);
      this.camera.lookAt(target);
      // Keep controls' target in sync
      if (this.controls && this.controls.target) this.controls.target.copy(target);
      this.controls.update();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Under pointer lock, when RMB drag without Ctrl, perform manual pan fallback (fixed-Y XZ pan)
    if (this.pointerLocked && this._rmbDown) {
      // Scale pan speed by distance to target for feel
      const dist = this.camera.position.distanceTo(this.controls.target || new THREE.Vector3());
      // Increase speed ~3x per requirement
      const panScale = Math.max(0.0015, Math.min(0.015, dist * 0.0045));
      // Camera basis
      const camDir = new THREE.Vector3();
      this.camera.getWorldDirection(camDir);
      const up = new THREE.Vector3(0,1,0);
      const right = new THREE.Vector3().crossVectors(camDir, up).normalize();
      const forwardXZ = new THREE.Vector3(camDir.x, 0, camDir.z).normalize();
      // Map mouse to world: right for dx, forward for dy; invert dy for screen sense
      const move = new THREE.Vector3()
        .addScaledVector(right, -dx * panScale)
        .addScaledVector(forwardXZ, dy * panScale);
      this.camera.position.add(move);
      if (this.controls && this.controls.target) this.controls.target.add(move);
      this.controls.update();
      e.preventDefault();
      e.stopPropagation();
    }
  }

  onKeyDown(e) {
    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      this.togglePointerLock();
    }
  }

  onKeyUp(e) {
    // no-op for Control; we handle rotation per-interaction
  }

  onMouseDown(e) {
    e.preventDefault();
    this.canvas.focus();
    if (e.button === 0) { // Left: begin volumetric selection
      // Suppress selection if Ctrl-rotate gesture is active or being prepared
      if (this._blockSelectionUntilPointerUp || e.ctrlKey) return;
      // Only start selection if it's a pure Left press (buttons bitmask == 1)
      if ((e.buttons & 1) !== 1) return;
      // Start selection from the VIRTUAL game cursor, not the raw mouse-ground hit
      this.isSelecting = true;
      this.selectCenter.set(this.cursor.x, this.cursorHeight, this.cursor.z);
      this.selectRadius = 0;
      this.controls.enabled = false; // disable camera during select
      this.gizmos.showSelectionSphere(this.selectCenter, 0.0001);
    } else if (e.button === 2) {
      // Prepare for RMB click-vs-drag (pan handled by OrbitControls unless pointer-locked)
      this._rmbDown = true;
      this._rmbStartX = e.clientX;
      this._rmbStartY = e.clientY;
      this._rmbDragged = false;
    }
  }

  onMouseMove(e) {
    e.preventDefault();
    this._lastClientY = e.clientY;
    // Track RMB drag distance to distinguish pan vs click (do this even if camera is interacting)
    if (this._rmbDown && !this._rmbDragged) {
      if (this.pointerLocked) {
        const md = Math.hypot(e.movementX || 0, e.movementY || 0);
        if (md >= this._dragThreshold) this._rmbDragged = true;
      } else {
        const dx = e.clientX - this._rmbStartX;
        const dy = e.clientY - this._rmbStartY;
        if ((dx*dx + dy*dy) >= (this._dragThreshold * this._dragThreshold)) {
          this._rmbDragged = true;
        }
      }
    }

    if (this.cameraInteracting) return; // ignore cursor updates while camera is moving

    let hit = null;
    if (this.pointerLocked) {
      // Accumulate NDC from movement deltas
      const rect = this.canvas.getBoundingClientRect();
      const ndcDX = (e.movementX || 0) * (2 / rect.width);
      const ndcDY = -(e.movementY || 0) * (2 / rect.height);
      this._ndcX += ndcDX;
      this._ndcY += ndcDY;
      const { origin, dir } = rayFromMouse(this._ndcX, this._ndcY, this.camera);
      hit = raycastGroundPlane(origin, dir);
    } else {
      // Update cursor X/Z from infinite ground plane using real mouse
      hit = this._groundFromMouseEvent(e);
    }
    if (hit) {
      this.cursor.set(hit.x, this.cursorHeight, hit.z);
    }

    // If selecting, update radius and sphere (based on VIRTUAL cursor position)
    if (this.isSelecting) {
      const cur = new THREE.Vector3(this.cursor.x, this.cursorHeight, this.cursor.z);
      this.selectRadius = cur.distanceTo(this.selectCenter);
      this.gizmos.showSelectionSphere(this.selectCenter, Math.max(0, this.selectRadius));
    }
  }

  onMouseUp(e) {
    if (this.isSelecting && e.button === 0) {
      // finalize selection
      this.isSelecting = false;
      this.controls.enabled = true;
      this.gizmos.hideSelectionSphere();
      // Apply selection to units by radius on X/Z plane distance (3D distance)
      for (const u of this.unitManager.units) {
        const d = u.position.distanceTo(this.selectCenter);
        const sel = d <= this.selectRadius;
        u.setSelected(sel);
      }
    }

    // Handle RMB click (no-drag) to issue move; if it was a drag, OrbitControls handled pan
    if (e.button === 2 && this._rmbDown) {
      // If this RMB interaction was a rotate, it has been handled in pointer handlers
      if (!this._rmbDragged && !e.ctrlKey && !this._suppressRmbClick) {
        const target = new THREE.Vector3(this.cursor.x, this.cursorHeight, this.cursor.z);
        this.commandBus.emit(CMD.MOVE_SELECTED_TO, { target });
      }
      this._rmbDown = false;
      this._rmbDragged = false;
      this._suppressRmbClick = false;
      this._blockSelectionUntilPointerUp = false;
    }
  }

  _groundFromMouseEvent(e) {
    const { x, y } = ndcFromMouseEvent(e, this.canvas);
    const { origin, dir } = rayFromMouse(x, y, this.camera);
    return raycastGroundPlane(origin, dir);
  }

  togglePointerLock() {
    if (!this.pointerLocked) {
      // Initialize NDC from current virtual cursor to avoid jump
      const world = new THREE.Vector3(this.cursor.x, this.cursorHeight, this.cursor.z);
      const ndc = world.clone().project(this.camera); // in-place
      this._ndcX = ndc.x;
      this._ndcY = ndc.y;
      this.canvas.requestPointerLock({ unadjustedMovement: true });
    } else {
      document.exitPointerLock();
    }
  }

  _onPointerLockChange() {
    this.pointerLocked = (document.pointerLockElement === this.canvas);
    // When unlocking, nothing else to do; cursor continues to follow real mouse
  }
}

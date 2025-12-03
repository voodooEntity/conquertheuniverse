import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { ndcFromMouseEvent, rayFromMouse, raycastGroundPlane } from './math.js';
import { CMD } from './command_bus.js';

export class InputSystem {
    constructor(canvas, camera, controls, gizmos, commandBus, unitManager, opts = {}) {
        console.log('[InputSystem] Initializing InputSystem...');
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

        // Edge Scrolling state
        this._edgeScrollSpeed = 60; // World units per second
        this._edgeThreshold = 20;   // Pixels from edge to trigger (Unlocked)
        this._edgeThresholdNDC = 0.98; // NDC value (0 to 1) to trigger (Locked)
        this._mouseX = window.innerWidth / 2; // Initialize center to prevent instant scroll
        this._mouseY = window.innerHeight / 2;
        this._isEdgeScrolling = false;

        // Ctrl + RMB rotate state (manual rotate)
        this._ctrlRmbActive = false;
        this._suppressRmbClick = false;
        this._blockSelectionUntilPointerUp = false;

        // Pointer lock (edge-free cursor) state
        this.pointerLocked = false;
        this._ndcX = 0;
        this._ndcY = 0;

        // Bind events
        this._onMouseDown = (e) => this.onMouseDown(e);
        this._onMouseMove = (e) => this.onMouseMove(e);
        this._onMouseUp = (e) => this.onMouseUp(e);
        this._onContextMenu = (e) => {
            e.preventDefault();
            // console.log('[InputSystem] Context menu prevented');
        };
        this._onMouseLeave = (e) => {
            this.onMouseUp(e);
            this._mouseX = window.innerWidth / 2;
            this._mouseY = window.innerHeight / 2;
            if (this._isEdgeScrolling) {
                this._isEdgeScrolling = false;
                console.log('[InputSystem] Edge scroll stopped (MouseLeave)');
            }
        };
        this._onWheel = (e) => this.onWheel(e);
        this._onKeyDown = (e) => this.onKeyDown(e);
        this._onKeyUp = (e) => this.onKeyUp(e);

        // Capture-phase pointer handlers
        this._onPointerDownCapture = (e) => this.onPointerDownCapture(e);
        this._onPointerUp = (e) => this.onPointerUp(e);
        this._onPointerMove = (e) => this.onPointerMove(e);
        this._prevEnablePan = null;
        this._lastClientX = 0;
        this._lastClientY = 0;

        // Manual rotation state
        this._rotateActive = false;
        this._rotateSpeed = 0.006;
        this._rotateTarget = new THREE.Vector3();
        this._spherical = { r: 1, theta: 0, phi: 0 };

        canvas.addEventListener('mousedown', this._onMouseDown);
        canvas.addEventListener('mousemove', this._onMouseMove);
        canvas.addEventListener('mouseup', this._onMouseUp);
        canvas.addEventListener('contextmenu', this._onContextMenu);
        canvas.addEventListener('mouseleave', this._onMouseLeave);
        canvas.addEventListener('wheel', this._onWheel, { passive: false });
        canvas.addEventListener('keydown', this._onKeyDown);
        canvas.addEventListener('keyup', this._onKeyUp);

        // Use capture so we run BEFORE OrbitControls' pointerdown handler
        canvas.addEventListener('pointerdown', this._onPointerDownCapture, true);
        canvas.addEventListener('pointerup', this._onPointerUp, false);
        canvas.addEventListener('pointermove', this._onPointerMove, false);

        document.addEventListener('pointerdown', this._onPointerDownCapture, true);
        document.addEventListener('pointerup', this._onPointerUp, false);
        document.addEventListener('pointermove', this._onPointerMove, false);
        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);

        // Let canvas capture keyboard
        canvas.addEventListener('click', () => canvas.focus());

        // Pointer lock events
        document.addEventListener('pointerlockchange', () => this._onPointerLockChange());
        document.addEventListener('pointerlockerror', () => console.warn('[InputSystem] Pointer lock error'));

        // Hook unit manager to command bus
        this.unitManager.connectTo(this.commandBus);

        // Listen to OrbitControls start/end to manage camera interaction
        this.controls.addEventListener('start', () => {
            console.log('[InputSystem] OrbitControls start');
            this.cameraInteracting = true;
            this._cameraCursorOffset.copy(this.cursor).setY(this.cursorHeight).sub(this.camera.position);
            this._heightLock = this.cursorHeight;
        });
        this.controls.addEventListener('end', () => {
            console.log('[InputSystem] OrbitControls end');
            this.cameraInteracting = false;
            this._heightLock = null;
        });

        // HUD readout
        this._cursorReadout = document.getElementById('cursor-readout');
        console.log('[InputSystem] Ready.');
    }

    dispose() {
        console.log('[InputSystem] Disposing...');
        const c = this.canvas;
        c.removeEventListener('mousedown', this._onMouseDown);
        c.removeEventListener('mousemove', this._onMouseMove);
        c.removeEventListener('mouseup', this._onMouseUp);
        c.removeEventListener('contextmenu', this._onContextMenu);
        c.removeEventListener('mouseleave', this._onMouseLeave);
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

    update(dt) {
        // Handle Edge Scrolling
        this._handleEdgeScrolling(dt);

        // While camera is moving, keep cursor fixed relative to camera
        if (this.cameraInteracting) {
            const world = this.camera.position.clone().add(this._cameraCursorOffset);
            this.cursor.set(world.x, 0, world.z);
            if (this._heightLock !== null) this.cursorHeight = this._heightLock;
        }

        // Update cursor drop line
        this.gizmos.setCursorPosition(this.cursor, this.cursorHeight);
        for (const u of this.unitManager.units) this.gizmos.updateUnitDropLine(u);

        // Update grid slice Y
        if (this.gridSlice) {
            const step = this.gridSlice.step ?? 10;
            const eps = 1e-4;
            const yTick = Math.floor((this.cursorHeight + eps) / step) * step;
            if (typeof this.gridSlice.setY === 'function') this.gridSlice.setY(yTick);
            else if (typeof this.gridSlice.setZ === 'function') this.gridSlice.setZ(yTick);

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

    _handleEdgeScrolling(dt) {
        if (this._rmbDown || this._rotateActive || !dt) {
            if (this._isEdgeScrolling) {
                this._isEdgeScrolling = false;
            }
            return;
        }

        let moveX = 0;
        let moveZ = 0;

        if (this.pointerLocked) {
            // Locked Mode: Use NDC (-1 to 1)
            const th = this._edgeThresholdNDC;
            if (this._ndcX < -th) moveX = -1;
            else if (this._ndcX > th) moveX = 1;
            if (this._ndcY > th) moveZ = -1; // Top -> Forward
            else if (this._ndcY < -th) moveZ = 1; // Bottom -> Backward
        } else {
            // Unlocked Mode: Use Screen Pixels
            const x = this._mouseX;
            const y = this._mouseY;
            const w = window.innerWidth;
            const h = window.innerHeight;
            const th = this._edgeThreshold;

            if (x < th) moveX = -1;
            else if (x > w - th) moveX = 1;

            if (y < th) moveZ = -1;
            else if (y > h - th) moveZ = 1;
        }

        // If no edge hit
        if (moveX === 0 && moveZ === 0) {
            if (this._isEdgeScrolling) this._isEdgeScrolling = false;
            return;
        }

        if (!this._isEdgeScrolling) {
            this._isEdgeScrolling = true;
            // console.log(`[InputSystem] Edge scroll started: x=${moveX}, z=${moveZ}`);
        }

        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();

        const right = new THREE.Vector3();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

        const dir = new THREE.Vector3();
        dir.addScaledVector(forward, -moveZ);
        dir.addScaledVector(right, moveX);
        dir.normalize();

        const speed = this._edgeScrollSpeed;
        const dist = speed * dt;
        const move = dir.multiplyScalar(dist);

        this.camera.position.add(move);
        if (this.controls.target) this.controls.target.add(move);

        this.controls.update();
    }

    onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY;
        const dH = -delta * this.elevSensitivity;
        this.cursorHeight += dH;
        console.log(`[InputSystem] Wheel: delta=${delta}, newHeight=${this.cursorHeight.toFixed(2)}`);

        if (this.camera) this.camera.position.y += dH;
        if (this.controls && this.controls.target) this.controls.target.y += dH;
        if (this._heightLock !== null) this._heightLock += dH;
    }

    onPointerDownCapture(e) {
        if (e.button === 2 && (e.ctrlKey === true)) {
            // Manual Rotation Start
            console.log('[InputSystem] Ctrl+RMB: Rotate Start');
            const target = this.controls?.target || new THREE.Vector3();
            this._rotateTarget.copy(target);
            const rel = this.camera.position.clone().sub(target);
            const r = Math.max(0.001, rel.length());
            const theta = Math.atan2(rel.x, rel.z);
            const phi = Math.acos(THREE.MathUtils.clamp(rel.y / r, -1, 1));
            this._spherical = { r, theta, phi };

            this._rotateActive = true;
            this._suppressRmbClick = true;
            this._blockSelectionUntilPointerUp = true;
            this._lastClientX = e.clientX;
            this._lastClientY = e.clientY;

            if (this.canvas.setPointerCapture) this.canvas.setPointerCapture(e.pointerId);

            if (!this.cameraInteracting) {
                this.cameraInteracting = true;
                this._cameraCursorOffset.copy(this.cursor).setY(this.cursorHeight).sub(this.camera.position);
                this._heightLock = this.cursorHeight;
            }

            this._controlsPrevEnabled = this.controls.enabled;
            this.controls.enabled = false;

            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // Pointer Locked Panning (RMB down)
        if (e.button === 2 && !e.ctrlKey && this.pointerLocked) {
            console.log('[InputSystem] Locked RMB Down');
            if (!this.cameraInteracting) {
                this.cameraInteracting = true;
                this._cameraCursorOffset.copy(this.cursor).setY(this.cursorHeight).sub(this.camera.position);
                this._heightLock = this.cursorHeight;
            }
            this._lastClientX = e.clientX;
            this._lastClientY = e.clientY;
            this._rmbDown = true;
            this._rmbDragged = false; // Reset drag state
        }
    }

    onPointerUp(e) {
        // End Rotation
        if (e.button === 2 && this._rotateActive) {
            console.log('[InputSystem] Rotate End');
            this._rotateActive = false;
            if (this.canvas.releasePointerCapture) this.canvas.releasePointerCapture(e.pointerId);

            if (this._controlsPrevEnabled !== undefined) {
                this.controls.enabled = this._controlsPrevEnabled;
                this._controlsPrevEnabled = undefined;
                if (this.controls.enabled) this.controls.update();
            }

            this.cameraInteracting = false;
            this._heightLock = null;
            this._blockSelectionUntilPointerUp = false;
            this._suppressRmbClick = true;
            this._rmbDown = false;
            this._rmbDragged = false;
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // End Locked Interaction (Pan or Click)
        if (e.button === 2 && this.pointerLocked) {
            // Fix: Check for click here because onMouseUp won't see _rmbDown after we clear it
            if (!this._rmbDragged && !this._suppressRmbClick) {
                const target = new THREE.Vector3(this.cursor.x, this.cursorHeight, this.cursor.z);
                console.log(`[InputSystem] Locked Click -> Move to: ${target.x.toFixed(1)}, ${target.z.toFixed(1)}`);
                this.commandBus.emit(CMD.MOVE_SELECTED_TO, { target });
            } else {
                console.log('[InputSystem] Locked Pan End (No Click)');
            }

            this.cameraInteracting = false;
            this._heightLock = null;
            this._rmbDown = false; // Now safely clear it
            this._rmbDragged = false;
            this._suppressRmbClick = false;
        }
    }

    onPointerMove(e) {
        if (!this.pointerLocked) {
            this._mouseX = e.clientX;
            this._mouseY = e.clientY;
        }

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

        // Manual Rotation
        if (this._rotateActive) {
            const speed = this._rotateSpeed;
            this._spherical.theta -= dx * speed;
            this._spherical.phi   -= dy * speed;
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
            if (this.controls && this.controls.target) this.controls.target.copy(target);

            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // Locked Pan (Manual implementation since OrbitControls might be bypassed)
        if (this.pointerLocked && this._rmbDown) {
            // Fix: Detect drag to distinguish from click
            if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
                this._rmbDragged = true;
            }

            const dist = this.camera.position.distanceTo(this.controls.target || new THREE.Vector3());
            const panScale = Math.max(0.0015, Math.min(0.015, dist * 0.0045));
            const camDir = new THREE.Vector3();
            this.camera.getWorldDirection(camDir);
            const up = new THREE.Vector3(0,1,0);
            const right = new THREE.Vector3().crossVectors(camDir, up).normalize();
            const forwardXZ = new THREE.Vector3(camDir.x, 0, camDir.z).normalize();
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

    onKeyUp(e) { }

    onMouseDown(e) {
        this._mouseX = e.clientX;
        this._mouseY = e.clientY;
        e.preventDefault();
        this.canvas.focus();
        if (e.button === 0) {
            if (this._blockSelectionUntilPointerUp || e.ctrlKey) {
                return;
            }
            if ((e.buttons & 1) !== 1) return;
            this.isSelecting = true;
            this.selectCenter.set(this.cursor.x, this.cursorHeight, this.cursor.z);
            this.selectRadius = 0;
            this.controls.enabled = false;
            this.gizmos.showSelectionSphere(this.selectCenter, 0.0001);
            console.log('[InputSystem] Selection Start');
        } else if (e.button === 2) {
            // Unlocked RMB handling
            this._rmbDown = true;
            this._rmbStartX = e.clientX;
            this._rmbStartY = e.clientY;
            this._rmbDragged = false;
        }
    }

    onMouseMove(e) {
        e.preventDefault();
        this._lastClientY = e.clientY;

        if (!this.pointerLocked) {
            this._mouseX = e.clientX;
            this._mouseY = e.clientY;
        }

        // Unlocked drag detection
        if (this._rmbDown && !this._rmbDragged && !this.pointerLocked) {
            const dx = e.clientX - this._rmbStartX;
            const dy = e.clientY - this._rmbStartY;
            if ((dx*dx + dy*dy) >= (this._dragThreshold * this._dragThreshold)) {
                this._rmbDragged = true;
            }
        }

        if (this.cameraInteracting) return;

        let hit = null;
        if (this.pointerLocked) {
            const rect = this.canvas.getBoundingClientRect();
            const ndcDX = (e.movementX || 0) * (2 / rect.width);
            const ndcDY = -(e.movementY || 0) * (2 / rect.height);
            this._ndcX += ndcDX;
            this._ndcY += ndcDY;

            this._ndcX = Math.max(-1, Math.min(1, this._ndcX));
            this._ndcY = Math.max(-1, Math.min(1, this._ndcY));

            const { origin, dir } = rayFromMouse(this._ndcX, this._ndcY, this.camera);
            hit = raycastGroundPlane(origin, dir);
        } else {
            hit = this._groundFromMouseEvent(e);
        }
        if (hit) {
            this.cursor.set(hit.x, this.cursorHeight, hit.z);
        }

        if (this.isSelecting) {
            const cur = new THREE.Vector3(this.cursor.x, this.cursorHeight, this.cursor.z);
            this.selectRadius = cur.distanceTo(this.selectCenter);
            this.gizmos.showSelectionSphere(this.selectCenter, Math.max(0, this.selectRadius));
        }
    }

    onMouseUp(e) {
        if (this.isSelecting && e.button === 0) {
            this.isSelecting = false;
            this.controls.enabled = true;
            this.gizmos.hideSelectionSphere();
            console.log(`[InputSystem] Selection End. Radius=${this.selectRadius.toFixed(1)}`);
            for (const u of this.unitManager.units) {
                const d = u.position.distanceTo(this.selectCenter);
                const sel = d <= this.selectRadius;
                u.setSelected(sel);
            }
        }

        // UNLOCKED Mode Click handling
        if (e.button === 2 && this._rmbDown) {
            // If we are here, it means pointerLocked was FALSE, so onPointerUp didn't consume this.
            if (!this._rmbDragged && !e.ctrlKey && !this._suppressRmbClick) {
                const target = new THREE.Vector3(this.cursor.x, this.cursorHeight, this.cursor.z);
                console.log(`[InputSystem] Unlocked Click -> Move to: ${target.x.toFixed(1)}, ${target.z.toFixed(1)}`);
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
        console.log('[InputSystem] Toggling pointer lock');
        if (!this.pointerLocked) {
            const world = new THREE.Vector3(this.cursor.x, this.cursorHeight, this.cursor.z);
            const ndc = world.clone().project(this.camera);
            this._ndcX = ndc.x;
            this._ndcY = ndc.y;
            this.canvas.requestPointerLock({ unadjustedMovement: true });
        } else {
            document.exitPointerLock();
        }
    }

    _onPointerLockChange() {
        this.pointerLocked = (document.pointerLockElement === this.canvas);
        console.log(`[InputSystem] Pointer lock changed: ${this.pointerLocked}`);
    }
}
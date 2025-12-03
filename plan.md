# 3D RTS Control System Specification

**Context:** Fast-paced Real-Time Strategy game in a 3D grid space.
**Goal:** Enable fluent, intuitive 3D movement and volumetric selection without complex widgets.

## 1. Core Input Mapping

| **Action** | **Input / Trigger** | **Description** |
| **Select Units** | `Left Click` + `Drag` | Creates a volumetric sphere. Everything inside is selected. |
| **Move Units** | `Right Click` (Click) | issues a move command to the 3D cursor position. |
| **Pan Camera** | `Right Click` + `Drag` | Pans the camera view. |
| **Rotate Camera** | `Middle Mouse` (Drag) | Rotates the camera (Orbit). |
| **Zoom Camera** | `Scroll Wheel` | Zooms in/out. |
| **Elevate Cursor** | Hold `Shift` + `Mouse Y` | Locks X/Z position; moves Cursor Y (Height) up/down. |

## 2. The Volumetric Selection (Bubble)

Instead of a 2D selection box, we use a 3D Sphere.

**Logic:**

1. **Start:** On `MouseDown` (Left), raycast from camera to the **Ground Plane (y=0)**.

    * This point becomes the **Sphere Center**.

    * *Constraint:* Camera controls must be disabled momentarily to prevent rotation while selecting.

2. **Expand:** On `MouseMove` (while holding), raycast to the Ground Plane again.

    * Calculate distance between `Center` and `Current Hit Point`.

    * This distance becomes the **Sphere Radius**.

3. **Visuals:** Render a transparent, wireframe sphere that scales in real-time.

4. **End:** On `MouseUp`, calculate distances from all units to `Center`.

    * If `Distance(Unit, Center) <= Radius`, mark unit as **Selected**.

## 3. Bi-Level Cursor Movement (The "Fluency" Mechanic)

To handle 3D positioning on a 2D screen without widgets, we use a state-based cursor.

**Visual Feedback:**

* **The Drop Line:** A vertical line drawn from the **Cursor** down to the **Ground (y=0)**. This allows the user to judge depth/height instantly.

* **Unit Drop Lines:** Every unit must also have a drop line to the floor.

**State A: Ground Navigation (Default)**

* **Behavior:** Cursor follows the mouse raycast on the X/Z plane (Infinite Ground Plane).

* **Height:** Defaults to `y=0` (or retains last set height if units are selected).

**State B: Elevation Mode (Active while `Shift` is held)**

* **Trigger:** `KeyDown (Shift)`.

* **Logic:**

    1. **Snapshot:** Record current cursor height (`StartHeight`) and mouse screen Y (`StartMouseY`).

    2. **Lock:** Freeze X and Z coordinates.

    3. **Delta Calculation:** `NewHeight = StartHeight + (CurrentMouseY - StartMouseY) * Sensitivity`.

* **Persistence:** When `Shift` is released, the cursor **stays** at the new height. It does *not* snap back to ground.

## 4. Unit Steering & Pathfinding

Units move freely in 3D space but must respect physics and obstacles.

**Steering Behaviors (Boids-lite):**

1. **Seek:** Move directly toward the target cursor.

2. **Separation:** Short-range repulsion force between units to prevent stacking/clipping.

3. **Obstacle Avoidance:**

    * Raycast or distance check against static spheres/obstacles.

    * Apply a strong repulsion vector perpendicular to the obstacle surface if too close.

## 5. Technical Implementation Guidelines

**Raycasting & Infinite Planes:**

* Do **not** use a finite mesh (e.g., a 200x200 plane) for ground detection.

* Use a mathematical **Infinite Plane** logic for raycasting. This ensures that if the camera looks at the horizon, the cursor logic still functions mathematically rather than breaking.

**Event Handling:**

* **Canvas Binding:** Attach event listeners (`mousemove`, `mousedown`) to the `<canvas>` or `renderer.domElement`, **not** the `window`.

* **Focus:** Ensure the canvas has `tabIndex="1"` and calls `.focus()` on click to ensure Keyboard Events (Shift) are captured.

* **Prevent Default:** Use `event.preventDefault()` on `mousedown` and `mousemove` to prevent the browser from interpreting dragging as text selection or image dragging.

**Camera Library Constraints (e.g., Three.js OrbitControls):**

* Explicitly **unbind** the Left Mouse Button from the camera library.

    * *Example:* `controls.mouseButtons.LEFT = null`.

* This is critical to allow the "Drag to Select" logic to function without fighting the camera.
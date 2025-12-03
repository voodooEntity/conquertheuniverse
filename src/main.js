// Entry point. Sets up scene, camera, renderer, and game systems.
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

import { createEngine } from './systems/engine.js';
import { InputSystem } from './systems/input.js';
import { GizmoRenderer } from './systems/gizmos.js';
import { UnitManager } from './units/unit_manager.js';
import { CommandBus } from './systems/command_bus.js';
import { ObstacleManager } from './systems/obstacles.js';
import { GridSliceXZ } from './systems/grid_slice_xz.js';
import { ShipLibrary } from './ships/ship_models.js';
import { MapLoader, applyMapToWorld } from './systems/map_loader.js';

const canvas = document.getElementById('rts-canvas');

// Three.js setup
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1e6);
camera.position.set(40, 30, 40);
camera.lookAt(0, 0, 0);

// Lights
const hemi = new THREE.HemisphereLight(0xddebf7, 0x0b0f14, 0.8);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(30, 50, 20);
scene.add(dir);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.enablePan = true; // use native smooth panning
controls.screenSpacePanning = false; // pan parallel to world-up (XZ), keep camera Y stable
controls.enableRotate = true;
// Disable wheel zoom so Wheel is repurposed to elevate cursor/plane
controls.enableZoom = false;
// Unbind left mouse for selection to work
controls.mouseButtons.LEFT = null;
// Configure right drag = pan, middle drag = rotate
controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;

// XZ grid slice that follows just below the cursor's Y (semi-transparent hacker green)
// halfSize/step will be updated after map load if provided
const gridSlice = new GridSliceXZ({ halfSize: 100, step: 10, color: 0x00ff66, opacity: 0.3 });
gridSlice.addTo(scene);

// Systems
const commandBus = new CommandBus();
const obstacles = new ObstacleManager(scene);
const shipLib = new ShipLibrary(scene);
const unitManager = new UnitManager(scene, obstacles, shipLib);
const gizmos = new GizmoRenderer(scene);
const input = new InputSystem(renderer.domElement, camera, controls, gizmos, commandBus, unitManager, { gridSlice });
const engine = createEngine(renderer, scene, camera, controls, [unitManager, obstacles, gridSlice, gizmos, input]);

// Map loading & world setup
(async function initMap() {
  try {
    const loader = new MapLoader();
    const map = await loader.load('./maps/example_star_systems.map.json');

    // Update grid slice size if provided
    const halfSize = map?.size?.halfSize ?? 100;
    const step = map?.size?.gridStep ?? 10;
    if (gridSlice) {
      // Recreate geometry by replacing object (simplest for now)
      scene.remove(gridSlice.object);
      const NewGridSlice = new GridSliceXZ({ halfSize, step, color: 0x00ff66, opacity: 0.3 });
      NewGridSlice.addTo(scene);
      // Replace reference used by input system
      const idx = engine ? undefined : undefined; // no-op, input holds reference
      input.gridSlice = NewGridSlice;
    }

    // Apply obstacles
    const { spawns } = applyMapToWorld(map, { obstacles });

    // Spawn a demo fleet at first spawn (fallback to origin)
    const spawn = spawns && spawns.length ? spawns[0] : new THREE.Vector3(0, 2, 0);
    await unitManager.spawnFleetAllShips(spawn);
  } catch (err) {
    console.error('Map load failed, falling back to defaults', err);
    await unitManager.spawnFleetAllShips();
  }
})();

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

// Start
engine.start();

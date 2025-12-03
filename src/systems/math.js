import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const UP = new THREE.Vector3(0, 1, 0);

export function rayFromMouse(ndcX, ndcY, camera) {
  // Robust ray from mouse using unproject
  const origin = camera.position.clone();
  const worldPoint = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
  const dir = worldPoint.sub(origin).normalize();
  return { origin, dir };
}

export function ndcFromMouseEvent(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  return { x, y };
}

// Raycast to infinite plane y=0; returns THREE.Vector3 or null
export function raycastGroundPlane(origin, dir) {
  const denom = dir.dot(UP);
  if (Math.abs(denom) < 1e-6) return null; // nearly parallel
  const t = -origin.y / denom; // plane at y=0 so p0=(0,0,0)
  if (t < 0) return null; // behind origin
  return origin.clone().add(dir.clone().multiplyScalar(t));
}

export function distance3(a, b) {
  return a.distanceTo(b);
}

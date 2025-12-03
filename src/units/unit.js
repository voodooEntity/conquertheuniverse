import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

let NEXT_ID = 1;

export class Unit {
  constructor(position = new THREE.Vector3(), opts = {}) {
    this.id = NEXT_ID++;
    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    this.target = null; // THREE.Vector3 or null
    this.selected = false;
    this.maxSpeed = opts.maxSpeed ?? 10;
    // Movement dynamics
    this.maxAccel = opts.maxAccel ?? 15; // units/s^2
    this.maxTurnRate = opts.maxTurnRate ?? 2.0; // rad/s
    this.radius = opts.radius ?? 0.8; // separation radius
    this.arriveRadius = 6; // start slowing down when within this distance
    this.stopRadius = 0.6; // consider arrived when within this distance (<= unit radius)
    this.idleDamping = 0.9; // velocity damping when idle to kill jitter

    // Basic health model
    this.maxHp = opts.maxHp ?? 100;
    this.hp = this.maxHp;

    // Obstacle avoidance params
    this.avoidLookahead = 1.2; // seconds of lookahead based on current speed
    this.avoidMargin = 0.6; // extra radius around obstacles beyond unit radius
    this.maxAvoidForce = 30; // cap avoidance steering
    this.avoidWeight = 1.2; // weight when adding to steering

    // Visual
    if (opts.mesh) {
      this.mesh = opts.mesh;
    } else {
      const geo = new THREE.SphereGeometry(0.6, 16, 12);
      const mat = new THREE.MeshStandardMaterial({ color: 0x99c1ff, metalness: 0.2, roughness: 0.7 });
      this.mesh = new THREE.Mesh(geo, mat);
    }
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.position.copy(this.position);
    this.mesh.matrixAutoUpdate = true;
  }

  setSelected(sel) {
    this.selected = sel;
    const applyMat = (mat) => {
      if (!mat) return;
      const applyOne = (m) => {
        if (!m) return;
        // Preserve originals once
        const ud = (m.userData = m.userData || {});
        if (ud.__origEmissive === undefined && m.emissive) {
          ud.__origEmissive = m.emissive.clone();
        }
        if (ud.__origEmissiveIntensity === undefined && m.emissiveIntensity !== undefined) {
          ud.__origEmissiveIntensity = m.emissiveIntensity;
        }
        // Highlight by emissive only, do not touch base color/texture
        if (m.emissive) {
          if (sel) {
            m.emissive.setHex(0x3355ff);
            if (m.emissiveIntensity !== undefined) m.emissiveIntensity = Math.max(1.0, m.emissiveIntensity || 1.0);
          } else {
            if (ud.__origEmissive) m.emissive.copy(ud.__origEmissive);
            if (ud.__origEmissiveIntensity !== undefined && m.emissiveIntensity !== undefined) m.emissiveIntensity = ud.__origEmissiveIntensity;
          }
        }
      };
      if (Array.isArray(mat)) mat.forEach(applyOne); else applyOne(mat);
    };
    if (this.mesh.isMesh) {
      applyMat(this.mesh.material);
    } else if (this.mesh && this.mesh.traverse) {
      this.mesh.traverse((o) => { if (o.isMesh) applyMat(o.material); });
    }
  }

  setTarget(vec3) {
    this.target = vec3 ? vec3.clone() : null;
  }

  update(dt, neighbors = [], obstacles = []) {
    const steer = new THREE.Vector3();

    // Arrival/seek
    if (this.target) {
      const toTarget = this.target.clone().sub(this.position);
      const d = toTarget.length();
      if (d <= this.stopRadius) {
        // Arrived: stop and clear target
        this.position.copy(this.position); // no snap to avoid overlap
        this.velocity.set(0, 0, 0);
        this.target = null;
      } else {
        // Slow down when close
        const desiredSpeed = d < this.arriveRadius ? (this.maxSpeed * (d / this.arriveRadius)) : this.maxSpeed;
        const desired = toTarget.multiplyScalar(1 / d).multiplyScalar(desiredSpeed);
        const arriveSteer = desired.sub(this.velocity);
        // cap acceleration
        const mag = arriveSteer.length();
        if (mag > this.maxAccel) arriveSteer.multiplyScalar(this.maxAccel / mag);
        steer.add(arriveSteer);
      }
    }

    // Separation
    const sepWeight = this.target ? 0.9 : 0.6; // keep some spacing even when idle
    const sep = separation(this, neighbors, this.maxAccel);
    steer.addScaledVector(sep, sepWeight);

    // Obstacle avoidance (spherical obstacles)
    if (obstacles && obstacles.length) {
      const avoid = avoidSpheres(this, obstacles);
      if (avoid.lengthSq() > 0) {
        // clamp and weight
        const mag = avoid.length();
        if (mag > this.maxAvoidForce) avoid.multiplyScalar(this.maxAvoidForce / mag);
        steer.addScaledVector(avoid, this.avoidWeight);
      }
    }

    // Integrate
    this.velocity.addScaledVector(steer, dt);
    // clamp speed
    const speed = this.velocity.length();
    if (speed > this.maxSpeed) this.velocity.multiplyScalar(this.maxSpeed / speed);

    // Dampen when idle to settle
    if (!this.target && speed > 0) this.velocity.multiplyScalar(Math.pow(this.idleDamping, Math.max(1, dt * 60)));

    this.position.addScaledVector(this.velocity, dt);
    this.mesh.position.copy(this.position);
    // Smooth orientation towards movement/goal based on turn rate
    this._updateOrientation(dt);
  }
}

// Note: classic 'seek' is replaced by arrival logic directly in update

function separation(self, neighbors, maxAccel) {
  const repulse = new THREE.Vector3();
  let count = 0;
  for (const n of neighbors) {
    if (n === self) continue;
    const diff = self.position.clone().sub(n.position);
    const d = diff.length();
    const desired = (self.radius + (n.radius ?? self.radius)) * 1.2; // include both radii with margin
    if (d > 0 && d < desired) {
      diff.divideScalar(d * d + 1e-6); // weight by distance^2
      repulse.add(diff);
      count++;
    }
  }
  if (count > 0) repulse.divideScalar(count);
  // clamp force
  const mag = repulse.length();
  if (mag > maxAccel) repulse.multiplyScalar(maxAccel / mag);
  return repulse;
}

// Predictive avoidance against spherical obstacles using lookahead ray/segment test
function avoidSpheres(self, obstacles) {
  // Determine forward direction to probe
  const forward = self.velocity.clone();
  if (forward.lengthSq() < 1e-4 && self.target) {
    forward.copy(self.target).sub(self.position);
  }
  const speed = Math.max(0.001, self.velocity.length());
  if (forward.lengthSq() < 1e-6) return new THREE.Vector3();
  forward.normalize();

  const lookDist = Math.max(2.0, speed * self.avoidLookahead + self.maxSpeed * 0.25);
  const segStart = self.position.clone();
  const segEnd = segStart.clone().addScaledVector(forward, lookDist);

  let mostThreat = null;
  let minDist = Infinity;
  let closestPoint = null;

  for (const ob of obstacles) {
    const center = ob.position;
    const expanded = ob.radius + self.radius + self.avoidMargin;
    // Check if obstacle is roughly ahead
    const toCenter = center.clone().sub(segStart);
    if (toCenter.dot(forward) < -expanded) continue; // behind and far

    // Find closest point on segment to sphere center
    const t = THREE.MathUtils.clamp(toCenter.dot(forward), 0, lookDist);
    const p = segStart.clone().addScaledVector(forward, t);
    const d = p.distanceTo(center);
    if (d < expanded && d < minDist) {
      minDist = d;
      mostThreat = ob;
      closestPoint = p;
    }
  }

  if (!mostThreat) return new THREE.Vector3();

  // Compute avoidance force away from obstacle surface normal at closest point
  const normal = closestPoint.clone().sub(mostThreat.position);
  const nLen = normal.length();
  if (nLen < 1e-6) return new THREE.Vector3();
  normal.divideScalar(nLen);

  // Strength increases as penetration increases
  const expanded = mostThreat.radius + self.radius + self.avoidMargin;
  const penetration = Math.max(0, expanded - minDist);
  const strength = THREE.MathUtils.clamp(penetration / expanded, 0.1, 1.0) * self.maxAvoidForce;

  // Prefer lateral deflection by removing component along forward to avoid stopping
  const avoidDir = normal.clone();
  // remove any component that would counter forward too much
  const forwardComp = avoidDir.dot(forward);
  avoidDir.addScaledVector(forward, -forwardComp).normalize();

  return avoidDir.multiplyScalar(strength);
}

// Smoothly orient mesh towards desired forward with limited angular velocity
Unit.prototype._updateOrientation = function(dt) {
  if (!this.mesh) return;
  const eps = 1e-4;
  let desiredForward = null;
  if (this.velocity.lengthSq() > eps) {
    desiredForward = this.velocity.clone().normalize();
  } else if (this.target) {
    const toT = this.target.clone().sub(this.position);
    if (toT.lengthSq() > eps) desiredForward = toT.normalize();
  }
  if (!desiredForward) return; // keep current orientation

  const up = new THREE.Vector3(0, 1, 0);
  // Build target quaternion from basis (right, up, forward)
  const right = new THREE.Vector3().crossVectors(up, desiredForward).normalize();
  const correctedUp = new THREE.Vector3().crossVectors(desiredForward, right).normalize();
  const m = new THREE.Matrix4().makeBasis(right, correctedUp, desiredForward);
  const targetQ = new THREE.Quaternion().setFromRotationMatrix(m);

  // Slerp with angle limit based on maxTurnRate (scaled a bit by speed fraction)
  const currentQ = this.mesh.quaternion.clone();
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(currentQ.dot(targetQ), -1, 1));
  if (angle < 1e-3) { this.mesh.quaternion.copy(targetQ); return; }

  const speedFrac = THREE.MathUtils.clamp(this.velocity.length() / Math.max(1e-4, this.maxSpeed), 0.3, 1.0);
  const maxAngle = this.maxTurnRate * speedFrac * dt;
  const t = THREE.MathUtils.clamp(maxAngle / angle, 0, 1);
  this.mesh.quaternion.slerp(targetQ, t);
};

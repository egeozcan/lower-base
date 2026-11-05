import * as THREE from './three.module.js';

const CAPACITY = 100;
// Normalized simulation progress: turn/raise, pour, then lower before departing.
const POUR_START = .3, POUR_END = .75, FLIGHT = .2;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

// Follow the simulation's parked unloading phase, rather than starting an
// after-effect once the empty collector has already left the refinery.
export class CollectorCargo {
  constructor(group, material, cargo = 0) {
    this.group = group;
    this.model = group.children[0];
    this.hopper = this.model.userData.hopper;
    this.fill = cargo / CAPACITY;
    this.delivery = null;
    this.transform = new THREE.Object3D();
    this.point = new THREE.Vector3();
    this.pile = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1), material, 24);
    this.pile.position.set(0, .06, -1.13);
    this.pile.castShadow = true; this.pile.receiveShadow = true;
    this.pile.frustumCulled = false;
    const color = new THREE.Color();
    for (let i = 0; i < 24; i++) {
      const row = Math.floor(i / 4), col = i % 4;
      const height = .58 + .24 * Math.sin(i * 2.4) ** 2;
      this.transform.position.set((col - 1.5) * .4, height * .48, (row - 2.5) * .34);
      this.transform.rotation.set(.1 * Math.sin(i), i * 2.4, .15 * Math.cos(i));
      this.transform.scale.set(.31, height, .29);
      this.transform.updateMatrix(); this.pile.setMatrixAt(i, this.transform.matrix);
      this.pile.setColorAt(i, color.setHex([0xffdc77, 0xd89a34, 0xf2be4c][i % 3]));
    }
    this.hopper.add(this.pile);
    this.stream = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1), material, 32);
    this.stream.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.stream.frustumCulled = false; this.stream.count = 0;
    this.stream.userData.decoration = true;
    group.add(this.stream);
  }

  update(item, buildings, dt, reducedMotion) {
    const amount = clamp((item.cargo || 0) / CAPACITY);
    const progress = clamp(item.unload_progress || 0);
    if (!progress || !this.group.visible) this.delivery = null;
    if (progress > 0 && !this.delivery && this.group.visible) {
      const refinery = buildings.filter(b => b.kind === 'refinery' && b.team === item.team && b.hp > 0)
        .sort((a, b) => Math.hypot(a.x - item.x, a.z - item.z) - Math.hypot(b.x - item.x, b.z - item.z))[0];
      if (refinery) {
        const side = refinery.team === 'enemy' ? -1 : 1;
        this.delivery = { fill: amount,
          target: new THREE.Vector3(refinery.x - .7 * side, 3.5, refinery.z - .7 * side),
          grains: Array.from({length: Math.max(8, Math.ceil(amount * 32))}, () => ({})) };
      }
    }
    this.stream.count = 0;
    this.hopper.rotation.x = 0;
    if (this.delivery) {
      const delivery = this.delivery;
      const poured = smooth((progress - POUR_START) / (POUR_END - POUR_START));
      this.fill = delivery.fill * (1 - poured);
      const yaw = Math.atan2(delivery.target.x - item.x, delivery.target.z - item.z);
      const turn = Math.atan2(Math.sin(yaw - this.model.rotation.y), Math.cos(yaw - this.model.rotation.y));
      this.model.rotation.y += Math.max(-dt * 8, Math.min(dt * 8, turn));
      if (!reducedMotion) {
        this.hopper.rotation.x = .95 * smooth((progress - .1) / .2)
          * (1 - smooth((progress - POUR_END) / (1 - POUR_END)));
      }
      this.group.updateWorldMatrix(true, true);
      for (let i = 0; i < delivery.grains.length; i++) {
        const grain = delivery.grains[i];
        const start = POUR_START + i / delivery.grains.length * (POUR_END - POUR_START);
        const t = (progress - start) / FLIGHT;
        if (t < 0 || t >= 1) continue;
        if (!grain.origin) {
          grain.origin = this.hopper.localToWorld(new THREE.Vector3((i % 5 - 2) * .16, .85, .08));
        }
        this.point.copy(grain.origin).lerp(delivery.target, t);
        this.point.y += (reducedMotion ? .4 : 2.4) * 4 * t * (1 - t);
        this.group.worldToLocal(this.point);
        this.transform.position.copy(this.point);
        this.transform.rotation.set(t * 7 + i, i * 2.4, t * 5);
        this.transform.scale.setScalar((.28 + (i % 3) * .055) * Math.min(1, (1 - t) * 6));
        this.transform.updateMatrix();
        this.stream.setMatrixAt(this.stream.count++, this.transform.matrix);
      }
      this.stream.instanceMatrix.needsUpdate = true;
    } else {
      // Smooth snapshot steps while keeping the pile rooted to the hopper floor.
      this.fill += (amount - this.fill) * (1 - Math.exp(-dt * 12));
    }
    this.pile.visible = this.fill > .001;
    this.pile.scale.y = Math.max(.001, this.fill * 1.35);
  }

  dispose() {
    // Remove cargo even when the hull has been detached to become a wreck.
    // The ore material is shared with other collectors and stays alive.
    for (const mesh of [this.pile, this.stream]) {
      mesh.removeFromParent(); mesh.dispose(); mesh.geometry.dispose();
    }
    this.delivery = null;
  }
}

import * as THREE from './three.module.js';

// All flames, smoke and sparks share two instanced draws. Fixed budgets keep a
// simultaneous army wipe from creating an unbounded number of GPU resources.
const random = (min, max) => min + Math.random() * (max - min);
const clamp = value => Math.max(0, Math.min(1, value));

function particleTexture(smoke) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(smoke ? .45 : .18, `rgba(255,255,255,${smoke ? .8 : .9})`);
  gradient.addColorStop(smoke ? .8 : .55, 'rgba(255,255,255,.2)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function particleBatch(scene, capacity, smoke) {
  const texture = particleTexture(smoke);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  geometry.setAttribute('particleAlpha', alpha);
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: texture }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
    vertexShader: `
      attribute float particleAlpha;
      varying vec2 vUv;
      varying vec4 vTint;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vTint = vec4(instanceColor, particleAlpha);
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D map;
      varying vec2 vUv;
      varying vec4 vTint;
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = texture2D(map, vUv) * vTint;
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, fog: true,
    blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color());
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; mesh.count = 0;
  mesh.renderOrder = smoke ? 1 : 2;
  scene.add(mesh);
  return { mesh, alpha, texture, capacity, particles: [] };
}

export class CombatEffects {
  constructor(scene, compact) {
    this.scene = scene;
    this.smoke = particleBatch(scene, compact ? 220 : 440, true);
    this.glow = particleBatch(scene, compact ? 280 : 560, false);
    this.transform = new THREE.Object3D();
    this.color = new THREE.Color();
    this.coolFlame = new THREE.Color(0xe23808);
    this.projectiles = [];
    this.remains = [];
    this.time = 0;
    this.shake = 0;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  }
  emit(type, position, options = {}) {
    const batch = type === 'smoke' || type === 'dust' ? this.smoke : this.glow;
    if (batch.particles.length >= batch.capacity) return;
    batch.particles.push({ type, x: position.x, y: position.y, z: position.z,
      vx: random(-.5, .5), vy: 1, vz: random(-.5, .5), age: 0,
      life: 1, size: 1, stretch: 1, color: 0xff8b24, ...options });
  }
  smokePuff(position, size = 1) {
    this.emit('smoke', position, { size, life: random(1.6, 2.6), vy: random(1.2, 2.5),
      vx: random(.2, .7), color: 0x454641 });
  }
  burn(position, scale = 1) {
    const origin = { x: position.x + random(-.45, .45) * scale,
      y: position.y, z: position.z + random(-.45, .45) * scale };
    this.emit('flame', origin, { size: random(1.1, 1.6) * scale, stretch: 1.8,
      vy: random(2, 3.8) * scale, life: random(.55, .85), color: 0xffa522 });
    this.emit('flash', origin, { size: .8 * scale, stretch: 1.4, vy: .6,
      life: .2, color: 0xffe7a0 });
    this.emit('spark', origin, { size: .1 * scale, life: random(.7, 1.3),
      vy: random(2.5, 4.5), vx: random(-1, 1), color: 0xffcc69 });
    this.smokePuff({ ...origin, y: origin.y + .6 * scale }, 1.2 * scale);
  }
  burst(position, scale, explosive = true) {
    if (explosive) {
      this.emit('flash', position, { size: scale * 4, life: .16, vy: 0, color: 0xffe6ac });
      for (let i = 0; i < 10; i++) {
        this.emit('flame', position, { size: random(.7, 1.5) * scale, life: random(.35, .65),
          vx: random(-3, 3) * scale, vy: random(1, 4) * scale, vz: random(-3, 3) * scale });
      }
      this.shake = Math.max(this.shake, Math.min(.32, scale * .12));
    }
    for (let i = 0; i < (explosive ? 18 : 6); i++) {
      const angle = random(0, Math.PI * 2), speed = random(1, 5) * scale;
      this.emit('spark', position, { size: random(.06, .13) * scale, life: random(.3, .85),
        vx: Math.cos(angle) * speed, vz: Math.sin(angle) * speed,
        vy: random(1, 6) * scale, gravity: 10, color: 0xffdf93 });
    }
    for (let i = 0; i < 7; i++) {
      const angle = i / 7 * Math.PI * 2;
      this.emit('dust', { ...position, y: .2 }, { size: scale * 1.2, life: random(.7, 1.3),
        vx: Math.cos(angle) * scale * 2.5, vz: Math.sin(angle) * scale * 2.5,
        vy: .2, color: 0x9f9675 });
      if (explosive) this.smokePuff(position, scale * random(1, 2));
    }
  }
  fire(shot) {
    const heavy = shot.kind !== 'soldier';
    const start = new THREE.Vector3(shot.x, shot.source_y, shot.z);
    const end = new THREE.Vector3(shot.target_x, shot.target_y, shot.target_z);
    const direction = end.clone().sub(start).normalize();
    const offset = Math.min(shot.kind === 'tank' ? 3.1 : 1.15, start.distanceTo(end) * .45);
    start.addScaledVector(direction, offset);
    // Infantry weapons sit to the right of the model's centerline.
    if (shot.source_is_unit && shot.kind !== 'tank') {
      start.x -= direction.z * .45; start.z += direction.x * .45;
    }
    this.emit('flash', start, { size: heavy ? 1.8 : .75, stretch: .8, life: heavy ? .11 : .07,
      vy: 0, color: 0xffe9ad });
    if (heavy) this.smokePuff(start, .55);
    const geometry = new THREE.BufferGeometry().setFromPoints([start, start]);
    const material = new THREE.LineBasicMaterial({ color: heavy ? 0xffb448 : 0xffe5a1,
      transparent: true, opacity: 1, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Line(geometry, material); this.scene.add(mesh);
    if (this.projectiles.length >= 128) this.removeProjectile(this.projectiles.shift());
    this.projectiles.push({ mesh, start, end, age: 0, trail: 0, kind: shot.kind,
      duration: heavy ? Math.max(.1, start.distanceTo(end) / (shot.kind === 'tank' ? 65 : 36)) : .085 });
  }
  destroy(entity) {
    const vehicle = ['tank', 'collector'].includes(entity.kind);
    const heavy = vehicle || !entity.isUnit;
    const scale = !entity.isUnit ? 2.5 : vehicle ? 1.25 : .45;
    const position = entity.group.position.clone(); position.y = heavy ? 1.3 : .5;
    this.burst(position, scale, heavy);
    // Keep the actual silhouette as a scorched wreck. The model is detached
    // before its selection and health UI are disposed by the renderer.
    const model = entity.group.children[0];
    entity.group.remove(model);
    const wreck = new THREE.Group(); wreck.position.copy(entity.group.position); wreck.add(model);
    for (const child of [...model.children]) {
      if (child.userData.decoration) {
        model.remove(child); child.geometry.dispose(); child.material.dispose();
      }
    }
    const material = new THREE.MeshStandardMaterial({ color: heavy ? 0x33332c : 0x55543d,
      roughness: 1, transparent: true });
    model.traverse(object => {
      if (object.isMesh) { object.material = material; object.castShadow = false; }
    });
    const scorchMaterial = new THREE.MeshBasicMaterial({ color: 0x25211a,
      transparent: true, opacity: .38, depthWrite: false, map: this.smoke.texture });
    const scorch = new THREE.Mesh(new THREE.PlaneGeometry(scale * 6, scale * 6), scorchMaterial);
    scorch.rotation.x = -Math.PI / 2; scorch.position.set(position.x, .07, position.z);
    this.scene.add(wreck, scorch);
    const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, heavy ? 12 : 3);
    debris.frustumCulled = false; this.scene.add(debris);
    const pieces = Array.from({ length: debris.count }, () => ({
      vx: random(-3, 3) * scale, vz: random(-3, 3) * scale, vy: random(3, 7) * scale,
      size: random(.12, .35) * scale, spin: random(-5, 5), angle: random(0, 6.28),
    }));
    if (this.remains.length >= 32) this.removeRemains(this.remains.shift());
    this.remains.push({ wreck, model, material, scorch, debris, pieces, age: 0, emission: 0,
      duration: heavy ? 10 : 3, heavy, vehicle, scale, position,
      rotation: model.rotation.clone() });
  }
  removeProjectile(projectile) {
    this.scene.remove(projectile.mesh);
    projectile.mesh.geometry.dispose(); projectile.mesh.material.dispose();
  }
  removeRemains(remains) {
    this.scene.remove(remains.wreck, remains.debris, remains.scorch);
    remains.scorch.geometry.dispose(); remains.scorch.material.dispose();
    remains.wreck.traverse(object => object.geometry?.dispose());
    remains.debris.dispose(); remains.debris.geometry.dispose(); remains.material.dispose();
  }
  update(dt, camera) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt);
    this.projectiles = this.projectiles.filter(p => {
      p.age += dt;
      const t = clamp(p.age / p.duration);
      const head = p.start.clone().lerp(p.end, t);
      const tail = p.start.clone().lerp(p.end, Math.max(0, t - (p.kind === 'soldier' ? .65 : .15)));
      const points = p.mesh.geometry.attributes.position;
      points.setXYZ(0, tail.x, tail.y, tail.z); points.setXYZ(1, head.x, head.y, head.z);
      points.needsUpdate = true; p.mesh.geometry.computeBoundingSphere();
      p.trail += dt;
      if (p.kind !== 'soldier' && p.trail >= .025) {
        p.trail = 0;
        this.emit('flash', head, { size: .5, life: .08, vy: 0, color: 0xffdc85 });
        if (p.kind === 'rocket') this.smokePuff(head, .4);
      }
      if (t < 1) return true;
      this.burst(p.end, p.kind === 'soldier' ? .18 : .55, p.kind !== 'soldier');
      this.removeProjectile(p); return false;
    });
    this.remains = this.remains.filter(r => {
      r.age += dt;
      if (r.age >= r.duration) { this.removeRemains(r); return false; }
      const collapse = 1 - Math.pow(1 - clamp(r.age / .6), 3);
      if (r.heavy) {
        r.model.scale.y = 1 - collapse * (r.vehicle ? .35 : .75);
        r.model.rotation.z = r.rotation.z + collapse * (r.vehicle ? .16 : .06);
      } else {
        r.model.rotation.x = r.rotation.x - collapse * Math.PI / 2;
        r.model.position.y = collapse * .2;
      }
      r.material.opacity = clamp((r.duration - r.age) / 2);
      r.scorch.material.opacity = r.material.opacity * .38;
      r.wreck.position.y = -Math.max(0, 1 - r.material.opacity) * .25;
      for (let i = 0; i < r.pieces.length; i++) {
        const p = r.pieces[i];
        // Ballistic debris settles once it reaches the ground.
        const flight = (p.vy + Math.sqrt(p.vy * p.vy + 20 * r.position.y)) / 10;
        const t = Math.min(r.age, flight);
        this.transform.position.set(r.position.x + p.vx * t,
          Math.max(p.size / 2, r.position.y + p.vy * t - 5 * t * t), r.position.z + p.vz * t);
        this.transform.rotation.set(t * p.spin, p.angle, t * p.spin * .7);
        this.transform.scale.set(p.size, p.size * .55, p.size * 1.4);
        this.transform.updateMatrix(); r.debris.setMatrixAt(i, this.transform.matrix);
      }
      r.debris.instanceMatrix.needsUpdate = true;
      r.emission += dt;
      if (r.heavy && r.age < 6 && r.emission > .12) {
        r.emission = 0;
        const size = r.scale * Math.min(1, (6 - r.age) / 2);
        this.burn(r.position, size);
      }
      return true;
    });
    for (const batch of [this.smoke, this.glow]) {
      batch.particles = batch.particles.filter(p => {
        p.age += dt;
        if (p.age >= p.life) return false;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.vy -= (p.gravity || 0) * dt;
        return p.y > -.1;
      });
      // Transparent smoke is sorted back to front even within the single draw.
      if (batch === this.smoke) batch.particles.sort((a, b) =>
        camera.matrixWorldInverse.elements[2] * (a.x - b.x) +
        camera.matrixWorldInverse.elements[6] * (a.y - b.y) +
        camera.matrixWorldInverse.elements[10] * (a.z - b.z));
      batch.particles.forEach((p, i) => {
        const t = p.age / p.life;
        const smoke = batch === this.smoke;
        const size = p.size * (smoke ? .65 + t * 1.8 : p.type === 'flame' ? 1 - t * .65 : 1);
        this.transform.position.set(p.x, p.y, p.z);
        this.transform.quaternion.copy(camera.quaternion);
        this.transform.scale.set(size, size * p.stretch, 1);
        this.transform.updateMatrix(); batch.mesh.setMatrixAt(i, this.transform.matrix);
        this.color.setHex(p.color);
        if (p.type === 'flame') this.color.lerp(this.coolFlame, t).multiplyScalar(2);
        batch.mesh.setColorAt(i, this.color);
        batch.alpha.setX(i, smoke ? Math.min(1, t * 8) * (1 - t) * .55 : (1 - t) * .9);
      });
      batch.mesh.count = batch.particles.length;
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.mesh.instanceColor.needsUpdate = true; batch.alpha.needsUpdate = true;
    }
  }
  clear() {
    for (const p of this.projectiles) this.removeProjectile(p);
    for (const r of this.remains) this.removeRemains(r);
    this.projectiles = []; this.remains = []; this.shake = 0;
    for (const batch of [this.smoke, this.glow]) { batch.particles = []; batch.mesh.count = 0; }
  }
  dispose() {
    this.clear();
    for (const batch of [this.smoke, this.glow]) {
      this.scene.remove(batch.mesh); batch.mesh.dispose(); batch.mesh.geometry.dispose();
      batch.mesh.material.dispose(); batch.texture.dispose();
    }
  }
}

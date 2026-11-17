import * as THREE from './three.module.js';
import { TerrainDamage, surfaceY } from './terrain-damage.js';

// All flames, smoke and sparks share two instanced draws. Fixed budgets keep a
// simultaneous army wipe from creating an unbounded number of GPU resources.
const random = (min, max) => min + Math.random() * (max - min);
const clamp = value => Math.max(0, Math.min(1, value));

function particleTexture(smoke) {
  const size = 128, half = size / 2;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  let seed = smoke ? 109 : 211;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const puff = (x, y, r, peak, mid) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${peak})`);
    g.addColorStop(.5, `rgba(255,255,255,${mid})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  if (smoke) {
    puff(half, half, half * .82, .62, .34);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + next() * .4, d = (.1 + next() * .26) * size;
      puff(half + Math.cos(a) * d, half + Math.sin(a) * d, (.18 + next() * .16) * size, .34 + next() * .18, .12);
    }
  } else {
    puff(half, half, half * .96, 1, .35);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + next() * .5, d = (.08 + next() * .16) * size;
      puff(half + Math.cos(a) * d, half + Math.sin(a) * d, (.16 + next() * .12) * size, .55, .15);
    }
  }
  return new THREE.CanvasTexture(canvas);
}

function debrisGrainTextures() {
  let seed = 313;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const make = (paint, colorSpace) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    paint(canvas.getContext('2d'), 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = colorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  };
  return {
    map: make((ctx, s) => {
      ctx.fillStyle = '#e8eae8'; ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(54,56,54,.6)'; ctx.lineWidth = 2;
      for (const p of [32, 96]) {
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(s, p); ctx.stroke();
      }
      for (let i = 0; i < 1100; i++) {
        ctx.fillStyle = next() < .5 ? 'rgba(255,255,255,.2)' : 'rgba(52,54,50,.28)';
        ctx.fillRect(next() * s, next() * s, 1 + next() * 2.5, 1 + next() * 2);
      }
    }, THREE.SRGBColorSpace),
    bumpMap: make((ctx, s) => {
      ctx.fillStyle = '#848484'; ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = '#242424'; ctx.lineWidth = 2.5;
      for (const p of [32, 96]) {
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(s, p); ctx.stroke();
      }
      for (let i = 0; i < 1300; i++) {
        ctx.fillStyle = next() < .5 ? 'rgba(215,215,215,.32)' : 'rgba(40,40,40,.32)';
        ctx.fillRect(next() * s, next() * s, 1 + next() * 2.5, 1 + next() * 2);
      }
    }, THREE.NoColorSpace),
  };
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

const CHAR_DEBRIS = new THREE.Color(0x2c302e);
const ARC_UP = new THREE.Vector3(0, 1, 0);
const ARC_FALLBACK = new THREE.Vector3(1, 0, 0);
const arcTan = new THREE.Vector3(), arcP1 = new THREE.Vector3(), arcP2 = new THREE.Vector3();

function makeFallenPool(geometry, material, capacity, scene) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.setColorAt(0, new THREE.Color());
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  scene.add(mesh);
  return { mesh, cursor: 0, capacity };
}

function buildRibbonGeometry(segments, halfWidth) {
  const positions = [];
  for (const [p0, p1] of segments) {
    arcTan.subVectors(p1, p0);
    if (arcTan.lengthSq() < 1e-6) continue;
    arcTan.normalize();
    arcP1.crossVectors(arcTan, ARC_UP);
    if (arcP1.lengthSq() < 1e-4) arcP1.crossVectors(arcTan, ARC_FALLBACK);
    arcP1.normalize().multiplyScalar(halfWidth);
    arcP2.crossVectors(arcTan, arcP1).normalize().multiplyScalar(halfWidth);
    for (const perp of [arcP1, arcP2]) {
      const a = p0.clone().add(perp), b = p0.clone().sub(perp);
      const c = p1.clone().add(perp), d = p1.clone().sub(perp);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      positions.push(b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

export class CombatEffects {
  // `sound(name, x, z, options)` plays a sound at a place on the field.
  constructor(scene, compact, foliage, sound = () => {}) {
    this.scene = scene;
    this.sound = sound;
    this.ground = new TerrainDamage(scene, compact, foliage);
    this.smoke = particleBatch(scene, compact ? 220 : 440, true);
    this.glow = particleBatch(scene, compact ? 280 : 560, false);
    this.transform = new THREE.Object3D();
    this.color = new THREE.Color();
    this.coolFlame = new THREE.Color(0xe23808);
    this.projectiles = [];
    this.remains = [];
    this.shockwaves = [];
    this.arcs = [];
    const grain = debrisGrainTextures();
    this.fallenMap = grain.map;
    this.fallenBump = grain.bumpMap;
    this.fallenMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: .82, metalness: .3,
      map: this.fallenMap, bumpMap: this.fallenBump, bumpScale: .055,
    });
    const plateCap = compact ? 64 : 128, smallCap = compact ? 32 : 64;
    this.fallenBatches = {
      plate: makeFallenPool(new THREE.BoxGeometry(1, 1, 1), this.fallenMaterial, plateCap, this.scene),
      wheel: makeFallenPool(new THREE.CylinderGeometry(.5, .5, 1, 10), this.fallenMaterial, smallCap, this.scene),
      helmet: makeFallenPool(new THREE.SphereGeometry(.5, 8, 5, 0, Math.PI * 2, 0, Math.PI * .65), this.fallenMaterial, smallCap, this.scene),
      rod: makeFallenPool(new THREE.CylinderGeometry(.42, .5, 1, 6).rotateX(Math.PI / 2), this.fallenMaterial, smallCap, this.scene),
    };
    this.fallenParts = this.fallenBatches.plate.mesh;
    this.fallenPieces = [];
    this.time = 0;
    this.shake = 0;
    this.demolitionShake = 0;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  }
  dropPart(part) {
    const origin = part.origin;
    const shape = this.fallenBatches[part.shape] ? part.shape : 'plate';
    const pool = this.fallenBatches[shape];
    const slot = pool.cursor++ % pool.capacity;
    pool.mesh.count = Math.min(pool.capacity, Math.max(pool.mesh.count, slot + 1));
    const raw = [
      Math.max(.08, part.size?.x || .2),
      Math.max(.08, part.size?.y || .15),
      Math.max(.08, part.size?.z || .2),
    ].sort((a, b) => a - b);
    let sx, sy, sz;
    if (shape === 'wheel') {
      const dia = Math.min(1.05, Math.max(.42, raw[2]));
      sy = Math.min(.36, Math.max(.18, raw[0]));
      sx = sz = dia;
    } else if (shape === 'helmet') {
      const dia = Math.min(.58, Math.max(.38, raw[2]));
      sy = Math.min(.26, Math.max(.16, raw[0]));
      sx = sz = dia;
    } else if (shape === 'rod') {
      const thick = Math.min(.22, Math.max(.07, raw[1]));
      sx = sy = thick;
      sz = Math.min(1.35, Math.max(.22, raw[2]));
    } else {
      sy = Math.min(.28, raw[0]);
      sx = Math.min(1.25, raw[1]);
      sz = Math.min(1.45, raw[2]);
    }
    const outX = part.outX ?? random(-1, 1), outZ = part.outZ ?? random(-1, 1);
    const speed = random(2.2, 4.2);
    const piece = {
      shape,
      mesh: pool.mesh,
      slot,
      x: origin.x,
      y: Math.max(.2, origin.y),
      z: origin.z,
      vx: part.vx ?? (outX * speed + random(-.8, .8)),
      vy: part.vy ?? random(3.2, 5.6),
      vz: part.vz ?? (outZ * speed + random(-.8, .8)),
      ax: random(0, 6.28),
      ay: random(0, 6.28),
      az: random(0, 6.28),
      sx, sy, sz,
      spin: random(-9, 9),
      bounces: 2,
      moving: true,
    };
    this.fallenPieces = this.fallenPieces.filter(p => !(p.shape === shape && p.slot === slot));
    this.fallenPieces.push(piece);
    this.color.setHex(part.color ?? 0x5c625e).lerp(CHAR_DEBRIS, random(.45, .65)).multiplyScalar(random(.75, .92));
    pool.mesh.setColorAt(slot, this.color);
    pool.mesh.instanceColor.needsUpdate = true;
    this.transform.position.set(piece.x, piece.y, piece.z);
    this.transform.rotation.set(piece.ax, piece.ay, piece.az);
    this.transform.scale.set(piece.sx, piece.sy, piece.sz);
    this.transform.updateMatrix();
    pool.mesh.setMatrixAt(slot, this.transform.matrix);
    pool.mesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < 3; i++) {
      this.emit('spark', origin, {
        size: random(.08, .14),
        life: random(.18, .38),
        vx: piece.vx * .5 + random(-1.4, 1.4),
        vy: random(1, 3.2),
        vz: piece.vz * .5 + random(-1.4, 1.4),
        gravity: 14,
        color: 0xffd27a,
      });
    }
    return piece;
  }
  electricSpark(position, scale = 1) {
    this.emit('flash', position, { size: .48 * scale, life: .055, vy: 0, color: 0x38d8ff });
    this.emit('flash', position, { size: .22 * scale, life: .04, vy: 0, color: 0xebfcff });
    const count = 10 + Math.floor(Math.random() * 5);
    const colors = [0x00d8ff, 0x4ae8ff, 0xffb820, 0xff7810];
    for (let i = 0; i < count; i++) {
      const angle = random(0, Math.PI * 2), speed = random(2.4, 6.4) * scale;
      this.emit('electric', position, {
        size: random(.15, .24) * scale,
        stretch: random(3.8, 5.4),
        life: random(.42, .80),
        vx: Math.cos(angle) * speed,
        vz: Math.sin(angle) * speed,
        vy: random(-.4, 3.0) * scale,
        gravity: 22,
        bounces: 2,
        angle,
        color: colors[i % colors.length],
      });
    }
    const bolts = 2 + (Math.random() < .5 ? 1 : 0);
    for (let b = 0; b < bolts; b++) {
      if (this.arcs.length >= 24) this.removeArc(this.arcs.shift());
      const span = (.65 + Math.random() * .75) * scale;
      const theta = random(0, Math.PI * 2), dy = random(-.25, .65) * scale;
      const start = new THREE.Vector3(position.x, position.y, position.z);
      const end = new THREE.Vector3(
        position.x + Math.cos(theta) * span,
        Math.max(.08, position.y + dy),
        position.z + Math.sin(theta) * span,
      );
      const points = [];
      for (let i = 0; i <= 6; i++) {
        const f = i / 6, jitter = i === 0 || i === 6 ? 0 : .20 * scale;
        points.push(new THREE.Vector3(
          THREE.MathUtils.lerp(start.x, end.x, f) + random(-jitter, jitter),
          Math.max(.05, THREE.MathUtils.lerp(start.y, end.y, f) + random(-jitter, jitter)),
          THREE.MathUtils.lerp(start.z, end.z, f) + random(-jitter, jitter),
        ));
      }
      const segments = [];
      for (let i = 0; i < points.length - 1; i++) segments.push([points[i], points[i + 1]]);
      // Add a short forked branch off the mid-bolt.
      const forkBase = points[2 + Math.floor(Math.random() * 2)];
      const forkMid = forkBase.clone().add(new THREE.Vector3(random(-.28, .28) * scale, random(-.12, .24) * scale, random(-.28, .28) * scale));
      const forkTip = forkMid.clone().add(new THREE.Vector3(random(-.24, .24) * scale, random(-.14, .18) * scale, random(-.24, .24) * scale));
      segments.push([forkBase, forkMid], [forkMid, forkTip]);

      const group = new THREE.Group();
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0x24d4ff, transparent: true, opacity: .82,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      });
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xe8fcff, transparent: true, opacity: .95,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      });
      const halo = new THREE.Mesh(buildRibbonGeometry(segments, .085 * scale), haloMat);
      const core = new THREE.Mesh(buildRibbonGeometry(segments, .028 * scale), coreMat);
      group.renderOrder = 3;
      group.add(halo, core);
      this.scene.add(group);
      this.arcs.push({ group, haloMat, coreMat, age: 0, life: random(.14, .22) });
    }
  }
  removeArc(arc) {
    this.scene.remove(arc.group);
    arc.group.traverse(object => object.geometry?.dispose());
    arc.haloMat.dispose();
    arc.coreMat.dispose();
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
    const dustCount = explosive ? 7 : 3;
    for (let i = 0; i < dustCount; i++) {
      const angle = i / dustCount * Math.PI * 2;
      this.emit('dust', { ...position, y: .2 }, {
        size: scale * (explosive ? 1.2 : .72),
        life: random(explosive ? .7 : .45, explosive ? 1.3 : .8),
        vx: Math.cos(angle) * scale * (explosive ? 2.5 : 1.8),
        vz: Math.sin(angle) * scale * (explosive ? 2.5 : 1.8),
        vy: explosive ? .2 : .45,
        color: 0x9f9675,
      });
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
    const weapon = shot.source_is_unit ? { soldier: 'rifle', rocket: 'rocket', tank: 'cannon' }[shot.kind]
      : heavy ? 'gun' : 'command';
    this.sound(weapon, shot.x, shot.z);
    const geometry = new THREE.BufferGeometry().setFromPoints([start, start]);
    const material = new THREE.LineBasicMaterial({ color: heavy ? 0xffb448 : 0xffe5a1,
      transparent: true, opacity: 1, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Line(geometry, material); this.scene.add(mesh);
    if (this.projectiles.length >= 128) this.removeProjectile(this.projectiles.shift());
    // Explosive rounds scar the ground under a unit they hit. Against a
    // building, only the occasional round that falls short does.
    let scar = null;
    if (heavy && shot.target_is_unit) {
      scar = { x: end.x + random(-.55, .55), z: end.z + random(-.55, .55), dx: direction.x, dz: direction.z };
    } else if (heavy && Math.random() < .35) {
      const short = random(4.5, 6.5);
      scar = { x: end.x - direction.x * short + random(-1.5, 1.5), z: end.z - direction.z * short + random(-1.5, 1.5), dx: direction.x, dz: direction.z };
    }
    // Guns fire the heaviest shell, then tanks, then rocket troopers.
    if (scar) scar.radius = !shot.source_is_unit ? 1.7 : shot.kind === 'tank' ? 1.1 : .85;
    this.projectiles.push({ mesh, start, end, age: 0, trail: 0, kind: shot.kind, scar,
      fromUnit: shot.source_is_unit,
      loudness: !shot.source_is_unit ? 1.3 : shot.kind === 'tank' ? 1 : .8,
      duration: heavy ? Math.max(.1, start.distanceTo(end) / (shot.kind === 'tank' ? 65 : 36)) : .085 });
  }
  explode(blast) {
    const origin = { x: blast.x, y: 1.2, z: blast.z };
    this.burst(origin, 3.8);
    this.sound('demolition', blast.x, blast.z);
    this.demolitionShake = 1;
    // A fast ground-level pressure front, rising fireball and hot flying debris.
    for (let i = 0; i < 24; i++) {
      const angle = i / 24 * Math.PI * 2, speed = random(7, 12);
      this.emit('dust', { ...origin, y: .25 }, { size: random(1.6, 2.8),
        life: random(.8, 1.3), vx: Math.cos(angle) * speed,
        vz: Math.sin(angle) * speed, vy: .35, color: 0xaaa080 });
    }
    for (let i = 0; i < 18; i++) {
      this.emit('flame', origin, { size: random(2, 4), stretch: 1.6,
        life: random(.5, 1), vx: random(-7, 7), vz: random(-7, 7),
        vy: random(4, 12), color: 0xffb431 });
      this.emit('spark', origin, { size: random(.15, .3), life: random(.7, 1.5),
        vx: random(-15, 15), vz: random(-15, 15), vy: random(6, 16),
        gravity: 16, color: 0xffe7a0 });
    }
    for (let i = 0; i < 8; i++) this.smokePuff({ ...origin, y: 2 + i * .6 }, random(3, 5));
    this.ground.crater(blast.x, blast.z, 2.4, { heat: 1 });
    this.ground.scorch(blast.x, blast.z, blast.radius * .95, .65, { heat: 1 });
    this.ground.blast(blast.x, blast.z, blast.radius + 4.5, 1);
    const mesh = new THREE.Mesh(new THREE.RingGeometry(.85, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0xffbc50, transparent: true, opacity: .8,
        side: THREE.DoubleSide, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(blast.x, .12, blast.z);
    this.scene.add(mesh);
    if (this.shockwaves.length >= 16) this.removeShockwave(this.shockwaves.shift());
    this.shockwaves.push({ mesh, radius: blast.radius, age: 0 });
  }
  removeShockwave(wave) {
    this.scene.remove(wave.mesh); wave.mesh.geometry.dispose(); wave.mesh.material.dispose();
  }
  destroy(entity) {
    const vehicle = ['tank', 'collector', 'demolition'].includes(entity.kind);
    const heavy = vehicle || !entity.isUnit;
    const scale = !entity.isUnit ? 2.5 : vehicle ? 1.25 : .45;
    const position = entity.group.position.clone(); position.y = heavy ? 1.3 : .5;
    if (entity.kind !== 'demolition') {
      this.burst(position, scale, heavy);
      this.sound(!entity.isUnit ? 'collapse' : vehicle ? 'wreck' : 'fall', position.x, position.z,
        { size: entity.kind === 'emplacement' ? .6 : 1 });
    }
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
    this.scene.add(wreck);
    // The ground keeps the scar after the wreck is gone. A truck's own blast
    // leaves a larger one.
    if (entity.kind !== 'demolition') {
      this.ground.scorch(position.x, position.z, heavy ? scale * 2.2 : 1, heavy ? .6 : .4);
      if (vehicle) this.ground.crater(position.x, position.z, .95);
      else if (heavy) this.ground.crater(position.x, position.z, 1.35);
      this.ground.blast(position.x, position.z, !entity.isUnit ? 7.5 : 4.2, !entity.isUnit ? .75 : .45);
    }
    const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, heavy ? 12 : 3);
    debris.frustumCulled = false; this.scene.add(debris);
    const pieces = Array.from({ length: debris.count }, () => ({
      vx: random(-3, 3) * scale, vz: random(-3, 3) * scale, vy: random(3, 7) * scale,
      size: random(.12, .35) * scale, spin: random(-5, 5), angle: random(0, 6.28),
    }));
    if (this.remains.length >= 32) this.removeRemains(this.remains.shift());
    this.remains.push({ wreck, model, material, debris, pieces, age: 0, emission: 0,
      duration: heavy ? 10 : 3, heavy, vehicle, scale, position,
      rotation: model.rotation.clone() });
  }
  removeProjectile(projectile) {
    this.scene.remove(projectile.mesh);
    projectile.mesh.geometry.dispose(); projectile.mesh.material.dispose();
  }
  removeRemains(remains) {
    this.scene.remove(remains.wreck, remains.debris);
    remains.wreck.traverse(object => {
      object.geometry?.dispose();
      if (object.isInstancedMesh) object.dispose();
    });
    remains.debris.dispose(); remains.debris.geometry.dispose(); remains.material.dispose();
  }
  update(dt, camera) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt);
    this.demolitionShake = Math.max(0, this.demolitionShake - dt);
    this.shockwaves = this.shockwaves.filter(wave => {
      wave.age += dt;
      if (wave.age >= .85) { this.removeShockwave(wave); return false; }
      const t = wave.age / .85;
      wave.mesh.scale.setScalar(wave.radius * Math.min(1, t * 2));
      wave.mesh.material.opacity = .8 * (1 - t);
      return true;
    });
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
      if (p.kind !== 'soldier') this.sound('impact', p.end.x, p.end.z, { size: p.loudness });
      if (p.scar) {
        this.ground.scorch(p.scar.x, p.scar.z, p.scar.radius, !p.fromUnit ? .52 : .4, { dx: p.scar.dx, dz: p.scar.dz, heat: .85 });
      }
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
        this.ground.scorch(r.position.x, r.position.z, r.scale * 1.5, .12, { heat: .6, passive: true });
      }
      return true;
    });
    this.arcs = this.arcs.filter(arc => {
      arc.age += dt;
      if (arc.age >= arc.life) { this.removeArc(arc); return false; }
      const fade = 1 - arc.age / arc.life;
      const flicker = .65 + .35 * Math.sin(arc.age * 160);
      arc.haloMat.opacity = .82 * fade * flicker;
      arc.coreMat.opacity = .95 * fade * flicker;
      return true;
    });
    if (this.fallenPieces.length) {
      const dirty = new Set();
      this.fallenPieces = this.fallenPieces.filter(p => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vy -= 15 * dt;
        p.ax += p.spin * dt;
        p.ay += p.spin * .7 * dt;
        p.az += p.spin * .9 * dt;
        if (p.bounces === 2 && Math.random() < .45) {
          this.emit('spark', { x: p.x, y: p.y, z: p.z }, { size: .12, stretch: 2.2, life: .16, color: 0xffd878 });
        }
        const floor = surfaceY(p.x, p.z) + p.sy * .5;
        if (p.y <= floor) {
          p.y = floor;
          if (p.bounces > 0 && Math.abs(p.vy) > .6) {
            p.vy = -p.vy * .36;
            p.vx *= .55;
            p.vz *= .55;
            p.spin *= .55;
            p.bounces--;
            this.emit('dust', { x: p.x, y: floor + .05, z: p.z }, { size: Math.max(.22, p.sx * .75), life: .4, vy: .3, color: 0x7e765c });
            this.emit('spark', { x: p.x, y: floor + .05, z: p.z }, { size: .06, life: .22, vy: random(.8, 2), vx: random(-1, 1), vz: random(-1, 1), gravity: 12, color: 0xffd47a });
          } else {
            p.moving = false;
            p.ax = (Math.random() - .5) * .2;
            p.az = (Math.random() - .5) * .2;
          }
        }
        this.transform.position.set(p.x, p.y, p.z);
        this.transform.rotation.set(p.ax, p.ay, p.az);
        this.transform.scale.set(p.sx, p.sy, p.sz);
        this.transform.updateMatrix();
        p.mesh.setMatrixAt(p.slot, this.transform.matrix);
        dirty.add(p.mesh);
        return p.moving;
      });
      for (const mesh of dirty) mesh.instanceMatrix.needsUpdate = true;
    }
    this.ground.update(dt, (type, pos, opts) => this.emit(type, pos, opts));
    for (const batch of [this.smoke, this.glow]) {
      batch.particles = batch.particles.filter(p => {
        p.age += dt;
        if (p.age >= p.life) return false;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.vy -= (p.gravity || 0) * dt;
        const floor = Math.max(-.16, surfaceY(p.x, p.z) + .03);
        if (p.bounces > 0 && p.y <= floor && p.vy < 0) {
          p.y = floor;
          p.vy = -p.vy * .45;
          p.vx *= .68;
          p.vz *= .68;
          p.bounces--;
        }
        return p.y > -.22;
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
        if (p.type === 'electric') {
          const e = camera.matrixWorldInverse.elements;
          const sx = e[0] * p.vx + e[4] * p.vy + e[8] * p.vz;
          const sy = e[1] * p.vx + e[5] * p.vy + e[9] * p.vz;
          this.transform.rotateZ(sx * sx + sy * sy > .04 ? Math.atan2(sy, sx) - Math.PI / 2 : (p.angle ?? 0));
        }
        this.transform.scale.set(size, size * p.stretch, 1);
        this.transform.updateMatrix(); batch.mesh.setMatrixAt(i, this.transform.matrix);
        this.color.setHex(p.color);
        if (p.type === 'flame') this.color.lerp(this.coolFlame, t).multiplyScalar(2);
        else if (p.type === 'electric') this.color.multiplyScalar(2.4);
        batch.mesh.setColorAt(i, this.color);
        const alpha = smoke ? Math.min(1, t * 8) * (1 - t) * .55
          : p.type === 'electric' ? (1 - t) * (.55 + .45 * Math.abs(Math.sin(p.age * 85 + i * 5)))
          : (1 - t) * .9;
        batch.alpha.setX(i, alpha);
      });
      batch.mesh.count = batch.particles.length;
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.mesh.instanceColor.needsUpdate = true; batch.alpha.needsUpdate = true;
    }
  }
  clear() {
    for (const wave of this.shockwaves) this.removeShockwave(wave);
    this.shockwaves = [];
    for (const arc of this.arcs) this.removeArc(arc);
    this.arcs = [];
    for (const p of this.projectiles) this.removeProjectile(p);
    for (const r of this.remains) this.removeRemains(r);
    this.projectiles = []; this.remains = []; this.shake = 0; this.demolitionShake = 0;
    this.fallenPieces = [];
    for (const pool of Object.values(this.fallenBatches)) {
      pool.cursor = 0; pool.mesh.count = 0; pool.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const batch of [this.smoke, this.glow]) { batch.particles = []; batch.mesh.count = 0; }
    this.ground.clear();
  }
  dispose() {
    this.clear();
    this.ground.dispose();
    for (const pool of Object.values(this.fallenBatches)) {
      this.scene.remove(pool.mesh); pool.mesh.dispose(); pool.mesh.geometry.dispose();
    }
    this.fallenMaterial.dispose();
    this.fallenMap.dispose();
    this.fallenBump.dispose();
    for (const batch of [this.smoke, this.glow]) {
      this.scene.remove(batch.mesh); batch.mesh.dispose(); batch.mesh.geometry.dispose();
      batch.mesh.material.dispose(); batch.texture.dispose();
    }
  }
}

import * as THREE from './three.module.js';

// Battle scars on the ground: burn marks where rounds land, and craters where
// vehicles, buildings and demolition trucks blow up. They last for the rest
// of the match, never affect it, and cost two instanced draws within fixed
// budgets; once a budget is full, the oldest scar makes room.
const HEIGHT = .045; // Just above the base aprons, level with where units stand.
const random = (min, max) => min + Math.random() * (max - min);
// The road and the two base aprons are hard surfaces: rubble instead of soil.
const paved = (x, z) => (Math.abs(x) < 4.5 && Math.abs(z) < 55)
  || (Math.abs(x) < 18.5 && Math.abs(Math.abs(z) - 42) < 9.5);
const BLOTCHES = 2, BLAST = 2, BOWL = 3;

// A 2×2 atlas of alpha masks: two burn marks, a blast with streaks thrown
// outward, and a crater floor.
function markTexture() {
  const cell = 128, canvas = document.createElement('canvas'); canvas.width = canvas.height = cell * 2;
  const ctx = canvas.getContext('2d');
  let seed = 7;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  // Cell rows count up from the bottom of the canvas, as texture coordinates do.
  const middle = index => [(index % 2 + .5) * cell, (1.5 - Math.floor(index / 2)) * cell];
  const blot = (x, y, radius, alpha) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(.55, `rgba(255,255,255,${alpha * .55})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  };
  for (let index = 0; index < BLOTCHES; index++) {
    const [x, y] = middle(index);
    for (let i = 0; i < 18; i++) {
      const angle = next() * Math.PI * 2, distance = next() * .25 * cell;
      blot(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, (.1 + next() * .13) * cell, .5);
    }
  }
  {
    const [x, y] = middle(BLAST);
    ctx.lineCap = 'round';
    for (let i = 0; i < 34; i++) {
      const angle = (i + next()) / 34 * Math.PI * 2, length = (.24 + next() * .22) * cell;
      const tipX = x + Math.cos(angle) * length, tipY = y + Math.sin(angle) * length;
      const streak = ctx.createLinearGradient(x, y, tipX, tipY);
      streak.addColorStop(0, 'rgba(255,255,255,.65)'); streak.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = streak; ctx.lineWidth = 2 + next() * 5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tipX, tipY); ctx.stroke();
    }
    for (let i = 0; i < 10; i++) {
      const angle = next() * Math.PI * 2, distance = next() * .12 * cell;
      blot(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, (.12 + next() * .1) * cell, .5);
    }
  }
  {
    // The sun stands in the south-west, so the floor is darkest under the
    // south-west rim. This mark is never turned.
    const [x, y] = middle(BOWL);
    blot(x, y, .46 * cell, .7);
    blot(x - .1 * cell, y + .1 * cell, .3 * cell, .8);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

function markBatch(scene, capacity) {
  const texture = markTexture();
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  const cell = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  geometry.setAttribute('markAlpha', alpha); geometry.setAttribute('markCell', cell);
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: texture }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
    vertexShader: `
      attribute float markAlpha;
      attribute float markCell;
      varying vec2 vUv;
      varying vec4 vTint;
      #include <fog_pars_vertex>
      void main() {
        vUv = (uv + vec2(mod(markCell, 2.), floor(markCell / 2.))) * .5;
        vTint = vec4(instanceColor, markAlpha);
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
        gl_FragColor = vec4(vTint.rgb, texture2D(map, vUv).a * vTint.a);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, fog: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.setColorAt(0, new THREE.Color());
  mesh.frustumCulled = false; mesh.count = 0;
  // Under the contact shadows of whatever stands on the mark.
  mesh.renderOrder = -2;
  scene.add(mesh);
  return { mesh, alpha, cell, texture };
}

// The rim of every crater: one uneven ring of thrown-up clods around a hole
// of radius one.
function rimGeometry() {
  let seed = 23;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const positions = [], clods = 13, transform = new THREE.Object3D();
  for (let i = 0; i < clods; i++) {
    const angle = (i + next() * .7) / clods * Math.PI * 2, distance = 1.02 + next() * .3;
    const clod = new THREE.IcosahedronGeometry(1, 0);
    transform.position.set(Math.cos(angle) * distance, .02, Math.sin(angle) * distance);
    transform.rotation.set(next() * 6, next() * 6, next() * 6);
    transform.scale.set(.2 + next() * .22, .09 + next() * .1, .16 + next() * .16);
    transform.updateMatrix();
    positions.push(...clod.applyMatrix4(transform.matrix).attributes.position.array);
    clod.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Scorched foliage: instances are recoloured, or removed, and restored when
// the next match starts.
class Foliage {
  constructor({ meshes, spots }) {
    this.meshes = meshes; this.spots = spots;
    this.matrices = meshes.map(mesh => mesh.instanceMatrix.array.slice());
    this.colors = meshes.map(mesh => mesh.instanceColor.array.slice());
    this.color = new THREE.Color();
  }
  // `amount` of 1 burns it black; `remove` takes it away instead.
  burn(x, z, radius, amount, remove = false) {
    let changed = false;
    for (let i = 0; i < this.spots.length; i++) {
      const distance = Math.hypot(this.spots[i].x - x, this.spots[i].z - z);
      if (distance > radius) continue;
      changed = true;
      for (const mesh of this.meshes) {
        if (remove) {
          mesh.setMatrixAt(i, GONE);
        } else {
          mesh.getColorAt(i, this.color);
          mesh.setColorAt(i, this.color.lerp(CHARRED, amount * (1 - .5 * distance / radius)));
        }
      }
    }
    if (changed) for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    }
  }
  restore() {
    this.meshes.forEach((mesh, i) => {
      mesh.instanceMatrix.array.set(this.matrices[i]); mesh.instanceColor.array.set(this.colors[i]);
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    });
  }
}
const CHARRED = new THREE.Color(0x15110c), GONE = new THREE.Matrix4().makeScale(0, 0, 0);

export class TerrainDamage {
  /** `foliage.grass` and `foliage.trees` are `{meshes, spots}` of instanced plants. */
  constructor(scene, compact, foliage) {
    this.scene = scene;
    this.capacity = compact ? 220 : 420;
    this.batch = markBatch(scene, this.capacity);
    this.marks = []; this.oldest = 0;
    this.rims = new THREE.InstancedMesh(rimGeometry(),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, flatShading: true }), compact ? 28 : 56);
    this.rims.setColorAt(0, new THREE.Color());
    this.rims.count = 0; this.rims.frustumCulled = false;
    this.rims.castShadow = true; this.rims.receiveShadow = true;
    this.craters = []; this.cratered = 0;
    scene.add(this.rims);
    this.grass = new Foliage(foliage.grass); this.trees = new Foliage(foliage.trees);
    this.transform = new THREE.Object3D(); this.color = new THREE.Color();
  }
  /** A burn mark. Hits on an existing mark darken and widen it instead. */
  scorch(x, z, radius, strength = .4) {
    for (let i = 0; i < this.marks.length; i++) {
      const mark = this.marks[i];
      if (mark.cell >= BLOTCHES || radius > mark.radius * 1.5 || Math.hypot(mark.x - x, mark.z - z) > mark.radius * .5) continue;
      mark.alpha = Math.min(.85, mark.alpha + strength * .3);
      mark.radius = Math.min(mark.limit, mark.radius * 1.05);
      this.write(i);
      return;
    }
    this.add({ x, z, radius, limit: radius * 1.6, alpha: strength, cell: Math.floor(Math.random() * BLOTCHES),
      turn: random(0, Math.PI * 2) });
    this.grass.burn(x, z, radius * .8, strength * 1.6);
  }
  /**
   * A crater: a blast mark, a dark floor and a rim of thrown-up ground. Where
   * there already is one, the ground is only burnt further, unless the new
   * crater is much the larger.
   */
  crater(x, z, radius) {
    if (this.craters.some(crater => crater.radius * 1.5 > radius && Math.hypot(crater.x - x, crater.z - z) < crater.radius + radius)) {
      this.scorch(x, z, radius * 2, .5);
      return;
    }
    const index = this.cratered++ % this.rims.instanceMatrix.count;
    this.craters[index] = { x, z, radius };
    this.add({ x, z, radius: radius * 2.6, alpha: .7, cell: BLAST, turn: random(0, Math.PI * 2) });
    this.add({ x, z, radius: radius * 1.15, alpha: .9, cell: BOWL, turn: 0 });
    this.transform.position.set(x, HEIGHT, z); this.transform.rotation.set(0, random(0, Math.PI * 2), 0);
    this.transform.scale.set(radius * random(.9, 1.1), radius * random(.8, 1.2), radius * random(.9, 1.1));
    this.transform.updateMatrix(); this.rims.setMatrixAt(index, this.transform.matrix);
    // Broken paving on the road and aprons, dark soil elsewhere.
    if (paved(x, z)) this.color.setHSL(.12, .05, random(.1, .15));
    else this.color.setHSL(.085, .32, random(.06, .09));
    this.rims.setColorAt(index, this.color);
    this.rims.count = this.craters.length;
    this.rims.instanceMatrix.needsUpdate = true; this.rims.instanceColor.needsUpdate = true;
    this.grass.burn(x, z, radius * 1.5, 0, true);
    this.grass.burn(x, z, radius * 2.6, 1);
  }
  /** A large blast blackens the trees it reaches. */
  blast(x, z, radius) {
    this.trees.burn(x, z, radius, 1);
  }
  add(mark) {
    let index = this.marks.length;
    if (index < this.capacity) this.marks.push(mark);
    else { index = this.oldest++ % this.capacity; this.marks[index] = mark; }
    this.write(index);
  }
  write(index) {
    const mark = this.marks[index], { mesh, alpha, cell } = this.batch;
    this.transform.position.set(mark.x, HEIGHT, mark.z); this.transform.rotation.set(0, mark.turn, 0);
    this.transform.scale.set(mark.radius * 2, 1, mark.radius * 2);
    this.transform.updateMatrix(); mesh.setMatrixAt(index, this.transform.matrix);
    mesh.setColorAt(index, this.color.setHex(paved(mark.x, mark.z) ? 0x11100e : 0x17120b));
    alpha.setX(index, mark.alpha); cell.setX(index, mark.cell);
    mesh.count = this.marks.length;
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    alpha.needsUpdate = true; cell.needsUpdate = true;
  }
  clear() {
    this.marks = []; this.oldest = 0; this.batch.mesh.count = 0;
    this.craters = []; this.cratered = 0; this.rims.count = 0;
    this.grass.restore(); this.trees.restore();
  }
  dispose() {
    this.clear();
    const { mesh, texture } = this.batch;
    this.scene.remove(mesh, this.rims);
    mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); texture.dispose();
    this.rims.dispose(); this.rims.geometry.dispose(); this.rims.material.dispose();
  }
}

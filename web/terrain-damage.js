import * as THREE from './three.module.js';

// Battle scars on the ground: burn marks, craters, thrown ejecta, blasted
// foliage, and subtle relief for passing vehicles. Scars stay within fixed
// instanced budgets for the match and never affect the simulation.
const random = (min, max) => min + Math.random() * (max - min);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

// Plane heights are shared with renderer.js so decals and rims never drift out
// of sync with the terrain slabs they sit on.
export const GROUND_Y = -.195, ROAD_Y = -.055, APRON_Y = .036;
const ROAD_HALF_X = 4.5, ROAD_HALF_Z = 55;
const APRON_HALF_X = 18.5, APRON_Z = 42, APRON_HALF_Z = 9.5;
const SOIL_SCAR_Y = GROUND_Y + .01, ROAD_SCAR_Y = ROAD_Y + .033, APRON_SCAR_Y = APRON_Y + .032;

export function surfaceKind(x, z) {
  if (Math.abs(x) < APRON_HALF_X && Math.abs(Math.abs(z) - APRON_Z) < APRON_HALF_Z) return 'apron';
  if (Math.abs(x) < ROAD_HALF_X && Math.abs(z) < ROAD_HALF_Z) return 'road';
  return 'soil';
}

export const paved = (x, z) => surfaceKind(x, z) !== 'soil';

export function surfaceY(x, z) {
  const kind = surfaceKind(x, z);
  return kind === 'apron' ? APRON_SCAR_Y : kind === 'road' ? ROAD_SCAR_Y : SOIL_SCAR_Y;
}

const BLOTCHES = 2, BLAST = 2, BOWL = 3;
const UP = new THREE.Vector3(0, 1, 0);
const CHARRED = new THREE.Color(0x15110c);
const ASH_STRAW = new THREE.Color(0x282114);
const GONE = new THREE.Matrix4().makeScale(0, 0, 0);

// Paint four linear masks separately and pack them into a DataTexture so low-
// alpha ragged edges avoid Canvas2D premultiplied-alpha quantization:
// R = soot and south-west pit shadow, G = exposed subsoil and sunlit inner wall,
// B = hot ember fissures, A = opacity mask.
function markTexture() {
  const cell = 256, size = cell * 2;
  const makeLayer = () => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    return { c, ctx };
  };
  const rLayer = makeLayer(), gLayer = makeLayer(), bLayer = makeLayer(), aLayer = makeLayer();
  let seed = 7;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  // Cell rows count up from the bottom of the canvas to match texture UVs.
  const middle = index => [(index % 2 + .5) * cell, (1.5 - Math.floor(index / 2)) * cell];

  const blot = (ctx, x, y, radius, alpha, innerStop = .48) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(innerStop, `rgba(255,255,255,${alpha * .52})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  };

  for (let index = 0; index < BLOTCHES; index++) {
    const [cx, cy] = middle(index);
    blot(rLayer.ctx, cx, cy, .34 * cell, .85);
    blot(aLayer.ctx, cx, cy, .36 * cell, .75);
    for (let i = 0; i < 24; i++) {
      const angle = next() * Math.PI * 2, dist = (.05 + next() * .24) * cell;
      const bx = cx + Math.cos(angle) * dist, by = cy + Math.sin(angle) * dist;
      const rad = (.07 + next() * .13) * cell;
      blot(rLayer.ctx, bx, by, rad, .42 + next() * .25);
      blot(aLayer.ctx, bx, by, rad * 1.05, .36 + next() * .28);
    }
    for (let i = 0; i < 14; i++) {
      const angle = next() * Math.PI * 2, dist = (.1 + next() * .3) * cell;
      const bx = cx + Math.cos(angle) * dist, by = cy + Math.sin(angle) * dist;
      const rad = (.018 + next() * .035) * cell;
      blot(rLayer.ctx, bx, by, rad, .45);
      blot(aLayer.ctx, bx, by, rad * 1.3, .5);
    }
    blot(bLayer.ctx, cx, cy, .11 * cell, .85, .25);
    for (let i = 0; i < 5; i++) {
      const angle = next() * Math.PI * 2, dist = (.04 + next() * .11) * cell;
      blot(bLayer.ctx, cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, (.02 + next() * .025) * cell, .75);
    }
  }

  {
    const [cx, cy] = middle(BLAST);
    for (const layer of [rLayer, gLayer, bLayer, aLayer]) layer.ctx.lineCap = 'round';
    blot(aLayer.ctx, cx, cy, .44 * cell, .45, .6);
    blot(rLayer.ctx, cx, cy, .32 * cell, .72, .45);
    for (let i = 0; i < 44; i++) {
      const angle = (i + next() * .85) / 44 * Math.PI * 2;
      const len = (.22 + next() * .25) * cell;
      const tipX = cx + Math.cos(angle) * len, tipY = cy + Math.sin(angle) * len;
      const width = 2 + next() * 6.5;
      for (const [layer, str] of [[aLayer, .7], [rLayer, i % 3 === 0 ? .45 : .8]]) {
        const grad = layer.ctx.createLinearGradient(cx, cy, tipX, tipY);
        grad.addColorStop(0, `rgba(255,255,255,${str})`);
        grad.addColorStop(.55, `rgba(255,255,255,${str * .45})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        layer.ctx.strokeStyle = grad;
        layer.ctx.lineWidth = width;
        layer.ctx.beginPath(); layer.ctx.moveTo(cx, cy); layer.ctx.lineTo(tipX, tipY); layer.ctx.stroke();
      }
      // Share one generated crack path across opacity, soot, and glowing fissures.
      if (i % 4 === 0) {
        const points = [[cx, cy]];
        let tx = cx, ty = cy, ta = angle;
        for (let seg = 1; seg <= 4; seg++) {
          ta += (next() - .5) * .45;
          tx += Math.cos(ta) * len * .22;
          ty += Math.sin(ta) * len * .22;
          points.push([tx, ty]);
        }
        for (const [layer, w, s] of [[aLayer, 2.2, .85], [rLayer, 2.5, .9], [bLayer, 1.5, .5]]) {
          layer.ctx.strokeStyle = `rgba(255,255,255,${s})`;
          layer.ctx.lineWidth = w;
          layer.ctx.beginPath();
          layer.ctx.moveTo(points[0][0], points[0][1]);
          for (let p = 1; p < points.length; p++) layer.ctx.lineTo(points[p][0], points[p][1]);
          layer.ctx.stroke();
        }
      }
    }
    for (let i = 0; i < 12; i++) {
      const angle = next() * Math.PI * 2, dist = next() * .16 * cell;
      const bx = cx + Math.cos(angle) * dist, by = cy + Math.sin(angle) * dist;
      const rad = (.09 + next() * .1) * cell;
      blot(aLayer.ctx, bx, by, rad, .65);
      blot(rLayer.ctx, bx, by, rad, .75);
    }
  }

  {
    const [cx, cy] = middle(BOWL);
    blot(aLayer.ctx, cx, cy, .46 * cell, .95, .72);
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2, dist = (.26 + next() * .09) * cell;
      blot(aLayer.ctx, cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, (.12 + next() * .06) * cell, .72, .55);
    }
    // The sun stands in the south-west, so the SW pit wall stays deepest in shadow.
    blot(rLayer.ctx, cx, cy, .42 * cell, .85, .5);
    blot(rLayer.ctx, cx - .11 * cell, cy + .11 * cell, .32 * cell, .95, .45);
    blot(gLayer.ctx, cx + .13 * cell, cy - .13 * cell, .3 * cell, .45, .35);
    gLayer.ctx.strokeStyle = 'rgba(255,255,255,.22)';
    gLayer.ctx.lineWidth = 4;
    gLayer.ctx.beginPath(); gLayer.ctx.arc(cx + .03 * cell, cy - .03 * cell, .28 * cell, -Math.PI * .75, Math.PI * .25); gLayer.ctx.stroke();
    gLayer.ctx.beginPath(); gLayer.ctx.arc(cx + .02 * cell, cy - .02 * cell, .19 * cell, -Math.PI * .65, Math.PI * .15); gLayer.ctx.stroke();
    blot(bLayer.ctx, cx, cy, .2 * cell, .88, .22);
    bLayer.ctx.lineCap = 'round';
    for (let i = 0; i < 10; i++) {
      let tx = cx, ty = cy, a = (i / 10) * Math.PI * 2 + next() * .4;
      bLayer.ctx.strokeStyle = `rgba(255,255,255,${.65 + next() * .35})`;
      bLayer.ctx.lineWidth = 2 + next() * 2.5;
      bLayer.ctx.beginPath(); bLayer.ctx.moveTo(tx, ty);
      for (let s = 0; s < 4; s++) {
        a += (next() - .5) * .9;
        tx += Math.cos(a) * .065 * cell;
        ty += Math.sin(a) * .065 * cell;
        bLayer.ctx.lineTo(tx, ty);
      }
      bLayer.ctx.stroke();
    }
  }

  const rData = rLayer.ctx.getImageData(0, 0, size, size).data;
  const gData = gLayer.ctx.getImageData(0, 0, size, size).data;
  const bData = bLayer.ctx.getImageData(0, 0, size, size).data;
  const aData = aLayer.ctx.getImageData(0, 0, size, size).data;
  const dst = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    // Flip canvas rows because DataTexture places row 0 at uv.y = 0.
    const srcRow = (size - 1 - y) * size * 4, dstRow = y * size * 4;
    for (let x = 0; x < size * 4; x += 4) {
      const s = srcRow + x, d = dstRow + x;
      dst[d] = rData[s];
      dst[d + 1] = gData[s];
      dst[d + 2] = bData[s];
      dst[d + 3] = aData[s];
    }
  }

  const texture = new THREE.DataTexture(dst, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

const glslFloat = n => Number.isInteger(n) ? `${n}.0` : String(n);

function markBatch(scene, capacity) {
  const texture = markTexture();
  // Subdivided decal plane conforms smoothly across soil/road/apron elevation steps.
  const geometry = new THREE.PlaneGeometry(1, 1, 10, 10).rotateX(-Math.PI / 2);
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  const cell = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  const heat = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  geometry.setAttribute('markAlpha', alpha);
  geometry.setAttribute('markCell', cell);
  geometry.setAttribute('markHeat', heat);
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: texture }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
    vertexShader: `
      attribute float markAlpha;
      attribute float markCell;
      attribute float markHeat;
      varying vec2 vUv;
      varying vec4 vTint;
      varying float vHeat;
      #include <fog_pars_vertex>
      void main() {
        vUv = (uv + vec2(mod(markCell, 2.), floor(markCell / 2.))) * .5;
        vTint = vec4(instanceColor, markAlpha);
        vHeat = markHeat;
        vec4 worldPos = instanceMatrix * vec4(position, 1.0);
        float sy = ${glslFloat(SOIL_SCAR_Y)};
        if (abs(worldPos.x) < ${glslFloat(ROAD_HALF_X)} && abs(worldPos.z) < ${glslFloat(ROAD_HALF_Z)}) sy = ${glslFloat(ROAD_SCAR_Y)};
        if (abs(worldPos.x) < ${glslFloat(APRON_HALF_X)} && abs(abs(worldPos.z) - ${glslFloat(APRON_Z)}) < ${glslFloat(APRON_HALF_Z)}) sy = ${glslFloat(APRON_SCAR_Y)};
        worldPos.y = sy + (markCell > 2.5 ? 0.008 : markCell > 1.5 ? 0.004 : 0.002);
        vec4 mvPosition = viewMatrix * modelMatrix * worldPos;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D map;
      varying vec2 vUv;
      varying vec4 vTint;
      varying float vHeat;
      #include <fog_pars_fragment>
      void main() {
        vec4 mask = texture2D(map, vUv);
        float alpha = mask.a * vTint.a;
        if (alpha < 0.01) discard;
        vec3 charCol = vec3(0.014, 0.011, 0.009);
        vec3 exposedCol = vTint.rgb;
        vec3 base = mix(charCol, exposedCol, clamp(mask.g * (1.0 - mask.r * 0.45), 0.0, 1.0));
        base = mix(base, charCol * 0.65, mask.r * (1.0 - mask.g) * 0.7);
        float ember = clamp(vHeat * mask.b, 0.0, 1.0);
        vec3 glow = vec3(1.85, 0.42, 0.05) * ember + vec3(1.2, 0.9, 0.35) * (ember > 0.001 ? pow(ember, 2.4) : 0.0);
        gl_FragColor = vec4(base + glow, alpha);
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
  return { mesh, alpha, cell, heat, texture };
}

// Build the crater lip and outer ejecta into one geometry. Position uses `angle`
// while `ry = -angle` aligns local +X radially outward so `rz < 0` tilts the
// clod away from the pit rather than inward.
function rimGeometry() {
  let seed = 23;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const positions = [], colors = [], transform = new THREE.Object3D();
  transform.rotation.order = 'YXZ';

  const pushChunk = (geo, angle, distance, y, sx, sy, sz, rx, ry, rz, shadeFn) => {
    const chunk = geo.index ? geo.toNonIndexed() : geo;
    transform.position.set(Math.cos(angle) * distance, y, Math.sin(angle) * distance);
    transform.rotation.set(rx, ry, rz);
    transform.scale.set(sx, sy, sz);
    transform.updateMatrix();
    chunk.applyMatrix4(transform.matrix);
    const arr = chunk.attributes.position.array;
    for (let j = 0; j < arr.length; j += 3) {
      positions.push(arr[j], arr[j + 1], arr[j + 2]);
      const s = shadeFn(arr[j], arr[j + 1], arr[j + 2]);
      colors.push(s, s, s);
    }
    if (chunk !== geo) chunk.dispose();
    geo.dispose();
  };

  const innerClods = 18;
  for (let i = 0; i < innerClods; i++) {
    const angle = (i + next() * .55) / innerClods * Math.PI * 2;
    const distance = .96 + next() * .16;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    pushChunk(
      geo, angle, distance, .015 + next() * .02,
      .18 + next() * .11, .07 + next() * .06, .17 + next() * .11,
      (next() - .5) * .35, -angle, -.34 + (next() - .5) * .15,
      (vx, vy, vz) => {
        const r = Math.hypot(vx, vz);
        const slope = r < distance ? .44 : .72;
        return clamp(slope + vy * 2.2, .38, 1.15);
      }
    );
  }

  const outerChunks = 10;
  for (let i = 0; i < outerChunks; i++) {
    const angle = (i + next() * .85) / outerChunks * Math.PI * 2;
    const distance = 1.14 + next() * .22;
    const shade = .68 + next() * .54;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    pushChunk(
      geo, angle, distance, .012,
      .08 + next() * .08, .03 + next() * .03, .08 + next() * .08,
      (next() - .5) * .6, next() * Math.PI * 2, (next() - .5) * .6,
      () => shade
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Scorched & blast-combed grass tufts, restored when the next match starts.
class GrassFoliage {
  constructor({ meshes, spots }) {
    this.meshes = meshes; this.spots = spots;
    this.matrices = meshes.map(mesh => mesh.instanceMatrix.array.slice());
    this.colors = meshes.map(mesh => mesh.instanceColor.array.slice());
    this.removed = new Uint8Array(spots.length);
    this.tilt = new Float32Array(spots.length);
    this.color = new THREE.Color();
    this.baseMat = new THREE.Matrix4();
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.scale = new THREE.Vector3();
    this.tiltQuat = new THREE.Quaternion();
    this.dir = new THREE.Vector3();
  }
  burn(x, z, radius, amount, remove = false) {
    let changed = false;
    for (let i = 0; i < this.spots.length; i++) {
      if (this.removed[i]) continue;
      const dx = this.spots[i].x - x, dz = this.spots[i].z - z;
      const distance = Math.hypot(dx, dz);
      if (distance > radius) continue;
      changed = true;
      if (remove) {
        this.removed[i] = 1;
        for (const mesh of this.meshes) mesh.setMatrixAt(i, GONE);
        continue;
      }
      const near = 1 - distance / radius;
      const nx = distance > 1e-3 ? dx / distance : 1, nz = distance > 1e-3 ? dz / distance : 0;
      const nextTilt = Math.min(1.15, Math.max(this.tilt[i], near * Math.min(1.15, amount * 1.1)));
      this.tilt[i] = nextTilt;

      for (let m = 0; m < this.meshes.length; m++) {
        const mesh = this.meshes[m];
        mesh.getColorAt(i, this.color);
        const target = near > .45 ? CHARRED : ASH_STRAW;
        this.color.lerp(target, clamp(amount * (1 - .45 * distance / radius)));
        mesh.setColorAt(i, this.color);

        this.baseMat.fromArray(this.matrices[m], i * 16);
        this.baseMat.decompose(this.pos, this.quat, this.scale);
        this.dir.set(nx * Math.sin(nextTilt), Math.cos(nextTilt), nz * Math.sin(nextTilt)).normalize();
        this.tiltQuat.setFromUnitVectors(UP, this.dir);
        this.quat.premultiply(this.tiltQuat);
        const squash = 1 - .45 * (nextTilt / 1.15);
        this.scale.y *= squash;
        this.pos.y = -0.2 + .27 * this.scale.y * Math.cos(nextTilt);
        this.baseMat.compose(this.pos, this.quat, this.scale);
        mesh.setMatrixAt(i, this.baseMat);
      }
    }
    if (changed) for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    }
  }
  restore() {
    this.removed.fill(0);
    this.tilt.fill(0);
    this.meshes.forEach((mesh, i) => {
      mesh.instanceMatrix.array.set(this.matrices[i]); mesh.instanceColor.array.set(this.colors[i]);
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    });
  }
}

// Forest trees: trunks and tiered canopies char, lean radially away from
// shockwaves, strip upper crowns in lethal blast cores, and sway briefly.
class TreeFoliage {
  constructor({ trunks, meshes, spots }) {
    this.trunks = trunks || null;
    this.canopies = meshes;
    this.allMeshes = [...(trunks ? [trunks] : []), ...meshes];
    this.spots = spots;
    this.matrices = this.allMeshes.map(mesh => mesh.instanceMatrix.array.slice());
    this.colors = this.allMeshes.map(mesh => mesh.instanceColor.array.slice());
    this.states = spots.map(() => ({ damage: 0, tilt: 0, dirX: 1, dirZ: 0, sway: 0, swayVel: 0, strippedUpper: false }));
    this.color = new THREE.Color();
    this.origMat = new THREE.Matrix4();
    this.pivotMat = new THREE.Matrix4();
    this.rotMat = new THREE.Matrix4();
    this.transPos = new THREE.Matrix4();
    this.transNeg = new THREE.Matrix4();
    this.shrinkMat = new THREE.Matrix4();
    this.tiltQuat = new THREE.Quaternion();
    this.dir = new THREE.Vector3();
  }
  applyTree(i) {
    const s = this.states[i], spot = this.spots[i];
    const angle = clamp(s.tilt + s.sway, 0, 1.3);
    this.dir.set(s.dirX * Math.sin(angle), Math.cos(angle), s.dirZ * Math.sin(angle)).normalize();
    this.tiltQuat.setFromUnitVectors(UP, this.dir);
    this.transPos.makeTranslation(spot.x, 0, spot.z);
    this.transNeg.makeTranslation(-spot.x, 0, -spot.z);
    this.rotMat.makeRotationFromQuaternion(this.tiltQuat);
    this.pivotMat.multiplyMatrices(this.transPos, this.rotMat).multiply(this.transNeg);

    const upperMesh = this.canopies[this.canopies.length - 1];
    const lowerMesh = this.canopies[0];
    for (let m = 0; m < this.allMeshes.length; m++) {
      const mesh = this.allMeshes[m];
      if (s.strippedUpper && this.canopies.length > 1 && mesh === upperMesh) {
        mesh.setMatrixAt(i, GONE);
        continue;
      }
      this.origMat.fromArray(this.matrices[m], i * 16);
      if (s.strippedUpper && mesh === lowerMesh) {
        this.shrinkMat.makeScale(.6, .55, .6);
        this.origMat.multiply(this.shrinkMat);
      }
      this.origMat.premultiply(this.pivotMat);
      mesh.setMatrixAt(i, this.origMat);
    }
  }
  blast(x, z, radius, strength = 1) {
    let changed = false;
    for (let i = 0; i < this.spots.length; i++) {
      const spot = this.spots[i];
      const dx = spot.x - x, dz = spot.z - z;
      const distance = Math.hypot(dx, dz);
      if (distance > radius) continue;
      changed = true;
      const near = (1 - distance / radius) * strength;
      const nx = distance > 1e-3 ? dx / distance : 1, nz = distance > 1e-3 ? dz / distance : 0;
      const s = this.states[i];
      if (s.damage === 0) { s.dirX = nx; s.dirZ = nz; }
      else {
        const bx = s.dirX * s.damage + nx * near, bz = s.dirZ * s.damage + nz * near;
        const blen = Math.hypot(bx, bz) || 1;
        s.dirX = bx / blen; s.dirZ = bz / blen;
      }
      s.damage = Math.min(1, s.damage + near * .95);
      s.tilt = Math.min(1.18, s.tilt + near * .85);
      s.swayVel += near * 4.2;
      if (s.damage > .7) s.strippedUpper = true;

      for (const mesh of this.allMeshes) {
        mesh.getColorAt(i, this.color);
        this.color.lerp(CHARRED, clamp(near * 1.15));
        mesh.setColorAt(i, this.color);
      }
      this.applyTree(i);
    }
    if (changed) for (const mesh of this.allMeshes) {
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    }
  }
  update(dt) {
    let changed = false;
    for (let i = 0; i < this.states.length; i++) {
      const s = this.states[i];
      if (Math.abs(s.sway) <= 1e-4 && Math.abs(s.swayVel) <= 1e-4) continue;
      const accel = -38 * s.sway - 5.5 * s.swayVel;
      s.swayVel += accel * dt;
      s.sway += s.swayVel * dt;
      if (Math.abs(s.sway) < 1e-3 && Math.abs(s.swayVel) < 1e-3) { s.sway = 0; s.swayVel = 0; }
      this.applyTree(i);
      changed = true;
    }
    if (changed) for (const mesh of this.allMeshes) mesh.instanceMatrix.needsUpdate = true;
  }
  restore() {
    for (const s of this.states) {
      s.damage = 0; s.tilt = 0; s.dirX = 1; s.dirZ = 0; s.sway = 0; s.swayVel = 0; s.strippedUpper = false;
    }
    this.allMeshes.forEach((mesh, i) => {
      mesh.instanceMatrix.array.set(this.matrices[i]); mesh.instanceColor.array.set(this.colors[i]);
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    });
  }
}

export class TerrainDamage {
  /** `foliage.grass` and `foliage.trees` are `{meshes, spots}` (plus optional `trunks`). */
  constructor(scene, compact, foliage) {
    this.scene = scene;
    this.capacity = compact ? 240 : 480;
    this.batch = markBatch(scene, this.capacity);
    this.marks = []; this.oldest = 0;

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: .95, metalness: .02, flatShading: true, vertexColors: true,
    });
    this.rims = new THREE.InstancedMesh(rimGeometry(), rimMat, compact ? 32 : 64);
    this.rims.setColorAt(0, new THREE.Color());
    this.rims.count = 0; this.rims.frustumCulled = false;
    this.rims.castShadow = true; this.rims.receiveShadow = true;
    this.craters = []; this.cratered = 0;
    scene.add(this.rims);

    const ejectaMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: .95, metalness: .02, flatShading: true,
    });
    this.ejecta = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), ejectaMat, compact ? 64 : 128);
    this.ejecta.setColorAt(0, new THREE.Color());
    this.ejecta.count = 0; this.ejecta.frustumCulled = false;
    this.ejecta.castShadow = true; this.ejecta.receiveShadow = true;
    this.clods = []; this.clodCursor = 0;
    scene.add(this.ejecta);

    this.grass = new GrassFoliage(foliage.grass);
    this.trees = new TreeFoliage(foliage.trees);
    this.transform = new THREE.Object3D();
    this.color = new THREE.Color();
    this.sampled = { y: 0, pitch: 0, roll: 0, soot: 0 };
  }

  surfaceColor(x, z, isCrater = false) {
    const kind = surfaceKind(x, z);
    if (kind === 'apron') return this.color.setHSL(.11, .05, isCrater ? random(.14, .19) : random(.09, .13));
    if (kind === 'road') return this.color.setHSL(.11, .04, isCrater ? random(.09, .13) : random(.06, .09));
    return this.color.setHSL(.085, .32, isCrater ? random(.065, .095) : random(.05, .075));
  }

  inAnyCrater(x, z) {
    for (let i = 0; i < this.craters.length; i++) {
      const cr = this.craters[i];
      if (cr && cr.radius > 0 && Math.hypot(x - cr.x, z - cr.z) < cr.radius * 1.35) return true;
    }
    return false;
  }

  clearBowlClods() {
    let changed = false;
    for (let i = 0; i < this.clods.length; i++) {
      const c = this.clods[i];
      if (c.hidden || !this.inAnyCrater(c.x, c.z)) continue;
      c.flying = false;
      c.hidden = true;
      this.ejecta.setMatrixAt(i, GONE);
      changed = true;
    }
    if (changed) this.ejecta.instanceMatrix.needsUpdate = true;
  }

  spawnEjecta(x, z, count, spread, speed, dx, dz) {
    const capacity = this.ejecta.instanceMatrix.count;
    const baseAngle = dx !== undefined ? Math.atan2(dz, dx) : null;
    for (let i = 0; i < count; i++) {
      const index = this.clods.length < capacity ? this.clods.length : this.clodCursor++ % capacity;
      const angle = baseAngle !== null && Math.random() < .6
        ? baseAngle + random(-1.1, 1.1) : random(0, Math.PI * 2);
      const horiz = random(1.8, speed);
      const startR = spread * 1.15;
      const sx = x + Math.cos(angle) * startR;
      const sz = z + Math.sin(angle) * startR;
      const size = random(.07, .16) * (1 + spread * .08);
      const clod = {
        x: sx, y: surfaceY(sx, sz) + .14, z: sz,
        vx: Math.cos(angle) * horiz, vy: random(3.5, speed * 1.45), vz: Math.sin(angle) * horiz,
        rx: random(0, 6.28), ry: random(0, 6.28), rz: random(0, 6.28),
        spinX: random(-9, 9), spinY: random(-9, 9),
        size, flying: true, hidden: false,
      };
      this.clods[index] = clod;
      this.writeClod(index, clod);
      this.ejecta.setColorAt(index, this.surfaceColor(x, z, true));
    }
    this.ejecta.count = this.clods.length;
    this.ejecta.instanceMatrix.needsUpdate = true;
    this.ejecta.instanceColor.needsUpdate = true;
  }

  writeClod(index, clod) {
    this.transform.position.set(clod.x, clod.y, clod.z);
    this.transform.rotation.set(clod.rx, clod.ry, clod.rz);
    this.transform.scale.set(clod.size, clod.size * .55, clod.size * .82);
    this.transform.updateMatrix();
    this.ejecta.setMatrixAt(index, this.transform.matrix);
  }

  /** A burn mark. Active shell hits widen, throw clods, and dig a crater on repeat heavy hits; `passive` fire only darkens and re-heats. */
  scorch(x, z, radius, strength = .4, options = {}) {
    const passive = !!options.passive;
    const heat = options.heat ?? Math.min(1, strength * 1.4);
    const turn = options.dx !== undefined ? Math.atan2(options.dx, options.dz) + random(-.35, .35) : random(0, Math.PI * 2);
    for (let i = 0; i < this.marks.length; i++) {
      const mark = this.marks[i];
      if (mark.cell >= BLOTCHES || radius > mark.radius * 1.5 || Math.hypot(mark.x - x, mark.z - z) > mark.radius * .55) continue;
      mark.alpha = Math.min(.92, mark.alpha + strength * (passive ? .08 : .3));
      mark.heat = Math.min(1, Math.max(mark.heat, heat * .75) + strength * .55);
      if (!passive) {
        mark.hits = (mark.hits || 1) + 1;
        mark.radius = Math.min(mark.limit, mark.radius * 1.15);
      }
      this.write(i);
      this.grass.burn(mark.x, mark.z, mark.radius * .95, strength * 1.6);
      if (!passive && radius >= 1.0) this.spawnEjecta(x, z, 2, radius * .6, 5, options.dx, options.dz);
      if (!passive && mark.limit >= 1.2 * 1.65 && mark.hits >= 4 && !mark.excavated) {
        mark.excavated = true;
        this.crater(mark.x, mark.z, Math.min(1.3, mark.radius * .65), options);
      }
      return;
    }
    this.add({
      x, z, radius, limit: radius * 1.65, alpha: Math.min(.92, strength + .1),
      cell: Math.floor(Math.random() * BLOTCHES), turn, heat, hits: passive ? 0 : 1, excavated: false,
      isCrater: false,
    });
    this.grass.burn(x, z, radius * .95, strength * 1.6);
    if (!passive && radius >= 1.0) this.spawnEjecta(x, z, 2, radius * .6, 5, options.dx, options.dz);
  }

  /**
   * A crater: blast rays, shaded pit with cooling embers, and a 3D rim with ejecta.
   * Near-center hits merge modestly; rim-overlapping hits scorch instead unless much larger,
   * and engulfed smaller craters are absorbed so rims never intersect.
   */
  crater(x, z, radius, options = {}) {
    const heat = options.heat ?? 1.0;

    // Merge into a nearby crater only when the new impact lands inside its core.
    for (let i = 0; i < this.craters.length; i++) {
      const existing = this.craters[i];
      if (!existing || existing.radius <= 0) continue;
      const dist = Math.hypot(existing.x - x, existing.z - z);
      if (dist < Math.max(existing.radius, radius) * .5) {
        if (radius > existing.radius) {
          const w = (radius * radius) / (existing.radius * existing.radius + radius * radius);
          existing.x += (x - existing.x) * w;
          existing.z += (z - existing.z) * w;
        }
        let maxR = Math.min(2.4, Math.max(existing.radius, radius) * 1.06 + Math.min(existing.radius, radius) * .08);
        // Prevent a merged crater from swelling into a larger neighbor's rim.
        for (let j = 0; j < this.craters.length; j++) {
          if (j === i) continue;
          const other = this.craters[j];
          if (!other || other.radius <= 0) continue;
          const od = Math.hypot(other.x - existing.x, other.z - existing.z);
          if (other.radius > maxR / .8 && od < (maxR + other.radius) * 1.35) {
            maxR = Math.max(existing.radius, od / 1.35 - other.radius);
          }
        }
        existing.radius = maxR;
        existing.smoke = 10;
        this.writeRim(i, existing);
        this.syncCraterMarks(existing, heat);
        this.absorbUnder(existing, i);
        this.applyCraterImpacts(existing.x, existing.z, existing.radius, options.dx, options.dz);
        return;
      }
    }

    // Never place an intersecting rim next to a comparable or larger crater.
    if (this.craters.some(c => c && c.radius > 0 && c.radius * 1.2 >= radius && Math.hypot(c.x - x, c.z - z) < (c.radius + radius) * 1.35)) {
      this.scorch(x, z, radius * 1.6, .45, { ...options, passive: true });
      return;
    }

    const index = this.cratered++ % this.rims.instanceMatrix.count;
    const blastTurn = options.dx !== undefined ? Math.atan2(options.dx, options.dz) : random(0, Math.PI * 2);
    const blastMark = this.add({
      x, z, radius: radius * 2.5, alpha: .75, cell: BLAST, turn: blastTurn, heat: heat * .65, isCrater: true,
    });
    const bowlMark = this.add({
      x, z, radius: radius * 1.18, alpha: .95, cell: BOWL, turn: 0, heat, isCrater: true,
    });
    const entry = {
      x, z, radius, smoke: 10, blastMark, bowlMark,
      turn: random(0, Math.PI * 2),
      shape: [random(.92, 1.08), random(.85, 1.15), random(.92, 1.08)],
      tint: this.surfaceColor(x, z, true).clone(),
    };
    this.craters[index] = entry;
    this.writeRim(index, entry);
    this.rims.count = Math.min(this.rims.instanceMatrix.count, Math.max(this.rims.count, index + 1));
    this.absorbUnder(entry, index);
    this.applyCraterImpacts(x, z, radius, options.dx, options.dz);
  }

  absorbUnder(crater, keepIndex) {
    let rimsChanged = false;
    for (let i = 0; i < this.craters.length; i++) {
      if (i === keepIndex) continue;
      const other = this.craters[i];
      if (!other || other.radius <= 0) continue;
      const dist = Math.hypot(other.x - crater.x, other.z - crater.z);
      if (crater.radius >= other.radius * .8 && dist < (crater.radius + other.radius) * 1.35) {
        other.radius = 0;
        other.smoke = 0;
        this.rims.setMatrixAt(i, GONE);
        rimsChanged = true;
        for (const mark of [other.blastMark, other.bowlMark]) {
          // Verify slot ownership because ring-buffer wrap may have replaced the mark.
          if (!mark || this.marks[mark.slot] !== mark) continue;
          mark.alpha = 0;
          this.batch.alpha.setX(mark.slot, 0);
          this.batch.alpha.needsUpdate = true;
        }
      }
    }
    if (rimsChanged) this.rims.instanceMatrix.needsUpdate = true;
  }

  syncCraterMarks(crater, heat) {
    for (const [mark, targetScale, mult] of [[crater.blastMark, crater.radius * 2.5, .65], [crater.bowlMark, crater.radius * 1.18, 1]]) {
      if (!mark || this.marks[mark.slot] !== mark) continue;
      mark.x = crater.x; mark.z = crater.z;
      mark.radius = targetScale;
      mark.heat = Math.min(1, Math.max(mark.heat, heat * mult));
      this.write(mark.slot);
    }
  }

  applyCraterImpacts(x, z, radius, dx, dz) {
    this.grass.burn(x, z, radius * 1.35, 0, true);
    this.grass.burn(x, z, radius * 2.5, 1);
    this.trees.blast(x, z, radius * 2.2, .55);
    this.spawnEjecta(x, z, Math.min(12, Math.round(radius * 4.5)), radius * .6, 6 + radius * 2, dx, dz);
    this.clearBowlClods();
  }

  writeRim(index, crater) {
    this.transform.position.set(crater.x, surfaceY(crater.x, crater.z), crater.z);
    this.transform.rotation.set(0, crater.turn, 0);
    this.transform.scale.set(crater.radius * crater.shape[0], crater.radius * crater.shape[1], crater.radius * crater.shape[2]);
    this.transform.updateMatrix();
    this.rims.setMatrixAt(index, this.transform.matrix);
    this.rims.setColorAt(index, crater.tint);
    this.rims.instanceMatrix.needsUpdate = true;
    this.rims.instanceColor.needsUpdate = true;
  }

  /** A large blast chars, tilts, and strips nearby trees radially outward. */
  blast(x, z, radius, strength = 1) {
    this.trees.blast(x, z, radius, strength);
  }

  add(mark) {
    let index = this.marks.length;
    if (index < this.capacity) this.marks.push(mark);
    else { index = this.oldest++ % this.capacity; this.marks[index] = mark; }
    mark.slot = index;
    this.write(index);
    return mark;
  }

  write(index) {
    const mark = this.marks[index], { mesh, alpha, cell, heat } = this.batch;
    this.transform.position.set(mark.x, 0, mark.z);
    this.transform.rotation.set(0, mark.turn, 0);
    this.transform.scale.set(mark.radius * 2, 1, mark.radius * 2);
    this.transform.updateMatrix();
    mesh.setMatrixAt(index, this.transform.matrix);
    mesh.setColorAt(index, this.surfaceColor(mark.x, mark.z, !!mark.isCrater));
    alpha.setX(index, mark.alpha);
    cell.setX(index, mark.cell);
    heat.setX(index, mark.heat || 0);
    mesh.count = this.marks.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    alpha.needsUpdate = true; cell.needsUpdate = true; heat.needsUpdate = true;
  }

  /** Advance ember cooling, ballistic ejecta settling, tree sway, and crater smoke wisps. */
  update(dt, emit = null) {
    let heatChanged = false;
    for (let i = 0; i < this.marks.length; i++) {
      const mark = this.marks[i];
      if (!mark.heat || mark.heat <= 0) continue;
      mark.heat = Math.max(0, mark.heat - dt * .14);
      this.batch.heat.setX(i, mark.heat);
      heatChanged = true;
    }
    if (heatChanged) this.batch.heat.needsUpdate = true;

    let clodsChanged = false;
    for (let i = 0; i < this.clods.length; i++) {
      const c = this.clods[i];
      if (!c.flying) continue;
      c.x += c.vx * dt;
      c.z += c.vz * dt;
      c.vy -= 18 * dt;
      c.y += c.vy * dt;
      c.rx += c.spinX * dt;
      c.ry += c.spinY * dt;
      const floor = surfaceY(c.x, c.z) + c.size * .28;
      if (c.y <= floor) {
        c.y = floor;
        c.flying = false;
        if (this.inAnyCrater(c.x, c.z)) {
          c.hidden = true;
          this.ejecta.setMatrixAt(i, GONE);
          clodsChanged = true;
          continue;
        }
      }
      this.writeClod(i, c);
      clodsChanged = true;
    }
    if (clodsChanged) this.ejecta.instanceMatrix.needsUpdate = true;

    this.trees.update(dt);

    if (emit) {
      for (const crater of this.craters) {
        if (!crater || crater.radius <= 0 || crater.smoke <= 0) continue;
        crater.smoke = Math.max(0, crater.smoke - dt);
        if (Math.random() < dt * 1.8) {
          const sy = surfaceY(crater.x, crater.z);
          emit('smoke', {
            x: crater.x + random(-.4, .4) * crater.radius,
            y: sy + .18,
            z: crater.z + random(-.4, .4) * crater.radius,
          }, {
            size: random(.5, 1.0) * Math.min(1.5, crater.radius * .65),
            life: random(1.4, 2.4),
            vy: random(.8, 1.5),
            vx: random(.1, .5),
            color: 0x383630,
          });
          if (crater.smoke > 6 && Math.random() < .45) {
            emit('spark', {
              x: crater.x + random(-.3, .3) * crater.radius,
              y: sy + .15,
              z: crater.z + random(-.3, .3) * crater.radius,
            }, {
              size: .07, life: random(.4, .8), vy: random(1.5, 3.2),
              vx: random(-.6, .6), vz: random(-.6, .6), gravity: 6, color: 0xffa840,
            });
          }
        }
      }
    }
  }

  craterHeight(px, pz) {
    let y = 0;
    for (let i = 0; i < this.craters.length; i++) {
      const c = this.craters[i];
      if (!c || c.radius <= 0) continue;
      const dx = px - c.x, dz = pz - c.z, limit = c.radius * 1.28;
      if (Math.abs(dx) >= limit || Math.abs(dz) >= limit) continue;
      const d = Math.hypot(dx, dz), bowlR = c.radius * .9;
      // Keep the vertical dip shallow because the pit floor is a flat decal.
      if (d < bowlR) y -= Math.min(.045, .022 * c.radius) * (1 - (d / bowlR) ** 2);
      else if (d < limit) y += Math.min(.035, .016 * c.radius) * Math.sin((d - bowlR) / (c.radius * .38) * Math.PI);
    }
    return y;
  }

  /** Sample terrain crater relief (y, pitch, roll) and soot darkness under a vehicle. */
  sample(x, z, yaw = 0) {
    const y = this.craterHeight(x, z);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const span = .9;
    const pitch = clamp((this.craterHeight(x + fx * span, z + fz * span) - this.craterHeight(x - fx * span, z - fz * span)) / (span * 2) * 2.2, -.14, .14);
    const roll = clamp((this.craterHeight(x + rx * span, z + rz * span) - this.craterHeight(x - rx * span, z - rz * span)) / (span * 2) * 2.2, -.14, .14);
    let soot = 0;
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i];
      if (m.alpha <= .05 || Math.abs(x - m.x) >= m.radius || Math.abs(z - m.z) >= m.radius) continue;
      const d = Math.hypot(x - m.x, z - m.z);
      if (d < m.radius) soot = Math.max(soot, m.alpha * (1 - d / m.radius));
    }
    this.sampled.y = y;
    this.sampled.pitch = pitch;
    this.sampled.roll = roll;
    this.sampled.soot = clamp(soot);
    return this.sampled;
  }

  clear() {
    this.marks = []; this.oldest = 0; this.batch.mesh.count = 0;
    this.craters = []; this.cratered = 0; this.rims.count = 0;
    this.clods = []; this.clodCursor = 0; this.ejecta.count = 0;
    this.grass.restore(); this.trees.restore();
  }

  dispose() {
    this.clear();
    const { mesh, texture } = this.batch;
    this.scene.remove(mesh, this.rims, this.ejecta);
    mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); texture.dispose();
    this.rims.dispose(); this.rims.geometry.dispose(); this.rims.material.dispose();
    this.ejecta.dispose(); this.ejecta.geometry.dispose(); this.ejecta.material.dispose();
  }
}

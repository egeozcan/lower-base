// Run: node --test scripts/test-terrain-damage.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../web/three.module.js';

// Minimal canvas 2D stub so TerrainDamage and its DataTexture atlas can be
// instantiated and tested in Node without a browser DOM.
const recordedMultiStrokes = [];
function installCanvasStub() {
  if (globalThis.document) return;
  const noop = () => {};
  const gradient = () => ({ addColorStop: noop });
  let nextLayerId = 0;
  const ctx = (canvas) => {
    const id = nextLayerId++;
    let path = [];
    return {
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      createRadialGradient: gradient,
      createLinearGradient: gradient,
      fillRect: noop,
      clearRect: noop,
      beginPath: () => { path = []; },
      closePath: noop,
      moveTo: (x, y) => { path.push([x, y]); },
      lineTo: (x, y) => { path.push([x, y]); },
      arc: noop,
      ellipse: noop,
      fill: noop,
      stroke: () => {
        if (path.length >= 5) recordedMultiStrokes.push({ layer: id, points: path.map(([x, y]) => [x, y]) });
      },
      save: noop,
      restore: noop,
      translate: noop,
      rotate: noop,
      scale: noop,
      setLineDash: noop,
      getImageData: (_x, _y, w, h) => ({
        width: w || canvas.width || 1,
        height: h || canvas.height || 1,
        data: new Uint8ClampedArray((w || canvas.width || 1) * (h || canvas.height || 1) * 4),
      }),
      putImageData: noop,
    };
  };
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') return {};
      const canvas = { width: 0, height: 0 };
      canvas.getContext = () => ctx(canvas);
      return canvas;
    },
  };
  if (!globalThis.window) {
    globalThis.window = { matchMedia: () => ({ matches: false }) };
  }
}

installCanvasStub();
const { TerrainDamage } = await import('../web/terrain-damage.js');
const { CombatEffects } = await import('../web/combat-effects.js');

function makeFoliage({ grassSpots = [], treeSpots = [] } = {}) {
  const dummy = new THREE.Object3D();
  const grassGeo = new THREE.ConeGeometry(0.22, 0.55, 4);
  const grassMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, Math.max(1, grassSpots.length));
  grassMesh.count = grassSpots.length;
  for (let i = 0; i < grassSpots.length; i++) {
    const s = grassSpots[i];
    dummy.position.set(s.x, -0.2 + 0.27, s.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    grassMesh.setMatrixAt(i, dummy.matrix);
    grassMesh.setColorAt(i, new THREE.Color(0x3a5a24));
  }
  if (grassSpots.length === 0) {
    grassMesh.setMatrixAt(0, new THREE.Matrix4());
    grassMesh.setColorAt(0, new THREE.Color(0x3a5a24));
  }

  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 1.6, 5);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const canopyGeo = new THREE.ConeGeometry(1.5, 3.0, 7);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const treeCount = Math.max(1, treeSpots.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const lowerCanopy = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
  const upperCanopy = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
  trunks.count = lowerCanopy.count = upperCanopy.count = treeSpots.length;

  const spots = treeSpots.map((t, i) => {
    const s = t.s ?? 1;
    dummy.position.set(t.x, 0.6 * s, t.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    trunks.setColorAt(i, new THREE.Color(0x554631));

    dummy.position.set(t.x, 2.7 * s, t.z);
    dummy.updateMatrix();
    lowerCanopy.setMatrixAt(i, dummy.matrix);
    lowerCanopy.setColorAt(i, new THREE.Color(0x2a4a1a));

    dummy.position.set(t.x, 4.1 * s, t.z);
    dummy.updateMatrix();
    upperCanopy.setMatrixAt(i, dummy.matrix);
    upperCanopy.setColorAt(i, new THREE.Color(0x315520));

    return { x: t.x, z: t.z, s, h: 0.2 };
  });

  if (treeSpots.length === 0) {
    for (const m of [trunks, lowerCanopy, upperCanopy]) {
      m.setMatrixAt(0, new THREE.Matrix4());
      m.setColorAt(0, new THREE.Color(0xffffff));
    }
  }

  return {
    grass: { meshes: [grassMesh], spots: grassSpots },
    trees: { trunks, meshes: [lowerCanopy, upperCanopy], spots },
  };
}

test('widened scorch marks burn and flatten newly covered grass', () => {
  const scene = new THREE.Scene();
  const foliage = makeFoliage({ grassSpots: [{ x: 1.05, z: 0 }] });
  const ground = new TerrainDamage(scene, false, foliage);
  try {
    const initialColor = new THREE.Color();
    foliage.grass.meshes[0].getColorAt(0, initialColor);
    const initialMat = new THREE.Matrix4();
    foliage.grass.meshes[0].getMatrixAt(0, initialMat);

    // Hit 1: radius 1.0 (0.8 * 1.0 = 0.8) does not reach tuft at 1.05
    ground.scorch(0, 0, 1.0, 0.5);
    // Repeated hits widen the scorch mark past 1.3 and must burn newly covered grass
    ground.scorch(0, 0, 1.0, 0.5);
    ground.scorch(0, 0, 1.0, 0.5);

    const afterColor = new THREE.Color();
    foliage.grass.meshes[0].getColorAt(0, afterColor);
    assert.ok(afterColor.r < initialColor.r * 0.9, `expected grass color to darken (${afterColor.r} < ${initialColor.r})`);

    const afterMat = new THREE.Matrix4();
    foliage.grass.meshes[0].getMatrixAt(0, afterMat);
    // Column 1 (elements 4,5,6) is the local Y axis; tilting away along +X raises element 4 and lowers element 5.
    assert.ok(afterMat.elements[4] > 0.05, `expected tuft to tilt radially along +X, got ${afterMat.elements[4]}`);
    assert.ok(afterMat.elements[5] < initialMat.elements[5], `expected tuft vertical projection to flatten`);
  } finally {
    ground.dispose();
  }
});

test('sustained heavy shelling on one spot excavates a shell crater', () => {
  const scene = new THREE.Scene();
  const foliage = makeFoliage();
  const ground = new TerrainDamage(scene, false, foliage);
  try {
    for (let i = 0; i < 4; i++) {
      ground.scorch(4, 4, 1.3, 0.55);
    }
    const active = ground.craters.filter(c => c && c.radius > 0);
    assert.equal(active.length, 1);
    assert.equal(ground.rims.count, 1);
  } finally {
    ground.dispose();
  }
});

test('overlapping craters merge or absorb smaller craters cleanly', () => {
  const scene = new THREE.Scene();
  const foliage = makeFoliage();
  const ground = new TerrainDamage(scene, false, foliage);
  try {
    ground.crater(0, 0, 0.95);
    ground.crater(0.2, 0, 2.3);
    const active = ground.craters.filter(c => c && c.radius > 0);
    assert.equal(active.length, 1, 'smaller overlapped crater should be absorbed/merged');
    assert.ok(active[0].radius >= 2.3, `merged crater radius should be >= 2.3, got ${active[0].radius}`);
  } finally {
    ground.dispose();
  }

  const scene2 = new THREE.Scene();
  const ground2 = new TerrainDamage(scene2, false, makeFoliage());
  try {
    ground2.crater(0, 0, 1.2);
    ground2.crater(0.1, 0, 1.2);
    const active = ground2.craters.filter(c => c && c.radius > 0);
    assert.equal(active.length, 1);
    assert.ok(active[0].radius > 1.2, `hit on existing crater should widen it (> 1.2), got ${active[0].radius}`);
  } finally {
    ground2.dispose();
  }
});

test('craters sit flush with soil, road, and concrete apron elevations', () => {
  const scene = new THREE.Scene();
  const ground = new TerrainDamage(scene, false, makeFoliage());
  try {
    ground.crater(20, 0, 1.2);  // soil
    ground.crater(0, 0, 1.2);   // road
    ground.crater(0, 42, 1.2);  // apron

    const mat = new THREE.Matrix4();
    ground.rims.getMatrixAt(0, mat);
    assert.ok(mat.elements[13] < -0.15, `soil crater Y should sit flush near -0.185, got ${mat.elements[13]}`);

    ground.rims.getMatrixAt(1, mat);
    assert.ok(mat.elements[13] >= -0.06 && mat.elements[13] <= 0.0, `road crater Y should sit flush near -0.022, got ${mat.elements[13]}`);

    ground.rims.getMatrixAt(2, mat);
    assert.ok(mat.elements[13] >= 0.035, `apron crater Y should sit flush near 0.068, got ${mat.elements[13]}`);
  } finally {
    ground.dispose();
  }
});

test('crater heat cools, ejecta settles, trees blast radially, and sample() reports terrain relief', () => {
  const scene = new THREE.Scene();
  const foliage = makeFoliage({
    treeSpots: [
      { x: 26.5, z: 0, s: 1 }, // inner zone (d = 1.5 from blast at 25,0)
      { x: 30.0, z: 0, s: 1 }, // middle zone (d = 5.0)
    ],
  });
  const ground = new TerrainDamage(scene, false, foliage);
  try {
    ground.crater(10, 10, 2.0);
    assert.ok(ground.batch.heat, 'batch should expose heat attribute');
    const maxInitialHeat = Math.max(...ground.batch.heat.array.slice(0, ground.marks.length));
    assert.ok(maxInitialHeat > 0.5, `expected fresh crater heat > 0.5, got ${maxInitialHeat}`);

    assert.ok(ground.ejecta && ground.ejecta.count > 0, 'crater should spawn ballistic ejecta clods');

    for (let i = 0; i < 40; i++) ground.update(0.1);
    const maxCooledHeat = Math.max(...ground.batch.heat.array.slice(0, ground.marks.length));
    assert.ok(maxCooledHeat < 0.5, `expected ember heat to cool below 0.5 after 4s, got ${maxCooledHeat}`);

    // Verify ejecta settled (subsequent update doesn't move clods vertically)
    const beforeMat = new THREE.Matrix4();
    const afterMat = new THREE.Matrix4();
    ground.ejecta.getMatrixAt(0, beforeMat);
    ground.update(0.2);
    ground.ejecta.getMatrixAt(0, afterMat);
    assert.ok(Math.abs(afterMat.elements[13] - beforeMat.elements[13]) < 1e-4, 'settled ejecta should stop falling');

    // Blast trees at (25, 0) radius 8
    ground.blast(25, 0, 8.0, 1.0);
    const trunkMat = new THREE.Matrix4();
    const upperMat = new THREE.Matrix4();
    const trunkColor = new THREE.Color();
    foliage.trees.trunks.getMatrixAt(0, trunkMat);
    foliage.trees.trunks.getColorAt(0, trunkColor);
    foliage.trees.meshes[1].getMatrixAt(0, upperMat);

    // Tilted radially away along +X: local Y axis (column 1) has positive X component
    assert.ok(trunkMat.elements[4] > 0.1, `expected inner trunk to tilt away along +X, got ${trunkMat.elements[4]}`);
    assert.ok(trunkColor.r < 0.25, `expected charred trunk color, got ${trunkColor.r}`);
    // Inner zone upper canopy stripped (scale 0)
    const upperScaleSq = upperMat.elements[0] ** 2 + upperMat.elements[1] ** 2 + upperMat.elements[2] ** 2;
    assert.ok(upperScaleSq < 1e-4, `expected inner tree upper canopy stripped, got scaleSq=${upperScaleSq}`);

    // Middle zone tree (index 1) should still lean away too
    foliage.trees.trunks.getMatrixAt(1, trunkMat);
    assert.ok(trunkMat.elements[4] > 0.03, `expected middle tree trunk to tilt away along +X, got ${trunkMat.elements[4]}`);

    // Sample crater interior at (10, 10)
    const sample = ground.sample(10, 10, 0);
    assert.ok(sample.y < 0, `expected negative crater bowl dip inside crater, got ${sample.y}`);
    assert.ok(sample.soot > 0, `expected positive soot inside crater, got ${sample.soot}`);
  } finally {
    ground.dispose();
  }
});

test('passive burning wreck scorches do not dig craters or spray clods', () => {
  const scene = new THREE.Scene();
  const ground = new TerrainDamage(scene, false, makeFoliage());
  try {
    ground.scorch(0, 0, 1.25 * 2.2, 0.6);
    ground.crater(0, 0, 0.95);
    const initialClods = ground.clods.length;
    const initialRadius = ground.craters[0].radius;
    const initialMarkRadius = ground.marks[0].radius;

    for (let i = 0; i < 50; i++) {
      ground.scorch(0, 0, 1.25 * 1.5, 0.12, { heat: 0.6, passive: true });
    }

    const active = ground.craters.filter(c => c && c.radius > 0);
    assert.equal(active.length, 1);
    assert.equal(ground.craters[0].radius, initialRadius, 'passive wreck fire must not expand crater');
    assert.equal(ground.clods.length, initialClods, 'passive wreck fire must not spray ejecta clods');
    assert.ok(ground.marks[0].radius <= initialMarkRadius * 1.05, 'passive wreck fire must not balloon death mark radius');
  } finally {
    ground.dispose();
  }
});

test('building shots only scar rounds falling short outside the building footprint', () => {
  const scene = new THREE.Scene();
  const effects = new CombatEffects(scene, false, makeFoliage());
  try {
    for (let i = 0; i < 60; i++) {
      effects.fire({
        source_is_unit: true,
        target_is_unit: false,
        kind: 'tank',
        x: 0,
        z: 20,
        source_y: 1.5,
        target_x: 0,
        target_y: 2.0,
        target_z: 43,
      });
    }
    const scarred = effects.projectiles.filter(p => p.scar);
    assert.ok(scarred.length > 0, 'some building shots should fall short and leave scars');
    for (const p of scarred) {
      assert.ok(43 - p.scar.z >= 3.0, `building short scar should land outside footprint, got z=${p.scar.z}`);
      assert.equal('source_is_unit' in p, false, 'projectile should use camelCase fromUnit instead of source_is_unit');
      assert.equal(p.fromUnit, true);
    }
  } finally {
    effects.dispose();
  }
});

test('syncCraterMarks and absorbUnder track mark object identity across ring-buffer wrap', () => {
  const scene = new THREE.Scene();
  const ground = new TerrainDamage(scene, true, makeFoliage());
  try {
    ground.crater(0, 0, 1.2); // crater 0 occupies marks[0] (blast) and marks[1] (bowl)
    for (let i = 0; i < ground.capacity - 2; i++) {
      ground.scorch(50 + i * 0.2, 50 + (i % 7), 0.5, 0.4);
    }
    // Overwrite slots 0 and 1 with an unrelated crater at (20, 20)
    ground.crater(20, 20, 1.1);
    const wrappedMarks = ground.marks.filter(m => m.x === 20 && m.z === 20);
    assert.equal(wrappedMarks.length, 2);

    // Merge and absorb crater 0; its stale indices 0 and 1 must NOT touch (20, 20)
    ground.crater(0.1, 0, 1.2);
    ground.crater(0.1, 0, 2.8);

    for (const m of wrappedMarks) {
      assert.equal(m.x, 20);
      assert.equal(m.z, 20);
      assert.ok(m.alpha > 0, 'unrelated crater mark alpha must not be zeroed out');
    }
  } finally {
    ground.dispose();
  }
});

test('fracture cracks align across A, R, and B channels and use DataTexture', () => {
  recordedMultiStrokes.length = 0;
  const scene = new THREE.Scene();
  const ground = new TerrainDamage(scene, false, makeFoliage());
  try {
    assert.ok(ground.batch.texture instanceof THREE.DataTexture, 'atlas should be a DataTexture to avoid premultiplied alpha quantization');
    const blastCracks = recordedMultiStrokes.filter(s => s.points[0][0] === 128 && s.points[0][1] === 128);
    assert.equal(blastCracks.length, 33, `expected 33 BLAST crack strokes (11 cracks x 3 layers), got ${blastCracks.length}`);
    for (let i = 0; i < blastCracks.length; i += 3) {
      const a = blastCracks[i].points;
      const r = blastCracks[i + 1].points;
      const b = blastCracks[i + 2].points;
      assert.deepEqual(r, a, `R layer crack path should match A layer at crack ${i / 3}`);
      assert.deepEqual(b, a, `B layer crack path should match A layer at crack ${i / 3}`);
    }
  } finally {
    ground.dispose();
  }
});

test('rim clods tilt radially consistently around all angles and do not jump on merge', () => {
  const scene = new THREE.Scene();
  const ground = new TerrainDamage(scene, false, makeFoliage());
  try {
    const pos = ground.rims.geometry.attributes.position.array;
    const vertsPerClod = 60;
    for (let c = 0; c < 18; c++) {
      const base = c * vertsPerClod * 3;
      let cx = 0, cy = 0, cz = 0;
      for (let v = 0; v < vertsPerClod; v++) {
        cx += pos[base + v * 3];
        cy += pos[base + v * 3 + 1];
        cz += pos[base + v * 3 + 2];
      }
      cx /= vertsPerClod; cy /= vertsPerClod; cz /= vertsPerClod;
      const rCenter = Math.hypot(cx, cz);
      const nx = cx / rCenter, nz = cz / rCenter;
      let cov = 0;
      for (let v = 0; v < vertsPerClod; v++) {
        const vx = pos[base + v * 3] - cx;
        const vy = pos[base + v * 3 + 1] - cy;
        const vz = pos[base + v * 3 + 2] - cz;
        const radial = vx * nx + vz * nz;
        cov += radial * vy;
      }
      assert.ok(cov < 0, `inner clod ${c} at (${cx.toFixed(2)}, ${cz.toFixed(2)}) has inconsistent radial tilt cov=${cov.toFixed(4)}`);
    }

    ground.crater(0, 0, 1.2);
    const m1 = new THREE.Matrix4();
    ground.rims.getMatrixAt(0, m1);
    const r1 = Math.hypot(m1.elements[0], m1.elements[2]);

    ground.crater(0, 0, 1.1);
    const m2 = new THREE.Matrix4();
    ground.rims.getMatrixAt(0, m2);
    const r2 = Math.hypot(m2.elements[0], m2.elements[2]);

    assert.ok(Math.abs(m1.elements[0] / r1 - m2.elements[0] / r2) < 1e-5, 'rim rotation should stay stable on merge');
    assert.ok(Math.abs(m1.elements[2] / r1 - m2.elements[2] / r2) < 1e-5, 'rim rotation should stay stable on merge');
  } finally {
    ground.dispose();
  }
});

test('sample().y stays shallow enough to prevent ground clipping and burnt grass keeps .27 base offset', () => {
  const scene = new THREE.Scene();
  const foliage = makeFoliage({ grassSpots: [{ x: 2.0, z: 0 }] });
  const ground = new TerrainDamage(scene, false, foliage);
  try {
    ground.crater(10, 10, 2.4);
    const sample = ground.sample(10, 10, 0);
    assert.ok(sample.y < 0, 'crater interior should still dip slightly');
    assert.ok(sample.y >= -0.06, `crater dip should be shallow enough not to clip vehicles (${sample.y})`);

    // Edge burn where near ~= 0 should keep tuft Y at -0.2 + 0.27 = 0.07
    ground.grass.burn(0, 0, 2.001, 0.2);
    const mat = new THREE.Matrix4();
    foliage.grass.meshes[0].getMatrixAt(0, mat);
    assert.ok(mat.elements[13] >= 0.069, `lightly burnt tuft should stay at -0.2 + 0.27, got ${mat.elements[13]}`);
  } finally {
    ground.dispose();
  }
});

test('adjacent craters never intersect rims and settled ejecta clods stay clear of crater bowls', () => {
  const scene = new THREE.Scene();
  const ground = new TerrainDamage(scene, false, makeFoliage());
  try {
    ground.crater(0, 0, 1.2);
    ground.crater(1.8, 0, 1.1); // rim-overlapping zone: dist = 1.8 < (1.2 + 1.1) * 1.3
    ground.crater(5.0, 0, 1.0);
    ground.crater(7.0, 0, 2.0); // larger crater absorbs nearby smaller one

    const active = ground.craters.filter(c => c && c.radius > 0);
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        const dist = Math.hypot(a.x - b.x, a.z - b.z);
        assert.ok(dist >= (a.radius + b.radius) * 1.3,
          `craters (${a.x},${a.z},r=${a.radius}) and (${b.x},${b.z},r=${b.radius}) overlap at dist=${dist.toFixed(2)}`);
      }
    }

    for (let i = 0; i < 20; i++) ground.update(0.1);
    const mat = new THREE.Matrix4();
    for (let i = 0; i < ground.clods.length; i++) {
      ground.ejecta.getMatrixAt(i, mat);
      const scaleSq = mat.elements[0] ** 2 + mat.elements[1] ** 2 + mat.elements[2] ** 2;
      if (scaleSq < 1e-6) continue;
      const clod = ground.clods[i];
      for (const c of active) {
        const dist = Math.hypot(clod.x - c.x, clod.z - c.z);
        assert.ok(dist >= c.radius * 1.3,
          `visible clod at (${clod.x.toFixed(2)},${clod.z.toFixed(2)}) landed inside crater (${c.x},${c.z},r=${c.radius}) at dist=${dist.toFixed(2)}`);
      }
    }
  } finally {
    ground.dispose();
  }
});

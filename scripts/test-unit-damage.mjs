// Run: node --test scripts/test-unit-damage.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../web/three.module.js';

function installCanvasStub() {
  if (globalThis.document) return;
  const noop = () => {};
  const gradient = () => ({ addColorStop: noop });
  const ctx = (canvas) => ({
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    createRadialGradient: gradient,
    createLinearGradient: gradient,
    fillRect: noop,
    clearRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
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
  });
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
const { unitMesh, buildingMesh } = await import('../web/renderer.js');
const { ModelDamage, sootVariant } = await import('../web/damage.js');
const { CombatEffects } = await import('../web/combat-effects.js');
const { surfaceY } = await import('../web/terrain-damage.js');

function makeDamageMaterials() {
  const sootCache = new Map();
  return {
    soot: material => {
      if (!sootCache.has(material)) sootCache.set(material, sootVariant(material));
      return sootCache.get(material);
    },
    rubble: new THREE.MeshStandardMaterial({ color: 0xffffff }),
  };
}

function makeCamera() {
  const camera = new THREE.OrthographicCamera(-25, 25, 45, -45, .1, 300);
  camera.position.set(0, 110, 95);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

test('vehicles and emplacements loosen and detach exterior parts as health drops', () => {
  const materials = makeDamageMaterials();
  const tank = unitMesh({ kind: 'tank', team: 'player' });
  assert.ok(tank.userData.turret, 'tank model should keep its turret pivot');
  assert.ok(Array.isArray(tank.userData.breakable) && tank.userData.breakable.length >= 10,
    'tank should register breakable exterior parts');
  for (const entry of tank.userData.breakable) {
    assert.ok(entry.spans.length > 0, `part ${entry.id} should track vertex spans`);
    assert.ok(entry.size.x > 0 && entry.size.y > 0 && entry.size.z > 0, `part ${entry.id} should have positive bounds`);
  }

  const tankDamage = new ModelDamage(tank, 'vehicle', materials, { kind: 'tank' });
  tankDamage.update(.88, { x: -10, z: 0 });
  assert.equal(tankDamage.wounds.length, 1, 'first hit (<100% HP) should immediately open a wound');
  const firstDrop = tankDamage.takeDetached();
  assert.ok(firstDrop.length >= 1, 'first wound on tank should detach at least one part');
  assert.ok(tankDamage.scars.length >= 1, 'detaching a vehicle part should leave an exposed internal scar');
  for (const part of firstDrop) {
    assert.ok(Number.isFinite(part.origin.x) && Number.isFinite(part.origin.y) && Number.isFinite(part.origin.z));
    assert.ok(part.size.length() > 0);
    assert.equal(typeof part.color, 'number');
  }

  tankDamage.update(.18, { x: -10, z: 0 });
  const secondDrop = tankDamage.takeDetached();
  assert.ok(secondDrop.length >= 1, 'critical tank should detach more parts');

  const detachedEntries = tankDamage.breakable.filter(e => e.state === 2);
  assert.ok(detachedEntries.length >= 2);
  for (const entry of detachedEntries) {
    for (const span of entry.spans) {
      const { position, soot } = span.mesh.geometry.attributes;
      for (let i = span.start; i < span.start + span.count; i++) {
        assert.ok(Math.abs(position.getX(i) - entry.at.x * .65) < 1e-4);
        assert.ok(Math.abs(position.getY(i) - entry.at.y) < 1e-4);
        assert.ok(Math.abs(position.getZ(i) - entry.at.z * .65) < 1e-4);
        assert.equal(soot.getX(i), 1);
      }
    }
  }

  const looseEntries = tankDamage.breakable.filter(e => e.state === 1);
  assert.ok(looseEntries.length >= 1, 'damaged tank should leave at least one remaining part crooked/loose');
  for (const entry of looseEntries) {
    let displaced = false;
    for (const span of entry.spans) {
      const part = tankDamage.partByMesh.get(span.mesh);
      const { position, soot } = span.mesh.geometry.attributes;
      for (let i = span.start; i < span.start + span.count; i++) {
        assert.ok(soot.getX(i) >= .479, 'loose part should carry scorched/bent soot');
        const dist = Math.hypot(
          position.getX(i) - part.rest[i * 3],
          position.getY(i) - part.rest[i * 3 + 1],
          position.getZ(i) - part.rest[i * 3 + 2],
        );
        if (dist > .02) displaced = true;
      }
    }
    assert.ok(displaced, `loose part ${entry.id} vertices should be tilted away from rest`);
  }

  const collector = unitMesh({ kind: 'collector', team: 'enemy' });
  assert.ok(collector.userData.hopper, 'collector should keep its hopper pivot');
  const collectorDamage = new ModelDamage(collector, 'vehicle', materials, { kind: 'collector' });
  collectorDamage.update(.2, { x: 8, z: -4 });
  assert.ok(collectorDamage.takeDetached().length >= 2, 'critical collector should shed parts');
  assert.ok(collectorDamage.scars.length >= 2, 'critical collector should create internal scars');

  const demo = unitMesh({ kind: 'demolition', team: 'player' });
  const demoDamage = new ModelDamage(demo, 'vehicle', materials, { kind: 'demolition' });
  demoDamage.update(.2, { x: 6, z: 6 });
  assert.ok(demoDamage.takeDetached().length >= 2, 'critical demolition truck should shed parts');
  assert.ok(demoDamage.scars.length >= 2);

  const gun = buildingMesh({ kind: 'emplacement', team: 'player' });
  const gunDamage = new ModelDamage(gun, 'emplacement', materials, { kind: 'emplacement' });
  gunDamage.update(.2, { x: 0, z: -8 });
  assert.ok(gunDamage.takeDetached().length >= 2, 'critical anti-tank gun should shed parts');
  assert.ok(gunDamage.scars.length >= 2);

  const depot = buildingMesh({ kind: 'ore_depot', team: 'player' });
  assert.ok(depot.userData.orePile, 'ore depot should attach an instanced ore pile');
  assert.equal(depot.userData.orePile.userData.decoration, true, 'ore pile should be marked as decoration');
  const depotDamage = new ModelDamage(depot, 'emplacement', materials, { kind: 'ore_depot' });
  depotDamage.update(.2, { x: 0, z: -8 });
  assert.ok(depotDamage.takeDetached().length >= 2, 'critical ore depot should shed parts');
  assert.ok(depotDamage.scars.length >= 2);
});

test('CombatEffects simulates typed bouncing fallen parts, bouncing electric sparks, and ribbon arcs', () => {
  const scene = new THREE.Scene();
  const foliage = {
    grass: { meshes: [], spots: [] },
    trees: { trunks: null, meshes: [], spots: [] },
  };
  const effects = new CombatEffects(scene, false, foliage);
  const camera = makeCamera();
  try {
    const piece = effects.dropPart({
      origin: new THREE.Vector3(2, 1.5, 0),
      shape: 'plate',
      outX: 1,
      outZ: 0,
      size: new THREE.Vector3(.12, .36, 1.45),
      color: 0x3267c8,
    });
    const wheel = effects.dropPart({ origin: new THREE.Vector3(0, 1, 0), shape: 'wheel', size: new THREE.Vector3(.36, 1, 1) });
    const helmet = effects.dropPart({ origin: new THREE.Vector3(1, 1.7, 0), shape: 'helmet', size: new THREE.Vector3(.68, .25, .68) });
    const rod = effects.dropPart({ origin: new THREE.Vector3(-1, 2, 0), shape: 'rod', size: new THREE.Vector3(.08, .08, 1.1) });
    assert.equal(effects.fallenBatches.plate.mesh.count, 1);
    assert.equal(effects.fallenBatches.wheel.mesh.count, 1);
    assert.equal(effects.fallenBatches.helmet.mesh.count, 1);
    assert.equal(effects.fallenBatches.rod.mesh.count, 1);
    assert.equal(effects.fallenPieces.length, 4);
    assert.ok(wheel.sx === wheel.sz && helmet.sx === helmet.sz && rod.sx < rod.sz);

    let bounced = false;
    let prevVy = piece.vy;
    for (let i = 0; i < 50; i++) {
      effects.update(.05, camera);
      if (piece.moving && prevVy < 0 && piece.vy > 0) bounced = true;
      prevVy = piece.vy;
    }
    assert.ok(bounced, 'fallen part should bounce off the ground');
    assert.equal(effects.fallenPieces.length, 0, 'fallen parts should settle after bouncing');
    const matrix = new THREE.Matrix4();
    piece.mesh.getMatrixAt(piece.slot, matrix);
    const expectedFloor = surfaceY(piece.x, piece.z) + piece.sy * .5;
    assert.ok(Math.abs(matrix.elements[13] - expectedFloor) < 1e-3,
      `settled part Y (${matrix.elements[13]}) should rest on terrain (${expectedFloor})`);

    effects.electricSpark({ x: 0, y: 1.1, z: 0 }, 1);
    assert.ok(effects.arcs.length >= 2, 'electricSpark should spawn 2-3 volumetric branching 3D arcs');
    assert.ok(effects.arcs[0].group.isGroup, 'arcs should use volumetric ribbon mesh groups');
    const electricParticles = effects.glow.particles.filter(p => p.type === 'electric');
    assert.ok(electricParticles.length >= 10, 'electricSpark should emit electric sparks');
    assert.ok(electricParticles.every(p => p.bounces === 2), 'electric sparks should bounce');

    let sparkBounced = false;
    const sparkPrevVy = new Map(electricParticles.map(p => [p, p.vy]));
    for (let i = 0; i < 25; i++) {
      effects.update(.04, camera);
      for (const p of electricParticles) {
        if (sparkPrevVy.get(p) < 0 && p.vy > 0) sparkBounced = true;
        sparkPrevVy.set(p, p.vy);
      }
    }
    assert.ok(sparkBounced, 'at least one electric spark should bounce on the ground');
    assert.equal(effects.arcs.length, 0, 'short-lived electric arcs should expire');

    effects.electricSpark({ x: 1, y: 1.0, z: 1 }, 1);
    assert.ok(effects.arcs.length >= 2);
    effects.clear();
    assert.equal(effects.arcs.length, 0);
    for (const pool of Object.values(effects.fallenBatches)) assert.equal(pool.mesh.count, 0);
    assert.equal(effects.fallenPieces.length, 0);
  } finally {
    effects.dispose();
  }
});

test('wounded infantry gain progressive bandages, splints, crutches, and shed gear', () => {
  const materials = makeDamageMaterials();
  const soldier = unitMesh({ kind: 'soldier', team: 'player' });
  const soldierDamage = new ModelDamage(soldier, 'infantry', materials, { kind: 'soldier', list: -.09 });

  soldierDamage.update(.88, { x: 0, z: -5 });
  assert.equal(soldierDamage.wounds.length, 1, 'first hit (<100% HP) should open wound 1 and bandage infantry');
  assert.ok(soldierDamage.bandages, 'wounded soldier should create bandages group');
  assert.equal(soldierDamage.bandages.parent, soldier);
  const stage1Count = soldierDamage.bandages.children.length;
  assert.ok(stage1Count >= 4, 'wound 1 should attach leg bandage, bleed pad, tourniquet, and brow wrap');
  const firstDetached = soldierDamage.takeDetached().map(p => p.id);
  assert.ok(firstDetached.includes('pack-roll'), 'wound 1 should knock off pack-roll');
  const helmet = soldierDamage.breakable.find(e => e.id === 'helmet');
  assert.equal(helmet.state, 1, 'wound 1 should knock soldier helmet askew');
  for (const child of soldierDamage.bandages.children) {
    assert.ok(child.position.x <= 0.19, 'stage 1 leg wrap should sit on the favored left leg (list < 0)');
  }

  soldierDamage.update(.45, { x: 0, z: -5 });
  assert.equal(soldierDamage.wounds.length, 2);
  const stage2Count = soldierDamage.bandages.children.length;
  assert.ok(stage2Count > stage1Count, 'damaged soldier should gain full head bandage, chest sash, forearm wrap, and trauma pouch');
  const secondDetached = soldierDamage.takeDetached().map(p => p.id);
  assert.ok(secondDetached.includes('helmet'), 'damaged soldier helmet should blow off to reveal crown bandage');
  assert.equal(helmet.state, 2);
  const backpack = soldierDamage.breakable.find(e => e.id === 'backpack');
  assert.equal(backpack.state, 1, 'damaged soldier backpack should loosen');

  soldierDamage.update(.2, { x: 0, z: -5 });
  assert.equal(soldierDamage.wounds.length, 3);
  const stage3Count = soldierDamage.bandages.children.length;
  assert.ok(stage3Count > stage2Count, 'critical soldier should gain leg splint and crutch');
  const thirdDetached = soldierDamage.takeDetached().map(p => p.id);
  assert.ok(thirdDetached.includes('backpack'), 'critical soldier backpack should fly off');
  assert.equal(backpack.state, 2);

  const colors = new Set(soldierDamage.bandages.children.map(m => m.material.color.getHex()));
  for (const expected of [0xe2dbc8, 0x961816, 0x251d17, 0xb07d4b]) {
    assert.ok(colors.has(expected), `expected wounded accessory color 0x${expected.toString(16)}`);
  }
  for (const child of soldierDamage.bandages.children) {
    assert.equal(child.userData.bandages, true);
    assert.equal(child.geometry.attributes.soot, undefined, 'bandages must stay clean of soot shader attribute');
  }

  const rocket = unitMesh({ kind: 'rocket', team: 'enemy' });
  const rocketDamage = new ModelDamage(rocket, 'infantry', materials, { kind: 'rocket', list: .09 });
  rocketDamage.update(.88, { x: 0, z: 5 });
  assert.ok(rocketDamage.takeDetached().some(p => p.id === 'kneepad-r'), 'rocket wound 1 should knock off favored knee pad');
  rocketDamage.update(.45, { x: 0, z: 5 });
  assert.ok(rocketDamage.takeDetached().some(p => p.id === 'shoulder-l'), 'rocket wound 2 should blow off left shoulder armor');
  rocketDamage.update(.2, { x: 0, z: 5 });
  assert.ok(rocketDamage.takeDetached().some(p => p.id === 'helmet-crest'), 'rocket wound 3 should blow off helmet crest');
  assert.ok(rocketDamage.bandages.children.length >= 12, 'critical rocket trooper should wear full wounded gear');
  for (const child of rocketDamage.bandages.children) {
    assert.ok(child.position.y < 1.65, `rocket trooper should not wear bandages on closed helmet (y=${child.position.y})`);
    assert.ok(child.position.x < .45, `rocket trooper accessories should clear right shoulder pod (x=${child.position.x})`);
  }
});

test('building and unit meshes carry valid UVs and textured materials while preserving faction colors', () => {
  const structures = ['command', 'refinery', 'factory', 'barracks', 'emplacement', 'ore_depot'];
  for (const kind of structures) {
    const model = buildingMesh({ kind, team: 'player' });
    let meshCount = 0;
    let texturedCount = 0;
    model.traverse(obj => {
      if (!obj.isMesh || obj.userData.decoration) return;
      meshCount++;
      const { position, uv } = obj.geometry.attributes;
      assert.ok(uv, `${kind} mesh should have uv attribute`);
      assert.equal(uv.count, position.count, `${kind} uv count should match position count`);
      let nonZero = false;
      for (let i = 0; i < uv.array.length; i++) {
        assert.ok(Number.isFinite(uv.array[i]), `${kind} uv coordinate should be finite`);
        if (Math.abs(uv.array[i]) > 1e-4) nonZero = true;
      }
      assert.ok(nonZero, `${kind} uvs should not all be zero`);
      if (obj.material.map && obj.material.bumpMap) texturedCount++;
    });
    assert.ok(meshCount >= 3, `${kind} should build multiple material meshes`);
    assert.equal(texturedCount, meshCount, `all structural meshes of ${kind} should carry diffuse and bump maps`);
  }

  const units = ['tank', 'collector', 'demolition', 'soldier', 'rocket'];
  for (const kind of units) {
    const model = unitMesh({ kind, team: 'enemy' });
    let meshCount = 0;
    let texturedCount = 0;
    const hexColors = new Set();
    model.traverse(obj => {
      if (!obj.isMesh || obj.userData.decoration) return;
      meshCount++;
      const { position, uv } = obj.geometry.attributes;
      assert.ok(uv, `${kind} mesh should have uv attribute`);
      assert.equal(uv.count, position.count, `${kind} uv count should match position count`);
      if (obj.material.map && obj.material.bumpMap) texturedCount++;
      hexColors.add(obj.material.color.getHex());
    });
    assert.ok(meshCount >= 3, `${kind} should build multiple material meshes`);
    assert.ok(texturedCount >= meshCount - 2, `${kind} meshes should carry diffuse and bump maps (excluding emissive lamps/skin)`);
    assert.ok(hexColors.has(0xc63227), `${kind} should preserve enemy faction accent color 0xc63227`);
  }
});

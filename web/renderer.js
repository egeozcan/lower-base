import * as THREE from './three.module.js';
import { CombatEffects } from './combat-effects.js';
import { ProductionQueues } from './production-queues.js';

// The battlefield is deliberately made from simple, lit geometry so it remains
// readable when dozens of units are moving at once.
const C = {
  player: 0x3267c8, playerDark: 0x234584, enemy: 0xc63227, enemyDark: 0x80271e,
  metal: 0x263743, dark: 0x111e27, light: 0x829ba2, ground: 0x172a32,
};
const mats = new Map();
function mat(color, emissive = 0, intensity = 0) {
  const key = `${color}:${emissive}:${intensity}`;
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.12, emissive, emissiveIntensity: intensity }));
  return mats.get(key);
}
function box(parent, w, h, d, x, y, z, material, angle = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z); m.rotation.y = angle; m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function cylinder(parent, r1, r2, h, x, y, z, material, segments = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, segments), material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function ring(radius, color, opacity = 1) {
  const m = new THREE.Mesh(new THREE.RingGeometry(radius - 0.08, radius, 32), new THREE.MeshBasicMaterial({color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false}));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.08; return m;
}
function addEnvironment(scene) {
  // A sunlit temperate battlefield: scrub, worn asphalt and concrete aprons.
  box(scene, 100, .6, 150, 0, -.5, 0, mat(0x646c3d));
  let seed = 1941;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 260; i++) {
    const x = random() * 94 - 47, z = random() * 142 - 71;
    const shape = new THREE.Shape();
    for (let point = 0; point < 9; point++) {
      const angle = point / 8 * Math.PI * 2;
      const radius = 1 + random() * 1.8;
      const px = Math.cos(angle) * radius, py = Math.sin(angle) * radius;
      if (point === 0) shape.moveTo(px, py); else shape.lineTo(px, py);
    }
    shape.closePath();
    const patch = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat([0x6d7443, 0x606c3c, 0x77794a, 0x626d40][i % 4]));
    patch.rotation.x = -Math.PI / 2; patch.position.set(x, -.17, z);
    patch.receiveShadow = true; scene.add(patch);
  }
  box(scene, 9, .08, 110, 0, -.1, 0, mat(0x62615a));
  for (let z = -50; z <= 50; z += 5) {
    box(scene, .15, .025, 2, 0, -.04, z, mat(0xc6b785));
    for (const x of [-4.2, 4.2]) box(scene, .12, .025, 4.8, x, -.04, z, mat(0xaaa68b));
  }
  for (const side of [-1, 1]) {
    box(scene, 37, .15, 19, 0, -.04, side * 42, mat(0x919080));
    for (let x = -18; x <= 18; x += 3) {
      box(scene, .045, .02, 18.8, x, .045, side * 42, mat(0x6c6c60));
      box(scene, 1.5, .03, .45, x, .05, side * 32.8, mat(0xcbb457), -.45);
    }
    for (let z = 34; z < 51; z += 3) box(scene, 37, .02, .045, 0, .045, side * z, mat(0x6c6c60));
  }
  for (const side of [-1, 1]) {
    for (let z = -49; z < 52; z += 7) {
      const x = side * (23 + random() * 7);
      // Low polygon conifers and rock outcrops sit outside the playable lane.
      cylinder(scene, .18, .3, 1.6, x, .6, z, mat(0x554631), 5);
      cylinder(scene, 0, 1.65, 3.7, x, 2.7, z, mat(0x354b29), 7);
      cylinder(scene, 0, 1.2, 2.8, x, 4, z, mat(0x445b30), 7);
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(.7 + random()), mat(0x898574));
      rock.position.set(x + side * 2, .2, z + 2); rock.scale.y = .6; rock.castShadow = true; scene.add(rock);
    }
    for (let z = -29; z <= 29; z += 6) {
      box(scene, .55, .7, 3.8, side * 18.8, .25, z, mat(0xaaa28a));
      box(scene, .65, .12, 3.9, side * 18.8, .66, z, mat(0xc0b89e));
    }
  }
}
function buildingMesh(b) {
  const g = new THREE.Group();
  // Orient the entrance toward the battlefield for each side. Each facility
  // has a distinctive roofline, so its role reads even from the full map.
  const body = new THREE.Group();
  if (b.team === 'enemy') body.rotation.y = Math.PI;
  g.add(body);
  const accent = b.team === 'player' ? C.player : C.enemy;
  const darkAccent = b.team === 'player' ? C.playerDark : C.enemyDark;
  const glow = mat(accent), armor = mat(b.team === 'player' ? 0xb3b09a : 0x9b9380), dark = mat(C.dark), edge = mat(darkAccent);
  const steel = mat(0x999b8d), shadow = mat(0x4c5146), caution = mat(0xe1bd49);
  if (b.kind === 'emplacement') {
    body.rotation.y = 0;
    cylinder(body, 1.7, 1.7, .3, 0, .2, 0, shadow, 12);
    cylinder(body, .8, 1.15, .65, 0, .65, 0, dark, 12);
    box(body, 2.5, 1.25, .45, 0, 1.35, -.4, armor);
    box(body, 2.55, .18, .5, 0, 2, -.4, glow);
    box(body, .34, .34, 3.5, 0, 1.8, -1.4, steel);
    box(body, .55, .5, .7, 0, 1.8, -3.1, dark);
    for (const x of [-.8, .8]) box(body, .3, .25, 2.1, x, .5, .7, edge, x * .3);
  } else if (b.kind === 'command') {
    // A stepped headquarters with a raised reactor and communications crown.
    box(body, 7.3, .52, 6.6, 0, .28, 0, dark);
    box(body, 6.8, .35, 6.1, 0, .67, 0, edge);
    box(body, 6.2, 1.9, 5.5, 0, 1.72, 0, armor);
    box(body, 6.45, .24, 5.75, 0, 2.78, 0, shadow);
    for (const x of [-2.7, 2.7]) {
      box(body, .7, 2.15, 4.95, x, 1.68, 0, shadow);
      box(body, .38, .24, 4.5, x, 2.87, 0, glow);
      for (const z of [-1.8, 0, 1.8]) box(body, .75, .35, .65, x, .95, z, steel);
    }
    // Forward blast door, lit windows, and flanking armored fins.
    box(body, 2.35, 1.3, .18, 0, 1.3, -2.79, dark);
    for (const x of [-.75, 0, .75]) box(body, .13, 1.15, .08, x, 1.3, -2.91, steel);
    box(body, 1.95, .16, .12, 0, 2.13, -2.92, glow);
    for (const x of [-2, 2]) {
      box(body, .85, .45, .12, x, 1.85, -2.81, glow);
      box(body, .22, 1.15, .35, x, 1.15, -2.9, edge);
    }
    box(body, 4.25, .35, 3.95, 0, 3.04, .1, edge);
    box(body, 2.8, 1.1, 2.5, 0, 3.7, .3, armor);
    box(body, 3.1, .22, 2.8, 0, 4.35, .3, glow);
    cylinder(body, .14, .22, 1.1, 0, 4.9, .3, steel);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), steel);
    dish.rotation.x = -.7; dish.position.set(0, 5.5, .3); dish.castShadow = true; body.add(dish);
    cylinder(body, .045, .045, 2.3, 2, 3.9, 1.7, dark);
    box(body, .85, .5, .06, 2.4, 4.7, 1.7, glow);
  } else if (b.kind === 'refinery') {
    // Ore hopper, processing tower and twin storage tanks.
    box(body, 7.1, .45, 5.6, 0, .25, 0, dark);
    box(body, 3.1, 2.1, 4.4, -1.55, 1.5, 0, armor);
    box(body, 3.3, .25, 4.6, -1.55, 2.7, 0, edge);
    box(body, 2.3, 1.4, .18, -.9, 1.1, -2.27, shadow);
    box(body, 2.5, .2, .2, -.9, 1.9, -2.45, caution);
    for (const z of [-1.2, 1.2]) {
      cylinder(body, .9, .9, 2.7, 2, 1.7, z, steel, 12);
      cylinder(body, .94, .94, .3, 2, 2.4, z, glow, 12);
      cylinder(body, .2, .9, .65, 2, 3.35, z, shadow, 12);
    }
    cylinder(body, .55, .7, 3.1, -2, 3.4, 1, shadow);
    cylinder(body, .65, .65, .25, -2, 5, 1, caution);
    box(body, 2.5, .5, 1.9, -.7, 3.1, -.7, shadow);
    for (let x = -1.5; x <= .2; x += .55) {
      const chunk = new THREE.Mesh(new THREE.OctahedronGeometry(.48), mat(0xe5b64a));
      chunk.position.set(x, 3.5, -.7); body.add(chunk);
    }
    box(body, 2.6, .13, .65, -.7, .55, -2.4, caution);
  } else if (b.kind === 'factory') {
    // Vehicle works: wide bay, external gantry, exhausts and roof machinery.
    box(body, 6.45, .5, 6.1, 0, .27, 0, dark);
    box(body, 5.75, 2.15, 5.35, 0, 1.56, .1, armor);
    box(body, 5.9, .22, 5.5, 0, 2.74, .1, edge);
    box(body, 3.7, 1.55, .16, 0, 1.14, -2.63, shadow);
    for (let x = -1.5; x <= 1.5; x += .5) box(body, .12, 1.38, .08, x, 1.15, -2.74, steel);
    box(body, 4.25, .32, .42, 0, 2.18, -2.8, glow);
    for (const x of [-2.2, 2.2]) {
      box(body, .4, 2.05, .5, x, 1.37, -2.75, edge);
      box(body, .53, .25, 5.2, x, 2.95, 0, shadow);
      box(body, .22, .12, 4.75, x, 3.14, 0, glow);
      box(body, .58, .85, 1.05, x, .83, -1.95, steel);
    }
    // Machine housing, vents and paired stacks silhouette the roof.
    box(body, 2.65, .8, 2.2, 0, 3.22, .35, shadow);
    box(body, 2.35, .14, 1.9, 0, 3.7, .35, steel);
    for (const z of [-.25, .25, .75]) box(body, 1.9, .06, .13, 0, 3.79, z, dark);
    for (const x of [-1.7, 1.7]) {
      cylinder(body, .4, .5, 1.35, x, 3.66, 1.65, dark, 8);
      cylinder(body, .47, .47, .19, x, 4.38, 1.65, edge, 8);
      cylinder(body, .24, .24, .08, x, 4.5, 1.65, glow, 8);
    }
    for (const x of [-1.4, -.7, 0, .7, 1.4]) box(body, .42, .06, .14, x, .56, -2.94, caution, -.35);
  } else {
    // Fortified barracks with a compact entrance and antenna tower.
    box(body, 5.7, .45, 5.3, 0, .24, 0, dark);
    box(body, 5.05, 1.85, 4.65, 0, 1.36, 0, armor);
    box(body, 5.2, .32, 4.8, 0, 2.38, 0, edge);
    box(body, 3.9, .45, 3.65, 0, 2.75, .15, shadow);
    box(body, 3.45, .12, 3.2, 0, 3.02, .15, steel);
    for (const x of [-2.2, 2.2]) {
      box(body, .52, 1.7, .62, x, 1.27, -2.14, shadow);
      box(body, .4, .22, 3.5, x, 2.6, 0, glow);
    }
    box(body, 2.25, 1.32, .15, 0, 1.05, -2.36, dark);
    box(body, .12, 1.2, .08, 0, 1.05, -2.48, steel);
    box(body, 2.55, .18, .2, 0, 1.88, -2.5, glow);
    for (const x of [-1.6, 1.6]) box(body, .5, .35, .1, x, 1.48, -2.38, glow);
    box(body, 1.7, .55, 1.6, -.55, 3.32, .05, edge);
    box(body, 1.35, .17, 1.25, -.55, 3.7, .05, glow);
    cylinder(body, .15, .2, 1.35, 1.22, 3.66, .8, steel);
    cylinder(body, .34, .34, .12, 1.22, 4.38, .8, glow, 8);
    for (const z of [-1.2, -.65, -.1]) box(body, .13, .07, .3, 1.25, 3.1, z, dark);
  }
  // Consolidate the small armor panels by material. This keeps the detailed
  // buildings inexpensive to draw on mobile while preserving individual
  // building geometry for cleanup when a structure is destroyed.
  const parts = new Map();
  for (const mesh of [...body.children]) {
    mesh.updateMatrix();
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrix);
    if (!parts.has(mesh.material)) parts.set(mesh.material, []);
    parts.get(mesh.material).push(geometry);
    mesh.geometry.dispose();
    body.remove(mesh);
  }
  for (const [material, geometries] of parts) {
    const positions = [], normals = [];
    for (const geometry of geometries) {
      positions.push(...geometry.attributes.position.array);
      normals.push(...geometry.attributes.normal.array);
      geometry.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true; body.add(mesh);
  }
  const baseRing = ring(b.kind === 'command' ? 4.3 : 3.5, accent, .3); baseRing.userData.decoration = true; g.add(baseRing);
  return g;
}
function unitMesh(u) {
  const g = new THREE.Group();
  const accent = u.team === 'player' ? C.player : C.enemy;
  const darkAccent = u.team === 'player' ? C.playerDark : C.enemyDark;
  const glow = mat(accent), armor = mat(u.team === 'player' ? 0x8b9563 : 0xa09166), dark = mat(0x464c36);
  const metal = mat(0x858777), pale = mat(0xd2ac7e), shadow = mat(0x292c25);

  // Combine the small armor pieces by material. Detailed models stay cheap to
  // draw even when both armies have many units on screen.
  const parts = new Map();
  const addPart = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    if (source !== geometry) geometry.dispose();
    source.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    source.translate(x, y, z);
    if (!parts.has(material)) parts.set(material, []);
    parts.get(material).push(source);
  };
  const plate = (w, h, d, x, y, z, material, rx = 0, ry = 0, rz = 0) =>
    addPart(new THREE.BoxGeometry(w, h, d), material, x, y, z, rx, ry, rz);
  const drum = (r1, r2, h, x, y, z, material, rx = 0, ry = 0, rz = 0, segments = 8) =>
    addPart(new THREE.CylinderGeometry(r1, r2, h, segments), material, x, y, z, rx, ry, rz);
  if (u.kind === 'collector') {
    // A civilian mining truck: broad wheels, open hopper and front scoop.
    plate(2.4, .4, 3.8, 0, .65, 0, shadow);
    for (const x of [-1.2, 1.2]) {
      for (const z of [-1.15, 1.15]) {
        drum(.58, .58, .45, x, .55, z, shadow, 0, 0, Math.PI / 2, 10);
        drum(.28, .28, .48, x, .55, z, metal, 0, 0, Math.PI / 2);
      }
      plate(.18, .85, 2.25, x * .8, 1.4, .65, armor);
    }
    plate(2, .18, 2.25, 0, 1, .65, dark);
    plate(2, .85, .16, 0, 1.4, 1.8, armor);
    plate(1.9, 1.1, 1.2, 0, 1.5, -1.05, glow);
    plate(1.5, .45, .1, 0, 1.7, -1.7, mat(0x97b9bf));
    plate(2.1, .15, 1.4, 0, 2.1, -1.05, armor);
    plate(2.7, .45, .65, 0, .45, -2.05, mat(0xd4ae45));
    for (const x of [-.85, .85]) plate(.25, .2, .12, x, 1.15, -1.7, mat(0xffde8b));
  } else if (u.kind === 'demolition') {
    // Six wheels, a faction-painted cab, and an unmistakable hazard-striped charge.
    const explosive = mat(0xac4930), warning = mat(0xf0cc51);
    plate(2.1, .35, 3.6, 0, .65, 0, shadow);
    for (const x of [-1.05, 1.05]) for (const z of [-1.15, .45, 1.3]) {
      drum(.48, .48, .35, x, .48, z, shadow, 0, 0, Math.PI / 2, 10);
      drum(.22, .22, .37, x, .48, z, metal, 0, 0, Math.PI / 2);
    }
    plate(1.85, 1.1, 1.15, 0, 1.3, -1.1, glow);
    plate(1.5, .4, .08, 0, 1.55, -1.71, mat(0x97b9bf));
    plate(2, .14, 1.35, 0, 1.91, -1.1, armor);
    plate(1.8, 1.4, 2.1, 0, 1.5, .65, explosive);
    for (const x of [-.92, .92]) {
      plate(.05, .55, 2.1, x, 1.5, .65, warning);
      for (const z of [-.05, .55, 1.15]) plate(.07, .57, .22, x, 1.5, z, shadow, -.5);
    }
    plate(1.85, .12, 2.15, 0, 2.25, .65, dark);
    drum(.18, .18, .2, 0, 2.42, .45, mat(0xff6b28));
    for (const x of [-.65, .65]) plate(.25, .18, .08, x, 1.05, -1.72, mat(0xffde8b));
  } else if (u.kind === 'tank') {
    // Squat riveted armor, exposed treads and a long conventional cannon.
    plate(2.2, .5, 3.05, 0, .48, .1, shadow);
    for (const x of [-1.08, 1.08]) {
      plate(.56, .68, 3.1, x, .42, .1, shadow);
      for (let z = -1.2; z < 1.5; z += .32) {
        plate(.6, .09, .14, x, .78, z, metal);
        drum(.22, .22, .1, x * 1.26, .4, z, metal, 0, 0, Math.PI / 2);
      }
      plate(.6, .12, 3.15, x, .88, .1, armor);
      plate(.62, .14, .65, x, .98, -.8, glow);
    }
    plate(1.85, .6, 2.5, 0, .91, .1, armor);
    plate(1.85, .25, .65, 0, 1.07, -1.1, armor, .35);
    plate(1.7, .08, .75, 0, 1.26, .95, shadow);
    for (let x = -.65; x <= .65; x += .22) plate(.07, .08, .68, x, 1.32, .95, metal);
    drum(.72, .9, .26, 0, 1.3, -.08, shadow);
    drum(.83, 1, .55, 0, 1.66, -.1, glow, 0, Math.PI / 8, 0, 8);
    plate(1.22, .16, 1.15, 0, 1.98, -.1, armor);
    drum(.28, .28, .13, -.3, 2.1, .05, shadow);
    plate(.55, .4, .4, 0, 1.68, -.95, armor);
    drum(.105, .14, 1.95, 0, 1.7, -1.97, metal, Math.PI / 2);
    drum(.17, .17, .28, 0, 1.7, -2.95, shadow, Math.PI / 2);
    drum(.025, .025, 1.1, .55, 2.45, .35, shadow);
    for (const x of [-.7, .7]) plate(.2, .13, .08, x, 1.15, -1.45, mat(0xf6d889));
    plate(.16, .025, .52, .25, 2.08, -.28, mat(0xe6dfbe));
    plate(.48, .025, .16, .25, 2.09, -.28, mat(0xe6dfbe));
  } else {
    // Cloth fatigues, field webbing and a broad steel helmet.
    for (const x of [-.23, .23]) {
      plate(.3, .65, .35, x, .48, 0, armor);
      plate(.34, .23, .52, x, .14, -.08, shadow);
      plate(.26, .5, .32, x * 2.1, 1.12, -.05, armor, -.3, 0, x < 0 ? -.15 : .15);
      plate(.26, .19, .25, x * 2.1, .91, -.22, pale);
      plate(.33, .19, .36, x * 2.1, 1.4, 0, glow);
    }
    plate(.73, .7, .5, 0, 1.12, 0, armor);
    plate(.77, .13, .56, 0, .83, 0, shadow);
    for (const x of [-.22, .22]) {
      plate(.12, .55, .06, x, 1.17, -.29, mat(0xc5b387));
      plate(.23, .22, .15, x, .94, -.34, dark);
    }
    plate(.56, .5, .27, 0, 1.12, .36, dark);
    drum(.24, .25, .35, 0, 1.68, -.02, pale);
    drum(.29, .36, .25, 0, 1.9, 0, glow);
    drum(.38, .38, .07, 0, 1.79, -.02, glow);
    if (u.kind === 'rocket') {
      drum(.22, .22, 1.55, .52, 1.53, -.2, dark, Math.PI / 2);
      drum(.28, .28, .17, .52, 1.53, -.99, metal, Math.PI / 2);
      drum(.16, .16, .02, .52, 1.53, -1.09, shadow, Math.PI / 2);
      plate(.45, .12, .3, .52, 1.76, -.3, mat(0xd7ba53));
      for (const x of [-.2, .15]) drum(.12, .12, .85, x, 1.2, .48, metal);
    } else {
      plate(.16, .18, .9, .4, 1.08, -.42, shadow);
      plate(.18, .2, .32, .4, 1.08, .04, mat(0x6e4930));
      drum(.055, .055, .55, .4, 1.1, -1.08, shadow, Math.PI / 2);
      plate(.12, .27, .18, .4, .88, -.4, metal, -.25);
    }
  }
  for (const [material, geometries] of parts) {
    const positions = [], normals = [];
    for (const geometry of geometries) {
      positions.push(...geometry.attributes.position.array);
      normals.push(...geometry.attributes.normal.array);
      geometry.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
  }
  // Models face north by default. The opposing force faces south.
  if (u.team === 'enemy') g.rotation.y = Math.PI;
  return g;
}
function healthBar(width) {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(width, .18), new THREE.MeshBasicMaterial({color: 0x101a20, side: THREE.DoubleSide, depthTest: false}));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(width - .06, .1), new THREE.MeshBasicMaterial({color: 0x76e6a3, side: THREE.DoubleSide, depthTest: false}));
  bg.renderOrder = 20; fill.renderOrder = 21; fill.position.z = .01; g.add(bg, fill); g.userData.fill = fill; return g;
}

function oreMesh(deposit) {
  const group = new THREE.Group();
  // One instanced draw per field, with the same crystal pattern for each pair.
  const chunks = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1), mat(0xdca338), 16);
  let seed = Math.floor((deposit.id - 1) / 2);
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const transform = new THREE.Object3D();
  for (let i = 0; i < 16; i++) {
    const angle = random() * Math.PI * 2, radius = random() * 2.2;
    const size = .4 + random() * .55;
    transform.position.set(Math.cos(angle) * radius, size * .45, Math.sin(angle) * radius);
    transform.rotation.set(random() * .5, angle, random() * .5);
    transform.scale.set(size, size * .8, size * .7);
    transform.updateMatrix(); chunks.setMatrixAt(i, transform.matrix);
  }
  chunks.castShadow = true; chunks.receiveShadow = true; group.add(chunks);
  group.rotation.y = deposit.z < 0 ? Math.PI : 0;
  return group;
}

export class BattlefieldRenderer {
  constructor(container, onSelect = () => {}, onCancelTraining = () => {}, onEjectGarrisoned = () => {}) {
    this.container = container; this.onSelect = onSelect; this.view = 'map';
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x78805b);
    this.scene.fog = new THREE.Fog(0x78805b, 130, 230);
    this.camera = new THREE.OrthographicCamera(-25, 25, 45, -45, .1, 300);
    this.camera.position.set(0, 110, 95); this.camera.lookAt(0, 0, 0);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    const compact = window.matchMedia('(max-width: 700px)').matches;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);
    this.productionQueues = new ProductionQueues(container, onCancelTraining, onEjectGarrisoned);
    this.scene.add(new THREE.HemisphereLight(0xdde5ed, 0x625435, 2.0));
    const sun = new THREE.DirectionalLight(0xffe6b2, 3); sun.position.set(-30, 65, 25); sun.castShadow = true;
    sun.shadow.mapSize.set(compact ? 1024 : 2048, compact ? 1024 : 2048); Object.assign(sun.shadow.camera, {left:-60,right:60,top:70,bottom:-70,near:1,far:160}); sun.shadow.bias = -0.0005; this.scene.add(sun);
    addEnvironment(this.scene);
    this.defensePads = new Map();
    this.entities = new Map(); this.oreFields = new Map(); this.combatEffects = new CombatEffects(this.scene, compact); this.lastShotId = 0; this.lastTime = 0; this.lastFrame = performance.now(); this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    const pointerStarts = new Map();
    this.renderer.domElement.addEventListener('pointerdown', event => {
      pointerStarts.set(event.pointerId, [event.clientX, event.clientY]);
    });
    this.renderer.domElement.addEventListener('pointercancel', event => pointerStarts.delete(event.pointerId));
    this.renderer.domElement.addEventListener('pointerup', event => {
      const start = pointerStarts.get(event.pointerId);
      pointerStarts.delete(event.pointerId);
      // Do not select when the user was scrolling or dragging.
      if (!start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 12) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const touch = event.pointerType === 'touch' || event.pointerType === 'pen';
      let id = null;
      if (touch) {
        // Find the nearest selectable unit in screen space. Soldiers can be much
        // smaller than a fingertip on a phone; nearest wins if targets overlap.
        let nearest = 28;
        for (const entity of this.entities.values()) {
          if (!entity.selectable) continue;
          const position = entity.group.position.clone();
          position.y += 1;
          position.project(this.camera);
          const x = rect.left + (position.x + 1) * rect.width / 2;
          const y = rect.top + (1 - position.y) * rect.height / 2;
          const distance = Math.hypot(event.clientX - x, event.clientY - y);
          if (distance < nearest) { nearest = distance; id = entity.group.userData.entityId; }
        }
      } else {
        this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObjects([...this.entities.values()].filter(e => e.selectable).map(e => e.hitTarget), false);
        let object = hits[0]?.object;
        while (object && object.userData.entityId === undefined) object = object.parent;
        id = object?.userData.entityId ?? null;
      }
      this.onSelect(id, touch || event.shiftKey, touch);
    });
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container); this.resize();
  }
  setView(view) {
    this.view = view === 'base' ? 'base' : 'map';
    this.resize();
  }
  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const height = this.view === 'base' ? Math.max(38, 28 / aspect) : Math.max(88, 44 / aspect);
    const focusZ = this.view === 'base' ? 30 : 0;
    this.camera.position.set(0, 110, 95 + focusZ);
    this.camera.lookAt(0, 0, focusZ);
    this.camera.updateMatrixWorld();
    this.camera.left = -height * aspect / 2; this.camera.right = height * aspect / 2;
    this.camera.top = height / 2; this.camera.bottom = -height / 2; this.camera.updateProjectionMatrix();
  }
  reset() {
    this.lastTime = 0;
    this.lastFrame = performance.now();
    this.lastShotId = 0;
    this.lastExplosionId = 0;
    this.combatEffects.clear();
    for (const entity of this.entities.values()) this.removeEntity(entity);
    this.entities.clear();
    this.productionQueues.reset();
  }
  update(snapshot, selectedIds = []) {
    if (!snapshot) return;
    const restarting = snapshot.time < this.lastTime;
    const now = performance.now();
    const dt = Math.min(.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    if (restarting) {
      this.reset();
    }
    this.lastTime = snapshot.time;
    for (const pad of snapshot.defense_slots || []) {
      const key = `${pad.team}-${pad.slot}`;
      if (!this.defensePads.has(key)) {
        const marker = new THREE.Group();
        const outline = ring(2.3, pad.team === 'player' ? 0x9bc5ff : 0xffa18b, .85);
        marker.add(outline);
        box(marker, 1.5, .05, .12, 0, .1, 0, mat(0xe3c66b));
        box(marker, .12, .05, 1.5, 0, .1, 0, mat(0xe3c66b));
        marker.position.set(pad.x, .04, pad.z);
        this.defensePads.set(key, marker);
        this.scene.add(marker);
      }
    }
    this.productionQueues.update(snapshot, this.camera, this.container.clientWidth, this.container.clientHeight);
    const oreIds = new Set(snapshot.ore.filter(o => o.amount > 0).map(o => o.id));
    for (const deposit of snapshot.ore) {
      if (deposit.amount <= 0) continue;
      let field = this.oreFields.get(deposit.id);
      if (!field) { field = oreMesh(deposit); this.oreFields.set(deposit.id, field); this.scene.add(field); }
      field.position.set(deposit.x, 0, deposit.z);
      field.scale.setScalar(.35 + .65 * deposit.amount / deposit.max_amount);
    }
    for (const [id, field] of this.oreFields) if (!oreIds.has(id)) {
      this.scene.remove(field); field.traverse(object => object.geometry?.dispose()); this.oreFields.delete(id);
    }
    const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
    const alive = new Set();
    for (const item of [...snapshot.buildings, ...snapshot.units]) {
      const isUnit = 'state' in item, key = `${isUnit ? 'u' : 'b'}${item.id}`; alive.add(key);
      let entity = this.entities.get(key);
      if (!entity) {
        const group = new THREE.Group(); group.userData.entityId = item.id;
        group.add(isUnit ? unitMesh(item) : buildingMesh(item));
        let cargo = null;
        if (isUnit && item.kind === 'collector') {
          cargo = new THREE.Mesh(new THREE.BoxGeometry(1.6, .7, 1.9), mat(0xe5b64a));
          cargo.position.set(0, 1.45, .65); group.children[0].add(cargo);
        }
        // A generous transparent target keeps individual soldiers easy to click.
        let hitTarget = null;
        if (isUnit) {
          hitTarget = new THREE.Mesh(new THREE.SphereGeometry(['tank', 'collector', 'demolition'].includes(item.kind) ? 1.65 : 1.05, 8, 6), new THREE.MeshBasicMaterial({transparent: true, opacity: 0, depthWrite: false}));
          hitTarget.position.y = 1; group.add(hitTarget);
        }
        const selection = ring(isUnit && ['tank', 'demolition'].includes(item.kind) ? 1.8 : 1.25, 0x9eff40, .95); selection.visible = false; group.add(selection);
        const hp = healthBar(isUnit ? 1.8 : 4.5); hp.position.y = isUnit ? (item.kind === 'tank' ? 2.3 : 2.5) : (item.kind === 'command' ? 6.8 : 5.1); group.add(hp);
        this.scene.add(group); entity = {group, selection, hp, hitTarget, cargo, kind: item.kind, isUnit, selectable: false, recoilUntil: 0, emission: 0}; this.entities.set(key, entity);
      }
      if (entity.cargo || item.kind === 'demolition') {
        const dx = item.x - entity.group.position.x, dz = item.z - entity.group.position.z;
        if (Math.hypot(dx, dz) > .001) entity.group.children[0].rotation.y = Math.atan2(-dx, -dz);
        if (entity.cargo) {
          entity.cargo.visible = item.cargo > 0;
          entity.cargo.scale.y = item.cargo / 100;
        }
      }
      entity.group.position.set(item.x, 0, item.z);
      entity.group.visible = item.state !== 'garrison';
      if (item.kind === 'emplacement') {
        const model = entity.group.children[0];
        model.rotation.y = item.facing;
        model.scale.y = .25 + .75 * (1 - item.construction_remaining / 8);
        entity.hp.position.y = 3;
      }
      if (entity.kind === 'tank') {
        const recoil = Math.max(0, (entity.recoilUntil - performance.now()) / 240);
        const model = entity.group.children[0];
        model.position.x = Math.sin(model.rotation.y) * recoil * .4;
        model.position.z = Math.cos(model.rotation.y) * recoil * .4;
      }
      entity.selectable = isUnit && item.team === 'player' && item.state === 'gather';
      entity.selection.visible = entity.selectable && selected.has(item.id);
      entity.hp.visible = item.hp < item.max_hp || entity.selection.visible || item.construction_remaining > 0;
      const fraction = Math.max(0, item.hp / item.max_hp); entity.hp.userData.fill.scale.x = fraction;
      entity.hp.userData.fill.position.x = -(1 - fraction) * (isUnit ? 1.8 : 4.5) / 2;
      entity.hp.userData.fill.material.color.setHex(fraction > .5 ? 0x76e6a3 : fraction > .25 ? 0xf8c65f : 0xff7065);
      entity.hp.quaternion.copy(this.camera.quaternion);
      if (entity.group.visible && (!isUnit || ['tank', 'collector', 'demolition'].includes(item.kind)) && fraction < .5) {
        entity.emission += dt;
        if (entity.emission > .18) {
          entity.emission = 0;
          const origin = { x: item.x, y: isUnit ? 1.6 : 2.7, z: item.z };
          if (fraction < .25) this.combatEffects.burn(origin, isUnit ? .65 : 1.2);
          else this.combatEffects.smokePuff(origin, isUnit ? .7 : 1.3);
        }
      } else entity.emission = 0;
    }
    for (const shot of snapshot.shots || []) {
      if (shot.id <= this.lastShotId) continue;
      this.lastShotId = shot.id;
      const entity = this.entities.get(`${shot.source_is_unit ? 'u' : 'b'}${shot.source_id}`);
      if (entity && shot.source_is_unit) {
        entity.group.children[0].rotation.y = Math.atan2(shot.x - shot.target_x, shot.z - shot.target_z);
        if (shot.kind === 'tank') entity.recoilUntil = now + 240;
      }
      this.combatEffects.fire(shot);
    }
    for (const blast of snapshot.explosions || []) {
      if (blast.id <= (this.lastExplosionId || 0)) continue;
      this.lastExplosionId = blast.id;
      this.combatEffects.explode(blast);
    }
    for (const [key, entity] of this.entities) if (!alive.has(key)) {
      if (!restarting && entity.group.visible) this.combatEffects.destroy(entity);
      this.removeEntity(entity);
      this.entities.delete(key);
    }
    this.combatEffects.update(dt, this.camera);
    const shake = this.combatEffects.reducedMotion.matches ? 0 : this.combatEffects.shake;
    const quake = this.combatEffects.reducedMotion.matches ? 0 : 1.6 * this.combatEffects.demolitionShake ** 2;
    const focusZ = this.view === 'base' ? 30 : 0;
    this.camera.position.set(
      Math.sin(now * .07) * shake + Math.sin(now * .113) * quake,
      110 + Math.cos(now * .08) * shake * .5 + Math.cos(now * .137) * quake * .8,
      95 + focusZ + Math.sin(now * .097) * quake * .6);

    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
  }
  removeEntity(entity) {
    this.scene.remove(entity.group);
    entity.group.traverse(object => {
      object.geometry?.dispose();
      if (object.material && ![...mats.values()].includes(object.material)) object.material.dispose();
    });
  }
  dispose() {
    this.resizeObserver.disconnect();
    this.combatEffects.dispose();
    for (const entity of this.entities.values()) this.removeEntity(entity);
    this.entities.clear();
    this.scene.traverse(object => { object.dispose?.(); object.geometry?.dispose(); });
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}

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
// Surfaces are painted once into canvases with a fixed seed, so every match
// sees the same ground while costing only a handful of textured draws.
function seeded(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function paintedTexture(width, height, paint) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}
function speckle(ctx, width, height, count, random, light, dark, size = 1) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = random() < .5 ? light : dark;
    ctx.fillRect(random() * width, random() * height, size, size);
  }
}
function blotch(ctx, x, y, radius, color, alpha) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(${color},${alpha})`); gradient.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}
function groundTexture(scale) {
  // Canvas x follows world x and canvas y follows world z across the 100×150 field.
  return paintedTexture(100 * scale, 150 * scale, (ctx, w, h) => {
    const random = seeded(1941), px = x => (x + 50) * scale, pz = z => (z + 75) * scale;
    ctx.fillStyle = '#646c3d'; ctx.fillRect(0, 0, w, h);
    const tones = ['123,130,74', '86,98,52', '139,134,82', '96,90,58', '74,88,46'];
    for (let i = 0; i < 700; i++) blotch(ctx, random() * w, random() * h, (2 + random() * 7) * scale, tones[i % tones.length], .18 + random() * .22);
    // Worn earth around both bases and along the road shoulders.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 70; i++) blotch(ctx, px((random() - .5) * 46), pz(side * (42 + (random() - .5) * 26)), (2 + random() * 4) * scale, '118,100,66', .22);
    }
    for (let z = -56; z <= 56; z += 1.5) for (const side of [-1, 1]) {
      blotch(ctx, px(side * (5 + random() * 1.6)), pz(z), (1 + random() * 1.4) * scale, '104,90,60', .35);
    }
    // Faint vehicle tracks wander across the contested middle.
    ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      let x = (random() - .5) * 30, z = -32;
      ctx.strokeStyle = `rgba(70,62,40,${.12 + random() * .1})`; ctx.lineWidth = .28 * scale;
      for (const offset of [-.7, .7]) {
        ctx.beginPath(); ctx.moveTo(px(x + offset), pz(z));
        let tx = x, tz = z;
        while (tz < 32) { tz += 4; tx += (random() - .5) * 3; ctx.lineTo(px(tx + offset), pz(tz)); }
        ctx.stroke();
      }
    }
    speckle(ctx, w, h, w * h / 18, random, 'rgba(176,180,112,.22)', 'rgba(40,46,24,.25)', Math.max(1, scale / 6));
  });
}
function asphaltTexture() {
  const texture = paintedTexture(128, 256, (ctx, w, h) => {
    const random = seeded(77);
    ctx.fillStyle = '#5f5e58'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = `rgba(${random() < .5 ? '40,40,38' : '120,118,108'},${.06 + random() * .08})`;
      ctx.fillRect(random() * w, random() * h, 10 + random() * 40, 10 + random() * 50);
    }
    speckle(ctx, w, h, 9000, random, 'rgba(160,158,145,.35)', 'rgba(30,30,28,.35)');
    ctx.strokeStyle = 'rgba(32,32,30,.55)'; ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      let x = random() * w, y = random() * h; ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) { x += (random() - .5) * 18; y += random() * 12; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // Darker edges where the asphalt meets the verge.
    const edge = ctx.createLinearGradient(0, 0, w, 0);
    edge.addColorStop(0, 'rgba(40,38,30,.5)'); edge.addColorStop(.12, 'rgba(40,38,30,0)');
    edge.addColorStop(.88, 'rgba(40,38,30,0)'); edge.addColorStop(1, 'rgba(40,38,30,.5)');
    ctx.fillStyle = edge; ctx.fillRect(0, 0, w, h);
  });
  texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(1, 14);
  return texture;
}
function apronTexture(scale) {
  return paintedTexture(37 * scale, 19 * scale, (ctx, w, h) => {
    const random = seeded(311);
    ctx.fillStyle = '#939282'; ctx.fillRect(0, 0, w, h);
    // Individual slabs are poured at slightly different shades.
    for (let x = -18.5; x < 18.5; x += 3) for (let z = -9.5; z < 9.5; z += 3) {
      ctx.fillStyle = `rgba(${random() < .5 ? '170,168,150' : '110,108,96'},${random() * .16})`;
      ctx.fillRect((x + 18.5) * scale, (z + 9.5) * scale, 3 * scale, 3 * scale);
    }
    for (let i = 0; i < 26; i++) blotch(ctx, random() * w, random() * h, (.4 + random() * 1.6) * scale, '52,50,42', .18 + random() * .2);
    speckle(ctx, w, h, w * h / 6, random, 'rgba(200,198,182,.25)', 'rgba(70,70,60,.25)');
    ctx.strokeStyle = 'rgba(84,84,72,.85)'; ctx.lineWidth = Math.max(1, scale * .07);
    for (let x = .5; x < 37; x += 3) { ctx.beginPath(); ctx.moveTo(x * scale, 0); ctx.lineTo(x * scale, h); ctx.stroke(); }
    for (let z = 1.5; z < 19; z += 3) { ctx.beginPath(); ctx.moveTo(0, z * scale); ctx.lineTo(w, z * scale); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(60,58,50,.6)'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  });
}
let blobTexture = null;
function contactShadowMaterial() {
  // Soft ambient occlusion under every model grounds it on the battlefield.
  if (!mats.has('contact-shadow')) {
    blobTexture = paintedTexture(64, 64, ctx => blotch(ctx, 32, 32, 32, '255,255,255', 1));
    mats.set('contact-shadow', new THREE.MeshBasicMaterial({map: blobTexture, color: 0x000000, transparent: true, opacity: .55, depthWrite: false}));
  }
  return mats.get('contact-shadow');
}
function contactShadow(width, depth) {
  // Per-model material: wreck cleanup disposes decorations. Clones share one program.
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), contactShadowMaterial().clone());
  m.rotation.x = -Math.PI / 2; m.position.y = .06; m.renderOrder = -1;
  m.userData.decoration = true;
  return m;
}
function texturedPlane(scene, w, d, x, y, z, map, roughness = .95) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({map, roughness, metalness: 0}));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m;
}
function scatter(scene, geometry, material, count, place, castShadow = false) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const transform = new THREE.Object3D(), color = new THREE.Color();
  let placed = 0;
  for (let i = 0; i < count; i++) if (place(transform, color, i)) {
    transform.updateMatrix(); mesh.setMatrixAt(placed, transform.matrix); mesh.setColorAt(placed++, color);
  }
  mesh.count = placed; mesh.castShadow = castShadow; mesh.receiveShadow = true;
  scene.add(mesh); return mesh;
}
function addEnvironment(scene, compact) {
  // A sunlit temperate battlefield: scrub, worn asphalt and concrete aprons.
  box(scene, 100, .6, 150, 0, -.5, 0, mat(0x5a6236));
  texturedPlane(scene, 100, 150, 0, -.195, 0, groundTexture(compact ? 6 : 10));
  texturedPlane(scene, 9, 110, 0, -.055, 0, asphaltTexture(), .9);
  for (let z = -50; z <= 50; z += 5) {
    box(scene, .15, .025, 2, 0, -.04, z, mat(0xc6b785));
    for (const x of [-4.2, 4.2]) box(scene, .12, .025, 4.8, x, -.04, z, mat(0xaaa68b));
  }
  const apron = apronTexture(compact ? 12 : 20);
  for (const side of [-1, 1]) {
    box(scene, 37, .15, 19, 0, -.04, side * 42, mat(0x7c7b6c));
    const slab = texturedPlane(scene, 37, 19, 0, .036, side * 42, apron);
    if (side < 0) slab.rotation.z = Math.PI;
    for (let x = -18; x <= 18; x += 3) box(scene, 1.5, .03, .45, x, .05, side * 32.8, mat(0xcbb457), -.45);
  }
  const random = seeded(1941);
  const outside = (x, z) => Math.abs(x) > 21 || Math.abs(z) > 54;
  // Forest edges: two instanced canopy tiers, trunks and outcrops in four draws.
  const trees = [];
  for (let i = 0; i < 420 && trees.length < 150; i++) {
    const x = (random() < .5 ? -1 : 1) * (22 + random() * 26), z = random() * 146 - 73;
    if (trees.every(t => Math.hypot(t.x - x, t.z - z) > 3.2)) trees.push({x, z, s: .75 + random() * .6, h: random()});
  }
  const treeAt = (lift, tint) => (transform, color, i) => {
    const t = trees[i];
    transform.position.set(t.x, lift * t.s, t.z); transform.rotation.set(0, t.h * 6, 0); transform.scale.setScalar(t.s);
    color.setHSL(.24 + t.h * .06, .4 + t.h * .12, tint + t.h * .04);
    return true;
  };
  const foliage = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .9, flatShading: true});
  scatter(scene, new THREE.CylinderGeometry(.18, .3, 1.6, 5), mat(0x554631), trees.length, (transform, color, i) => {
    const t = trees[i];
    color.set(0xffffff); transform.position.set(t.x, .6 * t.s, t.z); transform.scale.setScalar(t.s); return true;
  }, true);
  scatter(scene, new THREE.ConeGeometry(1.75, 3.7, 7), foliage, trees.length, treeAt(2.7, .1), true);
  scatter(scene, new THREE.ConeGeometry(1.25, 2.8, 7), foliage, trees.length, treeAt(4.1, .14), true);
  const stone = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .95, flatShading: true});
  scatter(scene, new THREE.DodecahedronGeometry(1), stone, 70, (transform, color) => {
    const x = (random() < .5 ? -1 : 1) * (20.5 + random() * 28), z = random() * 146 - 73;
    const size = .5 + random() * 1.1;
    transform.position.set(x, .05, z); transform.rotation.set(random(), random() * 6, random());
    transform.scale.set(size * (1 + random() * .5), size * .55, size);
    color.setHSL(.12, .08, .42 + random() * .12); return true;
  }, true);
  // Low grass tufts break up the ground plane without adding shadow cost.
  scatter(scene, new THREE.ConeGeometry(.22, .55, 4), foliage, compact ? 700 : 1500, (transform, color) => {
    const x = random() * 96 - 48, z = random() * 146 - 73;
    const onRoad = Math.abs(x) < 6 && Math.abs(z) < 56, onApron = Math.abs(x) < 19.5 && Math.abs(z) > 32 && Math.abs(z) < 52;
    if (onRoad || onApron || Math.abs(Math.abs(x) - 18.8) < .8 || (!outside(x, z) && random() < .55)) return false;
    const size = .6 + random() * .9;
    transform.position.set(x, -.2 + .27 * size, z); transform.rotation.set((random() - .5) * .4, random() * 6, (random() - .5) * .4);
    transform.scale.set(size, size, size);
    color.setHSL(.16 + random() * .07, .45, .13 + random() * .07); return true;
  });
  for (const side of [-1, 1]) {
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
  const glow = mat(accent, accent, .35), armor = mat(b.team === 'player' ? 0xb3b09a : 0x9b9380), dark = mat(C.dark), edge = mat(darkAccent);
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
  const footprint = {command: [9.4, 8.6], refinery: [9.2, 7.6], factory: [8.4, 8], emplacement: [4.6, 4.6]}[b.kind] || [7.6, 7.2];
  g.add(contactShadow(...footprint));
  const baseRing = ring(b.kind === 'command' ? 4.3 : 3.5, accent, .3); baseRing.userData.decoration = true; g.add(baseRing);
  return g;
}
function unitMesh(u) {
  const g = new THREE.Group();
  const accent = u.team === 'player' ? C.player : C.enemy;
  const darkAccent = u.team === 'player' ? C.playerDark : C.enemyDark;
  const glow = mat(accent, accent, .25), armor = mat(u.team === 'player' ? 0x8b9563 : 0xa09166), dark = mat(0x464c36);
  const lamp = mat(0xffde8b, 0xffc861, 1.4);
  const metal = mat(0x858777), pale = mat(0xd2ac7e), shadow = mat(0x292c25);

  // Combine the small armor pieces by material. Detailed models stay cheap to
  // draw even when both armies have many units on screen.
  // Parts go to the hull unless a turret is being assembled around its pivot.
  const hull = new Map(), turret = new Map(), pivotZ = -.1;
  let parts = hull;
  const addPart = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    if (source !== geometry) geometry.dispose();
    source.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    source.translate(x, y, parts === turret ? z - pivotZ : z);
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
    for (const x of [-.85, .85]) plate(.25, .2, .12, x, 1.15, -1.7, lamp);
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
    drum(.18, .18, .2, 0, 2.42, .45, mat(0xff6b28, 0xff4a10, 1.2));
    for (const x of [-.65, .65]) plate(.25, .18, .08, x, 1.05, -1.72, lamp);
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
    for (const x of [-.7, .7]) plate(.2, .13, .08, x, 1.15, -1.45, lamp);
    // The turret traverses independently: hull follows the route, gun the target.
    parts = turret;
    drum(.83, 1, .55, 0, 1.66, -.1, glow, 0, Math.PI / 8, 0, 8);
    plate(1.22, .16, 1.15, 0, 1.98, -.1, armor);
    plate(1.05, .4, .55, 0, 1.68, .82, armor);
    plate(1.1, .08, .6, 0, 1.92, .82, shadow);
    for (const x of [-.62, .62]) {
      plate(.2, .28, .5, x, 1.66, .8, dark);
      for (const z of [-.62, -.42]) drum(.065, .065, .26, x * 1.05, 1.86, z, shadow, Math.PI / 2.6, 0, 0, 6);
    }
    drum(.28, .28, .13, -.3, 2.1, .05, shadow);
    drum(.2, .24, .08, -.3, 2.2, .05, metal);
    plate(.55, .4, .4, 0, 1.68, -.95, armor);
    drum(.105, .14, 1.95, 0, 1.7, -1.97, metal, Math.PI / 2);
    drum(.15, .15, .4, 0, 1.7, -1.75, shadow, Math.PI / 2);
    drum(.17, .17, .28, 0, 1.7, -2.95, shadow, Math.PI / 2);
    drum(.025, .025, 1.1, .55, 2.45, .35, shadow);
    plate(.16, .025, .52, .25, 2.08, -.28, mat(0xe6dfbe));
    plate(.48, .025, .16, .25, 2.09, -.28, mat(0xe6dfbe));
    parts = hull;
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
  const merge = (source, parent) => {
    for (const [material, geometries] of source) {
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
      mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
    }
  };
  merge(hull, g);
  if (turret.size) {
    const pivot = new THREE.Group(); pivot.position.z = pivotZ;
    merge(turret, pivot); g.add(pivot); g.userData.turret = pivot;
  }
  // Yaw last, so walking lean and suspension pitch follow the unit's heading.
  g.rotation.order = 'YXZ';
  const shadowSize = {collector: [3.6, 4.8], demolition: [3, 4.6], tank: [3.3, 4.2]}[u.kind] || [1.5, 1.3];
  g.add(contactShadow(...shadowSize));
  // Models face north by default. The opposing force faces south.
  if (u.team === 'enemy') g.rotation.y = Math.PI;
  return g;
}
const VEHICLES = new Set(['tank', 'collector', 'demolition']);
const TURN_RATE = {tank: 2.6, collector: 3.2, demolition: 3.6};
const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const turnToward = (current, target, step) => current + Math.max(-step, Math.min(step, wrapAngle(target - current)));
// Units turn into their route, face targets while firing, and move with a
// gait: infantry bob and sway, vehicles ride their suspension and raise dust.
function animateUnit(entity, item, dt, now, effects, compact) {
  const model = entity.group.children[0], turret = model.userData.turret;
  const dx = item.x - entity.group.position.x, dz = item.z - entity.group.position.z;
  const step = Math.hypot(dx, dz), continuous = entity.placed && step < 3;
  entity.placed = true;
  const speed = continuous && dt > 0 ? step / dt : 0;
  entity.speed += (speed - entity.speed) * Math.min(1, dt * 10);
  if (continuous && step > .002) entity.heading = Math.atan2(-dx, -dz);
  const aiming = now < entity.aimUntil;
  const desired = aiming && !turret ? entity.aimYaw : entity.heading;
  if (desired !== undefined) model.rotation.y = turnToward(model.rotation.y, desired, (TURN_RATE[item.kind] || 9) * dt);
  if (turret) {
    turret.rotation.y = turnToward(turret.rotation.y, aiming ? wrapAngle(entity.aimYaw - model.rotation.y) : 0, 4.5 * dt);
    const recoil = Math.max(0, (entity.recoilUntil - now) / 240) * .35;
    turret.position.x = Math.sin(turret.rotation.y) * recoil;
    turret.position.z = -.1 + Math.cos(turret.rotation.y) * recoil;
  }
  const vehicle = VEHICLES.has(item.kind), amount = Math.min(1, entity.speed / 2);
  entity.gait += dt * entity.speed * (vehicle ? 1.6 : 3.4);
  if (vehicle) {
    model.position.y = Math.sin(entity.gait * 2.3) * .035 * amount;
    model.rotation.x = Math.sin(entity.gait * 1.7) * .015 * amount;
    entity.dust += dt * amount;
    if (entity.dust > (compact ? .2 : .1) && entity.group.visible) {
      entity.dust = 0;
      const back = item.kind === 'tank' ? 1.5 : 1.9, yaw = model.rotation.y;
      effects.emit('dust', { x: item.x + Math.sin(yaw) * back, y: .25, z: item.z + Math.cos(yaw) * back },
        { size: .8 + Math.random() * .5, life: .7 + Math.random() * .4, vx: (Math.random() - .5) * .6,
          vy: .35, vz: (Math.random() - .5) * .6, color: 0xa1977a });
    }
  } else {
    model.position.y = Math.abs(Math.sin(entity.gait)) * .13 * amount;
    model.rotation.z = Math.sin(entity.gait) * .07 * amount;
    model.rotation.x = -.1 * amount;
  }
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
  if (!mats.has('ore')) {
    mats.set('ore', new THREE.MeshStandardMaterial({color: 0xe0a734, roughness: .32, metalness: .35, emissive: 0x9a6512, emissiveIntensity: .45, flatShading: true}));
    mats.set('ore-glow', new THREE.MeshBasicMaterial({map: (contactShadowMaterial(), blobTexture), color: 0xd8902a, transparent: true, opacity: .22, depthWrite: false, blending: THREE.AdditiveBlending}));
  }
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 6.5), mats.get('ore-glow'));
  glow.rotation.x = -Math.PI / 2; glow.position.y = .02; group.add(glow);
  const chunks = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1), mats.get('ore'), 16);
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
    const compact = this.compact = window.matchMedia('(max-width: 700px)').matches;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);
    this.productionQueues = new ProductionQueues(container, onCancelTraining, onEjectGarrisoned);
    this.scene.add(new THREE.HemisphereLight(0xd6e2f0, 0x5b4a2e, 1.7));
    const sun = new THREE.DirectionalLight(0xffdfa6, 3.5); sun.position.set(-30, 65, 25); sun.castShadow = true;
    sun.shadow.mapSize.set(compact ? 1024 : 2048, compact ? 1024 : 2048); Object.assign(sun.shadow.camera, {left:-60,right:60,top:70,bottom:-70,near:1,far:160}); sun.shadow.bias = -0.0005; sun.shadow.normalBias = .03; this.scene.add(sun);
    addEnvironment(this.scene, compact);
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
        this.scene.add(group); entity = {group, selection, hp, hitTarget, cargo, kind: item.kind, isUnit, selectable: false, recoilUntil: 0, emission: 0,
          placed: false, speed: 0, gait: 0, dust: 0, heading: undefined, aimYaw: 0, aimUntil: 0}; this.entities.set(key, entity);
      }
      if (entity.cargo) {
        entity.cargo.visible = item.cargo > 0;
        entity.cargo.scale.y = item.cargo / 100;
      }
      if (isUnit) animateUnit(entity, item, dt, now, this.combatEffects, this.compact);
      entity.group.position.set(item.x, 0, item.z);
      entity.group.visible = item.state !== 'garrison';
      if (item.kind === 'emplacement') {
        const model = entity.group.children[0];
        model.rotation.y = item.facing;
        model.scale.y = .25 + .75 * (1 - item.construction_remaining / 8);
        entity.hp.position.y = 3;
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
        entity.aimYaw = Math.atan2(shot.x - shot.target_x, shot.z - shot.target_z);
        entity.aimUntil = now + (shot.kind === 'tank' ? 2600 : 1400);
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

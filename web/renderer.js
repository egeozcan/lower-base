import * as THREE from './three.module.js';
import { CombatEffects } from './combat-effects.js';
import { ProductionQueues } from './production-queues.js';
import { CollectorCargo, POUR_START } from './collector-cargo.js';
import { ModelDamage, condition, sootVariant } from './damage.js';
import { GROUND_Y, ROAD_Y, APRON_Y } from './terrain-damage.js';

// The battlefield is deliberately made from simple, lit geometry so it remains
// readable when dozens of units are moving at once.
const C = {
  player: 0x3267c8, playerDark: 0x234584, enemy: 0xc63227, enemyDark: 0x80271e,
  metal: 0x263743, dark: 0x222d36, light: 0x829ba2, ground: 0x172a32,
};
const mats = new Map();
const finishes = new Map();
function mat(color, emissive = 0, intensity = 0, roughness = 0.88, metalness = 0.12, finish = null) {
  const key = `${color}:${emissive}:${intensity}:${roughness}:${metalness}:${finish || ''}`;
  if (!mats.has(key)) {
    const opts = { color, roughness, metalness, emissive, emissiveIntensity: intensity };
    if (finish) Object.assign(opts, finishMaps(finish));
    mats.set(key, new THREE.MeshStandardMaterial(opts));
  }
  return mats.get(key);
}
// Damaged models swap each material for one shared variant that shows soot.
function sooted(material) {
  if (!mats.has(material)) mats.set(material, sootVariant(material));
  return mats.get(material);
}
function scaleBoxUVs(geometry, w, h, d, uvScale) {
  const pos = geometry.attributes.position.array;
  const norm = geometry.attributes.normal.array;
  const uv = geometry.attributes.uv.array;
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
    const nx = Math.abs(norm[i]), ny = Math.abs(norm[i + 1]), nz = Math.abs(norm[i + 2]);
    const x = pos[i] + w * .5, y = pos[i + 1] + h * .5, z = pos[i + 2] + d * .5;
    if (ny >= nx && ny >= nz) { uv[j] = x * uvScale; uv[j + 1] = z * uvScale; }
    else if (nx >= nz) { uv[j] = z * uvScale; uv[j + 1] = y * uvScale; }
    else { uv[j] = x * uvScale; uv[j + 1] = y * uvScale; }
  }
  geometry.attributes.uv.needsUpdate = true;
}
function box(parent, w, h, d, x, y, z, material, angle = 0, uvScale = 0) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  if (uvScale > 0) scaleBoxUVs(geometry, w, h, d, uvScale);
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z); m.rotation.y = angle; m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function scaleCylinderUVs(geometry, r1, r2, h, uvScale) {
  const pos = geometry.attributes.position;
  const norm = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  if (!uv || !pos || !norm) return;
  // Quantize circumference UVs to an integer so periodic textures wrap seamlessly.
  const su = Math.max(1, Math.round((r1 + r2) * 1.25 * uvScale));
  const sv = Math.max(.25, h * uvScale);
  for (let i = 0; i < uv.count; i++) {
    if (Math.abs(norm.getY(i)) > .7) {
      uv.setXY(i, pos.getX(i) * uvScale, pos.getZ(i) * uvScale);
    } else {
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
  }
  uv.needsUpdate = true;
  geometry.userData.hasUV = true;
}
function cylinder(parent, r1, r2, h, x, y, z, material, segments = 8, uvScale = .48) {
  const geometry = new THREE.CylinderGeometry(r1, r2, h, segments);
  scaleCylinderUVs(geometry, r1, r2, h, uvScale);
  const m = new THREE.Mesh(geometry, material);
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
function configureTexture(canvas, options = {}) {
  const {
    colorSpace = THREE.SRGBColorSpace,
    wrapS = THREE.ClampToEdgeWrapping,
    wrapT = THREE.ClampToEdgeWrapping,
    repeat = null,
    anisotropy = 8,
  } = options;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.wrapS = wrapS;
  texture.wrapT = wrapT;
  if (repeat) texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = anisotropy;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}
function paintedTexture(width, height, paint, options = {}) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  return configureTexture(canvas, options);
}
// Paint synchronized color, bump, and roughness canvases in one pass so seams,
// cracks, rivets, and wear align pixel-for-pixel across maps.
function layeredMaps(width, height, paint, options = {}) {
  const make = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return { canvas, ctx: canvas.getContext('2d') };
  };
  const color = make(), bump = make();
  const rough = options.roughness ? make() : null;
  paint({ c: color.ctx, b: bump.ctx, r: rough?.ctx || null }, width, height);
  const { bumpScale = .04, ...texOpts } = options;
  const dataOpts = { ...texOpts, colorSpace: THREE.NoColorSpace };
  const result = {
    map: configureTexture(color.canvas, { ...texOpts, colorSpace: THREE.SRGBColorSpace }),
    bumpMap: configureTexture(bump.canvas, dataOpts),
    bumpScale,
  };
  if (rough) result.roughnessMap = configureTexture(rough.canvas, dataOpts);
  return result;
}
function strokeBox(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h);
  ctx.closePath(); ctx.stroke();
}
function wrapDraw(w, h, x, y, margin, fn) {
  const xs = [0], ys = [0];
  if (x < margin) xs.push(w);
  if (x > w - margin) xs.push(-w);
  if (y < margin) ys.push(h);
  if (y > h - margin) ys.push(-h);
  for (const ox of xs) for (const oy of ys) fn(x + ox, y + oy);
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
function drawRivet(c, b, x, y, r = 2) {
  c.fillStyle = 'rgba(42,46,42,.55)';
  c.beginPath(); c.arc(x + .6, y + .6, r * 1.15, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(246,248,244,.85)';
  c.beginPath(); c.arc(x, y, r * .85, 0, Math.PI * 2); c.fill();
  b.fillStyle = '#404040';
  b.beginPath(); b.arc(x, y, r * 1.25, 0, Math.PI * 2); b.fill();
  b.fillStyle = '#f5f5f5';
  b.beginPath(); b.arc(x, y, r * .85, 0, Math.PI * 2); b.fill();
}
function finishMaps(kind) {
  if (finishes.has(kind)) return finishes.get(kind);
  const tile = { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping };
  let maps;
  if (kind === 'armor') {
    maps = layeredMaps(512, 512, ({ c, b, r }, w, h) => {
      const random = seeded(401);
      c.fillStyle = '#efefef'; c.fillRect(0, 0, w, h);
      b.fillStyle = '#8a8a8a'; b.fillRect(0, 0, w, h);
      r.fillStyle = '#dcdcdc'; r.fillRect(0, 0, w, h);
      // Staggered military armor plate panels with subtle batch tone shifts.
      const rows = 4, rowH = h / rows;
      for (let row = 0; row < rows; row++) {
        const cols = row % 2 === 0 ? 2 : 3, colW = w / cols, shift = row % 2 ? colW * .35 : 0;
        for (let col = -1; col <= cols; col++) {
          const px = col * colW + shift, py = row * rowH;
          const tone = 224 + Math.floor(random() * 26);
          c.fillStyle = `rgb(${tone},${tone},${tone - 2})`;
          c.fillRect(px + 2, py + 2, colW - 4, rowH - 4);
          const bTone = 132 + Math.floor(random() * 14);
          b.fillStyle = `rgb(${bTone},${bTone},${bTone})`;
          b.fillRect(px + 2, py + 2, colW - 4, rowH - 4);
          const rTone = 192 + Math.floor(random() * 52);
          r.fillStyle = `rgb(${rTone},${rTone},${rTone})`;
          r.fillRect(px + 2, py + 2, colW - 4, rowH - 4);
          // Bevel highlight along top & left panel edges, seam groove around borders.
          c.strokeStyle = 'rgba(255,255,255,.36)'; c.lineWidth = 2;
          c.beginPath(); c.moveTo(px + 3, py + rowH - 4); c.lineTo(px + 3, py + 3); c.lineTo(px + colW - 4, py + 3); c.stroke();
          b.strokeStyle = '#d4d4d4'; b.lineWidth = 2;
          b.beginPath(); b.moveTo(px + 3, py + rowH - 4); b.lineTo(px + 3, py + 3); b.lineTo(px + colW - 4, py + 3); b.stroke();
          r.strokeStyle = '#929292'; r.lineWidth = 2;
          r.beginPath(); r.moveTo(px + 3, py + rowH - 4); r.lineTo(px + 3, py + 3); r.lineTo(px + colW - 4, py + 3); r.stroke();
          c.strokeStyle = 'rgba(84,88,82,.78)'; c.lineWidth = 3;
          strokeBox(c, px, py, colW, rowH);
          b.strokeStyle = '#202020'; b.lineWidth = 3.5;
          strokeBox(b, px, py, colW, rowH);
          r.strokeStyle = '#f2f2f2'; r.lineWidth = 3;
          strokeBox(r, px, py, colW, rowH);
          // Corner and seam rivets.
          for (const rx of [px + 11, px + colW * .5, px + colW - 11]) {
            for (const ry of [py + 11, py + rowH - 11]) drawRivet(c, b, rx, ry, 2.3);
          }
        }
      }
      // Vertical rain-grime streaks and rolled-steel micro-grain.
      for (let i = 0; i < 140; i++) {
        const x = random() * w, y = random() * h, len = 18 + random() * 68;
        const alpha = .03 + random() * .07;
        wrapDraw(w, h, x, y, len, (wx, wy) => {
          const g = c.createLinearGradient(wx, wy, wx, wy + len);
          g.addColorStop(0, `rgba(72,74,68,${alpha})`); g.addColorStop(1, 'rgba(72,74,68,0)');
          c.fillStyle = g; c.fillRect(wx, wy, 2 + random() * 4, len);
        });
      }
      // Exposed metallic edge scratches with low roughness glint.
      for (let i = 0; i < 85; i++) {
        const x = random() * w, y = random() * h, dx = (random() - .5) * 30, dy = (random() - .5) * 20;
        wrapDraw(w, h, x, y, 34, (wx, wy) => {
          c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 1.3;
          c.beginPath(); c.moveTo(wx, wy); c.lineTo(wx + dx, wy + dy); c.stroke();
          b.strokeStyle = '#424242'; b.lineWidth = 1.3;
          b.beginPath(); b.moveTo(wx, wy); b.lineTo(wx + dx, wy + dy); b.stroke();
          r.strokeStyle = '#5c5c5c'; r.lineWidth = 1.8;
          r.beginPath(); r.moveTo(wx, wy); r.lineTo(wx + dx, wy + dy); r.stroke();
        });
      }
      speckle(c, w, h, 8500, random, 'rgba(255,255,255,.08)', 'rgba(55,58,52,.1)', 1.5);
      speckle(b, w, h, 7000, random, 'rgba(210,210,210,.16)', 'rgba(65,65,65,.16)', 1.5);
    }, { ...tile, roughness: true, bumpScale: .052 });
  } else if (kind === 'steel') {
    maps = layeredMaps(256, 256, ({ c, b, r }, w, h) => {
      const random = seeded(503);
      c.fillStyle = '#eceeed'; c.fillRect(0, 0, w, h);
      b.fillStyle = '#848484'; b.fillRect(0, 0, w, h);
      r.fillStyle = '#b4b4b4'; r.fillRect(0, 0, w, h);
      // Directional brushed machining grain.
      for (let i = 0; i < 900; i++) {
        const y = random() * h, x = random() * w, len = 14 + random() * 64;
        const bright = random() < .5;
        wrapDraw(w, h, x, y, len, (wx, wy) => {
          c.fillStyle = bright ? 'rgba(255,255,255,.12)' : 'rgba(95,100,104,.12)';
          c.fillRect(wx, wy, len, 1);
          b.fillStyle = bright ? 'rgba(185,185,185,.2)' : 'rgba(72,72,72,.2)';
          b.fillRect(wx, wy, len, 1);
          r.fillStyle = bright ? 'rgba(128,128,128,.22)' : 'rgba(210,210,210,.18)';
          r.fillRect(wx, wy, len, 1);
        });
      }
      // Machined seam bands and micro-oil smudges.
      for (const sy of [64, 192]) {
        c.fillStyle = 'rgba(76,82,86,.45)'; c.fillRect(0, sy - 1, w, 2);
        b.fillStyle = '#262626'; b.fillRect(0, sy - 1, w, 2);
        for (let rx = 16; rx < w; rx += 32) drawRivet(c, b, rx, sy - 8, 1.8);
      }
      for (let i = 0; i < 12; i++) {
        const x = random() * w, y = random() * h, rad = 14 + random() * 24;
        wrapDraw(w, h, x, y, rad, (wx, wy) => {
          blotch(c, wx, wy, rad, '90,94,96', .14);
          blotch(r, wx, wy, rad, '105,105,105', .28);
        });
      }
    }, { ...tile, roughness: true, bumpScale: .035 });
  } else if (kind === 'dark' || kind === 'tread') {
    const isTread = kind === 'tread';
    maps = layeredMaps(256, 256, ({ c, b, r }, w, h) => {
      const random = seeded(isTread ? 617 : 619);
      c.fillStyle = '#dedede'; c.fillRect(0, 0, w, h);
      b.fillStyle = '#6e6e6e'; b.fillRect(0, 0, w, h);
      r.fillStyle = '#d4d4d4'; r.fillRect(0, 0, w, h);
      if (isTread) {
        // Heavy vehicle track lugs and vulcanized chevron cleats.
        const step = 32;
        for (let y = 0; y < h; y += step) {
          c.fillStyle = '#a4a7a4'; c.fillRect(0, y, w, 9);
          c.fillStyle = '#f2f4f2'; c.fillRect(0, y + 11, w, 12);
          b.fillStyle = '#242424'; b.fillRect(0, y, w, 9);
          b.fillStyle = '#e6e6e6'; b.fillRect(0, y + 11, w, 12);
          r.fillStyle = '#9e9e9e'; r.fillRect(0, y + 11, w, 12);
          for (let x = 0; x < w; x += 32) {
            c.fillStyle = '#8b8e8b'; c.fillRect(x + 12, y + 11, 5, 12);
            b.fillStyle = '#383838'; b.fillRect(x + 12, y + 11, 5, 12);
          }
        }
      } else {
        // Cast-iron housings, louvers, and maintenance hatches.
        for (let y = 16; y < h; y += 64) {
          for (let x = 16; x < w; x += 64) {
            c.strokeStyle = 'rgba(72,76,78,.65)'; c.lineWidth = 2; strokeBox(c, x - 12, y - 12, 56, 56);
            b.strokeStyle = '#242424'; b.lineWidth = 2.5; strokeBox(b, x - 12, y - 12, 56, 56);
          }
        }
        for (let y = 32; y < h; y += 128) for (let i = 0; i < 4; i++) {
          c.fillStyle = 'rgba(55,60,64,.65)'; c.fillRect(28, y + i * 10, w - 56, 5);
          b.fillStyle = '#1e1e1e'; b.fillRect(28, y + i * 10, w - 56, 5);
        }
      }
      speckle(c, w, h, 3500, random, 'rgba(255,255,255,.1)', 'rgba(40,42,40,.14)', 1.5);
      speckle(b, w, h, 3500, random, 'rgba(205,205,205,.18)', 'rgba(45,45,45,.18)', 1.5);
    }, { ...tile, roughness: true, bumpScale: isTread ? .065 : .045 });
  } else if (kind === 'trim') {
    maps = layeredMaps(512, 512, ({ c, b, r }, w, h) => {
      const random = seeded(709);
      c.fillStyle = '#ebebeb'; c.fillRect(0, 0, w, h);
      b.fillStyle = '#8c8c8c'; b.fillRect(0, 0, w, h);
      r.fillStyle = '#d8d8d8'; r.fillRect(0, 0, w, h);
      // Painted military trim plates with seams, rivets, grime streaks, and chipped edges.
      for (let py = 0; py < h; py += 128) for (let px = 0; px < w; px += 256) {
        const tone = 228 + Math.floor(random() * 20);
        c.fillStyle = `rgb(${tone},${tone},${tone})`; c.fillRect(px + 2, py + 2, 252, 124);
        c.strokeStyle = 'rgba(72,76,82,.72)'; c.lineWidth = 2.5; strokeBox(c, px, py, 256, 128);
        b.strokeStyle = '#242424'; b.lineWidth = 3; strokeBox(b, px, py, 256, 128);
        r.strokeStyle = '#efefef'; r.lineWidth = 3; strokeBox(r, px, py, 256, 128);
        for (const rx of [px + 12, px + 128, px + 244]) {
          for (const ry of [py + 12, py + 116]) drawRivet(c, b, rx, ry, 2.0);
        }
      }
      for (let i = 0; i < 90; i++) {
        const x = random() * w, y = random() * h, len = 14 + random() * 44;
        wrapDraw(w, h, x, y, len, (wx, wy) => {
          const g = c.createLinearGradient(wx, wy, wx, wy + len);
          g.addColorStop(0, `rgba(48,50,48,${.06 + random() * .09})`); g.addColorStop(1, 'rgba(48,50,48,0)');
          c.fillStyle = g; c.fillRect(wx, wy, 2 + random() * 3, len);
        });
      }
      for (let i = 0; i < 75; i++) {
        const x = random() * w, y = random() * h, dx = (random() - .5) * 26, dy = (random() - .5) * 16;
        wrapDraw(w, h, x, y, 28, (wx, wy) => {
          c.strokeStyle = 'rgba(255,255,255,.42)'; c.lineWidth = 1.2;
          c.beginPath(); c.moveTo(wx, wy); c.lineTo(wx + dx, wy + dy); c.stroke();
          b.strokeStyle = '#484848'; b.lineWidth = 1.2;
          b.beginPath(); b.moveTo(wx, wy); b.lineTo(wx + dx, wy + dy); b.stroke();
          r.strokeStyle = '#626262'; r.lineWidth = 1.5;
          r.beginPath(); r.moveTo(wx, wy); r.lineTo(wx + dx, wy + dy); r.stroke();
        });
      }
      speckle(c, w, h, 6500, random, 'rgba(255,255,255,.09)', 'rgba(65,68,70,.12)', 1.5);
      speckle(b, w, h, 5000, random, 'rgba(185,185,185,.16)', 'rgba(75,75,75,.16)', 1.5);
    }, { ...tile, roughness: true, bumpScale: .04 });
  } else if (kind === 'hazard') {
    maps = layeredMaps(256, 256, ({ c, b, r }, w, h) => {
      const random = seeded(811);
      // Paint bright white + dark charcoal so multiplying by caution yellow stays saturated.
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
      b.fillStyle = '#9c9c9c'; b.fillRect(0, 0, w, h);
      r.fillStyle = '#bcbcbc'; r.fillRect(0, 0, w, h);
      const period = 128;
      for (let k = -h; k <= w + h; k += period) {
        c.fillStyle = '#23211d';
        c.beginPath();
        c.moveTo(k, 0); c.lineTo(k + 58, 0); c.lineTo(k + 58 - h, h); c.lineTo(k - h, h);
        c.closePath(); c.fill();
        b.fillStyle = '#707070';
        b.beginPath();
        b.moveTo(k, 0); b.lineTo(k + 58, 0); b.lineTo(k + 58 - h, h); b.lineTo(k - h, h);
        b.closePath(); b.fill();
        r.fillStyle = '#e0e0e0';
        r.beginPath();
        r.moveTo(k, 0); r.lineTo(k + 58, 0); r.lineTo(k + 58 - h, h); r.lineTo(k - h, h);
        r.closePath(); r.fill();
      }
      // Paint-chipped edge wear and industrial grime.
      for (let i = 0; i < 120; i++) {
        const x = random() * w, y = random() * h, sz = 1.5 + random() * 3.5;
        wrapDraw(w, h, x, y, 5, (wx, wy) => {
          c.fillStyle = random() < .4 ? 'rgba(255,255,255,.35)' : 'rgba(55,50,42,.38)';
          c.fillRect(wx, wy, sz, sz * .7);
          b.fillStyle = 'rgba(60,60,60,.45)';
          b.fillRect(wx, wy, sz, sz * .7);
        });
      }
    }, { ...tile, roughness: true, bumpScale: .035 });
  } else if (kind === 'glass') {
    maps = layeredMaps(128, 128, ({ c, b }, w, h) => {
      const grad = c.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(.45, '#b8c8d2'); grad.addColorStop(.52, '#f5fbff'); grad.addColorStop(1, '#9ab0be');
      c.fillStyle = grad; c.fillRect(0, 0, w, h);
      b.fillStyle = '#909090'; b.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(30,40,46,.7)'; c.lineWidth = 4; strokeBox(c, 2, 2, w - 4, h - 4);
      b.strokeStyle = '#303030'; b.lineWidth = 4; strokeBox(b, 2, 2, w - 4, h - 4);
    }, { ...tile, bumpScale: .02 });
  } else if (kind === 'rust') {
    maps = layeredMaps(256, 256, ({ c, b }, w, h) => {
      const random = seeded(919);
      c.fillStyle = '#dcd4cc'; c.fillRect(0, 0, w, h);
      b.fillStyle = '#808080'; b.fillRect(0, 0, w, h);
      for (let i = 0; i < 45; i++) {
        const x = random() * w, y = random() * h, rad = 10 + random() * 24;
        wrapDraw(w, h, x, y, rad, (wx, wy) => {
          blotch(c, wx, wy, rad, random() < .5 ? '110,76,52' : '240,196,158', .32);
          blotch(b, wx, wy, rad, random() < .5 ? '50,50,50' : '215,215,215', .35);
        });
      }
      speckle(c, w, h, 4000, random, 'rgba(255,214,170,.25)', 'rgba(65,40,28,.3)', 1.5);
      speckle(b, w, h, 4000, random, 'rgba(220,220,220,.3)', 'rgba(35,35,35,.35)', 1.5);
    }, { ...tile, bumpScale: .06 });
  } else if (kind === 'concrete') {
    maps = layeredMaps(256, 256, ({ c, b }, w, h) => {
      const random = seeded(1021);
      c.fillStyle = '#ebebea'; c.fillRect(0, 0, w, h);
      b.fillStyle = '#888888'; b.fillRect(0, 0, w, h);
      for (let i = 0; i < 36; i++) {
        const x = random() * w, y = random() * h, rad = 14 + random() * 32;
        wrapDraw(w, h, x, y, rad, (wx, wy) => blotch(c, wx, wy, rad, '135,132,120', .14));
      }
      // Formwork panel joints and tie-rod recesses.
      for (const sx of [0, 128]) {
        c.strokeStyle = 'rgba(110,108,98,.55)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(sx, 0); c.lineTo(sx, h); c.stroke();
        b.strokeStyle = '#383838'; b.lineWidth = 2;
        b.beginPath(); b.moveTo(sx, 0); b.lineTo(sx, h); b.stroke();
        for (const ty of [48, 208]) {
          c.fillStyle = 'rgba(92,90,82,.7)'; c.beginPath(); c.arc(sx + 64, ty, 3, 0, Math.PI * 2); c.fill();
          b.fillStyle = '#202020'; b.beginPath(); b.arc(sx + 64, ty, 3.5, 0, Math.PI * 2); b.fill();
        }
      }
      speckle(c, w, h, 4200, random, 'rgba(255,255,255,.15)', 'rgba(85,82,74,.16)', 1.5);
      speckle(b, w, h, 4200, random, 'rgba(195,195,195,.2)', 'rgba(65,65,65,.2)', 1.5);
    }, { ...tile, bumpScale: .045 });
  } else if (kind === 'bark') {
    maps = layeredMaps(256, 256, ({ c, b }, w, h) => {
      const random = seeded(1151);
      c.fillStyle = '#c8bfb2'; c.fillRect(0, 0, w, h);
      b.fillStyle = '#848484'; b.fillRect(0, 0, w, h);
      for (let i = 0; i < 180; i++) {
        const x = random() * w, y = random() * h, len = 24 + random() * 60, bw = 2 + random() * 5;
        const dark = random() < .52;
        wrapDraw(w, h, x, y, len, (wx, wy) => {
          c.fillStyle = dark ? 'rgba(62,48,36,.42)' : 'rgba(235,222,204,.32)';
          c.fillRect(wx, wy, bw, len);
          b.fillStyle = dark ? 'rgba(28,28,28,.55)' : 'rgba(225,225,225,.42)';
          b.fillRect(wx, wy, bw, len);
        });
      }
      speckle(b, w, h, 2800, random, 'rgba(200,200,200,.2)', 'rgba(40,40,40,.2)', 1.5);
    }, { ...tile, bumpScale: .08 });
  } else if (kind === 'foliage') {
    maps = layeredMaps(256, 256, ({ c, b }, w, h) => {
      const random = seeded(1237);
      c.fillStyle = '#c8d1b8'; c.fillRect(0, 0, w, h);
      b.fillStyle = '#707070'; b.fillRect(0, 0, w, h);
      for (let i = 0; i < 680; i++) {
        const x = random() * w, y = random() * h, ang = random() * Math.PI * 2, len = 8 + random() * 14;
        const bright = random() < .46;
        wrapDraw(w, h, x, y, 18, (wx, wy) => {
          c.strokeStyle = bright ? 'rgba(255,255,240,.52)' : 'rgba(38,54,28,.58)';
          c.lineWidth = 2.5 + random() * 2.5;
          c.beginPath(); c.moveTo(wx, wy); c.lineTo(wx + Math.cos(ang) * len, wy + Math.sin(ang) * len); c.stroke();
          b.strokeStyle = bright ? 'rgba(242,242,242,.55)' : 'rgba(32,32,32,.55)';
          b.lineWidth = 2.5 + random() * 2.5;
          b.beginPath(); b.moveTo(wx, wy); b.lineTo(wx + Math.cos(ang) * len, wy + Math.sin(ang) * len); b.stroke();
        });
      }
    }, { ...tile, bumpScale: .085 });
  } else if (kind === 'stone') {
    maps = layeredMaps(256, 256, ({ c, b }, w, h) => {
      const random = seeded(1303);
      c.fillStyle = '#e0dfd8'; c.fillRect(0, 0, w, h);
      b.fillStyle = '#848484'; b.fillRect(0, 0, w, h);
      for (let i = 0; i < 50; i++) {
        const x = random() * w, y = random() * h, rad = 12 + random() * 28;
        wrapDraw(w, h, x, y, rad, (wx, wy) => {
          blotch(c, wx, wy, rad, random() < .5 ? '118,120,112' : '250,248,240', .28);
          blotch(b, wx, wy, rad, random() < .5 ? '58,58,58' : '212,212,212', .32);
        });
      }
      for (let i = 0; i < 16; i++) {
        let x = random() * w, y = random() * h;
        const pts = [[x, y]];
        for (let s = 0; s < 5; s++) { x += (random() - .5) * 24; y += (random() - .5) * 24; pts.push([x, y]); }
        wrapDraw(w, h, pts[0][0], pts[0][1], 64, (ox, oy) => {
          const dx = ox - pts[0][0], dy = oy - pts[0][1];
          c.strokeStyle = 'rgba(78,76,70,.55)'; c.lineWidth = 1.5;
          b.strokeStyle = '#252525'; b.lineWidth = 2;
          for (const ctx of [c, b]) {
            ctx.beginPath(); ctx.moveTo(pts[0][0] + dx, pts[0][1] + dy);
            for (let p = 1; p < pts.length; p++) ctx.lineTo(pts[p][0] + dx, pts[p][1] + dy);
            ctx.stroke();
          }
        });
      }
      speckle(c, w, h, 3000, random, 'rgba(255,255,255,.16)', 'rgba(65,65,60,.16)', 1.5);
    }, { ...tile, bumpScale: .07 });
  } else if (kind === 'ore') {
    maps = layeredMaps(256, 256, ({ c, b, r }, w, h) => {
      const random = seeded(1429);
      c.fillStyle = '#efe2b6'; c.fillRect(0, 0, w, h);
      b.fillStyle = '#9a9a9a'; b.fillRect(0, 0, w, h);
      r.fillStyle = '#888888'; r.fillRect(0, 0, w, h);
      // Crystalline mineral veins and bright amber facets.
      for (let i = 0; i < 42; i++) {
        const x = random() * w, y = random() * h, rad = 10 + random() * 24;
        const bright = random() < .55;
        wrapDraw(w, h, x, y, rad, (wx, wy) => {
          blotch(c, wx, wy, rad, bright ? '255,252,224' : '116,84,32', bright ? .42 : .35);
          blotch(b, wx, wy, rad, bright ? '235,235,235' : '45,45,45', .42);
          blotch(r, wx, wy, rad, bright ? '64,64,64' : '215,215,215', .4);
        });
      }
      for (let i = 0; i < 24; i++) {
        let x = random() * w, y = random() * h;
        const light = i % 2 === 0;
        c.strokeStyle = light ? 'rgba(255,252,220,.72)' : 'rgba(84,58,20,.65)'; c.lineWidth = 2;
        b.strokeStyle = light ? '#eeeeee' : '#262626'; b.lineWidth = 2.2;
        r.strokeStyle = light ? '#484848' : '#d8d8d8'; r.lineWidth = 2.2;
        for (const ctx of [c, b, r]) { ctx.beginPath(); ctx.moveTo(x, y); }
        for (let s = 0; s < 4; s++) {
          x += (random() - .5) * 32; y += (random() - .5) * 32;
          c.lineTo(x, y); b.lineTo(x, y); r.lineTo(x, y);
        }
        c.stroke(); b.stroke(); r.stroke();
      }
      speckle(r, w, h, 2200, random, 'rgba(60,60,60,.4)', 'rgba(220,220,220,.3)', 2);
    }, { ...tile, roughness: true, bumpScale: .055 });
  } else if (kind === 'cloth' || kind === 'wood') {
    const isWood = kind === 'wood';
    maps = layeredMaps(128, 128, ({ c, b }, w, h) => {
      const random = seeded(isWood ? 1511 : 1513);
      c.fillStyle = '#f2efe8'; c.fillRect(0, 0, w, h);
      b.fillStyle = '#848484'; b.fillRect(0, 0, w, h);
      if (isWood) {
        for (let i = 0; i < 140; i++) {
          const y = random() * h, x = random() * w, len = 24 + random() * 64;
          c.fillStyle = random() < .5 ? 'rgba(130,90,52,.22)' : 'rgba(255,244,225,.2)';
          c.fillRect(x, y, len, 2);
          b.fillStyle = random() < .5 ? 'rgba(60,60,60,.28)' : 'rgba(190,190,190,.28)';
          b.fillRect(x, y, len, 2);
        }
      } else {
        for (let p = 0; p < w; p += 6) {
          c.fillStyle = 'rgba(180,174,162,.25)'; c.fillRect(p, 0, 2, h); c.fillRect(0, p, w, 2);
          b.fillStyle = 'rgba(195,195,195,.3)'; b.fillRect(p, 0, 2, h); b.fillRect(0, p, w, 2);
        }
      }
      speckle(b, w, h, 900, random, 'rgba(200,200,200,.15)', 'rgba(65,65,65,.15)');
    }, { ...tile, bumpScale: isWood ? .04 : .03 });
  } else if (kind === 'roadLine') {
    maps = layeredMaps(128, 256, ({ c, b }, w, h) => {
      const random = seeded(1601);
      c.fillStyle = '#f2eee2'; c.fillRect(0, 0, w, h);
      b.fillStyle = '#989898'; b.fillRect(0, 0, w, h);
      // Chipped thermoplastic paint and dark asphalt bleed-through.
      for (let i = 0; i < 80; i++) {
        const x = random() * w, y = random() * h, sz = 3 + random() * 8;
        c.fillStyle = `rgba(92,90,82,${.18 + random() * .35})`;
        c.fillRect(x, y, sz, sz * 1.4);
        b.fillStyle = 'rgba(48,48,48,.5)';
        b.fillRect(x, y, sz, sz * 1.4);
      }
      speckle(c, w, h, 1400, random, 'rgba(255,255,255,.2)', 'rgba(80,78,72,.28)', 1.5);
    }, { ...tile, bumpScale: .028 });
  }
  finishes.set(kind, maps);
  return maps;
}
function groundDetailMaps() {
  return layeredMaps(512, 512, ({ c, b, r }, w, h) => {
    const random = seeded(1979);
    c.fillStyle = '#e5e5e5'; c.fillRect(0, 0, w, h);
    b.fillStyle = '#808080'; b.fillRect(0, 0, w, h);
    r.fillStyle = '#e4e4e4'; r.fillRect(0, 0, w, h);
    // Tiling turf blades, earth clods, and tiny pebbles for crisp close-up zoom.
    for (let i = 0; i < 650; i++) {
      const x = random() * w, y = random() * h, ang = random() * Math.PI * 2, len = 4 + random() * 10;
      const bright = random() < .5;
      wrapDraw(w, h, x, y, 14, (wx, wy) => {
        b.strokeStyle = bright ? 'rgba(220,220,220,.42)' : 'rgba(42,42,42,.38)';
        b.lineWidth = 1.5 + random() * 1.5;
        b.beginPath(); b.moveTo(wx, wy); b.lineTo(wx + Math.cos(ang) * len, wy + Math.sin(ang) * len); b.stroke();
        r.strokeStyle = bright ? 'rgba(205,205,205,.32)' : 'rgba(245,245,245,.32)';
        r.lineWidth = 1.8;
        r.beginPath(); r.moveTo(wx, wy); r.lineTo(wx + Math.cos(ang) * len, wy + Math.sin(ang) * len); r.stroke();
      });
    }
    for (let i = 0; i < 240; i++) {
      const x = random() * w, y = random() * h, rad = 1.2 + random() * 2.4;
      wrapDraw(w, h, x, y, 6, (wx, wy) => {
        b.fillStyle = 'rgba(235,235,235,.55)'; b.beginPath(); b.arc(wx, wy, rad, 0, Math.PI * 2); b.fill();
        b.fillStyle = 'rgba(40,40,40,.45)'; b.beginPath(); b.arc(wx + 1, wy + 1, rad, 0, Math.PI * 2); b.fill();
      });
    }
    speckle(b, w, h, 8000, random, 'rgba(195,195,195,.22)', 'rgba(65,65,65,.22)', 1.5);
  }, {
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    repeat: [16, 24],
    roughness: true,
    bumpScale: .18,
  });
}
function groundTexture(scale) {
  // Canvas x follows world x and canvas y follows world z across the 100×150 field.
  return paintedTexture(100 * scale, 150 * scale, (ctx, w, h) => {
    const random = seeded(1941), px = x => (x + 50) * scale, pz = z => (z + 75) * scale;
    ctx.fillStyle = '#5e6638'; ctx.fillRect(0, 0, w, h);
    const tones = ['118,125,68', '82,95,48', '134,129,76', '94,88,54', '68,84,42'];
    for (let i = 0; i < 950; i++) blotch(ctx, random() * w, random() * h, (2.2 + random() * 7.5) * scale, tones[i % tones.length], .16 + random() * .2);
    // Shaded woodland moss and loam under the outer forest flanks.
    for (let i = 0; i < 360; i++) {
      const side = random() < .5 ? -1 : 1;
      blotch(ctx, px(side * (20 + random() * 29)), random() * h, (3 + random() * 6) * scale, random() < .6 ? '54,68,36' : '78,72,46', .24 + random() * .2);
    }
    // Worn earth staging around both bases and gravel footings under perimeter blast walls.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 110; i++) blotch(ctx, px((random() - .5) * 44), pz(side * (41 + (random() - .5) * 28)), (1.8 + random() * 4.2) * scale, '116,99,66', .22);
    }
    for (let z = -34; z <= 34; z += 1.5) for (const side of [-1, 1]) {
      blotch(ctx, px(side * (18.8 + (random() - .5) * 1.4)), pz(z), (.9 + random() * 1.1) * scale, '112,102,76', .28);
    }
    // Graded crushed-gravel road verges and drainage rills.
    for (let z = -56; z <= 56; z += .9) for (const side of [-1, 1]) {
      blotch(ctx, px(side * (4.9 + random() * 1.7)), pz(z), (1.0 + random() * 1.4) * scale, random() < .55 ? '114,102,74' : '92,84,58', .36);
    }
    // Curved dual-track vehicle ruts along mining corridors and midfield.
    ctx.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const corridor = i < 8 ? (i % 2 ? 1 : -1) * (9 + random() * 9) : (random() - .5) * 26;
      const zStart = -36 + random() * 8, zEnd = 28 + random() * 8;
      for (const offset of [-.75, .75]) {
        ctx.strokeStyle = `rgba(68,58,38,${.14 + random() * .1})`;
        ctx.lineWidth = .32 * scale;
        ctx.beginPath(); ctx.moveTo(px(corridor + offset), pz(zStart));
        let tx = corridor, tz = zStart;
        while (tz < zEnd) { tz += 3.5; tx += (random() - .5) * 2.4; ctx.lineTo(px(tx + offset), pz(tz)); }
        ctx.stroke();
      }
    }
    // Fine grass blade strokes and pebble flecks.
    for (let i = 0; i < w * h / 42; i++) {
      const gx = random() * w, gy = random() * h, ang = (random() - .5) * 1.4, len = (.14 + random() * .26) * scale;
      ctx.strokeStyle = random() < .52 ? 'rgba(164,170,104,.25)' : 'rgba(46,56,28,.26)';
      ctx.lineWidth = Math.max(1, scale * .07);
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + Math.sin(ang) * len, gy - Math.cos(ang) * len); ctx.stroke();
    }
    speckle(ctx, w, h, w * h / 24, random, 'rgba(182,174,126,.2)', 'rgba(42,40,26,.22)', 1.2);
  });
}
function asphaltMaps() {
  return layeredMaps(512, 2048, ({ c, b, r }, w, h) => {
    const random = seeded(77);
    c.fillStyle = '#54534d'; c.fillRect(0, 0, w, h);
    b.fillStyle = '#848484'; b.fillRect(0, 0, w, h);
    r.fillStyle = '#dcdcdc'; r.fillRect(0, 0, w, h);
    // Soft organic bitumen mottling wrapped seamlessly in Y (no boxy patches).
    for (let i = 0; i < 120; i++) {
      const x = random() * w, y = random() * h, rad = 32 + random() * 84;
      const shade = random() < .5 ? '42,42,40' : '106,104,96';
      wrapDraw(w, h, x, y, rad, (wx, wy) => blotch(c, wx, wy, rad, shade, .11));
    }
    // Faint longitudinal center paving joint.
    c.fillStyle = 'rgba(34,34,32,.22)'; c.fillRect(w * .5 - 1, 0, 2, h);
    b.fillStyle = '#505050'; b.fillRect(w * .5 - 1, 0, 2, h);
    // Polished dual wheel-track wear lanes in both traffic directions.
    for (const lx of [w * .26, w * .38, w * .62, w * .74]) {
      const grad = c.createLinearGradient(lx - 26, 0, lx + 26, 0);
      grad.addColorStop(0, 'rgba(34,34,32,0)'); grad.addColorStop(.5, 'rgba(34,34,32,.2)'); grad.addColorStop(1, 'rgba(34,34,32,0)');
      c.fillStyle = grad; c.fillRect(lx - 26, 0, 52, h);
      const rGrad = r.createLinearGradient(lx - 24, 0, lx + 24, 0);
      rGrad.addColorStop(0, 'rgba(145,145,145,0)'); rGrad.addColorStop(.5, 'rgba(145,145,145,.52)'); rGrad.addColorStop(1, 'rgba(145,145,145,0)');
      r.fillStyle = rGrad; r.fillRect(lx - 24, 0, 48, h);
    }
    // Crushed mineral aggregate speckle across color, bump, and roughness.
    for (let i = 0; i < 48000; i++) {
      const x = random() * w, y = random() * h, light = random() < .5;
      c.fillStyle = light ? 'rgba(168,166,154,.3)' : 'rgba(28,28,26,.32)'; c.fillRect(x, y, 1.1, 1.1);
      b.fillStyle = light ? 'rgba(205,205,205,.34)' : 'rgba(52,52,52,.34)'; b.fillRect(x, y, 1.1, 1.1);
      if (i % 4 === 0) { r.fillStyle = light ? 'rgba(120,120,120,.24)' : 'rgba(235,235,235,.22)'; r.fillRect(x, y, 1.1, 1.1); }
    }
    // Subtle hairline asphalt fractures starting near edges or center joint.
    for (let i = 0; i < 16; i++) {
      const fromEdge = i % 3 !== 0;
      let x = fromEdge ? (random() < .5 ? 24 + random() * 42 : w - 24 - random() * 42) : w * .5 + (random() - .5) * 32;
      let y = random() * h;
      const dirX = fromEdge ? (x < w * .5 ? 1 : -1) : (random() < .5 ? 1 : -1);
      const pts = [[x, y]];
      const steps = 4 + Math.floor(random() * 4);
      for (let j = 0; j < steps; j++) {
        x += dirX * (5 + random() * 12);
        y += (random() - .4) * 14;
        pts.push([x, y]);
      }
      for (const oy of [0, -h, h]) {
        c.strokeStyle = 'rgba(26,26,24,.32)'; c.lineWidth = 1;
        b.strokeStyle = '#404040'; b.lineWidth = 1.2;
        r.strokeStyle = '#757575'; r.lineWidth = 1.4;
        for (const ctx of [c, b, r]) {
          ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1] + oy);
          for (let p = 1; p < pts.length; p++) ctx.lineTo(pts[p][0], pts[p][1] + oy);
          ctx.stroke();
        }
      }
    }
    // Irregular dusty gravel shoulders softening the asphalt borders.
    const edge = c.createLinearGradient(0, 0, w, 0);
    edge.addColorStop(0, 'rgba(104,95,70,.72)'); edge.addColorStop(.06, 'rgba(84,76,56,.38)');
    edge.addColorStop(.14, 'rgba(48,44,36,0)'); edge.addColorStop(.86, 'rgba(48,44,36,0)');
    edge.addColorStop(.94, 'rgba(84,76,56,.38)'); edge.addColorStop(1, 'rgba(104,95,70,.72)');
    c.fillStyle = edge; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 3200; i++) {
      const side = random() < .5 ? 0 : w - 42;
      const gx = side + random() * 42, gy = random() * h, sz = 1.2 + random() * 2.5;
      c.fillStyle = random() < .5 ? 'rgba(128,116,84,.36)' : 'rgba(72,66,48,.32)';
      c.fillRect(gx, gy, sz, sz);
      b.fillStyle = 'rgba(190,190,190,.28)'; b.fillRect(gx, gy, sz, sz);
    }
  }, { wrapT: THREE.RepeatWrapping, repeat: [1, 3], roughness: true, bumpScale: .06 });
}
function apronMaps(scale) {
  return layeredMaps(37 * scale, 19 * scale, ({ c, b, r }, w, h) => {
    const random = seeded(311);
    c.fillStyle = '#929080'; c.fillRect(0, 0, w, h);
    b.fillStyle = '#8c8c8c'; b.fillRect(0, 0, w, h);
    r.fillStyle = '#e0e0e0'; r.fillRect(0, 0, w, h);
    // Individual poured 3x3 concrete slabs with mix tone variation and broom finish.
    for (let x = -18.5; x < 18.5; x += 3) for (let z = -9.5; z < 9.5; z += 3) {
      const sx = (x + 18.5) * scale, sz = (z + 9.5) * scale, sw = 3 * scale;
      const light = random() < .5;
      c.fillStyle = `rgba(${light ? '168,166,148' : '108,106,94'},${random() * .18})`;
      c.fillRect(sx, sz, sw, sw);
      const bShade = 134 + Math.floor(random() * 14);
      b.fillStyle = `rgb(${bShade},${bShade},${bShade})`;
      b.fillRect(sx + 2, sz + 2, sw - 4, sw - 4);
      // Faint moisture curing band inside each slab edge.
      c.strokeStyle = 'rgba(72,70,60,.18)'; c.lineWidth = Math.max(2, scale * .22);
      strokeBox(c, sx + 1, sz + 1, sw - 2, sw - 2);
    }
    // Broom-finished brush lines across concrete surface.
    for (let i = 0; i < 420; i++) {
      const y = random() * h, x = random() * w, len = (1 + random() * 3) * scale;
      c.fillStyle = random() < .5 ? 'rgba(205,202,186,.1)' : 'rgba(72,70,62,.1)'; c.fillRect(x, y, len, 1);
      b.fillStyle = random() < .5 ? 'rgba(170,170,170,.22)' : 'rgba(105,105,105,.22)'; b.fillRect(x, y, len, 1);
    }
    // Hydraulic oil stains, soot patches, and specular grease puddles.
    for (let i = 0; i < 36; i++) {
      const x = random() * w, y = random() * h, rad = (.4 + random() * 1.5) * scale;
      blotch(c, x, y, rad, '48,46,38', .18 + random() * .22);
      blotch(r, x, y, rad, '108,108,108', .35 + random() * .25);
    }
    // Curved tire & track scuffs near the road entrance.
    c.strokeStyle = 'rgba(42,40,36,.18)'; c.lineWidth = Math.max(1.5, scale * .14);
    for (let i = 0; i < 8; i++) {
      const cx = w * (.38 + random() * .24), cy = random() * h * .45;
      c.beginPath(); c.arc(cx, cy, (2 + random() * 4) * scale, .2, 1.3 + random() * .7); c.stroke();
    }
    // Tight hairline concrete cracks originating near slab seams.
    for (let i = 0; i < 18; i++) {
      let x = (0.5 + Math.floor(random() * 12) * 3) * scale + (random() - .5) * .6 * scale;
      let y = (1.5 + Math.floor(random() * 6) * 3) * scale + (random() - .5) * .6 * scale;
      c.strokeStyle = 'rgba(58,56,48,.38)'; c.lineWidth = Math.max(1, scale * .035);
      b.strokeStyle = '#383838'; b.lineWidth = Math.max(1, scale * .045);
      c.beginPath(); b.beginPath(); c.moveTo(x, y); b.moveTo(x, y);
      for (let s = 0; s < 4; s++) { x += (random() - .5) * .9 * scale; y += (random() - .5) * .9 * scale; c.lineTo(x, y); b.lineTo(x, y); }
      c.stroke(); b.stroke();
    }
    speckle(c, w, h, w * h / 10, random, 'rgba(205,203,186,.24)', 'rgba(68,68,58,.24)');
    speckle(b, w, h, w * h / 12, random, 'rgba(185,185,185,.22)', 'rgba(72,72,72,.22)');
    // Recessed expansion joints with subtle inset corner tie plugs.
    c.strokeStyle = 'rgba(72,72,62,.88)'; c.lineWidth = Math.max(1.5, scale * .09);
    b.strokeStyle = '#181818'; b.lineWidth = Math.max(2, scale * .11);
    r.strokeStyle = '#787878'; r.lineWidth = Math.max(1.5, scale * .09);
    for (let x = .5; x < 37; x += 3) for (const ctx of [c, b, r]) { ctx.beginPath(); ctx.moveTo(x * scale, 0); ctx.lineTo(x * scale, h); ctx.stroke(); }
    for (let z = 1.5; z < 19; z += 3) for (const ctx of [c, b, r]) { ctx.beginPath(); ctx.moveTo(0, z * scale); ctx.lineTo(w, z * scale); ctx.stroke(); }
    const plugOff = Math.max(3, scale * .24);
    for (let x = .5; x < 37; x += 3) for (let z = 1.5; z < 19; z += 3) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const px = x * scale + sx * plugOff, py = z * scale + sz * plugOff;
        c.fillStyle = 'rgba(64,62,54,.45)'; c.beginPath(); c.arc(px, py, Math.max(1, scale * .05), 0, Math.PI * 2); c.fill();
        b.fillStyle = '#383838'; b.beginPath(); b.arc(px, py, Math.max(1, scale * .055), 0, Math.PI * 2); b.fill();
      }
    }
    c.strokeStyle = 'rgba(54,52,44,.7)'; c.lineWidth = 2.5;
    strokeBox(c, 1, 1, w - 2, h - 2);
  }, { roughness: true, bumpScale: .05 });
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
function texturedPlane(scene, w, d, x, y, z, maps, roughness = .95) {
  const matOpts = maps?.isTexture ? { map: maps, roughness, metalness: 0 } : { ...maps, roughness, metalness: 0 };
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial(matOpts));
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
  const detail = groundDetailMaps();
  texturedPlane(scene, 100, 150, 0, GROUND_Y, 0, {
    map: groundTexture(compact ? 8 : 16),
    bumpMap: detail.bumpMap,
    bumpScale: detail.bumpScale,
    roughnessMap: detail.roughnessMap,
  }, .98);
  texturedPlane(scene, 9, 84, 0, ROAD_Y, 0, asphaltMaps(), .94);
  const centerLine = mat(0xc6b785, 0, 0, .9, .04, 'roadLine');
  const sideLine = mat(0xaaa68b, 0, 0, .9, .04, 'roadLine');
  for (let z = -30; z <= 30; z += 5) {
    box(scene, .15, .008, 2, 0, ROAD_Y + .005, z, centerLine, 0, .5);
    for (const x of [-4.15, 4.15]) box(scene, .12, .008, 4.8, x, ROAD_Y + .005, z, sideLine, 0, .5);
  }
  const apron = apronMaps(compact ? 14 : 24);
  const apronHazard = mat(0xe3b437, 0, 0, .82, .16, 'hazard');
  for (const side of [-1, 1]) {
    box(scene, 37, .15, 19, 0, -.04, side * 42, mat(0x7c7b6c, 0, 0, .94, .02, 'concrete'), 0, .4);
    const slab = texturedPlane(scene, 37, 19, 0, APRON_Y, side * 42, apron, .95);
    if (side < 0) slab.rotation.z = Math.PI;
    for (let x = -16.5; x <= 16.5; x += 3) box(scene, 2.2, .03, .38, x, .05, side * 32.75, apronHazard, 0, 1.0);
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
  const foliage = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .88, flatShading: true, ...finishMaps('foliage')});
  const trunkMat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .94, flatShading: true, ...finishMaps('bark')});
  const trunks = scatter(scene, new THREE.CylinderGeometry(.18, .3, 1.6, 5), trunkMat, trees.length, (transform, color, i) => {
    const t = trees[i];
    color.setHSL(.08, .32, .24 + t.h * .05); transform.position.set(t.x, .6 * t.s, t.z); transform.scale.setScalar(t.s); return true;
  }, true);
  const canopies = [
    scatter(scene, new THREE.ConeGeometry(1.75, 3.7, 7), foliage, trees.length, treeAt(2.7, .1), true),
    scatter(scene, new THREE.ConeGeometry(1.25, 2.8, 7), foliage, trees.length, treeAt(4.1, .14), true),
  ];
  const stone = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .95, flatShading: true, ...finishMaps('stone')});
  scatter(scene, new THREE.DodecahedronGeometry(1), stone, 70, (transform, color) => {
    const x = (random() < .5 ? -1 : 1) * (20.5 + random() * 28), z = random() * 146 - 73;
    const size = .5 + random() * 1.1;
    transform.position.set(x, .05, z); transform.rotation.set(random(), random() * 6, random());
    transform.scale.set(size * (1 + random() * .5), size * .55, size);
    color.setHSL(.12, .08, .42 + random() * .12); return true;
  }, true);
  // Low grass tufts break up the ground plane without adding shadow cost.
  const tufts = [];
  const grass = scatter(scene, new THREE.ConeGeometry(.22, .55, 4), foliage, compact ? 700 : 1500, (transform, color) => {
    const x = random() * 96 - 48, z = random() * 146 - 73;
    const onRoad = Math.abs(x) < 6 && Math.abs(z) < 56, onApron = Math.abs(x) < 19.5 && Math.abs(z) > 32 && Math.abs(z) < 52;
    if (onRoad || onApron || Math.abs(Math.abs(x) - 18.8) < .8 || (!outside(x, z) && random() < .55)) return false;
    const size = .6 + random() * .9;
    transform.position.set(x, -.2 + .27 * size, z); transform.rotation.set((random() - .5) * .4, random() * 6, (random() - .5) * .4);
    transform.scale.set(size, size, size);
    color.setHSL(.16 + random() * .07, .45, .13 + random() * .07); tufts.push({x, z}); return true;
  });
  const wallBody = mat(0xaaa28a, 0, 0, .94, .04, 'concrete');
  const wallCap = mat(0xc0b89e, 0, 0, .86, .18, 'steel');
  for (const side of [-1, 1]) {
    for (let z = -29; z <= 29; z += 6) {
      box(scene, .55, .7, 3.8, side * 18.8, .25, z, wallBody, 0, .45);
      box(scene, .65, .12, 3.9, side * 18.8, .66, z, wallCap, 0, .45);
    }
  }
  // The plants that battle damage can burn, in instance order.
  return { grass: { meshes: [grass], spots: tufts }, trees: { trunks, meshes: canopies, spots: trees } };
}
const FOOTPRINTS = {command: [9.4, 8.6], refinery: [9.2, 7.6], factory: [8.4, 8], barracks: [7.6, 7.2], emplacement: [4.6, 4.6]};
// An empty Standard site: corner brackets around the structure's footprint.
function siteMarker(site) {
  const marker = new THREE.Group();
  const [w, d] = FOOTPRINTS[site.kind], line = mat(site.team === 'player' ? 0x9bc5ff : 0xffa18b), arm = 1.6, t = .14;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(marker, arm, .05, t, sx * (w / 2 - arm / 2), .06, sz * d / 2, line);
    box(marker, t, .05, arm, sx * w / 2, .06, sz * (d / 2 - arm / 2), line);
  }
  box(marker, 1.2, .05, .12, 0, .06, 0, mat(0xe3c66b));
  box(marker, .12, .05, 1.2, 0, .06, 0, mat(0xe3c66b));
  marker.position.set(site.x, .04, site.z);
  return marker;
}
function createBreakableTracker() {
  const breakable = [];
  let current = null;
  const part = (id, fn, meta = {}) => {
    const entry = {
      id, spans: [], state: 0, color: null, parent: null,
      shape: meta.shape || 'plate', protruding: !!meta.protruding,
      minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity,
    };
    current = entry;
    fn();
    current = null;
    breakable.push(entry);
    return entry;
  };
  const tag = (geometry, material) => {
    if (!current) return;
    geometry.userData.part = current;
    if (current.color === null && material?.color) current.color = material.color.getHex();
  };
  const attach = (id, mesh, meta = {}) => {
    const entry = part(id, () => {}, meta);
    mesh.userData.part = entry;
    if (mesh.material?.color) entry.color = mesh.material.color.getHex();
    return entry;
  };
  const mergeGroup = (source, parent, uvScale = .48) => {
    for (const [material, geometries] of source) {
      const positions = [], normals = [], uvs = [], spans = [];
      for (const geometry of geometries) {
        const pos = geometry.attributes.position.array;
        const start = positions.length / 3, count = pos.length / 3;
        positions.push(...pos);
        normals.push(...geometry.attributes.normal.array);
        if (geometry.userData.hasUV && geometry.attributes.uv) {
          uvs.push(...geometry.attributes.uv.array);
        } else {
          for (let i = 0; i < pos.length; i += 9) {
            const ax = pos[i + 3] - pos[i], ay = pos[i + 4] - pos[i + 1], az = pos[i + 5] - pos[i + 2];
            const bx = pos[i + 6] - pos[i], by = pos[i + 7] - pos[i + 1], bz = pos[i + 8] - pos[i + 2];
            const nx = Math.abs(ay * bz - az * by);
            const ny = Math.abs(az * bx - ax * bz);
            const nz = Math.abs(ax * by - ay * bx);
            for (let v = 0; v < 9; v += 3) {
              const x = pos[i + v], y = pos[i + v + 1], z = pos[i + v + 2];
              if (ny >= nx && ny >= nz) uvs.push(x * uvScale, z * uvScale);
              else if (nx >= nz) uvs.push(z * uvScale, y * uvScale);
              else uvs.push(x * uvScale, y * uvScale);
            }
          }
        }
        const owner = geometry.userData.part;
        if (owner) {
          for (let i = 0; i < pos.length; i += 3) {
            owner.minX = Math.min(owner.minX, pos[i]); owner.maxX = Math.max(owner.maxX, pos[i]);
            owner.minY = Math.min(owner.minY, pos[i + 1]); owner.maxY = Math.max(owner.maxY, pos[i + 1]);
            owner.minZ = Math.min(owner.minZ, pos[i + 2]); owner.maxZ = Math.max(owner.maxZ, pos[i + 2]);
          }
          spans.push({ owner, start, count });
        }
        geometry.dispose();
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
      for (const { owner, start, count } of spans) {
        owner.spans.push({ mesh, start, count });
        owner.parent = parent;
      }
    }
  };
  const finish = target => {
    target.userData.breakable = breakable.filter(entry => {
      if (!entry.spans.length) return false;
      entry.at = new THREE.Vector3(
        (entry.minX + entry.maxX) / 2,
        (entry.minY + entry.maxY) / 2,
        (entry.minZ + entry.maxZ) / 2,
      );
      entry.size = new THREE.Vector3(
        Math.max(.12, entry.maxX - entry.minX),
        Math.max(.1, entry.maxY - entry.minY),
        Math.max(.12, entry.maxZ - entry.minZ),
      );
      return true;
    });
  };
  return { part, tag, attach, mergeGroup, finish };
}

export function buildingMesh(b) {
  const g = new THREE.Group();
  const tracker = createBreakableTracker();
  // Orient the entrance toward the battlefield for each side. Each facility
  // has a distinctive roofline, so its role reads even from the full map.
  const body = new THREE.Group();
  if (b.team === 'enemy') body.rotation.y = Math.PI;
  g.add(body);
  const accent = b.team === 'player' ? C.player : C.enemy;
  const darkAccent = b.team === 'player' ? C.playerDark : C.enemyDark;
  const glow = mat(accent, accent, .04, .74, .24, 'trim'), armor = mat(b.team === 'player' ? 0xb3b09a : 0x9b9380, 0, 0, .80, .28, 'armor');
  const dark = mat(C.dark, 0, 0, .88, .28, 'dark'), edge = mat(darkAccent, 0, 0, .76, .24, 'trim');
  const steel = mat(0x999b8d, 0, 0, .58, .66, 'steel'), shadow = mat(0x4c5146, 0, 0, .88, .24, 'dark'), caution = mat(0xe1bd49, 0, 0, .8, .18, 'hazard');
  if (b.kind === 'emplacement') {
    body.rotation.y = 0;
    cylinder(body, 1.7, 1.7, .32, 0, .2, 0, mat(0x908e80, 0, 0, .94, .04, 'concrete'), 12);
    cylinder(body, 1.74, 1.74, .12, 0, .22, 0, edge, 12);
    box(body, .38, .31, .36, 0, .21, -1.54, glow);
    cylinder(body, .8, 1.15, .65, 0, .65, 0, shadow, 12);
    box(body, 2.5, 1.25, .45, 0, 1.35, -.4, armor);
    tracker.attach('shield-trim', box(body, 2.55, .18, .5, 0, 2, -.4, glow));
    box(body, .34, .34, 3.5, 0, 1.8, -1.4, steel);
    tracker.attach('muzzle', box(body, .55, .5, .7, 0, 1.8, -3.1, dark), { shape: 'rod', protruding: true });
    for (const x of [-.8, .8]) tracker.attach(x < 0 ? 'strut-l' : 'strut-r', box(body, .3, .25, 2.1, x, .5, .7, edge, x * .3), { shape: 'rod' });
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
      const chunk = new THREE.Mesh(new THREE.OctahedronGeometry(.48), mat(0xe5b64a, 0x9a6512, .22, .42, .42, 'ore'));
      chunk.geometry.userData.hasUV = true;
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
    if (mesh.geometry.userData.hasUV) geometry.userData.hasUV = true;
    if (mesh.userData.part) geometry.userData.part = mesh.userData.part;
    if (!parts.has(mesh.material)) parts.set(mesh.material, []);
    parts.get(mesh.material).push(geometry);
    mesh.geometry.dispose();
    body.remove(mesh);
  }
  tracker.mergeGroup(parts, body, .48);
  tracker.finish(g);
  const footprint = FOOTPRINTS[b.kind] || FOOTPRINTS.barracks;
  g.add(contactShadow(...footprint));
  const baseRing = ring(b.kind === 'command' ? 4.3 : 3.5, accent, .3); baseRing.userData.decoration = true; g.add(baseRing);
  return g;
}
export function unitMesh(u) {
  const g = new THREE.Group();
  const tracker = createBreakableTracker();
  const part = tracker.part;
  const accent = u.team === 'player' ? C.player : C.enemy;
  const darkAccent = u.team === 'player' ? C.playerDark : C.enemyDark;
  const glow = mat(accent, accent, .03, .72, .26, 'trim'), armor = mat(u.team === 'player' ? 0x8b9563 : 0xa09166, 0, 0, .80, .24, 'armor'), dark = mat(0x464c36, 0, 0, .88, .24, 'dark');
  const lamp = mat(0xffde8b, 0xffc861, 1.4, .35, .1);
  const metal = mat(0x858777, 0, 0, .58, .68, 'steel'), pale = mat(0xd2ac7e, 0, 0, .9, .02), shadow = mat(0x292c25, 0, 0, .9, .25, 'tread');

  // Combine the small armor pieces by material. Detailed models stay cheap to
  // draw even when both armies have many units on screen.
  // Parts go to the hull unless a turret is being assembled around its pivot.
  const unitUvScale = ['tank', 'collector', 'demolition'].includes(u.kind) ? .85 : 1.15;
  const hull = new Map(), turret = new Map(), hopper = new Map(), pivotZ = -.1;
  let parts = hull;
  const addPart = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const keepUV = !!geometry.userData.hasUV;
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    if (keepUV) source.userData.hasUV = true;
    if (source !== geometry) geometry.dispose();
    source.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    source.translate(x, parts === hopper ? y - 1.36 : y,
      parts === turret ? z - pivotZ : parts === hopper ? z - 1.88 : z);
    tracker.tag(source, material);
    if (!parts.has(material)) parts.set(material, []);
    parts.get(material).push(source);
  };
  const plate = (w, h, d, x, y, z, material, rx = 0, ry = 0, rz = 0) =>
    addPart(new THREE.BoxGeometry(w, h, d), material, x, y, z, rx, ry, rz);
  const drum = (r1, r2, h, x, y, z, material, rx = 0, ry = 0, rz = 0, segments = 8) => {
    const geo = new THREE.CylinderGeometry(r1, r2, h, segments);
    scaleCylinderUVs(geo, r1, r2, h, unitUvScale);
    return addPart(geo, material, x, y, z, rx, ry, rz);
  };
  // Each unit has its own silhouette: tracked harvester, drum-carrying truck,
  // twin-gun tank, light rifleman and an armored rocket trooper. Faction paint
  // is cool steel for the player and rust iron for the enemy, with bold stripes.
  const player = u.team === 'player';
  const hullMat = mat(player ? 0x839096 : 0x86705a, 0, 0, .78, .3, 'armor'), hullDark = mat(player ? 0x56646c : 0x5a4636, 0, 0, .82, .28, 'armor');
  const stripe = mat(0xe8e2c8, 0, 0, .78, .16, 'trim'), glass = mat(0x1c2a33, 0x3d6f86, .35, .24, .45, 'glass');
  const hazard = mat(0xe3b437, 0, 0, .8, .18, 'hazard'), rust = mat(0x3a2f27, 0, 0, .95, .14, 'rust');
  const track = (x, length, y, height, width, wheel) => {
    plate(width, height, length, x, y, 0, shadow);
    plate(width + .04, .08, length - .1, x, y + height / 2, 0, metal);
    for (let z = -length / 2 + .3; z < length / 2 - .2; z += .34) plate(width + .06, .07, .12, x, y + height / 2 + .05, z, dark);
    for (let z = -length / 2 + .45; z < length / 2 - .3; z += (length - .9) / 4) drum(wheel, wheel, .1, x + Math.sign(x) * (width / 2 + .02), y - .02, z, metal, 0, 0, Math.PI / 2, 10);
  };
  if (u.kind === 'collector') {
    // Heavy tracked harvester: front scoop, offset cab and a deep ore hopper.
    track(-1.22, 4.2, .45, .82, .62, .26);
    track(1.22, 4.2, .45, .82, .62, .26);
    plate(1.95, .62, 3.9, 0, 1.0, 0, hullDark);
    plate(2.9, .14, .85, 0, .42, -2.3, hazard, -.45);
    const leftTeeth = [], midTeeth = [], rightTeeth = [];
    for (let x = -1.25; x <= 1.26; x += .36) (x < -.3 ? leftTeeth : x > .3 ? rightTeeth : midTeeth).push(x);
    part('scoop-l', () => { for (const x of leftTeeth) plate(.12, .1, .3, x, .26, -2.72, metal, -.45); }, { protruding: true });
    for (const x of midTeeth) plate(.12, .1, .3, x, .26, -2.72, metal, -.45);
    part('scoop-r', () => { for (const x of rightTeeth) plate(.12, .1, .3, x, .26, -2.72, metal, -.45); }, { protruding: true });
    plate(2.3, .5, .55, 0, 1.0, -1.95, shadow);
    drum(.24, .24, 2.1, 0, .9, -2.05, metal, 0, 0, Math.PI / 2, 10);
    // Cab on the left, machinery on the right.
    plate(.95, .85, 1.05, -.52, 1.72, -1.2, glow);
    plate(.85, .3, .06, -.52, 1.88, -1.74, glass);
    plate(.06, .3, .7, -1.0, 1.88, -1.2, glass);
    part('cab-roof', () => plate(1.05, .12, 1.15, -.52, 2.2, -1.2, hullMat));
    part('engine-hood', () => {
      plate(.85, .55, .95, .5, 1.58, -1.25, hullMat);
      for (const z of [-1.55, -1.25, -.95]) plate(.7, .06, .12, .5, 1.87, z, shadow);
    });
    part('exhaust', () => {
      drum(.09, .11, .9, .78, 2.1, -.95, shadow);
      drum(.12, .12, .08, .78, 2.56, -.95, rust);
    }, { shape: 'rod', protruding: true });
    // Hopper: flared walls with a faction stripe along the rim.
    parts = hopper;
    plate(1.7, .1, 2.2, 0, 1.36, .75, shadow);
    for (const x of [-1, 1]) {
      plate(.12, .95, 2.3, x * .93, 1.8, .75, hullMat, 0, 0, x * .16);
      part(x < 0 ? 'hopper-trim-l' : 'hopper-trim-r', () => {
        plate(.14, .16, 2.34, x * 1.0, 2.26, .75, glow);
        for (const z of [.05, .75, 1.45]) plate(.06, .8, .1, x * 1.0, 1.78, z, hullDark, 0, 0, x * .16);
      });
    }
    plate(2, .95, .12, 0, 1.8, 1.88, hullMat);
    plate(2.1, .16, .14, 0, 2.26, 1.9, glow);
    plate(2, .95, .12, 0, 1.8, -.38, hullMat);
    parts = hull;
    for (const x of [-.6, .6]) part(x < 0 ? 'bumper-l' : 'bumper-r', () => plate(.36, .14, .5, x, 1.4, 1.98, stripe));
    for (const x of [-.85, -.3]) part(x < -.5 ? 'lamp-l' : 'lamp-r', () => plate(.18, .14, .08, x, 1.45, -1.75, lamp), { protruding: true });
  } else if (u.kind === 'demolition') {
    // Cab-over truck hauling one oversized, unmistakably dangerous drum.
    plate(2, .32, 3.9, 0, .7, .05, shadow);
    for (const x of [-1.04, 1.04]) for (const z of [-1.3, .55, 1.4]) {
      const addWheel = () => {
        drum(.5, .5, .36, x, .5, z, shadow, 0, 0, Math.PI / 2, 12);
        drum(.24, .24, .38, x, .5, z, metal, 0, 0, Math.PI / 2);
      };
      if (z === .55) part(x < 0 ? 'wheel-ml' : 'wheel-mr', addWheel, { shape: 'wheel' });
      else addWheel();
    }
    plate(2.1, .22, 1.2, 0, .95, -1.3, hullDark);
    plate(1.9, 1.15, 1.05, 0, 1.6, -1.35, glow);
    plate(1.65, .45, .08, 0, 1.85, -1.9, glass, .15);
    part('cab-roof', () => plate(1.95, .14, 1.1, 0, 2.22, -1.35, hullMat));
    part('grille', () => {
      plate(1.4, .3, .06, 0, 1.25, -1.9, metal);
      for (let x = -.55; x <= .56; x += .18) plate(.06, .26, .07, x, 1.25, -1.93, shadow);
    });
    part('bumper', () => plate(2.1, .2, .16, 0, .88, -1.98, metal));
    for (const x of [-.72, .72]) part(x < 0 ? 'lamp-l' : 'lamp-r', () => plate(.24, .18, .08, x, 1.23, -1.92, lamp), { protruding: true });
    part('beacon', () => drum(.14, .14, .18, 0, 2.38, -1.35, mat(0xff6b28, 0xff4a10, 1.4)), { protruding: true });
    // Flatbed, cradle and the drum itself.
    plate(2, .14, 2.5, 0, .95, .62, hullMat);
    for (const z of [-.25, .62, 1.5]) plate(1.5, .5, .2, 0, 1.2, z, hullDark);
    drum(.82, .82, 2.3, 0, 1.92, .62, hazard, Math.PI / 2, 0, 0, 14);
    for (const z of [-.3, .62, 1.54]) drum(.86, .86, .16, 0, 1.92, z, z === .62 ? mat(0xb5301f, 0x5a0d05, .3, .7, .25, 'trim') : rust, Math.PI / 2, 0, 0, 14);
    drum(.7, .7, .06, 0, 1.92, 1.79, metal, Math.PI / 2, 0, 0, 14);
    drum(.12, .12, .04, 0, 1.92, 1.83, rust, Math.PI / 2, 0, 0, 10);
    // Radiation trefoil on the rear cap.
    part('trefoil', () => {
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3 + Math.PI / 2;
        plate(.24, .38, .04, Math.cos(a) * .34, 1.92 + Math.sin(a) * .32, 1.83, rust, 0, 0, a);
      }
    });
    part('vent-pipe', () => drum(.08, .08, .5, .5, 2.6, .62, metal, 0, 0, 0, 6), { shape: 'rod', protruding: true });
  } else if (u.kind === 'tank') {
    // Wedge-nosed heavy tank with team skirts and a twin-gun hexagonal turret.
    track(-1.1, 3.4, .42, .72, .6, .2);
    track(1.1, 3.4, .42, .72, .6, .2);
    plate(1.95, .55, 2.55, 0, .92, .25, hullMat);
    plate(1.95, .14, 1.05, 0, 1.0, -1.32, hullMat, -.42);
    plate(1.6, .3, .3, 0, .62, -1.72, hullDark);
    for (const x of [-1, 1]) {
      for (const [tag, z] of [['f', -.675], ['r', .775]]) {
        part(`skirt-${x < 0 ? 'l' : 'r'}${tag}`, () => {
          plate(.1, .36, 1.45, x * 1.43, .72, z, glow);
          plate(.12, .07, 1.45, x * 1.44, .93, z, stripe);
        });
      }
    }
    plate(1.5, .1, .8, 0, 1.24, 1.05, shadow);
    for (let x = -.6; x <= .61; x += .2) plate(.07, .07, .72, x, 1.3, 1.05, metal);
    for (const x of [-.7, .7]) part(x < 0 ? 'exhaust-l' : 'exhaust-r', () => drum(.1, .12, .35, x, 1.35, 1.45, shadow, .3), { shape: 'rod', protruding: true });
    for (const x of [-.72, .72]) part(x < 0 ? 'lamp-l' : 'lamp-r', () => plate(.22, .14, .08, x, 1.0, -1.82, lamp), { protruding: true });
    parts = turret;
    drum(.95, 1.1, .5, 0, 1.48, 0, hullMat, 0, Math.PI / 6, 0, 6);
    drum(1.12, 1.12, .12, 0, 1.3, 0, glow, 0, Math.PI / 6, 0, 6);
    drum(.82, .95, .12, 0, 1.79, 0, glow, 0, Math.PI / 6, 0, 6);
    part('bustle', () => plate(1.2, .42, .55, 0, 1.45, .95, hullMat));
    plate(1, .5, .42, 0, 1.5, -1.0, hullDark);
    for (const x of [-.24, .24]) {
      drum(.1, .12, 2.1, x, 1.52, -2.1, metal, Math.PI / 2);
      part(x < 0 ? 'muzzle-l' : 'muzzle-r', () => plate(.24, .22, .34, x, 1.52, -3.12, shadow), { shape: 'rod', protruding: true });
    }
    part('cupola', () => {
      drum(.25, .28, .22, .42, 1.95, .25, hullMat);
      drum(.2, .2, .06, .42, 2.08, .25, shadow);
    });
    part('antenna', () => drum(.025, .025, 1.1, -.5, 2.35, .7, shadow), { shape: 'rod', protruding: true });
    if (player) for (const s of [-1, 1]) plate(.34, .03, .1, -.25 + s * .1, 1.86, -.25, stripe, 0, s * .7);
    else drum(.2, .2, .03, -.25, 1.86, -.25, stripe, 0, 0, 0, 5);
    parts = hull;
  } else if (u.kind === 'rocket') {
    // Armored rocket trooper: closed helmet with a glowing visor and a twin-tube pod.
    const suit = mat(player ? 0x5f6b72 : 0x6b5a4a, 0, 0, .88, .16, 'armor');
    for (const x of [-.22, .22]) {
      plate(.34, .62, .38, x, .46, 0, suit);
      part(x < 0 ? 'kneepad-l' : 'kneepad-r', () => plate(.36, .2, .2, x, .58, -.2, metal));
      plate(.38, .22, .5, x, .12, -.06, shadow);
    }
    plate(.84, .74, .52, 0, 1.15, 0, suit);
    plate(.72, .42, .08, 0, 1.22, -.28, glow);
    plate(.88, .14, .56, 0, .8, 0, shadow);
    for (const x of [-.52, .52]) {
      part(x < 0 ? 'shoulder-l' : 'shoulder-r', () => plate(.4, .24, .5, x, 1.5, 0, glow));
      plate(.26, .55, .3, x * 1.05, 1.1, -.05, suit);
      plate(.24, .2, .26, x * 1.05, .82, -.18, shadow);
    }
    plate(.48, .44, .48, 0, 1.78, 0, hullDark);
    plate(.4, .11, .06, 0, 1.78, -.26, mat(0xffa040, 0xff7a20, 1.6));
    part('helmet-crest', () => plate(.52, .1, .52, 0, 2.03, 0, glow));
    // Launcher pod on the right shoulder, warheads visible from the front.
    plate(.48, .42, 1.45, .66, 1.82, -.1, mat(0x55603c, 0, 0, .84, .22, 'armor'));
    part('pod-trim', () => plate(.06, .12, 1.1, .92, 1.85, -.05, glow));
    drum(.1, .14, .25, .66, 1.82, .72, shadow, Math.PI / 2);
    for (const y of [1.72, 1.92]) {
      drum(.12, .12, .06, .55 + (y > 1.8 ? .22 : 0), y, -.9, shadow, Math.PI / 2);
      drum(.08, .08, .12, .55 + (y > 1.8 ? .22 : 0), y, -.9, mat(0xd8392a, 0, 0, .6, .35, 'steel'), Math.PI / 2);
      drum(.12, .12, .06, .77 - (y > 1.8 ? .22 : 0), y, -.9, shadow, Math.PI / 2);
    }
    part('backpack', () => plate(.5, .5, .26, 0, 1.2, .36, dark));
  } else {
    // Light rifleman: slim build, faction vest and helmet, rifle at the ready.
    for (const x of [-.17, .17]) {
      plate(.25, .62, .3, x, .45, 0, armor);
      plate(.28, .2, .42, x, .11, -.06, shadow);
    }
    plate(.6, .62, .38, 0, 1.08, 0, armor);
    plate(.66, .38, .44, 0, 1.16, 0, glow);
    plate(.64, .1, .42, 0, .8, 0, shadow);
    for (const x of [-.36, .36]) plate(.18, .5, .22, x, 1.06, -.12, armor, -.6);
    part('backpack', () => plate(.42, .44, .22, 0, 1.12, .3, dark));
    part('pack-roll', () => drum(.1, .12, .18, 0, 1.48, .3, metal), { shape: 'rod', protruding: true });
    drum(.19, .2, .28, 0, 1.58, -.02, pale);
    part('helmet', () => {
      drum(.26, .3, .2, 0, 1.78, 0, glow);
      drum(.34, .34, .05, 0, 1.69, 0, glow);
    }, { shape: 'helmet' });
    plate(.12, .14, .95, .22, 1.18, -.62, shadow);
    plate(.13, .12, .32, .22, 1.18, -.2, mat(0x6e4930, 0, 0, .88, .05, 'wood'));
    plate(.1, .2, .12, .22, 1.03, -.55, metal);
    drum(.04, .04, .45, .22, 1.2, -1.28, shadow, Math.PI / 2);
    plate(.2, .16, .16, .22, 1.2, -.85, pale);
  }
  tracker.mergeGroup(hull, g, unitUvScale);
  if (hopper.size) {
    const pivot = new THREE.Group(); pivot.position.set(0, 1.36, 1.88);
    tracker.mergeGroup(hopper, pivot, unitUvScale); g.add(pivot); g.userData.hopper = pivot;
  }
  if (turret.size) {
    const pivot = new THREE.Group(); pivot.position.z = pivotZ;
    tracker.mergeGroup(turret, pivot, unitUvScale); g.add(pivot); g.userData.turret = pivot;
  }
  tracker.finish(g);
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
// Damage shows in how they move: wounded infantry stoop and limp, and
// battered vehicles list to one side and shudder.
const DUST_BASE = new THREE.Color(0xa1977a), DUST_SOOT = new THREE.Color(0x3e3830), dustColor = new THREE.Color();
function animateUnit(entity, item, dt, now, effects, compact, state) {
  const model = entity.group.children[0], turret = model.userData.turret;
  const dx = item.x - entity.group.position.x, dz = item.z - entity.group.position.z;
  const step = Math.hypot(dx, dz), continuous = entity.placed && step < 3;
  entity.placed = true;
  const speed = continuous && dt > 0 ? step / dt : 0;
  entity.speed += (speed - entity.speed) * Math.min(1, dt * 10);
  if (continuous && step > .002) entity.heading = Math.atan2(-dx, -dz);
  const aiming = now < entity.aimUntil;
  const desired = aiming && !turret ? entity.aimYaw : entity.heading;
  if (desired !== undefined && !(item.unload_progress > 0)) model.rotation.y = turnToward(model.rotation.y, desired, (TURN_RATE[item.kind] || 9) * dt);
  if (turret) {
    turret.rotation.y = turnToward(turret.rotation.y, aiming ? wrapAngle(entity.aimYaw - model.rotation.y) : 0, 4.5 * dt);
    const recoil = Math.max(0, (entity.recoilUntil - now) / 240) * .35;
    turret.position.x = Math.sin(turret.rotation.y) * recoil;
    turret.position.z = -.1 + Math.cos(turret.rotation.y) * recoil;
  }
  const vehicle = VEHICLES.has(item.kind), amount = Math.min(1, entity.speed / 2);
  entity.gait += dt * entity.speed * (vehicle ? 1.6 : 3.4);
  entity.hurt += (state / 2 - entity.hurt) * Math.min(1, dt * 3);
  const hurt = entity.hurt;
  if (vehicle) {
    const list = entity.list * hurt;
    const shudder = state === 2 ? (Math.sin(now * .055 + entity.list * 90) + .4 * Math.sin(now * .13)) * .012
      : state === 1 ? Math.sin(now * .038 + entity.list * 90) * .004 : 0;
    const terrain = effects.ground.sample(item.x, item.z, model.rotation.y);
    model.position.y = Math.sin(entity.gait * 2.3) * .035 * amount + Math.abs(list) * .25 + shudder + terrain.y;
    model.rotation.x = Math.sin(entity.gait * 1.7) * .015 * amount + shudder + terrain.pitch;
    model.rotation.z = list + terrain.roll;
    entity.dust += dt * amount;
    if (entity.dust > (compact ? .2 : .1) && entity.group.visible) {
      entity.dust = 0;
      const back = item.kind === 'tank' ? 1.5 : 1.9, yaw = model.rotation.y;
      const tint = terrain.soot > 0 ? dustColor.copy(DUST_BASE).lerp(DUST_SOOT, terrain.soot * .85).getHex() : 0xa1977a;
      effects.emit('dust', { x: item.x + Math.sin(yaw) * back, y: .25, z: item.z + Math.cos(yaw) * back },
        { size: (.8 + Math.random() * .5) * (1 + terrain.soot * .35), life: .7 + Math.random() * .4, vx: (Math.random() - .5) * .6,
          vy: .35, vz: (Math.random() - .5) * .6, color: tint });
    }
  } else {
    // The bad leg takes a short step and the body dips over it.
    const stride = Math.sin(entity.gait), bad = Math.min(0, stride * Math.sign(entity.list));
    const breathe = Math.sin(now * .004 + entity.list * 40) * .02 * hurt;
    model.position.y = Math.abs(stride) * .13 * amount * (bad ? 1 - .7 * hurt : 1) - .04 * hurt;
    model.rotation.z = Math.sign(entity.list) * .1 * hurt + (stride * .07 + bad * Math.sign(entity.list) * .22 * hurt) * amount;
    model.rotation.x = -.1 * amount - .2 * hurt + breathe;
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
    mats.set('ore', new THREE.MeshStandardMaterial({color: 0xe0a734, roughness: .42, metalness: .42, emissive: 0x9a6512, emissiveIntensity: .38, flatShading: true, ...finishMaps('ore')}));
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
  constructor(container, onSelect = () => {}, onCancelTraining = () => {}, onEjectGarrisoned = () => {}, audio = null) {
    this.container = container; this.onSelect = onSelect; this.view = 'map';
    this.audio = audio; this.heard = new THREE.Vector3();
    const sound = this.sound = (name, x, z, options) => this.audio?.play(name, { ...this.hear(x, z), ...options });
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
    const foliage = addEnvironment(this.scene, compact);
    this.defensePads = new Map();
    this.siteMarkers = new Map();
    this.entities = new Map(); this.oreFields = new Map(); this.combatEffects = new CombatEffects(this.scene, compact, foliage, sound); this.lastShotId = 0; this.lastTime = 0; this.lastFrame = performance.now(); this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    this.point = new THREE.Vector3();
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
    this.zoom = 1;
    this.renderer.domElement.addEventListener('wheel', event => {
      event.preventDefault();
      this.zoom = Math.max(.32, Math.min(1, this.zoom * Math.exp(event.deltaY * .0012)));
      this.resize();
    }, { passive: false });
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container); this.resize();
  }
  setView(view) {
    this.view = view === 'base' ? 'base' : 'map';
    this.zoom = 1;
    this.resize();
  }
  // Where a spot on the field is heard from: panned across the view, and
  // marked as far away once it lies outside it.
  hear(x, z) {
    const point = this.heard.set(x, 1, z).project(this.camera);
    return { pan: Math.max(-.85, Math.min(.85, point.x * 1.5)),
      far: Math.max(Math.abs(point.x), Math.abs(point.y)) > 1.1 };
  }
  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const height = (this.view === 'base' ? Math.max(38, 28 / aspect) : Math.max(88, 44 / aspect)) * (this.zoom || 1);
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
    // Sites depend on the game mode, so they are rebuilt for every match.
    for (const marker of this.siteMarkers.values()) {
      this.scene.remove(marker);
      marker.traverse(object => object.geometry?.dispose());
    }
    this.siteMarkers.clear();
  }
  update(snapshot, selectedIds = []) {
    if (!snapshot) return;
    const restarting = snapshot.time < this.lastTime;
    const now = performance.now();
    const dt = Math.min(.1, Math.max(0, (now - this.lastFrame) / 1000)) * (this.timeScale || 1);
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
    for (const site of snapshot.sites || []) {
      const key = `${site.team}-${site.kind}`;
      let marker = this.siteMarkers.get(key);
      if (!marker) { marker = siteMarker(site); this.siteMarkers.set(key, marker); this.scene.add(marker); }
      marker.visible = !snapshot.buildings.some(b => b.team === site.team && b.kind === site.kind && b.hp > 0);
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
    let driving = 0;
    for (const item of [...snapshot.buildings, ...snapshot.units]) {
      const isUnit = 'state' in item, key = `${isUnit ? 'u' : 'b'}${item.id}`; alive.add(key);
      let entity = this.entities.get(key);
      if (!entity) {
        const group = new THREE.Group(); group.userData.entityId = item.id;
        group.add(isUnit ? unitMesh(item) : buildingMesh(item));
        let cargo = null;
        if (isUnit && item.kind === 'collector') {
          cargo = new CollectorCargo(group, mat(0xe5b64a, 0x9a6512, .25, .42, .42, 'ore'), item.cargo);
        }
        // A generous transparent target keeps individual soldiers easy to click.
        let hitTarget = null;
        if (isUnit) {
          hitTarget = new THREE.Mesh(new THREE.SphereGeometry(['tank', 'collector', 'demolition'].includes(item.kind) ? 1.65 : 1.05, 8, 6), new THREE.MeshBasicMaterial({transparent: true, opacity: 0, depthWrite: false}));
          hitTarget.position.y = 1; group.add(hitTarget);
        }
        const selection = ring(isUnit && ['tank', 'demolition'].includes(item.kind) ? 1.8 : 1.25, 0x9eff40, .95); selection.visible = false; group.add(selection);
        const hp = healthBar(isUnit ? 1.8 : 4.5); hp.position.y = isUnit ? (item.kind === 'tank' ? 2.3 : 2.5) : (item.kind === 'command' ? 6.8 : 5.1); group.add(hp);
        const profile = !isUnit ? (item.kind === 'emplacement' ? 'emplacement' : 'structure') : VEHICLES.has(item.kind) ? 'vehicle' : 'infantry';
        const list = (Math.random() < .5 ? -1 : 1) * (.07 + Math.random() * .04);
        const damage = new ModelDamage(group.children[0], profile, {
          soot: sooted,
          rubble: mat(0xffffff, 0, 0, .94, .04, 'concrete'),
          bandage: mat(0xe2dbc8, 0, 0, .96, 0, 'cloth'),
          blood: mat(0x961816, 0, 0, .82, 0, 'cloth'),
          strap: mat(0x251d17, 0, 0, .88, .08, 'tread'),
          splint: mat(0xb07d4b, 0, 0, .92, 0, 'wood'),
          cavity: mat(0x161918, 0, 0, .96, .1, 'dark'),
          scrapMetal: mat(0x5c6368, 0, 0, .48, .68, 'steel'),
          wire: mat(0xd89634, 0x2ec8ff, .45, .5, .5, 'tread'),
        }, { kind: item.kind, list });
        this.scene.add(group); entity = {group, selection, hp, hitTarget, cargo, damage, kind: item.kind, isUnit, selectable: false, recoilUntil: 0, emission: 0,
          sparkTimer: 0, nextSpark: .3 + Math.random() * .5, looseTimer: 0,
          placed: false, speed: 0, gait: 0, dust: 0, heading: undefined, aimYaw: 0, aimUntil: 0,
          // Health and where the last hit came from, for the damage shown on the model.
          fraction: 1, hitFrom: null, hitAt: -Infinity,
          // Which way a battered vehicle lists, or which leg a wounded soldier favors.
          hurt: 0, list}; this.entities.set(key, entity);
      }
      const fraction = entity.fraction = Math.max(0, item.hp / item.max_hp), state = condition(fraction);
      if (isUnit) animateUnit(entity, item, dt, now, this.combatEffects, this.compact, state);
      entity.group.position.set(item.x, 0, item.z);
      entity.group.visible = item.state !== 'garrison';
      entity.cargo?.update(item, snapshot.buildings, dt, this.combatEffects.reducedMotion.matches);
      if (entity.cargo) {
        const pouring = item.unload_progress >= POUR_START && entity.group.visible;
        if (pouring && !entity.pouring) this.sound('pour', item.x, item.z);
        entity.pouring = pouring;
      }
      if (isUnit && VEHICLES.has(item.kind) && entity.group.visible) driving += Math.min(1, entity.speed / 2);
      if (!isUnit && item.construction_time > 0) {
        // Structures rise from their foundations while under construction.
        entity.group.children[0].scale.y = .25 + .75 * (1 - item.construction_remaining / item.construction_time);
      }
      if (item.kind === 'emplacement') {
        entity.group.children[0].rotation.y = item.facing;
        entity.hp.position.y = 3;
      }
      entity.selectable = isUnit && item.team === 'player' && item.state === 'gather';
      entity.selection.visible = entity.selectable && selected.has(item.id);
      entity.hp.visible = item.hp < item.max_hp || entity.selection.visible || item.construction_remaining > 0;
      entity.hp.userData.fill.scale.x = fraction;
      entity.hp.userData.fill.position.x = -(1 - fraction) * (isUnit ? 1.8 : 4.5) / 2;
      entity.hp.userData.fill.material.color.setHex([0x76e6a3, 0xf8c65f, 0xff7065][state]);
      entity.hp.quaternion.copy(this.camera.quaternion);
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
      const victim = this.entities.get(`${shot.target_is_unit ? 'u' : 'b'}${shot.target_id}`);
      if (victim) { victim.hitFrom = shot; victim.hitAt = now; }
      this.combatEffects.fire(shot);
    }
    for (const blast of snapshot.explosions || []) {
      if (blast.id <= (this.lastExplosionId || 0)) continue;
      this.lastExplosionId = blast.id;
      for (const victim of this.entities.values()) {
        const { x, z } = victim.group.position;
        if (Math.hypot(x - blast.x, z - blast.z) < blast.radius + 4) { victim.hitFrom = blast; victim.hitAt = now; }
      }
      this.combatEffects.explode(blast);
    }
    for (const [key, entity] of this.entities) if (alive.has(key)) this.showDamage(entity, dt, now);
    for (const [key, entity] of this.entities) if (!alive.has(key)) {
      if (!restarting && entity.group.visible) this.combatEffects.destroy(entity);
      this.removeEntity(entity);
      this.entities.delete(key);
    }
    this.combatEffects.update(dt, this.camera);
    this.audio?.setRumble(1 - Math.exp(-driving / 5));
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
  // Health lost shows on the model itself. New wounds face the last attacker
  // and throw off debris and parts; Damaged vehicles and buildings smoke and
  // spark electrically from their wounds, and Critical ones burn and arc.
  showDamage(entity, dt, now) {
    const heavy = !entity.isUnit || VEHICLES.has(entity.kind), visible = entity.group.visible;
    const opened = entity.damage.update(entity.fraction, now - entity.hitAt < 3000 ? entity.hitFrom : null);
    const detached = entity.damage.takeDetached();
    if (visible) {
      for (const part of detached) {
        this.combatEffects.dropPart(part);
        if (heavy || entity.kind === 'rocket') {
          this.combatEffects.electricSpark(part.origin, entity.isUnit ? .65 : .85);
        }
      }
      if (heavy && opened.length) {
        this.combatEffects.burst(entity.damage.locate(opened[opened.length - 1], this.point), entity.isUnit ? .32 : .42, false);
        this.combatEffects.electricSpark(this.point, entity.isUnit ? .65 : .85);
      }
    }
    const state = condition(entity.fraction);
    if (!visible || !state || !entity.damage.wounds.length) {
      entity.emission = 0; entity.sparkTimer = 0; return;
    }
    if (heavy || (entity.kind === 'rocket' && state === 2)) {
      entity.sparkTimer += dt;
      if (entity.sparkTimer >= entity.nextSpark) {
        entity.sparkTimer = 0;
        entity.nextSpark = (state === 2 ? .15 : .35) + Math.random() * (state === 2 ? .17 : .30);
        const origin = entity.damage.vent(state === 2 ? 3 : 4, this.point);
        this.combatEffects.electricSpark(origin, !entity.isUnit ? .95 : entity.kind === 'rocket' ? .45 : .75);
      }
    }
    if (!heavy) { entity.emission = 0; return; }
    entity.emission += dt;
    if (entity.emission < .18) return;
    entity.emission = 0;
    const origin = entity.damage.vent(state === 2 ? 3 : 4, this.point);
    if (state === 2) this.combatEffects.burn(origin, entity.isUnit ? .65 : 1.2);
    else this.combatEffects.smokePuff(origin, entity.isUnit ? .7 : 1.3);
  }
  removeEntity(entity) {
    entity.cargo?.dispose();
    this.scene.remove(entity.group);
    const shared = new Set(mats.values());
    entity.group.traverse(object => {
      object.geometry?.dispose();
      if (object.isInstancedMesh) object.dispose();
      if (object.material && !shared.has(object.material)) object.material.dispose();
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

import * as THREE from './three.module.js';

// Health marks. The simulation slows units at the same two marks
// (DAMAGED_HEALTH and CRITICAL_HEALTH in src/simulation.rs).
export const DAMAGED = .5, CRITICAL = .25;
/** 0 while healthy, 1 once Damaged and 2 once Critical. */
export const condition = fraction => fraction <= CRITICAL ? 2 : fraction <= DAMAGED ? 1 : 0;

// A model takes its damage in steps as health drops. Each step opens a wound
// at a corner or edge facing the attacker: the surface around it chars, bends
// inward and sags, and smoke and fire later rise from it.
// `reach` is how far a wound spreads, `sag` and `crumple` how far it bends the
// model, `grime` the soot a wrecked model carries all over, and `rubble` the
// chunks each wound knocks to the ground.
const PROFILES = {
  structure: { wounds: 6, reach: 3.6, sag: .5, crumple: .14, grime: .22, rubble: 3 },
  emplacement: { wounds: 5, reach: 1.4, sag: .14, crumple: .08, grime: .26, rubble: 0 },
  vehicle: { wounds: 5, reach: 1.8, sag: .13, crumple: .07, grime: .32, rubble: 0 },
  infantry: { wounds: 3, reach: 1, sag: 0, crumple: 0, grime: .4, rubble: 0 },
};

// Soot is a per-vertex amount, broken up by noise in the fragment shader so
// that it reads as burnt patches instead of smooth gradients on large panels.
const SOOT_NOISE = `
  varying float vSoot;
  varying vec3 vSootAt;
  vec3 sootGradient(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return -1. + 2. * fract(sin(p) * 43758.5453);
  }
  // Gradient noise, roughly within -0.6 to 0.6.
  float sootNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x), u = f * f * (3. - 2. * f);
    const vec2 o = vec2(0., 1.);
    return mix(
      mix(mix(dot(sootGradient(i + o.xxx), f - o.xxx), dot(sootGradient(i + o.yxx), f - o.yxx), u.x),
          mix(dot(sootGradient(i + o.xyx), f - o.xyx), dot(sootGradient(i + o.yyx), f - o.yyx), u.x), u.y),
      mix(mix(dot(sootGradient(i + o.xxy), f - o.xxy), dot(sootGradient(i + o.yxy), f - o.yxy), u.x),
          mix(dot(sootGradient(i + o.xyy), f - o.xyy), dot(sootGradient(i + o.yyy), f - o.yyy), u.x), u.y), u.z);
  }`;
function sootShader(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute float soot;
      varying float vSoot;
      varying vec3 vSootAt;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vSoot = soot;
      vSootAt = position;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>${SOOT_NOISE}`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      float sootMix = 0.;
      float emberSeam = 0.;
      if (vSoot > .001) {
        float grain = sootNoise(vSootAt * 1.1) * .55 + sootNoise(vSootAt.zxy * 2.9 + 7.) * .3 + sootNoise(vSootAt.yzx * 6.7 + 3.) * .15;
        // Clean surfaces stay clean: the grain alone never reaches the lower edge.
        float noisy = vSoot + clamp(grain, -.6, .6) * .55;
        float scrapeMix = smoothstep(.24, .42, noisy) * (1. - smoothstep(.44, .62, noisy));
        sootMix = smoothstep(.4, .58, noisy);
        float crack = abs(sootNoise(vSootAt * 4.8 + 11.3));
        emberSeam = (1. - smoothstep(.0, .09, crack)) * smoothstep(.80, .96, vSoot);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.38, .4, .37), scrapeMix * .7);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * .15 + .01, sootMix * .94);
      }`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 1., sootMix);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance *= 1. - sootMix;
      totalEmissiveRadiance += vec3(.85, .26, .04) * emberSeam * .55;`);
}
/** A copy of a standard material that shows the `soot` vertex attribute. */
export function sootVariant(material) {
  const variant = material.clone();
  variant.onBeforeCompile = sootShader;
  return variant;
}

// A smooth pattern, so vertices that share a corner bend together.
const wobble = (x, y, z, k) => Math.sin(x * 3.1 + y * 2.3 + k * 2.1) * Math.cos(z * 2.7 - y * 1.9 + k * 1.3);
const point = new THREE.Vector3(), center = new THREE.Vector3();
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
const tempVec = new THREE.Vector3(), tiltEuler = new THREE.Euler(), tiltMatrix = new THREE.Matrix4();

const fallbackMaterials = {};
function accessoryMaterial(materials, key, color, emissive = 0, intensity = 0) {
  if (materials?.[key]) return materials[key];
  if (!fallbackMaterials[key]) {
    fallbackMaterials[key] = new THREE.MeshStandardMaterial({
      color, roughness: .9, metalness: key === 'strap' ? .1 : 0, emissive, emissiveIntensity: intensity,
    });
  }
  return fallbackMaterials[key];
}

export class ModelDamage {
  /**
   * `materials.soot` maps a model material to its shared soot variant and
   * `materials.rubble` is the material of the chunks knocked off structures.
   */
  constructor(model, profile, materials, options = {}) {
    this.model = model; this.profile = PROFILES[profile]; this.materials = materials;
    this.kind = options.kind || profile; this.list = options.list ?? .08;
    this.wounds = []; this.parts = null; this.partByMesh = null; this.rubble = null; this.vented = 0;
    this.breakable = []; this.detached = []; this.bandages = null; this.bandageStage = 0;
    this.scars = []; this.sparkSockets = [];
  }
  /**
   * Open the wounds due at this share of health, facing `from` (a world
   * position) when the attacker is known. Returns the wounds opened.
   */
  update(fraction, from) {
    const due = fraction >= .999 ? 0
      : this.profile === PROFILES.infantry ? (fraction <= CRITICAL ? 3 : fraction <= DAMAGED ? 2 : 1)
      : fraction > DAMAGED ? 1
      : fraction > CRITICAL ? Math.max(2, Math.min(this.profile.wounds - 1, Math.ceil((1 - fraction) * this.profile.wounds)))
      : this.profile.wounds;
    if (due <= this.wounds.length) return [];
    if (!this.parts) this.prepare();
    const opened = [];
    while (this.wounds.length < due) {
      const wound = this.open(from);
      if (!wound) break;
      this.wounds.push(wound); opened.push(wound);
      if (this.profile.rubble) this.scatter(wound);
      this.damageParts(wound, fraction);
    }
    if (this.profile === PROFILES.infantry) this.updateBandages();
    this.repaint();
    return opened;
  }
  /** Return and clear detached breakable parts waiting to be spawned in world space. */
  takeDetached() {
    return this.detached.splice(0);
  }
  /** World position of a wound, into `target`. */
  locate(wound, target) {
    return wound.mesh.localToWorld(target.copy(wound.at));
  }
  /** The next of the `count` newest wounds or torn-part sockets to smoke, burn, or spark, into `target`. */
  vent(count, target) {
    if (this.sparkSockets.length && this.vented % 2 === 1) {
      const socket = this.sparkSockets[(this.vented++) % this.sparkSockets.length];
      return socket.parent.localToWorld(target.copy(socket.at));
    }
    const among = Math.min(count, this.wounds.length);
    return this.locate(this.wounds[this.wounds.length - 1 - this.vented++ % among], target);
  }
  // Models are untouched until the first wound: only then do their meshes get
  // a soot attribute, the soot materials and a copy of their undamaged shape.
  prepare() {
    this.parts = []; this.height = 0; this.halfX = 0; this.halfZ = 0;
    this.partByMesh = new Map();
    this.model.traverse(object => {
      if (!object.isMesh || object.isInstancedMesh || object.userData.decoration || object.userData.bandages || object.userData.scars) return;
      let ancestor = object.parent;
      while (ancestor && ancestor !== this.model) {
        if (ancestor.userData.decoration || ancestor.userData.bandages || ancestor.userData.scars) return;
        ancestor = ancestor.parent;
      }
      const position = object.geometry.attributes.position;
      object.geometry.setAttribute('soot', new THREE.BufferAttribute(new Float32Array(position.count), 1));
      object.material = this.materials.soot(object.material);
      const rest = position.array.slice();
      for (let i = 0; i < rest.length; i += 3) {
        this.halfX = Math.max(this.halfX, Math.abs(rest[i]));
        this.height = Math.max(this.height, rest[i + 1]);
        this.halfZ = Math.max(this.halfZ, Math.abs(rest[i + 2]));
      }
      const part = { mesh: object, rest };
      this.parts.push(part);
      this.partByMesh.set(object, part);
    });
    this.vertices = this.parts.reduce((sum, part) => sum + part.rest.length / 3, 0);
    this.breakable = this.model.userData.breakable || [];
  }
  // Pick the corner for a new wound: high on the model, on the side the hit
  // came from, and away from the wounds already there.
  open(from) {
    if (!this.vertices) return null;
    this.model.updateWorldMatrix(true, true);
    this.model.getWorldPosition(center);
    const fromX = from ? from.x - center.x : 0, fromZ = from ? from.z - center.z : 0;
    const fromLength = Math.hypot(fromX, fromZ);
    let best = null;
    for (let attempt = 0; attempt < 28; attempt++) {
      let index = Math.floor(Math.random() * this.vertices), part;
      for (part of this.parts) {
        if (index < part.rest.length / 3) break;
        index -= part.rest.length / 3;
      }
      const at = new THREE.Vector3().fromArray(part.rest, index * 3);
      part.mesh.localToWorld(point.copy(at));
      const x = point.x - center.x, z = point.z - center.z, length = Math.hypot(x, z);
      const facing = fromLength > .01 && length > .01 ? (x * fromX + z * fromZ) / (length * fromLength) : 0;
      let score = facing * 1.2 + Math.min(1, at.y / this.height) * .6 + Math.random() * .7;
      for (const wound of this.wounds) {
        if (wound.mesh.parent === part.mesh.parent && wound.at.distanceTo(at) < this.profile.reach * .6) score -= 1;
      }
      if (!best || score > best.score) best = { mesh: part.mesh, at, score };
    }
    return best;
  }
  // Loosen or blow off exterior parts near a newly opened wound.
  damageParts(wound, fraction) {
    if (!this.breakable.length) return;
    const byId = id => this.breakable.find(entry => entry.id === id);
    const side = Math.sign(this.list) || 1;
    const stage = this.wounds.length;
    if (this.profile === PROFILES.infantry) {
      if (this.kind === 'soldier') {
        if (stage >= 1) {
          this.detachPart(byId('pack-roll'), wound);
          const helmet = byId('helmet');
          if (helmet && helmet.state === 0) {
            helmet.state = 1;
            helmet.tilt = { rx: .35, ry: .16 * side, rz: .34 * side, dx: .05 * side, dy: .03, dz: .05 };
          }
        }
        if (stage >= 2) {
          this.detachPart(byId('helmet'), wound);
          const pack = byId('backpack');
          if (pack && pack.state < 2) {
            pack.state = 1;
            pack.tilt = { rx: .28, ry: -.18 * side, rz: -.3 * side, dx: -.05 * side, dy: -.02, dz: .06 };
          }
        }
        if (stage >= 3) this.detachPart(byId('backpack'), wound);
      } else {
        if (stage >= 1) {
          this.detachPart(byId(side < 0 ? 'kneepad-l' : 'kneepad-r'), wound);
          const shoulder = byId('shoulder-l');
          if (shoulder && shoulder.state < 2) {
            shoulder.state = 1;
            shoulder.tilt = { rx: .26, ry: -.14, rz: .42, dx: -.06, dy: -.02, dz: .03 };
          }
        }
        if (stage >= 2) {
          this.detachPart(byId('shoulder-l'), wound);
          const trim = byId('pod-trim');
          if (trim && trim.state < 2) {
            trim.state = 1;
            trim.tilt = { rx: .22, ry: .1, rz: -.36, dx: .05, dy: -.02, dz: .03 };
          }
          const pack = byId('backpack');
          if (pack && pack.state < 2) {
            pack.state = 1;
            pack.tilt = { rx: .26, ry: .16 * side, rz: .28 * side, dx: .05 * side, dy: -.02, dz: .06 };
          }
        }
        if (stage >= 3) {
          this.detachPart(byId('helmet-crest'), wound);
          this.detachPart(byId('pod-trim'), wound);
        }
      }
      return;
    }

    this.model.updateWorldMatrix(true, true);
    wound.mesh.localToWorld(point.copy(wound.at));
    const lightHit = fraction > DAMAGED && stage === 1;
    const rank = entry => {
      entry.parent.localToWorld(a.copy(entry.at));
      const bulk = Math.min(1.2, (entry.size.x + entry.size.y + entry.size.z) * .55);
      // Light hits target minor protruding gear before tearing off major armor plates.
      const sizePref = lightHit ? (entry.protruding || entry.size.length() < 1.1 ? 1.1 : -.8) : bulk;
      return -a.distanceTo(point) + (entry.state === 1 ? .75 : 0) + sizePref;
    };
    const remaining = () => this.breakable.filter(entry => entry.state < 2).sort((x, y) => rank(y) - rank(x));
    const smallPool = lightHit ? remaining().filter(e => (e.protruding || e.size.length() < 1.1) && e.size.length() < 1.4) : [];
    let candidates = smallPool.length ? smallPool : remaining();
    if (!candidates.length) return;
    this.detachPart(candidates[0], wound);
    if (!lightHit) {
      candidates = remaining();
      if (fraction <= CRITICAL && candidates.length >= 2) this.detachPart(candidates[0], wound);
    }
    candidates = remaining().filter(entry => entry.state === 0);
    const loosenCount = lightHit ? 1 : 2;
    for (let i = 0; i < Math.min(loosenCount, candidates.length); i++) {
      const loose = candidates[i];
      loose.state = 1;
      const signX = loose.at.x >= 0 ? 1 : -1;
      const signZ = loose.at.z >= 0 ? 1 : -1;
      const seed = Math.abs(Math.sin(loose.at.x * 13.7 + loose.at.z * 7.3 + stage + i));
      loose.tilt = {
        rx: signZ * (.28 + seed * .22),
        ry: (seed - .5) * .55,
        rz: -signX * (.3 + seed * .22),
        dx: signX * .09,
        dy: loose.at.y > 1.3 ? .04 : -.02,
        dz: signZ * .09,
      };
    }
  }
  detachPart(entry, wound) {
    if (!entry || entry.state === 2) return null;
    entry.state = 2;
    this.model.updateWorldMatrix(true, true);
    this.model.getWorldPosition(center);
    const origin = entry.parent.localToWorld(entry.at.clone());
    let outX = origin.x - center.x, outZ = origin.z - center.z;
    let length = Math.hypot(outX, outZ);
    if (length < .05 && wound) {
      wound.mesh.localToWorld(point.copy(wound.at));
      outX = point.x - center.x; outZ = point.z - center.z;
      length = Math.hypot(outX, outZ);
    }
    if (length > .01) { outX /= length; outZ /= length; }
    else { outX = Math.cos(this.wounds.length * 2.1); outZ = Math.sin(this.wounds.length * 2.1); }
    this.sparkSockets.push({ parent: entry.parent, at: entry.at.clone() });
    if (this.profile !== PROFILES.infantry) this.addInternalScar(entry);
    const item = {
      id: entry.id,
      shape: entry.shape || 'plate',
      origin,
      outX,
      outZ,
      size: entry.size.clone(),
      color: entry.color ?? 0x6e756e,
    };
    this.detached.push(item);
    if (wound) {
      if (!wound.detached) wound.detached = [];
      wound.detached.push(item);
    }
    return item;
  }
  // Leave a flush recessed cavity with twisted metal ribs or a snapped pipe stub where a part tore off.
  addInternalScar(entry) {
    const cavityMat = accessoryMaterial(this.materials, 'cavity', 0x161918);
    const scrapMat = accessoryMaterial(this.materials, 'scrapMetal', 0x5c6368);
    const wireMat = accessoryMaterial(this.materials, 'wire', 0xd89634, 0x2ec8ff, .45);
    const group = new THREE.Group();
    group.userData.scars = true;
    const add = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      mesh.userData.scars = true;
      group.add(mesh);
    };
    if (entry.protruding) {
      // Anchor a crimped stub back toward the mount so protruding parts never leave midair blocks.
      const forwardBarrel = entry.at.z < -2.0;
      const tallRod = !forwardBarrel && entry.at.y > 1.7 && entry.shape === 'rod';
      const ox = !forwardBarrel && !tallRod && Math.abs(entry.at.x) > .4 ? -Math.sign(entry.at.x) * Math.min(.16, entry.size.x * .35) : 0;
      const oy = tallRod ? -entry.size.y * .46 : 0;
      const oz = forwardBarrel ? Math.min(.22, entry.size.z * .35) : 0;
      group.position.set(entry.at.x + ox, entry.at.y + oy, entry.at.z + oz);
      add(new THREE.CylinderGeometry(.045, .065, .24, 6), scrapMat, 0, 0, 0, forwardBarrel ? Math.PI / 2 : .35, 0, .3);
      add(new THREE.CylinderGeometry(.026, .026, .20, 5), wireMat, .04, .06, .02, .5, .2, -.45);
    } else {
      const offY = entry.at.y > 1.3 && entry.size.y < .4 ? -entry.size.y * .42 : 0;
      const offX = Math.abs(entry.at.x) > .7 ? -Math.sign(entry.at.x) * entry.size.x * .35 : 0;
      group.position.set(entry.at.x + offX, entry.at.y + offY, entry.at.z);
      const cw = Math.min(.62, Math.max(.18, entry.size.x * .62));
      const ch = Math.min(.16, Math.max(.06, entry.size.y * .45));
      const cd = Math.min(.62, Math.max(.18, entry.size.z * .62));
      add(new THREE.BoxGeometry(cw, ch, cd), cavityMat, 0, 0, 0);
      add(new THREE.BoxGeometry(cw * .78, Math.max(.04, ch * .45), Math.max(.06, cd * .2)), scrapMat, 0, ch * .35, 0, .18, .4, -.25);
      add(new THREE.CylinderGeometry(.03, .03, .22, 5), wireMat, cw * .22, ch * .4, cd * .12, .55, 0, .4);
      add(new THREE.CylinderGeometry(.025, .025, .18, 5), wireMat, -cw * .18, ch * .35, -cd * .1, -.45, .3, -.35);
    }
    entry.parent.add(group);
    this.scars.push(group);
  }
  // Attach bandages, splints and field dressings as infantry take wounds.
  updateBandages() {
    if (this.bandageStage >= this.wounds.length) return;
    if (!this.bandages) {
      this.bandages = new THREE.Group();
      this.bandages.userData.bandages = true;
      this.model.add(this.bandages);
    }
    const gauze = accessoryMaterial(this.materials, 'bandage', 0xe2dbc8);
    const blood = accessoryMaterial(this.materials, 'blood', 0x961816);
    const strap = accessoryMaterial(this.materials, 'strap', 0x251d17);
    const splint = accessoryMaterial(this.materials, 'splint', 0xb07d4b);
    const add = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.bandages = true;
      this.bandages.add(mesh);
      return mesh;
    };
    const side = Math.sign(this.list) || 1;
    const rocket = this.kind === 'rocket';
    const legX = side * (rocket ? .22 : .17);
    while (this.bandageStage < this.wounds.length) {
      this.bandageStage++;
      if (this.bandageStage === 1) {
        const w = rocket ? .37 : .28, d = rocket ? .41 : .33;
        add(new THREE.BoxGeometry(w, .21, d), gauze, legX, .44, 0);
        add(new THREE.BoxGeometry(w * .62, .11, .022), blood, legX + side * .02, .44, -(d / 2 + .006));
        add(new THREE.BoxGeometry(.022, .11, d * .58), blood, legX + side * (w / 2 + .006), .44, -.02);
        add(new THREE.BoxGeometry(w + .03, .05, d + .03), strap, legX, .58, 0);
        if (!rocket) {
          add(new THREE.CylinderGeometry(.212, .212, .08, 10), gauze, 0, 1.63, -.02);
          add(new THREE.BoxGeometry(.09, .06, .03), blood, -side * .16, 1.63, -.14);
        }
      } else if (this.bandageStage === 2) {
        // Slim diagonal torso sling so the faction vest remains clearly visible.
        add(new THREE.BoxGeometry(rocket ? .88 : .69, .12, rocket ? .56 : .46), gauze, 0, 1.18, 0, 0, 0, side * .52);
        add(new THREE.BoxGeometry(.16, .10, .025), blood, side * .04, 1.18, rocket ? -.29 : -.24, 0, 0, side * .25);
        add(new THREE.BoxGeometry(.14, .09, .025), blood, -side * .08, 1.21, rocket ? .29 : .24);
        const armX = -side * (rocket ? .56 : .37);
        add(new THREE.BoxGeometry(rocket ? .30 : .21, .16, rocket ? .34 : .25), gauze, armX, 1.0, -.12, rocket ? 0 : -.6);
        add(new THREE.BoxGeometry(rocket ? .12 : .09, .08, rocket ? .16 : .12), blood, armX - side * .09, 1.0, -.14, rocket ? 0 : -.6);
        if (rocket) {
          // Cover the torn left shoulder armor gap; never bandage over a closed steel helmet.
          add(new THREE.BoxGeometry(.38, .18, .44), gauze, -.50, 1.44, 0);
          add(new THREE.BoxGeometry(.22, .09, .26), blood, -.54, 1.49, -.04);
        } else {
          // Snug cranium bandage revealed after helmet flies off, with front (-Z) jaw strap.
          add(new THREE.CylinderGeometry(.205, .212, .16, 10), gauze, 0, 1.66, -.02);
          add(new THREE.BoxGeometry(.18, .04, .34), gauze, 0, 1.73, -.02);
          add(new THREE.BoxGeometry(.14, .08, .03), blood, .04 * side, 1.67, -.215);
          add(new THREE.BoxGeometry(.22, .06, .09), gauze, 0, 1.49, -.16);
          for (const s of [-1, 1]) add(new THREE.BoxGeometry(.05, .14, .03), gauze, s * .04, 1.54, .19, .22, 0, s * .22);
          add(new THREE.BoxGeometry(.14, .16, .18), gauze, -side * .34, .78, .05);
          add(new THREE.BoxGeometry(.15, .04, .19), strap, -side * .34, .82, .05);
        }
      } else if (this.bandageStage === 3) {
        // Place wooden splints OUTSIDE the gauze wrap so they are clearly visible.
        const offset = rocket ? .20 : .165;
        for (const s of [-1, 1]) add(new THREE.BoxGeometry(.05, .54, .11), splint, legX + s * offset, .38, 0);
        for (const y of [.24, .54]) add(new THREE.BoxGeometry(rocket ? .47 : .38, .055, rocket ? .43 : .36), strap, legX, y, 0);
        // Always mount the crutch on the left (-X) side to clear right-hand rifle & right-shoulder rocket pod.
        const crutchX = rocket ? -.66 : -.44;
        add(new THREE.BoxGeometry(.14, .08, .32), gauze, crutchX, 1.14, -.02);
        add(new THREE.CylinderGeometry(.052, .038, 1.18, 6), splint, crutchX - .05, .57, -.03, 0, 0, .09);
        add(new THREE.BoxGeometry(.09, .06, .22), splint, crutchX - .02, .72, -.02);
      }
    }
  }
  // Recompute soot and shape from the undamaged model and every wound.
  repaint() {
    const { reach, sag, crumple, grime, wounds: most } = this.profile;
    const worn = grime * this.wounds.length / most;
    const baseFloor = this.profile === PROFILES.emplacement ? .38 : .2;
    for (const part of this.parts) {
      const wounds = this.wounds.filter(wound => wound.mesh.parent === part.mesh.parent);
      const { position, soot } = part.mesh.geometry.attributes, rest = part.rest;
      const bent = part.bent = new Uint8Array(position.count);
      for (let i = 0; i < position.count; i++) {
        const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
        // The base stays planted: walls and roofs give way above it.
        const loose = Math.max(0, Math.min(1, y - baseFloor));
        let clean = 1 - worn, dx = 0, dy = 0, dz = 0;
        for (const wound of wounds) {
          const distance = Math.hypot(x - wound.at.x, y - wound.at.y, z - wound.at.z);
          if (distance >= reach) continue;
          const near = 1 - distance / reach;
          clean *= 1 - Math.min(1, near * 1.25);
          const push = near * near * loose, axis = Math.hypot(wound.at.x, wound.at.z) || 1;
          dx += push * (-wound.at.x / axis * sag * .5 + crumple * wobble(x, y, z, 0));
          dy += push * (-sag + crumple * .5 * wobble(x, y, z, 1));
          dz += push * (-wound.at.z / axis * sag * .5 + crumple * wobble(x, y, z, 2));
        }
        soot.array[i] = 1 - clean;
        position.setXYZ(i, x + dx, y + dy, z + dz);
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > .004) bent[i] = 1;
      }
    }
    for (const entry of this.breakable) {
      if (entry.state === 1 && entry.tilt) {
        tiltEuler.set(entry.tilt.rx, entry.tilt.ry, entry.tilt.rz);
        tiltMatrix.makeRotationFromEuler(tiltEuler);
        for (const span of entry.spans) {
          const part = this.partByMesh.get(span.mesh);
          if (!part) continue;
          const { position, soot } = span.mesh.geometry.attributes;
          for (let i = span.start; i < span.start + span.count; i++) {
            tempVec.fromBufferAttribute(position, i).sub(entry.at).applyMatrix4(tiltMatrix).add(entry.at);
            position.setXYZ(i, tempVec.x + entry.tilt.dx, tempVec.y + entry.tilt.dy, tempVec.z + entry.tilt.dz);
            part.bent[i] = 1;
            soot.array[i] = Math.max(soot.array[i], .48);
          }
        }
      } else if (entry.state === 2) {
        for (const span of entry.spans) {
          const { position, soot } = span.mesh.geometry.attributes;
          for (let i = span.start; i < span.start + span.count; i++) {
            position.setXYZ(i, entry.at.x * .65, entry.at.y, entry.at.z * .65);
            soot.array[i] = 1;
          }
        }
        const scarReach = Math.max(entry.size.x, entry.size.y, entry.size.z) * .85;
        for (const part of this.parts) {
          if (part.mesh.parent !== entry.parent) continue;
          const { soot } = part.mesh.geometry.attributes, rest = part.rest;
          for (let i = 0; i < soot.count; i++) {
            const d = Math.hypot(rest[i * 3] - entry.at.x, rest[i * 3 + 1] - entry.at.y, rest[i * 3 + 2] - entry.at.z);
            if (d < scarReach) soot.array[i] = Math.max(soot.array[i], Math.min(1, (1 - d / scarReach) * .9 + .25));
          }
        }
      }
    }
    for (const part of this.parts) {
      const { position, normal, soot } = part.mesh.geometry.attributes, bent = part.bent;
      // Bent panels are lit as the facets they now are.
      for (let i = 0; i < position.count; i += 3) {
        if (!bent[i] && !bent[i + 1] && !bent[i + 2]) continue;
        a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, i + 1); c.fromBufferAttribute(position, i + 2);
        b.sub(a); c.sub(a); b.cross(c).normalize();
        for (let j = i; j < i + 3; j++) normal.setXYZ(j, b.x, b.y, b.z);
      }
      position.needsUpdate = normal.needsUpdate = soot.needsUpdate = true;
    }
  }
  // Chunks knocked off a structure land on the ground outside the wall.
  scatter(wound) {
    const body = wound.mesh.parent, each = this.profile.rubble;
    if (!this.rubble) {
      this.rubble = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.materials.rubble, this.profile.wounds * each);
      this.rubble.count = 0; this.rubble.castShadow = true; this.rubble.receiveShadow = true;
      this.rubble.frustumCulled = false;
      body.add(this.rubble);
    }
    const axis = Math.hypot(wound.at.x, wound.at.z) || 1;
    const outX = wound.at.x / axis, outZ = wound.at.z / axis;
    const wall = Math.min(this.halfX / Math.max(1e-3, Math.abs(outX)), this.halfZ / Math.max(1e-3, Math.abs(outZ)));
    const transform = new THREE.Object3D(), color = new THREE.Color();
    for (let i = 0; i < each; i++) {
      const out = wall + .2 + Math.random() * 1.3, along = (Math.random() - .5) * 2.6;
      const size = .22 + Math.random() * .36;
      transform.position.set(outX * out - outZ * along, size * .22, outZ * out + outX * along);
      transform.rotation.set(Math.random() * .5, Math.random() * 6.28, Math.random() * .5);
      transform.scale.set(size * (1 + Math.random() * .8), size * .55, size);
      transform.updateMatrix();
      this.rubble.setMatrixAt(this.rubble.count, transform.matrix);
      this.rubble.setColorAt(this.rubble.count++, color.setHSL(.12, .08, .1 + Math.random() * .2));
    }
    this.rubble.instanceMatrix.needsUpdate = true; this.rubble.instanceColor.needsUpdate = true;
  }
}

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
  emplacement: { wounds: 5, reach: 2.1, sag: .14, crumple: .08, grime: .26, rubble: 0 },
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
      if (vSoot > .001) {
        float grain = sootNoise(vSootAt * 1.1) * .55 + sootNoise(vSootAt.zxy * 2.9 + 7.) * .3 + sootNoise(vSootAt.yzx * 6.7 + 3.) * .15;
        // Clean surfaces stay clean: the grain alone never reaches the lower edge.
        sootMix = smoothstep(.4, .58, vSoot + clamp(grain, -.6, .6) * .55);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * .15 + .01, sootMix * .94);
      }`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 1., sootMix);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance *= 1. - sootMix;`);
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

export class ModelDamage {
  /**
   * `materials.soot` maps a model material to its shared soot variant and
   * `materials.rubble` is the material of the chunks knocked off structures.
   */
  constructor(model, profile, materials) {
    this.model = model; this.profile = PROFILES[profile]; this.materials = materials;
    this.wounds = []; this.parts = null; this.rubble = null; this.vented = 0;
  }
  /**
   * Open the wounds due at this share of health, facing `from` (a world
   * position) when the attacker is known. Returns the wounds opened.
   */
  update(fraction, from) {
    const due = Math.min(this.profile.wounds, Math.floor((1 - fraction) * (this.profile.wounds + 1)));
    if (due <= this.wounds.length) return [];
    if (!this.parts) this.prepare();
    const opened = [];
    while (this.wounds.length < due) {
      const wound = this.open(from);
      if (!wound) break;
      this.wounds.push(wound); opened.push(wound);
      if (this.profile.rubble) this.scatter(wound);
    }
    this.repaint();
    return opened;
  }
  /** World position of a wound, into `target`. */
  locate(wound, target) {
    return wound.mesh.localToWorld(target.copy(wound.at));
  }
  /** The next of the `count` newest wounds to smoke or burn, into `target`. */
  vent(count, target) {
    const among = Math.min(count, this.wounds.length);
    return this.locate(this.wounds[this.wounds.length - 1 - this.vented++ % among], target);
  }
  // Models are untouched until the first wound: only then do their meshes get
  // a soot attribute, the soot materials and a copy of their undamaged shape.
  prepare() {
    this.parts = []; this.height = 0; this.halfX = 0; this.halfZ = 0;
    this.model.traverse(object => {
      if (!object.isMesh || object.isInstancedMesh || object.userData.decoration) return;
      const position = object.geometry.attributes.position;
      object.geometry.setAttribute('soot', new THREE.BufferAttribute(new Float32Array(position.count), 1));
      object.material = this.materials.soot(object.material);
      const rest = position.array.slice();
      for (let i = 0; i < rest.length; i += 3) {
        this.halfX = Math.max(this.halfX, Math.abs(rest[i]));
        this.height = Math.max(this.height, rest[i + 1]);
        this.halfZ = Math.max(this.halfZ, Math.abs(rest[i + 2]));
      }
      this.parts.push({ mesh: object, rest });
    });
    this.vertices = this.parts.reduce((sum, part) => sum + part.rest.length / 3, 0);
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
  // Recompute soot and shape from the undamaged model and every wound.
  repaint() {
    const { reach, sag, crumple, grime, wounds: most } = this.profile;
    const worn = grime * this.wounds.length / most;
    for (const part of this.parts) {
      const wounds = this.wounds.filter(wound => wound.mesh.parent === part.mesh.parent);
      const { position, normal, soot } = part.mesh.geometry.attributes, rest = part.rest;
      const bent = new Uint8Array(position.count);
      for (let i = 0; i < position.count; i++) {
        const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
        // The base stays planted: walls and roofs give way above it.
        const loose = Math.max(0, Math.min(1, y - .2));
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

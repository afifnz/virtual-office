import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Smooth 2D ("cel") look for the avatars.
 *
 * The Quaternius packs are flat-shaded low-poly: every triangle owns its own
 * normal, so under the warm office lights a face or an arm reads as a cluster
 * of facets. Three things turn that into a clean illustrated figure:
 *
 *  1. welded vertices + recomputed normals, so light rolls across the body;
 *  2. a toon material with a soft three-band ramp (light / mid / shade), so
 *     shading reads as flat paint instead of plastic;
 *  3. a thin ink outline (inverted hull), which is what makes it read as
 *     drawn rather than rendered.
 */

let ramp: THREE.Texture | null = null

/** Three soft bands. Linear filtering over a 64 px ramp keeps band edges smooth. */
export function toonRamp(): THREE.Texture {
  if (ramp) return ramp
  const n = 64
  const data = new Uint8Array(n * 4)
  const band = (x: number) => {
    // smoothstep edges at ~0.32 and ~0.62: shade -> mid -> light
    const s = (e0: number, e1: number, v: number) => {
      const t = THREE.MathUtils.clamp((v - e0) / (e1 - e0), 0, 1)
      return t * t * (3 - 2 * t)
    }
    return 0.62 + 0.2 * s(0.26, 0.36, x) + 0.18 * s(0.56, 0.66, x)
  }
  for (let i = 0; i < n; i++) {
    const v = Math.round(band(i / (n - 1)) * 255)
    data.set([v, v, v, 255], i * 4)
  }
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  ramp = tex
  return tex
}

/** Copy the look of a standard material onto a toon material. */
export function toToon(src: THREE.Material): THREE.Material {
  const s = src as THREE.MeshStandardMaterial
  if (!(s as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) return src
  const m = new THREE.MeshToonMaterial({
    name: s.name,
    color: s.color.clone(),
    map: s.map,
    emissive: s.emissive.clone(),
    emissiveIntensity: s.emissiveIntensity,
    transparent: s.transparent,
    opacity: s.opacity,
    side: s.side,
    depthWrite: s.depthWrite,
    alphaTest: s.alphaTest,
    alphaMap: s.alphaMap,
    // the sculpted hair carries its shading in vertex colours
    vertexColors: s.vertexColors,
    polygonOffset: s.polygonOffset,
    polygonOffsetFactor: s.polygonOffsetFactor,
    polygonOffsetUnits: s.polygonOffsetUnits,
    gradientMap: toonRamp(),
  })
  return m
}

/** Swap every standard material under `root` for its toon twin. */
export function toonify(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || mesh.userData.outline) return
    const mat = mesh.material
    if (Array.isArray(mat)) {
      mesh.material = mat.map((x) => {
        const t = toToon(x)
        if (t !== x) x.dispose()
        return t
      })
    } else if (mat) {
      const t = toToon(mat)
      if (t !== mat) mat.dispose()
      mesh.material = t
    }
  })
}

const smoothCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>()

/**
 * Weld a flat-shaded geometry and recompute smooth normals. Shared by every
 * clone of the same pack mesh (SkeletonUtils.clone shares geometry), so the
 * work is done once per model, not once per agent.
 */
export function smoothGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const hit = smoothCache.get(g)
  if (hit) return hit
  const work = g.clone()
  // normals and uvs differ per facet and would stop the weld; the packs carry
  // no textures, so the uvs are not needed
  work.deleteAttribute('normal')
  if (work.getAttribute('uv')) work.deleteAttribute('uv')
  const merged = mergeVertices(work, 1e-4)
  merged.computeVertexNormals()
  merged.computeBoundingSphere()
  work.dispose()
  smoothCache.set(g, merged)
  return merged
}

const INK = new THREE.Color('#2a1d17')

/**
 * Inverted-hull outline for a skinned mesh: the same geometry and skeleton,
 * back faces only, pushed out along the skinned normal. `thickness` is in the
 * mesh's local units per metre of camera distance (the caller converts).
 */
export function addOutline(mesh: THREE.SkinnedMesh, thickness: number): THREE.SkinnedMesh {
  const mat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: thickness }
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float uOutline;\nvoid main() {')
      .replace(
        '#include <skinning_vertex>',
        // width grows with camera distance, so the ink stays ~1-2 px on screen:
        // hairline in a close-up, still legible in the overview
        '#include <skinning_vertex>\n#ifdef USE_SKINNING\n  float inkDist = clamp(-(modelViewMatrix * vec4(transformed, 1.0)).z, 0.8, 9.0);\n  transformed += normalize(objectNormal) * uOutline * inkDist;\n#endif',
      )
  }
  mat.customProgramCacheKey = () => `outline-${thickness.toFixed(5)}`
  const line = new THREE.SkinnedMesh(mesh.geometry, mat)
  line.name = `${mesh.name}-outline`
  line.userData.outline = true
  line.bind(mesh.skeleton, mesh.bindMatrix)
  line.bindMode = mesh.bindMode
  line.frustumCulled = false
  line.castShadow = false
  line.receiveShadow = false
  line.raycast = () => {}
  mesh.add(line)
  return line
}

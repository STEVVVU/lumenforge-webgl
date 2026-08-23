/**
 * Math adapter over `gl-matrix`.
 *
 * The engine used to hand-roll every mat4/vec3/quat operation. That is the one
 * piece of a raw-WebGL2 codebase nobody should write themselves: the algebra is
 * standard, and the failure mode is silent (a transposed matrix or a flipped
 * handedness still renders, just wrong). `gl-matrix` is the de-facto library for
 * raw-WebGL projects, so the algebra now lives there and this module is a thin,
 * typed adapter that keeps the engine's ergonomic `Vec3` tuple API.
 *
 * ## Conventions (assumed everywhere below, and by every shader in shaders.ts)
 *
 * - **Column-major storage.** A mat4 is 16 floats laid out as 4 contiguous
 *   columns, which is exactly what `gl.uniformMatrix4fv(loc, false, m)` expects
 *   with `transpose = false`. Element `[column * 4 + row]`. Translation
 *   therefore lives in elements 12, 13, 14. This matches both `gl-matrix` and
 *   the glTF 2.0 spec's `node.matrix`, so glTF matrices are consumed verbatim.
 * - **Pre-multiplication / points as column vectors.** Transforms compose
 *   right-to-left: `mat4Multiply(projection, view)` applies `view` first.
 *   Equivalently `clip = P * V * M * position`.
 * - **Right-handed world space, +Y up.** `mat4LookAt` builds a right-handed
 *   view basis whose third column points from the target back toward the eye
 *   (i.e. +Z points toward the viewer), so the camera looks down -Z in view
 *   space. `mat4Perspective` maps that to the GL clip volume with depth in
 *   [-1, 1].
 *
 * ## Deliberate deviations from raw `gl-matrix`
 *
 * Each of these was verified against the previous hand-rolled implementation;
 * they are preserved on purpose and are NOT oversights:
 *
 * 1. `quaternionFromEuler` uses `quat.fromEuler(..., "xyz")` and converts
 *    radians to degrees. `gl-matrix` takes **degrees** and defaults to **"zyx"**
 *    order; using the default would silently reorient every rotated object.
 * 2. Quaternions are accumulated in a plain (float64) array rather than
 *    `quat.create()` (a Float32Array). Rounding the quaternion to float32 before
 *    composing the model matrix perturbed the result by up to 2.4e-7; keeping it
 *    float64 reproduces the previous matrices bit-for-bit.
 * 3. `mat4Invert` throws on a singular matrix where `gl-matrix` returns `null`,
 *    so callers keep their fail-fast contract.
 * 4. Vector magnitude uses `Math.hypot`, not `vec3.length`. `vec3.length`
 *    computes `sqrt(x*x + y*y + z*z)`, which overflows to `Infinity` for
 *    coordinates around 1e200 and underflows to 0 around 1e-200. Bounds are
 *    computed from untrusted glTF vertex data, so the overflow-safe form is
 *    kept.
 * 5. `vec3Normalize` and `transformPoint` keep their `EPSILON` guards.
 *    `gl-matrix` only special-cases exact zero, so a denormal-scale vector would
 *    otherwise normalize to a garbage unit vector, and a near-zero `w` would
 *    divide by ~0 instead of falling back to 1.
 * 6. The scalar `vec3*` helpers pass a plain `[0, 0, 0]` as the `out` parameter
 *    instead of `vec3.create()`. `gl-matrix`'s constructor returns a
 *    Float32Array, which would quietly round every intermediate to float32; a
 *    plain array keeps these float64, matching the previous implementation.
 */
import { mat3, mat4, quat, vec3, vec4 } from "gl-matrix";
import type { BoundingSphere, Vec3 } from "./types";

/**
 * Column-major 4x4 matrix, explicitly backed by an `ArrayBuffer`.
 *
 * The explicit type argument matters: TypeScript 5.9 made the typed arrays
 * generic over their backing buffer and infers the wider `ArrayBufferLike` (which
 * also admits `SharedArrayBuffer`) for a bare `new Float32Array(16)`. Everything
 * here allocates a plain `ArrayBuffer`, so saying so keeps these assignable to
 * the renderer's fields and to `gl.uniformMatrix4fv` without casts.
 */
export type Mat4 = Float32Array<ArrayBuffer>;

/** Column-major 3x3 matrix (the normal matrix), same buffer caveat as `Mat4`. */
export type Mat3 = Float32Array<ArrayBuffer>;

const EPSILON = 1e-8;
const RADIANS_TO_DEGREES = 180 / Math.PI;

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return vec3.add([0, 0, 0], a, b) as Vec3;
}

export function vec3Subtract(a: Vec3, b: Vec3): Vec3 {
  return vec3.subtract([0, 0, 0], a, b) as Vec3;
}

export function vec3Scale(v: Vec3, scale: number): Vec3 {
  return vec3.scale([0, 0, 0], v, scale) as Vec3;
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return vec3.dot(a, b);
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return vec3.cross([0, 0, 0], a, b) as Vec3;
}

/**
 * Vector magnitude. Uses `Math.hypot` rather than `vec3.length`; see deviation
 * (4) in the module comment.
 */
export function vec3Length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

/**
 * Unit vector, or the zero vector when the input is shorter than `EPSILON`.
 * The guard is intentional; see deviation (5).
 */
export function vec3Normalize(v: Vec3): Vec3 {
  const length = vec3Length(v);
  if (length < EPSILON) return [0, 0, 0];
  return vec3Scale(v, 1 / length);
}

export function mat4Identity(): Mat4 {
  return mat4.create() as Mat4;
}

/**
 * Returns `a * b` under the pre-multiplication convention: the result applies
 * `b` first, then `a`. So `mat4Multiply(projection, view)` is the usual
 * view-projection, and `mat4Multiply(parent, local)` composes a glTF node onto
 * its parent.
 */
export function mat4Multiply(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
  return mat4.multiply(new Float32Array(16), a as mat4, b as mat4) as Mat4;
}

/**
 * Right-handed perspective projection into the GL clip volume (depth -1..1),
 * looking down -Z in view space.
 */
export function mat4Perspective(
  fieldOfViewRadians: number,
  aspect: number,
  near: number,
  far: number,
): Mat4 {
  return mat4.perspective(
    new Float32Array(16),
    fieldOfViewRadians,
    aspect,
    near,
    far,
  ) as Mat4;
}

/**
 * Right-handed orthographic projection (depth -1..1). Used for the directional
 * shadow map, where the light's frustum is a box around the scene bounds.
 */
export function mat4Ortho(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Mat4 {
  return mat4.ortho(
    new Float32Array(16),
    left,
    right,
    bottom,
    top,
    near,
    far,
  ) as Mat4;
}

/**
 * Right-handed view matrix. The camera sits at `eye` looking at `target` with
 * `up` as the world up hint; in the resulting view space the camera looks down
 * -Z, so the basis' third column points from `target` back toward `eye`.
 */
export function mat4LookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  return mat4.lookAt(new Float32Array(16), eye, target, up) as Mat4;
}

/**
 * Full 4x4 inverse.
 *
 * @throws if the matrix is singular. `gl-matrix` signals this by returning
 * `null`; callers here rely on the throw, so it is translated (deviation 3).
 */
export function mat4Invert(matrix: ArrayLike<number>): Mat4 {
  const out = mat4.invert(new Float32Array(16), matrix as mat4);
  if (!out) throw new Error("Cannot invert a singular matrix.");
  return out as Mat4;
}

export function mat4Transpose(matrix: ArrayLike<number>): Mat4 {
  return mat4.transpose(new Float32Array(16), matrix as mat4) as Mat4;
}

/**
 * Normal matrix: the inverse transpose of the model matrix' upper-left 3x3,
 * which is what correctly rotates normals under non-uniform scale. Column-major
 * 3x3, ready for `gl.uniformMatrix3fv(loc, false, m)`.
 *
 * Replaces the previous "transpose(invert(model)) then slice out the upper 3x3"
 * dance with the operation `gl-matrix` exposes directly.
 *
 * @throws if the model matrix is singular (e.g. a zero scale axis), matching
 * `mat4Invert`'s fail-fast contract.
 */
export function mat3NormalFromMat4(model: ArrayLike<number>): Mat3 {
  const out = mat3.normalFromMat4(new Float32Array(9), model as mat4);
  if (!out) {
    throw new Error("Cannot derive a normal matrix from a singular model matrix.");
  }
  return out as Mat3;
}

/**
 * Composes translation, rotation and scale into a column-major model matrix
 * (scale applied first, then rotation, then translation).
 *
 * Argument order is kept as `(translation, quaternion, scale)` to match the
 * engine's call sites and glTF's TRS field order. Note `gl-matrix`'s own
 * signature is `(out, quaternion, translation, scale)` — the first two value
 * arguments are swapped relative to this function.
 */
export function mat4FromRotationTranslationScale(
  translation: Vec3,
  quaternion: [number, number, number, number],
  scale: Vec3,
): Mat4 {
  return mat4.fromRotationTranslationScale(
    new Float32Array(16),
    quaternion,
    translation,
    scale,
  ) as Mat4;
}

/**
 * Euler angles (**radians**, intrinsic XYZ order) to a quaternion `[x, y, z, w]`.
 *
 * Two conversions happen here and both matter: `gl-matrix` takes **degrees**,
 * and its default rotation order is **"zyx"**, so `"xyz"` is passed explicitly.
 * The result is accumulated in a float64 array rather than a `Float32Array` to
 * avoid rounding the quaternion before it is composed into a model matrix.
 * See deviations (1) and (2).
 */
export function quaternionFromEuler(
  x: number,
  y: number,
  z: number,
): [number, number, number, number] {
  return quat.fromEuler(
    [0, 0, 0, 1],
    x * RADIANS_TO_DEGREES,
    y * RADIANS_TO_DEGREES,
    z * RADIANS_TO_DEGREES,
    "xyz",
  ) as [number, number, number, number];
}

/**
 * Transforms a point by a matrix, dividing through by the resulting `w` so
 * projective matrices (e.g. an inverse view-projection) unproject correctly.
 *
 * `vec4.transformMat4` is used rather than `vec3.transformMat4` because the vec3
 * variant divides by `w || 1` internally, which hides `w` from the caller and so
 * cannot express the `EPSILON` fallback below (deviation 5). Promoting the point
 * to `w = 1` makes the homogeneous divide explicit.
 */
export function transformPoint(matrix: ArrayLike<number>, point: Vec3): Vec3 {
  const clip = vec4.transformMat4(
    [0, 0, 0, 0],
    [point[0], point[1], point[2], 1],
    matrix as mat4,
  );
  const w = clip[3];
  const inverseW = Math.abs(w) > EPSILON ? 1 / w : 1;
  return [clip[0] * inverseW, clip[1] * inverseW, clip[2] * inverseW];
}

/**
 * Transforms a direction (not a point) by a matrix's upper-left 3x3 and
 * renormalizes. Translation is deliberately ignored, which is what makes this
 * correct for light directions.
 *
 * Note this uses the plain basis, not the inverse transpose, so it is only
 * correct for rotations and uniform scale — which is all glTF node hierarchies
 * apply to punctual light orientations here.
 */
export function transformDirection(matrix: ArrayLike<number>, direction: Vec3): Vec3 {
  const basis = mat3.fromMat4(new Float32Array(9), matrix as mat4);
  return vec3Normalize(vec3.transformMat3([0, 0, 0], direction, basis) as Vec3);
}

/**
 * Conservative bounding-sphere transform: the centre is transformed as a point
 * and the radius is scaled by the largest of the three basis-vector lengths.
 * Using the maximum keeps the sphere enclosing under non-uniform scale (it may
 * over-estimate, which is safe for culling; under-estimating would pop geometry).
 */
export function transformBoundingSphere(
  matrix: ArrayLike<number>,
  sphere: BoundingSphere,
): BoundingSphere {
  // Basis-vector lengths == per-axis scale. Column-major, so the X basis is
  // elements 0..2, Y is 4..6 and Z is 8..10.
  const scaleX = Math.hypot(matrix[0] ?? 0, matrix[1] ?? 0, matrix[2] ?? 0);
  const scaleY = Math.hypot(matrix[4] ?? 0, matrix[5] ?? 0, matrix[6] ?? 0);
  const scaleZ = Math.hypot(matrix[8] ?? 0, matrix[9] ?? 0, matrix[10] ?? 0);
  return {
    center: transformPoint(matrix, sphere.center),
    radius: sphere.radius * Math.max(scaleX, scaleY, scaleZ),
  };
}

export function calculateBounds(positions: ArrayLike<number>): BoundingSphere {
  if (positions.length < 3) return { center: [0, 0, 0], radius: 0 };
  let minimum: Vec3 = [Infinity, Infinity, Infinity];
  let maximum: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index] ?? 0;
    const y = positions[index + 1] ?? 0;
    const z = positions[index + 2] ?? 0;
    minimum = [Math.min(minimum[0], x), Math.min(minimum[1], y), Math.min(minimum[2], z)];
    maximum = [Math.max(maximum[0], x), Math.max(maximum[1], y), Math.max(maximum[2], z)];
  }
  const center: Vec3 = [
    (minimum[0] + maximum[0]) / 2,
    (minimum[1] + maximum[1]) / 2,
    (minimum[2] + maximum[2]) / 2,
  ];
  let radius = 0;
  for (let index = 0; index < positions.length; index += 3) {
    radius = Math.max(
      radius,
      vec3Length([
        (positions[index] ?? 0) - center[0],
        (positions[index + 1] ?? 0) - center[1],
        (positions[index + 2] ?? 0) - center[2],
      ]),
    );
  }
  return { center, radius };
}

export function mergeSpheres(spheres: BoundingSphere[]): BoundingSphere {
  if (spheres.length === 0) return { center: [0, 0, 0], radius: 1 };
  const center = spheres.reduce<Vec3>(
    (sum, sphere) => vec3Add(sum, sphere.center),
    [0, 0, 0],
  );
  const averaged = vec3Scale(center, 1 / spheres.length);
  const radius = spheres.reduce(
    (maximum, sphere) =>
      Math.max(maximum, vec3Length(vec3Subtract(sphere.center, averaged)) + sphere.radius),
    0,
  );
  return { center: averaged, radius };
}

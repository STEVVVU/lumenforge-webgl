import { describe, expect, it } from "vitest";
import { mat3, mat4, quat, vec3 } from "gl-matrix";
import {
  mat3NormalFromMat4,
  mat4FromRotationTranslationScale,
  mat4Identity,
  mat4Invert,
  mat4LookAt,
  mat4Multiply,
  mat4Ortho,
  mat4Perspective,
  mat4Transpose,
  quaternionFromEuler,
  transformBoundingSphere,
  transformDirection,
  transformPoint,
  vec3Add,
  vec3Cross,
  vec3Dot,
  vec3Length,
  vec3Normalize,
  vec3Scale,
  vec3Subtract,
} from "../src/engine/math";
import { extractFrustumPlanes, sphereIntersectsFrustum } from "../src/engine/frustum";
import type { Vec3 } from "../src/engine/types";

/**
 * The engine's math is now an adapter over gl-matrix. These tests do three jobs:
 *
 * 1. Keep the original behavioural assertions (composition, inversion,
 *    conservative sphere scaling, frustum culling) so coverage is not lost.
 * 2. Assert the adapter agrees with gl-matrix element-for-element, which is what
 *    makes "we delegate the algebra" a checked claim rather than a comment.
 * 3. Pin the documented, deliberate deviations from gl-matrix's defaults. These
 *    are the cases that would otherwise regress silently: gl-matrix's
 *    `quat.fromEuler` takes degrees and defaults to "zyx" order, `mat4.invert`
 *    returns null instead of throwing, and `vec3.length` overflows where
 *    `Math.hypot` does not.
 */

/** A rotation/translation/scale triple with no symmetry, so mistakes show up. */
const ASYMMETRIC = {
  translation: [4, -2, 7] as Vec3,
  euler: [0.37, -0.82, 1.13] as Vec3,
  scale: [2, 3, 4] as Vec3,
};

function expectMatrixClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  tolerance = 1e-6,
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    expect(Math.abs((actual[index] ?? 0) - (expected[index] ?? 0))).toBeLessThanOrEqual(
      tolerance,
    );
  }
}

describe("matrix math", () => {
  it("composes transforms and inverts them", () => {
    const transform = mat4FromRotationTranslationScale(
      [4, -2, 7],
      [0, 0, 0, 1],
      [2, 3, 4],
    );
    const point: [number, number, number] = [1, 2, -1];
    const world = transformPoint(transform, point);
    expect(world).toEqual([6, 4, 3]);
    const restored = transformPoint(mat4Invert(transform), world);
    expect(restored[0]).toBeCloseTo(point[0]);
    expect(restored[1]).toBeCloseTo(point[1]);
    expect(restored[2]).toBeCloseTo(point[2]);
    expect(Array.from(mat4Multiply(transform, mat4Invert(transform)))).toEqual(
      expect.arrayContaining(Array.from(mat4Identity())),
    );
  });

  it("conservatively scales bounding spheres", () => {
    const transform = mat4FromRotationTranslationScale(
      [2, 3, 4],
      [0, 0, 0, 1],
      [2, 5, 3],
    );
    const bounds = transformBoundingSphere(transform, {
      center: [0, 0, 0],
      radius: 2,
    });
    expect(bounds.center).toEqual([2, 3, 4]);
    // Radius takes the LARGEST axis scale so the sphere still encloses the mesh
    // under non-uniform scale. Under-estimating would pop geometry when culled.
    expect(bounds.radius).toBe(10);
  });

  it("stores matrices column-major with translation in elements 12..14", () => {
    const transform = mat4FromRotationTranslationScale([5, 6, 7], [0, 0, 0, 1], [1, 1, 1]);
    expect([transform[12], transform[13], transform[14], transform[15]]).toEqual([5, 6, 7, 1]);
    // The w row (3, 7, 11) stays zero for an affine transform.
    expect([transform[3], transform[7], transform[11]]).toEqual([0, 0, 0]);
  });

  it("composes right-to-left so mat4Multiply(a, b) applies b first", () => {
    const translate = mat4FromRotationTranslationScale([10, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
    const scale = mat4FromRotationTranslationScale([0, 0, 0], [0, 0, 0, 1], [2, 2, 2]);
    // translate * scale => scale the point, then translate it.
    expect(transformPoint(mat4Multiply(translate, scale), [1, 0, 0])).toEqual([12, 0, 0]);
    // scale * translate => translate first, so the offset is scaled too.
    expect(transformPoint(mat4Multiply(scale, translate), [1, 0, 0])).toEqual([22, 0, 0]);
  });
});

describe("gl-matrix agreement", () => {
  const quaternion = quaternionFromEuler(...ASYMMETRIC.euler);
  const model = mat4FromRotationTranslationScale(
    ASYMMETRIC.translation,
    quaternion,
    ASYMMETRIC.scale,
  );

  it("builds the same model matrix as mat4.fromRotationTranslationScale", () => {
    // NOTE the argument order differs: gl-matrix is (out, quat, translation,
    // scale) whereas the adapter keeps glTF's (translation, quat, scale).
    expectMatrixClose(
      model,
      mat4.fromRotationTranslationScale(
        mat4.create(),
        quaternion,
        ASYMMETRIC.translation,
        ASYMMETRIC.scale,
      ),
    );
  });

  it("builds the same projection, ortho and view matrices as gl-matrix", () => {
    expectMatrixClose(
      mat4Perspective(Math.PI / 3, 16 / 9, 0.25, 250),
      mat4.perspective(mat4.create(), Math.PI / 3, 16 / 9, 0.25, 250),
    );
    expectMatrixClose(
      mat4Ortho(-3, 7, -11, 13, 0.5, 90),
      mat4.ortho(mat4.create(), -3, 7, -11, 13, 0.5, 90),
    );
    expectMatrixClose(
      mat4LookAt([9, 14, 8], [0, 1.2, 0], [0, 1, 0]),
      mat4.lookAt(mat4.create(), [9, 14, 8], [0, 1.2, 0], [0, 1, 0]),
    );
  });

  it("multiplies, inverts and transposes identically to gl-matrix", () => {
    const other = mat4FromRotationTranslationScale(
      [-1, 0.5, 2],
      quaternionFromEuler(-0.9, 0.2, 1.1),
      [0.5, 1.5, 2],
    );
    expectMatrixClose(
      mat4Multiply(model, other),
      mat4.multiply(mat4.create(), model, other),
    );
    expectMatrixClose(mat4Invert(model), mat4.invert(mat4.create(), model)!);
    expectMatrixClose(mat4Transpose(model), mat4.transpose(mat4.create(), model));
  });

  it("derives the normal matrix identically to mat3.normalFromMat4", () => {
    expectMatrixClose(mat3NormalFromMat4(model), mat3.normalFromMat4(mat3.create(), model)!);
  });

  it("still equals the classic transpose-of-the-inverse upper 3x3", () => {
    // The old hand-rolled implementation did this explicitly; keeping the
    // equivalence asserted documents that mat3.normalFromMat4 is the same thing.
    const transposedInverse = mat4Transpose(mat4Invert(model));
    expectMatrixClose(mat3NormalFromMat4(model), [
      transposedInverse[0]!, transposedInverse[1]!, transposedInverse[2]!,
      transposedInverse[4]!, transposedInverse[5]!, transposedInverse[6]!,
      transposedInverse[8]!, transposedInverse[9]!, transposedInverse[10]!,
    ], 1e-5);
  });

  it("matches gl-matrix for vector operations", () => {
    const a: Vec3 = [0.3, -1.7, 2.9];
    const b: Vec3 = [-4.1, 0.6, 1.2];
    expectMatrixClose(vec3Add(a, b), vec3.add(vec3.create(), a, b));
    expectMatrixClose(vec3Subtract(a, b), vec3.subtract(vec3.create(), a, b));
    expectMatrixClose(vec3Scale(a, -2.5), vec3.scale(vec3.create(), a, -2.5));
    expectMatrixClose(vec3Cross(a, b), vec3.cross(vec3.create(), a, b));
    expectMatrixClose(vec3Normalize(a), vec3.normalize(vec3.create(), a));
    expect(vec3Dot(a, b)).toBeCloseTo(vec3.dot(a, b));
    expect(vec3Length(a)).toBeCloseTo(vec3.length(a));
  });

  it("transforms points the same way as vec3.transformMat4 for affine matrices", () => {
    const point: Vec3 = [1.4, -0.6, 3.2];
    expectMatrixClose(
      transformPoint(model, point),
      vec3.transformMat4(vec3.create(), point, model),
    );
  });

  it("applies the perspective divide when unprojecting", () => {
    const viewProjection = mat4Multiply(
      mat4Perspective(Math.PI / 4, 1.6, 0.1, 100),
      mat4LookAt([9, 14, 8], [0, 1.2, 0], [0, 1, 0]),
    );
    const inverse = mat4Invert(viewProjection);
    const clip: Vec3 = [0.35, -0.2, 0.8];
    // A non-affine matrix produces w != 1, so the divide must happen; gl-matrix's
    // vec3.transformMat4 divides internally, which is the behaviour to match.
    expectMatrixClose(
      transformPoint(inverse, clip),
      vec3.transformMat4(vec3.create(), clip, inverse),
      1e-4,
    );
    // Round-tripping a clip coordinate through the inverse and back must land
    // where it started, which only holds if the divide is correct.
    expectMatrixClose(transformPoint(viewProjection, transformPoint(inverse, clip)), clip, 1e-4);
  });

  it("transforms directions without translation and renormalizes", () => {
    const direction = transformDirection(model, [0, 0, -1]);
    expect(vec3Length(direction)).toBeCloseTo(1);
    // Translation must not leak in: shifting the matrix' translation column
    // leaves a direction unchanged.
    const shifted = mat4FromRotationTranslationScale(
      [100, -50, 25],
      quaternion,
      ASYMMETRIC.scale,
    );
    expectMatrixClose(transformDirection(shifted, [0, 0, -1]), direction);
  });
});

describe("deliberate deviations from gl-matrix defaults", () => {
  it("treats quaternionFromEuler input as radians in intrinsic XYZ order", () => {
    const [x, y, z] = ASYMMETRIC.euler;
    const degrees = 180 / Math.PI;
    // gl-matrix takes DEGREES and defaults to "zyx"; the adapter must be
    // radians + "xyz" or every rotated object silently reorients.
    expectMatrixClose(
      quaternionFromEuler(x, y, z),
      quat.fromEuler(quat.create(), x * degrees, y * degrees, z * degrees, "xyz"),
      1e-6,
    );
    const zyx = quat.fromEuler(quat.create(), x * degrees, y * degrees, z * degrees, "zyx");
    const xyz = quaternionFromEuler(x, y, z);
    // Guard the guard: the two orders really are different for this input, so
    // the assertion above cannot pass by coincidence.
    expect(Math.abs(xyz[0] - (zyx[0] ?? 0))).toBeGreaterThan(1e-3);
  });

  it("matches the closed-form intrinsic XYZ quaternion", () => {
    // Independent reference: the formula the engine used before gl-matrix.
    const [x, y, z] = ASYMMETRIC.euler;
    const [sx, cx] = [Math.sin(x / 2), Math.cos(x / 2)];
    const [sy, cy] = [Math.sin(y / 2), Math.cos(y / 2)];
    const [sz, cz] = [Math.sin(z / 2), Math.cos(z / 2)];
    expectMatrixClose(quaternionFromEuler(x, y, z), [
      sx * cy * cz + cx * sy * sz,
      cx * sy * cz - sx * cy * sz,
      cx * cy * sz + sx * sy * cz,
      cx * cy * cz - sx * sy * sz,
    ]);
  });

  it("keeps euler-derived quaternions in float64 so model matrices are exact", () => {
    // Rounding the quaternion to float32 first perturbs the model matrix by up
    // to ~2.4e-7, which is why the adapter does not use quat.create().
    const quaternion = quaternionFromEuler(...ASYMMETRIC.euler);
    expect(quaternion).toBeInstanceOf(Array);
    const float32 = quat.fromEuler(
      quat.create(),
      ASYMMETRIC.euler[0] * (180 / Math.PI),
      ASYMMETRIC.euler[1] * (180 / Math.PI),
      ASYMMETRIC.euler[2] * (180 / Math.PI),
      "xyz",
    );
    const exact = mat4FromRotationTranslationScale(
      ASYMMETRIC.translation,
      quaternion,
      ASYMMETRIC.scale,
    );
    const rounded = mat4.fromRotationTranslationScale(
      new Float32Array(16),
      float32,
      ASYMMETRIC.translation,
      ASYMMETRIC.scale,
    );
    let maximumDrift = 0;
    for (let index = 0; index < 16; index += 1) {
      maximumDrift = Math.max(
        maximumDrift,
        Math.abs((exact[index] ?? 0) - (rounded[index] ?? 0)),
      );
    }
    // Confirms the float32 route really is lossy, so the float64 choice matters.
    expect(maximumDrift).toBeGreaterThan(0);
  });

  it("throws on a singular matrix where gl-matrix returns null", () => {
    const singular = new Float32Array(16);
    expect(mat4.invert(mat4.create(), singular)).toBeNull();
    expect(() => mat4Invert(singular)).toThrowError(/singular/);
    // A zero scale axis collapses the basis, so the normal matrix is undefined.
    const flattened = mat4FromRotationTranslationScale([0, 0, 0], [0, 0, 0, 1], [1, 0, 1]);
    expect(() => mat3NormalFromMat4(flattened)).toThrowError(/singular/);
  });

  it("uses an overflow-safe magnitude instead of vec3.length", () => {
    // vec3.length squares each component, so huge or tiny coordinates (possible
    // in untrusted glTF vertex data) overflow to Infinity or underflow to 0.
    const huge: Vec3 = [1e200, 1e200, 1e200];
    expect(vec3.length(huge)).toBe(Infinity);
    expect(vec3Length(huge)).toBeCloseTo(Math.hypot(...huge));
    expect(Number.isFinite(vec3Length(huge))).toBe(true);
    const tiny: Vec3 = [1e-200, 1e-200, 1e-200];
    expect(vec3.length(tiny)).toBe(0);
    expect(vec3Length(tiny)).toBeGreaterThan(0);
  });

  it("normalizes degenerate vectors to zero rather than NaN", () => {
    expect(vec3Normalize([0, 0, 0])).toEqual([0, 0, 0]);
    // Below EPSILON the direction is meaningless, so it is clamped to zero.
    expect(vec3Normalize([1e-12, 0, 0])).toEqual([0, 0, 0]);
    expect(transformDirection(mat4Identity(), [0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("falls back to w = 1 when a projective divide would be degenerate", () => {
    // All-zero matrix => w == 0; the result must be finite, not NaN/Infinity.
    const result = transformPoint(new Float32Array(16), [1, 2, 3]);
    expect(result.every((component) => Number.isFinite(component))).toBe(true);
    expect(result).toEqual([0, 0, 0]);
  });
});

describe("frustum culling", () => {
  it("accepts visible spheres and rejects spheres behind the camera", () => {
    const projection = mat4Perspective(Math.PI / 2, 1, 0.1, 100);
    const planes = extractFrustumPlanes(projection);
    expect(
      sphereIntersectsFrustum({ center: [0, 0, -5], radius: 1 }, planes),
    ).toBe(true);
    expect(
      sphereIntersectsFrustum({ center: [0, 0, 5], radius: 0.5 }, planes),
    ).toBe(false);
    expect(
      sphereIntersectsFrustum({ center: [50, 0, -5], radius: 1 }, planes),
    ).toBe(false);
  });

  it("extracts planes from a column-major matrix and faces them inward", () => {
    const projection = mat4Perspective(Math.PI / 2, 1, 0.1, 100);
    const planes = extractFrustumPlanes(projection);
    expect(planes).toHaveLength(6);
    for (const plane of planes) {
      // Gribb-Hartmann planes are normalized, so the xyz part is a unit normal.
      expect(Math.hypot(plane[0], plane[1], plane[2])).toBeCloseTo(1);
    }
    // A point at the centre of the frustum is inside every plane.
    const inside: Vec3 = [0, 0, -5];
    for (const [x, y, z, distance] of planes) {
      expect(x * inside[0] + y * inside[1] + z * inside[2] + distance).toBeGreaterThan(0);
    }
  });

  it("keeps a sphere straddling the near plane visible", () => {
    // Radius-aware rejection: the centre is behind the camera but the sphere
    // still overlaps the frustum, so culling it would clip visible geometry.
    const projection = mat4Perspective(Math.PI / 2, 1, 0.1, 100);
    const planes = extractFrustumPlanes(projection);
    expect(sphereIntersectsFrustum({ center: [0, 0, 0.4], radius: 1 }, planes)).toBe(true);
  });
});

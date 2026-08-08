import { describe, expect, it } from "vitest";
import {
  mat4FromRotationTranslationScale,
  mat4Identity,
  mat4Invert,
  mat4Multiply,
  mat4Perspective,
  transformBoundingSphere,
  transformPoint,
} from "../src/engine/math";
import { extractFrustumPlanes, sphereIntersectsFrustum } from "../src/engine/frustum";

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
    expect(bounds.radius).toBe(10);
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
});

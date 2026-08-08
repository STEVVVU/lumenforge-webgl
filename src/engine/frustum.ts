import type { BoundingSphere } from "./types";

export type Plane = [number, number, number, number];

function normalizePlane(plane: Plane): Plane {
  const length = Math.hypot(plane[0], plane[1], plane[2]);
  if (length === 0) return plane;
  return [
    plane[0] / length,
    plane[1] / length,
    plane[2] / length,
    plane[3] / length,
  ];
}

export function extractFrustumPlanes(matrix: ArrayLike<number>): Plane[] {
  const m = (index: number) => matrix[index] ?? 0;
  return [
    normalizePlane([m(3) + m(0), m(7) + m(4), m(11) + m(8), m(15) + m(12)]),
    normalizePlane([m(3) - m(0), m(7) - m(4), m(11) - m(8), m(15) - m(12)]),
    normalizePlane([m(3) + m(1), m(7) + m(5), m(11) + m(9), m(15) + m(13)]),
    normalizePlane([m(3) - m(1), m(7) - m(5), m(11) - m(9), m(15) - m(13)]),
    normalizePlane([m(3) + m(2), m(7) + m(6), m(11) + m(10), m(15) + m(14)]),
    normalizePlane([m(3) - m(2), m(7) - m(6), m(11) - m(10), m(15) - m(14)]),
  ];
}

export function sphereIntersectsFrustum(
  sphere: BoundingSphere,
  planes: Plane[],
): boolean {
  return planes.every(
    ([x, y, z, distance]) =>
      x * sphere.center[0] +
        y * sphere.center[1] +
        z * sphere.center[2] +
        distance >=
      -sphere.radius,
  );
}

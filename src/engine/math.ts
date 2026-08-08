import type { BoundingSphere, Vec3 } from "./types";

const EPSILON = 1e-8;

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vec3Subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vec3Scale(v: Vec3, scale: number): Vec3 {
  return [v[0] * scale, v[1] * scale, v[2] * scale];
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vec3Length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function vec3Normalize(v: Vec3): Vec3 {
  const length = vec3Length(v);
  if (length < EPSILON) return [0, 0, 0];
  return vec3Scale(v, 1 / length);
}

export function mat4Identity(): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

export function mat4Multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += (a[index * 4 + row] ?? 0) * (b[column * 4 + index] ?? 0);
      }
      out[column * 4 + row] = value;
    }
  }
  return out;
}

export function mat4Perspective(
  fieldOfViewRadians: number,
  aspect: number,
  near: number,
  far: number,
): Float32Array {
  const f = 1 / Math.tan(fieldOfViewRadians / 2);
  const rangeInverse = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * rangeInverse, -1,
    0, 0, 2 * near * far * rangeInverse, 0,
  ]);
}

export function mat4Ortho(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Float32Array {
  const width = 1 / (right - left);
  const height = 1 / (top - bottom);
  const depth = 1 / (far - near);
  return new Float32Array([
    2 * width, 0, 0, 0,
    0, 2 * height, 0, 0,
    0, 0, -2 * depth, 0,
    -(right + left) * width,
    -(top + bottom) * height,
    -(far + near) * depth,
    1,
  ]);
}

export function mat4LookAt(eye: Vec3, target: Vec3, up: Vec3): Float32Array {
  const forward = vec3Normalize(vec3Subtract(eye, target));
  const right = vec3Normalize(vec3Cross(up, forward));
  const correctedUp = vec3Cross(forward, right);
  return new Float32Array([
    right[0], correctedUp[0], forward[0], 0,
    right[1], correctedUp[1], forward[1], 0,
    right[2], correctedUp[2], forward[2], 0,
    -vec3Dot(right, eye),
    -vec3Dot(correctedUp, eye),
    -vec3Dot(forward, eye),
    1,
  ]);
}

export function mat4Invert(matrix: ArrayLike<number>): Float32Array {
  const m = Array.from({ length: 16 }, (_, index) => matrix[index] ?? 0);
  const out = new Float32Array(16);
  const b00 = m[0]! * m[5]! - m[1]! * m[4]!;
  const b01 = m[0]! * m[6]! - m[2]! * m[4]!;
  const b02 = m[0]! * m[7]! - m[3]! * m[4]!;
  const b03 = m[1]! * m[6]! - m[2]! * m[5]!;
  const b04 = m[1]! * m[7]! - m[3]! * m[5]!;
  const b05 = m[2]! * m[7]! - m[3]! * m[6]!;
  const b06 = m[8]! * m[13]! - m[9]! * m[12]!;
  const b07 = m[8]! * m[14]! - m[10]! * m[12]!;
  const b08 = m[8]! * m[15]! - m[11]! * m[12]!;
  const b09 = m[9]! * m[14]! - m[10]! * m[13]!;
  const b10 = m[9]! * m[15]! - m[11]! * m[13]!;
  const b11 = m[10]! * m[15]! - m[11]! * m[14]!;
  const determinant =
    b00 * b11 - b01 * b10 + b02 * b09 +
    b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(determinant) < EPSILON) {
    throw new Error("Cannot invert a singular matrix.");
  }
  const inverseDeterminant = 1 / determinant;
  out[0] = (m[5]! * b11 - m[6]! * b10 + m[7]! * b09) * inverseDeterminant;
  out[1] = (-m[1]! * b11 + m[2]! * b10 - m[3]! * b09) * inverseDeterminant;
  out[2] = (m[13]! * b05 - m[14]! * b04 + m[15]! * b03) * inverseDeterminant;
  out[3] = (-m[9]! * b05 + m[10]! * b04 - m[11]! * b03) * inverseDeterminant;
  out[4] = (-m[4]! * b11 + m[6]! * b08 - m[7]! * b07) * inverseDeterminant;
  out[5] = (m[0]! * b11 - m[2]! * b08 + m[3]! * b07) * inverseDeterminant;
  out[6] = (-m[12]! * b05 + m[14]! * b02 - m[15]! * b01) * inverseDeterminant;
  out[7] = (m[8]! * b05 - m[10]! * b02 + m[11]! * b01) * inverseDeterminant;
  out[8] = (m[4]! * b10 - m[5]! * b08 + m[7]! * b06) * inverseDeterminant;
  out[9] = (-m[0]! * b10 + m[1]! * b08 - m[3]! * b06) * inverseDeterminant;
  out[10] = (m[12]! * b04 - m[13]! * b02 + m[15]! * b00) * inverseDeterminant;
  out[11] = (-m[8]! * b04 + m[9]! * b02 - m[11]! * b00) * inverseDeterminant;
  out[12] = (-m[4]! * b09 + m[5]! * b07 - m[6]! * b06) * inverseDeterminant;
  out[13] = (m[0]! * b09 - m[1]! * b07 + m[2]! * b06) * inverseDeterminant;
  out[14] = (-m[12]! * b03 + m[13]! * b01 - m[14]! * b00) * inverseDeterminant;
  out[15] = (m[8]! * b03 - m[9]! * b01 + m[10]! * b00) * inverseDeterminant;
  return out;
}

export function mat4Transpose(matrix: ArrayLike<number>): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] = matrix[row * 4 + column] ?? 0;
    }
  }
  return out;
}

export function mat4FromRotationTranslationScale(
  translation: Vec3,
  quaternion: [number, number, number, number],
  scale: Vec3,
): Float32Array {
  const [x, y, z, w] = quaternion;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return new Float32Array([
    (1 - (yy + zz)) * scale[0],
    (xy + wz) * scale[0],
    (xz - wy) * scale[0],
    0,
    (xy - wz) * scale[1],
    (1 - (xx + zz)) * scale[1],
    (yz + wx) * scale[1],
    0,
    (xz + wy) * scale[2],
    (yz - wx) * scale[2],
    (1 - (xx + yy)) * scale[2],
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ]);
}

export function quaternionFromEuler(x: number, y: number, z: number): [number, number, number, number] {
  const sx = Math.sin(x / 2);
  const cx = Math.cos(x / 2);
  const sy = Math.sin(y / 2);
  const cy = Math.cos(y / 2);
  const sz = Math.sin(z / 2);
  const cz = Math.cos(z / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

export function transformPoint(matrix: ArrayLike<number>, point: Vec3): Vec3 {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const w =
    (matrix[3] ?? 0) * x +
    (matrix[7] ?? 0) * y +
    (matrix[11] ?? 0) * z +
    (matrix[15] ?? 1);
  const inverseW = Math.abs(w) > EPSILON ? 1 / w : 1;
  return [
    ((matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0)) * inverseW,
    ((matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0)) * inverseW,
    ((matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[14] ?? 0)) * inverseW,
  ];
}

export function transformBoundingSphere(
  matrix: ArrayLike<number>,
  sphere: BoundingSphere,
): BoundingSphere {
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

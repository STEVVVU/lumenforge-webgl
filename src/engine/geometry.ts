import { calculateBounds } from "./math";
import type { MeshData } from "./types";

function mesh(
  name: string,
  positions: number[],
  normals: number[],
  texcoords: number[],
  indices: number[],
): MeshData {
  const positionData = new Float32Array(positions);
  return {
    name,
    positions: positionData,
    normals: new Float32Array(normals),
    texcoords: new Float32Array(texcoords),
    indices: new Uint32Array(indices),
    bounds: calculateBounds(positionData),
  };
}

export function createCube(name = "Cube"): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const texcoords: number[] = [];
  const indices: number[] = [];
  const faces = [
    { normal: [1, 0, 0], corners: [[1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]] },
    { normal: [-1, 0, 0], corners: [[-1, -1, 1], [-1, -1, -1], [-1, 1, -1], [-1, 1, 1]] },
    { normal: [0, 1, 0], corners: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] },
    { normal: [0, -1, 0], corners: [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]] },
    { normal: [0, 0, 1], corners: [[1, -1, 1], [-1, -1, 1], [-1, 1, 1], [1, 1, 1]] },
    { normal: [0, 0, -1], corners: [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]] },
  ];
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  faces.forEach((face, faceIndex) => {
    const offset = faceIndex * 4;
    face.corners.forEach((corner, cornerIndex) => {
      positions.push(...corner.map((value) => value * 0.5));
      normals.push(...face.normal);
      texcoords.push(...uvs[cornerIndex]!);
    });
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  });
  return mesh(name, positions, normals, texcoords, indices);
}

export function createPlane(name = "Plane"): MeshData {
  return mesh(
    name,
    [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5],
    [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    [0, 0, 1, 0, 1, 1, 0, 1],
    [0, 2, 1, 0, 3, 2],
  );
}

export function createSphere(
  name = "Sphere",
  longitudeSegments = 32,
  latitudeSegments = 20,
): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const texcoords: number[] = [];
  const indices: number[] = [];
  for (let latitude = 0; latitude <= latitudeSegments; latitude += 1) {
    const v = latitude / latitudeSegments;
    const theta = v * Math.PI;
    for (let longitude = 0; longitude <= longitudeSegments; longitude += 1) {
      const u = longitude / longitudeSegments;
      const phi = u * Math.PI * 2;
      const x = Math.sin(theta) * Math.cos(phi);
      const y = Math.cos(theta);
      const z = Math.sin(theta) * Math.sin(phi);
      positions.push(x * 0.5, y * 0.5, z * 0.5);
      normals.push(x, y, z);
      texcoords.push(u, 1 - v);
    }
  }
  const width = longitudeSegments + 1;
  for (let latitude = 0; latitude < latitudeSegments; latitude += 1) {
    for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
      const a = latitude * width + longitude;
      const b = a + width;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return mesh(name, positions, normals, texcoords, indices);
}

export function createTorus(
  name = "Torus",
  radialSegments = 32,
  tubeSegments = 12,
): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const texcoords: number[] = [];
  const indices: number[] = [];
  const majorRadius = 0.36;
  const minorRadius = 0.14;
  for (let radial = 0; radial <= radialSegments; radial += 1) {
    const u = radial / radialSegments;
    const outer = u * Math.PI * 2;
    for (let tube = 0; tube <= tubeSegments; tube += 1) {
      const v = tube / tubeSegments;
      const inner = v * Math.PI * 2;
      const normal = [
        Math.cos(outer) * Math.cos(inner),
        Math.sin(inner),
        Math.sin(outer) * Math.cos(inner),
      ];
      positions.push(
        Math.cos(outer) * (majorRadius + minorRadius * Math.cos(inner)),
        minorRadius * Math.sin(inner),
        Math.sin(outer) * (majorRadius + minorRadius * Math.cos(inner)),
      );
      normals.push(...normal);
      texcoords.push(u, v);
    }
  }
  const width = tubeSegments + 1;
  for (let radial = 0; radial < radialSegments; radial += 1) {
    for (let tube = 0; tube < tubeSegments; tube += 1) {
      const a = radial * width + tube;
      const b = (radial + 1) * width + tube;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return mesh(name, positions, normals, texcoords, indices);
}

export function calculateSmoothNormals(
  positions: Float32Array,
  indices: Uint32Array,
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let index = 0; index < indices.length; index += 3) {
    const ia = (indices[index] ?? 0) * 3;
    const ib = (indices[index + 1] ?? 0) * 3;
    const ic = (indices[index + 2] ?? 0) * 3;
    const ab = [
      (positions[ib] ?? 0) - (positions[ia] ?? 0),
      (positions[ib + 1] ?? 0) - (positions[ia + 1] ?? 0),
      (positions[ib + 2] ?? 0) - (positions[ia + 2] ?? 0),
    ];
    const ac = [
      (positions[ic] ?? 0) - (positions[ia] ?? 0),
      (positions[ic + 1] ?? 0) - (positions[ia + 1] ?? 0),
      (positions[ic + 2] ?? 0) - (positions[ia + 2] ?? 0),
    ];
    const cross = [
      ab[1]! * ac[2]! - ab[2]! * ac[1]!,
      ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!,
    ];
    for (const vertex of [ia, ib, ic]) {
      normals[vertex] = (normals[vertex] ?? 0) + cross[0]!;
      normals[vertex + 1] = (normals[vertex + 1] ?? 0) + cross[1]!;
      normals[vertex + 2] = (normals[vertex + 2] ?? 0) + cross[2]!;
    }
  }
  for (let index = 0; index < normals.length; index += 3) {
    const length = Math.hypot(
      normals[index] ?? 0,
      normals[index + 1] ?? 0,
      normals[index + 2] ?? 0,
    ) || 1;
    normals[index] = (normals[index] ?? 0) / length;
    normals[index + 1] = (normals[index + 1] ?? 0) / length;
    normals[index + 2] = (normals[index + 2] ?? 0) / length;
  }
  return normals;
}

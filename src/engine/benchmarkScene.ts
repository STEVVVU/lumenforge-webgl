import { createCube, createPlane, createSphere, createTorus } from "./geometry";
import {
  mat4FromRotationTranslationScale,
  mergeSpheres,
  quaternionFromEuler,
  transformBoundingSphere,
} from "./math";
import type {
  MaterialData,
  SceneAsset,
  SceneLight,
  SceneObject,
  Vec3,
} from "./types";

function xorshift(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

export function createBenchmarkScene(seed = 0x4c554d45): SceneAsset {
  const random = xorshift(seed);
  const meshes = [
    createPlane("Ground grid"),
    createSphere("Inspection sphere"),
    createCube("Inspection cube"),
    createTorus("Inspection torus"),
  ];
  const materials: MaterialData[] = [
    {
      name: "Graphite floor",
      baseColor: [0.12, 0.135, 0.15, 1],
      metallic: 0.05,
      roughness: 0.82,
      doubleSided: false,
    },
    {
      name: "Brushed copper",
      baseColor: [0.76, 0.31, 0.12, 1],
      metallic: 0.92,
      roughness: 0.28,
      doubleSided: false,
    },
    {
      name: "Ceramic",
      baseColor: [0.68, 0.76, 0.8, 1],
      metallic: 0.0,
      roughness: 0.2,
      doubleSided: false,
    },
    {
      name: "Safety yellow",
      baseColor: [0.95, 0.62, 0.08, 1],
      metallic: 0.12,
      roughness: 0.4,
      doubleSided: false,
    },
    {
      name: "Oxide teal",
      baseColor: [0.04, 0.48, 0.49, 1],
      metallic: 0.38,
      roughness: 0.36,
      doubleSided: false,
    },
  ];
  const objects: SceneObject[] = [];

  const addObject = (
    name: string,
    meshIndex: number,
    material: number,
    translation: Vec3,
    scale: Vec3,
    rotation: Vec3 = [0, 0, 0],
  ) => {
    const modelMatrix = mat4FromRotationTranslationScale(
      translation,
      quaternionFromEuler(...rotation),
      scale,
    );
    objects.push({
      id: objects.length + 1,
      name,
      mesh: meshIndex,
      material,
      modelMatrix,
      worldBounds: transformBoundingSphere(modelMatrix, meshes[meshIndex]!.bounds),
    });
  };

  addObject("Reference floor", 0, 0, [0, -0.45, 0], [34, 1, 34]);

  const shapes = [1, 2, 3];
  for (let row = -3; row <= 3; row += 1) {
    for (let column = -3; column <= 3; column += 1) {
      const meshIndex = shapes[(row * row + column * column + 20) % shapes.length]!;
      const height = 0.7 + random() * 1.5;
      const scale: Vec3 =
        meshIndex === 2
          ? [0.7 + random() * 0.5, height, 0.7 + random() * 0.5]
          : [1.1 + random() * 0.45, 1.1 + random() * 0.45, 1.1 + random() * 0.45];
      addObject(
        `Benchmark asset ${objects.length}`,
        meshIndex,
        1 + ((row + column + 20) % (materials.length - 1)),
        [column * 2.25, scale[1] * 0.5 - 0.42, row * 2.25],
        scale,
        [0, random() * Math.PI, meshIndex === 3 ? Math.PI / 2 : 0],
      );
    }
  }

  const lightColors: Vec3[] = [
    [1.0, 0.38, 0.18],
    [0.16, 0.65, 1.0],
    [0.2, 1.0, 0.72],
    [1.0, 0.75, 0.28],
  ];
  const lights: SceneLight[] = [
    {
      type: "directional",
      name: "Key sun",
      position: [9, 14, 8],
      direction: [-0.5, -1, -0.42],
      color: [1, 0.92, 0.82],
      intensity: 3.3,
      range: 40,
      castsShadow: true,
    },
  ];
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    lights.push({
      type: "point",
      name: `Diagnostic light ${index + 1}`,
      position: [
        Math.cos(angle) * (6 + (index % 3) * 1.8),
        1.2 + (index % 4) * 0.7,
        Math.sin(angle) * (6 + (index % 3) * 1.8),
      ],
      direction: [0, -1, 0],
      color: lightColors[index % lightColors.length]!,
      intensity: 38,
      range: 7.5,
      castsShadow: false,
    });
  }

  const bounds = mergeSpheres(objects.map((object) => object.worldBounds));
  return {
    name: "Deterministic material grid",
    source: "benchmark",
    meshes,
    materials,
    objects,
    lights,
    camera: {
      target: [0, 1.2, 0],
      distance: 18,
      azimuth: 0.72,
      elevation: 0.48,
      near: 0.1,
      far: 100,
    },
    bounds,
    warnings: [],
  };
}

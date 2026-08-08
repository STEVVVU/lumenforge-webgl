import { describe, expect, it } from "vitest";
import {
  AssetLoadError,
  parseGlb,
  parseGltfDocument,
} from "../src/engine/gltf";

function triangleFixture() {
  const data = new ArrayBuffer(42);
  const floats = new Float32Array(data, 0, 9);
  floats.set([
    -1, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]);
  const indices = new Uint16Array(data, 36, 3);
  indices.set([0, 1, 2]);
  return {
    data,
    json: {
      asset: { version: "2.0" },
      buffers: [{ byteLength: 42 }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 6 },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      ],
      materials: [
        {
          name: "Test metal",
          pbrMetallicRoughness: {
            baseColorFactor: [0.2, 0.4, 0.6, 1],
            metallicFactor: 0.8,
            roughnessFactor: 0.25,
          },
        },
      ],
      meshes: [
        {
          name: "Triangle",
          primitives: [
            {
              attributes: { POSITION: 0 },
              indices: 1,
              material: 0,
            },
          ],
        },
      ],
      nodes: [
        {
          name: "Translated triangle",
          mesh: 0,
          translation: [3, 2, -1],
        },
      ],
      scenes: [{ nodes: [0] }],
      scene: 0,
    },
  };
}

describe("glTF parser", () => {
  it("loads mesh, PBR material, node transform, and generated normals", () => {
    const fixture = triangleFixture();
    const asset = parseGltfDocument(fixture.json, [fixture.data], new Map(), "fixture");
    expect(asset.source).toBe("gltf");
    expect(asset.meshes).toHaveLength(1);
    expect(asset.objects).toHaveLength(1);
    expect(asset.meshes[0]?.indices).toEqual(new Uint32Array([0, 1, 2]));
    expect(asset.meshes[0]?.normals).toHaveLength(9);
    expect(asset.materials[0]).toMatchObject({
      name: "Test metal",
      metallic: 0.8,
      roughness: 0.25,
    });
    expect(asset.objects[0]?.worldBounds.center[0]).toBeCloseTo(3);
    expect(asset.warnings[0]).toMatch(/Generated normals/);
  });

  it("rejects unsupported primitive modes with a useful error", () => {
    const fixture = triangleFixture();
    (fixture.json.meshes[0]!.primitives[0]! as { mode?: number }).mode = 1;
    expect(() =>
      parseGltfDocument(fixture.json, [fixture.data]),
    ).toThrowError(/not TRIANGLES/);
  });

  it("rejects unsupported glTF versions", () => {
    const fixture = triangleFixture();
    fixture.json.asset.version = "1.0";
    expect(() =>
      parseGltfDocument(fixture.json, [fixture.data]),
    ).toThrow(AssetLoadError);
  });
});

describe("GLB container", () => {
  it("validates and extracts the JSON and binary chunks", () => {
    const fixture = triangleFixture();
    const jsonText = JSON.stringify(fixture.json);
    const jsonBytes = new TextEncoder().encode(jsonText);
    const paddedJsonLength = Math.ceil(jsonBytes.length / 4) * 4;
    const paddedBinaryLength = Math.ceil(fixture.data.byteLength / 4) * 4;
    const total = 12 + 8 + paddedJsonLength + 8 + paddedBinaryLength;
    const glb = new ArrayBuffer(total);
    const view = new DataView(glb);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, total, true);
    view.setUint32(12, paddedJsonLength, true);
    view.setUint32(16, 0x4e4f534a, true);
    const jsonTarget = new Uint8Array(glb, 20, paddedJsonLength);
    jsonTarget.fill(0x20);
    jsonTarget.set(jsonBytes);
    const binaryHeader = 20 + paddedJsonLength;
    view.setUint32(binaryHeader, paddedBinaryLength, true);
    view.setUint32(binaryHeader + 4, 0x004e4942, true);
    new Uint8Array(glb, binaryHeader + 8, fixture.data.byteLength).set(
      new Uint8Array(fixture.data),
    );

    const parsed = parseGlb(glb);
    expect(parsed.json.asset.version).toBe("2.0");
    expect(parsed.binary?.byteLength).toBe(paddedBinaryLength);
  });
});

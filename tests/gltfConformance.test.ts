import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { beforeAll, describe, expect, it } from "vitest";
import { parseGlb, parseGltfDocument } from "../src/engine/gltf";
import type { SceneAsset } from "../src/engine/types";

/**
 * glTF conformance cross-check.
 *
 * The engine keeps its own hand-written glTF/GLB parser as the runtime path:
 * it is bounded, dependency-free, and produces exactly the GPU-ready layout the
 * renderer wants. The risk with a hand-written parser is that it quietly
 * disagrees with the specification.
 *
 * These tests parse the *same bytes* two independent ways -- through
 * `src/engine/gltf.ts` and through `@gltf-transform/core`, a widely used
 * reference implementation -- and assert the two agree on structure (node, mesh
 * and material counts), on material factors, on node world transforms, and on
 * raw accessor data. `@gltf-transform/core` is a devDependency only; it never
 * ships in the bundle.
 *
 * Both libraries store matrices **column-major**, so world matrices are compared
 * element-for-element with translation in elements 12..14 and no transpose.
 */

const io = new NodeIO();
const FIXTURE = resolve(import.meta.dirname, "fixtures", "inspection-triangle.gltf");

/**
 * Builds a GLB in memory with `@gltf-transform/core` covering the feature set
 * the engine claims to support: multiple meshes and primitives, a node
 * hierarchy with TRS transforms, indexed and non-indexed geometry, supplied and
 * missing normals, and metallic-roughness materials.
 */
async function buildReferenceGlb(): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer();

  // Mesh 1: an indexed triangle WITH explicit normals.
  const trianglePositions = document
    .createAccessor("triangle-positions")
    .setType("VEC3")
    .setArray(new Float32Array([-1, 0, 0, 1, 0, 0, 0, 1.5, 0]))
    .setBuffer(buffer);
  const triangleNormals = document
    .createAccessor("triangle-normals")
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]))
    .setBuffer(buffer);
  const triangleUvs = document
    .createAccessor("triangle-uvs")
    .setType("VEC2")
    .setArray(new Float32Array([0, 0, 1, 0, 0.5, 1]))
    .setBuffer(buffer);
  const triangleIndices = document
    .createAccessor("triangle-indices")
    .setType("SCALAR")
    .setArray(new Uint16Array([0, 1, 2]))
    .setBuffer(buffer);
  const copper = document
    .createMaterial("Brushed copper")
    .setBaseColorFactor([0.8, 0.24, 0.08, 1])
    .setMetallicFactor(0.72)
    .setRoughnessFactor(0.32);
  const trianglePrimitive = document
    .createPrimitive()
    .setAttribute("POSITION", trianglePositions)
    .setAttribute("NORMAL", triangleNormals)
    .setAttribute("TEXCOORD_0", triangleUvs)
    .setIndices(triangleIndices)
    .setMaterial(copper);

  // Mesh 2: a two-primitive quad, one primitive WITHOUT normals so the
  // engine's smooth-normal generation path is exercised, and double-sided so
  // the material flag round-trips.
  const quadPositions = document
    .createAccessor("quad-positions")
    .setType("VEC3")
    .setArray(
      new Float32Array([
        -1, -1, 0, 1, -1, 0, 1, 1, 0,
        -1, -1, 0, 1, 1, 0, -1, 1, 0,
      ]),
    )
    .setBuffer(buffer);
  const ceramic = document
    .createMaterial("Ceramic")
    .setBaseColorFactor([0.68, 0.76, 0.8, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.2)
    .setDoubleSided(true);
  const quadPrimitive = document
    .createPrimitive()
    .setAttribute("POSITION", quadPositions)
    .setMaterial(ceramic);
  const secondQuadPrimitive = document
    .createPrimitive()
    .setAttribute("POSITION", quadPositions)
    .setMaterial(copper);

  const triangleMesh = document.createMesh("Triangle mesh").addPrimitive(trianglePrimitive);
  const quadMesh = document
    .createMesh("Quad mesh")
    .addPrimitive(quadPrimitive)
    .addPrimitive(secondQuadPrimitive);

  // Hierarchy: a translated+scaled parent with a rotated child, so the
  // parent * local composition order is actually tested.
  const child = document
    .createNode("Child triangle")
    .setMesh(triangleMesh)
    .setTranslation([0, 2, 0])
    .setRotation([0, 0.3826834, 0, 0.9238795]); // 45 deg about +Y
  const parent = document
    .createNode("Parent quad")
    .setMesh(quadMesh)
    .setTranslation([3, 2, -1])
    .setScale([2, 2, 2])
    .addChild(child);
  document.createScene("Cross-check scene").addChild(parent);

  return io.writeBinary(document);
}

/** Parses GLB bytes through the engine's own hand-written path. */
function parseWithEngine(glb: Uint8Array, name: string): SceneAsset {
  // Copy into a standalone ArrayBuffer: the engine parser indexes from offset 0.
  const data = glb.buffer.slice(
    glb.byteOffset,
    glb.byteOffset + glb.byteLength,
  ) as ArrayBuffer;
  const parsed = parseGlb(data);
  return parseGltfDocument(
    parsed.json,
    parsed.binary ? [parsed.binary] : [],
    new Map(),
    name,
  );
}

describe("glTF parser conformance against @gltf-transform/core", () => {
  let glb: Uint8Array;
  let asset: SceneAsset;

  beforeAll(async () => {
    glb = await buildReferenceGlb();
    asset = parseWithEngine(glb, "cross-check.glb");
  });

  it("produces a GLB both implementations accept", async () => {
    const reference = await io.readBinary(glb);
    expect(reference.getRoot().listScenes()).toHaveLength(1);
    expect(asset.source).toBe("gltf");
    expect(asset.warnings.some((warning) => /Generated normals/.test(warning))).toBe(true);
  });

  it("agrees on mesh and material counts", async () => {
    const root = (await io.readBinary(glb)).getRoot();

    // The engine flattens every glTF primitive into its own MeshData, because a
    // primitive is the unit of a GPU draw call. So the comparable reference
    // number is the total primitive count, not the mesh count.
    const referencePrimitives = root
      .listMeshes()
      .reduce((total, mesh) => total + mesh.listPrimitives().length, 0);
    expect(asset.meshes).toHaveLength(referencePrimitives);
    expect(referencePrimitives).toBe(3);

    // The engine appends one synthetic fallback material for primitives that
    // declare none, so it carries exactly one more than the document.
    expect(asset.materials).toHaveLength(root.listMaterials().length + 1);
    expect(asset.materials.at(-1)?.name).toBe("Default material");
  });

  it("agrees on renderable object count across the node hierarchy", async () => {
    const root = (await io.readBinary(glb)).getRoot();
    // One object per (node, primitive) pair, counting only mesh-bearing nodes.
    const referenceObjects = root
      .listNodes()
      .filter((node) => node.getMesh())
      .reduce((total, node) => total + (node.getMesh()?.listPrimitives().length ?? 0), 0);
    expect(asset.objects).toHaveLength(referenceObjects);
    expect(referenceObjects).toBe(3);
  });

  it("agrees on material factors", async () => {
    const root = (await io.readBinary(glb)).getRoot();
    for (const referenceMaterial of root.listMaterials()) {
      const parsed = asset.materials.find(
        (candidate) => candidate.name === referenceMaterial.getName(),
      );
      expect(parsed, `missing material ${referenceMaterial.getName()}`).toBeDefined();
      expect(parsed?.baseColor).toEqual(referenceMaterial.getBaseColorFactor());
      expect(parsed?.metallic).toBeCloseTo(referenceMaterial.getMetallicFactor());
      expect(parsed?.roughness).toBeCloseTo(referenceMaterial.getRoughnessFactor());
      expect(parsed?.doubleSided).toBe(referenceMaterial.getDoubleSided());
    }
  });

  it("agrees on node world matrices, including the parent-child composition", async () => {
    const root = (await io.readBinary(glb)).getRoot();
    for (const referenceNode of root.listNodes()) {
      if (!referenceNode.getMesh()) continue;
      const name = referenceNode.getName();
      const parsed = asset.objects.find(
        (object) => object.name === name || object.name.startsWith(`${name} / `),
      );
      expect(parsed, `missing object for node ${name}`).toBeDefined();
      // Both libraries are column-major, so this is an element-wise comparison
      // with no transpose. Element 12..14 is the translation.
      const referenceMatrix = referenceNode.getWorldMatrix();
      expect(referenceMatrix).toHaveLength(16);
      for (let index = 0; index < 16; index += 1) {
        expect(
          Math.abs((parsed?.modelMatrix[index] ?? 0) - (referenceMatrix[index] ?? 0)),
        ).toBeLessThan(1e-6);
      }
    }
  });

  it("agrees on raw accessor data for positions and indices", async () => {
    const root = (await io.readBinary(glb)).getRoot();
    const referencePrimitives = root
      .listMeshes()
      .flatMap((mesh) => mesh.listPrimitives());

    referencePrimitives.forEach((primitive, index) => {
      const parsed = asset.meshes[index];
      expect(parsed, `missing engine mesh ${index}`).toBeDefined();

      // glTF mode 4 == TRIANGLES, the only mode the engine supports.
      expect(primitive.getMode()).toBe(4);

      const referencePositions = primitive.getAttribute("POSITION")?.getArray();
      expect(referencePositions).toBeDefined();
      expect(Array.from(parsed?.positions ?? [])).toEqual(
        Array.from(referencePositions ?? []),
      );

      const referenceIndices = primitive.getIndices()?.getArray();
      if (referenceIndices) {
        expect(Array.from(parsed?.indices ?? [])).toEqual(Array.from(referenceIndices));
      } else {
        // Non-indexed geometry: the engine synthesizes a sequential index run so
        // every draw can use drawElements.
        const vertexCount = (referencePositions?.length ?? 0) / 3;
        expect(Array.from(parsed?.indices ?? [])).toEqual(
          Array.from({ length: vertexCount }, (_, value) => value),
        );
      }

      // Normals are either taken verbatim or generated, but the buffer must
      // always be one 3-component normal per position.
      expect(parsed?.normals).toHaveLength(referencePositions?.length ?? 0);
      const referenceNormals = primitive.getAttribute("NORMAL")?.getArray();
      if (referenceNormals) {
        expect(Array.from(parsed?.normals ?? [])).toEqual(Array.from(referenceNormals));
      }
      // UVs are always present, defaulting to zeros when the asset omits them.
      expect(parsed?.texcoords).toHaveLength(((referencePositions?.length ?? 0) / 3) * 2);
    });
  });

  it("agrees on the checked-in .gltf fixture used by browser verification", async () => {
    // The fixture is a self-contained .gltf with a data-URI buffer, which is the
    // other input shape the engine supports.
    const text = await readFile(FIXTURE, "utf8");
    const json: unknown = JSON.parse(text);
    const bytes = new TextEncoder().encode(text);
    const reference = await io.readJSON({
      json: json as Parameters<typeof io.readJSON>[0]["json"],
      resources: {},
    });
    const referenceRoot = reference.getRoot();

    const engineAsset = parseGltfDocument(
      json as Record<string, unknown>,
      // Resolve the data-URI buffer the same way the app does.
      [decodeFixtureBuffer(json as Record<string, any>)],
      new Map(),
      "inspection-triangle.gltf",
    );

    expect(engineAsset.objects).toHaveLength(1);
    expect(engineAsset.meshes).toHaveLength(
      referenceRoot
        .listMeshes()
        .reduce((total, mesh) => total + mesh.listPrimitives().length, 0),
    );
    const referenceMaterial = referenceRoot.listMaterials()[0];
    expect(engineAsset.materials[0]?.baseColor).toEqual(
      referenceMaterial?.getBaseColorFactor(),
    );
    expect(engineAsset.materials[0]?.metallic).toBeCloseTo(
      referenceMaterial?.getMetallicFactor() ?? -1,
    );
    const referencePositions = referenceRoot
      .listMeshes()[0]
      ?.listPrimitives()[0]
      ?.getAttribute("POSITION")
      ?.getArray();
    expect(Array.from(engineAsset.meshes[0]?.positions ?? [])).toEqual(
      Array.from(referencePositions ?? []),
    );
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});

/** Decodes the fixture's single base64 data-URI buffer into an ArrayBuffer. */
function decodeFixtureBuffer(json: Record<string, any>): ArrayBuffer {
  const uri: string = json.buffers[0].uri;
  const base64 = uri.slice(uri.indexOf(",") + 1);
  return Uint8Array.from(Buffer.from(base64, "base64")).buffer as ArrayBuffer;
}

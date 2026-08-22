import { calculateSmoothNormals } from "./geometry";
import {
  calculateBounds,
  mat4FromRotationTranslationScale,
  mat4Identity,
  mat4Multiply,
  mergeSpheres,
  transformBoundingSphere,
  transformDirection,
  transformPoint,
} from "./math";
import type {
  MaterialData,
  MeshData,
  SceneAsset,
  SceneLight,
  SceneObject,
  TexturePayload,
  Vec3,
  Vec4,
} from "./types";

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BINARY_CHUNK = 0x004e4942;
const MAX_ASSET_BYTES = 128 * 1024 * 1024;

type JsonRecord = Record<string, any>;

export class AssetLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetLoadError";
  }
}

export interface ParsedGlb {
  json: JsonRecord;
  binary: ArrayBuffer | null;
}

function assertRecord(value: unknown, message: string): asserts value is JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AssetLoadError(message);
  }
}

function decodeDataUri(uri: string): TexturePayload {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri);
  if (!match) throw new AssetLoadError("Malformed data URI in glTF asset.");
  const mimeType = match[1] || "application/octet-stream";
  const encoded = match[3] ?? "";
  const raw = match[2]
    ? atob(encoded)
    : decodeURIComponent(encoded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return { bytes, mimeType };
}

export function parseGlb(data: ArrayBuffer): ParsedGlb {
  if (data.byteLength < 20) {
    throw new AssetLoadError("GLB file is too small to contain a valid header.");
  }
  const view = new DataView(data);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const declaredLength = view.getUint32(8, true);
  if (magic !== GLB_MAGIC) throw new AssetLoadError("File is not a GLB container.");
  if (version !== 2) throw new AssetLoadError(`Unsupported GLB version ${version}; expected 2.`);
  if (declaredLength !== data.byteLength) {
    throw new AssetLoadError("GLB declared length does not match the file size.");
  }
  let offset = 12;
  let json: JsonRecord | null = null;
  let binary: ArrayBuffer | null = null;
  while (offset + 8 <= data.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + chunkLength > data.byteLength) {
      throw new AssetLoadError("GLB chunk exceeds the file boundary.");
    }
    const chunk = data.slice(offset, offset + chunkLength);
    if (chunkType === GLB_JSON_CHUNK) {
      const text = new TextDecoder().decode(chunk).replace(/\0+$/g, "").trim();
      const parsed: unknown = JSON.parse(text);
      assertRecord(parsed, "GLB JSON chunk must contain an object.");
      json = parsed;
    } else if (chunkType === GLB_BINARY_CHUNK) {
      binary = chunk;
    }
    offset += chunkLength;
  }
  if (!json) throw new AssetLoadError("GLB does not contain a JSON chunk.");
  return { json, binary };
}

const COMPONENTS_PER_TYPE: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

const COMPONENT_BYTE_SIZE: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

function componentValue(
  view: DataView,
  offset: number,
  componentType: number,
  normalized: boolean,
): number {
  let value: number;
  switch (componentType) {
    case 5120:
      value = view.getInt8(offset);
      return normalized ? Math.max(value / 127, -1) : value;
    case 5121:
      value = view.getUint8(offset);
      return normalized ? value / 255 : value;
    case 5122:
      value = view.getInt16(offset, true);
      return normalized ? Math.max(value / 32767, -1) : value;
    case 5123:
      value = view.getUint16(offset, true);
      return normalized ? value / 65535 : value;
    case 5125:
      return view.getUint32(offset, true);
    case 5126:
      return view.getFloat32(offset, true);
    default:
      throw new AssetLoadError(`Unsupported accessor component type ${componentType}.`);
  }
}

function readAccessor(
  document: JsonRecord,
  buffers: ArrayBuffer[],
  accessorIndex: number,
): number[] {
  const accessor = document.accessors?.[accessorIndex];
  assertRecord(accessor, `Accessor ${accessorIndex} is missing.`);
  if (accessor.sparse) {
    throw new AssetLoadError("Sparse glTF accessors are not supported.");
  }
  const bufferView = document.bufferViews?.[accessor.bufferView];
  assertRecord(bufferView, `Accessor ${accessorIndex} references a missing bufferView.`);
  const buffer = buffers[bufferView.buffer];
  if (!buffer) throw new AssetLoadError(`bufferView ${accessor.bufferView} references a missing buffer.`);
  const componentCount = COMPONENTS_PER_TYPE[accessor.type];
  const componentSize = COMPONENT_BYTE_SIZE[accessor.componentType];
  if (!componentCount || !componentSize) {
    throw new AssetLoadError(`Accessor ${accessorIndex} has an unsupported type.`);
  }
  const packedStride = componentCount * componentSize;
  const stride = bufferView.byteStride ?? packedStride;
  if (stride < packedStride) {
    throw new AssetLoadError(`Accessor ${accessorIndex} has an invalid byte stride.`);
  }
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const count = Number(accessor.count);
  if (!Number.isInteger(count) || count < 0) {
    throw new AssetLoadError(`Accessor ${accessorIndex} has an invalid count.`);
  }
  const requiredEnd = start + Math.max(count - 1, 0) * stride + packedStride;
  if (start < 0 || requiredEnd > buffer.byteLength) {
    throw new AssetLoadError(`Accessor ${accessorIndex} exceeds its buffer.`);
  }
  const view = new DataView(buffer);
  const values: number[] = [];
  for (let item = 0; item < count; item += 1) {
    const itemOffset = start + item * stride;
    for (let component = 0; component < componentCount; component += 1) {
      values.push(
        componentValue(
          view,
          itemOffset + component * componentSize,
          accessor.componentType,
          Boolean(accessor.normalized),
        ),
      );
    }
  }
  return values;
}

function texturePayload(
  document: JsonRecord,
  buffers: ArrayBuffer[],
  textureIndex: number,
  externalImages: Map<number, TexturePayload>,
): TexturePayload | undefined {
  const texture = document.textures?.[textureIndex];
  if (!texture) return undefined;
  const imageIndex = texture.source;
  const image = document.images?.[imageIndex];
  if (!image) return undefined;
  if (typeof image.uri === "string" && image.uri.startsWith("data:")) {
    return decodeDataUri(image.uri);
  }
  if (Number.isInteger(image.bufferView)) {
    const view = document.bufferViews?.[image.bufferView];
    if (!view) throw new AssetLoadError(`Image ${imageIndex} references a missing bufferView.`);
    const buffer = buffers[view.buffer];
    if (!buffer) throw new AssetLoadError(`Image ${imageIndex} references a missing buffer.`);
    const start = view.byteOffset ?? 0;
    const end = start + view.byteLength;
    return {
      bytes: new Uint8Array(buffer.slice(start, end)),
      mimeType: image.mimeType ?? "application/octet-stream",
    };
  }
  return externalImages.get(imageIndex);
}

function buildMaterials(
  document: JsonRecord,
  buffers: ArrayBuffer[],
  externalImages: Map<number, TexturePayload>,
): MaterialData[] {
  const sourceMaterials = document.materials ?? [];
  const materials = sourceMaterials.map((material: JsonRecord, index: number): MaterialData => {
    const pbr = material.pbrMetallicRoughness ?? {};
    const color = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const result: MaterialData = {
      name: material.name ?? `Material ${index + 1}`,
      baseColor: [
        Number(color[0] ?? 1),
        Number(color[1] ?? 1),
        Number(color[2] ?? 1),
        Number(color[3] ?? 1),
      ],
      metallic: Number(pbr.metallicFactor ?? 1),
      roughness: Number(pbr.roughnessFactor ?? 1),
      doubleSided: Boolean(material.doubleSided),
    };
    if (Number.isInteger(pbr.baseColorTexture?.index)) {
      result.baseColorTexture = texturePayload(
        document,
        buffers,
        pbr.baseColorTexture.index,
        externalImages,
      );
    }
    return result;
  });
  materials.push({
    name: "Default material",
    baseColor: [0.72, 0.74, 0.78, 1],
    metallic: 0,
    roughness: 0.65,
    doubleSided: false,
  });
  return materials;
}

/**
 * Local TRS (or explicit matrix) for a glTF node.
 *
 * glTF stores `node.matrix` in **column-major** order, which is the same
 * convention the engine and `gl-matrix` use, so the 16 floats are consumed
 * verbatim with no transpose.
 */
function localNodeMatrix(node: JsonRecord): Float32Array {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    return new Float32Array(node.matrix.map(Number));
  }
  const translation = (node.translation ?? [0, 0, 0]).map(Number) as Vec3;
  const rotation = (node.rotation ?? [0, 0, 0, 1]).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const scale = (node.scale ?? [1, 1, 1]).map(Number) as Vec3;
  return mat4FromRotationTranslationScale(translation, rotation, scale);
}

export function parseGltfDocument(
  document: JsonRecord,
  buffers: ArrayBuffer[],
  externalImages = new Map<number, TexturePayload>(),
  name = "glTF asset",
): SceneAsset {
  if (document.asset?.version !== "2.0") {
    throw new AssetLoadError("Only glTF 2.0 assets are supported.");
  }
  if (!Array.isArray(document.meshes) || document.meshes.length === 0) {
    throw new AssetLoadError("glTF asset does not contain any meshes.");
  }
  const warnings: string[] = [];
  const materials = buildMaterials(document, buffers, externalImages);
  const defaultMaterial = materials.length - 1;
  const meshes: MeshData[] = [];
  const primitiveMap = new Map<number, Array<{ mesh: number; material: number }>>();

  document.meshes.forEach((sourceMesh: JsonRecord, sourceMeshIndex: number) => {
    const primitives = sourceMesh.primitives ?? [];
    if (primitives.length === 0) warnings.push(`Mesh ${sourceMeshIndex} contains no primitives.`);
    const mapped: Array<{ mesh: number; material: number }> = [];
    primitives.forEach((primitive: JsonRecord, primitiveIndex: number) => {
      if ((primitive.mode ?? 4) !== 4) {
        throw new AssetLoadError(
          `Mesh ${sourceMeshIndex} primitive ${primitiveIndex} is not TRIANGLES.`,
        );
      }
      const positionAccessor = primitive.attributes?.POSITION;
      if (!Number.isInteger(positionAccessor)) {
        throw new AssetLoadError(`Mesh ${sourceMeshIndex} primitive ${primitiveIndex} has no POSITION.`);
      }
      const positions = new Float32Array(readAccessor(document, buffers, positionAccessor));
      if (positions.length % 3 !== 0) {
        throw new AssetLoadError(`Mesh ${sourceMeshIndex} has malformed position data.`);
      }
      let indices: Uint32Array;
      if (Number.isInteger(primitive.indices)) {
        indices = new Uint32Array(readAccessor(document, buffers, primitive.indices));
      } else {
        indices = Uint32Array.from(
          { length: positions.length / 3 },
          (_, index) => index,
        );
      }
      const normals = Number.isInteger(primitive.attributes?.NORMAL)
        ? new Float32Array(readAccessor(document, buffers, primitive.attributes.NORMAL))
        : calculateSmoothNormals(positions, indices);
      if (!Number.isInteger(primitive.attributes?.NORMAL)) {
        warnings.push(`Generated normals for ${sourceMesh.name ?? `mesh ${sourceMeshIndex}`}.`);
      }
      const texcoords = Number.isInteger(primitive.attributes?.TEXCOORD_0)
        ? new Float32Array(readAccessor(document, buffers, primitive.attributes.TEXCOORD_0))
        : new Float32Array((positions.length / 3) * 2);
      if (normals.length !== positions.length) {
        throw new AssetLoadError(`Mesh ${sourceMeshIndex} normal count does not match positions.`);
      }
      if (texcoords.length !== (positions.length / 3) * 2) {
        throw new AssetLoadError(`Mesh ${sourceMeshIndex} UV count does not match positions.`);
      }
      const meshIndex = meshes.length;
      meshes.push({
        name: `${sourceMesh.name ?? `Mesh ${sourceMeshIndex + 1}`} / ${primitiveIndex + 1}`,
        positions,
        normals,
        texcoords,
        indices,
        bounds: calculateBounds(positions),
      });
      mapped.push({
        mesh: meshIndex,
        material: Number.isInteger(primitive.material)
          ? primitive.material
          : defaultMaterial,
      });
    });
    primitiveMap.set(sourceMeshIndex, mapped);
  });

  const objects: SceneObject[] = [];
  const lights: SceneLight[] = [];
  const nodes = document.nodes ?? [];
  const selectedScene = document.scenes?.[document.scene ?? 0];
  const rootNodes: number[] =
    selectedScene?.nodes ??
    nodes.map((_: unknown, index: number) => index);
  const gltfLights = document.extensions?.KHR_lights_punctual?.lights ?? [];
  const visited = new Set<number>();

  const visitNode = (nodeIndex: number, parentMatrix: Float32Array) => {
    if (visited.has(nodeIndex)) {
      throw new AssetLoadError("glTF node hierarchy contains a cycle or repeated root.");
    }
    visited.add(nodeIndex);
    const node = nodes[nodeIndex];
    assertRecord(node, `Node ${nodeIndex} is missing.`);
    // Pre-multiplication: the node's own local transform is applied first, then
    // the accumulated parent transform, so `parent * local` walks the hierarchy.
    const worldMatrix = mat4Multiply(parentMatrix, localNodeMatrix(node));
    if (Number.isInteger(node.mesh)) {
      const primitives = primitiveMap.get(node.mesh) ?? [];
      primitives.forEach((primitive, primitiveIndex) => {
        const source = meshes[primitive.mesh]!;
        objects.push({
          id: objects.length + 1,
          name: primitives.length > 1
            ? `${node.name ?? source.name} / ${primitiveIndex + 1}`
            : node.name ?? source.name,
          mesh: primitive.mesh,
          material: primitive.material,
          modelMatrix: worldMatrix,
          worldBounds: transformBoundingSphere(worldMatrix, source.bounds),
        });
      });
    }
    const lightIndex = node.extensions?.KHR_lights_punctual?.light;
    if (Number.isInteger(lightIndex) && gltfLights[lightIndex]) {
      const light = gltfLights[lightIndex];
      if (light.type === "spot") {
        warnings.push(`Spot light "${light.name ?? lightIndex}" is approximated as a point light.`);
      }
      lights.push({
        type: light.type === "directional" ? "directional" : "point",
        name: light.name ?? `Light ${lightIndex + 1}`,
        // KHR_lights_punctual: a light's local origin is its position, and it
        // shines down its local -Z axis.
        position: transformPoint(worldMatrix, [0, 0, 0]),
        direction: transformDirection(worldMatrix, [0, 0, -1]),
        color: (light.color ?? [1, 1, 1]).map(Number) as Vec3,
        intensity: Number(light.intensity ?? 1),
        range: Number(light.range ?? 12),
        castsShadow: light.type === "directional" && !lights.some((item) => item.castsShadow),
      });
    }
    (node.children ?? []).forEach((child: number) => visitNode(child, worldMatrix));
  };
  rootNodes.forEach((nodeIndex) => visitNode(nodeIndex, mat4Identity()));
  if (objects.length === 0) {
    throw new AssetLoadError("The selected glTF scene contains no renderable objects.");
  }
  if (lights.length === 0) {
    lights.push(
      {
        type: "directional",
        name: "Inspector key",
        position: [8, 12, 8],
        direction: [-0.5, -1, -0.4],
        color: [1, 0.94, 0.86],
        intensity: 3.1,
        range: 30,
        castsShadow: true,
      },
      {
        type: "point",
        name: "Inspector rim",
        position: [-5, 4, -4],
        direction: [0, -1, 0],
        color: [0.2, 0.65, 1],
        intensity: 35,
        range: 12,
        castsShadow: false,
      },
    );
  }
  const bounds = mergeSpheres(objects.map((object) => object.worldBounds));
  const radius = Math.max(bounds.radius, 0.5);
  return {
    name,
    source: "gltf",
    meshes,
    materials,
    objects,
    lights,
    camera: {
      target: bounds.center,
      distance: radius * 2.7,
      azimuth: 0.65,
      elevation: 0.38,
      near: Math.max(radius / 1000, 0.01),
      far: Math.max(radius * 12, 100),
    },
    bounds,
    warnings,
  };
}

async function fetchArrayBuffer(url: URL, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new AssetLoadError(`Failed to fetch ${url.pathname}: HTTP ${response.status}.`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_ASSET_BYTES) {
    throw new AssetLoadError("Asset resource exceeds the 128 MB safety limit.");
  }
  const data = await response.arrayBuffer();
  if (data.byteLength > MAX_ASSET_BYTES) {
    throw new AssetLoadError("Asset resource exceeds the 128 MB safety limit.");
  }
  return data;
}

async function resolveDocumentResources(
  document: JsonRecord,
  baseUrl: URL | null,
  glbBinary: ArrayBuffer | null,
  signal?: AbortSignal,
): Promise<{ buffers: ArrayBuffer[]; images: Map<number, TexturePayload> }> {
  const buffers: ArrayBuffer[] = [];
  for (let index = 0; index < (document.buffers?.length ?? 0); index += 1) {
    const source = document.buffers[index];
    if (typeof source.uri === "string") {
      if (source.uri.startsWith("data:")) {
        buffers.push(decodeDataUri(source.uri).bytes.buffer);
      } else if (baseUrl) {
        buffers.push(await fetchArrayBuffer(new URL(source.uri, baseUrl), signal));
      } else {
        throw new AssetLoadError(
          "Local .gltf files must embed buffers as data URIs; use GLB for portable upload.",
        );
      }
    } else if (index === 0 && glbBinary) {
      buffers.push(glbBinary);
    } else {
      throw new AssetLoadError(`Buffer ${index} has no resolvable data source.`);
    }
  }
  const images = new Map<number, TexturePayload>();
  for (let index = 0; index < (document.images?.length ?? 0); index += 1) {
    const image = document.images[index];
    if (
      typeof image.uri === "string" &&
      !image.uri.startsWith("data:") &&
      baseUrl
    ) {
      const bytes = new Uint8Array(
        await fetchArrayBuffer(new URL(image.uri, baseUrl), signal),
      );
      const extension = image.uri.split(".").pop()?.toLowerCase();
      images.set(index, {
        bytes,
        mimeType:
          extension === "jpg" || extension === "jpeg"
            ? "image/jpeg"
            : extension === "webp"
              ? "image/webp"
              : "image/png",
      });
    }
  }
  return { buffers, images };
}

export async function loadGltfFromUrl(
  source: string,
  signal?: AbortSignal,
): Promise<SceneAsset> {
  const url = new URL(source, window.location.href);
  const data = await fetchArrayBuffer(url, signal);
  const isGlb =
    url.pathname.toLowerCase().endsWith(".glb") ||
    (data.byteLength >= 4 && new DataView(data).getUint32(0, true) === GLB_MAGIC);
  const parsed = isGlb
    ? parseGlb(data)
    : {
        json: JSON.parse(new TextDecoder().decode(data)) as JsonRecord,
        binary: null,
      };
  assertRecord(parsed.json, "glTF root must be an object.");
  const resources = await resolveDocumentResources(
    parsed.json,
    url,
    parsed.binary,
    signal,
  );
  return parseGltfDocument(
    parsed.json,
    resources.buffers,
    resources.images,
    decodeURIComponent(url.pathname.split("/").pop() || "glTF asset"),
  );
}

export async function loadGltfFromFile(file: File): Promise<SceneAsset> {
  if (file.size > MAX_ASSET_BYTES) {
    throw new AssetLoadError("Asset exceeds the 128 MB upload safety limit.");
  }
  const data = await file.arrayBuffer();
  const isGlb =
    file.name.toLowerCase().endsWith(".glb") ||
    (data.byteLength >= 4 && new DataView(data).getUint32(0, true) === GLB_MAGIC);
  const parsed = isGlb
    ? parseGlb(data)
    : {
        json: JSON.parse(new TextDecoder().decode(data)) as JsonRecord,
        binary: null,
      };
  assertRecord(parsed.json, "glTF root must be an object.");
  const resources = await resolveDocumentResources(
    parsed.json,
    null,
    parsed.binary,
  );
  return parseGltfDocument(
    parsed.json,
    resources.buffers,
    resources.images,
    file.name,
  );
}

export function colorFactor(value: unknown, fallback: Vec4): Vec4 {
  if (!Array.isArray(value) || value.length !== 4) return fallback;
  return value.map(Number) as Vec4;
}

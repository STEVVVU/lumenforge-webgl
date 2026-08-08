export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export interface BoundingSphere {
  center: Vec3;
  radius: number;
}

export interface TexturePayload {
  bytes: Uint8Array;
  mimeType: string;
}

export interface MaterialData {
  name: string;
  baseColor: Vec4;
  metallic: number;
  roughness: number;
  doubleSided: boolean;
  baseColorTexture?: TexturePayload;
}

export interface MeshData {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  texcoords: Float32Array;
  indices: Uint32Array;
  bounds: BoundingSphere;
}

export interface SceneObject {
  id: number;
  name: string;
  mesh: number;
  material: number;
  modelMatrix: Float32Array;
  worldBounds: BoundingSphere;
}

export interface SceneLight {
  type: "directional" | "point";
  name: string;
  position: Vec3;
  direction: Vec3;
  color: Vec3;
  intensity: number;
  range: number;
  castsShadow: boolean;
}

export interface SceneCamera {
  target: Vec3;
  distance: number;
  azimuth: number;
  elevation: number;
  near: number;
  far: number;
}

export interface SceneAsset {
  name: string;
  source: "benchmark" | "gltf";
  meshes: MeshData[];
  materials: MaterialData[];
  objects: SceneObject[];
  lights: SceneLight[];
  camera: SceneCamera;
  bounds: BoundingSphere;
  warnings: string[];
}

export interface FrameStats {
  fps: number;
  cpuMs: number;
  gpuMs: number | null;
  drawCalls: number;
  triangles: number;
  visibleObjects: number;
  culledObjects: number;
  lights: number;
  width: number;
  height: number;
  timerSupported: boolean;
}

export interface RendererOptions {
  exposure: number;
  shadows: boolean;
  animateLights: boolean;
  debugMode: 0 | 1 | 2 | 3;
}

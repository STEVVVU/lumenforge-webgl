import { extractFrustumPlanes, sphereIntersectsFrustum } from "./frustum";
import { assertFramebuffer, createProgram, uniform } from "./gl";
import { GpuTimer } from "./gpuTimer";
import {
  mat3NormalFromMat4,
  mat4Invert,
  mat4LookAt,
  mat4Multiply,
  mat4Ortho,
  vec3Normalize,
  vec3Scale,
  vec3Subtract,
} from "./math";
import {
  fullscreenVertexShader,
  geometryFragmentShader,
  geometryVertexShader,
  lightingFragmentShader,
  pickingFragmentShader,
  pickingVertexShader,
  shadowFragmentShader,
  shadowVertexShader,
} from "./shaders";
import type {
  FrameStats,
  MaterialData,
  RendererOptions,
  SceneAsset,
  SceneLight,
  SceneObject,
  Vec3,
} from "./types";
import type { OrbitCamera } from "./camera";

const SHADOW_SIZE = 2048;
const MAX_LIGHTS = 32;

interface GpuMesh {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  indexCount: number;
  triangles: number;
}

interface GpuMaterial {
  texture: WebGLTexture;
  ownsTexture: boolean;
  source: MaterialData;
}

interface GeometryUniforms {
  model: WebGLUniformLocation;
  viewProjection: WebGLUniformLocation;
  normalMatrix: WebGLUniformLocation;
  baseColor: WebGLUniformLocation;
  metallic: WebGLUniformLocation;
  roughness: WebGLUniformLocation;
  useTexture: WebGLUniformLocation;
  texture: WebGLUniformLocation;
  selected: WebGLUniformLocation;
}

interface ShadowUniforms {
  model: WebGLUniformLocation;
  lightViewProjection: WebGLUniformLocation;
}

interface PickingUniforms {
  model: WebGLUniformLocation;
  viewProjection: WebGLUniformLocation;
  objectColor: WebGLUniformLocation;
}

interface LightingUniforms {
  albedoMetallic: WebGLUniformLocation;
  normalRoughness: WebGLUniformLocation;
  depth: WebGLUniformLocation;
  shadowMap: WebGLUniformLocation;
  inverseViewProjection: WebGLUniformLocation;
  lightViewProjection: WebGLUniformLocation;
  cameraPosition: WebGLUniformLocation;
  shadowTexel: WebGLUniformLocation;
  exposure: WebGLUniformLocation;
  shadowsEnabled: WebGLUniformLocation;
  debugMode: WebGLUniformLocation;
  lightCount: WebGLUniformLocation;
  lightType: WebGLUniformLocation;
  lightPosition: WebGLUniformLocation;
  lightDirection: WebGLUniformLocation;
  lightColor: WebGLUniformLocation;
  lightIntensity: WebGLUniformLocation;
  lightRange: WebGLUniformLocation;
}

export interface RendererCapabilities {
  webgl2: true;
  renderer: string;
  vendor: string;
  maxTextureSize: number;
  timerQuery: boolean;
  maxLights: number;
}

export interface RendererCallbacks {
  onContextState: (lost: boolean, message: string) => void;
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly callbacks: RendererCallbacks;
  private geometryProgram!: WebGLProgram;
  private shadowProgram!: WebGLProgram;
  private lightingProgram!: WebGLProgram;
  private pickingProgram!: WebGLProgram;
  private geometryUniforms!: GeometryUniforms;
  private shadowUniforms!: ShadowUniforms;
  private lightingUniforms!: LightingUniforms;
  private pickingUniforms!: PickingUniforms;
  private fullscreenVao!: WebGLVertexArrayObject;
  private whiteTexture!: WebGLTexture;
  private gBuffer!: WebGLFramebuffer;
  private albedoTexture!: WebGLTexture;
  private normalTexture!: WebGLTexture;
  private depthTexture!: WebGLTexture;
  private shadowFramebuffer!: WebGLFramebuffer;
  private shadowTexture!: WebGLTexture;
  private pickingFramebuffer!: WebGLFramebuffer;
  private pickingTexture!: WebGLTexture;
  private pickingDepth!: WebGLRenderbuffer;
  private gpuTimer!: GpuTimer;
  private gpuMeshes: GpuMesh[] = [];
  private gpuMaterials: GpuMaterial[] = [];
  private scene: SceneAsset | null = null;
  private width = 1;
  private height = 1;
  private contextLost = false;
  private uploadRevision = 0;
  private selectedObjectId: number | null = null;
  private lastViewProjection = new Float32Array(16);
  private lightViewProjection = new Float32Array(16);

  constructor(canvas: HTMLCanvasElement, callbacks: RendererCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      depth: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      throw new Error("WebGL2 is required but is not available in this browser.");
    }
    this.gl = gl;
    this.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    this.initialize();
  }

  private initialize(): void {
    const gl = this.gl;
    this.geometryProgram = createProgram(gl, geometryVertexShader, geometryFragmentShader);
    this.shadowProgram = createProgram(gl, shadowVertexShader, shadowFragmentShader);
    this.lightingProgram = createProgram(gl, fullscreenVertexShader, lightingFragmentShader);
    this.pickingProgram = createProgram(gl, pickingVertexShader, pickingFragmentShader);
    this.geometryUniforms = {
      model: uniform(gl, this.geometryProgram, "uModel"),
      viewProjection: uniform(gl, this.geometryProgram, "uViewProjection"),
      normalMatrix: uniform(gl, this.geometryProgram, "uNormalMatrix"),
      baseColor: uniform(gl, this.geometryProgram, "uBaseColor"),
      metallic: uniform(gl, this.geometryProgram, "uMetallic"),
      roughness: uniform(gl, this.geometryProgram, "uRoughness"),
      useTexture: uniform(gl, this.geometryProgram, "uUseBaseColorTexture"),
      texture: uniform(gl, this.geometryProgram, "uBaseColorTexture"),
      selected: uniform(gl, this.geometryProgram, "uSelected"),
    };
    this.shadowUniforms = {
      model: uniform(gl, this.shadowProgram, "uModel"),
      lightViewProjection: uniform(gl, this.shadowProgram, "uLightViewProjection"),
    };
    this.pickingUniforms = {
      model: uniform(gl, this.pickingProgram, "uModel"),
      viewProjection: uniform(gl, this.pickingProgram, "uViewProjection"),
      objectColor: uniform(gl, this.pickingProgram, "uObjectColor"),
    };
    this.lightingUniforms = {
      albedoMetallic: uniform(gl, this.lightingProgram, "uAlbedoMetallic"),
      normalRoughness: uniform(gl, this.lightingProgram, "uNormalRoughness"),
      depth: uniform(gl, this.lightingProgram, "uDepth"),
      shadowMap: uniform(gl, this.lightingProgram, "uShadowMap"),
      inverseViewProjection: uniform(gl, this.lightingProgram, "uInverseViewProjection"),
      lightViewProjection: uniform(gl, this.lightingProgram, "uLightViewProjection"),
      cameraPosition: uniform(gl, this.lightingProgram, "uCameraPosition"),
      shadowTexel: uniform(gl, this.lightingProgram, "uShadowTexel"),
      exposure: uniform(gl, this.lightingProgram, "uExposure"),
      shadowsEnabled: uniform(gl, this.lightingProgram, "uShadowsEnabled"),
      debugMode: uniform(gl, this.lightingProgram, "uDebugMode"),
      lightCount: uniform(gl, this.lightingProgram, "uLightCount"),
      lightType: uniform(gl, this.lightingProgram, "uLightType[0]"),
      lightPosition: uniform(gl, this.lightingProgram, "uLightPosition[0]"),
      lightDirection: uniform(gl, this.lightingProgram, "uLightDirection[0]"),
      lightColor: uniform(gl, this.lightingProgram, "uLightColor[0]"),
      lightIntensity: uniform(gl, this.lightingProgram, "uLightIntensity[0]"),
      lightRange: uniform(gl, this.lightingProgram, "uLightRange[0]"),
    };
    const fullscreenVao = gl.createVertexArray();
    if (!fullscreenVao) throw new Error("Unable to allocate the fullscreen vertex array.");
    this.fullscreenVao = fullscreenVao;
    this.whiteTexture = this.createWhiteTexture();
    this.createShadowResources();
    this.createGBufferResources();
    this.createPickingResources();
    this.gpuTimer = new GpuTimer(gl);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  get capabilities(): RendererCapabilities {
    const gl = this.gl;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      webgl2: true,
      renderer: debug
        ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
        : String(gl.getParameter(gl.RENDERER)),
      vendor: debug
        ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL))
        : String(gl.getParameter(gl.VENDOR)),
      maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
      timerQuery: this.gpuTimer.supported,
      maxLights: MAX_LIGHTS,
    };
  }

  private createWhiteTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("Unable to allocate the default texture.");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  private createShadowResources(): void {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    const texture = gl.createTexture();
    if (!framebuffer || !texture) throw new Error("Unable to allocate shadow resources.");
    this.shadowFramebuffer = framebuffer;
    this.shadowTexture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24,
      SHADOW_SIZE,
      SHADOW_SIZE,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    assertFramebuffer(gl, "Shadow");
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private createGBufferResources(): void {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    const albedo = gl.createTexture();
    const normal = gl.createTexture();
    const depth = gl.createTexture();
    if (!framebuffer || !albedo || !normal || !depth) {
      throw new Error("Unable to allocate G-buffer resources.");
    }
    this.gBuffer = framebuffer;
    this.albedoTexture = albedo;
    this.normalTexture = normal;
    this.depthTexture = depth;
    this.allocateGBuffer();
  }

  private allocateGBuffer(): void {
    const gl = this.gl;
    const colorTextures = [this.albedoTexture, this.normalTexture];
    colorTextures.forEach((texture) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        this.width,
        this.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    });
    gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24,
      this.width,
      this.height,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gBuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.albedoTexture,
      0,
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT1,
      gl.TEXTURE_2D,
      this.normalTexture,
      0,
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D,
      this.depthTexture,
      0,
    );
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    assertFramebuffer(gl, "G-buffer");
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private createPickingResources(): void {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    const texture = gl.createTexture();
    const depth = gl.createRenderbuffer();
    if (!framebuffer || !texture || !depth) {
      throw new Error("Unable to allocate picking resources.");
    }
    this.pickingFramebuffer = framebuffer;
    this.pickingTexture = texture;
    this.pickingDepth = depth;
    this.allocatePickingBuffer();
  }

  private allocatePickingBuffer(): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.pickingTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      this.width,
      this.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickingDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.width, this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickingFramebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.pickingTexture,
      0,
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      this.pickingDepth,
    );
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    assertFramebuffer(gl, "Picking");
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    const nextWidth = Math.max(1, Math.floor(width * Math.min(devicePixelRatio, 2)));
    const nextHeight = Math.max(1, Math.floor(height * Math.min(devicePixelRatio, 2)));
    if (nextWidth === this.width && nextHeight === this.height) return;
    this.width = nextWidth;
    this.height = nextHeight;
    this.canvas.width = nextWidth;
    this.canvas.height = nextHeight;
    if (!this.contextLost) {
      this.allocateGBuffer();
      this.allocatePickingBuffer();
    }
  }

  async setScene(scene: SceneAsset): Promise<void> {
    this.scene = scene;
    this.selectedObjectId = null;
    await this.uploadScene(scene);
  }

  private async uploadScene(scene: SceneAsset): Promise<void> {
    const revision = ++this.uploadRevision;
    const gl = this.gl;
    this.disposeSceneResources();
    const meshes = scene.meshes.map((source): GpuMesh => {
      const vao = gl.createVertexArray();
      if (!vao) throw new Error("Unable to allocate mesh vertex array.");
      const buffers: WebGLBuffer[] = [];
      gl.bindVertexArray(vao);
      const attributes: Array<[Float32Array, number, number]> = [
        [source.positions, 0, 3],
        [source.normals, 1, 3],
        [source.texcoords, 2, 2],
      ];
      attributes.forEach(([data, location, size]) => {
        const buffer = gl.createBuffer();
        if (!buffer) throw new Error("Unable to allocate mesh vertex buffer.");
        buffers.push(buffer);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
      });
      const indexBuffer = gl.createBuffer();
      if (!indexBuffer) throw new Error("Unable to allocate mesh index buffer.");
      buffers.push(indexBuffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, source.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return {
        vao,
        buffers,
        indexCount: source.indices.length,
        triangles: source.indices.length / 3,
      };
    });
    const materials = await Promise.all(
      scene.materials.map(async (source): Promise<GpuMaterial> => {
        if (!source.baseColorTexture) {
          return { texture: this.whiteTexture, ownsTexture: false, source };
        }
        const blob = new Blob([source.baseColorTexture.bytes.slice().buffer], {
          type: source.baseColorTexture.mimeType,
        });
        let bitmap: ImageBitmap;
        try {
          bitmap = await createImageBitmap(blob);
        } catch {
          throw new Error(`Could not decode texture for material "${source.name}".`);
        }
        const texture = gl.createTexture();
        if (!texture) {
          bitmap.close();
          throw new Error("Unable to allocate a material texture.");
        }
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.SRGB8_ALPHA8,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          bitmap,
        );
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        bitmap.close();
        return { texture, ownsTexture: true, source };
      }),
    );
    if (revision !== this.uploadRevision || this.contextLost) {
      meshes.forEach((gpuMesh) => {
        gl.deleteVertexArray(gpuMesh.vao);
        gpuMesh.buffers.forEach((buffer) => gl.deleteBuffer(buffer));
      });
      materials.forEach((material) => {
        if (material.ownsTexture) gl.deleteTexture(material.texture);
      });
      return;
    }
    this.gpuMeshes = meshes;
    this.gpuMaterials = materials;
  }

  selectObject(id: number | null): void {
    this.selectedObjectId = id;
  }

  /**
   * Inverse-transpose of the model matrix' upper-left 3x3, so normals stay
   * perpendicular to the surface under non-uniform scale. Column-major 3x3 for
   * `uniformMatrix3fv(..., transpose = false)`.
   */
  private normalMatrix(model: Float32Array): Float32Array {
    return mat3NormalFromMat4(model);
  }

  private drawObject(object: SceneObject): void {
    const mesh = this.gpuMeshes[object.mesh];
    if (!mesh) return;
    this.gl.bindVertexArray(mesh.vao);
    this.gl.drawElements(this.gl.TRIANGLES, mesh.indexCount, this.gl.UNSIGNED_INT, 0);
  }

  private computeLightMatrix(scene: SceneAsset): Float32Array {
    const directional = scene.lights.find((light) => light.type === "directional");
    const direction = vec3Normalize(directional?.direction ?? [-0.5, -1, -0.4]);
    const radius = Math.max(scene.bounds.radius, 4);
    const eye = vec3Subtract(scene.bounds.center, vec3Scale(direction, radius * 2.5));
    const view = mat4LookAt(eye, scene.bounds.center, [0, 1, 0]);
    const projection = mat4Ortho(
      -radius * 1.25,
      radius * 1.25,
      -radius * 1.25,
      radius * 1.25,
      0.1,
      radius * 5,
    );
    // Pre-multiplication: world -> light view -> light clip.
    return mat4Multiply(projection, view);
  }

  render(
    camera: OrbitCamera,
    options: RendererOptions,
    elapsedSeconds: number,
  ): FrameStats {
    const start = performance.now();
    if (this.contextLost || !this.scene || this.gpuMeshes.length === 0) {
      return this.emptyStats(performance.now() - start);
    }
    const scene = this.scene;
    const gl = this.gl;
    const projection = camera.projectionMatrix(this.width / this.height);
    const view = camera.viewMatrix();
    // Pre-multiplication: `view` is applied first, then `projection`.
    const viewProjection = mat4Multiply(projection, view);
    this.lastViewProjection = viewProjection;
    const inverseViewProjection = mat4Invert(viewProjection);
    const planes = extractFrustumPlanes(viewProjection);
    const visible = scene.objects.filter((object) =>
      sphereIntersectsFrustum(object.worldBounds, planes),
    );
    this.lightViewProjection = this.computeLightMatrix(scene);
    let drawCalls = 0;
    this.gpuTimer.begin();

    if (options.shadows) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFramebuffer);
      gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.colorMask(false, false, false, false);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(2, 4);
      gl.useProgram(this.shadowProgram);
      gl.uniformMatrix4fv(
        this.shadowUniforms.lightViewProjection,
        false,
        this.lightViewProjection,
      );
      scene.objects.forEach((object) => {
        gl.uniformMatrix4fv(this.shadowUniforms.model, false, object.modelMatrix);
        this.drawObject(object);
        drawCalls += 1;
      });
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.colorMask(true, true, true, true);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gBuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.useProgram(this.geometryProgram);
    gl.uniformMatrix4fv(this.geometryUniforms.viewProjection, false, viewProjection);
    gl.uniform1i(this.geometryUniforms.texture, 0);
    visible.forEach((object) => {
      const material = this.gpuMaterials[object.material];
      if (!material) return;
      if (material.source.doubleSided) gl.disable(gl.CULL_FACE);
      else gl.enable(gl.CULL_FACE);
      gl.uniformMatrix4fv(this.geometryUniforms.model, false, object.modelMatrix);
      gl.uniformMatrix3fv(
        this.geometryUniforms.normalMatrix,
        false,
        this.normalMatrix(object.modelMatrix),
      );
      gl.uniform4fv(this.geometryUniforms.baseColor, material.source.baseColor);
      gl.uniform1f(this.geometryUniforms.metallic, material.source.metallic);
      gl.uniform1f(this.geometryUniforms.roughness, material.source.roughness);
      gl.uniform1i(
        this.geometryUniforms.useTexture,
        material.source.baseColorTexture ? 1 : 0,
      );
      gl.uniform1i(
        this.geometryUniforms.selected,
        object.id === this.selectedObjectId ? 1 : 0,
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, material.texture);
      this.drawObject(object);
      drawCalls += 1;
    });
    gl.enable(gl.CULL_FACE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.lightingProgram);
    gl.bindVertexArray(this.fullscreenVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.albedoTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.normalTexture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
    gl.uniform1i(this.lightingUniforms.albedoMetallic, 0);
    gl.uniform1i(this.lightingUniforms.normalRoughness, 1);
    gl.uniform1i(this.lightingUniforms.depth, 2);
    gl.uniform1i(this.lightingUniforms.shadowMap, 3);
    gl.uniformMatrix4fv(
      this.lightingUniforms.inverseViewProjection,
      false,
      inverseViewProjection,
    );
    gl.uniformMatrix4fv(
      this.lightingUniforms.lightViewProjection,
      false,
      this.lightViewProjection,
    );
    gl.uniform3fv(this.lightingUniforms.cameraPosition, camera.position);
    gl.uniform2f(
      this.lightingUniforms.shadowTexel,
      1 / SHADOW_SIZE,
      1 / SHADOW_SIZE,
    );
    gl.uniform1f(this.lightingUniforms.exposure, options.exposure);
    gl.uniform1i(this.lightingUniforms.shadowsEnabled, options.shadows ? 1 : 0);
    gl.uniform1i(this.lightingUniforms.debugMode, options.debugMode);
    this.uploadLights(scene.lights, options.animateLights, elapsedSeconds);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    drawCalls += 1;
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    this.gpuTimer.end();

    const cpuMs = performance.now() - start;
    const triangles = visible.reduce(
      (total, object) => total + (this.gpuMeshes[object.mesh]?.triangles ?? 0),
      0,
    );
    return {
      fps: cpuMs > 0 ? 1000 / cpuMs : 0,
      cpuMs,
      gpuMs: this.gpuTimer.result(),
      drawCalls,
      triangles,
      visibleObjects: visible.length,
      culledObjects: scene.objects.length - visible.length,
      lights: Math.min(scene.lights.length, MAX_LIGHTS),
      width: this.width,
      height: this.height,
      timerSupported: this.gpuTimer.supported,
    };
  }

  private uploadLights(
    lights: SceneLight[],
    animate: boolean,
    elapsedSeconds: number,
  ): void {
    const count = Math.min(lights.length, MAX_LIGHTS);
    const types = new Int32Array(MAX_LIGHTS);
    const positions = new Float32Array(MAX_LIGHTS * 3);
    const directions = new Float32Array(MAX_LIGHTS * 3);
    const colors = new Float32Array(MAX_LIGHTS * 3);
    const intensities = new Float32Array(MAX_LIGHTS);
    const ranges = new Float32Array(MAX_LIGHTS);
    for (let index = 0; index < count; index += 1) {
      const light = lights[index]!;
      types[index] = light.type === "directional" ? 0 : 1;
      const phase = elapsedSeconds * 0.34 + index * 0.71;
      const position: Vec3 =
        animate && light.type === "point"
          ? [
              light.position[0] + Math.sin(phase) * 0.7,
              light.position[1] + Math.sin(phase * 1.7) * 0.25,
              light.position[2] + Math.cos(phase) * 0.7,
            ]
          : light.position;
      positions.set(position, index * 3);
      directions.set(light.direction, index * 3);
      colors.set(light.color, index * 3);
      intensities[index] = light.intensity;
      ranges[index] = light.range;
    }
    const gl = this.gl;
    gl.uniform1i(this.lightingUniforms.lightCount, count);
    gl.uniform1iv(this.lightingUniforms.lightType, types);
    gl.uniform3fv(this.lightingUniforms.lightPosition, positions);
    gl.uniform3fv(this.lightingUniforms.lightDirection, directions);
    gl.uniform3fv(this.lightingUniforms.lightColor, colors);
    gl.uniform1fv(this.lightingUniforms.lightIntensity, intensities);
    gl.uniform1fv(this.lightingUniforms.lightRange, ranges);
  }

  pick(cssX: number, cssY: number): number | null {
    if (this.contextLost || !this.scene || this.gpuMeshes.length === 0) return null;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickingFramebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.pickingProgram);
    gl.uniformMatrix4fv(
      this.pickingUniforms.viewProjection,
      false,
      this.lastViewProjection,
    );
    this.scene.objects.forEach((object) => {
      const id = object.id;
      gl.uniformMatrix4fv(this.pickingUniforms.model, false, object.modelMatrix);
      gl.uniform3f(
        this.pickingUniforms.objectColor,
        (id & 0xff) / 255,
        ((id >> 8) & 0xff) / 255,
        ((id >> 16) & 0xff) / 255,
      );
      this.drawObject(object);
    });
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.min(this.width - 1, Math.max(0, Math.floor(cssX * this.width / rect.width)));
    const y = Math.min(
      this.height - 1,
      Math.max(0, Math.floor((rect.height - cssY) * this.height / rect.height)),
    );
    const pixel = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const id = (pixel[0] ?? 0) | ((pixel[1] ?? 0) << 8) | ((pixel[2] ?? 0) << 16);
    return id === 0 ? null : id;
  }

  private emptyStats(cpuMs: number): FrameStats {
    return {
      fps: 0,
      cpuMs,
      gpuMs: null,
      drawCalls: 0,
      triangles: 0,
      visibleObjects: 0,
      culledObjects: 0,
      lights: 0,
      width: this.width,
      height: this.height,
      timerSupported: this.gpuTimer?.supported ?? false,
    };
  }

  private disposeSceneResources(): void {
    const gl = this.gl;
    this.gpuMeshes.forEach((mesh) => {
      gl.deleteVertexArray(mesh.vao);
      mesh.buffers.forEach((buffer) => gl.deleteBuffer(buffer));
    });
    this.gpuMaterials.forEach((material) => {
      if (material.ownsTexture) gl.deleteTexture(material.texture);
    });
    this.gpuMeshes = [];
    this.gpuMaterials = [];
  }

  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.uploadRevision += 1;
    this.callbacks.onContextState(true, "WebGL context lost. Waiting for browser recovery.");
  };

  private onContextRestored = () => {
    this.contextLost = false;
    this.callbacks.onContextState(false, "Rebuilding GPU resources.");
    try {
      this.initialize();
      const scene = this.scene;
      if (scene) {
        void this.uploadScene(scene).then(() => {
          this.callbacks.onContextState(false, "GPU resources restored.");
        });
      }
      this.resize(
        this.canvas.clientWidth,
        this.canvas.clientHeight,
        window.devicePixelRatio,
      );
    } catch (error) {
      this.callbacks.onContextState(
        true,
        error instanceof Error ? error.message : "Context recovery failed.",
      );
    }
  };

  dispose(): void {
    const gl = this.gl;
    this.uploadRevision += 1;
    this.disposeSceneResources();
    this.gpuTimer.dispose();
    [
      this.geometryProgram,
      this.shadowProgram,
      this.lightingProgram,
      this.pickingProgram,
    ].forEach((program) => gl.deleteProgram(program));
    [
      this.whiteTexture,
      this.albedoTexture,
      this.normalTexture,
      this.depthTexture,
      this.shadowTexture,
      this.pickingTexture,
    ].forEach((texture) => gl.deleteTexture(texture));
    gl.deleteFramebuffer(this.gBuffer);
    gl.deleteFramebuffer(this.shadowFramebuffer);
    gl.deleteFramebuffer(this.pickingFramebuffer);
    gl.deleteRenderbuffer(this.pickingDepth);
    gl.deleteVertexArray(this.fullscreenVao);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
  }
}

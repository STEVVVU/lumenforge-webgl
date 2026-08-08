import { OrbitCamera, OrbitInput } from "./engine/camera";
import { Renderer, type RendererCapabilities } from "./engine/renderer";
import type {
  BoundingSphere,
  FrameStats,
  RendererOptions,
  SceneAsset,
  SceneObject,
} from "./engine/types";

export interface ViewerCallbacks {
  onStats: (stats: FrameStats) => void;
  onSelection: (object: SceneObject | null) => void;
  onContextState: (lost: boolean, message: string) => void;
}

export class Viewer {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: ViewerCallbacks;
  private readonly renderer: Renderer;
  private readonly camera = new OrbitCamera();
  private readonly input: OrbitInput;
  private readonly resizeObserver: ResizeObserver;
  private scene: SceneAsset | null = null;
  private animationFrame = 0;
  private startTime = performance.now();
  private lastFrame = performance.now();
  private lastStatsAt = 0;
  private smoothedFps = 60;
  private pausedAt: number | null = null;
  private pausedDuration = 0;
  private options: RendererOptions = {
    exposure: 1,
    shadows: true,
    animateLights: true,
    debugMode: 0,
  };

  constructor(canvas: HTMLCanvasElement, callbacks: ViewerCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.renderer = new Renderer(canvas, {
      onContextState: callbacks.onContextState,
    });
    this.input = new OrbitInput(canvas, this.camera, {
      onPick: (x, y) => this.pick(x, y),
    });
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      this.renderer.resize(
        entry.contentRect.width,
        entry.contentRect.height,
        window.devicePixelRatio,
      );
    });
    this.resizeObserver.observe(canvas);
    this.renderer.resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  get capabilities(): RendererCapabilities {
    return this.renderer.capabilities;
  }

  async setScene(scene: SceneAsset): Promise<void> {
    await this.renderer.setScene(scene);
    this.scene = scene;
    this.camera.configure(scene.camera);
    this.callbacks.onSelection(null);
  }

  setOptions(options: Partial<RendererOptions>): void {
    this.options = { ...this.options, ...options };
  }

  setPaused(paused: boolean): void {
    if (paused && this.pausedAt === null) {
      this.pausedAt = performance.now();
    } else if (!paused && this.pausedAt !== null) {
      this.pausedDuration += performance.now() - this.pausedAt;
      this.pausedAt = null;
    }
  }

  resetCamera(): void {
    if (this.scene) this.camera.configure(this.scene.camera);
  }

  focus(bounds: BoundingSphere): void {
    this.camera.focus(bounds);
  }

  select(object: SceneObject | null): void {
    this.renderer.selectObject(object?.id ?? null);
    this.callbacks.onSelection(object);
  }

  private pick(x: number, y: number): void {
    if (!this.scene) return;
    const id = this.renderer.pick(x, y);
    const object = this.scene.objects.find((candidate) => candidate.id === id) ?? null;
    this.select(object);
  }

  private frame = (now: number) => {
    const delta = Math.max(now - this.lastFrame, 0.01);
    this.lastFrame = now;
    const instantaneousFps = 1000 / delta;
    this.smoothedFps += (instantaneousFps - this.smoothedFps) * 0.08;
    const effectiveNow = this.pausedAt ?? now;
    const elapsed = (effectiveNow - this.startTime - this.pausedDuration) / 1000;
    const stats = this.renderer.render(this.camera, this.options, elapsed);
    stats.fps = this.smoothedFps;
    if (now - this.lastStatsAt > 200) {
      this.callbacks.onStats(stats);
      this.lastStatsAt = now;
    }
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private onVisibilityChange = () => {
    this.lastFrame = performance.now();
  };

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.renderer.dispose();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }
}

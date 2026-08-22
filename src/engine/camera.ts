import {
  mat4LookAt,
  mat4Perspective,
  vec3Add,
  vec3Cross,
  vec3Normalize,
  vec3Scale,
  vec3Subtract,
} from "./math";
import type { BoundingSphere, SceneCamera, Vec3 } from "./types";

export class OrbitCamera {
  target: Vec3 = [0, 0, 0];
  distance = 10;
  azimuth = 0.7;
  elevation = 0.4;
  near = 0.1;
  far = 100;
  fieldOfView = Math.PI / 4;

  /**
   * Orbit position in a right-handed, +Y-up world: `azimuth` sweeps the XZ
   * plane (0 looks along +Z) and `elevation` lifts toward +Y.
   */
  get position(): Vec3 {
    const horizontal = Math.cos(this.elevation) * this.distance;
    return [
      this.target[0] + Math.sin(this.azimuth) * horizontal,
      this.target[1] + Math.sin(this.elevation) * this.distance,
      this.target[2] + Math.cos(this.azimuth) * horizontal,
    ];
  }

  configure(camera: SceneCamera): void {
    this.target = [...camera.target];
    this.distance = camera.distance;
    this.azimuth = camera.azimuth;
    this.elevation = camera.elevation;
    this.near = camera.near;
    this.far = camera.far;
  }

  /** World -> view. Right-handed, +Y up, camera looking down -Z in view space. */
  viewMatrix(): Float32Array {
    return mat4LookAt(this.position, this.target, [0, 1, 0]);
  }

  projectionMatrix(aspect: number): Float32Array {
    return mat4Perspective(this.fieldOfView, Math.max(aspect, 0.01), this.near, this.far);
  }

  orbit(deltaX: number, deltaY: number): void {
    this.azimuth -= deltaX * 0.006;
    this.elevation = Math.max(
      -Math.PI * 0.48,
      Math.min(Math.PI * 0.48, this.elevation - deltaY * 0.006),
    );
  }

  pan(deltaX: number, deltaY: number): void {
    const forward = vec3Normalize(vec3Subtract(this.target, this.position));
    const right = vec3Normalize(vec3Cross(forward, [0, 1, 0]));
    const up = vec3Normalize(vec3Cross(right, forward));
    const scale = this.distance * 0.0015;
    this.target = vec3Add(
      this.target,
      vec3Add(vec3Scale(right, -deltaX * scale), vec3Scale(up, deltaY * scale)),
    );
  }

  zoom(delta: number): void {
    this.distance = Math.max(
      this.near * 3,
      Math.min(this.far * 0.7, this.distance * Math.exp(delta * 0.001)),
    );
  }

  focus(bounds: BoundingSphere): void {
    this.target = [...bounds.center];
    this.distance = Math.max(bounds.radius * 2.8, this.near * 5);
  }
}

export interface OrbitInputCallbacks {
  onPick: (x: number, y: number) => void;
}

export class OrbitInput {
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: OrbitCamera;
  private readonly callbacks: OrbitInputCallbacks;
  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private startX = 0;
  private startY = 0;
  private button = 0;

  constructor(
    canvas: HTMLCanvasElement,
    camera: OrbitCamera,
    callbacks: OrbitInputCallbacks,
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.callbacks = callbacks;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.preventContextMenu);
  }

  private onPointerDown = (event: PointerEvent) => {
    this.pointerId = event.pointerId;
    this.button = event.button;
    this.lastX = this.startX = event.clientX;
    this.lastY = this.startY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent) => {
    if (this.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - this.lastX;
    const deltaY = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    if (this.button === 2 || event.shiftKey) {
      this.camera.pan(deltaX, deltaY);
    } else {
      this.camera.orbit(deltaX, deltaY);
    }
  };

  private onPointerUp = (event: PointerEvent) => {
    if (this.pointerId !== event.pointerId) return;
    const travel = Math.hypot(event.clientX - this.startX, event.clientY - this.startY);
    if (travel < 4 && this.button === 0) {
      const bounds = this.canvas.getBoundingClientRect();
      this.callbacks.onPick(event.clientX - bounds.left, event.clientY - bounds.top);
    }
    this.canvas.releasePointerCapture(event.pointerId);
    this.pointerId = null;
  };

  private onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.camera.zoom(event.deltaY);
  };

  private preventContextMenu = (event: MouseEvent) => event.preventDefault();

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.preventContextMenu);
  }
}

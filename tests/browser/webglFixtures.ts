import type { Page } from "@playwright/test";

/**
 * Shared browser-side probes for the WebGL2 viewport.
 *
 * Everything here runs inside the page via `page.evaluate`, so it reads the real
 * GL context rather than inferring state from the DOM.
 */

export interface CanvasSample {
  webgl2: boolean;
  /** Backing-buffer size in device pixels (canvas.width/height). */
  width: number;
  height: number;
  /** CSS layout size in logical pixels. */
  cssWidth: number;
  cssHeight: number;
  /** Fraction of sampled pixels brighter than a near-black threshold. */
  nonBlankRatio: number;
  /** Count of distinct quantized colours; a proxy for "real shading happened". */
  distinct: number;
  renderer: string;
  /** `gl.getError()` after reading the frame. 0 == GL_NO_ERROR. */
  glError: number;
}

/**
 * Reads the framebuffer back and summarizes it.
 *
 * Sampling is strided rather than per-pixel: the goal is a cheap, stable
 * signature of "the scene rendered", not a pixel-exact golden image. Golden
 * images would be fragile across SwiftShader versions.
 */
export async function sampleCanvas(page: Page): Promise<CanvasSample> {
  return page.evaluate(async () => {
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2");
    if (!canvas || !gl) {
      return {
        webgl2: false,
        width: 0,
        height: 0,
        cssWidth: 0,
        cssHeight: 0,
        nonBlankRatio: 0,
        distinct: 0,
        renderer: "none",
        glError: -1,
      };
    }

    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    const glError = gl.getError();
    const colors = new Set<string>();
    let nonBlank = 0;
    let samples = 0;
    const stride = Math.max(
      1,
      Math.floor(Math.min(canvas.width, canvas.height) / 32),
    );
    for (let y = 0; y < canvas.height; y += stride) {
      for (let x = 0; x < canvas.width; x += stride) {
        const offset = (y * canvas.width + x) * 4;
        const red = pixels[offset] ?? 0;
        const green = pixels[offset + 1] ?? 0;
        const blue = pixels[offset + 2] ?? 0;
        // Rec. 709 luma; "non-blank" means visibly above black.
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        // Quantize to 4 bits per channel so dithering noise does not inflate the
        // distinct-colour count.
        colors.add(`${red >> 4},${green >> 4},${blue >> 4}`);
        nonBlank += Number(luminance > 8);
        samples += 1;
      }
    }
    const bounds = canvas.getBoundingClientRect();
    return {
      webgl2: true,
      width: canvas.width,
      height: canvas.height,
      cssWidth: Math.round(bounds.width),
      cssHeight: Math.round(bounds.height),
      nonBlankRatio: nonBlank / samples,
      distinct: colors.size,
      renderer: String(gl.getParameter(gl.RENDERER)),
      glError,
    };
  });
}

/** Waits until the app has finished loading its scene. */
export async function waitForSceneReady(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.querySelector(".state-overlay"));
  // One extra frame so the first render has definitely landed in the buffer.
  await page.evaluate(
    () => new Promise((resolveFrame) => requestAnimationFrame(resolveFrame)),
  );
}

/**
 * Freezes light animation so the frame becomes a pure function of scene
 * transforms, camera and viewport. Without this, timing-dependent light
 * positions make frame comparisons unstable.
 */
export async function pauseLightMotion(page: Page): Promise<void> {
  const pause = page.getByRole("button", { name: "Pause light motion" });
  if (await pause.count()) await pause.click();
}

export interface FrameDiagnostics {
  fps: number;
  cpuMs: number;
  gpuMs: number | null;
  drawCalls: number;
  triangles: string;
  culled: number;
}

/** Reads the on-screen frame diagnostics overlay. */
export async function readDiagnostics(page: Page): Promise<FrameDiagnostics> {
  return page.evaluate(() => {
    const metrics = [...document.querySelectorAll(".performance-overlay .metric")];
    const read = (label: string): string => {
      const hit = metrics.find(
        (metric) => metric.querySelector("span")?.textContent === label,
      );
      return hit?.querySelector("strong")?.textContent ?? "";
    };
    const gpu = read("GPU");
    return {
      fps: Number.parseFloat(read("FPS")),
      cpuMs: Number.parseFloat(read("CPU")),
      gpuMs: gpu === "N/A" ? null : Number.parseFloat(gpu),
      drawCalls: Number.parseInt(read("Draws"), 10),
      triangles: read("Tris"),
      culled: Number.parseInt(read("Culled"), 10),
    };
  });
}

/** Reads the "W x H / n/m visible / k lights" viewport status strip. */
export async function readViewportStatus(page: Page): Promise<{
  width: number;
  height: number;
  visible: number;
  total: number;
  lights: number;
}> {
  return page.evaluate(() => {
    const spans = [...document.querySelectorAll(".viewport-status span")].map(
      (span) => span.textContent ?? "",
    );
    const size = /(\d+)\s*x\s*(\d+)/.exec(spans[0] ?? "");
    const visible = /(\d+)\/(\d+)/.exec(spans[1] ?? "");
    const lights = /(\d+)/.exec(spans[2] ?? "");
    return {
      width: Number(size?.[1] ?? 0),
      height: Number(size?.[2] ?? 0),
      visible: Number(visible?.[1] ?? 0),
      total: Number(visible?.[2] ?? 0),
      lights: Number(lights?.[1] ?? 0),
    };
  });
}

/**
 * Clicks the viewport and returns the object id the GPU picking pass resolved,
 * or null when the click hit empty space.
 */
export async function pickAt(
  page: Page,
  x: number,
  y: number,
): Promise<number | null> {
  await page.mouse.click(x, y);
  const selection = page.locator(".selection-section");
  // Selection is applied on the next frame, so poll briefly.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await selection.count()) {
      const text = await selection.locator(".property-grid dd").first().innerText();
      const id = Number.parseInt(text, 10);
      return Number.isNaN(id) ? null : id;
    }
    await page.waitForTimeout(50);
  }
  return null;
}

/** Collects console errors and uncaught page exceptions for the page's lifetime. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

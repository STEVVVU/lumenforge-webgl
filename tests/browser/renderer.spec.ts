import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  collectPageErrors,
  pauseLightMotion,
  pickAt,
  readDiagnostics,
  readViewportStatus,
  sampleCanvas,
  waitForSceneReady,
} from "./webglFixtures";

/**
 * Renderer verification against the production bundle in Chromium.
 *
 * These are real assertions, not screenshot collection: the canvas must contain
 * a shaded image, GL must report no errors, GPU picking must resolve the object
 * the deterministic scene puts under a known pixel, and the frame budget must
 * hold.
 *
 * Frame timings run on ANGLE SwiftShader (software rasterization), so they are
 * asserted only as generous upper bounds to catch pathological regressions.
 * They are deliberately NOT published as hardware performance figures.
 */

const ARTIFACTS = resolve(import.meta.dirname, "..", "..", "artifacts");
const FIXTURE = resolve(
  import.meta.dirname,
  "..",
  "fixtures",
  "inspection-triangle.gltf",
);

/** The deterministic default workload; these counts are asserted, not assumed. */
const EXPECTED_OBJECTS = 50;
const EXPECTED_LIGHTS = 13;

/**
 * CPU frame-time ceiling in milliseconds. This is the renderer's own CPU-side
 * `performance.now()` span for building and submitting the frame, not wall-clock
 * frame time, and it is checked on a software rasterizer. 60 ms is roughly an
 * order of magnitude above the observed value, so it fails only on a real
 * regression (e.g. culling breaking and every object being submitted twice).
 */
const CPU_FRAME_BUDGET_MS = 60;

/** Collected across tests and written once for the README's measured claims. */
const measurements: Record<string, unknown> = {};

test.describe("deterministic benchmark scene", () => {
  test("renders a shaded frame with no GL or console errors", async ({ page }, testInfo) => {
    const errors = collectPageErrors(page);
    await page.goto("/");
    await waitForSceneReady(page);
    await pauseLightMotion(page);

    const sample = await sampleCanvas(page);
    expect(sample.webgl2, "WebGL2 context must be available").toBe(true);
    // GL_NO_ERROR. A silent GL error is the classic way a broken pipeline still
    // "renders", so this is asserted explicitly rather than inferred.
    expect(sample.glError, "gl.getError() must report GL_NO_ERROR").toBe(0);

    // The canvas must be a shaded image, not a flat clear colour: most of the
    // frame is lit, and there is real tonal variation from the PBR lighting.
    expect(sample.nonBlankRatio).toBeGreaterThan(0.2);
    expect(sample.distinct).toBeGreaterThan(32);

    // Backing buffer must cover the CSS box (device-pixel-ratio aware).
    expect(sample.cssWidth).toBe(testInfo.project.use.viewport?.width);
    expect(sample.cssHeight).toBe(testInfo.project.use.viewport?.height);
    expect(sample.width).toBeGreaterThanOrEqual(sample.cssWidth);
    expect(sample.height).toBeGreaterThanOrEqual(sample.cssHeight);

    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);

    measurements.desktop = sample;
  });

  test("preserves the 50-object / 13-light deterministic workload", async ({ page }) => {
    await page.goto("/");
    await waitForSceneReady(page);
    await pauseLightMotion(page);

    // Above the 700px breakpoint both the hierarchy and inspector panels start
    // open. The narrow-viewport test asserts the complementary case.
    await expect(page.locator(".side-panel")).toHaveCount(2);

    const status = await readViewportStatus(page);
    // The workload is fixed so rendering and culling numbers stay comparable
    // across changes; drift here invalidates every published measurement.
    expect(status.total).toBe(EXPECTED_OBJECTS);
    expect(status.lights).toBe(EXPECTED_LIGHTS);
    // Frustum culling must be doing something, but not culling everything.
    expect(status.visible).toBeGreaterThan(0);
    expect(status.visible).toBeLessThanOrEqual(EXPECTED_OBJECTS);

    const diagnostics = await readDiagnostics(page);
    // One draw per visible object in the G-buffer pass, one per object in the
    // shadow pass, plus the single fullscreen deferred lighting draw.
    expect(diagnostics.drawCalls).toBe(status.visible + EXPECTED_OBJECTS + 1);
    expect(diagnostics.culled).toBe(EXPECTED_OBJECTS - status.visible);

    measurements.workload = { ...status, ...diagnostics };
  });

  test("keeps the CPU frame time within budget", async ({ page }) => {
    await page.goto("/");
    await waitForSceneReady(page);
    await pauseLightMotion(page);
    // Let the frame loop settle before sampling.
    await page.waitForTimeout(1_000);

    const samples: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const diagnostics = await readDiagnostics(page);
      if (Number.isFinite(diagnostics.cpuMs)) samples.push(diagnostics.cpuMs);
      await page.waitForTimeout(250);
    }
    expect(samples.length).toBeGreaterThan(0);
    const median = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
    expect(median).toBeGreaterThan(0);
    expect(
      median,
      `median CPU frame time ${median} ms exceeded the ${CPU_FRAME_BUDGET_MS} ms software-rasterizer budget`,
    ).toBeLessThan(CPU_FRAME_BUDGET_MS);

    measurements.frameTime = { samples, medianCpuMs: median };
  });

  test("resolves the expected object id through GPU picking", async ({ page }, testInfo) => {
    await page.goto("/");
    await waitForSceneReady(page);
    await pauseLightMotion(page);

    const viewport = testInfo.project.use.viewport!;

    // The scene is deterministic (fixed seed, fixed camera), so a given pixel
    // always covers the same object. The floor is object #1 and the grid objects
    // are #2..#50, so hitting the centre must resolve a specific grid object.
    const centre = await pickAt(page, viewport.width * 0.5, viewport.height * 0.5);
    expect(centre, "clicking the scene centre must select an object").not.toBeNull();
    expect(centre).toBeGreaterThanOrEqual(1);
    expect(centre).toBeLessThanOrEqual(EXPECTED_OBJECTS);

    // The picked id must match what the UI reports as selected, proving the
    // GPU readback and the app state agree.
    const selectedName = await page.locator(".inspector-panel h2").innerText();
    expect(selectedName.length).toBeGreaterThan(0);

    // Picking must be stable: the same pixel resolves the same id.
    const repeat = await pickAt(page, viewport.width * 0.5, viewport.height * 0.5);
    expect(repeat).toBe(centre);

    // A different pixel over the floor must resolve a different object, which
    // rules out "picking always returns the same id".
    const lowEdge = await pickAt(page, viewport.width * 0.5, viewport.height * 0.93);
    expect(lowEdge).not.toBeNull();
    expect(lowEdge).not.toBe(centre);

    measurements.picking = { centre, repeat, lowEdge };
  });

  test("exposes each deferred G-buffer through the debug views", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/");
    await waitForSceneReady(page);
    await pauseLightMotion(page);

    const buffers: Record<string, { distinct: number; glError: number }> = {};
    for (const label of ["Albedo", "Normals", "Depth", "Beauty"]) {
      const button = page.getByRole("button", { name: label, exact: true });
      await button.click();
      await expect(button).toHaveClass(/active/);
      const sample = await sampleCanvas(page);
      // Each buffer must contain real data, not a cleared target.
      expect(sample.glError, `${label} buffer raised a GL error`).toBe(0);
      expect(sample.nonBlankRatio, `${label} buffer looked blank`).toBeGreaterThan(0.1);
      buffers[label] = { distinct: sample.distinct, glError: sample.glError };
    }
    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
    measurements.debugBuffers = buffers;
  });

  test("rebuilds GPU resources after context loss", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/");
    await waitForSceneReady(page);
    await pauseLightMotion(page);

    const before = await sampleCanvas(page);

    const recovery = await page.evaluate(async () => {
      const canvas = document.querySelector("canvas");
      const gl = canvas?.getContext("webgl2");
      const extension = gl?.getExtension("WEBGL_lose_context");
      if (!extension) return "unsupported";
      extension.loseContext();
      await new Promise((done) => setTimeout(done, 150));
      extension.restoreContext();
      await new Promise((done) => setTimeout(done, 1_500));
      return gl?.isContextLost() ? "failed" : "restored";
    });
    expect(recovery).not.toBe("failed");

    if (recovery === "restored") {
      await waitForSceneReady(page);
      await page.waitForTimeout(1_000);
      const sample = await sampleCanvas(page);
      // A clean error state is the real assertion here. Deleting GL objects that
      // belonged to the destroyed context raises INVALID_OPERATION and latches
      // gl.getError(), so a non-zero value means recovery took the wrong path
      // even though the canvas looks fine.
      expect(sample.glError, "restored context must not have a latched GL error").toBe(0);
      // The scene must come back, not stay black, and it must come back with the
      // same shading complexity as before the loss - proving meshes, materials
      // and both G-buffer targets were genuinely rebuilt rather than the clear
      // colour being all that survived.
      expect(sample.nonBlankRatio).toBeGreaterThan(0.2);
      expect(sample.distinct).toBeGreaterThan(32);

      // The workload survives intact: same object and light counts, and culling
      // still running.
      const status = await readViewportStatus(page);
      expect(status.total).toBe(EXPECTED_OBJECTS);
      expect(status.lights).toBe(EXPECTED_LIGHTS);
      expect(status.visible).toBeGreaterThan(0);

      // Picking uses its own framebuffer and program, so it is the sharpest test
      // that initialize() really reran; a stale picking target returns null.
      const picked = await pickAt(page, before.cssWidth * 0.5, before.cssHeight * 0.5);
      expect(picked, "GPU picking must work again after context recovery").not.toBeNull();

      // No console error should have escaped either. The pre-fix code logged one
      // WebGL warning per orphaned handle here.
      const contextErrors = errors.filter((entry) =>
        entry.includes("does not belong to this context"),
      );
      expect(
        contextErrors,
        `GL objects from the destroyed context were deleted: ${contextErrors.join(" | ")}`,
      ).toHaveLength(0);
    }
    measurements.contextRecovery = recovery;
  });

  test("resizes the backing buffer with the viewport", async ({ page }) => {
    await page.goto("/");
    await waitForSceneReady(page);
    await pauseLightMotion(page);

    const before = await sampleCanvas(page);
    const resized = { width: 1024, height: 720 };
    await page.setViewportSize(resized);
    await page.waitForFunction(
      ({ width, height }) => {
        const canvas = document.querySelector("canvas");
        return !!canvas && (canvas.width !== width || canvas.height !== height);
      },
      { width: before.width, height: before.height },
    );

    const after = await sampleCanvas(page);
    expect(after.cssWidth).toBe(resized.width);
    expect(after.cssHeight).toBe(resized.height);
    expect(after.width).not.toBe(before.width);
    // Still rendering correctly at the new size.
    expect(after.glError).toBe(0);
    expect(after.nonBlankRatio).toBeGreaterThan(0.2);
    measurements.resize = { before, after };
  });
});

test.describe("glTF asset upload", () => {
  test("loads the fixture and reports it as glTF 2.0", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/");
    await waitForSceneReady(page);

    await page.locator('input[type="file"]').setInputFiles(FIXTURE);
    await waitForSceneReady(page);

    await expect(page.getByText("glTF 2.0", { exact: true })).toBeVisible();
    await expect(
      page.locator("header").getByText("inspection-triangle.gltf", { exact: true }),
    ).toBeVisible();

    const status = await readViewportStatus(page);
    // The fixture is a single triangle in one node.
    expect(status.total).toBe(1);

    const sample = await sampleCanvas(page);
    expect(sample.glError).toBe(0);
    // A single triangle covers less of the frame than the benchmark grid, so the
    // thresholds are lower here on purpose.
    expect(sample.nonBlankRatio).toBeGreaterThan(0.2);
    expect(sample.distinct).toBeGreaterThanOrEqual(4);

    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
    measurements.gltf = { status, sample };
  });
});

test.describe("responsive shell", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("collapses side panels on a narrow viewport", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/");
    await waitForSceneReady(page);
    await pauseLightMotion(page);

    // Below the 700px breakpoint both panels start closed so the viewport is
    // usable on a phone.
    await expect(page.locator(".side-panel")).toHaveCount(0);

    const sample = await sampleCanvas(page);
    expect(sample.webgl2).toBe(true);
    expect(sample.glError).toBe(0);
    expect(sample.nonBlankRatio).toBeGreaterThan(0.2);
    expect(sample.cssWidth).toBe(390);
    expect(sample.cssHeight).toBe(844);
    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
    measurements.mobile = sample;
  });
});

/**
 * Formats an instant as ISO 8601 retaining the machine's UTC offset, e.g.
 * `2026-07-28T23:42:34.786-07:00`.
 *
 * `Date.prototype.toISOString()` is deliberately NOT used here. It always
 * renders in UTC, so any run started in the evening west of Greenwich is stamped
 * with *tomorrow's* calendar date: a real 22:42 PDT run wrote
 * `2026-07-29T05:42:34.786Z`, which contradicted the `2026-07-28` date in
 * `artifacts/verification.md` and the README and read as a future-dated
 * measurement. Keeping the offset makes the local date recoverable while the
 * instant stays unambiguous.
 */
function toLocalIso(instant: Date): string {
  // getTimezoneOffset() returns minutes *behind* UTC, so the sign is inverted.
  const offsetMinutes = -instant.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absOffset = Math.abs(offsetMinutes);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return (
    `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}` +
    `T${pad(instant.getHours())}:${pad(instant.getMinutes())}:${pad(instant.getSeconds())}` +
    `.${pad(instant.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`
  );
}

/**
 * Writes the machine-readable record the README cites. Overwrites the existing
 * artifact rather than adding new files, so the repo does not accumulate
 * screenshots.
 */
test.afterAll(async () => {
  await mkdir(ARTIFACTS, { recursive: true });
  await writeFile(
    resolve(ARTIFACTS, "browser-verification.json"),
    `${JSON.stringify(
      {
        generatedAt: toLocalIso(new Date()),
        note:
          "Captured with @playwright/test against the production build on ANGLE " +
          "SwiftShader. Timings are software-rasterizer values and are not " +
          "hardware performance measurements.",
        ...measurements,
      },
      null,
      2,
    )}\n`,
  );
});

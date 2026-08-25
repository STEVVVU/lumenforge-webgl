import { resolve } from "node:path";
import { test } from "@playwright/test";
import {
  pauseLightMotion,
  sampleCanvas,
  waitForSceneReady,
} from "./webglFixtures";

/**
 * Regenerates the three review screenshots the README links.
 *
 * These are evidence artifacts, not golden-image assertions: correctness is
 * asserted in renderer.spec.ts. Light motion is paused first so the captures are
 * reproducible, and each file OVERWRITES its existing path so the repository
 * does not accumulate PNGs.
 */

const ARTIFACTS = resolve(import.meta.dirname, "..", "..", "artifacts");
const FIXTURE = resolve(
  import.meta.dirname,
  "..",
  "fixtures",
  "inspection-triangle.gltf",
);

test.describe("review screenshots", () => {
  test("captures the desktop benchmark view", async ({ page }) => {
    await page.goto("/");
    await waitForSceneReady(page);
    await pauseLightMotion(page);
    await sampleCanvas(page);
    await page.screenshot({
      path: resolve(ARTIFACTS, "browser-desktop.png"),
      type: "png",
    });
  });

  test("captures the mobile layout", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await waitForSceneReady(page);
    await pauseLightMotion(page);
    await sampleCanvas(page);
    await page.screenshot({
      path: resolve(ARTIFACTS, "browser-mobile.png"),
      type: "png",
    });
  });

  test("captures the uploaded glTF fixture", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });
    await page.goto("/");
    await waitForSceneReady(page);
    await page.locator('input[type="file"]').setInputFiles(FIXTURE);
    await waitForSceneReady(page);
    await pauseLightMotion(page);
    await sampleCanvas(page);
    await page.screenshot({
      path: resolve(ARTIFACTS, "browser-gltf.png"),
      type: "png",
    });
  });
});

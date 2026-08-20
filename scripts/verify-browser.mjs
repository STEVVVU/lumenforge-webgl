import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const root = resolve(import.meta.dirname, "..");
const artifacts = resolve(root, "artifacts");
const fixture = resolve(root, "tests", "fixtures", "inspection-triangle.gltf");

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.platform === "win32"
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : undefined,
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? resolve(
          process.env.LOCALAPPDATA,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : undefined,
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through known system browser locations.
    }
  }
  throw new Error(
    `Chrome was not found. Set CHROME_PATH. Checked: ${candidates.join(", ")}`,
  );
}

async function sampleCanvas(page) {
  return page.evaluate(async () => {
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2");
    if (!canvas || !gl) return { webgl2: false, nonBlankRatio: 0, distinct: 0 };

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
    const colors = new Set();
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
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
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
      renderer: gl.getParameter(gl.RENDERER),
    };
  });
}

function assertCanvas(sample, viewport, minimumDistinct = 8) {
  if (
    !sample.webgl2 ||
    sample.nonBlankRatio < 0.2 ||
    sample.distinct < minimumDistinct ||
    sample.cssWidth !== viewport.width ||
    sample.cssHeight !== viewport.height ||
    sample.width < viewport.width ||
    sample.height < viewport.height
  ) {
    throw new Error(`Canvas pixel or sizing check failed: ${JSON.stringify(sample)}`);
  }
}

await mkdir(artifacts, { recursive: true });
const chromePath = await findChrome();
const server = await createServer({
  root,
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: false,
    watch: {
      ignored: ["**/.chrome-profile/**", "**/artifacts/**"],
    },
  },
});

let browser;
try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite did not expose a local verification URL.");

  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      "--ignore-gpu-blocklist",
      "--enable-webgl",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });

  async function inspectPage({
    viewport,
    screenshotName,
    uploadFixture = false,
    verifyInteraction = false,
  }) {
    const page = await browser.newPage({ viewport });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(() => !document.querySelector(".state-overlay"));
    await page.waitForTimeout(300);

    if (uploadFixture) {
      await page.locator('input[type="file"]').setInputFiles(fixture);
      await page.waitForFunction(() => !document.querySelector(".state-overlay"));
      await page.getByText("glTF 2.0", { exact: true }).waitFor();
      await page
        .locator("header")
        .getByText("inspection-triangle.gltf", { exact: true })
        .waitFor();
      await page.waitForTimeout(200);
    }

    const pageViewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    if (
      pageViewport.width !== viewport.width ||
      pageViewport.height !== viewport.height
    ) {
      throw new Error(`Viewport mismatch: ${JSON.stringify(pageViewport)}`);
    }

    const panelCount = await page.locator(".side-panel").count();
    const expectedPanels = viewport.width <= 700 ? 0 : 2;
    if (panelCount !== expectedPanels) {
      throw new Error(`Expected ${expectedPanels} open panels, found ${panelCount}.`);
    }

    const canvas = await sampleCanvas(page);
    const minimumDistinct = uploadFixture ? 4 : 8;
    assertCanvas(canvas, viewport, minimumDistinct);

    const resizedViewport = {
      width: Math.max(320, viewport.width - 137),
      height: Math.max(480, viewport.height - 83),
    };
    await page.setViewportSize(resizedViewport);
    await page.waitForFunction(
      ({ previousWidth, previousHeight }) => {
        const element = document.querySelector("canvas");
        return (
          element &&
          (element.width !== previousWidth || element.height !== previousHeight)
        );
      },
      { previousWidth: canvas.width, previousHeight: canvas.height },
      { timeout: 5_000 },
    );
    const resizedCanvas = await sampleCanvas(page);
    assertCanvas(resizedCanvas, resizedViewport, minimumDistinct);
    if (
      resizedCanvas.width === canvas.width &&
      resizedCanvas.height === canvas.height
    ) {
      throw new Error("Canvas backing buffer did not respond to viewport resize.");
    }
    await page.setViewportSize(viewport);
    await page.waitForFunction(
      ({ resizedWidth, resizedHeight }) => {
        const element = document.querySelector("canvas");
        return (
          element &&
          (element.width !== resizedWidth || element.height !== resizedHeight)
        );
      },
      {
        resizedWidth: resizedCanvas.width,
        resizedHeight: resizedCanvas.height,
      },
      { timeout: 5_000 },
    );

    let selectionWorked = null;
    let contextRecovery = null;
    if (verifyInteraction) {
      selectionWorked = false;
      for (const point of [
        [viewport.width * 0.5, viewport.height * 0.5],
        [viewport.width * 0.58, viewport.height * 0.52],
        [viewport.width * 0.42, viewport.height * 0.55],
      ]) {
        await page.mouse.click(point[0], point[1]);
        await page.waitForTimeout(100);
        if (await page.locator(".selection-section").count()) {
          selectionWorked = true;
          break;
        }
      }

      await page.getByRole("button", { name: "Normals", exact: true }).click();
      await page.waitForTimeout(100);
      if (
        !(await page
          .getByRole("button", { name: "Normals", exact: true })
          .evaluate((button) => button.classList.contains("active")))
      ) {
        throw new Error("Normals debug buffer did not become active.");
      }
      await page.getByRole("button", { name: "Beauty", exact: true }).click();
      await page.waitForTimeout(100);

      contextRecovery = await page.evaluate(async () => {
        const canvasElement = document.querySelector("canvas");
        const gl = canvasElement?.getContext("webgl2");
        const extension = gl?.getExtension("WEBGL_lose_context");
        if (!extension) return "unsupported";
        extension.loseContext();
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
        extension.restoreContext();
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
        return gl?.isContextLost() ? "failed" : "restored";
      });
      await page.waitForFunction(() => !document.querySelector(".state-overlay"));
      await page.waitForTimeout(200);
      assertCanvas(await sampleCanvas(page), viewport);
    }

    await page.screenshot({
      path: resolve(artifacts, screenshotName),
      type: "png",
    });

    const result = {
      viewport,
      canvas,
      resizedCanvas,
      panelCount,
      source: uploadFixture ? "gltf-fixture" : "benchmark",
      selectionWorked,
      contextRecovery,
      consoleErrors,
    };
    await page.close();
    return result;
  }

  const desktop = await inspectPage({
    viewport: { width: 1440, height: 900 },
    screenshotName: "browser-desktop.png",
    verifyInteraction: true,
  });
  const mobile = await inspectPage({
    viewport: { width: 390, height: 844 },
    screenshotName: "browser-mobile.png",
  });
  const gltf = await inspectPage({
    viewport: { width: 1024, height: 720 },
    screenshotName: "browser-gltf.png",
    uploadFixture: true,
  });
  const result = {
    generatedAt: new Date().toISOString(),
    chromePath,
    desktop,
    mobile,
    gltf,
  };
  await writeFile(
    resolve(artifacts, "browser-verification.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );

  const errors = [desktop, mobile, gltf].flatMap((entry) => entry.consoleErrors);
  if (
    !desktop.selectionWorked ||
    desktop.contextRecovery === "failed" ||
    errors.length > 0
  ) {
    throw new Error(`Browser verification failed: ${JSON.stringify(result, null, 2)}`);
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await server.close();
}

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const root = resolve(import.meta.dirname, "..");
const artifacts = resolve(root, "artifacts");
const chromePath =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

await mkdir(artifacts, { recursive: true });

const server = await createServer({
  root,
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: false,
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

  async function inspectPage(viewport, screenshotName) {
    const page = await browser.newPage({ viewportSize: viewport });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(() => !document.querySelector(".state-overlay"));
    await page.waitForTimeout(500);

    const canvasCheck = await page.evaluate(async () => {
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
      const stride = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / 32));
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
      return {
        webgl2: true,
        width: canvas.width,
        height: canvas.height,
        nonBlankRatio: nonBlank / samples,
        distinct: colors.size,
        renderer: gl.getParameter(gl.RENDERER),
      };
    });

    if (!canvasCheck.webgl2 || canvasCheck.nonBlankRatio < 0.2 || canvasCheck.distinct < 8) {
      throw new Error(`Canvas pixel check failed: ${JSON.stringify(canvasCheck)}`);
    }

    let selectionWorked = false;
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

    await page.getByRole("button", { name: "Normals" }).click();
    await page.waitForTimeout(100);

    const contextRecovery = await page.evaluate(async () => {
      const canvas = document.querySelector("canvas");
      const gl = canvas?.getContext("webgl2");
      const extension = gl?.getExtension("WEBGL_lose_context");
      if (!extension) return "unsupported";
      extension.loseContext();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
      extension.restoreContext();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 900));
      return gl?.isContextLost() ? "failed" : "restored";
    });

    await page.screenshot({
      path: resolve(artifacts, screenshotName),
      type: "png",
    });

    const result = {
      viewport,
      canvas: canvasCheck,
      selectionWorked,
      contextRecovery,
      consoleErrors,
    };
    await page.close();
    return result;
  }

  const desktop = await inspectPage({ width: 1440, height: 900 }, "desktop.png");
  const mobile = await inspectPage({ width: 390, height: 844 }, "mobile.png");
  const result = { url, desktop, mobile };
  if (
    !desktop.selectionWorked ||
    desktop.contextRecovery === "failed" ||
    desktop.consoleErrors.length > 0 ||
    mobile.consoleErrors.length > 0
  ) {
    throw new Error(`Browser verification failed: ${JSON.stringify(result, null, 2)}`);
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await server.close();
}

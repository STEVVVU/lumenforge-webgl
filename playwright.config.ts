import { defineConfig, devices } from "@playwright/test";

/**
 * Browser verification for a WebGL2 application.
 *
 * Notes specific to rendering tests:
 *
 * - SwiftShader. CI and most dev machines have no usable GPU for headless
 *   Chromium, so ANGLE is forced onto its software rasterizer. That makes WebGL2
 *   available and deterministic, but it means **timings are not hardware
 *   performance numbers** and are asserted only as loose upper bounds against
 *   pathological regressions.
 * - `--enable-unsafe-swiftshader` is required because Chromium otherwise refuses
 *   to expose a software WebGL context.
 * - Retries are 0 locally: a flaky render assertion is a signal worth seeing,
 *   not something to paper over. CI keeps one retry for browser-launch flake.
 * - Workers are pinned to 1. Multiple concurrent software rasterizers contend
 *   for CPU and would make the frame-time bound meaningless.
 */
export default defineConfig({
  testDir: "tests/browser",
  outputDir: "artifacts/playwright",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    // Pinned rather than inherited from the device profile: the benchmark scene
    // is framed for this aspect ratio, and every published desktop figure
    // (canvas size, distinct-colour count, pick ids) is measured at it.
    viewport: { width: 1440, height: 900 },
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "off",
    launchOptions: {
      args: [
        "--ignore-gpu-blocklist",
        "--enable-webgl",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  // Verify the real production bundle, not the dev server, so the build output
  // is what gets exercised.
  //
  // `--host 127.0.0.1` is load-bearing on Windows: `vite preview` otherwise
  // resolves "localhost" to IPv6 and listens on `[::1]` only, so a probe of
  // `http://127.0.0.1:4173` never connects and the run dies with
  // "Timed out waiting 120000ms from config.webServer".
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});

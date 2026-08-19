# Verification Record

Recorded 2026-07-16 on Windows with Node.js 24.16.0, Chrome headless WebGL2, and
ANGLE SwiftShader. The project supports Node.js 20 or newer.

## Static and unit verification

Command: `npm run verify`

- ESLint: passed
- TypeScript project build: passed
- Vitest: 3 files, 9 tests passed
- Vite production build: passed
- JavaScript: 211.75 kB, 66.26 kB gzip
- CSS: 9.59 kB, 2.70 kB gzip

## Browser verification

Command: `npm run browser:verify`

- Desktop benchmark: 1440 x 900 canvas, 288 sampled quantized colors, picking
  succeeded, context restoration succeeded, zero console errors
- Mobile benchmark: 390 x 844 canvas, 244 sampled quantized colors, collapsed
  side panels, zero console errors
- glTF fixture: 1024 x 720 canvas, asset upload and rendering succeeded, zero
  console errors
- All views changed their CSS and backing-buffer dimensions after viewport
  resize and remained nonblank.

Exact values and renderer strings are in `browser-verification.json`.
Screenshots are `browser-desktop.png`, `browser-mobile.png`, and
`browser-gltf.png`.

## Interpretation

These results verify parser-to-renderer integration, shader execution, viewport
lifecycle, and UI layout. SwiftShader timing is not representative of physical
GPU performance, so FPS, CPU, and GPU durations are deliberately excluded from
resume claims.

# Verification Record

Recorded **2026-07-28** on Windows 11 with Node.js 24.16.0, npm 11.18.0, and
Chromium 151.0.7922.34 headless (Playwright 1.62.0) on ANGLE SwiftShader. The
project supports Node.js 20 or newer; CI runs 22.

This record supersedes the 2026-07-16 one, which was produced by the removed
`scripts/verify-browser.mjs` before the gl-matrix, React 19 and Playwright work.

## Static and unit verification

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run lint` | 0 | ESLint 10, no findings |
| `npm run typecheck` | 0 | tsc 5.9 project build (also verified with `-b --force`) |
| `npx vitest run` | 0 | 36 passed, 4 files, 0 failed, 0 skipped |
| `npx vite build` | 0 | 1818 modules transformed |
| `npm run browser:verify` | 0 | 12 passed, 3 files, 3.5 min |

Bundle: 264.17 kB JS (82.74 kB gzip), 9.59 kB CSS (2.70 kB gzip).

Previously 211.75 kB / 66.26 kB gzip. Attribution measured, not assumed:
building `main`'s source with only React moved to 19.2.8 yields 262.70 kB, so
~97% of the +52.42 kB increase is React 19 itself. `gl-matrix` contributes
roughly 1.5 kB after tree-shaking. CSS is unchanged.

Unit test count grew 9 -> 36 across three commits: gl-matrix convention and
deviation coverage (`tests/math.test.ts`, +20) and the `@gltf-transform/core`
conformance cross-check (`tests/gltfConformance.test.ts`, +7).

## Browser verification

Command: `npm run browser:verify` (`playwright test`). The suite serves the
**production bundle** via `vite preview`, not the dev server.

All 12 tests passed:

| Test | Evidence |
| --- | --- |
| Shaded frame, no GL/console errors | 1440x900, nonBlankRatio 1.00, 273 distinct colours, `glError` 0 |
| Deterministic workload preserved | 50 objects, 13 lights, 49 visible, 1 culled, 100 draw calls, 37K triangles |
| CPU frame budget | median 0.5 ms against a 60 ms software-rasterizer ceiling |
| GPU picking | centre id 18, repeat 18 (stable), low edge id 1 (distinct) |
| Deferred debug buffers | Albedo/Normals/Depth/Beauty all `glError` 0, non-blank |
| Context loss + restore | `restored`, `glError` 0, picking works again, no orphan-handle warnings |
| Backing-buffer resize | 1440x900 -> 1024x720, CSS and backing buffer both follow, `glError` 0 |
| glTF fixture upload | reported glTF 2.0, 1 object, `glError` 0 |
| Narrow viewport | 390x844, 0 open side panels, `glError` 0 |
| Review screenshots (x3) | `browser-desktop.png`, `browser-mobile.png`, `browser-gltf.png` overwritten in place |

Draw-call count is asserted as an identity rather than a bound:
`visible + 50 + 1` = 49 G-buffer draws + 50 shadow draws + 1 fullscreen deferred
lighting draw = 100.

Exact values are in `browser-verification.json`.

## Frame timings

**These are software-rasterizer figures.** SwiftShader has no GPU behind it, so
the GPU timer and wall-clock values describe this CPU. They are not hardware
performance claims.

Method: 6 independent runs per build (fresh browser and page each), 3 s warm-up,
then ~6 s of steady-state sampling with light animation running. Cells are the
median of the 6 per-run medians with the min-max envelope of those medians.

| Metric | `main` | `feat/modernize-stack` |
| --- | ---: | ---: |
| Renderer CPU frame time | 0.8 ms (0.7-1.1) | 0.4 ms (0.4-0.5) |
| GPU timer query | 396.83 ms (312.86-445.83) | 395.68 ms (345.97-539.60) |
| Wall-clock frame (rAF) | 433.3 ms (416.6-433.3) | 449.9 ms (400.0-483.3) |
| Draws / culled / triangles | 100 / 1 / 37K | 100 / 1 / 37K |

CPU frame time improved with non-overlapping envelopes. GPU and wall-clock time
did not change measurably; the envelopes overlap heavily and the identical
draw-call and triangle counts confirm the same work is being submitted. The
overlay's FPS readout is deliberately not quoted: it is a smoothed reciprocal of
frame delta and produced a 674 spike in one run when a near-zero delta hit the
filter.

## Rendering correctness across the gl-matrix migration

`gl-matrix` is column-major with pre-multiplication, and a convention mismatch
renders successfully but wrongly, so this was checked against `main` by pixel
comparison rather than by trusting the test suite.

Setup: `main` built from a separate clone; both bundles served to identical
headless Chromium instances at 1440x900 with light motion paused, which makes the
frame a pure function of scene transforms, camera and viewport.

| Comparison | Result |
| --- | --- |
| 24x24 luminance grid, beauty buffer | 576/576 cells identical, max diff 0.0000 |
| 24x24 luminance grid, albedo buffer | 576/576 cells identical, max diff 0.0000 |
| 24x24 luminance grid, normal buffer | 576/576 cells identical, max diff 0.0000 |
| 24x24 luminance grid, depth buffer | 576/576 cells identical, max diff 0.0000 |
| Per-pixel canvas diff | **0 of 699,374 pixels differ**, max channel delta 0 |
| Six fixed-pixel GPU picks | 18, 1, 6, 1, 40, 28 - identical |
| Visible / total / lights | 49 / 50 / 13 - identical |
| Orbit + dolly mean luminance | 66.4536 both, diff 0.0000 |
| Console errors | 0 both |

Mirror/flip probes, since that is the characteristic symptom of a column-major
mistake (mean absolute difference against a transformed baseline; lower is
better): as-is **0.0000**, mirror-X 14.5564, rot-180 53.5174, flip-Y 53.5941. The
as-is match is exact and no alternative is close.

Harness validated by injecting the regressions it exists to catch:

| Injected fault | Detected as |
| --- | --- |
| `quat.fromEuler` default `"zyx"` order instead of `"xyz"` | 42/576 normal cells shift, max 32.79; 9,801 pixels differ, max channel delta 213 |
| `mat4Multiply` arguments swapped (post- instead of pre-multiply) | visible objects 49 -> 2, all six picks return null, max cell diff 211 |

Both faults were reverted before the final measurement, which reproduced the
identical result.

## Defect found and fixed during this verification

`fix(engine): stop deleting GL objects of a dead context`. On
`webglcontextlost` the renderer retained its mesh/material handles and released
them later from the restore path's `uploadScene()`, by which point they belonged
to the destroyed context. Each `deleteVertexArray`/`deleteBuffer`/`deleteTexture`
raised `INVALID_OPERATION: object does not belong to this context` - exactly 20
warnings for the benchmark scene, matching its 4 shared meshes x (1 vertex array +
4 buffers) - and latched `gl.getError()` at
1282 indefinitely, so any later error check on the restored context reported a
false failure.

Pre-existing on `main`, not a regression from the gl-matrix or React 19 work. It
was invisible to the old script because that script never called `gl.getError()`.
Verified the new assertions are not vacuous by reverting the fix and reproducing
the failure.

## Interpretation and limits

These results verify parser-to-renderer integration, shader compilation and
execution, viewport lifecycle, GPU readback paths, UI layout, and that the
gl-matrix migration is pixel-for-pixel behaviour-preserving.

Not verified:

- **No hardware-GPU performance.** All timings are SwiftShader.
- **Chromium only.** Firefox and Safari untested.
- **No container image built.** No Docker tooling in this repository.
- **Single machine.** A power-managed laptop with unpinned clocks, which is why
  envelopes are reported instead of point values.

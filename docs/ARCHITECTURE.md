# LumenForge Architecture

## System boundaries

LumenForge is a browser-native asset inspection tool. React owns controls and
status presentation. The engine owns WebGL state, resource lifetimes, scene
data, frame scheduling, and input translation. The renderer has no React
dependency, which keeps rendering code testable and usable from another host.

```text
React shell
  |  load/select/options/stats
  v
Viewer lifecycle -------- Orbit camera/input
  |
  +-- glTF/GLB pipeline --> validated SceneAsset
  |
  +-- Renderer
        |-- shadow pass (depth, 2048 x 2048)
        |-- geometry pass (albedo/metallic + normal/roughness + depth)
        |-- deferred GGX lighting pass (up to 32 lights)
        |-- picking pass (24-bit object IDs)
        +-- timer queries / frame counters
```

## Asset pipeline

`src/engine/gltf.ts` parses glTF 2.0 JSON and GLB containers without evaluating
asset-provided code. It validates chunk boundaries, accessor bounds, strides,
component types, node hierarchies, and primitive topology. It supports:

- indexed and non-indexed triangle primitives;
- interleaved accessors;
- generated smooth normals when `NORMAL` is absent;
- `POSITION`, `NORMAL`, and `TEXCOORD_0`;
- node matrices or TRS hierarchy;
- metallic-roughness factors and base-color textures;
- embedded, data-URI, and URL-relative resources;
- `KHR_lights_punctual` directional and point lights.

Local `.gltf` uploads must embed resources. GLB is the portable local-upload
path. Sparse accessors, morph targets, skinning, animation, compressed geometry,
normal maps, alpha blending, and non-triangle topology fail explicitly or are
listed as warnings instead of being silently misrepresented.

## Frame pipeline

1. The camera updates its view-projection matrix.
2. Six normalized frustum planes cull object bounding spheres.
3. A directional light renders depth into the shadow map.
4. Visible objects populate two RGBA8 G-buffer targets and a depth texture.
5. The lighting pass reconstructs world position from depth and evaluates
   Cook-Torrance GGX lighting for up to 32 lights.
6. ACES-style tone mapping and gamma conversion produce the display image.
7. `EXT_disjoint_timer_query_webgl2`, when available, resolves asynchronous GPU
   frame duration without blocking the CPU.

RGBA8 G-buffer targets were chosen for broad WebGL2 compatibility. World
position reconstruction avoids a floating-point render-target requirement.

## Selection

Click selection invokes a dedicated offscreen pass. Each object is rendered as
a unique 24-bit RGB identifier and one pixel is read at the pointer location.
Picking is demand-driven, so `readPixels` does not stall normal frames.

## Resource and failure model

`Renderer` exclusively creates and deletes programs, buffers, textures,
framebuffers, queries, and vertex arrays. A scene upload uses a revision token
so a stale asynchronous texture decode cannot replace a newer scene.

The canvas handles `webglcontextlost` and `webglcontextrestored`. Loss pauses
render work, reports status to the shell, and **drops** the scene's GPU handles
without calling `delete*` on them: those objects belonged to the context that just
died, and deleting them afterwards raises `INVALID_OPERATION` and latches
`gl.getError()` so every later error check reports a false failure. The
`releaseHandles` flag on `disposeSceneResources` distinguishes this case from an
ordinary scene swap, where the handles are still live and must be deleted.
Restoration rebuilds programs, framebuffers, render targets, timer support, mesh
buffers, and material textures from retained CPU scene data.

`ResizeObserver` drives drawing-buffer allocation. Pixel ratio is capped at 2
to constrain fill cost on dense displays.

## Testing strategy

Two tiers, split by what each can actually observe.

**Node tests (Vitest, 36 across 4 files).** Matrix inversion/composition and the
documented `gl-matrix` convention deviations, conservative transformed bounds,
frustum inclusion, deterministic workload generation, glTF accessor parsing,
generated normals, unsupported topology errors, and GLB chunk parsing.
`tests/gltfConformance.test.ts` cross-checks the hand-written parser against
`@gltf-transform/core`, which is an independent implementation and therefore a
better oracle than more tests written by the same author as the parser.
`@gltf-transform/core` is a devDependency; the runtime path is still
`src/engine/gltf.ts`.

**Browser tests (`@playwright/test`, 12 across 3 files).** Shader compilation and
framebuffer contents cannot be observed without a real WebGL2 implementation, so
these run headless Chromium against the **production bundle** served by
`vite preview`. They assert a shaded frame and `GL_NO_ERROR`, the 50-object /
13-light workload with draw calls as an exact identity
(`visible + objects + 1`), the CPU frame budget, GPU picking including stability
and distinctness, all four deferred debug buffers, `WEBGL_lose_context`
restoration, backing-buffer resize, self-contained glTF upload, and narrow-viewport
panel collapse. A third spec regenerates the three review screenshots, overwriting
them in place so the repository does not accumulate binaries. Structured results
land in `artifacts/browser-verification.json`.

Deliberately **not** golden-image assertions: SwiftShader output shifts between
versions, so the specs assert structural properties (non-blank ratio, distinct
quantized colour counts, error state) and the screenshots are review evidence
rather than a pass/fail gate.

The browser path forces SwiftShader for deterministic availability. Its frame and
timer values are not treated as hardware benchmarks; only functional rendering
evidence is claimed from that environment. Where a *comparison* between two builds
is needed - as for the `gl-matrix` migration - determinism is what makes a
pixel-exact diff against a previous build meaningful, and that comparison is
recorded in `artifacts/verification.md`.

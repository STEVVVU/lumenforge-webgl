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
render work and reports status to the shell. Restoration rebuilds programs,
framebuffers, timer support, mesh buffers, and material textures from retained
CPU scene data.

`ResizeObserver` drives drawing-buffer allocation. Pixel ratio is capped at 2
to constrain fill cost on dense displays.

## Testing strategy

Node-based tests cover matrix inversion/composition, conservative transformed
bounds, frustum inclusion, deterministic workload generation, glTF accessor
parsing, generated normals, unsupported topology errors, and GLB chunk parsing.
Browser verification separately checks real shader compilation and nonblank
canvas output because those require a WebGL2 implementation.

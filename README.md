# WebGL Rendering Engine

A WebGL2 rendering engine and glTF viewer with lighting, shadows, object picking, frustum culling, and CPU/GPU frame diagnostics.

The default workload is a deterministic 50-object material grid with 13 lights.
It makes rendering and culling changes comparable without depending on a
network asset.

## Setup

Requirements: Node.js 20+ and a browser with WebGL2.

```powershell
npm install
npm run dev
```

Production verification:

```powershell
npm run verify
npm run browser:verify
```

The browser command requires Chrome (set `CHROME_PATH` for a nonstandard
installation) and writes reviewable evidence to `artifacts/`.

![LumenForge deterministic material inspection scene](artifacts/browser-desktop.png)

## Architecture

- **Asset pipeline:** bounded glTF/GLB parsing, accessor validation, hierarchy
  transforms, PBR factors, embedded textures, and punctual lights.
- **Renderer:** shadow depth pass, two-target G-buffer, depth reconstruction,
  Cook-Torrance GGX deferred lighting, and ACES-style tone mapping.
- **Performance:** bounding-sphere frustum culling, demand-driven GPU picking,
  asynchronous timer queries, draw/triangle counters, and capped pixel ratio.
- **Lifecycle:** versioned async uploads, resize observation, context-loss
  recovery, explicit resource disposal, and surfaced loading errors.
- **Application shell:** React scene hierarchy, material inspector, render
  controls, debug buffers, compatibility status, and drag/drop upload.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for pass ownership, supported
glTF features, and failure behavior.

## Controls

| Input | Action |
| --- | --- |
| Left drag | Orbit |
| Right drag or Shift + drag | Pan |
| Wheel | Dolly |
| Click | GPU object selection |
| Focus icon | Frame selected object |
| Reset icon | Restore asset camera |
| Upload icon or file drop | Load `.glb` or self-contained `.gltf` |
| Beauty / Albedo / Normals / Depth | Inspect deferred buffers |

## Rendering path

The material model follows glTF's metallic-roughness convention. Direct light
uses a GGX normal distribution, Schlick-GGX visibility, and Schlick Fresnel.
Base-color textures are uploaded as sRGB; factors and lighting remain linear
until tone mapping.

The G-buffer stores:

1. linear base color and metallic;
2. encoded world normal and perceptual roughness;
3. depth for world-position reconstruction.

A 2048 x 2048 directional map supplies 3x3 PCF shadows. The deferred pass supports 32
directional/point lights and avoids redrawing geometry per light.

## Measured evidence

The checked-in [verification record](artifacts/verification.md) and
[machine-readable browser results](artifacts/browser-verification.json) were
captured on 2026-07-16:

- ESLint and TypeScript passed; Vitest passed 9 tests across 3 files.
- Vite emitted 211.75 kB JavaScript (66.26 kB gzip) and 9.59 kB CSS
  (2.70 kB gzip).
- Chrome rendered nonblank WebGL2 canvases at 1440 x 900 desktop, 390 x 844
  mobile, and 1024 x 720 glTF-fixture viewports with zero console errors.
- Automation verified backing-buffer resize, benchmark picking, glTF upload,
  debug-buffer switching, and `WEBGL_lose_context` restoration.

Headless Chrome uses SwiftShader in this check, so its FPS and GPU timer values
are intentionally not presented as hardware performance measurements. Runtime
GPU duration appears only when `EXT_disjoint_timer_query_webgl2` is available.

## Compatibility and limitations

- WebGL2 is required; WebGL1 is intentionally unsupported.
- Local `.gltf` uploads must use embedded data URIs. GLB is recommended.
- Triangle meshes, static transforms, base-color textures, metallic-roughness
  factors, and punctual lights are supported.
- Skinning, animation, morph targets, sparse accessors, Draco/Meshopt,
  environment maps, normal/occlusion/emissive textures, transparency, and spot
  cones are not yet implemented.
- One directional light casts shadows. Point-light shadows are omitted.
- Frustum culling is per object bounding sphere; there is no occlusion culling.
- Timer-query availability and precision depend on browser/GPU policy.

## Resume bullets

- Built a WebGL2 glTF asset inspector with a two-target deferred
  metallic-roughness renderer, GGX lighting for up to 32 lights, PCF shadow
  mapping, and demand-driven GPU picking, exercised by a deterministic
  50-object/13-light workload.
- Implemented a bounded glTF/GLB pipeline with accessor validation, hierarchy
  transforms, texture decoding, generated normals, deterministic benchmark
  content, a 128 MB input ceiling, and explicit unsupported-feature diagnostics.
- Added frustum culling, asynchronous GPU timers, and context reconstruction;
  automated 9 unit tests plus WebGL checks at desktop/mobile viewports with
  verified picking, resize, glTF upload, and zero console errors.

## License

MIT

import {
  Box,
  ChevronRight,
  CircleGauge,
  Crosshair,
  FileUp,
  Focus,
  Layers3,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  RotateCcw,
  Sun,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { createBenchmarkScene } from "./engine/benchmarkScene";
import { loadGltfFromFile } from "./engine/gltf";
import type {
  FrameStats,
  MaterialData,
  SceneAsset,
  SceneObject,
} from "./engine/types";
import { Viewer } from "./viewer";
import type { RendererCapabilities } from "./engine/renderer";

const EMPTY_STATS: FrameStats = {
  fps: 0,
  cpuMs: 0,
  gpuMs: null,
  drawCalls: 0,
  triangles: 0,
  visibleObjects: 0,
  culledObjects: 0,
  lights: 0,
  width: 0,
  height: 0,
  timerSupported: false,
};

type DebugMode = 0 | 1 | 2 | 3;

function IconButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`icon-button${active ? " active" : ""}`}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(value);
}

function PerformanceOverlay({ stats }: { stats: FrameStats }) {
  return (
    <section className="performance-overlay" aria-label="Frame diagnostics">
      <div className="metric primary">
        <span>FPS</span>
        <strong>{stats.fps.toFixed(0)}</strong>
      </div>
      <div className="metric">
        <span>CPU</span>
        <strong>{stats.cpuMs.toFixed(2)} ms</strong>
      </div>
      <div className="metric">
        <span>GPU</span>
        <strong>{stats.gpuMs === null ? "N/A" : `${stats.gpuMs.toFixed(2)} ms`}</strong>
      </div>
      <div className="metric">
        <span>Draws</span>
        <strong>{stats.drawCalls}</strong>
      </div>
      <div className="metric">
        <span>Tris</span>
        <strong>{formatCount(stats.triangles)}</strong>
      </div>
      <div className="metric">
        <span>Culled</span>
        <strong>{stats.culledObjects}</strong>
      </div>
    </section>
  );
}

function HierarchyPanel({
  scene,
  selected,
  onSelect,
  onClose,
}: {
  scene: SceneAsset;
  selected: SceneObject | null;
  onSelect: (object: SceneObject) => void;
  onClose: () => void;
}) {
  return (
    <aside className="side-panel hierarchy-panel" aria-label="Scene hierarchy">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">Scene</span>
          <h2>Hierarchy</h2>
        </div>
        <IconButton label="Close hierarchy" onClick={onClose}>
          <PanelLeftClose />
        </IconButton>
      </div>
      <div className="asset-summary">
        <Box />
        <div>
          <strong>{scene.name}</strong>
          <span>{scene.objects.length} objects · {scene.meshes.length} meshes</span>
        </div>
      </div>
      <div className="object-list">
        {scene.objects.map((object) => (
          <button
            type="button"
            className={selected?.id === object.id ? "selected" : ""}
            key={object.id}
            onClick={() => onSelect(object)}
          >
            <ChevronRight />
            <span>{object.name}</span>
            <small>#{object.id}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

function MaterialInspector({ material }: { material: MaterialData }) {
  const swatch = `rgb(${material.baseColor
    .slice(0, 3)
    .map((value) => Math.round(value * 255))
    .join(" ")})`;
  return (
    <div className="inspector-section">
      <h3>Material</h3>
      <div className="material-title">
        <span className="material-swatch" style={{ background: swatch }} />
        <div>
          <strong>{material.name}</strong>
          <span>{material.baseColorTexture ? "Base color texture" : "Factor only"}</span>
        </div>
      </div>
      <dl className="property-grid">
        <dt>Metallic</dt>
        <dd>{material.metallic.toFixed(2)}</dd>
        <dt>Roughness</dt>
        <dd>{material.roughness.toFixed(2)}</dd>
        <dt>Double sided</dt>
        <dd>{material.doubleSided ? "Yes" : "No"}</dd>
      </dl>
    </div>
  );
}

function InspectorPanel({
  scene,
  selected,
  capabilities,
  exposure,
  onExposure,
  shadows,
  onShadows,
  animate,
  onAnimate,
  onFocus,
  onClose,
}: {
  scene: SceneAsset;
  selected: SceneObject | null;
  capabilities: RendererCapabilities | null;
  exposure: number;
  onExposure: (value: number) => void;
  shadows: boolean;
  onShadows: (value: boolean) => void;
  animate: boolean;
  onAnimate: (value: boolean) => void;
  onFocus: () => void;
  onClose: () => void;
}) {
  const material = selected ? scene.materials[selected.material] : null;
  return (
    <aside className="side-panel inspector-panel" aria-label="Asset inspector">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">Properties</span>
          <h2>{selected?.name ?? "Asset"}</h2>
        </div>
        <IconButton label="Close inspector" onClick={onClose}>
          <PanelRightClose />
        </IconButton>
      </div>

      {selected ? (
        <div className="inspector-section selection-section">
          <div className="section-heading">
            <h3>Selection</h3>
            <IconButton label="Focus selected object" onClick={onFocus}>
              <Focus />
            </IconButton>
          </div>
          <dl className="property-grid">
            <dt>Object ID</dt>
            <dd>{selected.id}</dd>
            <dt>Mesh</dt>
            <dd>{scene.meshes[selected.mesh]?.name ?? "Unknown"}</dd>
            <dt>Triangles</dt>
            <dd>{formatCount((scene.meshes[selected.mesh]?.indices.length ?? 0) / 3)}</dd>
          </dl>
        </div>
      ) : (
        <div className="empty-selection">
          <Crosshair />
          <strong>No selection</strong>
        </div>
      )}

      {material && <MaterialInspector material={material} />}

      <div className="inspector-section">
        <h3>Render</h3>
        <label className="slider-field">
          <span>Exposure</span>
          <output>{exposure.toFixed(2)}</output>
          <input
            type="range"
            min="0.35"
            max="2.4"
            step="0.05"
            value={exposure}
            onChange={(event) => onExposure(Number(event.target.value))}
          />
        </label>
        <label className="toggle-field">
          <span><Sun /> Shadows</span>
          <input
            type="checkbox"
            checked={shadows}
            onChange={(event) => onShadows(event.target.checked)}
          />
        </label>
        <label className="toggle-field">
          <span><Lightbulb /> Light motion</span>
          <input
            type="checkbox"
            checked={animate}
            onChange={(event) => onAnimate(event.target.checked)}
          />
        </label>
      </div>

      <div className="inspector-section compatibility">
        <h3>Compatibility</h3>
        <dl className="property-grid">
          <dt>API</dt>
          <dd>WebGL 2</dd>
          <dt>GPU timer</dt>
          <dd>{capabilities?.timerQuery ? "Supported" : "Unavailable"}</dd>
          <dt>Texture limit</dt>
          <dd>{capabilities ? `${capabilities.maxTextureSize}px` : "..."}</dd>
        </dl>
        <p title={capabilities?.renderer}>{capabilities?.renderer ?? "Detecting renderer"}</p>
      </div>
    </aside>
  );
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [scene, setScene] = useState<SceneAsset>(() => createBenchmarkScene());
  const [selected, setSelected] = useState<SceneObject | null>(null);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [capabilities, setCapabilities] = useState<RendererCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contextMessage, setContextMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hierarchyOpen, setHierarchyOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [exposure, setExposure] = useState(1);
  const [shadows, setShadows] = useState(true);
  const [animate, setAnimate] = useState(true);
  const [debugMode, setDebugMode] = useState<DebugMode>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    try {
      const viewer = new Viewer(canvas, {
        onStats: setStats,
        onSelection: setSelected,
        onContextState: (lost, message) => {
          setContextMessage(message);
          if (!lost) window.setTimeout(() => setContextMessage(null), 1800);
        },
      });
      viewerRef.current = viewer;
      setCapabilities(viewer.capabilities);
      void viewer.setScene(scene).then(() => {
        if (!disposed) setLoading(false);
      }).catch((reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : "Renderer setup failed.");
      });
    } catch (reason) {
      setLoading(false);
      setError(reason instanceof Error ? reason.message : "WebGL initialization failed.");
    }
    return () => {
      disposed = true;
      viewerRef.current?.dispose();
      viewerRef.current = null;
    };
    // The initial scene is intentionally loaded once with the viewer lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewerRef.current?.setOptions({ exposure, shadows, animateLights: animate, debugMode });
    viewerRef.current?.setPaused(!animate);
  }, [exposure, shadows, animate, debugMode]);

  const loadFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const asset = await loadGltfFromFile(file);
      await viewerRef.current?.setScene(asset);
      setScene(asset);
      setSelected(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Asset loading failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void loadFile(file);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  };

  const loadBenchmark = async () => {
    const benchmark = createBenchmarkScene();
    setLoading(true);
    setError(null);
    try {
      await viewerRef.current?.setScene(benchmark);
      setScene(benchmark);
      setSelected(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Benchmark scene failed to load.");
    } finally {
      setLoading(false);
    }
  };

  const selectObject = (object: SceneObject) => {
    viewerRef.current?.select(object);
  };

  return (
    <main
      className="app-shell"
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <canvas ref={canvasRef} className="render-canvas" aria-label="3D asset viewport" />

      <header className="top-bar">
        <div className="product-mark">
          <div className="product-icon"><Box /></div>
          <div>
            <strong>LumenForge</strong>
            <span>Asset Inspector</span>
          </div>
        </div>
        <div className="asset-identity">
          <span className={`source-dot ${scene.source}`} />
          <strong>{scene.name}</strong>
          <span>{scene.source === "gltf" ? "glTF 2.0" : "Benchmark"}</span>
        </div>
        <nav className="top-actions" aria-label="Viewport actions">
          {!hierarchyOpen && (
            <IconButton label="Open hierarchy" onClick={() => setHierarchyOpen(true)}>
              <PanelLeftOpen />
            </IconButton>
          )}
          <IconButton label="Open glTF or GLB" onClick={() => fileInputRef.current?.click()}>
            <FileUp />
          </IconButton>
          <IconButton label="Load benchmark scene" onClick={() => void loadBenchmark()}>
            <Layers3 />
          </IconButton>
          <IconButton label="Reset camera" onClick={() => viewerRef.current?.resetCamera()}>
            <RotateCcw />
          </IconButton>
          <IconButton
            label={animate ? "Pause light motion" : "Resume light motion"}
            active={animate}
            onClick={() => setAnimate((value) => !value)}
          >
            {animate ? <Pause /> : <Play />}
          </IconButton>
          {!inspectorOpen && (
            <IconButton label="Open inspector" onClick={() => setInspectorOpen(true)}>
              <PanelRightOpen />
            </IconButton>
          )}
        </nav>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept=".gltf,.glb,model/gltf+json,model/gltf-binary"
          onChange={onFileChange}
        />
      </header>

      {hierarchyOpen && (
        <HierarchyPanel
          scene={scene}
          selected={selected}
          onSelect={selectObject}
          onClose={() => setHierarchyOpen(false)}
        />
      )}

      {inspectorOpen && (
        <InspectorPanel
          scene={scene}
          selected={selected}
          capabilities={capabilities}
          exposure={exposure}
          onExposure={setExposure}
          shadows={shadows}
          onShadows={setShadows}
          animate={animate}
          onAnimate={setAnimate}
          onFocus={() => selected && viewerRef.current?.focus(selected.worldBounds)}
          onClose={() => setInspectorOpen(false)}
        />
      )}

      <PerformanceOverlay stats={stats} />

      <div className="debug-segment" role="group" aria-label="Viewport buffer">
        {([
          [0, "Beauty"],
          [1, "Albedo"],
          [2, "Normals"],
          [3, "Depth"],
        ] as const).map(([mode, label]) => (
          <button
            type="button"
            className={debugMode === mode ? "active" : ""}
            key={mode}
            onClick={() => setDebugMode(mode)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="viewport-status">
        <CircleGauge />
        <span>{stats.width} × {stats.height}</span>
        <span>{stats.visibleObjects}/{stats.visibleObjects + stats.culledObjects} visible</span>
        <span>{stats.lights} lights</span>
      </div>

      {scene.warnings.length > 0 && (
        <div className="warning-indicator" title={scene.warnings.join("\n")}>
          <TriangleAlert />
          <span>{scene.warnings.length}</span>
        </div>
      )}

      {loading && (
        <div className="state-overlay">
          <div className="loading-spinner" />
          <strong>Loading asset</strong>
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          <TriangleAlert />
          <span>{error}</span>
          <IconButton label="Dismiss error" onClick={() => setError(null)}>
            <X />
          </IconButton>
        </div>
      )}

      {contextMessage && (
        <div className="context-banner" role="status">{contextMessage}</div>
      )}

      {dragging && (
        <div className="drop-overlay">
          <FileUp />
          <strong>Drop glTF or GLB</strong>
        </div>
      )}
    </main>
  );
}

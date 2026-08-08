interface DisjointTimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export class GpuTimer {
  private readonly gl: WebGL2RenderingContext;
  private readonly extension: DisjointTimerExtension | null;
  private active: WebGLQuery | null = null;
  private pending: WebGLQuery[] = [];
  private latestMilliseconds: number | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.extension = gl.getExtension(
      "EXT_disjoint_timer_query_webgl2",
    ) as DisjointTimerExtension | null;
  }

  get supported(): boolean {
    return this.extension !== null;
  }

  begin(): void {
    this.poll();
    if (!this.extension || this.active || this.pending.length >= 4) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.active = query;
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
  }

  end(): void {
    if (!this.extension || !this.active) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  result(): number | null {
    this.poll();
    return this.latestMilliseconds;
  }

  private poll(): void {
    if (!this.extension || this.pending.length === 0) return;
    const query = this.pending[0]!;
    const available = Boolean(
      this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE),
    );
    const disjoint = Boolean(
      this.gl.getParameter(this.extension.GPU_DISJOINT_EXT),
    );
    if (!available) return;
    this.pending.shift();
    if (!disjoint) {
      const nanoseconds = Number(
        this.gl.getQueryParameter(query, this.gl.QUERY_RESULT),
      );
      this.latestMilliseconds = nanoseconds / 1_000_000;
    }
    this.gl.deleteQuery(query);
  }

  dispose(): void {
    if (this.active) this.gl.deleteQuery(this.active);
    this.pending.forEach((query) => this.gl.deleteQuery(query));
    this.active = null;
    this.pending = [];
  }
}

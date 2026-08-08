import { describe, expect, it } from "vitest";
import { createBenchmarkScene } from "../src/engine/benchmarkScene";

describe("benchmark scene", () => {
  it("is deterministic for a fixed seed", () => {
    const first = createBenchmarkScene(123);
    const second = createBenchmarkScene(123);
    expect(first.objects).toHaveLength(50);
    expect(first.lights).toHaveLength(13);
    expect(
      Array.from(first.objects[20]!.modelMatrix),
    ).toEqual(Array.from(second.objects[20]!.modelMatrix));
    expect(first.bounds).toEqual(second.bounds);
  });

  it("changes placement for a different seed without changing workload size", () => {
    const first = createBenchmarkScene(123);
    const second = createBenchmarkScene(456);
    expect(first.objects).toHaveLength(second.objects.length);
    expect(Array.from(first.objects[2]!.modelMatrix)).not.toEqual(
      Array.from(second.objects[2]!.modelMatrix),
    );
  });
});

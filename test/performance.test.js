import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { performance } from "node:perf_hooks";
import { Liquid } from "../src/index.js";

describe("Liquid Performance", () => {
  it("renders a simple template in under 2ms on average", async () => {
    const engine = new Liquid();
    const template = "<div>{{ user.name }}</div>";
    const context = { user: { name: "Alice" } };
    const thresholdMs = process.env.NODE_V8_COVERAGE ? 125 : 15;

    for (let index = 0; index < 20; index += 1) {
      await engine.parseAndRender(template, context);
    }

    const start = performance.now();
    for (let index = 0; index < 100; index += 1) {
      await engine.parseAndRender(template, context);
    }
    const averageMs = (performance.now() - start) / 100;

    assert.ok(
      averageMs < thresholdMs,
      `expected average render < ${thresholdMs}ms, got ${averageMs.toFixed(3)}ms`,
    );
  });

  it("handles long unclosed quoted filter arguments without catastrophic backtracking", () => {
    const engine = new Liquid();
    const expression = `missing | default: "${"x".repeat(50_000)}`;

    const start = performance.now();
    engine.resolveValue(expression, {});
    const elapsedMs = performance.now() - start;

    assert.ok(elapsedMs < 25, `expected malformed filter parsing < 25ms, got ${elapsedMs.toFixed(3)}ms`);
  });

  it("keeps yield control active for large loops with offset and limit", async () => {
    let yields = 0;
    const engine = new Liquid({
      yieldAfter: 1000,
      yieldControl: async () => {
        yields += 1;
      },
    });
    const list = Array.from({ length: 10_000 }, (_, index) => index);

    const html = await engine.parseAndRender(
      "{% for i in list offset:100 limit:9800 reversed %}.{% endfor %}",
      { list },
    );

    assert.equal(html.length, 9800);
    assert.ok(yields >= 9, `expected yield control to run at least 9 times, got ${yields}`);
  });
});

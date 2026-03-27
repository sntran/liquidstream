import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Liquid } from "../lib/mod.js";

function createMockFetch(entries) {
  return async (input) => {
    const key = input instanceof Request
      ? new URL(input.url).pathname.replace(/^\//, "")
      : String(input);
    const value = entries[key];

    if (!value) {
      return new Response("", { status: 404 });
    }

    if (value instanceof Response) {
      return value;
    }

    return new Response(value.body ?? value, { status: value.status ?? 200 });
  };
}

describe("Liquid Partials", () => {
  it("renders partials with isolated scope via render", async () => {
    const engine = new Liquid({
      fetch: createMockFetch({
        card: "{{ label }}|{{ secret }}",
      }),
    });

    const html = await engine.parseAndRender(
      '{% assign secret = "hidden" %}{% render "card", label: "Hello" %}',
      {},
    );

    assert.equal(html, "Hello|");
  });

  it("renders partials with shared scope via include", async () => {
    const engine = new Liquid({
      fetch: createMockFetch({
        card: "{{ greeting }} {{ name }}",
      }),
    });

    const html = await engine.parseAndRender(
      '{% assign greeting = "Hello" %}{% include "card" %}',
      { name: "Alice" },
    );

    assert.equal(html, "Hello Alice");
  });

  it("supports dynamic partial names and passed arguments", async () => {
    const engine = new Liquid({
      fetch: createMockFetch({
        greeting: "{{ label }}",
      }),
    });

    const html = await engine.parseAndRender(
      '{% assign partial = "greeting" %}{% render partial, label: user.name %}',
      { user: { name: "Alice" } },
    );

    assert.equal(html, "Alice");
  });

  it("returns an empty string when a fetched partial response is not ok", async () => {
    const engine = new Liquid({
      fetch: createMockFetch({
        missing: { body: "nope", status: 404 },
      }),
    });

    const html = await engine.parseAndRender('{% include "missing" %}', {});

    assert.equal(html, "");
  });

  it("ignores malformed partial arguments", async () => {
    const engine = new Liquid({
      fetch: createMockFetch({
        card: "{{ label }}",
      }),
    });

    const html = await engine.parseAndRender(
      '{% render "card", broken, label: "Hello" %}',
      {},
    );

    assert.equal(html, "Hello");
  });

  it("stops recursive partial rendering at the maximum render depth", async () => {
    const engine = new Liquid({
      fetch: createMockFetch({
        self: '{% render "self" %}',
      }),
    });

    await assert.rejects(
      () => engine.parseAndRender('{% render "self" %}', {}),
      /Max render depth exceeded/,
    );
  });

  it("returns an empty string for a render tag with no snippet expression", async () => {
    const engine = new Liquid({
      fetch: createMockFetch({}),
    });

    const html = await engine.evaluator.renderPartial("", {
      currentContext: {},
      runtime: { counters: Object.create(null) },
      renderDepth: 0,
    }, "render");

    assert.equal(html, "");
  });
});

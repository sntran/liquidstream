import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Liquid } from "../src/index.js";
import jekyll from "../src/plugins/jekyll.js";

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

describe("Jekyll Filters", () => {
  it("filters arrays with where_exp using the current render context", async () => {
    const engine = new Liquid().plugin(jekyll);

    const html = await engine.parseAndRender(
      '{{ posts | where_exp: "post", "post.published and post.category == page.category" | size }}',
      {
        page: { category: "guides" },
        posts: [
          { title: "A", category: "guides", published: true },
          { title: "B", category: "guides", published: false },
          { title: "C", category: "news", published: true },
          { title: "D", category: "guides", published: true },
        ],
      },
    );

    assert.equal(html, "2");
  });

  it("prepends site.url in absolute_url", async () => {
    const engine = new Liquid().plugin(jekyll);

    const html = await engine.parseAndRender(
      '{{ "/docs/getting-started/" | absolute_url }}',
      {
        site: {
          url: "https://example.com",
          baseurl: "/blog",
        },
      },
    );

    assert.equal(html, "https://example.com/blog/docs/getting-started/");
  });

  it("supports include_relative using page.path from the render context", async () => {
    const engine = new Liquid({
      fetch: createMockFetch({
        "docs/local.html": "Local include",
      }),
    }).plugin(jekyll);

    const html = await engine.parseAndRender(
      "{% include_relative local.html %}",
      {
        page: { path: "docs/readme.md" },
      },
    );

    assert.equal(html, "Local include");
  });

  it("supports quoted include_relative paths", async () => {
    const engine = new Liquid({
      fetch: createMockFetch({
        "docs/local.html": "Local include",
      }),
    }).plugin(jekyll);

    const html = await engine.parseAndRender(
      '{% include_relative "local.html" %}',
      {
        page: { path: "docs/readme.md" },
      },
    );

    assert.equal(html, "Local include");
  });

  it("supports include_relative with an unquoted relative path", async () => {
    const engine = new Liquid({
      fetch: createMockFetch({
        "docs/local.html": "Local include",
      }),
    }).plugin(jekyll);

    const html = await engine.parseAndRender(
      "{% include_relative local.html %}",
      {
        page: { path: "docs/readme.md" },
      },
    );

    assert.equal(html, "Local include");
  });

  it("updates page.path across nested include_relative renders", async () => {
    const engine = new Liquid({
      fetch: createMockFetch({
        "docs/guide/section.html": "A>{{ page.path }}>{% include_relative parts/item.html %}",
        "docs/guide/parts/item.html": "B>{{ page.path }}>{% include_relative shared/final.html %}",
        "docs/guide/parts/shared/final.html": "C>{{ page.path }}",
      }),
    }).plugin(jekyll);

    const html = await engine.parseAndRender(
      "{% include_relative section.html %}",
      {
        page: { path: "docs/guide/index.md" },
      },
    );

    assert.equal(
      html,
      "A>docs/guide/section.html>B>docs/guide/parts/item.html>C>docs/guide/parts/shared/final.html",
    );
  });

  it("returns an empty string for include_relative parent traversal", async () => {
    const engine = new Liquid({
      fetch: createMockFetch({
        "docs/shared/final.html": "Should not render",
      }),
    }).plugin(jekyll);

    const html = await engine.parseAndRender(
      "{% include_relative ../shared/final.html %}",
      {
        page: { path: "docs/readme.md" },
      },
    );

    assert.equal(html, "");
  });

  it("rejects quoted include_relative parent traversal", async () => {
    const engine = new Liquid({
      fetch: createMockFetch({
        "docs/shared/final.html": "Should not render",
      }),
    }).plugin(jekyll);

    const html = await engine.parseAndRender(
      '{% include_relative "../shared/final.html" %}',
      {
        page: { path: "docs/readme.md" },
      },
    );

    assert.equal(html, "");
  });
});

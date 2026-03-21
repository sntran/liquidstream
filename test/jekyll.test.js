import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Liquid } from "../src/index.js";
import jekyllFilters from "../src/plugins/jekyll.js";

describe("Jekyll Filters", () => {
  it("filters arrays with where_exp using the current render context", async () => {
    const engine = new Liquid({
      filters: jekyllFilters,
    });

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
    const engine = new Liquid({
      filters: jekyllFilters,
    });

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
});

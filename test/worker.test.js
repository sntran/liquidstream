import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import worker, { buildReadmePage } from "../_worker.js";

function createAssets(entries) {
  return {
    async fetch(input) {
      const pathname = input instanceof Request
        ? new URL(input.url).pathname
        : new URL(String(input), "https://example.test").pathname;

      const value = entries[pathname];
      if (!value) {
        return new Response("missing", { status: 404 });
      }

      return new Response(value, { status: 200 });
    },
  };
}

describe("README worker page", () => {
  it("builds heading ids and splits README sections at h2 boundaries", () => {
    const page = buildReadmePage(`# Title

Lead copy.

## First Section

Body one.

## Second Section

Body two.`);

    assert.equal(page.title, "Title");
    assert.equal(page.description, "Lead copy.");
    assert.deepEqual(page.toc, [
      { id: "first-section", title: "First Section" },
      { id: "second-section", title: "Second Section" },
    ]);
    assert.match(page.content, /<h2 id="first-section">First Section<\/h2>/);
    assert.match(page.content, /<h2 id="second-section">Second Section<\/h2>/);
  });

  it("renders the README through the shared layout", async () => {
    const env = {
      ASSETS: createAssets({
        "/README.md": `# Title

Lead copy.

## Install

Use npm.`,
        "/_layouts/index.html": `<!doctype html>
<html lang="en">
  <body>
    <style>{% include "index.css" %}</style>
    <header>{% include "header.html" %}</header>
    <main>{{ content | raw }}</main>
    <nav>{% include "nav.html" %}</nav>
    <footer>{% include "footer.html" %}</footer>
  </body>
</html>`,
        "/_includes/index.css": "body { color: white; }",
        "/_includes/header.html": "<h1>Header include</h1>",
        "/_includes/nav.html": "<a href=\"#install\">Install</a>",
        "/_includes/footer.html": `
          {% if perf.render_ms %}<span>timed</span>{% endif %}
          <span>{{ perf.benchmark_label }}</span>
        `,
      }),
    };

    const response = await worker.fetch(new Request("https://example.test/"), env);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /body \{ color: white; \}/);
    assert.match(html, /<header><h1>Header include<\/h1><\/header>/);
    assert.match(html, /<main><h1>Title<\/h1>/);
    assert.match(html, /<h2 id="install">Install<\/h2>/);
    assert.match(html, /<nav><a href="#install">Install<\/a><\/nav>/);
    assert.match(html, /timed/);
    assert.match(html, /Median TTFB 2.033 ms/);
  });

  it("passes non-root requests through to assets", async () => {
    const env = {
      ASSETS: createAssets({
        "/assets/app.css": "body{}",
      }),
    };

    const response = await worker.fetch(new Request("https://example.test/assets/app.css"), env);

    assert.equal(await response.text(), "body{}");
  });
});

# `liquidstream`

Streaming-first Liquid for Cloudflare Workers, edge runtimes, and Node.js.

`liquidstream` keeps the familiar `new Liquid()` API, but the engine is built around `HTMLRewriter` instead of a full AST compiler. It is designed for projects that want Liquid templates, early HTML streaming, and a runtime model that still feels comfortable in Worker-style environments.

It is especially well suited to:

- documentation sites and marketing pages that are mostly HTML with targeted Liquid expressions
- edge-rendered pages where `eval()`-heavy template engines are a poor fit
- projects that want custom filters and tags without bringing in a large compiler pipeline
- Markdown-to-HTML publishing flows where the final page still needs Liquid-aware layout composition

## Getting started

### Installation

```bash
npm install @sntran/liquidstream
```

### Quick start

{% raw %}
```js
import { Liquid } from "@sntran/liquidstream";

const engine = new Liquid();

const html = await engine.parseAndRender(
  `
    <article>
      <h1>{{ page.title }}</h1>
      <p>{{ page.summary | capitalize }}</p>
    </article>
  `,
  {
    page: {
      title: "Streaming Liquid",
      summary: "fast on the edge",
    },
  },
);
```
{% endraw %}

The return value is the rendered HTML string. In Worker-style environments, the engine still processes templates through `HTMLRewriter`, so the runtime characteristics remain close to the platform instead of emulating a browser or building a large intermediate AST.

### Product snapshot

- streaming bridge powered by `HTMLRewriter`
- focused Liquid subset for docs, landing pages, and content-heavy templates
- instance-local custom filters and custom tags
- partials loaded through `fetch` for `render` and `include`
- plugin-friendly design with optional Jekyll-style helpers
- this repository doubles as a no-build documentation site

### Why it exists

Most Liquid engines optimize for broad compatibility and full-string rendering. `liquidstream` focuses on a different shape of problem:

- stream HTML as early as possible
- avoid `eval()` and `new Function()` in isolate runtimes
- stay small enough to inspect and maintain
- keep the API practical for content sites and edge rendering

If your templates are HTML-first and your runtime is closer to Cloudflare Workers than a full server process, that tradeoff is often the right one.

### Runtime model

`liquidstream` is not trying to be a drop-in implementation of every Shopify or Jekyll behavior. The goal is a compact engine with predictable behavior in modern runtimes.

In practice, that means:

- HTML is treated as the primary document format
- Liquid expressions are resolved while the markup flows through the rewriter
- custom filters and tags are registered per engine instance
- partials are loaded through `fetch`, which maps naturally to Workers and web runtimes
- cooperative yielding is available for large renders instead of blocking long loops

If you need the broadest possible Liquid compatibility across every legacy construct, another engine may be a better fit. If you want a pragmatic subset that behaves naturally in isolate runtimes, `liquidstream` is designed for that job.

## Examples

{% raw %}
```js
import { Liquid } from "@sntran/liquidstream";

const engine = new Liquid();

await engine.parseAndRender(
  '<p>{{ "  edge template " | strip | upcase }}</p>',
  {},
);
```
{% endraw %}

{% raw %}
```js
import { Liquid } from "@sntran/liquidstream";

const engine = new Liquid();

await engine.parseAndRender(
  '{% for tag in post.tags limit:2 %}<li>{{ tag | capitalize }}</li>{% endfor %}',
  {
    post: {
      tags: ["streaming", "workers", "liquid"],
    },
  },
);
```
{% endraw %}

{% raw %}
```js
import { Liquid } from "@sntran/liquidstream";
import jekyllFilters from "@sntran/liquidstream/jekyll";

const engine = new Liquid({
  filters: jekyllFilters,
});

const html = await engine.parseAndRender(
  `
    {% assign docs = posts | where_exp: "post", "post.kind == 'guide'" %}
    {% assign featured = docs | map: "title" | slice: 0, 3 %}
    <section>
      <h2>{{ docs | size }} guides ready</h2>
      <p>{{ featured | join: ", " }}</p>
    </section>
  `,
  {
    posts: [
      { kind: "guide", title: "Install" },
      { kind: "guide", title: "Filters" },
      { kind: "reference", title: "Changelog" },
      { kind: "guide", title: "Deploy" },
    ],
  },
);
```
{% endraw %}

{% raw %}
```js
import { Liquid } from "@sntran/liquidstream";

const engine = new Liquid();

const html = await engine.parseAndRender(
  `
    {% capture summary %}
      {{ product.name | capitalize }} ships in {{ product.regions | join: ", " }}.
    {% endcapture %}
    {% if product.inventory > 0 and product.featured %}
      <aside>{{ summary | strip }}</aside>
    {% else %}
      <aside>Check back soon.</aside>
    {% endif %}
  `,
  {
    product: {
      name: "liquidstream",
      featured: true,
      inventory: 8,
      regions: ["us", "eu"],
    },
  },
);
```
{% endraw %}

{% raw %}
```js
import { Liquid } from "@sntran/liquidstream";

const templates = new Map([
  ["/_includes/card.html", "<article><h3>{{ title }}</h3><p>{{ body }}</p></article>"],
]);

const engine = new Liquid({
  fetch: async (input) => {
    const pathname = new URL(String(input), "https://example.test").pathname;
    const template = templates.get(pathname);
    return new Response(template ?? "", { status: template ? 200 : 404 });
  },
});

const html = await engine.parseAndRender(
  '{% include "card.html", title: page.title, body: page.summary %}',
  {
    page: {
      title: "Partial rendering",
      summary: "Render and include can resolve templates through fetch.",
    },
  },
);
```
{% endraw %}

### This documentation site

This repository is also the largest working example of `liquidstream` in this codebase:

- GitHub Pages applies the shared Liquid layout through Jekyll config
- Cloudflare Pages converts this README from Markdown to HTML with `marked`
- the layout itself exercises a wide range of supported Liquid filters and tags
- the final page stays small, inlined, and JavaScript-free

That makes the repository useful both as package documentation and as a practical end-to-end reference.

## Tags

`liquidstream` intentionally implements a focused but practical Liquid subset.

<details open>
<summary>Control flow</summary>

- `if`
- `unless`
- `else`
- `endif`
- `case`
- `when`
- `endcase`
- `for`
- `endfor`
- `limit`
- `offset`
- `reversed`

</details>

<details>
<summary>Variables and output</summary>

- variable interpolation such as `{{ user.name }}`
- whitespace control such as `{{- value -}}`
- `assign`
- `capture`
- `raw`
- `increment`
- `decrement`

</details>

<details>
<summary>Files and composition</summary>

- `render`
- `include`

</details>

<details>
<summary>Extensibility</summary>

- custom filters
- custom tags

</details>

## Operators

Expressions support the operators and literal forms you need for real templates:

- range expressions like `(1..5)`
- array and object literals
- boolean logic with `and` and `or`
- comparisons with `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`
- Liquid truthiness where only `false`, `null`, and `undefined` are falsey

This keeps conditional templates expressive without needing separate helper syntax for everyday checks.

## Filters

The built-in filters are grouped below. The first category stays open by default, and the rest can be expanded as needed.

<details open>
<summary>String and array filters</summary>

- `append`
- `capitalize`
- `downcase`
- `first`
- `includes`
- `join`
- `last`
- `map`
- `replace`
- `size`
- `slice`
- `split`
- `starts_with`
- `strip`
- `trim_end`
- `trim_start`
- `upcase`

</details>

<details>
<summary>Math filters</summary>

- `abs`
- `at_least`
- `at_most`
- `ceil`
- `divided_by`
- `floor`
- `minus`
- `round`
- `sign`
- `sqrt`
- `trunc`

</details>

<details>
<summary>HTML and output filters</summary>

- `default`
- `newline_to_br`
- `raw`
- `strip_html`

</details>

<details>
<summary>URL and encoding filters</summary>

- `base64_encode`
- `relative_url`
- `url_decode`
- `url_encode`

</details>

<details>
<summary>Time and sorting filters</summary>

- `date`
- `sort`

</details>

### How to define a new filter

Custom filters receive a small engine-aware `this` binding:

- `this.context`: current render scope
- `this.evaluate(expression, scope?)`: evaluate a Liquid condition
- `this.resolveExpression(expression, scope?, options?)`: resolve a Liquid expression

That makes context-aware filters possible without reimplementing the parser.

{% raw %}
```js
const engine = new Liquid();

engine.registerFilter("only_matching", function (items, variableName, expression) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.filter((item) => this.evaluate(expression, { [variableName]: item }));
});
```
{% endraw %}

Custom filters can return plain values or HTML-safe output wrappers. In most cases, returning a normal string or array is exactly what you want.

## Plugins

`liquidstream` keeps optional functionality in plugins instead of forcing everything into the core package.

### Jekyll plugin

The optional Jekyll plugin lives at `@sntran/liquidstream/jekyll`.

It includes:

- `absolute_url`
- `group_by`
- `group_by_exp`
- `include_relative`
- `jsonify`
- `relative_url`
- `slugify`
- `where`
- `where_exp`

{% raw %}
```js
import { Liquid } from "@sntran/liquidstream";
import jekyll from "@sntran/liquidstream/jekyll";

const engine = new Liquid().plugin(jekyll);

// The path is passed via context, keeping the engine API clean
const html = await engine.parseAndRender(input, {
  page: { path: "docs/readme.md" },
});
```
{% endraw %}

More plugins coming, or contribute your own in the [Contributing](#contributing) section.

## API

### `new Liquid(options?)`

Creates a renderer instance.

Supported options:

- `HTMLRewriterClass`: custom `HTMLRewriter` implementation
- `autoEscape`: defaults to `true`
- `fetch`: fetch implementation used by `render` and `include`
- `filters`: instance-local filter overrides and extensions
- `tags`: instance-local custom tags
- `yieldAfter`: iteration threshold for cooperative yielding
- `yieldControl`: custom async yield hook

The constructor is intentionally small. Most customization happens by passing instance-local filters, tags, and fetch behavior instead of relying on globals.

### `parseAndRender(html, context)`

Renders a template string with the provided context.

Use this for the normal “template plus data in, HTML out” flow. The template should be HTML-first markup, not arbitrary text, because the engine relies on `HTMLRewriter` semantics while processing.

### `registerFilter(name, filter)`

Adds or overrides an instance-local filter.

### `registerTag(name, handler)`

Adds or overrides an instance-local custom tag.

Custom tags are useful when filter chains stop being expressive enough and you want a named unit of rendering behavior.

### `plugin(pluginFn)`

Runs a Liquid-style plugin against the current engine instance and returns the same instance for chaining.

### `createHandler(context)`

Returns the low-level `HTMLRewriter` handlers used internally for `element` and `text` processing.

Most users will never need this directly, but it is useful for testing, inspection, and lower-level integration work.

## Rendering behavior

There are a few practical rules worth knowing when you build with `liquidstream`:

- auto-escaping is enabled by default for variable output
- the `raw` filter and raw tag let you opt into literal HTML output when you mean it
- `render` and `include` rely on `fetch`, so relative template loading is part of the engine contract
- the engine is happiest with HTML documents and HTML fragments rather than plain-text templates
- custom filters and tags are isolated to the engine instance that registered them

Those constraints are deliberate. They keep the engine easier to reason about in environments where streaming and runtime safety matter.

## Benchmarks

Current benchmark snapshot from this repository:

- gzipped engine size: `7931 B`
- first byte, static-prefix template, median: `2.033 ms`
- first byte, filter-dependent template, median: `0.216 ms`
- heavy 1 MB render: `29.485 ms`

These numbers come from [`scripts/benchmark-liquid.mjs`](./scripts/benchmark-liquid.mjs) and are better read as directional guidance than a universal speed claim. `liquidstream` is strongest when streaming behavior and edge compatibility matter more than raw string-at-once throughput.

## Contributing

Issues, bug reports, test cases, and focused patches are all welcome. The project is still intentionally small, so code clarity and runtime behavior matter at least as much as feature count.

Contributions are especially helpful in these areas:

- compatibility bugs in supported Liquid syntax
- small, well-tested filter or tag additions
- performance improvements that preserve the streaming model
- documentation improvements with concrete examples

If you propose a new feature, it helps to explain how it fits the project’s core goals: HTML-first rendering, edge-friendly runtime behavior, and a compact implementation that stays understandable.

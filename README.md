# `liquidstream`

Streaming-first Liquid for Cloudflare Workers, edge runtimes, and Node.js.

`liquidstream` is now natively powered by `Response` objects. The primary engine is `transform(input: Response): Response`, which keeps HTML flowing through `HTMLRewriter` without switching back to a buffered string renderer. In Edge and Worker environments, that gives you a zero-buffering path by default: the engine rewrites the upstream response body as it streams, pauses only when it reaches a Liquid marker that needs resolution, and resumes as soon as the value is ready.

The other major shift is the async walker. Instead of requiring the entire context object up front, `liquidstream` can lazy-load root values on demand through `.on(contextProp, handler)`. That makes it natural to fetch data only when a template actually references it, while still preserving Liquid-style filters, tags, and HTML-first rendering.

It is especially well suited to:

- documentation sites and marketing pages that are mostly HTML with targeted Liquid expressions
- edge-rendered pages where `eval()`-heavy template engines are a poor fit
- projects that want zero-buffering output and request-scoped data loading
- Markdown-to-HTML publishing flows where the final page still needs Liquid-aware layout composition

## Getting started

### Installation

```bash
npm install @sntran/liquidstream
```

### Streaming Quick Start

Use `transform()` when you already have an HTML `Response` and you want the rewrite to stay inside the streaming pipeline.

{% raw %}
```js
import { Liquid } from "@sntran/liquidstream";

export default {
  async fetch(request, env) {
    const template = await env.ASSETS.fetch(
      new Request(new URL("/templates/profile.html", request.url)),
    );

    const engine = new Liquid()
      .on("user", {
        async node() {
          const id = new URL(request.url).searchParams.get("user") ?? "guest";
          return await env.USERS.get(id, { type: "json" });
        },
      });

    return engine.transform(template);
  },
};
```
{% endraw %}

If `/templates/profile.html` contains:

{% raw %}
```html
<article>
  <h1>{{ user.name }}</h1>
  <p>{{ user.bio | capitalize }}</p>
</article>
```
{% endraw %}

the engine resolves `user` lazily the first time the template touches that root, then keeps streaming the rewritten response back to the client.

### Liquid.js Compatibility Adapter

`parseAndRender()` remains fully supported as a Liquid.js compatibility adapter. It is the preferred choice for legacy workflows, unit tests, local scripts, and any environment where a final HTML string is still the most practical return value.

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

The adapter uses the same engine semantics as `transform()`, but returns the fully rendered HTML string for compatibility-oriented workflows.

### Product snapshot

- response-native rendering powered by `HTMLRewriter`
- zero-buffering transform path for Edge and Worker responses
- async walker with lazy root resolution through `.on()`
- safe-flush text handling that streams literal content immediately and only pauses at Liquid markers
- instance-local custom filters and custom tags
- partials loaded through `fetch` for `render` and `include`
- plugin-friendly design with optional Jekyll-style helpers
- this repository doubles as a no-build documentation site

### Why it exists

Most Liquid engines optimize for broad compatibility and full-string rendering. `liquidstream` focuses on a different shape of problem:

- stream HTML as early as possible
- avoid `eval()` and `new Function()` in isolate runtimes
- lazy-load template data only when a root is actually referenced
- stay small enough to inspect and maintain
- keep the API practical for content sites and edge rendering

If your templates are HTML-first and your runtime is closer to Cloudflare Workers than a full server process, that tradeoff is often the right one.

### Runtime model

`liquidstream` is not trying to be a drop-in implementation of every Shopify or Jekyll behavior. The goal is a compact engine with predictable behavior in modern runtimes.

In practice, that means:

- HTML is treated as the primary document format
- `transform()` works on `Response` objects directly instead of rendering through a separate string buffer
- Liquid expressions are resolved while the markup flows through the rewriter
- root data can be loaded lazily through `.on(contextProp, handler)`
- custom filters and tags are registered per engine instance
- partials are loaded through `fetch`, which maps naturally to Workers and web runtimes
- cooperative yielding is available for large renders instead of blocking long loops

If you need the broadest possible Liquid compatibility across every legacy construct, another engine may be a better fit. If you want a pragmatic subset that behaves naturally in isolate runtimes and still offers a compatibility adapter for string-based flows, `liquidstream` is designed for that job.

## Examples

### Response-native transform

{% raw %}
```js
import { Liquid } from "@sntran/liquidstream";

const engine = new Liquid()
  .on("page", {
    async node() {
      return {
        title: "Streaming First",
        summary: "response-native liquid",
      };
    },
  });

const response = engine.transform(new Response(`
  <section>
    <h1>{{ page.title }}</h1>
    <p>{{ page.summary | capitalize }}</p>
  </section>
`));
```
{% endraw %}

### Legacy string workflow

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

### Loop rendering

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

### Jekyll-style filters

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

### Capture and control flow

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

### Partials through `fetch`

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

## The Lazy Context Registry

The async walker resolves the first token of a Liquid path through `.on(contextProp, handler)`.

{% raw %}
```js
import { Liquid, UNHANDLED } from "@sntran/liquidstream";

const engine = new Liquid()
  .on("user", {
    async node() {
      return {
        profile: { name: "Ada Lovelace" },
        visits: 3,
      };
    },
    async get(target, token, ctx) {
      if (token === "visits" && ctx.root === "user") {
        return 7;
      }

      return target?.[token] ?? UNHANDLED;
    },
    async filter(target, name, args, ctx) {
      if (name === "badge") {
        const prefix = args[0] ?? ctx.root;
        return `**${prefix}:${String(target).toUpperCase()}**`;
      }

      return UNHANDLED;
    },
  });
```
{% endraw %}

TypeScript shape:

```ts
export type Awaitable<T> = T | Promise<T>;
export declare const UNHANDLED: unique symbol;
export type LiquidPathToken = string | number;
export type TrapResult<T> = T | typeof UNHANDLED;

export interface NodeTrapContext {
  root: string;
  input: Response;
  expression: string;
  signal: AbortSignal | null;
}

export interface TrapContext {
  root: string;
  input: Response;
  expression: string;
  path: readonly LiquidPathToken[];
  index?: number;
  signal: AbortSignal | null;
}

export interface LiquidContextHandler {
  node?(ctx: NodeTrapContext): Awaitable<TrapResult<unknown>>;
  get?(target: unknown, token: LiquidPathToken, ctx: TrapContext): Awaitable<TrapResult<unknown>>;
  filter?(target: unknown, name: string, args: readonly unknown[], ctx: TrapContext): Awaitable<TrapResult<unknown>>;
}
```

Trap semantics:

- `node()` resolves the root value for the registered property and is memoized once per `transform()` call
- `get(target, token, ctx)` resolves one token hop at a time after the root has been loaded
- `filter(target, name, args, ctx)` intercepts filter application for values originating from that root
- `ctx` carries the metadata for the current resolution step, including the root name, expression, path, input response, and cancellation signal
- returning `UNHANDLED` delegates back to the engine
- `UNHANDLED` is different from `undefined`: `undefined` is treated as a real resolved value, while `UNHANDLED` means “fall back to the default behavior”

Default fallback behavior:

- if no root handler exists, the engine falls back to the active render scope
- if `get()` returns `UNHANDLED`, normal path traversal continues
- if `filter()` returns `UNHANDLED`, the global filter registry is checked next
- if no filter exists at all, the current value is preserved

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

### `on(contextProp, handler)`

Registers a lazy root handler for the async walker.

Use this when you want to resolve a root like `user`, `page`, or `posts` on demand during `transform()`. A root handler can:

- load the root with `node()`
- override path traversal with `get()`
- intercept root-local filters with `filter()`

Re-registering the same `contextProp` replaces the previous handler.

### `transform(input)`

Transforms an HTML `Response` without buffering the full body in memory.

This is the primary API for Edge and Worker environments. Pass in an upstream HTML response, let `liquidstream` rewrite it through `HTMLRewriter`, and return the transformed response directly to the client.

Important guarantees:

- the streaming path is response-native
- `Content-Length` is removed automatically because rewritten output length can change
- plain text is safe-flushed immediately and the stream only pauses at Liquid markers that need evaluation
- async `.on()` traps can await I/O without forcing a whole-document buffer

### `parseAndRender(html, context)`

Renders a template string and returns the final HTML string.

This method is fully supported as a Liquid.js compatibility adapter. Prefer it for:

- legacy codebases already built around string templates
- unit tests that assert on final HTML strings
- local scripts, static generation steps, or non-streaming environments
- gradual migration to `transform()` without changing every call site at once

Internally, it routes top-level context keys through the same async walker used by `transform()`, so the compatibility path stays behaviorally aligned with the streaming engine.

### `registerFilter(name, filter)`

Adds or overrides an instance-local global filter.

Global filters remain the fallback path after a root-local `filter()` trap returns `UNHANDLED`.

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
- lazy roots registered with `.on()` are resolved per transformed response, not globally

Those constraints are deliberate. They keep the engine easier to reason about in environments where streaming and runtime safety matter.

## Benchmarks

Current benchmark snapshot from this repository:

- gzipped ESM entry: `8877 B`
- gzipped minified bundle: `14973 B`
- simple `transform()` average, 26 B template: `1.115 ms`
- first byte, static-prefix template, median: `2.862 ms`
- first byte, filter-dependent template, median: `0.289 ms`
- heavy 1 MB `transform()`: `45.405 ms`

These numbers come from [`scripts/benchmark-liquid.mjs`](./scripts/benchmark-liquid.mjs) and are better read as directional guidance than a universal speed claim.

The benchmark now measures the public `transform()` API directly. The important architectural behavior is still the safe-flush path in the streaming engine: literal text can be emitted immediately, and the rewriter only waits when it reaches a Liquid marker that actually needs a value. On large HTML documents with long static prefixes, that keeps first-byte latency dramatically lower than a buffered string render because the engine can ship the opening bytes before the full document has been resolved.

`liquidstream` is strongest when streaming behavior, request-scoped data loading, and edge compatibility matter more than raw string-at-once throughput.

## Contributing

Issues, bug reports, test cases, and focused patches are all welcome. The project is still intentionally small, so code clarity and runtime behavior matter at least as much as feature count.

Contributions are especially helpful in these areas:

- compatibility bugs in supported Liquid syntax
- small, well-tested filter or tag additions
- performance improvements that preserve the streaming model
- documentation improvements with concrete examples

If you propose a new feature, it helps to explain how it fits the project’s core goals: HTML-first rendering, edge-friendly runtime behavior, and a compact implementation that stays understandable.

# `@sntran/liquidstream`

`@sntran/liquidstream` is a streaming-first Liquid renderer for Cloudflare Workers, edge runtimes, and Node.js.

It keeps the public `Liquid` class so existing `liquidjs`-style code stays familiar, but the engine is built around `HTMLRewriter` instead of a full AST compiler. That means it can start emitting HTML while the document is still being processed, which is especially valuable in Worker environments where time to first byte matters.

## Why `liquidstream`

Most Liquid engines optimize for broad compatibility and full template-platform features. `liquidstream` optimizes for a different goal:

- stream HTML early instead of waiting for the whole template to finish
- stay safe in Worker runtimes with no `eval()` or `new Function()`
- keep the implementation compact and inspectable
- preserve a familiar `Liquid` API for most day-to-day template work

If you want a Worker-native renderer that behaves like Liquid without hauling in a large parser stack, this is the fit.

## Streaming Value Proposition

`liquidstream` uses `HTMLRewriter` as the rendering bridge. It buffers split text chunks only until `lastInTextNode`, then immediately evaluates Liquid tags through a small state machine.

That gives it a practical advantage over string-only engines: it can start sending the response before the entire template is fully rendered.

Benchmark snapshot from this repository:

- gzipped engine size: `9075 B`
- first byte, `liquidstream`: `2.613 ms`
- first byte, `liquidjs`: `36.707 ms`
- heavy 1 MB render, `liquidstream`: `30.534 ms`
- heavy 1 MB render, `liquidjs`: `44.942 ms`

Those numbers come from [scripts/benchmark-liquid.mjs](/home/esente/Projects/sntran/liquidstream/scripts/benchmark-liquid.mjs). Tiny full-string renders can still be faster in `liquidjs`, but `liquidstream` is designed to win where streaming and Worker behavior matter more than small-template throughput.

## Drop-in Compatibility

The exported class is still named `Liquid`, so most `liquidjs` usage can be migrated with only an import change.

Before:

```js
import { Liquid } from "liquidjs";

const engine = new Liquid();
const html = await engine.parseAndRender("<p>{{ name }}</p>", {
  name: "Ada",
});
```

After:

```js
import { Liquid } from "@sntran/liquidstream";

const engine = new Liquid();
const html = await engine.parseAndRender("<p>{{ name }}</p>", {
  name: "Ada",
});
```

The main compatibility goal is simple: if your project already thinks in terms of `new Liquid()` plus `parseAndRender()`, `liquidstream` should be a practical drop-in replacement for most use cases.

## Installation

```bash
npm install @sntran/liquidstream
```

## Quick Start

```js
import { Liquid } from "@sntran/liquidstream";

const engine = new Liquid();

const html = await engine.parseAndRender(
  "<p>{{ greeting }}, {{ user.name }}!</p>",
  {
    greeting: "Hello",
    user: { name: "Alice" },
  },
);

console.log(html);
// <p>Hello, Alice!</p>
```

## Worker-Native Example

The package is built for Worker environments. Here is a copy-pasteable Cloudflare Worker example that fetches a Liquid template, renders it, and then applies an outer `HTMLRewriter` pass:

```js
import { Liquid } from "@sntran/liquidstream";
import { HTMLRewriter } from "@sntran/html-rewriter";

const liquid = new Liquid({
  fetch,
  HTMLRewriterClass: HTMLRewriter,
});

export default {
  async fetch(request) {
    const template = `
      <main>
        <h1>{{ page.title }}</h1>
        <div id="content">{{ page.body }}</div>
      </main>
    `;

    const html = await liquid.parseAndRender(template, {
      page: {
        title: "Hello from Workers",
        body: "Streaming Liquid on Cloudflare.",
      },
    });

    const response = new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });

    return new HTMLRewriter()
      .on("#content", {
        element(element) {
          element.setAttribute("data-rendered", "true");
        },
      })
      .transform(response);
  },
};
```

## Supported Features

`liquidstream` intentionally supports a focused but practical Liquid subset:

- variable interpolation: `{{ user.name }}`
- whitespace control: `{{- value -}}`, `{%- if true -%}`
- filters with quote-aware parsing
- `if`, `unless`, `else`, `endif`
- `case`, `when`, `endcase`
- `for`, `endfor`
- `for` controls: `limit`, `offset`, `reversed`
- `forloop.index`, `forloop.index0`, `forloop.first`, `forloop.last`, `forloop.length`
- `assign`
- `capture`
- `render`
- `include`
- `raw`
- `increment`, `decrement`
- range expressions such as `(1..5)` and `(start..end)`
- array and object literals such as `[
  "red",
  "blue"
]` and `{"name": "Ada"}`
- comparison operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`
- boolean operators: `and`, `or`
- logic inside attribute values
- custom filters
- custom tags
- Liquid truthiness semantics where only `false`, `null`, and `undefined` are falsey

Built-in filters include:

- `relative_url`
- `upcase`
- `downcase`
- `capitalize`
- `strip`
- `size`
- `slice`
- `join`
- `split`
- `map`
- `first`
- `last`
- `date`
- `default`
- `strip_html`
- `newline_to_br`
- `abs`
- `at_least`
- `at_most`
- `ceil`
- `floor`
- `round`
- `url_encode`
- `url_decode`

An optional Jekyll-oriented filter pack is also available from `@sntran/liquidstream/jekyll`.

## API

### `new Liquid(options?)`

Creates a renderer instance.

Supported options:

- `HTMLRewriterClass`: inject a custom `HTMLRewriter` implementation for tests or alternate runtimes
- `autoEscape`: defaults to `true`
- `fetch`: fetch implementation used by `render` and `include`; defaults to `globalThis.fetch`
- `filters`: instance-local filter overrides and extensions
- `tags`: instance-local custom tags
- `yieldAfter`: iteration threshold for cooperative yielding inside large loop renders
- `yieldControl`: custom async yield hook used during large loops

### `parseAndRender(html, context)`

Renders a template string with the provided context.

### `registerFilter(name, filter)`

Adds or overrides an instance-local filter.

Filter functions run with a small engine-aware `this` binding:

- `this.context`: the current render scope
- `this.evaluate(expression, scope?)`: evaluate a Liquid condition against the current scope plus optional overrides
- `this.resolveExpression(expression, scope?, options?)`: resolve a Liquid expression against the current scope plus optional overrides

### `registerTag(name, handler)`

Adds or overrides an instance-local custom tag.

### `createHandler(context)`

Returns the low-level `HTMLRewriter` handlers used internally for `element` and `text` processing. This is mainly useful for tests and advanced integration work.

## Filters

Constructor-provided filters override the shared standard library by shadowing it on the instance:

```js
import { Liquid } from "@sntran/liquidstream";

const engine = new Liquid({
  filters: {
    upcase(value) {
      return `custom:${value}`;
    },
  },
});

console.log(await engine.parseAndRender('{{ "hello" | upcase }}', {}));
// custom:hello
```

You can also register filters after construction:

```js
const engine = new Liquid();

engine.registerFilter("surround", (value, left = "[", right = "]") => {
  return `${left}${value}${right}`;
});

console.log(await engine.parseAndRender('{{ "hello" | surround: "(", ")" }}', {}));
// (hello)
```

Filters can access the current context and delegate condition or expression work back to the engine:

```js
engine.registerFilter("only_matching", function (items, variableName, expression) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.filter((item) => this.evaluate(expression, { [variableName]: item }));
});
```

## Jekyll Filters

If you want Jekyll-style helpers without baking them into the core engine, import the optional plugin:

```js
import { Liquid } from "@sntran/liquidstream";
import jekyllFilters from "@sntran/liquidstream/jekyll";

const engine = new Liquid({
  filters: jekyllFilters,
});

const html = await engine.parseAndRender(
  '{{ posts | where_exp: "post", "post.category == page.category" | size }}',
  {
    page: { category: "guides" },
    posts: [
      { category: "guides" },
      { category: "news" },
    ],
  },
);
```

The Jekyll plugin currently provides:

- `jsonify`
- `slugify`
- `where`
- `where_exp`
- `relative_url`
- `absolute_url`
- `group_by`
- `group_by_exp`

## Custom Tags

Custom tags run during the `EMIT` phase of the state machine and can return either plain output or `{ output, html }`.

```js
const engine = new Liquid({
  tags: {
    echo_upper({ expression, resolveArgument }) {
      return String(resolveArgument(expression)).toUpperCase();
    },
  },
});

console.log(await engine.parseAndRender('{% echo_upper "text" %}', {}));
// TEXT
```

HTML-returning tags can opt into raw output:

```js
engine.registerTag("raw_box", () => ({
  output: "<strong>hi</strong>",
  html: true,
}));
```

## How It Works

The core engine lives in [src/index.js](/home/esente/Projects/sntran/sntran.com/packages/liquid-html-rewriter/src/index.js).

At a high level:

- `HTMLRewriter` provides the streaming bridge between incoming HTML and Liquid evaluation
- text chunks are buffered until `lastInTextNode` to avoid breaking split tags like `{{ user.` and `name }}`
- a small state machine drives rendering with `EMIT`, `SKIP`, `CAPTURE`, and `RAW`
- child scopes are created with `Object.create(parent)` to keep scope creation cheap and predictable
- large loops yield cooperatively with `scheduler.yield()` or `setTimeout(..., 0)` to stay Worker-friendly

Contributor note: readability wins over micro-optimizations here. This project does care about size and performance, but not at the cost of making the engine impossible to maintain. If a change improves clarity while preserving the streaming model and Worker safety, that is usually the right tradeoff.

## Security And Runtime Model

- no `eval()`
- no `new Function()`
- no dynamic code generation
- partials use native `fetch`
- large loops yield cooperatively for Worker safety

## What Is Missing Compared To `liquidjs`

`liquidstream` is intentionally smaller than `liquidjs`. It does not aim for full Shopify or Jekyll compatibility.

Notable gaps include:

- no parser or AST API such as `parse()`, compiled templates, or caching layers
- no `layout`, `block`, `tablerow`, or `cycle` tags
- no `break` or `continue` inside loops
- no full filter catalog parity with Shopify or `liquidjs`
- no filesystem loader abstraction or rich template resolution pipeline
- no parser hooks, tokenizer plugins, or AST transforms
- no attempt to reproduce every Ruby Liquid edge case exactly

## Development

From the package directory:

```bash
npm test
npm run coverage
npm run benchmark
```

## License

MIT

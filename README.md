# `@sntran/liquid-html-rewriter`

`@sntran/liquid-html-rewriter` is a small Liquid-compatible renderer built on top of `HTMLRewriter`.

It is designed for environments where:

- streaming matters
- bundle size matters
- `eval()` and `new Function()` are not allowed
- you only need a practical, well-defined subset of Liquid rather than the full Shopify/Jekyll surface area

This package powers the Liquid rendering path used by `sntran.com`, especially for Cloudflare Worker rendering and Explorer tree generation.

## Why This Exists

Traditional Liquid engines are excellent general-purpose tools, but they usually optimize for broad compatibility over Worker-specific constraints. This package takes a different approach:

- it uses `HTMLRewriter` as the primary rendering engine
- it keeps scope creation cheap via `Object.create(...)`
- it avoids dynamic code generation entirely
- it favors a compact, inspectable implementation over a giant parser/runtime stack

In practice, that makes it a good fit for Worker-style deployments, edge rendering experiments, and HTML-centric templates that benefit from streaming behavior.

## What It Supports

The current implementation supports a deliberately focused subset of Liquid:

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
- array and object literals such as `["red", "blue"]` and `{"name": "Ada"}`
- comparison operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`
- boolean operators: `and`, `or`
- logic inside attribute values
- custom filters
- custom tags
- Liquid truthiness semantics where only `false`, `null`, and `undefined` are falsey

It also includes a standard filter library with filters such as:

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
- `relative_url`
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

## What Is Missing Compared To `liquidjs`

This package is intentionally smaller than `liquidjs`. It does not aim for full Shopify or Jekyll compatibility.

Notable gaps today include:

- no parser/AST API such as `parse()`, `render()`, or template compilation and caching layers
- no `layout`, `block`, `tablerow`, or `cycle` tags
- no `break` or `continue` inside loops
- no full whitespace-control parity in every edge case
- no full filter catalog from Shopify or `liquidjs`
- no dynamic file-system loaders, partial loaders, or template resolution strategies
- no custom parser hooks, tokenizer plugins, or AST transforms
- no attempt to support every Ruby Liquid edge case around error recovery or ambiguous syntax

Implemented behavior may also differ deliberately in a few places because this engine is optimized for Worker safety and a narrow template subset rather than broad compatibility.

## Installation

```bash
npm install @sntran/liquid-html-rewriter
```

## Quick Start

```js
import { Liquid } from "@sntran/liquid-html-rewriter";

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

## Filters

Constructor-provided filters override the shared standard library by shadowing it on the instance:

```js
import { Liquid } from "@sntran/liquid-html-rewriter";

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

## Custom Tags

Custom tags hook into the `STATE_EMIT` pass and can return either plain output or `{ output, html }`.

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

## API

### `new Liquid(options?)`

Creates a renderer instance.

Supported options:

- `HTMLRewriterClass`: inject a custom `HTMLRewriter` implementation for tests or alternate runtimes
- `autoEscape`: defaults to `true`
- `fetch`: fetch implementation used by `render` and `include`; defaults to `globalThis.fetch`
- `filters`: instance-local filter overrides/extensions
- `tags`: instance-local custom tags
- `yieldAfter`: iteration threshold for cooperative yielding inside large loop renders
- `yieldControl`: custom async yield hook used during large loops

### `parseAndRender(html, context)`

Renders a template string with the provided context.

### `registerFilter(name, filter)`

Adds or overrides an instance-local filter.

### `registerTag(name, handler)`

Adds or overrides an instance-local custom tag.

### `createHandler(context)`

Creates the underlying `HTMLRewriter` handler pair used internally for `element` and `text` processing. This is mostly useful for tests and advanced integration work.

### `resolveExpression(expression, context, options?)`

Resolves an expression with or without filters. This powers both `resolveValue` and `resolveArgument`.

## Implementation Notes

### Streaming Model

The engine buffers split text chunks until `lastInTextNode` is `true`, then processes the combined text through a single-pass state machine. This is what makes chunk boundaries transparent to template behavior.

### State Machine

The core renderer uses four states:

- `EMIT`: normal rendering
- `SKIP`: active branch skipping for false conditionals
- `CAPTURE`: buffered block capture for `for` and `capture`
- `RAW`: literal passthrough until `{% endraw %}`

### Scope Model

All child scopes use:

```js
Object.create(parent)
```

That gives O(1) scope creation and avoids cloning large context objects on every branch or loop iteration.

### Filter Registry

Standard filters live in a shared prototype object. Instance filters are created like this:

```js
Object.assign(Object.create(FILTERS), options.filters || {})
```

That means:

- no constructor-time re-registration of every standard filter
- user filters can override built-ins by shadowing
- instances stay isolated from one another

### Worker Safety

Large loop renders yield cooperatively every `yieldAfter` iterations using `scheduler.yield()` when available, or `setTimeout(..., 0)` as a fallback.

Partials loaded through `render` and `include` use the native `fetch` API with `Request` objects, which keeps the integration aligned with Cloudflare Workers.

### Security

The engine does not use `eval()` or `new Function()`.

Attribute values are escaped through `escapeAttribute()`, and normal variable output is HTML-escaped by default.

## Testing

The package includes:

- deterministic unit and regression tests
- compatibility tests against `liquidjs`
- property-based tests using `fast-check`
- performance smoke tests
- a reproducible benchmark script

The suites are run serially on purpose. In practice the engine is deterministic, but a few timing-sensitive performance and property checks are more stable when each file gets its own Node test process.

Run them with:

```bash
npm test
npm run coverage
npm run benchmark
```

## Package Layout

```text
packages/liquid-html-rewriter/
  package.json
  README.md
  src/
    index.js
  test/
    liquid.test.js
    filters.test.js
    compatibility.test.js
    properties.test.js
    performance.test.js
  scripts/
    run-tests.mjs
    benchmark-liquid.mjs
```

## Rendering Pipeline

At a high level, `parseAndRender()` works like this:

1. Wrap the incoming HTML in a `Response`
2. Stream it through `HTMLRewriter`
3. Buffer text chunks until `lastInTextNode`
4. Run the buffered text through the Liquid state machine
5. Emit interpolated HTML, captured blocks, or skipped content depending on state

That keeps the implementation Worker-friendly while still allowing `for`, `if`, `capture`, custom tags, and attribute-level Liquid logic.

## Example: Explorer Tree Rendering

One of the main production use cases is rendering a Jekyll-style include in multiple runtimes from the same source template:

```js
import { Liquid } from "@sntran/liquid-html-rewriter";

const engine = new Liquid();
const template = `
  <ul>
    {% for post in site.posts %}
      <li><a href="{{ post.url }}">{{ post.title }}</a></li>
    {% endfor %}
  </ul>
`;

const html = await engine.parseAndRender(template, {
  site: {
    posts: [
      { url: "/notes/one/", title: "One" },
      { url: "/notes/two/", title: "Two" },
    ],
  },
});
```

This approach lets a single Liquid include stay authoritative for GitHub Pages while still rendering on Cloudflare Workers.

## Limitations

This is not a full Shopify/Jekyll Liquid implementation. It intentionally focuses on the subset needed by this project and on the operational constraints of Worker runtimes.

If you are evaluating this package against `liquidjs`, treat it as a focused runtime renderer rather than a general-purpose Liquid platform.

If you need full Liquid compatibility across the entire Shopify ecosystem, use a full engine like `liquidjs`. If you need a compact, Worker-friendly renderer with predictable behavior and a small footprint, this package is the better fit.

import * as filters from "./filters.js";
import { coreTags } from "./tags.js";
import { LiquidEvaluator } from "./evaluator.js";
import { LiquidRewriter } from "./rewriter.js";
import { LiquidTag } from "./tag.js";
import { UNHANDLED, isLiquidTruthy, readLiquidTag, resolvePathValue, skipLeadingWhitespace, tokenize, trimTrailingWhitespace, VARIABLE_CLOSE, VARIABLE_OPEN } from "./utils.js";

const FILTERS = { ...filters };

export { UNHANDLED };

/**
 * Default cooperative yield hook used during large async renders.
 *
 * In runtimes that expose `scheduler.yield()`, that path is preferred.
 * Otherwise the engine falls back to a zero-delay timer so long loops can
 * give control back to the event loop without changing render semantics.
 *
 * @returns {Promise<void>}
 */
export async function defaultYieldControl() {
  if (globalThis.scheduler && typeof globalThis.scheduler.yield === "function") {
    await globalThis.scheduler.yield();
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 0));
}

function normalizeTagDefinition(name, tagDefinition) {
  if (!tagDefinition || typeof tagDefinition !== "object") {
    throw new TypeError(`Tag "${name}" must be a TagDefinition object`);
  }

  if (typeof tagDefinition.onEmit !== "function") {
    throw new TypeError(`Tag "${name}" must define an onEmit(ctx) handler`);
  }

  return {
    ...tagDefinition,
    name: tagDefinition.name || name,
  };
}

function normalizeTagRegistry(tags = {}) {
  const registry = Object.create(null);

  for (const [name, tagDefinition] of Object.entries(tags)) {
    registry[name] = normalizeTagDefinition(name, tagDefinition);
  }

  return registry;
}

export class Liquid {
  #handlers;
  #context;
  #evaluator;
  #rewriter;
  /**
   * Creates a Liquid streaming renderer.
   *
   * @param {object} [options]
   * @param {typeof import("@sntran/html-rewriter").HTMLRewriter} [options.HTMLRewriterClass]
   * @param {Record<string, Function>} [options.filters]
   * @param {Record<string, object>} [options.tags]
   * @param {typeof fetch} [options.fetch]
   * @param {boolean} [options.autoEscape=true]
   * @param {number} [options.yieldAfter=100]
   * @param {() => Promise<void>} [options.yieldControl]
   */
  constructor(options = {}) {
    const {
      HTMLRewriterClass,
      filters: customFilters = {},
      tags = {},
      fetch,
      autoEscape = true,
      yieldAfter = 100,
      yieldControl,
    } = options;
    const fetchImpl = fetch || globalThis.fetch;
    const resolvedYieldControl = yieldControl || defaultYieldControl;
    const normalizedFilters = Object.assign(Object.create(FILTERS), customFilters);
    const normalizedTags = Object.assign(Object.create(null), coreTags, normalizeTagRegistry(tags));
    this.#handlers = new Map();
    this.#context = {};
    this.#evaluator = new LiquidEvaluator({
      filters: normalizedFilters,
      fetch: fetchImpl,
      yieldAfter,
      yieldControl: resolvedYieldControl,
      tags: normalizedTags,
      handlers: this.#handlers,
    });
    this.#rewriter = new LiquidRewriter({
      autoEscape,
      HTMLRewriterClass,
      tags: normalizedTags,
      handlers: this.#handlers,
      context: this.#context,
      createTag: (options) => new LiquidTag(options),
      yieldAfter,
      yieldControl: resolvedYieldControl,
    });
    this.#evaluator.attachRenderFragment((...args) => this.#rewriter.renderFragment(...args));
    this.#rewriter.on("{{ * }}", {
      output: ({ expression }, runtime) => this.#evaluator.resolveValueAsync(expression, runtime.context, runtime.execution),
    });
    this.#rewriter.on("{% * %}", {
      element: (tag) => tag.render(this),
    });
  }

  /**
   * Registers a context root handler used by the async streaming resolver.
   *
   * The first token of a Liquid path is matched against `contextProp`, then the
   * handler's traps may resolve the root node, path traversal, and filters for
   * values originating from that root.
   *
   * @param {string} contextProp
   * @param {object} handler
   * @returns {this}
   */
  on(contextProp, handler) {
    this.#handlers.set(contextProp, handler || {});
    this.#evaluator.handlers = this.#handlers;
    this.#rewriter.handlers = this.#handlers;
    return this;
  }

  /**
   * Registers a global filter.
   *
   * @param {string} name
   * @param {Function} filter
   */
  registerFilter(name, filter) {
    this.#evaluator.filters[name] = filter;
  }

  /**
   * Registers a custom tag definition.
   *
   * @param {string} name
   * @param {object} tagDefinition
   */
  registerTag(name, tagDefinition) {
    this.#rewriter.tags[name] = normalizeTagDefinition(name, tagDefinition);
    this.#evaluator.tags[name] = this.#rewriter.tags[name];
  }

  /**
   * Applies a plugin function to the current engine instance.
   *
   * @param {(this: Liquid, LiquidClass: typeof Liquid) => void} plugin
   * @returns {this}
   */
  plugin(plugin) {
    if (typeof plugin === "function") {
      plugin.call(this, this.constructor);
    }

    return this;
  }

  /**
   * Transforms an HTML response stream in place.
   *
   * This is the primary public API. It preserves the streaming `Response`
   * boundary and delegates the actual Liquid-aware rewrite work to the
   * rewriter collaborator.
   *
   * @param {Response|string} input
   * @returns {Response}
   */
  transform(input) {
    const source = input instanceof Response ? input : new Response(input);
    const transformed = this.#rewriter.transform(source);
    const headers = new Headers(source.headers);
    headers.delete("content-length");

    return new Response(transformed.body, {
      status: source.status,
      statusText: source.statusText,
      headers,
    });
  }

  /**
   * Compatibility helper that renders a string template and returns the
   * buffered HTML result.
   *
   * Internally this still uses the same streaming engine as `transform()`,
   * but it pre-registers the provided context roots and then buffers the
   * final response body for compatibility-oriented workflows and tests.
   *
   * @param {string} [html=""]
   * @param {object} [context={}]
   * @returns {Promise<string>}
   */
  async parseAndRender(html = "", context = {}) {
    const normalizedContext = context && typeof context === "object" ? context : {};
    const previousHandlers = new Map(this.#handlers);
    const previousContext = this.#context;

    try {
      this.#context = normalizedContext;
      this.#evaluator.handlers = this.#handlers;
      this.#rewriter.context = normalizedContext;
      this.#rewriter.handlers = this.#handlers;

      for (const key of Object.keys(normalizedContext)) {
        this.on(key, {
          node: () => normalizedContext[key],
        });
      }

      return await this.transform(new Response(html)).text();
    } finally {
      this.#handlers = previousHandlers;
      this.#context = previousContext;
      this.#evaluator.handlers = previousHandlers;
      this.#rewriter.handlers = previousHandlers;
      this.#rewriter.context = previousContext;
    }
  }

  /**
   * Exposes the evaluator collaborator for advanced integrations and plugins.
   *
   * @returns {import("./evaluator.js").LiquidEvaluator}
   */
  get evaluator() {
    return this.#evaluator;
  }

  /**
   * Exposes the rewriter collaborator for advanced integrations and plugins.
   *
   * @returns {import("./rewriter.js").LiquidRewriter}
   */
  get rewriter() {
    return this.#rewriter;
  }

}

export const __private__ = {
  UNHANDLED,
  isLiquidTruthy,
  resolvePathValue,
  splitTopLevel: tokenize,
  tokenize,
};

export default Liquid;

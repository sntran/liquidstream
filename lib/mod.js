import { HTMLRewriter as DefaultHTMLRewriter } from "@sntran/html-rewriter";
import * as filters from "./filters.js";
import { parsePartialExpression } from "./tags/file.js";
import { renderCapture } from "./tags/iteration.js";
import { coreTags } from "./tags.js";
import { applySignal } from "./tags/signals.js";
import {
  BLOCK_CLOSE,
  BLOCK_OPEN,
  COMPARISON_OPERATORS,
  EMPTY_STRING,
  HTML_VALUE,
  NUMBER_PATTERN,
  VARIABLE_CLOSE,
  VARIABLE_OPEN,
  appendCapturePart,
  appendRawPart,
  createHandlerState,
  createRuntime,
  createScope,
  escapeHtml,
  findTopLevelOperator,
  getResumeCursor,
  getNextLiquidMarker,
  hasIncompleteLiquidTag,
  hasQuotedIncompleteLiquidTag,
  isLiquidTruthy,
  normalizeLiteralKey,
  parsePathSegments,
  parseTagInvocation,
  readLiquidTag,
  resolvePathValue,
  serializeEndTag,
  serializeStartTag,
  skipLeadingWhitespace,
  splitFilterArguments,
  splitFilterNameAndArguments,
  splitFilterSegments,
  splitRangeExpression,
  tokenize,
  trimBufferedTrailingWhitespace,
  trimTrailingWhitespace,
  unwrapHtmlValue,
} from "./utils.js";

const STATE_EMIT = "EMIT";
const STATE_SKIP = "SKIP";
const STATE_CAPTURE = "CAPTURE";
const STATE_RAW = "RAW";
const FILTERS = { ...filters };

export const UNHANDLED = Symbol("liquidstream.unhandled");

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

function isSignal(value) {
  return value && typeof value === "object" && typeof value.action === "string";
}

function normalizeLegacyTagResult(tagResult) {
  if (isSignal(tagResult)) {
    return tagResult;
  }

  if (tagResult && typeof tagResult === "object" && "output" in tagResult) {
    return {
      action: "OUTPUT",
      output: tagResult.output,
      html: Boolean(tagResult.html),
    };
  }

  return {
    action: "OUTPUT",
    output: String(tagResult ?? EMPTY_STRING),
    html: true,
  };
}

function resolveScopeArgs(context, scopeOrOptions = {}, maybeOptions = {}) {
  const looksLikeOptions = scopeOrOptions && typeof scopeOrOptions === "object" && "applyFilters" in scopeOrOptions;
  if (looksLikeOptions) {
    return {
      scope: {},
      options: scopeOrOptions,
    };
  }

  return {
    scope: scopeOrOptions || {},
    options: maybeOptions || {},
  };
}

function hasOwnContextValue(context, key) {
  return Boolean(context) && (typeof context === "object" || typeof context === "function")
    && Object.prototype.hasOwnProperty.call(context, key);
}

function hasContextValue(context, key) {
  return Boolean(context) && (typeof context === "object" || typeof context === "function") && key in Object(context);
}

function createAsyncFilterContext(engine, context, execution) {
  return {
    context,
    evaluate: (expression, scope = {}) => engine.evaluateConditionAsync(
      expression,
      Object.assign(createScope(context), scope),
      execution,
    ),
    resolveExpression: (expression, scope = {}, options = {}) => engine.resolveExpressionAsync(
      expression,
      Object.assign(createScope(context), scope),
      execution,
      options,
    ),
  };
}

function createRenderScope(context = {}) {
  const scope = createScope(context);

  if (context && typeof context === "object") {
    Object.assign(scope, context);
  }

  return scope;
}

function createTagContext(engine, tag, expression, handler, block) {
  return {
    name: tag.name,
    tag,
    block,
    expression,
    markup: expression,
    handler,
    state: handler,
    context: handler.currentContext,
    engine,
    evaluate: (condition, scope = {}) => engine.evaluateConditionAsync(
      condition,
      Object.assign(createScope(handler.currentContext), scope),
      handler.execution,
    ),
    resolveValue: (valueExpression, context = handler.currentContext) => engine.resolveValueAsync(
      valueExpression,
      context,
      handler.execution,
    ),
    resolveForCollection: (loop, context = handler.currentContext) => engine.resolveForCollectionAsync(
      loop,
      context,
      handler.execution,
    ),
    renderPartial: (partialExpression, currentHandler = handler, mode) => engine.renderPartial(
      partialExpression,
      currentHandler,
      mode,
    ),
    resolveArgument: (argument, scope = {}) => engine.resolveExpressionAsync(
      argument,
      Object.assign(createScope(handler.currentContext), scope),
      handler.execution,
      { applyFilters: false },
    ),
    resolveExpression: (argument, scopeOrOptions = {}, maybeOptions = {}) => {
      const { scope, options } = resolveScopeArgs(handler.currentContext, scopeOrOptions, maybeOptions);
      return engine.resolveExpressionAsync(
        argument,
        Object.assign(createScope(handler.currentContext), scope),
        handler.execution,
        options,
      );
    },
  };
}

export class Liquid {
  /**
   * Creates a Liquid streaming renderer.
   *
   * @param {object} [options]
   * @param {typeof DefaultHTMLRewriter} [options.HTMLRewriterClass]
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
      filters = {},
      tags = {},
      fetch,
      autoEscape = true,
      yieldAfter = 100,
      yieldControl,
    } = options;
    this.HTMLRewriterClass = HTMLRewriterClass;
    this.autoEscape = autoEscape;
    this.fetch = fetch || globalThis.fetch;
    this.filters = Object.assign(Object.create(FILTERS), filters);
    this.tags = Object.assign(Object.create(null), coreTags, normalizeTagRegistry(tags));
    this.yieldAfter = yieldAfter;
    this.yieldControl = yieldControl || defaultYieldControl;
    this.contextHandlers = new Map();
    this.baseContext = {};
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
    // Root handlers are keyed by the first path token, for example "posts" in
    // {{ posts[0].title }}. Re-registering simply replaces the previous traps.
    this.contextHandlers.set(contextProp, handler || {});
    return this;
  }

  /**
   * Registers a global filter.
   *
   * @param {string} name
   * @param {Function} filter
   */
  registerFilter(name, filter) {
    // Global filters remain available as the fallback path after any root-local
    // filter trap declines to handle a given filter invocation.
    this.filters[name] = filter;
  }

  /**
   * Registers a custom tag definition.
   *
   * @param {string} name
   * @param {object} tagDefinition
   */
  registerTag(name, tagDefinition) {
    // Tags are normalized once up front so the streaming pipeline can assume a
    // consistent async-capable shape while processing HTMLRewriter events.
    this.tags[name] = normalizeTagDefinition(name, tagDefinition);
  }

  /**
   * Applies a plugin function to the current engine instance.
   *
   * @param {(this: Liquid, LiquidClass: typeof Liquid) => void} plugin
   * @returns {this}
   */
  plugin(plugin) {
    if (typeof plugin === "function") {
      // Plugins configure the live engine instance directly, matching the
      // existing Liquid-style extension pattern used elsewhere in the project.
      plugin.call(this, this.constructor);
    }

    return this;
  }

  createExecutionContext(input, registry = this.contextHandlers, baseContext = {}) {
    return {
      input,
      registry: new Map(registry),
      rootMemo: new Map(),
      signal: null,
      baseContext,
    };
  }

  flushBufferedLiteral(handler, text) {
    const combined = `${handler.pendingLiteralText || EMPTY_STRING}${text}`;
    const output = trimTrailingWhitespace(combined);
    handler.pendingLiteralText = combined.slice(output.length);
    return output;
  }

  takeProcessableTextLength(text, state, lastInTextNode) {
    if (lastInTextNode) {
      return text.length;
    }

    let cursor = 0;

    while (cursor < text.length) {
      const marker = state === STATE_EMIT
        ? getNextLiquidMarker(text, cursor)
        : text.indexOf(BLOCK_OPEN, cursor);

      if (marker === -1) {
        return text.length;
      }

      const isVariable = state === STATE_EMIT && text.startsWith(VARIABLE_OPEN, marker);
      const tag = readLiquidTag(
        text,
        marker,
        isVariable ? VARIABLE_OPEN : BLOCK_OPEN,
        isVariable ? VARIABLE_CLOSE : BLOCK_CLOSE,
      );

      if (!tag) {
        return marker;
      }

      cursor = tag.endIndex;
    }

    return text.length;
  }

  createHandler(context = {}, execution = null) {
    const handler = createHandlerState(createRenderScope(context), {
      runtime: createRuntime(),
      renderDepth: 0,
      execution,
    });
    handler.pendingLiteralText = EMPTY_STRING;

    const onEndTag = (endTag) => {
      if (handler.state === STATE_RAW && handler.raw) {
        appendRawPart(handler.raw, serializeEndTag(endTag.name));
        endTag.remove();
        return;
      }

      if (handler.state === STATE_CAPTURE && handler.capture) {
        appendCapturePart(handler.capture, serializeEndTag(endTag.name));
        endTag.remove();
        return;
      }

      if (handler.state === STATE_SKIP) {
        endTag.remove();
      }
    };

    return {
      element: async (element) => {
        if (handler.inLiquidTag) {
          handler.textBufferParts.push(serializeStartTag(element));
          element.removeAndKeepContent();
          return;
        }

        if (handler.state === STATE_RAW && handler.raw) {
          element.onEndTag(onEndTag);
          appendRawPart(handler.raw, serializeStartTag(element));
          element.removeAndKeepContent();
          return;
        }

        if (handler.state === STATE_CAPTURE && handler.capture) {
          element.onEndTag(onEndTag);
          appendCapturePart(handler.capture, serializeStartTag(element));
          element.removeAndKeepContent();
          return;
        }

        if (handler.state === STATE_SKIP) {
          element.onEndTag(onEndTag);
          element.removeAndKeepContent();
          return;
        }

        await this.interpolateAttributes(
          element,
          handler.currentContext,
          handler.runtime,
          handler.renderDepth,
          handler.execution,
        );
      },

      text: async (chunk) => {
        handler.textBufferParts.push(chunk.text);
        let buffered = handler.textBufferParts.join(EMPTY_STRING);
        const outputParts = [];

        if (
          chunk.lastInTextNode &&
          chunk.text === EMPTY_STRING &&
          hasIncompleteLiquidTag(buffered) &&
          hasQuotedIncompleteLiquidTag(buffered)
        ) {
          handler.inLiquidTag = true;
          chunk.replace(EMPTY_STRING, { html: true });
          return;
        }

        while (buffered) {
          if (handler.state === STATE_EMIT) {
            const marker = getNextLiquidMarker(buffered, 0);

            if (marker === -1) {
              if (!chunk.lastInTextNode && buffered.endsWith("{")) {
                outputParts.push(this.flushBufferedLiteral(handler, buffered.slice(0, -1)));
                buffered = "{";
              } else {
                const literal = chunk.lastInTextNode
                  ? `${handler.pendingLiteralText}${buffered}`
                  : this.flushBufferedLiteral(handler, buffered);
                handler.pendingLiteralText = chunk.lastInTextNode ? EMPTY_STRING : handler.pendingLiteralText;
                outputParts.push(literal);
                buffered = EMPTY_STRING;
              }

              break;
            }

            if (marker > 0) {
              outputParts.push(this.flushBufferedLiteral(handler, buffered.slice(0, marker)));
              buffered = buffered.slice(marker);
              continue;
            }
          }

          const processableLength = this.takeProcessableTextLength(buffered, handler.state, chunk.lastInTextNode);
          if (processableLength === 0) {
            break;
          }

          const segment = `${handler.pendingLiteralText}${buffered.slice(0, processableLength)}`;
          handler.pendingLiteralText = EMPTY_STRING;
          outputParts.push(await this.processText(segment, handler));
          buffered = buffered.slice(processableLength);
        }

        if (chunk.lastInTextNode && buffered) {
          const segment = `${handler.pendingLiteralText}${buffered}`;
          handler.pendingLiteralText = EMPTY_STRING;
          outputParts.push(await this.processText(segment, handler));
          buffered = EMPTY_STRING;
        }

        if (chunk.lastInTextNode && handler.pendingLiteralText) {
          outputParts.push(handler.pendingLiteralText);
          handler.pendingLiteralText = EMPTY_STRING;
        }

        handler.textBufferParts.length = 0;
        if (buffered) {
          handler.textBufferParts.push(buffered);
        }

        handler.inLiquidTag = hasIncompleteLiquidTag(buffered)
          || (chunk.text === EMPTY_STRING && hasQuotedIncompleteLiquidTag(buffered));

        chunk.replace(outputParts.join(EMPTY_STRING), { html: true });
      },
    };
  }

  /**
   * Transforms an HTML `Response` with `HTMLRewriter` without buffering the
   * full body in memory.
   *
   * The returned response preserves the upstream status and headers, except
   * `Content-Length`, which is removed because the output length may change.
   *
   * @param {Response} input
   * @returns {Response}
   */
  transform(input) {
    const source = input instanceof Response ? input : new Response(input);
    const HTMLRewriterClass = this.HTMLRewriterClass || DefaultHTMLRewriter;
    const rewriter = new HTMLRewriterClass();
    const baseContext = this.baseContext && typeof this.baseContext === "object" ? this.baseContext : {};
    // Snapshot the current registry for this response so later `.on(...)` calls
    // do not mutate an in-flight stream.
    const execution = this.createExecutionContext(source, this.contextHandlers, baseContext);
    const handler = this.createHandler(baseContext, execution);

    rewriter.on("*", { element: handler.element });
    rewriter.onDocument({ text: handler.text });

    const transformed = rewriter.transform(source);
    const headers = new Headers(source.headers);
    // The response body is rewritten as a stream, so the original length can no
    // longer be trusted even when the upstream response had one.
    headers.delete("content-length");

    return new Response(transformed.body, {
      status: source.status,
      statusText: source.statusText,
      headers,
    });
  }

  /**
   * Compatibility wrapper for the legacy string-in/string-out API.
   *
   * This temporarily registers each top-level property with `.on(...)`, runs
   * the streaming transform, then restores the previous registry state.
   *
   * @param {string} [html=""]
   * @param {Record<string, unknown>} [context={}]
   * @returns {Promise<string>}
   */
  async parseAndRender(html = EMPTY_STRING, context = {}) {
    const normalizedContext = context && typeof context === "object" ? context : {};
    const previousHandlers = new Map(this.contextHandlers);
    const previousBaseContext = this.baseContext;

    try {
      this.baseContext = normalizedContext;

      for (const key of Object.keys(normalizedContext)) {
        // The compatibility wrapper models plain object input as root handlers
        // so the legacy API exercises the same async walker as `transform()`.
        this.on(key, {
          node: () => normalizedContext[key],
        });
      }

      return await this.transform(new Response(html)).text();
    } finally {
      // Restore the original engine configuration so temporary compatibility
      // handlers do not leak into subsequent renders.
      this.contextHandlers = previousHandlers;
      this.baseContext = previousBaseContext;
    }
  }

  renderResolvedValue(value) {
    if (value && typeof value === "object" && value[HTML_VALUE]) {
      return String(value.value ?? EMPTY_STRING);
    }

    const string = String(value ?? EMPTY_STRING);
    return this.autoEscape ? escapeHtml(string) : string;
  }

  interpolate(text, context = {}) {
    const output = [];
    let cursor = 0;

    while (cursor < text.length) {
      const marker = text.indexOf(VARIABLE_OPEN, cursor);
      if (marker === -1) {
        output.push(text.slice(cursor));
        break;
      }

      const variable = readLiquidTag(text, marker, VARIABLE_OPEN, VARIABLE_CLOSE);
      const leadingText = text.slice(cursor, marker);
      output.push(variable?.trimLeft ? trimTrailingWhitespace(leadingText) : leadingText);
      if (!variable) {
        output.push(text.slice(marker));
        break;
      }

      output.push(this.renderResolvedValue(this.resolveValue(variable.content, context)));
      cursor = variable.trimRight ? skipLeadingWhitespace(text, variable.endIndex) : variable.endIndex;
    }

    return output.join(EMPTY_STRING);
  }

  async interpolateAttributes(element, context = {}, runtime = createRuntime(), renderDepth = 0, execution = null) {
    const attributes = [...element.attributes];

    for (const [name, value] of attributes) {
      if (value.indexOf(VARIABLE_OPEN) === -1 && value.indexOf(BLOCK_OPEN) === -1) {
        continue;
      }

      element.setAttribute(name, await this.renderFragment(value, context, runtime, renderDepth, execution));
    }
  }

  parseLiteralExpression(expression, context = {}) {
    const normalizedExpression = expression.trim();

    if (normalizedExpression.startsWith("[") && normalizedExpression.endsWith("]")) {
      const inner = normalizedExpression.slice(1, -1).trim();
      if (!inner) {
        return [];
      }

      return tokenize(inner, ",").filter(Boolean).map((item) =>
        this.resolveExpression(item, context, { applyFilters: false }),
      );
    }

    if (normalizedExpression.startsWith("{") && normalizedExpression.endsWith("}")) {
      const inner = normalizedExpression.slice(1, -1).trim();
      if (!inner) {
        return {};
      }

      const output = {};
      for (const entry of tokenize(inner, ",").filter(Boolean)) {
        const [rawKey, rawValue] = splitFilterNameAndArguments(entry);
        if (!rawKey || !rawValue) {
          continue;
        }

        output[normalizeLiteralKey(rawKey)] = this.resolveExpression(rawValue, context, { applyFilters: false });
      }
      return output;
    }

    return null;
  }

  resolveComparisonValue(expression, context = {}) {
    return unwrapHtmlValue(this.resolveValue(expression, context));
  }

  resolveExpression(expression, context = {}, options = {}) {
    const { applyFilters = true } = options;
    const normalizedExpression = String(expression ?? EMPTY_STRING).trim();

    if (!applyFilters) {
      if (!normalizedExpression) {
        return EMPTY_STRING;
      }

      const range = splitRangeExpression(normalizedExpression);
      if (range) {
        const start = Number(this.resolveExpression(range.start, context, { applyFilters: false }));
        const end = Number(this.resolveExpression(range.end, context, { applyFilters: false }));

        if (!Number.isInteger(start) || !Number.isInteger(end)) {
          return [];
        }

        const step = start <= end ? 1 : -1;
        const output = [];

        for (let value = start; step > 0 ? value <= end : value >= end; value += step) {
          output.push(value);
        }

        return output;
      }

      const literal = this.parseLiteralExpression(normalizedExpression, context);
      if (literal !== null) {
        return literal;
      }

      if (
        (normalizedExpression.startsWith('"') && normalizedExpression.endsWith('"')) ||
        (normalizedExpression.startsWith("'") && normalizedExpression.endsWith("'"))
      ) {
        return normalizedExpression.slice(1, -1);
      }

      if (normalizedExpression.startsWith('"') || normalizedExpression.startsWith("'")) {
        return normalizedExpression.slice(1);
      }

      if (normalizedExpression === "true") {
        return true;
      }

      if (normalizedExpression === "false") {
        return false;
      }

      if (normalizedExpression === "null" || normalizedExpression === "nil") {
        return null;
      }

      if (NUMBER_PATTERN.test(normalizedExpression)) {
        return Number(normalizedExpression);
      }

      return parsePathSegments(normalizedExpression).reduce(resolvePathValue, context);
    }

    const [base, ...filterExpressions] = splitFilterSegments(normalizedExpression);
    let value = this.resolveExpression(base, context, { applyFilters: false });

    for (const filterExpression of filterExpressions) {
      const [filterName, rawArguments = EMPTY_STRING] = splitFilterNameAndArguments(filterExpression);
      const filter = this.filters[filterName];
      if (typeof filter !== "function") {
        continue;
      }

      const argumentsList = splitFilterArguments(rawArguments).map((argument) =>
        unwrapHtmlValue(this.resolveExpression(argument, context, { applyFilters: false })),
      );
      value = filter.apply(
        {
          context,
          evaluate: (filterExpressionValue, scope = {}) => this.evaluateCondition(
            filterExpressionValue,
            Object.assign(createScope(context), scope),
          ),
          resolveExpression: (filterExpressionValue, scope = {}, filterOptions = {}) => this.resolveExpression(
            filterExpressionValue,
            Object.assign(createScope(context), scope),
            filterOptions,
          ),
        },
        [unwrapHtmlValue(value), ...argumentsList],
      );
    }

    return value ?? EMPTY_STRING;
  }

  resolveValue(expression, context = {}) {
    return this.resolveExpression(expression, context);
  }

  resolveArgument(expression, context = {}) {
    return this.resolveExpression(expression, context, { applyFilters: false });
  }

  async parseLiteralExpressionAsync(expression, context = {}, execution = null) {
    const normalizedExpression = expression.trim();

    if (normalizedExpression.startsWith("[") && normalizedExpression.endsWith("]")) {
      const inner = normalizedExpression.slice(1, -1).trim();
      if (!inner) {
        return [];
      }

      const output = [];
      for (const item of tokenize(inner, ",").filter(Boolean)) {
        output.push(await this.resolveExpressionAsync(item, context, execution, { applyFilters: false }));
      }
      return output;
    }

    if (normalizedExpression.startsWith("{") && normalizedExpression.endsWith("}")) {
      const inner = normalizedExpression.slice(1, -1).trim();
      if (!inner) {
        return {};
      }

      const output = {};
      for (const entry of tokenize(inner, ",").filter(Boolean)) {
        const [rawKey, rawValue] = splitFilterNameAndArguments(entry);
        if (!rawKey || !rawValue) {
          continue;
        }

        output[normalizeLiteralKey(rawKey)] = await this.resolveExpressionAsync(
          rawValue,
          context,
          execution,
          { applyFilters: false },
        );
      }

      return output;
    }

    return null;
  }

  async resolveRootValue(root, context = {}, execution = null, expression = EMPTY_STRING) {
    if (hasOwnContextValue(context, root)) {
      return {
        value: context[root],
        root: null,
        handler: null,
      };
    }

    const handler = execution?.registry?.get(root) || null;
    if (handler) {
      if (!execution.rootMemo.has(root)) {
        execution.rootMemo.set(
          root,
          Promise.resolve(handler.node ? handler.node({
            root,
            input: execution.input,
            expression,
            signal: execution.signal,
          }) : undefined),
        );
      }

      const value = await execution.rootMemo.get(root);
      if (value !== UNHANDLED) {
        return {
          value,
          root,
          handler,
        };
      }
    }

    if (hasContextValue(context, root)) {
      return {
        value: context[root],
        root: null,
        handler: null,
      };
    }

    return {
      value: undefined,
      root: handler ? root : null,
      handler,
    };
  }

  async resolvePathExpressionAsync(expression, context = {}, execution = null) {
    const path = parsePathSegments(expression);
    if (path.length === 0) {
      return {
        value: undefined,
        root: null,
        path,
      };
    }

    const [rootToken, ...rest] = path;
    const resolvedRoot = await this.resolveRootValue(rootToken, context, execution, expression);
    let value = resolvedRoot.value;

    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index];

      if (resolvedRoot.handler?.get && resolvedRoot.root) {
        const trapped = await resolvedRoot.handler.get(
          value,
          token,
          {
            root: resolvedRoot.root,
            input: execution?.input || new Response(EMPTY_STRING),
            expression,
            path,
            index: index + 1,
            signal: execution?.signal || null,
          },
        );

        if (trapped !== UNHANDLED) {
          value = trapped;
          continue;
        }
      }

      value = resolvePathValue(value, token);
    }

    return {
      value,
      root: resolvedRoot.root,
      path,
    };
  }

  async resolveComparisonValueAsync(expression, context = {}, execution = null) {
    return unwrapHtmlValue(await this.resolveValueAsync(expression, context, execution));
  }

  async resolveBaseExpressionAsync(expression, context = {}, execution = null) {
    const normalizedExpression = String(expression ?? EMPTY_STRING).trim();

    if (!normalizedExpression) {
      return {
        value: EMPTY_STRING,
        root: null,
        path: [],
      };
    }

    const range = splitRangeExpression(normalizedExpression);
    if (range) {
      const start = Number(await this.resolveExpressionAsync(range.start, context, execution, { applyFilters: false }));
      const end = Number(await this.resolveExpressionAsync(range.end, context, execution, { applyFilters: false }));

      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        return {
          value: [],
          root: null,
          path: [],
        };
      }

      const step = start <= end ? 1 : -1;
      const output = [];

      for (let value = start; step > 0 ? value <= end : value >= end; value += step) {
        output.push(value);
      }

      return {
        value: output,
        root: null,
        path: [],
      };
    }

    const literal = await this.parseLiteralExpressionAsync(normalizedExpression, context, execution);
    if (literal !== null) {
      return {
        value: literal,
        root: null,
        path: [],
      };
    }

    if (
      (normalizedExpression.startsWith('"') && normalizedExpression.endsWith('"')) ||
      (normalizedExpression.startsWith("'") && normalizedExpression.endsWith("'"))
    ) {
      return {
        value: normalizedExpression.slice(1, -1),
        root: null,
        path: [],
      };
    }

    if (normalizedExpression.startsWith('"') || normalizedExpression.startsWith("'")) {
      return {
        value: normalizedExpression.slice(1),
        root: null,
        path: [],
      };
    }

    if (normalizedExpression === "true") {
      return {
        value: true,
        root: null,
        path: [],
      };
    }

    if (normalizedExpression === "false") {
      return {
        value: false,
        root: null,
        path: [],
      };
    }

    if (normalizedExpression === "null" || normalizedExpression === "nil") {
      return {
        value: null,
        root: null,
        path: [],
      };
    }

    if (NUMBER_PATTERN.test(normalizedExpression)) {
      return {
        value: Number(normalizedExpression),
        root: null,
        path: [],
      };
    }

    return this.resolvePathExpressionAsync(normalizedExpression, context, execution);
  }

  async resolveExpressionAsync(expression, context = {}, execution = null, options = {}) {
    const { applyFilters = true } = options;
    const normalizedExpression = String(expression ?? EMPTY_STRING).trim();

    if (!applyFilters) {
      if (!normalizedExpression) {
        return EMPTY_STRING;
      }

      const resolved = await this.resolveBaseExpressionAsync(normalizedExpression, context, execution);
      return resolved.value;
    }

    const [base, ...filterExpressions] = splitFilterSegments(normalizedExpression);
    const baseResolution = await this.resolveBaseExpressionAsync(base, context, execution);
    let value = baseResolution.value;

    for (const filterExpression of filterExpressions) {
      const [filterName, rawArguments = EMPTY_STRING] = splitFilterNameAndArguments(filterExpression);
      const argumentsList = [];

      for (const argument of splitFilterArguments(rawArguments)) {
        argumentsList.push(
          unwrapHtmlValue(await this.resolveExpressionAsync(argument, context, execution, { applyFilters: false })),
        );
      }

      if (baseResolution.root) {
        const handler = execution?.registry?.get(baseResolution.root);
        if (handler?.filter) {
          const trapped = await handler.filter(
            value,
            filterName,
            argumentsList,
            {
              root: baseResolution.root,
              input: execution?.input || new Response(EMPTY_STRING),
              expression: normalizedExpression,
              path: baseResolution.path,
              signal: execution?.signal || null,
            },
          );

          if (trapped !== UNHANDLED) {
            value = trapped;
            continue;
          }
        }
      }

      const filter = this.filters[filterName];
      if (typeof filter !== "function") {
        continue;
      }

      value = await filter.apply(
        createAsyncFilterContext(this, context, execution),
        [unwrapHtmlValue(value), ...argumentsList],
      );
    }

    return value ?? EMPTY_STRING;
  }

  async resolveValueAsync(expression, context = {}, execution = null) {
    return this.resolveExpressionAsync(expression, context, execution);
  }

  async resolveArgumentAsync(expression, context = {}, execution = null) {
    return this.resolveExpressionAsync(expression, context, execution, { applyFilters: false });
  }

  async renderPartial(partialExpression, handler, mode) {
    const partial = parsePartialExpression(partialExpression);
    const snippetValue = await this.resolveArgumentAsync(
      partial.snippetExpression,
      handler.currentContext,
      handler.execution,
    );
    const rawExpression = String(partial.snippetExpression ?? EMPTY_STRING).trim();
    const resolvedName = String(snippetValue ?? EMPTY_STRING);
    const isUnquotedLiteralPath =
      !resolvedName &&
      rawExpression &&
      !rawExpression.startsWith('"') &&
      !rawExpression.startsWith("'") &&
      (rawExpression.includes(".") || rawExpression.includes("/"));
    const snippetName = isUnquotedLiteralPath ? rawExpression : resolvedName;
    const nextDepth = handler.renderDepth + 1;

    if (nextDepth > 10) {
      throw new Error("Max render depth exceeded");
    }

    const request = new Request(new URL(snippetName || EMPTY_STRING, "https://liquid.local/"));
    const response = await this.fetch?.(request);
    if (!response?.ok) {
      return EMPTY_STRING;
    }

    const template = await response.text();
    const scope = mode === "render"
      ? createScope(null)
      : createScope(handler.currentContext);

    for (const argument of partial.argumentsList) {
      scope[argument.name] = await this.resolveValueAsync(
        argument.valueExpression,
        handler.currentContext,
        handler.execution,
      );
    }

    return await this.renderFragment(template, scope, handler.runtime, nextDepth, handler.execution);
  }

  evaluateCondition(condition, context = {}) {
    const orParts = tokenize(condition.trim(), " or ");
    if (orParts.length > 1) {
      return orParts.some((part) => this.evaluateCondition(part, context));
    }

    const andParts = tokenize(condition.trim(), " and ");
    if (andParts.length > 1) {
      return andParts.every((part) => this.evaluateCondition(part, context));
    }

    const containsIndex = findTopLevelOperator(condition, " contains ");
    if (containsIndex !== -1) {
      const left = this.resolveComparisonValue(condition.slice(0, containsIndex).trim(), context);
      const right = this.resolveComparisonValue(condition.slice(containsIndex + 10).trim(), context);
      return Array.isArray(left) ? left.includes(right) : String(left ?? EMPTY_STRING).includes(String(right ?? EMPTY_STRING));
    }

    for (const operator of COMPARISON_OPERATORS) {
      const index = findTopLevelOperator(condition, operator);
      if (index === -1) {
        continue;
      }

      const left = this.resolveComparisonValue(condition.slice(0, index).trim(), context);
      const right = this.resolveComparisonValue(condition.slice(index + operator.length).trim(), context);

      if (operator === "==") {
        return left === right;
      }

      if (operator === "!=") {
        return left !== right;
      }

      if (operator === ">=") {
        return left >= right;
      }

      if (operator === "<=") {
        return left <= right;
      }

      if (operator === ">") {
        return left > right;
      }

      if (operator === "<") {
        return left < right;
      }
    }

    return isLiquidTruthy(this.resolveComparisonValue(condition.trim(), context));
  }

  async evaluateConditionAsync(condition, context = {}, execution = null) {
    const orParts = tokenize(condition.trim(), " or ");
    if (orParts.length > 1) {
      for (const part of orParts) {
        if (await this.evaluateConditionAsync(part, context, execution)) {
          return true;
        }
      }
      return false;
    }

    const andParts = tokenize(condition.trim(), " and ");
    if (andParts.length > 1) {
      for (const part of andParts) {
        if (!(await this.evaluateConditionAsync(part, context, execution))) {
          return false;
        }
      }
      return true;
    }

    const containsIndex = findTopLevelOperator(condition, " contains ");
    if (containsIndex !== -1) {
      const left = await this.resolveComparisonValueAsync(condition.slice(0, containsIndex).trim(), context, execution);
      const right = await this.resolveComparisonValueAsync(condition.slice(containsIndex + 10).trim(), context, execution);
      return Array.isArray(left) ? left.includes(right) : String(left ?? EMPTY_STRING).includes(String(right ?? EMPTY_STRING));
    }

    for (const operator of COMPARISON_OPERATORS) {
      const index = findTopLevelOperator(condition, operator);
      if (index === -1) {
        continue;
      }

      const left = await this.resolveComparisonValueAsync(condition.slice(0, index).trim(), context, execution);
      const right = await this.resolveComparisonValueAsync(condition.slice(index + operator.length).trim(), context, execution);

      if (operator === "==") {
        return left === right;
      }

      if (operator === "!=") {
        return left !== right;
      }

      if (operator === ">=") {
        return left >= right;
      }

      if (operator === "<=") {
        return left <= right;
      }

      if (operator === ">") {
        return left > right;
      }

      if (operator === "<") {
        return left < right;
      }
    }

    return isLiquidTruthy(await this.resolveComparisonValueAsync(condition.trim(), context, execution));
  }

  resolveForCollection(loop, context = {}) {
    const source = this.resolveValue(loop?.collectionPath, context);
    let collection = Array.isArray(source)
      ? [...source]
      : typeof source === "string"
        ? [...source]
        : [];

    const offset = Number(loop?.offsetExpression ? this.resolveValue(loop.offsetExpression, context) : 0);
    const limit = Number(loop?.limitExpression ? this.resolveValue(loop.limitExpression, context) : collection.length);

    if (!Number.isNaN(offset) && offset > 0) {
      collection = collection.slice(offset);
    }

    if (!Number.isNaN(limit) && limit >= 0) {
      collection = collection.slice(0, limit);
    }

    if (loop?.reversed) {
      collection.reverse();
    }

    return collection;
  }

  async resolveForCollectionAsync(loop, context = {}, execution = null) {
    const source = await this.resolveValueAsync(loop?.collectionPath, context, execution);
    let collection = Array.isArray(source)
      ? [...source]
      : typeof source === "string"
        ? [...source]
        : [];

    const offset = Number(loop?.offsetExpression ? await this.resolveValueAsync(loop.offsetExpression, context, execution) : 0);
    const limit = Number(loop?.limitExpression ? await this.resolveValueAsync(loop.limitExpression, context, execution) : collection.length);

    if (!Number.isNaN(offset) && offset > 0) {
      collection = collection.slice(offset);
    }

    if (!Number.isNaN(limit) && limit >= 0) {
      collection = collection.slice(0, limit);
    }

    if (loop?.reversed) {
      collection.reverse();
    }

    return collection;
  }

  async processText(text, handler) {
    if (handler.state === STATE_SKIP) {
      return this.processSkipText(text, handler);
    }

    if (handler.state === STATE_RAW) {
      return this.processRawText(text, handler);
    }

    if (handler.state === STATE_CAPTURE) {
      return this.processCaptureText(text, handler);
    }

    return this.processEmitText(text, handler);
  }

  async processEmitText(text, handler) {
    const output = [];
    let cursor = 0;

    while (cursor < text.length) {
      const marker = getNextLiquidMarker(text, cursor);
      if (marker === -1) {
        output.push(text.slice(cursor));
        break;
      }

      if (text.startsWith(VARIABLE_OPEN, marker)) {
        const variable = readLiquidTag(text, marker, VARIABLE_OPEN, VARIABLE_CLOSE);
        const leadingText = text.slice(cursor, marker);
        output.push(variable?.trimLeft ? trimTrailingWhitespace(leadingText) : leadingText);
        if (!variable) {
          output.push(text.slice(marker));
          break;
        }

        output.push(this.renderResolvedValue(
          await this.resolveValueAsync(variable.content, handler.currentContext, handler.execution),
        ));
        cursor = variable.trimRight ? skipLeadingWhitespace(text, variable.endIndex) : variable.endIndex;
        continue;
      }

      const block = readLiquidTag(text, marker, BLOCK_OPEN, BLOCK_CLOSE);
      const leadingText = text.slice(cursor, marker);
      output.push(block?.trimLeft ? trimTrailingWhitespace(leadingText) : leadingText);
      if (!block) {
        output.push(text.slice(marker));
        break;
      }

      cursor = block.trimRight ? skipLeadingWhitespace(text, block.endIndex) : block.endIndex;
      const { name, expression } = parseTagInvocation(block.content);
      const tag = this.tags[name];
      if (!tag) {
        continue;
      }

      const ctx = createTagContext(this, tag, expression, handler, block);
      const tagResult = await tag.onEmit(ctx);
      const signal = normalizeLegacyTagResult(tagResult);

      applySignal(signal, handler);

      if (signal.action === "OUTPUT") {
        output.push(
          signal.html
            ? String(signal.output ?? EMPTY_STRING)
            : this.renderResolvedValue(signal.output),
        );
        continue;
      }

      if (signal.action === "SKIP" || signal.action === "CAPTURE" || signal.action === "RAW") {
        output.push(await this.processText(text.slice(cursor), handler));
        return output.join(EMPTY_STRING);
      }

      if (signal.action === "BREAK") {
        return output.join(EMPTY_STRING);
      }
    }

    return output.join(EMPTY_STRING);
  }

  async processSkipText(text, handler) {
    let cursor = 0;

    while (cursor < text.length) {
      const marker = text.indexOf(BLOCK_OPEN, cursor);
      if (marker === -1) {
        return EMPTY_STRING;
      }

      const block = readLiquidTag(text, marker, BLOCK_OPEN, BLOCK_CLOSE);
      if (!block) {
        return EMPTY_STRING;
      }

      cursor = block.endIndex;
      const { name, expression } = parseTagInvocation(block.content);
      const tag = this.tags[name];
      if (!tag?.onSkip) {
        continue;
      }

      const ctx = createTagContext(this, tag, expression, handler, block);
      const signal = await tag.onSkip(ctx);
      if (!signal) {
        continue;
      }

      applySignal(signal, handler);

      if (signal.action === "NEST") {
        continue;
      }

      if (signal.action === "RESUME_EMIT") {
        const resumeCursor = getResumeCursor(text, cursor, block);
        return this.processEmitText(text.slice(resumeCursor), handler);
      }

      if (signal.action === "BREAK") {
        return EMPTY_STRING;
      }
    }

    return EMPTY_STRING;
  }

  async processRawText(text, handler) {
    let cursor = 0;

    while (cursor < text.length) {
      const marker = text.indexOf(BLOCK_OPEN, cursor);
      if (marker === -1) {
        appendRawPart(handler.raw, text.slice(cursor));
        return EMPTY_STRING;
      }

      appendRawPart(handler.raw, text.slice(cursor, marker));
      const block = readLiquidTag(text, marker, BLOCK_OPEN, BLOCK_CLOSE);
      if (!block) {
        appendRawPart(handler.raw, text.slice(marker));
        return EMPTY_STRING;
      }

      cursor = block.endIndex;

      if (block.content === "endraw") {
        if (block.trimLeft) {
          trimBufferedTrailingWhitespace(handler.raw.bufferParts);
        }

        const rawContent = handler.raw.bufferParts.join(EMPTY_STRING);
        handler.state = STATE_EMIT;
        handler.raw = null;
        return rawContent + await this.processEmitText(
          text.slice(getResumeCursor(text, cursor, block)),
          handler,
        );
      }

      appendRawPart(handler.raw, block.raw);
    }

    return EMPTY_STRING;
  }

  async processCaptureText(text, handler) {
    let cursor = 0;

    while (cursor < text.length) {
      const marker = text.indexOf(BLOCK_OPEN, cursor);
      if (marker === -1) {
        appendCapturePart(handler.capture, text.slice(cursor));
        return EMPTY_STRING;
      }

      appendCapturePart(handler.capture, text.slice(cursor, marker));
      const block = readLiquidTag(text, marker, BLOCK_OPEN, BLOCK_CLOSE);
      if (!block) {
        appendCapturePart(handler.capture, text.slice(marker));
        return EMPTY_STRING;
      }

      cursor = block.endIndex;

      if (
        (handler.capture.mode === "for" && block.content.startsWith("for ")) ||
        (handler.capture.mode === "capture" && block.content.startsWith("capture "))
      ) {
        handler.capture.depth += 1;
        appendCapturePart(handler.capture, block.raw);
        continue;
      }

      if (
        (handler.capture.mode === "for" && block.content === "endfor") ||
        (handler.capture.mode === "capture" && block.content === "endcapture")
      ) {
        if (handler.capture.depth > 0) {
          handler.capture.depth -= 1;
          appendCapturePart(handler.capture, block.raw);
          continue;
        }

        if (block.trimLeft) {
          trimBufferedTrailingWhitespace(handler.capture.bufferParts);
        }

        const rendered = await this.renderCapture(handler);
        handler.state = STATE_EMIT;
        handler.capture = null;
        return rendered + await this.processEmitText(text.slice(getResumeCursor(text, cursor, block)), handler);
      }

      appendCapturePart(handler.capture, block.raw);
    }

    return EMPTY_STRING;
  }

  async renderCapture(handler) {
    return renderCapture(this, handler);
  }

  async renderFragment(fragment, context = {}, runtime = createRuntime(), renderDepth = 0, execution = null) {
    const handler = createHandlerState(createRenderScope(context), {
      runtime,
      renderDepth,
      execution,
    });
    return await this.processText(fragment, handler);
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

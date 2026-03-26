import { HTMLRewriter as DefaultHTMLRewriter } from "@sntran/html-rewriter";
import * as filters from "./filters/index.js";
import { parsePartialExpression } from "./tags/file.js";
import { renderCapture } from "./tags/iteration.js";
import { coreTags } from "./tags/index.js";
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
  skipLeadingWhitespace,
  splitFilterArguments,
  splitFilterNameAndArguments,
  splitFilterSegments,
  splitRangeExpression,
  tokenize,
  trimBufferedTrailingWhitespace,
  trimTrailingWhitespace,
  unwrapHtmlValue,
  serializeEndTag,
  serializeStartTag,
} from "./utils.js";

const STATE_EMIT = "EMIT";
const STATE_SKIP = "SKIP";
const STATE_CAPTURE = "CAPTURE";
const STATE_RAW = "RAW";
const FILTERS = { ...filters };

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
    evaluate: (condition, scope = {}) => engine.evaluateCondition(
      condition,
      Object.assign(createScope(handler.currentContext), scope),
    ),
    resolveValue: (valueExpression, context = handler.currentContext) => engine.resolveValue(valueExpression, context),
    resolveForCollection: (loop, context = handler.currentContext) => engine.resolveForCollection(loop, context),
    renderPartial: (partialExpression, currentHandler = handler, mode) => engine.renderPartial(partialExpression, currentHandler, mode),
    resolveArgument: (argument, scope = {}) => engine.resolveExpression(
      argument,
      Object.assign(createScope(handler.currentContext), scope),
      { applyFilters: false },
    ),
    resolveExpression: (argument, scopeOrOptions = {}, maybeOptions = {}) => {
      const { scope, options } = resolveScopeArgs(handler.currentContext, scopeOrOptions, maybeOptions);
      return engine.resolveExpression(
        argument,
        Object.assign(createScope(handler.currentContext), scope),
        options,
      );
    },
  };
}

export class Liquid {
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
  }

  registerFilter(name, filter) {
    this.filters[name] = filter;
  }

  registerTag(name, tagDefinition) {
    this.tags[name] = normalizeTagDefinition(name, tagDefinition);
  }

  plugin(plugin) {
    if (typeof plugin === "function") {
      plugin.call(this, this.constructor);
    }

    return this;
  }

  createHandler(context = {}) {
    const handler = createHandlerState(createScope(context), {
      runtime: createRuntime(),
      renderDepth: 0,
    });

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
        );
      },

      text: async (chunk) => {
        handler.textBufferParts.push(chunk.text);
        handler.inLiquidTag = hasIncompleteLiquidTag(handler.textBufferParts.join(EMPTY_STRING));

        if (!chunk.lastInTextNode) {
          chunk.replace(EMPTY_STRING);
          return;
        }

        if (
          handler.inLiquidTag &&
          chunk.text === EMPTY_STRING &&
          hasQuotedIncompleteLiquidTag(handler.textBufferParts.join(EMPTY_STRING))
        ) {
          chunk.replace(EMPTY_STRING);
          return;
        }

        const text = handler.textBufferParts.join(EMPTY_STRING);
        handler.textBufferParts.length = 0;
        handler.inLiquidTag = false;
        const output = await this.processText(text, handler);
        chunk.replace(output, { html: true });
      },
    };
  }

  async parseAndRender(html = EMPTY_STRING, context = {}) {
    const HTMLRewriterClass = this.HTMLRewriterClass || DefaultHTMLRewriter;
    const rewriter = new HTMLRewriterClass();
    const handler = this.createHandler(context);

    rewriter.on("*", { element: handler.element });
    rewriter.onDocument({ text: handler.text });

    return rewriter.transform(new Response(html)).text();
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

  async interpolateAttributes(element, context = {}, runtime = createRuntime(), renderDepth = 0) {
    const attributes = [...element.attributes];

    for (const [name, value] of attributes) {
      if (value.indexOf(VARIABLE_OPEN) === -1 && value.indexOf(BLOCK_OPEN) === -1) {
        continue;
      }

      element.setAttribute(name, await this.renderFragment(value, context, runtime, renderDepth));
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

    const [base, ...filters] = splitFilterSegments(normalizedExpression);
    let value = this.resolveExpression(base, context, { applyFilters: false });

    for (const filterExpression of filters) {
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
          evaluate: (expression, scope = {}) => this.evaluateCondition(
            expression,
            Object.assign(createScope(context), scope),
          ),
          resolveExpression: (expression, scope = {}, options = {}) => this.resolveExpression(
            expression,
            Object.assign(createScope(context), scope),
            options,
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

  async renderPartial(partialExpression, handler, mode) {
    const partial = parsePartialExpression(partialExpression);
    const snippetValue = this.resolveArgument(partial.snippetExpression, handler.currentContext);
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
      scope[argument.name] = this.resolveValue(argument.valueExpression, handler.currentContext);
    }

    return await this.renderFragment(template, scope, handler.runtime, nextDepth);
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

        output.push(this.renderResolvedValue(this.resolveValue(variable.content, handler.currentContext)));
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

  processSkipText(text, handler) {
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
      const signal = tag.onSkip(ctx);
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

  async renderFragment(fragment, context = {}, runtime = createRuntime(), renderDepth = 0) {
    const handler = createHandlerState(createScope(context), {
      runtime,
      renderDepth,
    });
    return await this.processText(fragment, handler);
  }
}

export const __private__ = {
  isLiquidTruthy,
  resolvePathValue,
  splitTopLevel: tokenize,
  tokenize,
};

export default Liquid;

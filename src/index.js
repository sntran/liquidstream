import { HTMLRewriter as DefaultHTMLRewriter } from "@sntran/html-rewriter";
import * as filters from "./filters/index.js";

const STATE_EMIT = "EMIT";
const STATE_SKIP = "SKIP";
const STATE_CAPTURE = "CAPTURE";
const STATE_RAW = "RAW";

const NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/;
const RANGE_PATTERN = /^\((.+)\.\.(.+)\)$/;
const VARIABLE_OPEN = "{{";
const VARIABLE_CLOSE = "}}";
const BLOCK_OPEN = "{%";
const BLOCK_CLOSE = "%}";
const EMPTY_STRING = "";
const HTML_VALUE = "_h";
const WHITESPACE_CHARACTERS = new Set([" ", "\n", "\r", "\t", "\f"]);
const COMPARISON_OPERATORS = [">=", "<=", "!=", "==", ">", "<"];
const NAME_PATTERN = /^\w+$/;
const FILTERS = { ...filters };

function escapeHtml(value = EMPTY_STRING) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value = EMPTY_STRING) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;");
}

function unwrapHtmlValue(value) {
  return value && typeof value === "object" && value[HTML_VALUE] ? value.value : value;
}

function createScope(parent = null) {
  return Object.create(parent && typeof parent === "object" ? parent : null);
}

function parseForExpression(expression = EMPTY_STRING) {
  const tokens = tokenize(expression, " ").filter(Boolean);
  if (tokens.length < 4 || tokens[0] !== "for" || tokens[2] !== "in" || !NAME_PATTERN.test(tokens[1])) {
    return null;
  }

  const collectionTokens = [];
  let limitExpression = null;
  let offsetExpression = null;
  let reversed = false;

  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === "reversed") {
      reversed = true;
      continue;
    }

    if (token.startsWith("limit:")) {
      limitExpression = token.slice(6).trim();
      continue;
    }

    if (token.startsWith("offset:")) {
      offsetExpression = token.slice(7).trim();
      continue;
    }

    collectionTokens.push(token);
  }

  return {
    itemName: tokens[1],
    collectionPath: collectionTokens.join(" ").trim(),
    limitExpression,
    offsetExpression,
    reversed,
  };
}

function parseAssignExpression(expression = EMPTY_STRING) {
  const [left, ...rest] = tokenize(expression, "=");
  const valueExpression = rest.join("=").trim();
  const tokens = tokenize(left || EMPTY_STRING, " ").filter(Boolean);
  if (tokens[0] !== "assign" || tokens.length !== 2 || !valueExpression || !NAME_PATTERN.test(tokens[1])) {
    return null;
  }

  return {
    variableName: tokens[1],
    valueExpression,
  };
}

function parseCaptureExpression(expression = EMPTY_STRING) {
  const tokens = tokenize(expression, " ").filter(Boolean);
  if (tokens[0] !== "capture" || tokens.length !== 2 || !NAME_PATTERN.test(tokens[1])) {
    return null;
  }

  return {
    variableName: tokens[1],
  };
}

function parseCounterExpression(expression = EMPTY_STRING) {
  const tokens = tokenize(expression, " ").filter(Boolean);
  if (
    tokens.length !== 2 ||
    (tokens[0] !== "increment" && tokens[0] !== "decrement") ||
    !NAME_PATTERN.test(tokens[1])
  ) {
    return null;
  }

  return {
    operation: tokens[0],
    variableName: tokens[1],
  };
}

function parseNamedArgument(expression = EMPTY_STRING) {
  const [name, valueExpression] = splitFilterNameAndArguments(expression);
  if (!name || !valueExpression) {
    return null;
  }

  return {
    name,
    valueExpression,
  };
}

function parsePartialExpression(expression = EMPTY_STRING) {
  const segments = tokenize(expression, ",").filter(Boolean);
  if (segments.length === 0) {
    return {
      snippetExpression: EMPTY_STRING,
      argumentsList: [],
    };
  }

  return {
    snippetExpression: segments[0],
    argumentsList: segments.slice(1)
      .map((segment) => parseNamedArgument(segment))
      .filter(Boolean),
  };
}

function getNextLiquidMarker(text, startIndex) {
  const nextVariable = text.indexOf(VARIABLE_OPEN, startIndex);
  const nextBlock = text.indexOf(BLOCK_OPEN, startIndex);

  if (nextVariable === -1) {
    return nextBlock;
  }

  if (nextBlock === -1) {
    return nextVariable;
  }

  return nextVariable < nextBlock ? nextVariable : nextBlock;
}

function readLiquidTag(text, startIndex, openToken, closeToken) {
  let contentStart = startIndex + openToken.length;
  let trimLeft = false;

  if (text[contentStart] === "-") {
    trimLeft = true;
    contentStart += 1;
  }

  const closeIndex = text.indexOf(closeToken, contentStart);
  if (closeIndex === -1) {
    return null;
  }

  const trimRight = text[closeIndex - 1] === "-";
  const contentEnd = trimRight ? closeIndex - 1 : closeIndex;

  return {
    raw: text.slice(startIndex, closeIndex + closeToken.length),
    content: text.slice(contentStart, contentEnd).trim(),
    endIndex: closeIndex + closeToken.length,
    trimLeft,
    trimRight,
  };
}

function hasIncompleteLiquidTag(text = EMPTY_STRING) {
  let cursor = 0;

  while (cursor < text.length) {
    const marker = getNextLiquidMarker(text, cursor);
    if (marker === -1) {
      return false;
    }

    const isVariable = text.startsWith(VARIABLE_OPEN, marker);
    const tag = readLiquidTag(
      text,
      marker,
      isVariable ? VARIABLE_OPEN : BLOCK_OPEN,
      isVariable ? VARIABLE_CLOSE : BLOCK_CLOSE,
    );

    if (!tag) {
      return true;
    }

    cursor = tag.endIndex;
  }

  return false;
}

function hasQuotedIncompleteLiquidTag(text = EMPTY_STRING) {
  const marker = getNextLiquidMarker(text, 0);
  if (marker === -1) {
    return false;
  }

  const startIndex = text.lastIndexOf(VARIABLE_OPEN) > text.lastIndexOf(BLOCK_OPEN)
    ? text.lastIndexOf(VARIABLE_OPEN)
    : text.lastIndexOf(BLOCK_OPEN);
  const fragment = startIndex === -1 ? text : text.slice(startIndex);
  let quote = null;

  for (let index = 0; index < fragment.length; index += 1) {
    const char = fragment[index];
    if ((char === '"' || char === "'") && !isEscaped(fragment, index) && (!quote || quote === char)) {
      quote = quote === char ? null : char;
    }
  }

  return Boolean(quote);
}

function serializeStartTag(element) {
  const attributes = [...element.attributes]
    .map(([name, value]) => (!value ? name : `${name}="${escapeAttribute(value)}"`))
    .join(" ");

  return attributes ? `<${element.tagName} ${attributes}>` : `<${element.tagName}>`;
}

function serializeEndTag(tagName) {
  return `</${tagName}>`;
}

function isEscaped(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function updateScanState(state, text, index) {
  const char = text[index];

  if ((char === '"' || char === "'") && !isEscaped(text, index) && (!state.quote || state.quote === char)) {
    state.quote = state.quote === char ? null : char;
    return;
  }

  if (state.quote) {
    return;
  }

  if (char === "(") {
    state.parenDepth += 1;
  } else if (char === ")") {
    state.parenDepth = Math.max(0, state.parenDepth - 1);
  } else if (char === "[") {
    state.squareDepth += 1;
  } else if (char === "]") {
    state.squareDepth = Math.max(0, state.squareDepth - 1);
  } else if (char === "{") {
    state.curlyDepth += 1;
  } else if (char === "}") {
    state.curlyDepth = Math.max(0, state.curlyDepth - 1);
  }
}

function isTopLevel(state) {
  return !state.quote && state.parenDepth === 0 && state.squareDepth === 0 && state.curlyDepth === 0;
}

function tokenize(expression = EMPTY_STRING, separator) {
  const parts = [];
  let current = EMPTY_STRING;
  const state = {
    quote: null,
    parenDepth: 0,
    squareDepth: 0,
    curlyDepth: 0,
  };

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];

    if (isTopLevel(state) && expression.startsWith(separator, index)) {
      parts.push(current.trim());
      current = EMPTY_STRING;
      index += separator.length - 1;
      continue;
    }

    current += char;
    updateScanState(state, expression, index);
  }

  parts.push(current.trim());
  return parts;
}

function findTopLevelOperator(expression = EMPTY_STRING, operator) {
  const state = {
    quote: null,
    parenDepth: 0,
    squareDepth: 0,
    curlyDepth: 0,
  };

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];

    if (isTopLevel(state) && expression.startsWith(operator, index)) {
      return index;
    }

    updateScanState(state, expression, index);
  }

  return -1;
}

function splitFilterSegments(expression = EMPTY_STRING) {
  return tokenize(expression, "|");
}

function splitFilterArguments(expression = EMPTY_STRING) {
  return tokenize(expression, ",").filter(Boolean);
}

function splitFilterNameAndArguments(expression = EMPTY_STRING) {
  let quote = null;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];

    if ((char === '"' || char === "'") && !isEscaped(expression, index) && (!quote || quote === char)) {
      quote = quote === char ? null : char;
      continue;
    }

    if (char === ":" && !quote) {
      return [expression.slice(0, index).trim(), expression.slice(index + 1).trim()];
    }
  }

  return [expression.trim(), EMPTY_STRING];
}

function splitRangeExpression(expression = EMPTY_STRING) {
  const match = RANGE_PATTERN.exec(expression.trim());
  if (!match) {
    return null;
  }

  return {
    start: match[1].trim(),
    end: match[2].trim(),
  };
}

function normalizeLiteralKey(key = EMPTY_STRING) {
  const trimmed = key.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function skipLeadingWhitespace(text, index) {
  let cursor = index;

  while (cursor < text.length && WHITESPACE_CHARACTERS.has(text[cursor])) {
    cursor += 1;
  }

  return cursor;
}

function trimTrailingWhitespace(text) {
  let cursor = text.length;

  while (cursor > 0 && WHITESPACE_CHARACTERS.has(text[cursor - 1])) {
    cursor -= 1;
  }

  return text.slice(0, cursor);
}

function parsePathSegments(expression = EMPTY_STRING) {
  const segments = [];
  let current = EMPTY_STRING;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];

    if (char === ".") {
      if (current) {
        segments.push(current);
        current = EMPTY_STRING;
      }
      continue;
    }

    if (char === "[") {
      if (current) {
        segments.push(current);
        current = EMPTY_STRING;
      }

      let quote = null;
      let bracketContent = EMPTY_STRING;
      let cursor = index + 1;

      while (cursor < expression.length) {
        const bracketChar = expression[cursor];

        if ((bracketChar === '"' || bracketChar === "'") && (!quote || quote === bracketChar)) {
          quote = quote === bracketChar ? null : bracketChar;
          bracketContent += bracketChar;
          cursor += 1;
          continue;
        }

        if (bracketChar === "]" && !quote) {
          break;
        }

        bracketContent += bracketChar;
        cursor += 1;
      }

      if (cursor >= expression.length) {
        return [expression];
      }

      const trimmed = bracketContent.trim();
      if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ) {
        segments.push(trimmed.slice(1, -1));
      } else if (NUMBER_PATTERN.test(trimmed)) {
        segments.push(Number(trimmed));
      } else if (trimmed) {
        segments.push(trimmed);
      }

      index = cursor;
      continue;
    }

    current += char;
  }

  if (current) {
    segments.push(current);
  }

  return segments;
}

function resolvePathValue(value, segment) {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (segment === "first" && (Array.isArray(value) || typeof value === "string")) {
    return value[0];
  }

  if (segment === "last" && (Array.isArray(value) || typeof value === "string")) {
    return value.length ? value[value.length - 1] : undefined;
  }

  return value?.[segment];
}

function isLiquidTruthy(value) {
  return value !== false && value !== null && value !== undefined;
}

function parseTagInvocation(content = EMPTY_STRING) {
  const separator = content.indexOf(" ");
  if (separator === -1) {
    return {
      name: content.trim(),
      expression: EMPTY_STRING,
    };
  }

  return {
    name: content.slice(0, separator).trim(),
    expression: content.slice(separator + 1).trim(),
  };
}

async function defaultYieldControl() {
  if (globalThis.scheduler && typeof globalThis.scheduler.yield === "function") {
    await globalThis.scheduler.yield();
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createRuntime() {
  return {
    counters: Object.create(null),
  };
}

function createHandlerState(scope, options = {}) {
  return {
    state: STATE_EMIT,
    currentContext: scope,
    textBufferParts: [],
    inLiquidTag: false,
    ifStack: [],
    skipDepth: 0,
    skipMode: null,
    capture: null,
    raw: null,
    runtime: options.runtime || createRuntime(),
    renderDepth: options.renderDepth || 0,
  };
}

function createCaptureState(mode, options = {}) {
  return {
    mode,
    itemName: options.itemName || null,
    collection: options.collection || null,
    variableName: options.variableName || null,
    depth: 0,
    bufferParts: [],
  };
}

function appendCapturePart(capture, value) {
  if (value) {
    capture.bufferParts.push(value);
  }
}

function createRawState() {
  return {
    bufferParts: [],
  };
}

function appendRawPart(raw, value) {
  if (value) {
    raw.bufferParts.push(value);
  }
}

function createConditionalFrame(truthy, currentContext) {
  return {
    type: "if",
    truthy,
    parentContext: currentContext,
    branchContext: createScope(currentContext),
  };
}

function createCaseFrame(switchValue, currentContext) {
  return {
    type: "case",
    switchValue,
    matched: false,
    parentContext: currentContext,
    branchContext: null,
  };
}

function createLoopMetadata(index, length) {
  return {
    index: index + 1,
    index0: index,
    first: index === 0,
    last: index === length - 1,
    length,
  };
}

function evaluateWhenMatch(engine, expression, switchValue, context) {
  const candidates = tokenize(expression, ",")
    .flatMap((segment) => tokenize(segment, " "))
    .filter((segment) => segment && segment !== "or");

  return candidates.some((candidate) => engine.resolveValue(candidate, context) === switchValue);
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
    this.tags = Object.assign(Object.create(null), tags);
    this.yieldAfter = yieldAfter;
    this.yieldControl = yieldControl || defaultYieldControl;
  }

  registerFilter(name, filter) {
    this.filters[name] = filter;
  }

  registerTag(name, handler) {
    this.tags[name] = handler;
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

      if (block.content.startsWith("if ") || block.content.startsWith("unless ")) {
        const isUnless = block.content.startsWith("unless ");
        const condition = isUnless ? block.content.slice(7).trim() : block.content.slice(3).trim();
        const truthy = isUnless
          ? !this.evaluateCondition(condition, handler.currentContext)
          : this.evaluateCondition(condition, handler.currentContext);
        const frame = createConditionalFrame(truthy, handler.currentContext);
        handler.ifStack.push(frame);

        if (!truthy) {
          handler.state = STATE_SKIP;
          handler.skipDepth = 1;
          handler.skipMode = "if_false";
          output.push(await this.processText(text.slice(cursor), handler));
          return output.join(EMPTY_STRING);
        }

        handler.currentContext = frame.branchContext;
        continue;
      }

      if (block.content.startsWith("case ")) {
        handler.ifStack.push(
          createCaseFrame(
            this.resolveValue(block.content.slice(5).trim(), handler.currentContext),
            handler.currentContext,
          ),
        );
        handler.state = STATE_SKIP;
        handler.skipDepth = 1;
        handler.skipMode = "case_search";
        output.push(await this.processText(text.slice(cursor), handler));
        return output.join(EMPTY_STRING);
      }

      if (block.content.startsWith("assign ")) {
        const assignment = parseAssignExpression(block.content);
        if (assignment) {
          handler.currentContext[assignment.variableName] = this.resolveValue(
            assignment.valueExpression,
            handler.currentContext,
          );
        }
        continue;
      }

      if (block.content.startsWith("increment ") || block.content.startsWith("decrement ")) {
        const counter = parseCounterExpression(block.content);
        if (counter) {
          const current = handler.runtime.counters[counter.variableName];

          if (counter.operation === "increment") {
            const outputValue = current === undefined ? 0 : current;
            handler.runtime.counters[counter.variableName] = outputValue + 1;
            output.push(String(outputValue));
          } else {
            const outputValue = current === undefined ? -1 : current - 1;
            handler.runtime.counters[counter.variableName] = outputValue;
            output.push(String(outputValue));
          }
        }
        continue;
      }

      if (block.content.startsWith("when ")) {
        const current = handler.ifStack.at(-1);
        if (current?.type === "case" && current.matched) {
          handler.state = STATE_SKIP;
          handler.skipDepth = 1;
          handler.skipMode = "case_done";
          output.push(await this.processText(text.slice(cursor), handler));
          return output.join(EMPTY_STRING);
        }
        continue;
      }

      if (block.content === "else") {
        const current = handler.ifStack.at(-1);
        if (current?.type === "case") {
          if (current.matched) {
            handler.state = STATE_SKIP;
            handler.skipDepth = 1;
            handler.skipMode = "case_done";
            output.push(await this.processText(text.slice(cursor), handler));
            return output.join(EMPTY_STRING);
          }

          current.matched = true;
          current.branchContext = createScope(current.parentContext);
          handler.currentContext = current.branchContext;
          continue;
        }

        if (current?.truthy) {
          handler.state = STATE_SKIP;
          handler.skipDepth = 1;
          handler.skipMode = "else_branch";
          output.push(await this.processText(text.slice(cursor), handler));
          return output.join(EMPTY_STRING);
        }

        if (current) {
          handler.currentContext = current.branchContext;
        }
        continue;
      }

      if (block.content === "endcase") {
        const frame = handler.ifStack.pop();
        handler.currentContext = frame?.parentContext || handler.currentContext;
        continue;
      }

      if (block.content === "endif") {
        const frame = handler.ifStack.pop();
        handler.currentContext = frame?.parentContext || handler.currentContext;
        continue;
      }

      if (block.content.startsWith("for ")) {
        const loop = parseForExpression(block.content);
        const collection = loop ? this.resolveForCollection(loop, handler.currentContext) : [];

        handler.state = STATE_CAPTURE;
        handler.capture = createCaptureState("for", {
          itemName: loop?.itemName || EMPTY_STRING,
          collection,
        });

        output.push(await this.processText(text.slice(cursor), handler));
        return output.join(EMPTY_STRING);
      }

      if (block.content.startsWith("capture ")) {
        const capture = parseCaptureExpression(block.content);

        handler.state = STATE_CAPTURE;
        handler.capture = createCaptureState("capture", {
          variableName: capture?.variableName || EMPTY_STRING,
        });

        output.push(await this.processText(text.slice(cursor), handler));
        return output.join(EMPTY_STRING);
      }

      if (block.content === "raw") {
        handler.state = STATE_RAW;
        handler.raw = createRawState();
        output.push(await this.processText(text.slice(cursor), handler));
        return output.join(EMPTY_STRING);
      }

      if (block.content.startsWith("render ")) {
        output.push(await this.renderPartial(block.content.slice(7).trim(), handler, "render"));
        continue;
      }

      if (block.content.startsWith("include ")) {
        output.push(await this.renderPartial(block.content.slice(8).trim(), handler, "include"));
        continue;
      }

      const { name, expression } = parseTagInvocation(block.content);
      const customTag = this.tags[name];
      if (customTag) {
        const tagResult = await customTag({
          context: handler.currentContext,
          engine: this,
          expression,
          markup: expression,
          resolveArgument: (argument) => this.resolveExpression(argument, handler.currentContext, { applyFilters: false }),
          resolveExpression: (argument, options = {}) => this.resolveExpression(argument, handler.currentContext, options),
          state: handler,
        });

        if (tagResult && typeof tagResult === "object" && "output" in tagResult) {
          output.push(
            tagResult.html
              ? String(tagResult.output ?? EMPTY_STRING)
              : this.renderResolvedValue(tagResult.output),
          );
          continue;
        }

        output.push(String(tagResult ?? EMPTY_STRING));
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

      if (
        block.content.startsWith("if ") ||
        block.content.startsWith("unless ") ||
        block.content.startsWith("case ")
      ) {
        handler.skipDepth += 1;
        continue;
      }

      if (
        block.content.startsWith("when ") &&
        handler.skipDepth === 1 &&
        handler.skipMode === "case_search"
      ) {
        const frame = handler.ifStack.at(-1);
        if (
          frame?.type === "case" &&
          !frame.matched &&
          evaluateWhenMatch(this, block.content.slice(5).trim(), frame.switchValue, handler.currentContext)
        ) {
          frame.matched = true;
          frame.branchContext = createScope(frame.parentContext);
          handler.currentContext = frame.branchContext;
          handler.state = STATE_EMIT;
          handler.skipDepth = 0;
          handler.skipMode = null;
          return this.processEmitText(text.slice(block.trimRight ? skipLeadingWhitespace(text, cursor) : cursor), handler);
        }
        continue;
      }

      if (block.content === "else" && handler.skipDepth === 1 && handler.skipMode === "if_false") {
        handler.state = STATE_EMIT;
        handler.skipDepth = 0;
        handler.skipMode = null;
        const frame = handler.ifStack.at(-1);
        handler.currentContext = frame?.branchContext || handler.currentContext;
        return this.processEmitText(text.slice(block.trimRight ? skipLeadingWhitespace(text, cursor) : cursor), handler);
      }

      if (block.content === "else" && handler.skipDepth === 1 && handler.skipMode === "case_search") {
        const frame = handler.ifStack.at(-1);
        if (frame?.type === "case" && !frame.matched) {
          frame.matched = true;
          frame.branchContext = createScope(frame.parentContext);
          handler.currentContext = frame.branchContext;
          handler.state = STATE_EMIT;
          handler.skipDepth = 0;
          handler.skipMode = null;
          return this.processEmitText(text.slice(block.trimRight ? skipLeadingWhitespace(text, cursor) : cursor), handler);
        }
        continue;
      }

      if (block.content === "endif") {
        handler.skipDepth -= 1;

        if (handler.skipDepth === 0) {
          const frame = handler.ifStack.pop();
          handler.currentContext = frame?.parentContext || handler.currentContext;
          handler.state = STATE_EMIT;
          handler.skipMode = null;
          return this.processEmitText(text.slice(block.trimRight ? skipLeadingWhitespace(text, cursor) : cursor), handler);
        }
      }

      if (block.content === "endcase") {
        handler.skipDepth -= 1;

        if (handler.skipDepth === 0) {
          const frame = handler.ifStack.pop();
          handler.currentContext = frame?.parentContext || handler.currentContext;
          handler.state = STATE_EMIT;
          handler.skipMode = null;
          return this.processEmitText(text.slice(block.trimRight ? skipLeadingWhitespace(text, cursor) : cursor), handler);
        }
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
        const rawContent = handler.raw.bufferParts.join(EMPTY_STRING);
        handler.state = STATE_EMIT;
        handler.raw = null;
        return rawContent + await this.processEmitText(
          text.slice(block.trimRight ? skipLeadingWhitespace(text, cursor) : cursor),
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

        const rendered = await this.renderCapture(handler);
        handler.state = STATE_EMIT;
        handler.capture = null;
        return rendered + await this.processEmitText(text.slice(cursor), handler);
      }

      appendCapturePart(handler.capture, block.raw);
    }

    return EMPTY_STRING;
  }

  async renderCapture(handler) {
    const fragment = handler.capture.bufferParts.join(EMPTY_STRING);

    if (handler.capture.mode === "capture") {
      handler.currentContext[handler.capture.variableName] = await this.renderFragment(
        fragment,
        createScope(handler.currentContext),
        handler.runtime,
        handler.renderDepth,
      );
      return EMPTY_STRING;
    }

    const output = [];
    const length = handler.capture.collection.length;

    for (let index = 0; index < length; index += 1) {
      if (this.yieldAfter > 0 && index > 0 && index % this.yieldAfter === 0) {
        await this.yieldControl();
      }

      const item = handler.capture.collection[index];
      const loopScope = createScope(handler.currentContext);
      loopScope[handler.capture.itemName] = item;
      loopScope.forloop = createLoopMetadata(index, length);
      output.push(await this.renderFragment(fragment, loopScope, handler.runtime, handler.renderDepth));
    }

    return output.join(EMPTY_STRING);
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

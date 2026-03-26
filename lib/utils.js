export const VARIABLE_OPEN = "{{";
export const VARIABLE_CLOSE = "}}";
export const BLOCK_OPEN = "{%";
export const BLOCK_CLOSE = "%}";
export const NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/;
export const RANGE_PATTERN = /^\((.+)\.\.(.+)\)$/;
export const EMPTY_STRING = "";
export const HTML_VALUE = "_h";
export const WHITESPACE_CHARACTERS = new Set([" ", "\n", "\r", "\t", "\f"]);
export const COMPARISON_OPERATORS = [">=", "<=", "!=", "==", ">", "<"];
export const NAME_PATTERN = /^\w+$/;

export function getNextLiquidMarker(text, startIndex) {
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

export function readLiquidTag(text, startIndex, openToken, closeToken) {
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

export function isEscaped(text, index) {
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

export function tokenize(expression = EMPTY_STRING, separator) {
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

export function parseTagInvocation(content = EMPTY_STRING) {
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

export function findTopLevelOperator(expression = EMPTY_STRING, operator) {
  const state = {
    quote: null,
    parenDepth: 0,
    squareDepth: 0,
    curlyDepth: 0,
  };

  for (let index = 0; index < expression.length; index += 1) {
    if (isTopLevel(state) && expression.startsWith(operator, index)) {
      return index;
    }

    updateScanState(state, expression, index);
  }

  return -1;
}

export function splitFilterSegments(expression = EMPTY_STRING) {
  return tokenize(expression, "|");
}

export function splitFilterArguments(expression = EMPTY_STRING) {
  return tokenize(expression, ",").filter(Boolean);
}

export function splitFilterNameAndArguments(expression = EMPTY_STRING) {
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

export function splitRangeExpression(expression = EMPTY_STRING) {
  const match = RANGE_PATTERN.exec(expression.trim());
  if (!match) {
    return null;
  }

  return {
    start: match[1].trim(),
    end: match[2].trim(),
  };
}

export function normalizeLiteralKey(key = EMPTY_STRING) {
  const trimmed = key.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export function parsePathSegments(expression = EMPTY_STRING) {
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

export function resolvePathValue(value, segment) {
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

export function escapeHtml(value = EMPTY_STRING) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttribute(value = EMPTY_STRING) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;");
}

export function unwrapHtmlValue(value) {
  return value && typeof value === "object" && value[HTML_VALUE] ? value.value : value;
}

export function createScope(parent = null) {
  return Object.create(parent && typeof parent === "object" ? parent : null);
}

export function isLiquidTruthy(value) {
  return value !== false && value !== null && value !== undefined;
}

export function trimTrailingWhitespace(text) {
  let cursor = text.length;

  while (cursor > 0 && WHITESPACE_CHARACTERS.has(text[cursor - 1])) {
    cursor -= 1;
  }

  return text.slice(0, cursor);
}

export function skipLeadingWhitespace(text, index) {
  let cursor = index;

  while (cursor < text.length && WHITESPACE_CHARACTERS.has(text[cursor])) {
    cursor += 1;
  }

  return cursor;
}

export function createRuntime() {
  return {
    counters: Object.create(null),
  };
}

export function createHandlerState(scope, options = {}) {
  return {
    state: "EMIT",
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

export function createCaptureState(mode, options = {}) {
  return {
    mode,
    itemName: options.itemName || null,
    collection: options.collection || null,
    variableName: options.variableName || null,
    depth: 0,
    bufferParts: [],
  };
}

export function createRawState() {
  return {
    bufferParts: [],
  };
}

export function hasIncompleteLiquidTag(text = EMPTY_STRING) {
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

export function hasQuotedIncompleteLiquidTag(text = EMPTY_STRING) {
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

export function serializeStartTag(element) {
  const attributes = [...element.attributes]
    .map(([name, value]) => (!value ? name : `${name}="${escapeAttribute(value)}"`))
    .join(" ");

  return attributes ? `<${element.tagName} ${attributes}>` : `<${element.tagName}>`;
}

export function serializeEndTag(tagName) {
  return `</${tagName}>`;
}

export function appendCapturePart(capture, value) {
  if (value) {
    capture.bufferParts.push(value);
  }
}

export function appendRawPart(raw, value) {
  if (value) {
    raw.bufferParts.push(value);
  }
}

export function trimBufferedTrailingWhitespace(bufferParts) {
  const trimmed = trimTrailingWhitespace(bufferParts.join(EMPTY_STRING));
  bufferParts.length = 0;

  if (trimmed) {
    bufferParts.push(trimmed);
  }
}

export function getResumeCursor(text, cursor, block) {
  return block.trimRight ? skipLeadingWhitespace(text, cursor) : cursor;
}

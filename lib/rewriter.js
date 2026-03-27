import { HTMLRewriter as DefaultHTMLRewriter } from "@sntran/html-rewriter";
import { renderCapture } from "./tags/iteration.js";
import { applySignal } from "./tags/signals.js";
import {
  BLOCK_CLOSE,
  BLOCK_OPEN,
  EMPTY_STRING,
  HTML_VALUE,
  VARIABLE_CLOSE,
  VARIABLE_OPEN,
  appendCapturePart,
  appendRawPart,
  createScope,
  escapeHtml,
  getResumeCursor,
  getNextLiquidMarker,
  hasIncompleteLiquidTag,
  hasQuotedIncompleteLiquidTag,
  parseTagInvocation,
  readLiquidTag,
  serializeEndTag,
  serializeStartTag,
  skipLeadingWhitespace,
  trimBufferedTrailingWhitespace,
  trimTrailingWhitespace,
} from "./utils.js";
import { createRenderScope } from "./tag.js";

const TAG_WILDCARD_SELECTOR = "{% * %}";
const OUTPUT_WILDCARD_SELECTOR = "{{ * }}";

export const STATE_EMIT = "EMIT";
export const STATE_SKIP = "SKIP";
export const STATE_CAPTURE = "CAPTURE";
export const STATE_RAW = "RAW";

/**
 * Creates per-render runtime bookkeeping storage.
 *
 * @returns {{ counters: Record<string, number> }}
 */
export function createRuntime() {
  return {
    counters: Object.create(null),
  };
}

/**
 * Creates the mutable state container used while rewriting a single render.
 *
 * @param {object} scope
 * @param {object} [options={}]
 * @returns {object}
 */
export function createHandlerState(scope, options = {}) {
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
    execution: options.execution || null,
  };
}

/**
 * Normalizes tag handler return values into a signal-like shape.
 *
 * @param {unknown} tagResult
 * @returns {{ action: string, output?: unknown, html?: boolean }}
 */
export function normalizeLegacyTagResult(tagResult) {
  if (tagResult && typeof tagResult === "object" && typeof tagResult.action === "string") {
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

function normalizeTagSelector(selector) {
  if (selector === TAG_WILDCARD_SELECTOR) {
    return TAG_WILDCARD_SELECTOR;
  }

  const match = typeof selector === "string" && selector.match(/^\{%\s*([a-zA-Z_][\w-]*|\*)\s*%}$/);
  return match ? (match[1] === "*" ? TAG_WILDCARD_SELECTOR : match[1]) : selector;
}

function normalizeOutputSelector(selector) {
  if (selector === OUTPUT_WILDCARD_SELECTOR) {
    return OUTPUT_WILDCARD_SELECTOR;
  }

  const match = typeof selector === "string" && selector.match(/^\{\{\s*\*\s*\}\}$/);
  return match ? OUTPUT_WILDCARD_SELECTOR : selector;
}

function getRewriter(engine) {
  return engine?.rewriter || engine;
}

export function flushBufferedLiteral(handler, text) {
  const combined = `${handler.pendingLiteralText || EMPTY_STRING}${text}`;
  const output = trimTrailingWhitespace(combined);
  handler.pendingLiteralText = combined.slice(output.length);
  return output;
}

/**
 * Returns the safe text length that can be processed without crossing an
 * incomplete Liquid marker boundary.
 *
 * @param {string} text
 * @param {string} state
 * @param {boolean} lastInTextNode
 * @returns {number}
 */
export function takeProcessableTextLength(text, state, lastInTextNode) {
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

/**
 * Creates the HTMLRewriter-compatible handler pair for one render pass.
 *
 * The handler owns the text buffer and render state machine, and translates
 * HTMLRewriter element/text callbacks into Liquid-aware processing steps.
 *
 * @param {object} engine
 * @param {object} [context={}]
 * @param {object|null} [execution=null]
 * @returns {{ element(element: object): Promise<void>, text(chunk: object): Promise<void> }}
 */
export function createHandler(engine, context = {}, execution = null) {
  const rewriter = getRewriter(engine);
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

      await rewriter.dispatchDocumentElement(element, handler);
      await rewriter.interpolateAttributes(
        element,
        handler.currentContext,
        handler.runtime,
        handler.renderDepth,
        handler.execution,
      );
    },

    text: async (chunk) => {
      await rewriter.dispatchDocumentText(chunk, handler);
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
        // In EMIT mode we can flush plain text immediately, but once we hit a
        // Liquid marker we hand off to the state-machine processor so nested
        // skip/capture/raw transitions stay consistent across chunk boundaries.
        if (handler.state === STATE_EMIT) {
          const marker = getNextLiquidMarker(buffered, 0);

          if (marker === -1) {
            if (!chunk.lastInTextNode && buffered.endsWith("{")) {
              outputParts.push(rewriter.flushBufferedLiteral(handler, buffered.slice(0, -1)));
              buffered = "{";
            } else {
              const literal = chunk.lastInTextNode
                ? `${handler.pendingLiteralText}${buffered}`
                : rewriter.flushBufferedLiteral(handler, buffered);
              handler.pendingLiteralText = chunk.lastInTextNode ? EMPTY_STRING : handler.pendingLiteralText;
              outputParts.push(literal);
              buffered = EMPTY_STRING;
            }

            break;
          }

          if (marker > 0) {
            outputParts.push(rewriter.flushBufferedLiteral(handler, buffered.slice(0, marker)));
            buffered = buffered.slice(marker);
            continue;
          }
        }

        const processableLength = rewriter.takeProcessableTextLength(buffered, handler.state, chunk.lastInTextNode);
        if (processableLength === 0) {
          break;
        }

        const segment = `${handler.pendingLiteralText}${buffered.slice(0, processableLength)}`;
        handler.pendingLiteralText = EMPTY_STRING;
        outputParts.push(await rewriter.processText(segment, handler));
        buffered = buffered.slice(processableLength);
      }

      if (chunk.lastInTextNode && buffered) {
        const segment = `${handler.pendingLiteralText}${buffered}`;
        handler.pendingLiteralText = EMPTY_STRING;
        outputParts.push(await rewriter.processText(segment, handler));
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

export function renderResolvedValue(engine, value) {
  const rewriter = getRewriter(engine);
  if (value && typeof value === "object" && value[HTML_VALUE]) {
    return String(value.value ?? EMPTY_STRING);
  }

  const string = String(value ?? EMPTY_STRING);
  return rewriter.autoEscape ? escapeHtml(string) : string;
}

/**
 * Direct interpolation helper for string-only use cases and tests.
 *
 * @param {object} engine
 * @param {string} text
 * @param {object} [context={}]
 * @returns {string}
 */
export function interpolate(engine, text, context = {}) {
  const rewriter = getRewriter(engine);
  const evaluator = engine?.evaluator || engine;
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

    output.push(rewriter.renderResolvedValue(evaluator.resolveValue(variable.content, context)));
    cursor = variable.trimRight ? skipLeadingWhitespace(text, variable.endIndex) : variable.endIndex;
  }

  return output.join(EMPTY_STRING);
}

/**
 * Interpolates Liquid expressions found in element attributes.
 *
 * @param {object} engine
 * @param {object} element
 * @param {object} [context={}]
 * @param {object} [runtime=createRuntime()]
 * @param {number} [renderDepth=0]
 * @param {object|null} [execution=null]
 * @returns {Promise<void>}
 */
export async function interpolateAttributes(engine, element, context = {}, runtime = createRuntime(), renderDepth = 0, execution = null) {
  const rewriter = getRewriter(engine);
  const attributes = [...element.attributes];

  for (const [name, value] of attributes) {
    if (value.indexOf(VARIABLE_OPEN) === -1 && value.indexOf(BLOCK_OPEN) === -1) {
      continue;
    }

    element.setAttribute(name, await rewriter.renderFragment(value, context, runtime, renderDepth, execution));
  }
}

/**
 * Dispatches text processing based on the current render state.
 *
 * @param {object} engine
 * @param {string} text
 * @param {object} handler
 * @returns {Promise<string>}
 */
export async function processText(engine, text, handler) {
  if (handler.state === STATE_SKIP) {
    return processSkipText(engine, text, handler);
  }

  if (handler.state === STATE_RAW) {
    return processRawText(engine, text, handler);
  }

  if (handler.state === STATE_CAPTURE) {
    return processCaptureText(engine, text, handler);
  }

  return processEmitText(engine, text, handler);
}

/**
 * Processes text while the handler is in normal emit mode.
 *
 * @param {object} engine
 * @param {string} text
 * @param {object} handler
 * @returns {Promise<string>}
 */
export async function processEmitText(engine, text, handler) {
  const rewriter = getRewriter(engine);
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

      output.push(await rewriter.renderOutput(variable, handler));
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
    const tagResult = await rewriter.dispatchTag(
      {
        name,
        expression,
        block,
      },
      handler,
      "emit",
    );

    if (tagResult == null) {
      continue;
    }

    const signal = normalizeLegacyTagResult(tagResult);

    applySignal(signal, handler);

    if (signal.action === "OUTPUT") {
      output.push(
        signal.html
          ? String(signal.output ?? EMPTY_STRING)
          : rewriter.renderResolvedValue(signal.output),
      );
      continue;
    }

    if (signal.action === "SKIP" || signal.action === "CAPTURE" || signal.action === "RAW") {
      output.push(await rewriter.processText(text.slice(cursor), handler));
      return output.join(EMPTY_STRING);
    }

    if (signal.action === "BREAK") {
      return output.join(EMPTY_STRING);
    }
  }

  return output.join(EMPTY_STRING);
}

export async function processSkipText(engine, text, handler) {
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
    const signal = await getRewriter(engine).dispatchTag(
      {
        name,
        expression,
        block,
      },
      handler,
      "skip",
    );

    if (!signal) {
      continue;
    }

    applySignal(signal, handler);

    if (signal.action === "NEST") {
      continue;
    }

    if (signal.action === "RESUME_EMIT") {
      const resumeCursor = getResumeCursor(text, cursor, block);
      return processEmitText(engine, text.slice(resumeCursor), handler);
    }

    if (signal.action === "BREAK") {
      return EMPTY_STRING;
    }
  }

  return EMPTY_STRING;
}

/**
 * Processes text while inside a raw block.
 *
 * @param {object} engine
 * @param {string} text
 * @param {object} handler
 * @returns {Promise<string>}
 */
export async function processRawText(engine, text, handler) {
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
      return rawContent + await processEmitText(
        engine,
        text.slice(getResumeCursor(text, cursor, block)),
        handler,
      );
    }

    appendRawPart(handler.raw, block.raw);
  }

  return EMPTY_STRING;
}

/**
 * Processes text while inside a capture or for-loop capture buffer.
 *
 * @param {object} engine
 * @param {string} text
 * @param {object} handler
 * @returns {Promise<string>}
 */
export async function processCaptureText(engine, text, handler) {
  const rewriter = getRewriter(engine);
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

      const rendered = await rewriter.renderCapture(handler);
      handler.state = STATE_EMIT;
      handler.capture = null;
      return rendered + await processEmitText(
        engine,
        text.slice(getResumeCursor(text, cursor, block)),
        handler,
      );
    }

    appendCapturePart(handler.capture, block.raw);
  }

  return EMPTY_STRING;
}

/**
 * Renders the buffered capture state back into output.
 *
 * @param {object} engine
 * @param {object} handler
 * @returns {Promise<string>}
 */
export async function renderCaptureBlock(engine, handler) {
  return renderCapture(engine, handler);
}

/**
 * Renders a standalone HTML fragment through the same state machine used by
 * streamed document rewrites.
 *
 * @param {object} engine
 * @param {string} fragment
 * @param {object} [context={}]
 * @param {object} [runtime=createRuntime()]
 * @param {number} [renderDepth=0]
 * @param {object|null} [execution=null]
 * @returns {Promise<string>}
 */
export async function renderFragment(engine, fragment, context = {}, runtime = createRuntime(), renderDepth = 0, execution = null) {
  const handler = createHandlerState(createRenderScope(context), {
    runtime,
    renderDepth,
    execution,
  });
  return processText(engine, fragment, handler);
}

/**
 * Creates the per-transform execution context shared by lazy root handlers.
 *
 * @param {Response} input
 * @param {Map<string, object>} [registry=new Map()]
 * @param {object} [context={}]
 * @returns {{ input: Response, registry: Map<string, object>, rootMemo: Map<string, Promise<unknown>>, signal: unknown, context: object }}
 */
export function createExecutionContext(input, registry = new Map(), context = {}) {
  return {
    input,
    registry: new Map(registry),
    rootMemo: new Map(),
    signal: null,
    context,
  };
}

/**
 * Runs the public Response-to-Response transform pipeline.
 *
 * @param {object} engine
 * @param {Response} source
 * @returns {Response}
 */
export function transform(engine, source) {
  const rewriter = getRewriter(engine);
  const HTMLRewriterClass = rewriter.HTMLRewriterClass || DefaultHTMLRewriter;
  const htmlRewriter = new HTMLRewriterClass();
  const context = rewriter.context && typeof rewriter.context === "object" ? rewriter.context : {};
  const execution = rewriter.createExecutionContext(source, rewriter.handlers, context);
  const handler = rewriter.createHandler(context, execution);

  htmlRewriter.on("*", { element: handler.element });
  htmlRewriter.onDocument({ text: handler.text });

  return htmlRewriter.transform(source);
}

/**
 * Long-lived rewrite orchestrator shared by a `Liquid` engine.
 */
export class LiquidRewriter {
  constructor(options = {}) {
    this.autoEscape = options.autoEscape ?? true;
    this.HTMLRewriterClass = options.HTMLRewriterClass || null;
    this.tags = options.tags || Object.create(null);
    this.handlers = options.handlers || new Map();
    this.context = options.context || {};
    this.yieldAfter = options.yieldAfter || 0;
    this.yieldControl = options.yieldControl || null;
    this.createTag = options.createTag || null;
    this.tagHooks = new Map();
    this.outputHooks = [];
    this.documentHooks = [];
  }

  on(selector, handlers = {}) {
    if (normalizeOutputSelector(selector) === OUTPUT_WILDCARD_SELECTOR) {
      this.outputHooks.push(handlers);
      return this;
    }

    const normalizedSelector = normalizeTagSelector(selector);
    const existing = this.tagHooks.get(normalizedSelector) || [];
    existing.push(handlers);
    this.tagHooks.set(normalizedSelector, existing);
    return this;
  }

  onDocument(handlers = {}) {
    this.documentHooks.push(handlers);
    return this;
  }

  flushBufferedLiteral(handler, text) {
    return flushBufferedLiteral(handler, text);
  }

  takeProcessableTextLength(text, state, lastInTextNode) {
    return takeProcessableTextLength(text, state, lastInTextNode);
  }

  createHandler(context = {}, execution = null) {
    return createHandler(this, context, execution);
  }

  createExecutionContext(input, registry = this.handlers, context = {}) {
    return createExecutionContext(input, registry, context);
  }

  transform(source) {
    return transform(this, source);
  }

  renderResolvedValue(value) {
    return renderResolvedValue(this, value);
  }

  interpolate(text, context = {}) {
    return interpolate(this, text, context);
  }

  async interpolateAttributes(element, context = {}, runtime = createRuntime(), renderDepth = 0, execution = null) {
    return interpolateAttributes(this, element, context, runtime, renderDepth, execution);
  }

  async processText(text, handler) {
    return processText(this, text, handler);
  }

  async processEmitText(text, handler) {
    return processEmitText(this, text, handler);
  }

  async processSkipText(text, handler) {
    return processSkipText(this, text, handler);
  }

  async processRawText(text, handler) {
    return processRawText(this, text, handler);
  }

  async processCaptureText(text, handler) {
    return processCaptureText(this, text, handler);
  }

  async renderCapture(handler) {
    return renderCaptureBlock(this, handler);
  }

  async renderFragment(fragment, context = {}, runtime = createRuntime(), renderDepth = 0, execution = null) {
    return renderFragment(this, fragment, context, runtime, renderDepth, execution);
  }

  getTagHooks(name) {
    const exact = this.tagHooks.get(name) || [];
    const wildcard = this.tags[name] ? (this.tagHooks.get(TAG_WILDCARD_SELECTOR) || []) : [];
    return [...exact, ...wildcard];
  }

  async dispatchDocumentElement(element, handler) {
    for (const hooks of this.documentHooks) {
      if (typeof hooks.element === "function") {
        await hooks.element({
          element,
          handler,
          state: handler,
          context: handler.currentContext,
          execution: handler.execution,
        });
      }
    }
  }

  async dispatchDocumentText(chunk, handler) {
    for (const hooks of this.documentHooks) {
      if (typeof hooks.text === "function") {
        await hooks.text({
          chunk,
          text: chunk.text,
          lastInTextNode: chunk.lastInTextNode,
          handler,
          state: handler,
          context: handler.currentContext,
          execution: handler.execution,
        });
      }
    }
  }

  async dispatchTag(tagMarkup, handler, phase) {
    let result;
    const definition = this.tags[tagMarkup.name] || null;
    const payload = typeof this.createTag === "function"
      ? this.createTag({
        name: tagMarkup.name,
        definition,
        expression: tagMarkup.expression,
        block: tagMarkup.block,
        handler,
        phase,
        replace(value) {
          result = value;
        },
        remove() {
          result = EMPTY_STRING;
        },
      })
      : {
        name: tagMarkup.name,
        args: tagMarkup.expression,
        raw: tagMarkup.block.raw,
        trimLeft: tagMarkup.block.trimLeft,
        trimRight: tagMarkup.block.trimRight,
        definition,
        phase,
        expression: tagMarkup.expression,
        block: tagMarkup.block,
        handler,
        state: handler,
        context: handler.currentContext,
        execution: handler.execution,
        runtime: handler.runtime,
        renderDepth: handler.renderDepth,
        replace(value) {
          result = value;
        },
        remove() {
          result = EMPTY_STRING;
        },
      };

    for (const hooks of this.getTagHooks(tagMarkup.name)) {
      if (typeof hooks.element !== "function") {
        continue;
      }

      const hookResult = await hooks.element(payload);
      if (hookResult !== undefined && hookResult !== null) {
        return hookResult;
      }

      if (result !== undefined) {
        return result;
      }
    }

    return null;
  }

  async renderOutput(variable, handler) {
    let result;
    const payload = {
      expression: variable.content,
      raw: variable.raw,
      trimLeft: variable.trimLeft,
      trimRight: variable.trimRight,
      replace(value) {
        result = value;
      },
    };
    const runtime = {
      handler,
      state: handler,
      context: handler.currentContext,
      execution: handler.execution,
      runtime: handler.runtime,
      renderDepth: handler.renderDepth,
    };

    for (const hooks of this.outputHooks) {
      const callback = typeof hooks.output === "function" ? hooks.output : hooks.element;
      if (typeof callback !== "function") {
        continue;
      }

      const hookResult = await callback(payload, runtime);
      if (hookResult !== undefined) {
        return this.renderResolvedValue(hookResult);
      }

      if (result !== undefined) {
        return this.renderResolvedValue(result);
      }
    }

    return EMPTY_STRING;
  }
}

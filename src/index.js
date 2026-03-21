import { HTMLRewriter } from "@sntran/html-rewriter";

export const EMPTY_STRING = "";
export const STATE_EMIT = "EMIT";
export const STATE_SKIP = "SKIP";
export const STATE_CAPTURE = "CAPTURE";

export const FILTERS = {
  upcase(value) {
    return String(value ?? EMPTY_STRING).toUpperCase();
  },
  downcase(value) {
    return String(value ?? EMPTY_STRING).toLowerCase();
  },
  default(value, fallback = EMPTY_STRING) {
    return value === undefined || value === null || value === EMPTY_STRING
      ? fallback
      : value;
  },
};

export function splitTopLevel(expression = EMPTY_STRING, separator = ".") {
  const parts = [];
  let current = EMPTY_STRING;
  let quote = null;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];

    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote === char ? null : char;
      current += char;
      continue;
    }

    if (char === separator && !quote) {
      parts.push(current.trim());
      current = EMPTY_STRING;
      continue;
    }

    current += char;
  }

  parts.push(current.trim());
  return parts;
}

export function parsePathSegments(expression = EMPTY_STRING) {
  return splitTopLevel(expression, ".").filter(Boolean);
}

export function resolvePathValue(value, segment) {
  if (value === null || value === undefined) {
    return undefined;
  }

  return value?.[segment];
}

export function escapeHtml(value) {
  return String(value ?? EMPTY_STRING)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export class Liquid {
  constructor(options = {}) {
    this.filters = Object.assign(Object.create(FILTERS), options.filters || {});
    this.HTMLRewriterClass = options.HTMLRewriterClass || HTMLRewriter;
  }

  registerFilter(name, filter) {
    this.filters[name] = filter;
  }

  createScope(parent = null) {
    return Object.create(parent);
  }

  createState(context = {}) {
    const scope = this.createScope(null);
    Object.assign(scope, context);

    return {
      state: STATE_EMIT,
      context: scope,
      ifStack: [],
      textBuffer: [],
      capture: null,
    };
  }

  resolveExpression(expression, context = {}) {
    const source = String(expression ?? EMPTY_STRING).trim();

    if (!source) {
      return EMPTY_STRING;
    }

    if (
      (source.startsWith('"') && source.endsWith('"')) ||
      (source.startsWith("'") && source.endsWith("'"))
    ) {
      return source.slice(1, -1);
    }

    if (/^-?\d+(?:\.\d+)?$/.test(source)) {
      return Number(source);
    }

    if (source === "true") {
      return true;
    }

    if (source === "false") {
      return false;
    }

    if (source === "null" || source === "nil") {
      return null;
    }

    return parsePathSegments(source).reduce(resolvePathValue, context);
  }

  resolveValue(expression, context = {}) {
    const value = this.resolveExpression(expression, context);
    return value === undefined || value === null ? EMPTY_STRING : value;
  }

  evaluateCondition(expression, context = {}) {
    return Boolean(this.resolveExpression(expression, context));
  }

  interpolate(text, context = {}) {
    return String(text).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, source) => {
      const parts = splitTopLevel(source, "|");
      const expression = parts.shift();
      let value = this.resolveValue(expression, context);

      for (const step of parts) {
        const [filterName, argument] = splitTopLevel(step, ":");
        const filter = this.filters[filterName.trim()];

        if (typeof filter === "function") {
          value = filter(value, this.resolveValue(argument, context));
        }
      }

      return escapeHtml(value);
    });
  }

  processEmitText(text, state) {
    let output = EMPTY_STRING;
    let index = 0;

    while (index < text.length) {
      const variableStart = text.indexOf("{{", index);
      const tagStart = text.indexOf("{%", index);
      const nextStart = [variableStart, tagStart]
        .filter((value) => value !== -1)
        .sort((left, right) => left - right)[0];

      if (nextStart === undefined) {
        output += this.interpolate(text.slice(index), state.context);
        break;
      }

      output += this.interpolate(text.slice(index, nextStart), state.context);

      if (nextStart === variableStart) {
        const end = text.indexOf("}}", variableStart);
        output += this.interpolate(text.slice(variableStart, end + 2), state.context);
        index = end + 2;
        continue;
      }

      const end = text.indexOf("%}", tagStart);
      const tag = text.slice(tagStart + 2, end).trim();
      index = end + 2;

      if (tag.startsWith("assign ")) {
        const [name, value] = tag.slice(7).split("=");
        state.context[name.trim()] = this.resolveValue(value, state.context);
        continue;
      }

      if (tag.startsWith("if ")) {
        const active = this.evaluateCondition(tag.slice(3), state.context);
        state.ifStack.push(active);
        state.state = active ? STATE_EMIT : STATE_SKIP;
        continue;
      }

      if (tag.startsWith("for ")) {
        const match = /^for\s+(\w+)\s+in\s+(.+)$/.exec(tag);
        state.capture = {
          mode: "for",
          variable: match[1],
          collection: this.resolveExpression(match[2], state.context),
          parts: [],
        };
        state.state = STATE_CAPTURE;
        continue;
      }

      if (tag === "endif") {
        state.ifStack.pop();
        state.state = state.ifStack.at(-1) === false ? STATE_SKIP : STATE_EMIT;
      }
    }

    return output;
  }

  processSkipText(text, state) {
    let index = 0;

    while (index < text.length) {
      const tagStart = text.indexOf("{%", index);
      if (tagStart === -1) {
        break;
      }

      const end = text.indexOf("%}", tagStart);
      const tag = text.slice(tagStart + 2, end).trim();
      index = end + 2;

      if (tag.startsWith("if ")) {
        state.ifStack.push(false);
        continue;
      }

      if (tag === "endif") {
        state.ifStack.pop();
        state.state = state.ifStack.at(-1) === false ? STATE_SKIP : STATE_EMIT;
      }
    }

    return EMPTY_STRING;
  }

  async processCaptureText(text, state) {
    const endTag = state.capture.mode === "for" ? "{% endfor %}" : "{% endcapture %}";
    const endIndex = text.indexOf(endTag);

    if (endIndex === -1) {
      state.capture.parts.push(text);
      return EMPTY_STRING;
    }

    state.capture.parts.push(text.slice(0, endIndex));
    const rendered = await this.renderCapture(state);
    state.capture = null;
    state.state = STATE_EMIT;

    return rendered + this.processText(text.slice(endIndex + endTag.length), state);
  }

  async renderCapture(state) {
    const template = state.capture.parts.join(EMPTY_STRING);
    const collection = Array.isArray(state.capture.collection)
      ? state.capture.collection
      : [];
    const output = [];

    for (const item of collection) {
      const scope = this.createScope(state.context);
      scope[state.capture.variable] = item;
      output.push(await this.renderFragment(template, scope));
    }

    return output.join(EMPTY_STRING);
  }

  processText(text, state) {
    if (state.state === STATE_SKIP) {
      return this.processSkipText(text, state);
    }

    if (state.state === STATE_CAPTURE) {
      return this.processCaptureText(text, state);
    }

    return this.processEmitText(text, state);
  }

  createHandler(state) {
    return {
      text: async (textNode) => {
        state.textBuffer.push(textNode.text);

        if (!textNode.lastInTextNode) {
          textNode.remove();
          return;
        }

        const nextText = state.textBuffer.join(EMPTY_STRING);
        state.textBuffer.length = 0;
        textNode.replace(await this.processText(nextText, state));
      },
    };
  }

  async renderFragment(template, context = {}) {
    return this.parseAndRender(template, context);
  }

  async parseAndRender(template, context = {}) {
    const state = this.createState(context);
    const response = new Response(String(template));
    const rewritten = new this.HTMLRewriterClass()
      .on("*", this.createHandler(state))
      .transform(response);

    return rewritten.text();
  }
}

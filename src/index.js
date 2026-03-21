import { HTMLRewriter } from "@sntran/html-rewriter";

export const EMPTY_STRING = "";
export const STATE_EMIT = "EMIT";
export const STATE_SKIP = "SKIP";

export const FILTERS = {
  upcase(value) {
    return String(value ?? EMPTY_STRING).toUpperCase();
  },
  downcase(value) {
    return String(value ?? EMPTY_STRING).toLowerCase();
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
    this.filters = { ...FILTERS };
    this.HTMLRewriterClass = options.HTMLRewriterClass || HTMLRewriter;
  }

  createState(context = {}) {
    return {
      state: STATE_EMIT,
      context: { ...context },
      ifStack: [],
      textBuffer: [],
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

      for (const filterName of parts) {
        const filter = this.filters[filterName.trim()];
        if (typeof filter === "function") {
          value = filter(value);
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

  processText(text, state) {
    if (state.state === STATE_SKIP) {
      return this.processSkipText(text, state);
    }

    return this.processEmitText(text, state);
  }

  createHandler(state) {
    return {
      text: (textNode) => {
        state.textBuffer.push(textNode.text);

        if (!textNode.lastInTextNode) {
          textNode.remove();
          return;
        }

        const nextText = state.textBuffer.join(EMPTY_STRING);
        state.textBuffer.length = 0;
        textNode.replace(this.processText(nextText, state));
      },
    };
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

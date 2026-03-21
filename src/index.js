export const EMPTY_STRING = "";

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
  constructor() {
    this.filters = { ...FILTERS };
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

  interpolate(template, context = {}) {
    return String(template).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, source) => {
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

  async parseAndRender(template, context = {}) {
    return this.interpolate(template, context);
  }
}

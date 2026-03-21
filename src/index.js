export const EMPTY_STRING = "";

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

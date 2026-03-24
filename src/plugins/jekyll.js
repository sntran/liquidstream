import path from "node:path";

const EMPTY_STRING = "";

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

function parsePathSegments(expression = EMPTY_STRING) {
  return String(expression)
    .split(".")
    .filter(Boolean);
}

function getPathValue(value, path) {
  return parsePathSegments(path).reduce(resolvePathValue, value);
}

function isLiquidTruthy(value) {
  return value !== false && value !== null && value !== undefined;
}

function normalizeSlugInput(value) {
  return String(value ?? EMPTY_STRING)
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, EMPTY_STRING);
}

function slugify(value) {
  return normalizeSlugInput(value)
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, EMPTY_STRING);
}

function joinUrlPath(base = EMPTY_STRING, value = EMPTY_STRING) {
  const pathname = String(value ?? EMPTY_STRING).trim();
  const hasTrailingSlash = pathname.length > 1 && pathname.endsWith("/");
  const joined = path.posix.join("/", String(base ?? EMPTY_STRING).trim(), pathname);

  return hasTrailingSlash && joined !== "/" && !joined.endsWith("/") ? `${joined}/` : joined;
}

function buildRelativeUrl(value, site = {}) {
  if (value === null || value === undefined) {
    return EMPTY_STRING;
  }

  return joinUrlPath(site.baseurl, value);
}

function buildAbsoluteUrl(value, site = {}) {
  if (value === null || value === undefined) {
    return EMPTY_STRING;
  }

  const root = String(site.url ?? EMPTY_STRING).replaceAll(/\/+$/g, EMPTY_STRING);
  return `${root}${buildRelativeUrl(value, site)}`;
}

function groupItems(items, getKey) {
  const groups = [];
  const indexByName = new Map();

  for (const item of items) {
    const key = getKey(item);
    const name = key === null || key === undefined ? null : key;

    if (!indexByName.has(name)) {
      indexByName.set(name, groups.length);
      groups.push({
        name,
        items: [],
        size: 0,
      });
    }

    const group = groups[indexByName.get(name)];
    group.items.push(item);
    group.size = group.items.length;
  }

  return groups;
}

export function jsonify(value) {
  return JSON.stringify(value);
}

export function where(value, property, expected) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => {
    const actual = getPathValue(item, property);
    return arguments.length >= 3 ? actual === expected : isLiquidTruthy(actual);
  });
}

export function where_exp(value, variableName, expression) {
  if (!Array.isArray(value) || !variableName || !expression || typeof this?.evaluate !== "function") {
    return [];
  }

  return value.filter((item) => this.evaluate(expression, { [variableName]: item }));
}

export function relative_url(value) {
  return buildRelativeUrl(value, this?.context?.site);
}

export function absolute_url(value) {
  return buildAbsoluteUrl(value, this?.context?.site);
}

export function group_by(value, property) {
  if (!Array.isArray(value)) {
    return [];
  }

  return groupItems(value, (item) => getPathValue(item, property));
}

export function group_by_exp(value, variableName, expression) {
  if (!Array.isArray(value) || !variableName || !expression || typeof this?.resolveExpression !== "function") {
    return [];
  }

  return groupItems(value, (item) => {
    return this.resolveExpression(expression, { [variableName]: item }, { applyFilters: false });
  });
}

function parseIncludeRelativeExpression(expression = EMPTY_STRING) {
  const [snippetExpression] = String(expression)
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);

  return snippetExpression ?? EMPTY_STRING;
}

function isQuotedStringLiteral(expression = EMPTY_STRING) {
  const normalized = String(expression).trim();

  return (
    normalized.length >= 2 &&
    ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")))
  );
}

function normalizeIncludeRelativePath(expression = EMPTY_STRING, resolvedValue) {
  const normalized = String(expression).trim();

  if (isQuotedStringLiteral(normalized)) {
    return normalized.slice(1, -1);
  }

  if (resolvedValue !== null && resolvedValue !== undefined && resolvedValue !== EMPTY_STRING) {
    return String(resolvedValue).trim();
  }

  return normalized;
}

function hasParentTraversal(pathname = EMPTY_STRING) {
  return String(pathname)
    .split("/")
    .includes("..");
}

async function includeRelativeTag({ context, engine, expression, resolveArgument, state }) {
  const snippetExpression = parseIncludeRelativeExpression(expression);
  if (!snippetExpression) {
    return EMPTY_STRING;
  }

  const snippetValue = resolveArgument(snippetExpression);
  const snippetName = normalizeIncludeRelativePath(snippetExpression, snippetValue);
  if (!snippetName || hasParentTraversal(snippetName)) {
    return EMPTY_STRING;
  }

  const nextDepth = state.renderDepth + 1;

  if (nextDepth > 10) {
    throw new Error("Max render depth exceeded");
  }

  const currentPath = String(context?.page?.path ?? "/");
  const baseDirectory = path.posix.dirname(currentPath);
  const resolvedPath = path.posix.normalize(path.posix.join(baseDirectory, snippetName));
  const request = new Request(new URL(resolvedPath, "https://liquid.local/"));
  const response = await engine.fetch?.(request);

  if (!response?.ok) {
    return EMPTY_STRING;
  }

  const template = await response.text();
  const childContext = Object.create(context && typeof context === "object" ? context : null);
  childContext.page = {
    ...(context?.page && typeof context.page === "object" ? context.page : {}),
    path: resolvedPath,
  };

  return await engine.renderFragment(template, childContext, state.runtime, nextDepth);
}

export default function plugin(Liquid) {
  this.registerFilter("jsonify", jsonify);
  this.registerFilter("slugify", slugify);
  this.registerFilter("where", where);
  this.registerFilter("where_exp", where_exp);
  this.registerFilter("relative_url", relative_url);
  this.registerFilter("absolute_url", absolute_url);
  this.registerFilter("group_by", group_by);
  this.registerFilter("group_by_exp", group_by_exp);

  this.registerTag("include_relative", includeRelativeTag);

  return Liquid;
}

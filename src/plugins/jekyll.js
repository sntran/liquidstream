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

function normalizeUrlPart(value = EMPTY_STRING) {
  const string = String(value ?? EMPTY_STRING).trim();
  if (!string || string === "/") {
    return EMPTY_STRING;
  }

  return `/${string.replaceAll(/^\/+|\/+$/g, EMPTY_STRING)}`;
}

function joinUrlParts(base, path) {
  const normalizedBase = normalizeUrlPart(base);
  const stringPath = String(path ?? EMPTY_STRING).trim();
  const hasTrailingSlash = stringPath.length > 1 && stringPath.endsWith("/");
  const normalizedPath = normalizeUrlPart(stringPath);
  const combined = `${normalizedBase}${normalizedPath}` || "/";

  return hasTrailingSlash && combined !== "/" ? `${combined}/` : combined;
}

function buildRelativeUrl(value, site = {}) {
  if (value === null || value === undefined) {
    return EMPTY_STRING;
  }

  return joinUrlParts(site.baseurl, value);
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

const jekyllFilters = {
  jsonify(value) {
    return JSON.stringify(value);
  },
  slugify,
  where(value, property, expected) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item) => {
      const actual = getPathValue(item, property);
      return arguments.length >= 3 ? actual === expected : isLiquidTruthy(actual);
    });
  },
  where_exp(value, variableName, expression) {
    if (!Array.isArray(value) || !variableName || !expression || typeof this?.evaluate !== "function") {
      return [];
    }

    return value.filter((item) => this.evaluate(expression, { [variableName]: item }));
  },
  relative_url(value) {
    return buildRelativeUrl(value, this?.context?.site);
  },
  absolute_url(value) {
    return buildAbsoluteUrl(value, this?.context?.site);
  },
  group_by(value, property) {
    if (!Array.isArray(value)) {
      return [];
    }

    return groupItems(value, (item) => getPathValue(item, property));
  },
  group_by_exp(value, variableName, expression) {
    if (!Array.isArray(value) || !variableName || !expression || typeof this?.resolveExpression !== "function") {
      return [];
    }

    return groupItems(value, (item) => {
      return this.resolveExpression(expression, { [variableName]: item }, { applyFilters: false });
    });
  },
};

export {
  jekyllFilters,
  jekyllFilters as default,
};

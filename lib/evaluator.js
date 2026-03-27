import { parsePartialExpression } from "./tags/file.js";
import {
  COMPARISON_OPERATORS,
  EMPTY_STRING,
  NUMBER_PATTERN,
  UNHANDLED,
  createScope,
  findTopLevelOperator,
  normalizeLiteralKey,
  parsePathSegments,
  resolvePathValue,
  splitFilterArguments,
  splitFilterNameAndArguments,
  splitFilterSegments,
  splitRangeExpression,
  tokenize,
  isLiquidTruthy,
  unwrapHtmlValue,
} from "./utils.js";

function getEvaluator(engine) {
  return engine?.evaluator || engine;
}

function createAsyncFilterContext(engine, context, execution) {
  const evaluator = getEvaluator(engine);
  return {
    context,
    evaluate: (expression, scope = {}) => evaluator.evaluateConditionAsync(
      expression,
      Object.assign(createScope(context), scope),
      execution,
    ),
    resolveExpression: (expression, scope = {}, options = {}) => evaluator.resolveExpressionAsync(
      expression,
      Object.assign(createScope(context), scope),
      execution,
      options,
    ),
  };
}

function hasOwnContextValue(context, key) {
  return Boolean(context) && (typeof context === "object" || typeof context === "function")
    && Object.prototype.hasOwnProperty.call(context, key);
}

function hasContextValue(context, key) {
  return Boolean(context) && (typeof context === "object" || typeof context === "function") && key in Object(context);
}

/**
 * Parses array and object literal expressions without applying filters.
 *
 * @param {object} engine
 * @param {string} expression
 * @param {object} [context={}]
 * @returns {unknown[]|Record<string, unknown>|null}
 */
export function parseLiteralExpression(engine, expression, context = {}) {
  const evaluator = getEvaluator(engine);
  const normalizedExpression = expression.trim();

  if (normalizedExpression.startsWith("[") && normalizedExpression.endsWith("]")) {
    const inner = normalizedExpression.slice(1, -1).trim();
    if (!inner) {
      return [];
    }

    return tokenize(inner, ",").filter(Boolean).map((item) =>
      evaluator.resolveExpression(item, context, { applyFilters: false }),
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

      output[normalizeLiteralKey(rawKey)] = evaluator.resolveExpression(rawValue, context, { applyFilters: false });
    }
    return output;
  }

  return null;
}

/**
 * Resolves a comparison operand and unwraps any HTML-safe wrapper value.
 *
 * @param {object} engine
 * @param {string} expression
 * @param {object} [context={}]
 * @returns {unknown}
 */
export function resolveComparisonValue(engine, expression, context = {}) {
  return unwrapHtmlValue(getEvaluator(engine).resolveValue(expression, context));
}

/**
 * Resolves a Liquid expression synchronously.
 *
 * When `applyFilters` is false this behaves like a parser for literals, ranges,
 * and paths. When filters are enabled it evaluates the base expression first
 * and then applies each filter left to right.
 *
 * @param {object} engine
 * @param {string} expression
 * @param {object} [context={}]
 * @param {{ applyFilters?: boolean }} [options={}]
 * @returns {unknown}
 */
export function resolveExpression(engine, expression, context = {}, options = {}) {
  const evaluator = getEvaluator(engine);
  const { applyFilters = true } = options;
  const normalizedExpression = String(expression ?? EMPTY_STRING).trim();

  if (!applyFilters) {
    if (!normalizedExpression) {
      return EMPTY_STRING;
    }

    const range = splitRangeExpression(normalizedExpression);
    if (range) {
      const start = Number(evaluator.resolveExpression(range.start, context, { applyFilters: false }));
      const end = Number(evaluator.resolveExpression(range.end, context, { applyFilters: false }));

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

    const literal = parseLiteralExpression(engine, normalizedExpression, context);
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

  const [base, ...filterExpressions] = splitFilterSegments(normalizedExpression);
  let value = evaluator.resolveExpression(base, context, { applyFilters: false });

  for (const filterExpression of filterExpressions) {
    const [filterName, rawArguments = EMPTY_STRING] = splitFilterNameAndArguments(filterExpression);
    const filter = evaluator.filters[filterName];
    if (typeof filter !== "function") {
      continue;
    }

    const argumentsList = splitFilterArguments(rawArguments).map((argument) =>
      unwrapHtmlValue(evaluator.resolveExpression(argument, context, { applyFilters: false })),
    );
    value = filter.apply(
      {
        context,
        evaluate: (filterExpressionValue, scope = {}) => evaluator.evaluateCondition(
          filterExpressionValue,
          Object.assign(createScope(context), scope),
        ),
        resolveExpression: (filterExpressionValue, scope = {}, filterOptions = {}) => evaluator.resolveExpression(
          filterExpressionValue,
          Object.assign(createScope(context), scope),
          filterOptions,
        ),
      },
      [unwrapHtmlValue(value), ...argumentsList],
    );
  }

  return value ?? EMPTY_STRING;
}

/**
 * Resolves a value expression with filters enabled.
 *
 * @param {object} engine
 * @param {string} expression
 * @param {object} [context={}]
 * @returns {unknown}
 */
export function resolveValue(engine, expression, context = {}) {
  return getEvaluator(engine).resolveExpression(expression, context);
}

/**
 * Resolves an expression without applying filters.
 *
 * @param {object} engine
 * @param {string} expression
 * @param {object} [context={}]
 * @returns {unknown}
 */
export function resolveArgument(engine, expression, context = {}) {
  return getEvaluator(engine).resolveExpression(expression, context, { applyFilters: false });
}

/**
 * Async counterpart to `parseLiteralExpression()`.
 *
 * @param {object} engine
 * @param {string} expression
 * @param {object} [context={}]
 * @param {object|null} [execution=null]
 * @returns {Promise<unknown[]|Record<string, unknown>|null>}
 */
export async function parseLiteralExpressionAsync(engine, expression, context = {}, execution = null) {
  const evaluator = getEvaluator(engine);
  const normalizedExpression = expression.trim();

  if (normalizedExpression.startsWith("[") && normalizedExpression.endsWith("]")) {
    const inner = normalizedExpression.slice(1, -1).trim();
    if (!inner) {
      return [];
    }

    const output = [];
    for (const item of tokenize(inner, ",").filter(Boolean)) {
      output.push(await evaluator.resolveExpressionAsync(item, context, execution, { applyFilters: false }));
    }
    return output;
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

      output[normalizeLiteralKey(rawKey)] = await evaluator.resolveExpressionAsync(
        rawValue,
        context,
        execution,
        { applyFilters: false },
      );
    }

    return output;
  }

  return null;
}

/**
 * Resolves the root segment of a path, consulting lazy root handlers first.
 *
 * @param {object} engine
 * @param {string} root
 * @param {object} [context={}]
 * @param {object|null} [execution=null]
 * @param {string} [expression=EMPTY_STRING]
 * @returns {Promise<{ value: unknown, root: string | null, handler: object | null }>}
 */
export async function resolveRootValue(engine, root, context = {}, execution = null, expression = EMPTY_STRING) {
  if (hasOwnContextValue(context, root)) {
    return {
      value: context[root],
      root: null,
      handler: null,
    };
  }

  const handler = execution?.registry?.get(root) || null;
  if (handler) {
    if (!execution.rootMemo.has(root)) {
      execution.rootMemo.set(
        root,
        Promise.resolve(handler.node ? handler.node({
          root,
          input: execution.input,
          expression,
          signal: execution.signal,
        }) : undefined),
      );
    }

    const value = await execution.rootMemo.get(root);
    if (value !== UNHANDLED) {
      return {
        value,
        root,
        handler,
      };
    }
  }

  if (hasContextValue(context, root)) {
    return {
      value: context[root],
      root: null,
      handler: null,
    };
  }

  return {
    value: undefined,
    root: handler ? root : null,
    handler,
  };
}

/**
 * Resolves a full path expression asynchronously, including lazy roots.
 *
 * @param {object} engine
 * @param {string} expression
 * @param {object} [context={}]
 * @param {object|null} [execution=null]
 * @returns {Promise<unknown>}
 */
export async function resolvePathExpressionAsync(engine, expression, context = {}, execution = null) {
  const evaluator = getEvaluator(engine);
  const path = parsePathSegments(expression);
  if (path.length === 0) {
    return {
      value: undefined,
      root: null,
      path,
    };
  }

  const [rootToken, ...rest] = path;
  const resolvedRoot = await evaluator.resolveRootValue(rootToken, context, execution, expression);
  let value = resolvedRoot.value;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (resolvedRoot.handler?.get && resolvedRoot.root) {
      const trapped = await resolvedRoot.handler.get(
        value,
        token,
        {
          root: resolvedRoot.root,
          input: execution?.input || new Response(EMPTY_STRING),
          expression,
          path,
          index: index + 1,
          signal: execution?.signal || null,
        },
      );

      if (trapped !== UNHANDLED) {
        value = trapped;
        continue;
      }
    }

    value = resolvePathValue(value, token);
  }

  return {
    value,
    root: resolvedRoot.root,
    path,
  };
}

/**
 * Async counterpart to `resolveComparisonValue()`.
 *
 * @param {object} engine
 * @param {string} expression
 * @param {object} [context={}]
 * @param {object|null} [execution=null]
 * @returns {Promise<unknown>}
 */
export async function resolveComparisonValueAsync(engine, expression, context = {}, execution = null) {
  return unwrapHtmlValue(await getEvaluator(engine).resolveValueAsync(expression, context, execution));
}

/**
 * Resolves a base expression before filters are applied.
 *
 * @param {object} engine
 * @param {string} expression
 * @param {object} [context={}]
 * @param {object|null} [execution=null]
 * @returns {Promise<unknown>}
 */
export async function resolveBaseExpressionAsync(engine, expression, context = {}, execution = null) {
  const evaluator = getEvaluator(engine);
  const normalizedExpression = String(expression ?? EMPTY_STRING).trim();

  if (!normalizedExpression) {
    return {
      value: EMPTY_STRING,
      root: null,
      path: [],
    };
  }

  const range = splitRangeExpression(normalizedExpression);
  if (range) {
    const start = Number(await evaluator.resolveExpressionAsync(range.start, context, execution, { applyFilters: false }));
    const end = Number(await evaluator.resolveExpressionAsync(range.end, context, execution, { applyFilters: false }));

    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return {
        value: [],
        root: null,
        path: [],
      };
    }

    const step = start <= end ? 1 : -1;
    const output = [];

    for (let value = start; step > 0 ? value <= end : value >= end; value += step) {
      output.push(value);
    }

    return {
      value: output,
      root: null,
      path: [],
    };
  }

  const literal = await evaluator.parseLiteralExpressionAsync(normalizedExpression, context, execution);
  if (literal !== null) {
    return {
      value: literal,
      root: null,
      path: [],
    };
  }

  if (
    (normalizedExpression.startsWith('"') && normalizedExpression.endsWith('"')) ||
    (normalizedExpression.startsWith("'") && normalizedExpression.endsWith("'"))
  ) {
    return {
      value: normalizedExpression.slice(1, -1),
      root: null,
      path: [],
    };
  }

  if (normalizedExpression.startsWith('"') || normalizedExpression.startsWith("'")) {
    return {
      value: normalizedExpression.slice(1),
      root: null,
      path: [],
    };
  }

  if (normalizedExpression === "true") {
    return {
      value: true,
      root: null,
      path: [],
    };
  }

  if (normalizedExpression === "false") {
    return {
      value: false,
      root: null,
      path: [],
    };
  }

  if (normalizedExpression === "null" || normalizedExpression === "nil") {
    return {
      value: null,
      root: null,
      path: [],
    };
  }

  if (NUMBER_PATTERN.test(normalizedExpression)) {
    return {
      value: Number(normalizedExpression),
      root: null,
      path: [],
    };
  }

  return evaluator.resolvePathExpressionAsync(normalizedExpression, context, execution);
}

/**
 * Resolves a Liquid expression asynchronously.
 *
 * This is the main async evaluation entrypoint used by the rewriter and tag
 * runtime. It mirrors the sync version but adds support for lazy roots, async
 * filters, and execution-scoped handler traps.
 *
 * @param {object} engine
 * @param {string} expression
 * @param {object} [context={}]
 * @param {object|null} [execution=null]
 * @param {{ applyFilters?: boolean }} [options={}]
 * @returns {Promise<unknown>}
 */
export async function resolveExpressionAsync(engine, expression, context = {}, execution = null, options = {}) {
  const evaluator = getEvaluator(engine);
  const { applyFilters = true } = options;
  const normalizedExpression = String(expression ?? EMPTY_STRING).trim();

  if (!applyFilters) {
    if (!normalizedExpression) {
      return EMPTY_STRING;
    }

    const resolved = await evaluator.resolveBaseExpressionAsync(normalizedExpression, context, execution);
    return resolved.value;
  }

  const [base, ...filterExpressions] = splitFilterSegments(normalizedExpression);
  const baseResolution = await evaluator.resolveBaseExpressionAsync(base, context, execution);
  let value = baseResolution.value;

  for (const filterExpression of filterExpressions) {
    const [filterName, rawArguments = EMPTY_STRING] = splitFilterNameAndArguments(filterExpression);
    const argumentsList = [];

    for (const argument of splitFilterArguments(rawArguments)) {
      argumentsList.push(
        unwrapHtmlValue(await evaluator.resolveExpressionAsync(argument, context, execution, { applyFilters: false })),
      );
    }

    if (baseResolution.root) {
      const handler = execution?.registry?.get(baseResolution.root);
      if (handler?.filter) {
        const trapped = await handler.filter(
          value,
          filterName,
          argumentsList,
          {
            root: baseResolution.root,
            input: execution?.input || new Response(EMPTY_STRING),
            expression: normalizedExpression,
            path: baseResolution.path,
            signal: execution?.signal || null,
          },
        );

        if (trapped !== UNHANDLED) {
          value = trapped;
          continue;
        }
      }
    }

    const filter = evaluator.filters[filterName];
    if (typeof filter !== "function") {
      continue;
    }

    value = await filter.apply(
      createAsyncFilterContext(engine, context, execution),
      [unwrapHtmlValue(value), ...argumentsList],
    );
  }

  return value ?? EMPTY_STRING;
}

/**
 * Resolves a value expression asynchronously with filters enabled.
 *
 * @param {object} engine
 * @param {string} expression
 * @param {object} [context={}]
 * @param {object|null} [execution=null]
 * @returns {Promise<unknown>}
 */
export async function resolveValueAsync(engine, expression, context = {}, execution = null) {
  return getEvaluator(engine).resolveExpressionAsync(expression, context, execution);
}

/**
 * Resolves an expression asynchronously without filters.
 *
 * @param {object} engine
 * @param {string} expression
 * @param {object} [context={}]
 * @param {object|null} [execution=null]
 * @returns {Promise<unknown>}
 */
export async function resolveArgumentAsync(engine, expression, context = {}, execution = null) {
  return getEvaluator(engine).resolveExpressionAsync(expression, context, execution, { applyFilters: false });
}

/**
 * Loads and renders a partial for `render` and `include` tags.
 *
 * The evaluator owns this because the partial path and named arguments are
 * part of Liquid expression semantics, while the final fragment render is
 * delegated back to the rewriter through the injected render callback.
 *
 * @param {object} engine
 * @param {string} partialExpression
 * @param {object} handler
 * @param {string} mode
 * @returns {Promise<string>}
 */
export async function renderPartial(engine, partialExpression, handler, mode) {
  const evaluator = getEvaluator(engine);
  const renderFragment = evaluator.renderFragment || engine.rewriter?.renderFragment?.bind(engine.rewriter);
  const partial = parsePartialExpression(partialExpression);
  const snippetValue = await evaluator.resolveArgumentAsync(
    partial.snippetExpression,
    handler.currentContext,
    handler.execution,
  );
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
  const response = await evaluator.fetch?.(request);
  if (!response?.ok) {
    return EMPTY_STRING;
  }

  const template = await response.text();
  const scope = mode === "render"
    ? createScope(null)
    : createScope(handler.currentContext);

  for (const argument of partial.argumentsList) {
    scope[argument.name] = await evaluator.resolveValueAsync(
      argument.valueExpression,
      handler.currentContext,
      handler.execution,
    );
  }

  return typeof renderFragment === "function"
    ? await renderFragment(template, scope, handler.runtime, nextDepth, handler.execution)
    : EMPTY_STRING;
}

/**
 * Evaluates a Liquid condition synchronously.
 *
 * @param {object} engine
 * @param {string} condition
 * @param {object} [context={}]
 * @returns {boolean}
 */
export function evaluateCondition(engine, condition, context = {}) {
  const evaluator = getEvaluator(engine);
  const orParts = tokenize(condition.trim(), " or ");
  if (orParts.length > 1) {
    return orParts.some((part) => evaluator.evaluateCondition(part, context));
  }

  const andParts = tokenize(condition.trim(), " and ");
  if (andParts.length > 1) {
    return andParts.every((part) => evaluator.evaluateCondition(part, context));
  }

  const containsIndex = findTopLevelOperator(condition, " contains ");
  if (containsIndex !== -1) {
    const left = resolveComparisonValue(engine, condition.slice(0, containsIndex).trim(), context);
    const right = resolveComparisonValue(engine, condition.slice(containsIndex + 10).trim(), context);
    return Array.isArray(left) ? left.includes(right) : String(left ?? EMPTY_STRING).includes(String(right ?? EMPTY_STRING));
  }

  for (const operator of COMPARISON_OPERATORS) {
    const index = findTopLevelOperator(condition, operator);
    if (index === -1) {
      continue;
    }

    const left = resolveComparisonValue(engine, condition.slice(0, index).trim(), context);
    const right = resolveComparisonValue(engine, condition.slice(index + operator.length).trim(), context);

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

  return isLiquidTruthy(resolveComparisonValue(engine, condition.trim(), context));
}

/**
 * Async counterpart to `evaluateCondition()`.
 *
 * @param {object} engine
 * @param {string} condition
 * @param {object} [context={}]
 * @param {object|null} [execution=null]
 * @returns {Promise<boolean>}
 */
export async function evaluateConditionAsync(engine, condition, context = {}, execution = null) {
  const evaluator = getEvaluator(engine);
  const orParts = tokenize(condition.trim(), " or ");
  if (orParts.length > 1) {
    for (const part of orParts) {
      if (await evaluator.evaluateConditionAsync(part, context, execution)) {
        return true;
      }
    }
    return false;
  }

  const andParts = tokenize(condition.trim(), " and ");
  if (andParts.length > 1) {
    for (const part of andParts) {
      if (!(await evaluator.evaluateConditionAsync(part, context, execution))) {
        return false;
      }
    }
    return true;
  }

  const containsIndex = findTopLevelOperator(condition, " contains ");
  if (containsIndex !== -1) {
    const left = await evaluator.resolveComparisonValueAsync(condition.slice(0, containsIndex).trim(), context, execution);
    const right = await evaluator.resolveComparisonValueAsync(condition.slice(containsIndex + 10).trim(), context, execution);
    return Array.isArray(left) ? left.includes(right) : String(left ?? EMPTY_STRING).includes(String(right ?? EMPTY_STRING));
  }

  for (const operator of COMPARISON_OPERATORS) {
    const index = findTopLevelOperator(condition, operator);
    if (index === -1) {
      continue;
    }

    const left = await evaluator.resolveComparisonValueAsync(condition.slice(0, index).trim(), context, execution);
    const right = await evaluator.resolveComparisonValueAsync(condition.slice(index + operator.length).trim(), context, execution);

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

  return isLiquidTruthy(await evaluator.resolveComparisonValueAsync(condition.trim(), context, execution));
}

/**
 * Resolves the iterable used by a `for` loop synchronously.
 *
 * @param {object} engine
 * @param {object} loop
 * @param {object} [context={}]
 * @returns {unknown[]|string[]}
 */
export function resolveForCollection(engine, loop, context = {}) {
  const evaluator = getEvaluator(engine);
  const source = evaluator.resolveValue(loop?.collectionPath, context);
  let collection = Array.isArray(source)
    ? [...source]
    : typeof source === "string"
      ? [...source]
      : [];

  const offset = Number(loop?.offsetExpression ? evaluator.resolveValue(loop.offsetExpression, context) : 0);
  const limit = Number(loop?.limitExpression ? evaluator.resolveValue(loop.limitExpression, context) : collection.length);

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

/**
 * Async counterpart to `resolveForCollection()`.
 *
 * @param {object} engine
 * @param {object} loop
 * @param {object} [context={}]
 * @param {object|null} [execution=null]
 * @returns {Promise<unknown[]|string[]>}
 */
export async function resolveForCollectionAsync(engine, loop, context = {}, execution = null) {
  const evaluator = getEvaluator(engine);
  const source = await evaluator.resolveValueAsync(loop?.collectionPath, context, execution);
  let collection = Array.isArray(source)
    ? [...source]
    : typeof source === "string"
      ? [...source]
      : [];

  const offset = Number(loop?.offsetExpression ? await evaluator.resolveValueAsync(loop.offsetExpression, context, execution) : 0);
  const limit = Number(loop?.limitExpression ? await evaluator.resolveValueAsync(loop.limitExpression, context, execution) : collection.length);

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

/**
 * Long-lived expression and condition evaluator shared by a `Liquid` engine.
 */
export class LiquidEvaluator {
  constructor(options = {}) {
    this.filters = options.filters || Object.create(null);
    this.fetch = options.fetch || null;
    this.yieldAfter = options.yieldAfter || 0;
    this.yieldControl = options.yieldControl || null;
    this.tags = options.tags || Object.create(null);
    this.handlers = options.handlers || new Map();
    this.renderFragment = options.renderFragment || null;
  }

  /**
   * Attaches the render callback used by partial rendering.
   *
   * @param {Function} renderFragment
   * @returns {this}
   */
  attachRenderFragment(renderFragment) {
    this.renderFragment = renderFragment;
    return this;
  }

  parseLiteralExpression(expression, context = {}) {
    return parseLiteralExpression(this, expression, context);
  }

  resolveComparisonValue(expression, context = {}) {
    return resolveComparisonValue(this, expression, context);
  }

  resolveExpression(expression, context = {}, options = {}) {
    return resolveExpression(this, expression, context, options);
  }

  resolveValue(expression, context = {}) {
    return resolveValue(this, expression, context);
  }

  resolveArgument(expression, context = {}) {
    return resolveArgument(this, expression, context);
  }

  async parseLiteralExpressionAsync(expression, context = {}, execution = null) {
    return parseLiteralExpressionAsync(this, expression, context, execution);
  }

  async resolveRootValue(root, context = {}, execution = null, expression = EMPTY_STRING) {
    return resolveRootValue(this, root, context, execution, expression);
  }

  async resolvePathExpressionAsync(expression, context = {}, execution = null) {
    return resolvePathExpressionAsync(this, expression, context, execution);
  }

  async resolveComparisonValueAsync(expression, context = {}, execution = null) {
    return resolveComparisonValueAsync(this, expression, context, execution);
  }

  async resolveBaseExpressionAsync(expression, context = {}, execution = null) {
    return resolveBaseExpressionAsync(this, expression, context, execution);
  }

  async resolveExpressionAsync(expression, context = {}, execution = null, options = {}) {
    return resolveExpressionAsync(this, expression, context, execution, options);
  }

  async resolveValueAsync(expression, context = {}, execution = null) {
    return resolveValueAsync(this, expression, context, execution);
  }

  async resolveArgumentAsync(expression, context = {}, execution = null) {
    return resolveArgumentAsync(this, expression, context, execution);
  }

  async renderPartial(partialExpression, handler, mode) {
    return renderPartial(this, partialExpression, handler, mode);
  }

  evaluateCondition(condition, context = {}) {
    return evaluateCondition(this, condition, context);
  }

  async evaluateConditionAsync(condition, context = {}, execution = null) {
    return evaluateConditionAsync(this, condition, context, execution);
  }

  resolveForCollection(loop, context = {}) {
    return resolveForCollection(this, loop, context);
  }

  async resolveForCollectionAsync(loop, context = {}, execution = null) {
    return resolveForCollectionAsync(this, loop, context, execution);
  }
}

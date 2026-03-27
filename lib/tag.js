import { EMPTY_STRING, createScope } from "./utils.js";

function getEvaluator(owner) {
  return owner?.evaluator || owner;
}

function resolveScopeArgs(scopeOrOptions = {}, maybeOptions = {}) {
  const looksLikeOptions = scopeOrOptions && typeof scopeOrOptions === "object" && "applyFilters" in scopeOrOptions;
  if (looksLikeOptions) {
    return {
      scope: {},
      options: scopeOrOptions,
    };
  }

  return {
    scope: scopeOrOptions || {},
    options: maybeOptions || {},
  };
}

export function createRenderScope(context = {}) {
  const scope = createScope(context);

  if (context && typeof context === "object") {
    Object.assign(scope, context);
  }

  return scope;
}

/**
 * Creates the mutable buffer state used by `capture` and `for` blocks.
 *
 * @param {string} mode
 * @param {object} [options={}]
 * @returns {{ mode: string, itemName: string | null, collection: unknown[] | string[] | null, variableName: string | null, depth: number, bufferParts: string[] }}
 */
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

/**
 * Creates the mutable buffer state used by raw blocks.
 *
 * @returns {{ bufferParts: string[] }}
 */
export function createRawState() {
  return {
    bufferParts: [],
  };
}

/**
 * Parsed Liquid tag invocation with only the data needed by the rewriter.
 *
 * The rewriter constructs this object directly from the parsed markup. It is
 * intentionally lightweight: engine-level services are only attached later
 * when the tag is upgraded into a `LiquidTagContext` for execution.
 */
export class LiquidTag {
  #replace;
  #remove;

  constructor(options = {}) {
    this.#replace = options.replace || null;
    this.#remove = options.remove || null;

    this.name = options.definition?.name || options.name || EMPTY_STRING;
    this.tag = options.definition || null;
    this.definition = options.definition || null;
    this.block = options.block || null;
    this.expression = options.expression || EMPTY_STRING;
    this.args = options.expression || EMPTY_STRING;
    this.markup = this.expression;
    this.raw = options.block?.raw || EMPTY_STRING;
    this.trimLeft = Boolean(options.block?.trimLeft);
    this.trimRight = Boolean(options.block?.trimRight);
    this.phase = options.phase || "emit";
    this.handler = options.handler || null;
    this.state = options.handler || null;
    this.context = options.handler?.currentContext || {};
    this.execution = options.handler?.execution || null;
    this.runtime = options.handler?.runtime || null;
    this.renderDepth = options.handler?.renderDepth || 0;

    this.replace = this.replace.bind(this);
    this.remove = this.remove.bind(this);
  }

  /**
   * Replaces the current tag invocation with rendered output.
   *
   * @param {unknown} value
   * @returns {this}
   */
  replace(value) {
    if (typeof this.#replace === "function") {
      this.#replace(value);
    }

    return this;
  }

  /**
   * Removes the current tag invocation from the output stream.
   *
   * @returns {this}
   */
  remove() {
    if (typeof this.#remove === "function") {
      this.#remove();
    }

    return this;
  }

  /**
   * Upgrades the lightweight tag into an execution context and runs it.
   *
   * @param {object} engine
   * @returns {unknown}
   */
  render(engine) {
    return createTagContext(engine, this).render();
  }
}

/**
 * Executable tag context enriched with evaluator-backed helper methods.
 *
 * Built-in tags and user-registered tags both receive this shape when their
 * `onEmit()` or `onSkip()` handlers run.
 */
export class LiquidTagContext extends LiquidTag {
  #evaluator;

  constructor(engine, tag, options = {}) {
    super({
      name: tag?.name,
      definition: tag?.definition || tag?.tag || tag || null,
      expression: options.expression ?? tag?.expression,
      handler: options.handler ?? tag?.handler,
      block: options.block ?? tag?.block,
      phase: options.phase ?? tag?.phase,
      replace: options.replace ?? tag?.replace,
      remove: options.remove ?? tag?.remove,
    });

    this.#evaluator = getEvaluator(engine);
    this.engine = engine;

    this.evaluate = this.evaluate.bind(this);
    this.resolveValue = this.resolveValue.bind(this);
    this.resolveForCollection = this.resolveForCollection.bind(this);
    this.renderPartial = this.renderPartial.bind(this);
    this.resolveArgument = this.resolveArgument.bind(this);
    this.resolveExpression = this.resolveExpression.bind(this);
    this.render = this.render.bind(this);
  }

  /**
   * Dispatches the current tag to its phase-appropriate tag definition hook.
   *
   * @returns {unknown}
   */
  render() {
    if (this.phase === "skip") {
      return typeof this.definition?.onSkip === "function" ? this.definition.onSkip(this) : null;
    }

    return typeof this.definition?.onEmit === "function" ? this.definition.onEmit(this) : null;
  }

  /**
   * Evaluates a Liquid condition in the current render scope.
   *
   * @param {string} condition
   * @param {object} [scope={}]
   * @returns {Promise<boolean>}
   */
  evaluate(condition, scope = {}) {
    return this.#evaluator.evaluateConditionAsync(
      condition,
      Object.assign(createScope(this.context), scope),
      this.execution,
    );
  }

  /**
   * Resolves a value expression with filters enabled.
   *
   * @param {string} valueExpression
   * @param {object} [context=this.context]
   * @returns {Promise<unknown>}
   */
  resolveValue(valueExpression, context = this.context) {
    return this.#evaluator.resolveValueAsync(valueExpression, context, this.execution);
  }

  /**
   * Resolves the iterable used by a `for` tag, including limit/offset/reverse.
   *
   * @param {object} loop
   * @param {object} [context=this.context]
   * @returns {Promise<unknown[]|string[]>}
   */
  resolveForCollection(loop, context = this.context) {
    return this.#evaluator.resolveForCollectionAsync(loop, context, this.execution);
  }

  /**
   * Loads and renders a partial in either `render` or `include` mode.
   *
   * @param {string} partialExpression
   * @param {object} [currentHandler=this.handler]
   * @param {string} [mode]
   * @returns {Promise<string>}
   */
  renderPartial(partialExpression, currentHandler = this.handler, mode) {
    return this.#evaluator.renderPartial(partialExpression, currentHandler, mode);
  }

  /**
   * Resolves an expression without applying filters.
   *
   * @param {string} argument
   * @param {object} [scope={}]
   * @returns {Promise<unknown>}
   */
  resolveArgument(argument, scope = {}) {
    return this.#evaluator.resolveExpressionAsync(
      argument,
      Object.assign(createScope(this.context), scope),
      this.execution,
      { applyFilters: false },
    );
  }

  /**
   * Resolves a general expression with optional local scope overrides.
   *
   * @param {string} argument
   * @param {object} [scopeOrOptions={}]
   * @param {object} [maybeOptions={}]
   * @returns {Promise<unknown>}
   */
  resolveExpression(argument, scopeOrOptions = {}, maybeOptions = {}) {
    const { scope, options } = resolveScopeArgs(scopeOrOptions, maybeOptions);
    return this.#evaluator.resolveExpressionAsync(
      argument,
      Object.assign(createScope(this.context), scope),
      this.execution,
      options,
    );
  }
}

/**
 * Compatibility helper that upgrades a parsed tag into an executable context.
 *
 * @param {object} engine
 * @param {LiquidTag|object} tag
 * @param {string} [expression]
 * @param {object} [handler]
 * @param {object|null} [block]
 * @returns {LiquidTagContext}
 */
export function createTagContext(engine, tag, expression, handler, block) {
  return new LiquidTagContext(engine, tag, {
    expression,
    handler,
    block,
  });
}

/**
 * Normalizes legacy tag helper call sites to the underlying mutable handler.
 *
 * @param {object} ctx
 * @returns {object|undefined}
 */
export function getHandler(ctx) {
  return ctx.handler || ctx.state;
}

/**
 * Returns the most relevant context object from a tag helper call site.
 *
 * @param {object} ctx
 * @returns {object}
 */
export function getContext(ctx) {
  return ctx.context || getHandler(ctx)?.currentContext || {};
}

/**
 * Evaluates a Liquid condition using whichever helper surface the tag offers.
 *
 * @param {object} ctx
 * @param {string} expression
 * @returns {boolean|Promise<boolean>}
 */
export function evaluateCondition(ctx, expression) {
  if (typeof ctx.evaluate === "function") {
    return ctx.evaluate(expression);
  }

  if (ctx.engine?.evaluator && typeof ctx.engine.evaluator.evaluateCondition === "function") {
    return ctx.engine.evaluator.evaluateCondition(expression, getContext(ctx));
  }

  return false;
}

/**
 * Resolves a value expression from a tag helper call site.
 *
 * @param {object} ctx
 * @param {string} expression
 * @param {object} [context=getContext(ctx)]
 * @returns {unknown}
 */
export function resolveValue(ctx, expression, context = getContext(ctx)) {
  if (typeof ctx.resolveValue === "function") {
    return ctx.resolveValue(expression, context);
  }

  if (ctx.engine?.evaluator && typeof ctx.engine.evaluator.resolveValue === "function") {
    return ctx.engine.evaluator.resolveValue(expression, context);
  }

  if (typeof ctx.resolveExpression === "function") {
    return ctx.resolveExpression(expression, { applyFilters: true });
  }

  return undefined;
}

/**
 * Resolves the collection used by a `for` loop from a tag helper call site.
 *
 * @param {object} ctx
 * @param {object} loop
 * @param {object} [context=getContext(ctx)]
 * @returns {unknown[]|string[]|Promise<unknown[]|string[]>}
 */
export function resolveForCollection(ctx, loop, context = getContext(ctx)) {
  if (typeof ctx.resolveForCollection === "function") {
    return ctx.resolveForCollection(loop, context);
  }

  const source = resolveValue(ctx, loop?.collectionPath, context);
  let collection = Array.isArray(source)
    ? [...source]
    : typeof source === "string"
      ? [...source]
      : [];

  const offset = Number(loop?.offsetExpression ? resolveValue(ctx, loop.offsetExpression, context) : 0);
  const limit = Number(loop?.limitExpression ? resolveValue(ctx, loop.limitExpression, context) : collection.length);

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
 * Renders a partial through the best available tag helper surface.
 *
 * @param {object} ctx
 * @param {string} mode
 * @returns {string|Promise<string>}
 */
export function renderPartial(ctx, mode) {
  const handler = getHandler(ctx);

  if (typeof ctx.renderPartial === "function") {
    return ctx.renderPartial(ctx.expression || EMPTY_STRING, handler, mode);
  }

  if (ctx.engine?.evaluator && typeof ctx.engine.evaluator.renderPartial === "function") {
    return ctx.engine.evaluator.renderPartial(ctx.expression || EMPTY_STRING, handler, mode);
  }

  return EMPTY_STRING;
}

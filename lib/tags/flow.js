import { EMPTY_STRING, createScope, tokenize } from "../utils.js";
import { evaluateCondition, getContext, getHandler, resolveValue } from "../tag.js";
import { CONTINUE, NEST, RESUME_EMIT, SKIP, UNNEST } from "./signals.js";

function activateBranch(frame) {
  if (!frame) {
    return null;
  }

  frame.branchContext = createScope(frame.parentContext);
  return frame.branchContext;
}

function createResumeSignal(frame, payload = {}) {
  const signal = {
    skipDepth: 0,
    skipMode: null,
    ...payload,
  };

  if ("currentContext" in payload) {
    signal.currentContext = payload.currentContext;
  } else if (frame?.branchContext || frame?.parentContext) {
    signal.currentContext = frame.branchContext || frame.parentContext;
  }

  return RESUME_EMIT(signal);
}

function createCloseSignal(frame, payload = {}) {
  const signal = {
    ifStackPop: 1,
    ...payload,
  };

  if ("currentContext" in payload) {
    signal.currentContext = payload.currentContext;
  } else if (frame?.parentContext) {
    signal.currentContext = frame.parentContext;
  }

  return CONTINUE(signal);
}

function createSkipCloseSignal(frame) {
  const payload = { ifStackPop: 1 };
  if (frame?.parentContext) {
    payload.currentContext = frame.parentContext;
  }

  return createResumeSignal(frame, payload);
}

function createIfTag(name, invert = false) {
  return {
    name,
    async onEmit(ctx) {
      const handler = getHandler(ctx);
      const evaluated = await evaluateCondition(ctx, ctx.expression || EMPTY_STRING);
      const truthy = invert ? !evaluated : evaluated;
      const frame = createConditionalFrame(truthy, handler.currentContext);

      if (truthy) {
        return CONTINUE({
          ifStackPush: frame,
          currentContext: frame.branchContext,
        });
      }

      return SKIP({
        ifStackPush: frame,
        skipDepth: 1,
        skipMode: "if_false",
      });
    },
    onSkip() {
      return NEST();
    },
  };
}

/**
 * Creates a control-flow frame for `if` and `unless` branches.
 * @param {boolean} truthy
 * @param {object} currentContext
 * @returns {{ type: string, truthy: boolean, parentContext: object, branchContext: object }}
 */
export function createConditionalFrame(truthy, currentContext) {
  return {
    type: "if",
    truthy,
    parentContext: currentContext,
    branchContext: createScope(currentContext),
  };
}

/**
 * Creates a control-flow frame for `case` branches.
 * @param {unknown} switchValue
 * @param {object} currentContext
 * @returns {{ type: string, switchValue: unknown, matched: boolean, parentContext: object, branchContext: object | null }}
 */
export function createCaseFrame(switchValue, currentContext) {
  return {
    type: "case",
    switchValue,
    matched: false,
    parentContext: currentContext,
    branchContext: null,
  };
}

/**
 * Evaluates whether a `when` expression matches the current `case` switch value.
 * @param {object} ctx
 * @param {string} expression
 * @param {unknown} switchValue
 * @param {object} [context=getContext(ctx)]
 * @returns {Promise<boolean>}
 */
export function evaluateWhenMatch(ctx, expression, switchValue, context = getContext(ctx)) {
  const candidates = tokenize(expression, ",")
    .flatMap((segment) => tokenize(segment, " "))
    .filter((segment) => segment && segment !== "or");

  return Promise.all(candidates.map((candidate) => resolveValue(ctx, candidate, context)))
    .then((values) => values.some((value) => value === switchValue));
}

/** Core `if` tag definition. */
export const ifTag = createIfTag("if");

/** Core `unless` tag definition. */
export const unless = createIfTag("unless", true);

/** Core `elsif` tag definition. */
export const elsif = {
  name: "elsif",
  async onEmit(ctx) {
    const handler = getHandler(ctx);
    const frame = handler?.ifStack.at(-1);

    if (frame?.truthy) {
      return SKIP({
        skipDepth: 1,
        skipMode: "if_false",
      });
    }

    const truthy = await evaluateCondition(ctx, ctx.expression || EMPTY_STRING);
    if (frame) {
      frame.truthy = truthy;
    }

    if (!truthy) {
      return SKIP({
        skipDepth: 1,
        skipMode: "if_false",
      });
    }

    return CONTINUE({
      currentContext: activateBranch(frame) || handler?.currentContext,
    });
  },
  async onSkip(ctx) {
    const handler = getHandler(ctx);
    if (handler?.skipDepth !== 1 || handler?.skipMode !== "if_false") {
      return null;
    }

    const frame = handler.ifStack.at(-1);
    if (frame?.truthy) {
      return null;
    }

    if (await evaluateCondition(ctx, ctx.expression || EMPTY_STRING)) {
      frame.truthy = true;
      return createResumeSignal(frame, {
        currentContext: activateBranch(frame),
      });
    }

    return null;
  },
};

/** Core `else` tag definition. */
export const elseTag = {
  name: "else",
  async onEmit(ctx) {
    const handler = getHandler(ctx);
    const frame = handler?.ifStack.at(-1);

    if (frame?.type === "case") {
      if (frame.matched) {
        return SKIP({
          skipDepth: 1,
          skipMode: "case_done",
        });
      }

      frame.matched = true;
      return CONTINUE({
        currentContext: activateBranch(frame),
      });
    }

    if (frame?.truthy) {
      return SKIP({
        skipDepth: 1,
        skipMode: "else_branch",
      });
    }

    return CONTINUE({
      currentContext: frame?.branchContext || handler?.currentContext,
    });
  },
  async onSkip(ctx) {
    const handler = getHandler(ctx);
    const frame = handler?.ifStack.at(-1);

    if (handler?.skipDepth !== 1) {
      return null;
    }

    if (handler.skipMode === "if_false") {
      if (frame?.truthy) {
        return null;
      }

      return createResumeSignal(frame, {
        currentContext: frame?.branchContext || handler.currentContext,
      });
    }

    if (handler.skipMode === "case_search" && frame?.type === "case" && !frame.matched) {
      frame.matched = true;
      return createResumeSignal(frame, {
        currentContext: activateBranch(frame),
      });
    }

    return null;
  },
};

/** Core `endif` tag definition. */
export const endif = {
  name: "endif",
  onEmit(ctx) {
    const handler = getHandler(ctx);
    return createCloseSignal(handler?.ifStack.at(-1));
  },
  onSkip(ctx) {
    const handler = getHandler(ctx);
    if ((handler?.skipDepth || 0) > 1) {
      return UNNEST();
    }

    return createSkipCloseSignal(handler?.ifStack.at(-1));
  },
};

/** Core `case` tag definition. */
export const caseTag = {
  name: "case",
  async onEmit(ctx) {
    const handler = getHandler(ctx);
    const frame = createCaseFrame(await resolveValue(ctx, ctx.expression || EMPTY_STRING), handler.currentContext);

    return SKIP({
      ifStackPush: frame,
      skipDepth: 1,
      skipMode: "case_search",
    });
  },
  onSkip() {
    return NEST();
  },
};

/** Core `when` tag definition. */
export const when = {
  name: "when",
  async onEmit(ctx) {
    const handler = getHandler(ctx);
    const frame = handler?.ifStack.at(-1);

    if (frame?.type === "case" && frame.matched) {
      return SKIP({
        skipDepth: 1,
        skipMode: "case_done",
      });
    }

    return CONTINUE();
  },
  async onSkip(ctx) {
    const handler = getHandler(ctx);
    if (handler?.skipDepth !== 1 || handler?.skipMode !== "case_search") {
      return null;
    }

    const frame = handler.ifStack.at(-1);
    if (
      frame?.type === "case" &&
      !frame.matched &&
      await evaluateWhenMatch(ctx, ctx.expression || EMPTY_STRING, frame.switchValue, handler.currentContext)
    ) {
      frame.matched = true;
      return createResumeSignal(frame, {
        currentContext: activateBranch(frame),
      });
    }

    return null;
  },
};

/** Core `endcase` tag definition. */
export const endcase = {
  name: "endcase",
  onEmit(ctx) {
    const handler = getHandler(ctx);
    return createCloseSignal(handler?.ifStack.at(-1));
  },
  onSkip(ctx) {
    const handler = getHandler(ctx);
    if ((handler?.skipDepth || 0) > 1) {
      return UNNEST();
    }

    return createSkipCloseSignal(handler?.ifStack.at(-1));
  },
};

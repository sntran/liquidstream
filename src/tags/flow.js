import { EMPTY_STRING, createScope, tokenize } from "../utils.js";
import { CONTINUE, NEST, RESUME_EMIT, SKIP, UNNEST } from "./signals.js";

function getHandler(ctx) {
  return ctx.handler || ctx.state;
}

function getContext(ctx) {
  return ctx.context || getHandler(ctx)?.currentContext || {};
}

function evaluate(ctx, expression) {
  if (typeof ctx.evaluate === "function") {
    return ctx.evaluate(expression);
  }

  if (ctx.engine && typeof ctx.engine.evaluateCondition === "function") {
    return ctx.engine.evaluateCondition(expression, getContext(ctx));
  }

  return false;
}

function resolveValue(ctx, expression, context = getContext(ctx)) {
  if (typeof ctx.resolveValue === "function") {
    return ctx.resolveValue(expression, context);
  }

  if (ctx.engine && typeof ctx.engine.resolveValue === "function") {
    return ctx.engine.resolveValue(expression, context);
  }

  if (typeof ctx.resolveExpression === "function") {
    return ctx.resolveExpression(expression, { applyFilters: true });
  }

  return undefined;
}

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
    onEmit(ctx) {
      const handler = getHandler(ctx);
      const truthy = invert ? !evaluate(ctx, ctx.expression || EMPTY_STRING) : evaluate(ctx, ctx.expression || EMPTY_STRING);
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

export function createConditionalFrame(truthy, currentContext) {
  return {
    type: "if",
    truthy,
    parentContext: currentContext,
    branchContext: createScope(currentContext),
  };
}

export function createCaseFrame(switchValue, currentContext) {
  return {
    type: "case",
    switchValue,
    matched: false,
    parentContext: currentContext,
    branchContext: null,
  };
}

export function evaluateWhenMatch(ctx, expression, switchValue, context = getContext(ctx)) {
  const candidates = tokenize(expression, ",")
    .flatMap((segment) => tokenize(segment, " "))
    .filter((segment) => segment && segment !== "or");

  return candidates.some((candidate) => resolveValue(ctx, candidate, context) === switchValue);
}

export const ifTag = createIfTag("if");

export const unless = createIfTag("unless", true);

export const elsif = {
  name: "elsif",
  onEmit(ctx) {
    const handler = getHandler(ctx);
    const frame = handler?.ifStack.at(-1);

    if (frame?.truthy) {
      return SKIP({
        skipDepth: 1,
        skipMode: "if_false",
      });
    }

    const truthy = evaluate(ctx, ctx.expression || EMPTY_STRING);
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
  onSkip(ctx) {
    const handler = getHandler(ctx);
    if (handler?.skipDepth !== 1 || handler?.skipMode !== "if_false") {
      return null;
    }

    const frame = handler.ifStack.at(-1);
    if (frame?.truthy) {
      return null;
    }

    if (evaluate(ctx, ctx.expression || EMPTY_STRING)) {
      frame.truthy = true;
      return createResumeSignal(frame, {
        currentContext: activateBranch(frame),
      });
    }

    return null;
  },
};

export const elseTag = {
  name: "else",
  onEmit(ctx) {
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
  onSkip(ctx) {
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

export const caseTag = {
  name: "case",
  onEmit(ctx) {
    const handler = getHandler(ctx);
    const frame = createCaseFrame(resolveValue(ctx, ctx.expression || EMPTY_STRING), handler.currentContext);

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

export const when = {
  name: "when",
  onEmit(ctx) {
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
  onSkip(ctx) {
    const handler = getHandler(ctx);
    if (handler?.skipDepth !== 1 || handler?.skipMode !== "case_search") {
      return null;
    }

    const frame = handler.ifStack.at(-1);
    if (
      frame?.type === "case" &&
      !frame.matched &&
      evaluateWhenMatch(ctx, ctx.expression || EMPTY_STRING, frame.switchValue, handler.currentContext)
    ) {
      frame.matched = true;
      return createResumeSignal(frame, {
        currentContext: activateBranch(frame),
      });
    }

    return null;
  },
};

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

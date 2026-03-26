import {
  EMPTY_STRING,
  NAME_PATTERN,
  createCaptureState,
  tokenize,
} from "../utils.js";
import { CAPTURE, CONTINUE, OUTPUT } from "./signals.js";

function getHandler(ctx) {
  return ctx.handler || ctx.state;
}

function getContext(ctx) {
  return ctx.context || getHandler(ctx)?.currentContext || {};
}

function resolveValue(ctx, expression) {
  if (typeof ctx.resolveValue === "function") {
    return ctx.resolveValue(expression, getContext(ctx));
  }

  if (typeof ctx.resolveExpression === "function") {
    return ctx.resolveExpression(expression, { applyFilters: true });
  }

  if (ctx.engine && typeof ctx.engine.resolveValue === "function") {
    return ctx.engine.resolveValue(expression, getContext(ctx));
  }

  return undefined;
}

export function parseAssignExpression(expression = EMPTY_STRING) {
  const [left, ...rest] = tokenize(expression, "=");
  const valueExpression = rest.join("=").trim();
  const tokens = tokenize(left || EMPTY_STRING, " ").filter(Boolean);
  if (tokens[0] !== "assign" || tokens.length !== 2 || !valueExpression || !NAME_PATTERN.test(tokens[1])) {
    return null;
  }

  return {
    variableName: tokens[1],
    valueExpression,
  };
}

export function parseCaptureExpression(expression = EMPTY_STRING) {
  const tokens = tokenize(expression, " ").filter(Boolean);
  if (tokens[0] !== "capture" || tokens.length !== 2 || !NAME_PATTERN.test(tokens[1])) {
    return null;
  }

  return {
    variableName: tokens[1],
  };
}

export function parseCounterExpression(expression = EMPTY_STRING) {
  const tokens = tokenize(expression, " ").filter(Boolean);
  if (
    tokens.length !== 2 ||
    (tokens[0] !== "increment" && tokens[0] !== "decrement") ||
    !NAME_PATTERN.test(tokens[1])
  ) {
    return null;
  }

  return {
    operation: tokens[0],
    variableName: tokens[1],
  };
}

export const assign = {
  name: "assign",
  onEmit(ctx) {
    const handler = getHandler(ctx);
    const assignment = parseAssignExpression(`assign ${ctx.expression || EMPTY_STRING}`);

    if (assignment && handler) {
      handler.currentContext[assignment.variableName] = resolveValue(ctx, assignment.valueExpression);
    }

    return CONTINUE();
  },
  onSkip() {
    return null;
  },
};

export const capture = {
  name: "capture",
  onEmit(ctx) {
    const parsed = parseCaptureExpression(`capture ${ctx.expression || EMPTY_STRING}`);

    return CAPTURE({
      capture: createCaptureState("capture", {
        variableName: parsed?.variableName || EMPTY_STRING,
      }),
    });
  },
  onSkip() {
    return null;
  },
};

export const endcapture = {
  name: "endcapture",
  onEmit() {
    return CONTINUE();
  },
  onSkip() {
    return null;
  },
};

export const increment = {
  name: "increment",
  onEmit(ctx) {
    const handler = getHandler(ctx);
    const counter = parseCounterExpression(`increment ${ctx.expression || EMPTY_STRING}`);

    if (!counter || !handler) {
      return CONTINUE();
    }

    const current = handler.runtime.counters[counter.variableName];
    const outputValue = current === undefined ? 0 : current;
    handler.runtime.counters[counter.variableName] = outputValue + 1;
    return OUTPUT(String(outputValue), { html: true });
  },
  onSkip() {
    return null;
  },
};

export const decrement = {
  name: "decrement",
  onEmit(ctx) {
    const handler = getHandler(ctx);
    const counter = parseCounterExpression(`decrement ${ctx.expression || EMPTY_STRING}`);

    if (!counter || !handler) {
      return CONTINUE();
    }

    const current = handler.runtime.counters[counter.variableName];
    const outputValue = current === undefined ? -1 : current - 1;
    handler.runtime.counters[counter.variableName] = outputValue;
    return OUTPUT(String(outputValue), { html: true });
  },
  onSkip() {
    return null;
  },
};

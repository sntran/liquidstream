import {
  EMPTY_STRING,
  NAME_PATTERN,
  tokenize,
} from "../utils.js";
import { createCaptureState, getHandler, resolveValue } from "../tag.js";
import { CAPTURE, CONTINUE, OUTPUT } from "./signals.js";

/**
 * Parses an `assign` expression into a variable target and value expression.
 * @param {string} [expression=""]
 * @returns {{ variableName: string, valueExpression: string } | null}
 */
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

/**
 * Parses a `capture` expression into its target variable.
 * @param {string} [expression=""]
 * @returns {{ variableName: string } | null}
 */
export function parseCaptureExpression(expression = EMPTY_STRING) {
  const tokens = tokenize(expression, " ").filter(Boolean);
  if (tokens[0] !== "capture" || tokens.length !== 2 || !NAME_PATTERN.test(tokens[1])) {
    return null;
  }

  return {
    variableName: tokens[1],
  };
}

/**
 * Parses an `increment` or `decrement` expression.
 * @param {string} [expression=""]
 * @returns {{ operation: string, variableName: string } | null}
 */
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

/** Core `assign` tag definition. */
export const assign = {
  name: "assign",
  async onEmit(ctx) {
    const handler = getHandler(ctx);
    const assignment = parseAssignExpression(`assign ${ctx.expression || EMPTY_STRING}`);

    if (assignment && handler) {
      handler.currentContext[assignment.variableName] = await resolveValue(ctx, assignment.valueExpression);
    }

    return CONTINUE();
  },
  onSkip() {
    return null;
  },
};

/** Core `capture` tag definition. */
export const capture = {
  name: "capture",
  async onEmit(ctx) {
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

/** Core `endcapture` tag definition. */
export const endcapture = {
  name: "endcapture",
  onEmit() {
    return CONTINUE();
  },
  onSkip() {
    return null;
  },
};

/** Core `increment` tag definition. */
export const increment = {
  name: "increment",
  async onEmit(ctx) {
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

/** Core `decrement` tag definition. */
export const decrement = {
  name: "decrement",
  async onEmit(ctx) {
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

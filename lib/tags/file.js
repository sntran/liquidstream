import {
  EMPTY_STRING,
  splitFilterNameAndArguments,
  tokenize,
} from "../utils.js";
import { OUTPUT } from "./signals.js";

function getHandler(ctx) {
  return ctx.handler || ctx.state;
}

function renderPartialThroughContext(ctx, mode) {
  const handler = getHandler(ctx);

  if (typeof ctx.renderPartial === "function") {
    return ctx.renderPartial(ctx.expression || EMPTY_STRING, handler, mode);
  }

  if (ctx.engine && typeof ctx.engine.renderPartial === "function") {
    return ctx.engine.renderPartial(ctx.expression || EMPTY_STRING, handler, mode);
  }

  return EMPTY_STRING;
}

export function parseNamedArgument(expression = EMPTY_STRING) {
  const [name, valueExpression] = splitFilterNameAndArguments(expression);
  if (!name || !valueExpression) {
    return null;
  }

  return {
    name,
    valueExpression,
  };
}

export function parsePartialExpression(expression = EMPTY_STRING) {
  const segments = tokenize(expression, ",").filter(Boolean);
  if (segments.length === 0) {
    return {
      snippetExpression: EMPTY_STRING,
      argumentsList: [],
    };
  }

  return {
    snippetExpression: segments[0],
    argumentsList: segments.slice(1)
      .map((segment) => parseNamedArgument(segment))
      .filter(Boolean),
  };
}

export const render = {
  name: "render",
  async onEmit(ctx) {
    return OUTPUT(await renderPartialThroughContext(ctx, "render"), { html: true });
  },
  onSkip() {
    return null;
  },
};

export const include = {
  name: "include",
  async onEmit(ctx) {
    return OUTPUT(await renderPartialThroughContext(ctx, "include"), { html: true });
  },
  onSkip() {
    return null;
  },
};

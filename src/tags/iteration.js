import {
  EMPTY_STRING,
  NAME_PATTERN,
  createCaptureState,
  createScope,
  tokenize,
} from "../utils.js";
import { CAPTURE, CONTINUE, NEST, UNNEST } from "./signals.js";

function getHandler(ctx) {
  return ctx.handler || ctx.state;
}

function getContext(ctx) {
  return ctx.context || getHandler(ctx)?.currentContext || {};
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

function resolveForCollection(ctx, loop, context = getContext(ctx)) {
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

export function parseForExpression(expression = EMPTY_STRING) {
  const tokens = tokenize(expression, " ").filter(Boolean);
  if (tokens.length < 4 || tokens[0] !== "for" || tokens[2] !== "in" || !NAME_PATTERN.test(tokens[1])) {
    return null;
  }

  const collectionTokens = [];
  let limitExpression = null;
  let offsetExpression = null;
  let reversed = false;

  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === "reversed") {
      reversed = true;
      continue;
    }

    if (token.startsWith("limit:")) {
      limitExpression = token.slice(6).trim();
      continue;
    }

    if (token.startsWith("offset:")) {
      offsetExpression = token.slice(7).trim();
      continue;
    }

    collectionTokens.push(token);
  }

  return {
    itemName: tokens[1],
    collectionPath: collectionTokens.join(" ").trim(),
    limitExpression,
    offsetExpression,
    reversed,
  };
}

export function createLoopMetadata(index, length) {
  return {
    index: index + 1,
    index0: index,
    first: index === 0,
    last: index === length - 1,
    length,
  };
}

export async function renderCapture(engine, handler) {
  const fragment = handler.capture.bufferParts.join(EMPTY_STRING);

  if (handler.capture.mode === "capture") {
    handler.currentContext[handler.capture.variableName] = await engine.renderFragment(
      fragment,
      createScope(handler.currentContext),
      handler.runtime,
      handler.renderDepth,
    );
    return EMPTY_STRING;
  }

  const output = [];
  const length = handler.capture.collection.length;

  for (let index = 0; index < length; index += 1) {
    if (engine.yieldAfter > 0 && index > 0 && index % engine.yieldAfter === 0) {
      await engine.yieldControl();
    }

    const item = handler.capture.collection[index];
    const loopScope = createScope(handler.currentContext);
    loopScope[handler.capture.itemName] = item;
    loopScope.forloop = createLoopMetadata(index, length);
    output.push(await engine.renderFragment(fragment, loopScope, handler.runtime, handler.renderDepth));
  }

  return output.join(EMPTY_STRING);
}

export const forTag = {
  name: "for",
  onEmit(ctx) {
    const handler = getHandler(ctx);
    const loop = parseForExpression(`for ${ctx.expression || EMPTY_STRING}`);
    const collection = resolveForCollection(ctx, loop, handler?.currentContext);

    return CAPTURE({
      capture: createCaptureState("for", {
        itemName: loop?.itemName || EMPTY_STRING,
        collection,
      }),
    });
  },
  onSkip() {
    return NEST();
  },
};

export const endfor = {
  name: "endfor",
  onEmit() {
    return CONTINUE();
  },
  onSkip() {
    return UNNEST();
  },
};

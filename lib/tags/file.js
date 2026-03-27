import {
  EMPTY_STRING,
  splitFilterNameAndArguments,
  tokenize,
} from "../utils.js";
import { renderPartial as renderPartialThroughContext } from "../tag.js";
import { OUTPUT } from "./signals.js";

/**
 * Parses a named partial argument like `title: page.title`.
 * @param {string} [expression=""]
 * @returns {{ name: string, valueExpression: string } | null}
 */
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

/**
 * Parses a `render` or `include` expression into a snippet and named arguments.
 * @param {string} [expression=""]
 * @returns {{ snippetExpression: string, argumentsList: { name: string, valueExpression: string }[] }}
 */
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

/**
 * Core `render` tag definition.
 * @returns {{ name: string, onEmit(ctx: object): Promise<object>, onSkip(): null }}
 */
export const render = {
  name: "render",
  async onEmit(ctx) {
    return OUTPUT(await renderPartialThroughContext(ctx, "render"), { html: true });
  },
  onSkip() {
    return null;
  },
};

/**
 * Core `include` tag definition.
 * @returns {{ name: string, onEmit(ctx: object): Promise<object>, onSkip(): null }}
 */
export const include = {
  name: "include",
  async onEmit(ctx) {
    return OUTPUT(await renderPartialThroughContext(ctx, "include"), { html: true });
  },
  onSkip() {
    return null;
  },
};

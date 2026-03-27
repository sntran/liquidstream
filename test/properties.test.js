import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fc from "fast-check";
import { Liquid, __private__ } from "../lib/mod.js";

const { isLiquidTruthy, resolvePathValue, splitTopLevel } = __private__;

function chunkText(handler, text, splitPoints = []) {
  const uniquePoints = [...new Set(splitPoints)]
    .filter((point) => point > 0 && point < text.length)
    .sort((left, right) => left - right);
  const parts = [];
  let cursor = 0;

  for (const point of uniquePoints) {
    parts.push(text.slice(cursor, point));
    cursor = point;
  }
  parts.push(text.slice(cursor));

  let rendered = "";

  return (async () => {
    for (let index = 0; index < parts.length; index += 1) {
      await handler.text({
        text: parts[index],
        lastInTextNode: index === parts.length - 1,
        replace(value) {
          rendered += value;
        },
      });
    }

    return rendered;
  })();
}

function clone(value) {
  return structuredClone(value);
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

const primitiveArbitrary = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
);

const jsonLikeArbitrary = fc.letrec((tie) => ({
  value: fc.oneof(
    primitiveArbitrary,
    fc.array(tie("value"), { maxLength: 4 }),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), tie("value"), {
      maxKeys: 4,
    }),
  ),
})).value;

describe("Liquid Property-Based Tests", () => {
  it("splitTopLevel preserves quoted separators when round-tripping", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string(), { maxLength: 6 }), async (segments) => {
        const quoted = segments.map((segment) => JSON.stringify(segment));
        const expression = quoted.join("|");

        assert.equal(splitTopLevel(expression, "|").join("|"), expression);
      }),
      { numRuns: 200 },
    );
  });

  it("streaming chunking is invariant for text nodes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), primitiveArbitrary, {
          maxKeys: 6,
        }),
        fc.array(fc.integer({ min: 0, max: 200 }), { maxLength: 32 }),
        async (template, context, splitPoints) => {
          const engine = new Liquid();
          const single = await chunkText(engine.createHandler(context), template, []);
          const chunked = await chunkText(
            engine.createHandler(context),
            template,
            splitPoints.map((point) => (template.length === 0 ? 0 : point % template.length)),
          );

          assert.equal(chunked, single);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("parseAndRender does not mutate the input context", async () => {
    await fc.assert(
      fc.asyncProperty(
        jsonLikeArbitrary.filter((value) => value && typeof value === "object" && !Array.isArray(value)),
        fc.string(),
        async (context, template) => {
          const engine = new Liquid();
          const original = clone(context);

          await engine.parseAndRender(template, context);

          assert.deepEqual(normalize(context), normalize(original));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("resolveExpression and resolvePathValue stay safe on arbitrary input", async () => {
    await fc.assert(
      fc.asyncProperty(
        jsonLikeArbitrary,
        fc.string(),
        fc.oneof(fc.string(), fc.integer()),
        async (context, expression, segment) => {
          const engine = new Liquid();
          const circular = { root: context };
          circular.self = circular;

          assert.doesNotThrow(() => resolvePathValue(context, segment));
          assert.doesNotThrow(() => engine.resolveExpression(expression, circular));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("Liquid truthiness only rejects false, null, and undefined", async () => {
    await fc.assert(
      fc.asyncProperty(fc.anything(), async (value) => {
        assert.equal(
          isLiquidTruthy(value),
          value !== false && value !== null && value !== undefined,
        );
      }),
      { numRuns: 200 },
    );
  });
});

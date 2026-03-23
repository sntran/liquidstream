import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Liquid } from "../src/index.js";

describe("Liquid Standard Filters", () => {
  it('supports the "now" keyword in the date filter', async () => {
    const RealDate = globalThis.Date;

    class MockDate extends RealDate {
      constructor(value) {
        super(value ?? "2026-03-21T12:00:00Z");
      }

      static now() {
        return new RealDate("2026-03-21T12:00:00Z").getTime();
      }
    }

    globalThis.Date = MockDate;

    try {
      const engine = new Liquid();
      const html = await engine.parseAndRender('{{ "now" | date: "%Y" }}', {});

      assert.equal(html, "2026");
    } finally {
      globalThis.Date = RealDate;
    }
  });

  it("supports date formatting with filter chaining", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '{{ " 2026-03-21 " | strip | date: "%B %d" }}',
      {},
    );

    assert.equal(html, "March 21");
  });

  it("supports Intl-backed weekday and month tokens", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '{{ "2026-03-21" | date: "%a, %A, %b, %B" }}',
      {},
    );

    assert.equal(html, "Sat, Saturday, Mar, March");
  });

  it("supports Date objects, date-time strings, and invalid numeric dates", async () => {
    const engine = new Liquid();

    const fromDate = await engine.parseAndRender(
      '{{ value | date: "%Y-%m-%d %H:%M:%S" }}',
      { value: new Date("2026-03-21T14:15:16Z") },
    );
    const fromDateTimeString = await engine.parseAndRender(
      '{{ value | date: "%Y-%m-%d %H:%M:%S" }}',
      { value: "2026-03-21T14:15:16Z" },
    );
    const invalidString = await engine.parseAndRender(
      '{{ value | date: "%Y" }}',
      { value: "not-a-date" },
    );
    const invalidNumber = await engine.parseAndRender(
      '{{ value | date: "%Y" }}',
      { value: Number.NaN },
    );

    assert.equal(fromDate, "2026-03-21 14:15:16");
    assert.equal(fromDateTimeString, "2026-03-21 14:15:16");
    assert.equal(invalidString, "");
    assert.equal(invalidNumber, "");
  });

  it("replaces multiple strftime tokens in one pass", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '{{ "2026-03-21" | date: "%Y-%m-%d %H:%M" }}',
      {},
    );

    assert.equal(html, "2026-03-21 00:00");
  });

  it("supports nested collection transforms", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '{{ users | map: "roles" | first | join: "-" }}',
      {
        users: [
          { name: "Alice", roles: ["admin", "editor"] },
          { name: "Bob", roles: ["author"] },
        ],
      },
    );

    assert.equal(html, "admin-editor");
  });

  it("maps missing keys without crashing", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '{{ users | map: "nickname" | join: "," }}',
      {
        users: [
          { nickname: "ace" },
          {},
          { nickname: "bee" },
        ],
      },
    );

    assert.equal(html, "ace,,bee");
  });

  it("keeps complex quoted filter arguments intact", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '{{ "" | default: "fixed: value, with commas" }}',
      {},
    );

    assert.equal(html, "fixed: value, with commas");
  });

  it("handles empty input values safely", async () => {
    const engine = new Liquid();

    const capitalized = await engine.parseAndRender('{{ "" | capitalize }}', {});
    const sized = await engine.parseAndRender("{{ null | size }}", {});
    const capitalizedNil = await engine.parseAndRender("{{ nil | capitalize }}", {});
    const downcasedNil = await engine.parseAndRender("{{ nil | downcase }}", {});
    const strippedNil = await engine.parseAndRender("{{ nil | strip }}", {});

    assert.equal(capitalized, "");
    assert.equal(sized, "0");
    assert.equal(capitalizedNil, "");
    assert.equal(downcasedNil, "");
    assert.equal(strippedNil, "");
  });

  it("uses default for false, null, and empty string", async () => {
    const engine = new Liquid();

    const falseValue = await engine.parseAndRender('{{ false | default: "fallback" }}', {});
    const nullValue = await engine.parseAndRender('{{ null | default: "fallback" }}', {});
    const emptyValue = await engine.parseAndRender('{{ "" | default: "fallback" }}', {});

    assert.equal(falseValue, "fallback");
    assert.equal(nullValue, "fallback");
    assert.equal(emptyValue, "fallback");
  });

  it("supports slice, split, first, and last", async () => {
    const engine = new Liquid();

    const sliced = await engine.parseAndRender('{{ "hello" | slice: 0, 2 }}', {});
    const slicedToEnd = await engine.parseAndRender('{{ "hello" | slice: 2 }}', {});
    const nilSlice = await engine.parseAndRender("{{ nil | slice: 1, 2 }}", {});
    const first = await engine.parseAndRender('{{ "a,b,c" | split: "," | first }}', {});
    const last = await engine.parseAndRender('{{ "a,b,c" | split: "," | last }}', {});
    const emptyFirst = await engine.parseAndRender('{{ "" | first }}', {});
    const emptyLast = await engine.parseAndRender('{{ "" | last }}', {});

    assert.equal(sliced, "he");
    assert.equal(slicedToEnd, "llo");
    assert.equal(nilSlice, "");
    assert.equal(first, "a");
    assert.equal(last, "c");
    assert.equal(emptyFirst, "");
    assert.equal(emptyLast, "");
  });

  it("supports multi-character join delimiters", async () => {
    const engine = new Liquid();

    const pipeJoined = await engine.parseAndRender(
      '{{ "a,b,c" | split: "," | join: " | " }}',
      {},
    );
    const punctuated = await engine.parseAndRender(
      '{{ "a,b,c" | split: "," | join: " ::: " }}',
      {},
    );
    const emptyJoin = await engine.parseAndRender('{{ nil | join: "," }}', {});

    assert.equal(pipeJoined, "a | b | c");
    assert.equal(punctuated, "a ::: b ::: c");
    assert.equal(emptyJoin, "");
  });

  it("supports generic string splitting and replacement", async () => {
    const engine = new Liquid();

    const split = await engine.parseAndRender(
      '{{ "red--green--blue" | split: "--" | join: "," }}',
      {},
    );
    const replaced = await engine.parseAndRender(
      '{{ "Hello, NAME. NAME!" | replace: "NAME", "World" }}',
      {},
    );

    assert.equal(split, "red,green,blue");
    assert.equal(replaced, "Hello, World. World!");
  });

  it("supports extra native-backed string filters", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '{{ "  hello  " | trim_start | trim_end | starts_with: "he" }}|{{ "liquid" | ends_with: "id" }}|{{ "stream" | includes: "rea" }}',
      {},
    );

    assert.equal(html, "true|true|true");
  });

  it("supports size on arrays and strings", async () => {
    const engine = new Liquid();

    const stringSize = await engine.parseAndRender('{{ "abc" | size }}', {});
    const arraySize = await engine.parseAndRender('{{ "a,b,c" | split: "," | size }}', {});
    const splitNilSize = await engine.parseAndRender('{{ nil | split: "," | size }}', {});
    const mappedNilSize = await engine.parseAndRender('{{ nil | map: "name" | size }}', {});
    const capitalizedWord = await engine.parseAndRender('{{ "hello" | capitalize }}', {});

    assert.equal(stringSize, "3");
    assert.equal(arraySize, "3");
    assert.equal(splitNilSize, "0");
    assert.equal(mappedNilSize, "0");
    assert.equal(capitalizedWord, "Hello");
  });

  it("returns zero for size on numbers", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender("{{ 12345 | size }}", {});

    assert.equal(html, "0");
  });

  it("returns an empty string for nil relative_url values", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender("{{ nil | relative_url }}", {});

    assert.equal(html, "");
  });

  it("allows constructor filters to override standard filters", async () => {
    const engine = new Liquid({
      filters: {
        upcase(value) {
          return `custom:${value}`;
        },
      },
    });

    const html = await engine.parseAndRender('{{ "hello" | upcase }}', {});

    assert.equal(html, "custom:hello");
  });

  it("supports adding new filters via registerFilter alongside standard filters", async () => {
    const engine = new Liquid();
    engine.registerFilter("surround", (value, left = "[", right = "]") => `${left}${value}${right}`);

    const html = await engine.parseAndRender(
      '{{ "hello" | upcase | surround: "(", ")" }}',
      {},
    );

    assert.equal(html, "(HELLO)");
  });

  it("keeps filter overrides isolated per Liquid instance", async () => {
    const customized = new Liquid();
    const standard = new Liquid();
    customized.registerFilter("downcase", (value) => `custom:${value}`);

    const customizedHtml = await customized.parseAndRender('{{ "HELLO" | downcase }}', {});
    const standardHtml = await standard.parseAndRender('{{ "HELLO" | downcase }}', {});

    assert.equal(customizedHtml, "custom:HELLO");
    assert.equal(standardHtml, "hello");
  });

  it("supports html, numeric, and url utility filters", async () => {
    const engine = new Liquid();

    const stripped = await engine.parseAndRender("{{ html | strip_html }}", {
      html: "<p>Hello</p>",
    });
    const breaks = await engine.parseAndRender("{{ text | newline_to_br }}", {
      text: "a\nb",
    });
    const numeric = await engine.parseAndRender(
      "{{ -2.2 | abs }}|{{ 2 | at_least: 5 }}|{{ 8 | at_most: 3 }}|{{ 2.1 | ceil }}|{{ 2.9 | floor }}|{{ 2.49 | round }}|{{ 2.51 | round }}|{{ -2.9 | trunc }}|{{ 9 | sqrt }}|{{ -3 | sign }}",
      {},
    );
    const encoded = await engine.parseAndRender('{{ "a b&c" | url_encode }}', {});
    const decoded = await engine.parseAndRender('{{ "a%20b%26c" | url_decode }}', {});

    assert.equal(stripped, "Hello");
    assert.equal(breaks, "a<br />b");
    assert.equal(numeric, "2.2|5|3|3|2|2|3|-2|3|-1");
    assert.equal(encoded, "a%20b%26c");
    assert.equal(decoded, "a b&amp;c");
  });

  it('supports the "raw" filter when auto-escaping is enabled', async () => {
    const engine = new Liquid();

    const escaped = await engine.parseAndRender("{{ html }}", {
      html: "<strong>safe</strong>",
    });
    const raw = await engine.parseAndRender("{{ html | raw }}", {
      html: "<strong>safe</strong>",
    });

    assert.equal(escaped, "&lt;strong&gt;safe&lt;/strong&gt;");
    assert.equal(raw, "<strong>safe</strong>");
  });
});

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Liquid } from "../src/index.js";

describe("Liquid Streaming State Machine", () => {
  it("wraps the input in a Response and passes it through HTMLRewriter", async () => {
    let transformInput;
    const selectors = [];

    class FakeHTMLRewriter {
      onDocument() {
        return this;
      }

      on(selector) {
        selectors.push(selector);
        return this;
      }

      transform(response) {
        transformInput = response.clone();
        return response;
      }
    }

    const engine = new Liquid({ HTMLRewriterClass: FakeHTMLRewriter });
    const html = await engine.parseAndRender("<div>Hello</div>", {});

    assert.ok(transformInput instanceof Response);
    assert.equal(await transformInput.text(), "<div>Hello</div>");
    assert.equal(html, "<div>Hello</div>");
    assert.deepEqual(selectors, ["*"]);
  });

  it("passes plain HTML through unchanged", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender("<div>Hello</div>", {});

    assert.equal(html, "<div>Hello</div>");
  });

  it("accepts non-object contexts by falling back to an empty scope", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender("{{ missing }}", 7);

    assert.equal(html, "");
  });

  it("replaces a basic variable", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender("<div>{{ count }}</div>", { count: 5 });

    assert.equal(html, "<div>5</div>");
  });

  it("resolves deep object paths", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender("{{ user.settings.theme }}", {
      user: { settings: { theme: "dark" } },
    });

    assert.equal(html, "dark");
  });

  it("replaces multiple tags in a single text node", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      "<p>{{ greeting }}, {{ user.name }}!</p>",
      { greeting: "Hello", user: { name: "Alice" } },
    );

    assert.equal(html, "<p>Hello, Alice!</p>");
  });

  it("supports array access with bracket and pseudo-property notation", async () => {
    const engine = new Liquid();

    const bracket = await engine.parseAndRender("{{ my_array[0] }}", {
      my_array: ["alpha", "beta"],
    });
    const first = await engine.parseAndRender("{{ my_array.first }}", {
      my_array: ["alpha", "beta"],
    });
    const last = await engine.parseAndRender("{{ my_array.last }}", {
      my_array: ["alpha", "beta"],
    });

    assert.equal(bracket, "alpha");
    assert.equal(first, "alpha");
    assert.equal(last, "beta");
  });

  it("renders undefined variables as empty strings", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender("<p>{{ nonExistent }}</p>", {});

    assert.equal(html, "<p></p>");
  });

  it("returns an empty string for empty input", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender("", {});

    assert.equal(html, "");
  });

  it("buffers split chunks until the text node is complete", async () => {
    const engine = new Liquid();
    const handler = engine.createHandler({
      user: { name: "Alice" },
      greeting: "Hello",
    });

    const earlyWrites = [];
    const first = {
      text: "{{ user.",
      lastInTextNode: false,
      replace(value) {
        earlyWrites.push(value);
      },
    };

    let rendered = "";
    let options;
    const second = {
      text: "name }} {{ greeting }}",
      lastInTextNode: true,
      replace(value, replaceOptions) {
        rendered = value;
        options = replaceOptions;
      },
    };

    await handler.text(first);
    await handler.text(second);

    assert.deepEqual(earlyWrites, [""]);
    assert.equal(rendered, "Alice Hello");
    assert.deepEqual(options, { html: true });
  });

  it("does not re-evaluate interpolated data as template code", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender("{{ v }}", {
      v: "{{ secret }}",
      secret: "FAIL",
    });

    assert.equal(html, "{{ secret }}");
  });

  it("treats zero and empty strings as truthy in conditions", async () => {
    const engine = new Liquid();

    const zero = await engine.parseAndRender(
      "{% assign x = 0 %}{% if x %}T{% else %}F{% endif %}",
      {},
    );
    const empty = await engine.parseAndRender(
      '{% assign x = "" %}{% if x %}T{% else %}F{% endif %}',
      {},
    );

    assert.equal(zero, "T");
    assert.equal(empty, "T");
  });

  it("supports Liquid whitespace control around variables and blocks", async () => {
    const engine = new Liquid();

    const variable = await engine.parseAndRender("A {{- value -}} B", {
      value: "x",
    });
    const block = await engine.parseAndRender(
      "A {%- if true -%} B {%- endif -%} C",
      {},
    );

    assert.equal(variable, "AxB");
    assert.equal(block, "ABC");
  });

  it("interpolates multiple attributes without mutating the iterator during traversal", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '<section data-title="{{ page.title }}" aria-label="{{ page.label }}"><span>ok</span></section>',
      {
        page: {
          title: "Laminar Flow",
          label: "Docs shell",
        },
      },
    );

    assert.equal(
      html,
      '<section data-title="Laminar Flow" aria-label="Docs shell"><span>ok</span></section>',
    );
  });

  it("renders loop variables with loop scope", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      "{% for i in list %}{{ i }}{% endfor %}",
      { list: [1, 2, 3] },
    );

    assert.equal(html, "123");
  });

  it("supports unless conditions", async () => {
    const engine = new Liquid();

    const shown = await engine.parseAndRender(
      "{% unless false %}visible{% endunless %}",
      {},
    );
    const hidden = await engine.parseAndRender(
      "{% unless true %}hidden{% endunless %}",
      {},
    );

    assert.equal(shown, "visible");
    assert.equal(hidden, "");
  });

  it('supports the "upcase" filter', async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender('{{ "test" | upcase }}', {});

    assert.equal(html, "TEST");
  });

  it('supports the "default" filter', async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '{{ undefined_var | default: "fallback" }}',
      {},
    );

    assert.equal(html, "fallback");
  });

  it('supports the "minus" filter for footer timing math', async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '{{ "1700000000123" | minus: 1700000000000 | append: "ms" }}',
      {},
    );

    assert.equal(html, "123ms");
  });

  it('supports the "date" filter tokens %s and %L', async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '{{ "2026-03-21T10:11:12.345Z" | date: "%s%L" }}',
      {},
    );

    assert.equal(html, "1774087872345");
  });

  it("keeps quoted filter arguments intact", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '{{ "" | default: "val:1,2" }}',
      {},
    );

    assert.equal(html, "val:1,2");
  });

  it("supports single-quoted filter arguments", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      "{{ '' | default: 'value:1,2' }}",
      {},
    );

    assert.equal(html, "value:1,2");
  });

  it("supports filter chains", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '{{ missing_name | default: "TeSt" | downcase }}',
      {},
    );

    assert.equal(html, "test");
  });

  it("ignores unknown filters and keeps the current value", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender('{{ "test" | missing_filter }}', {});

    assert.equal(html, "test");
  });

  it('treats undefined input safely with the "upcase" filter', async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender("{{ undefined_var | upcase }}", {});

    assert.equal(html, "");
  });

  it("assigns local variables", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '{% assign my_var = "hello" %}{{ my_var }}',
      {},
    );

    assert.equal(html, "hello");
  });

  it("captures rendered content into a local variable", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      'A{% capture ghost %}{% if true %}BOO{% endif %}{% endcapture %}B{{ ghost }}',
      {},
    );

    assert.equal(html, "ABBOO");
  });

  it("supports nested capture blocks", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      "{% capture outer %}A{% capture inner %}B{% endcapture %}{{ inner }}C{% endcapture %}{{ outer }}",
      {},
    );

    assert.equal(html, "ABC");
  });

  it("does not leak assigned variables out of a for-loop scope", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '{% assign label = "outer" %}{% for i in list %}{% assign label = i %}{{ label }}{% endfor %}{{ label }}',
      { list: [1, 2] },
    );

    assert.equal(html, "12outer");
  });

  it("supports nested for-loops inside loop capture", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      "{% for row in rows %}[{% for cell in row %}{{ cell }}{% endfor %}]{% endfor %}",
      { rows: [["a", "b"], ["c"]] },
    );

    assert.equal(html, "[ab][c]");
  });

  it("shadows assigned variables inside if-block scope", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      "{% assign x = 1 %}{% if true %}{% assign x = 2 %}{{ x }}{% endif %}{{ x }}",
      {},
    );

    assert.equal(html, "21");
  });

  it("renders logic tags inside attributes", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '<div class="{% if true %}active{% endif %}" id="{% for i in list %}{{ i }}{% endfor %}"></div>',
      { list: [1, 2, 3] },
    );

    assert.equal(html, '<div class="active" id="123"></div>');
  });

  it("renders variable tags directly inside attributes", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '<div data-id="{{ user.id }}"></div>',
      { user: { id: 7 } },
    );

    assert.equal(html, '<div data-id="7"></div>');
  });

  it("renders falsey interpolated attributes with native serializer output", async () => {
    const engine = new Liquid();

    const disabled = await engine.parseAndRender(
      '<input disabled="{{ is_disabled }}">',
      { is_disabled: "" },
    );
    const className = await engine.parseAndRender(
      '<div class="{{ my_class }}"></div>',
      { my_class: null },
    );
    const image = await engine.parseAndRender(
      '<img alt="{{ alt_text }}">',
      { alt_text: "Photo" },
    );

    assert.equal(disabled, '<input disabled="">');
    assert.equal(className, '<div class=""></div>');
    assert.equal(image, '<img alt="Photo">');
  });

  it("skips attribute parsing work for static attributes", async () => {
    const engine = new Liquid();
    let setCalls = 0;
    const handler = engine.createHandler({});

    await handler.element({
      tagName: "div",
      attributes: [["class", "static"]],
      onEndTag() {},
      removeAndKeepContent() {},
      setAttribute() {
        setCalls += 1;
      },
    });

    assert.equal(setCalls, 0);
  });

  it("does not serialize elements when interpolated attributes can be handled natively", async () => {
    const engine = new Liquid();
    const handler = engine.createHandler({ page: {}, site: { description: "Site desc" } });
    const attributes = [["content", "{{ page.description | default: site.description }}"]];
    let setValue = "";
    let beforeCalls = 0;
    let removedContent = false;

    await handler.element({
      tagName: "meta",
      attributes,
      before() {
        beforeCalls += 1;
      },
      onEndTag() {
        throw new Error("should not register end tag for native attribute handling");
      },
      removeAndKeepContent() {
        removedContent = true;
      },
      setAttribute(name, value) {
        const index = attributes.findIndex(([attributeName]) => attributeName === name);
        if (index !== -1) {
          attributes[index] = [name, value];
        }
        if (name === "content") {
          setValue = value;
        }
      },
    });

    assert.equal(setValue, "Site desc");
    assert.equal(beforeCalls, 0);
    assert.equal(removedContent, false);
  });

  it("exposes interpolate for direct variable rendering", () => {
    const engine = new Liquid();

    const html = engine.interpolate("Hello {{ user.name }}!", {
      user: { name: "Alice" },
    });

    assert.equal(html, "Hello Alice!");
  });

  it("supports whitespace control in direct interpolation", () => {
    const engine = new Liquid();

    const html = engine.interpolate("A {{- value -}} B", { value: "x" });

    assert.equal(html, "AxB");
  });

  it("leaves malformed interpolate tags untouched", () => {
    const engine = new Liquid();

    const html = engine.interpolate("Hello {{ user.name", {
      user: { name: "Alice" },
    });

    assert.equal(html, "Hello {{ user.name");
  });

  it("supports custom filters from constructor options", async () => {
    const engine = new Liquid({
      filters: {
        shout(value) {
          return `${value}!`;
        },
      },
    });

    const html = await engine.parseAndRender('{{ "wow" | shout }}', {});

    assert.equal(html, "wow!");
  });

  it("supports custom tags from constructor options", async () => {
    const engine = new Liquid({
      tags: {
        echo_upper({ expression, resolveExpression }) {
          return String(resolveExpression(expression, { applyFilters: false })).toUpperCase();
        },
      },
    });

    const html = await engine.parseAndRender('{% echo_upper "text" %}', {});

    assert.equal(html, "TEXT");
  });

  it("supports custom tags that return explicit html output", async () => {
    const engine = new Liquid({
      tags: {
        raw_box() {
          return { output: "<strong>hi</strong>", html: true };
        },
      },
    });

    const html = await engine.parseAndRender("{% raw_box %}", {});

    assert.equal(html, "<strong>hi</strong>");
  });

  it("supports custom tags that return escaped output objects", async () => {
    const engine = new Liquid();
    engine.registerTag("safe_box", () => ({
      output: "<strong>hi</strong>",
      html: false,
    }));

    const html = await engine.parseAndRender("{% safe_box %}", {});

    assert.equal(html, "&lt;strong&gt;hi&lt;/strong&gt;");
  });

  it("passes resolveArgument into custom tags", async () => {
    const engine = new Liquid({
      tags: {
        echo_arg({ expression, resolveArgument }) {
          return resolveArgument(expression);
        },
      },
    });

    const html = await engine.parseAndRender('{% echo_arg "text" %}', {});

    assert.equal(html, "text");
  });

  it("handles custom tags with nullish outputs", async () => {
    const engine = new Liquid({
      tags: {
        empty_html() {
          return { output: undefined, html: true };
        },
        empty_text() {
          return undefined;
        },
      },
    });

    const html = await engine.parseAndRender(
      "{% empty_html %}x{% empty_text %}",
      {},
    );

    assert.equal(html, "x");
  });

  it("supports disabling auto-escaping", async () => {
    const engine = new Liquid({ autoEscape: false });

    const html = await engine.parseAndRender("{{ html }}", {
      html: "<strong>safe</strong>",
    });

    assert.equal(html, "<strong>safe</strong>");
  });

  it("renders null values as empty strings when resolving output directly", () => {
    const engine = new Liquid();

    assert.equal(engine.renderResolvedValue(null), "");
  });

  it("handles direct value resolution edge cases", () => {
    const engine = new Liquid();

    assert.equal(engine.resolveArgument("", {}), "");
    assert.equal(engine.resolveArgument("user[", { user: { name: "Alice" } }), undefined);
    assert.equal(engine.resolveArgument("user[name]", { user: { name: "Alice" } }), "Alice");
    assert.equal(engine.resolveArgument('user["name"]', { user: { name: "Alice" } }), "Alice");
    assert.equal(engine.resolveArgument("user['name']", { user: { name: "Alice" } }), "Alice");
    assert.equal(engine.resolveArgument("user.name", { user: null }), undefined);
    assert.equal(engine.resolveArgument("name.first", { name: "Alice" }), "A");
    assert.equal(engine.resolveArgument("name.last", { name: "" }), undefined);
    assert.equal(engine.resolveArgument("items.last", { items: [] }), undefined);
    assert.equal(
      engine.resolveValue('"base" | missing"quoted:arg"', {}),
      "base",
    );
  });

  it("handles malformed for, assign, capture, variable, and block tags safely", async () => {
    const engine = new Liquid();

    const malformedFor = await engine.parseAndRender(
      "{% for broken %}ignored{% endfor %}",
      {},
    );
    const malformedAssign = await engine.parseAndRender(
      "{% assign broken %}{{ broken }}",
      {},
    );
    const malformedCapture = await engine.parseAndRender(
      "{% capture bad name %}x{% endcapture %}{{ bad }}",
      {},
    );
    const malformedVariable = await engine.parseAndRender("{{ broken", {});
    const malformedBlock = await engine.parseAndRender("{% if true", {});

    assert.equal(malformedFor, "");
    assert.equal(malformedAssign, "");
    assert.equal(malformedCapture, "");
    assert.equal(malformedVariable, "{{ broken");
    assert.equal(malformedBlock, "{% if true");
  });

  it("drops unfinished skipped and captured blocks safely", async () => {
    const engine = new Liquid();

    const skipped = await engine.parseAndRender("{% if false %}hidden", {});
    const nestedSkipped = await engine.parseAndRender(
      "{% if false %}{% if true %}",
      {},
    );
    const malformedSkipped = await engine.parseAndRender(
      "{% if false %}{% else",
      {},
    );
    const captured = await engine.parseAndRender("{% capture ghost %}boo", {});
    const malformedCaptured = await engine.parseAndRender(
      "{% capture ghost %}{% if true",
      {},
    );

    assert.equal(skipped, "");
    assert.equal(nestedSkipped, "");
    assert.equal(malformedSkipped, "");
    assert.equal(captured, "");
    assert.equal(malformedCaptured, "");
  });

  it("supports contains and equality conditions", async () => {
    const engine = new Liquid();

    const contains = await engine.parseAndRender(
      '{% if "abc" contains "b" %}yes{% endif %}',
      {},
    );
    const equality = await engine.parseAndRender(
      "{% if 3 == 3 %}match{% endif %}",
      {},
    );

    assert.equal(contains, "yes");
    assert.equal(equality, "match");
  });

  it("handles numeric dates and invalid dates safely", async () => {
    const engine = new Liquid();

    const timestamp = await engine.parseAndRender(
      '{{ stamp | date: "%Y-%m-%d" }}',
      { stamp: 0 },
    );
    const invalidObject = await engine.parseAndRender(
      '{{ value | date: "%Y" }}',
      { value: { not: "a date" } },
    );
    const invalidDate = await engine.parseAndRender(
      '{{ value | date: "%Y" }}',
      { value: new Date("invalid") },
    );

    assert.equal(timestamp, "1970-01-01");
    assert.equal(invalidObject, "");
    assert.equal(invalidDate, "");
  });

  it("supports array slice and empty first or last results", async () => {
    const engine = new Liquid();

    const sliced = await engine.parseAndRender(
      "{{ values | slice: 1, 2 | join: ',' }}",
      { values: [1, 2, 3, 4] },
    );
    const first = await engine.parseAndRender("{{ nil | first }}", {});
    const last = await engine.parseAndRender("{{ nil | last }}", {});
    const emptyLast = await engine.parseAndRender("{{ values | last }}", {
      values: [],
    });
    const defaulted = await engine.parseAndRender(
      '{{ "set" | default: "fallback" }}',
      {},
    );

    assert.equal(sliced, "2,3");
    assert.equal(first, "");
    assert.equal(last, "");
    assert.equal(emptyLast, "");
    assert.equal(defaulted, "set");
  });

  it("handles circular context references when resolving a concrete path", async () => {
    const engine = new Liquid();
    const user = { name: "Alice" };
    user.self = user;

    const html = await engine.parseAndRender("{{ user.self.name }}", { user });

    assert.equal(html, "Alice");
  });

  it("renders deeply nested conditionals and loops", async () => {
    const engine = new Liquid();
    let template = "";

    for (let index = 0; index < 55; index += 1) {
      template += "{% if true %}";
    }
    template += "{% for value in values %}{{ value }}{% endfor %}";
    for (let index = 0; index < 55; index += 1) {
      template += "{% endif %}";
    }

    const html = await engine.parseAndRender(template, { values: [1, 2, 3] });

    assert.equal(html, "123");
  });

  it("yields during large loop capture renders", async () => {
    let yieldCount = 0;
    const engine = new Liquid({
      yieldAfter: 100,
      yieldControl: async () => {
        yieldCount += 1;
      },
    });

    const html = await engine.parseAndRender(
      "{% for i in list %}{{ i }}{% endfor %}",
      { list: Array.from({ length: 250 }, (_, index) => index) },
    );

    assert.ok(html.startsWith("0123"));
    assert.equal(yieldCount, 2);
  });

  it("uses the default yield control with scheduler or setTimeout", async () => {
    const originalScheduler = globalThis.scheduler;
    const originalSetTimeout = globalThis.setTimeout;
    let schedulerCount = 0;
    let timeoutCount = 0;

    globalThis.scheduler = {
      async yield() {
        schedulerCount += 1;
      },
    };

    try {
      const schedulerEngine = new Liquid({ yieldAfter: 1 });
      await schedulerEngine.parseAndRender(
        "{% for i in list %}{{ i }}{% endfor %}",
        { list: [1, 2] },
      );

      delete globalThis.scheduler;
      globalThis.setTimeout = (callback) => {
        timeoutCount += 1;
        callback();
        return 0;
      };

      const timeoutEngine = new Liquid({ yieldAfter: 1 });
      await timeoutEngine.parseAndRender(
        "{% for i in list %}{{ i }}{% endfor %}",
        { list: [1, 2] },
      );
    } finally {
      if (originalScheduler === undefined) {
        delete globalThis.scheduler;
      } else {
        globalThis.scheduler = originalScheduler;
      }
      globalThis.setTimeout = originalSetTimeout;
    }

    assert.equal(schedulerCount, 1);
    assert.equal(timeoutCount, 1);
  });

  it("removes skipped elements and their end tags through the element handler", async () => {
    const engine = new Liquid();
    const handler = engine.createHandler({});

    await handler.text({
      text: "{% if false %}",
      lastInTextNode: true,
      replace() {},
    });

    let removedContent = false;
    let removedEndTag = false;
    let endTagHandler;
    const element = {
      attributes: [],
      onEndTag(callback) {
        endTagHandler = callback;
      },
      removeAndKeepContent() {
        removedContent = true;
      },
      setAttribute() {},
      tagName: "section",
    };

    await handler.element(element);
    endTagHandler({
      name: "section",
      remove() {
        removedEndTag = true;
      },
    });

    assert.equal(removedContent, true);
    assert.equal(removedEndTag, true);
  });

  it("handles direct else and empty capture state transitions", async () => {
    const engine = new Liquid();
    const parentContext = { scope: "parent" };
    const branchContext = { scope: "branch" };
    const elseHandler = {
      capture: null,
      currentContext: parentContext,
      ifStack: [{ truthy: false, parentContext, branchContext }],
      skipDepth: 0,
      skipMode: null,
      state: "EMIT",
      textBufferParts: [],
    };
    const elseOutput = await engine.processEmitText("{% else %}visible", elseHandler);

    const captureHandler = {
      capture: {
        bufferParts: [],
        collection: [],
        depth: 0,
        itemName: null,
        mode: "capture",
        variableName: "ghost",
      },
      currentContext: {},
      ifStack: [],
      skipDepth: 0,
      skipMode: null,
      state: "CAPTURE",
      textBufferParts: [],
    };
    const captureOutput = await engine.processCaptureText("", captureHandler);

    assert.equal(elseOutput, "visible");
    assert.equal(elseHandler.currentContext, branchContext);
    assert.equal(captureOutput, "");
  });

  it("serializes elements while capture mode is active", async () => {
    const engine = new Liquid();
    const handler = engine.createHandler({});

    await handler.text({
      text: "{% capture ghost %}",
      lastInTextNode: true,
      replace() {},
    });

    let endTagHandler;
    let removedContent = false;
    const element = {
      attributes: [["class", "quoted"], ["disabled", ""]],
      onEndTag(callback) {
        endTagHandler = callback;
      },
      removeAndKeepContent() {
        removedContent = true;
      },
      setAttribute() {},
      tagName: "em",
    };

    await handler.element(element);
    await handler.text({
      text: "hi",
      lastInTextNode: true,
      replace() {},
    });
    endTagHandler({ name: "em", remove() {} });

    let output = "";
    await handler.text({
      text: "{% endcapture %}{{ ghost }}",
      lastInTextNode: true,
      replace(value) {
        output = value;
      },
    });

    assert.equal(removedContent, true);
    assert.equal(output, "&lt;em class=&quot;quoted&quot; disabled&gt;hi&lt;/em&gt;");
  });

  it("minimizes falsey attributes while capture mode is active", async () => {
    const engine = new Liquid();
    const handler = engine.createHandler({});

    await handler.text({
      text: "{% capture ghost %}",
      lastInTextNode: true,
      replace() {},
    });

    let endTagHandler;
    await handler.element({
      attributes: [["class", ""]],
      onEndTag(callback) {
        endTagHandler = callback;
      },
      removeAndKeepContent() {},
      setAttribute() {},
      tagName: "div",
    });
    endTagHandler({ name: "div", remove() {} });

    let output = "";
    await handler.text({
      text: "{% endcapture %}{{ ghost }}",
      lastInTextNode: true,
      replace(value) {
        output = value;
      },
    });

    assert.equal(output, "&lt;div class&gt;&lt;/div&gt;");
  });

  it("serializes elements without attributes while capture mode is active", async () => {
    const engine = new Liquid();
    const handler = engine.createHandler({});

    await handler.text({
      text: "{% capture ghost %}",
      lastInTextNode: true,
      replace() {},
    });

    let endTagHandler;
    await handler.element({
      attributes: [],
      onEndTag(callback) {
        endTagHandler = callback;
      },
      removeAndKeepContent() {},
      setAttribute() {},
      tagName: "strong",
    });
    endTagHandler({ name: "strong", remove() {} });

    let output = "";
    await handler.text({
      text: "{% endcapture %}{{ ghost }}",
      lastInTextNode: true,
      replace(value) {
        output = value;
      },
    });

    assert.equal(output, "&lt;strong&gt;&lt;/strong&gt;");
  });

  it("resumes emit mode from a skipped false branch at else", async () => {
    const engine = new Liquid();
    const branchContext = { marker: "branch" };
    const handler = {
      capture: null,
      currentContext: {},
      ifStack: [{ parentContext: {}, branchContext, truthy: false }],
      skipDepth: 1,
      skipMode: "if_false",
      state: "SKIP",
      textBufferParts: [],
    };

    const output = await engine.processSkipText("{% else %}{{ marker }}", handler);

    assert.equal(output, "branch");
    assert.equal(handler.state, "EMIT");
    assert.equal(handler.currentContext, branchContext);
  });

  it("handles skip-state fallbacks when no frame is available", async () => {
    const engine = new Liquid();
    const currentContext = { marker: "stay" };
    const elseHandler = {
      capture: null,
      currentContext,
      ifStack: [],
      skipDepth: 1,
      skipMode: "if_false",
      state: "SKIP",
      textBufferParts: [],
    };
    const elseOutput = await engine.processSkipText("{%- else -%}{{ marker }}", elseHandler);

    const endifHandler = {
      capture: null,
      currentContext,
      ifStack: [],
      skipDepth: 1,
      skipMode: "else_branch",
      state: "SKIP",
      textBufferParts: [],
    };
    const endifOutput = await engine.processSkipText("{%- endif -%}{{ marker }}", endifHandler);

    assert.equal(elseOutput, "stay");
    assert.equal(elseHandler.currentContext, currentContext);
    assert.equal(endifOutput, "stay");
    assert.equal(endifHandler.currentContext, currentContext);
  });

  it("handles endif and non-array loop collections safely", async () => {
    const engine = new Liquid();
    const handler = {
      capture: null,
      currentContext: { marker: "after" },
      ifStack: [],
      skipDepth: 0,
      skipMode: null,
      state: "EMIT",
      textBufferParts: [],
    };

    const endifOutput = await engine.processEmitText("{% endif %}{{ marker }}", handler);
    const loopOutput = await engine.parseAndRender(
      "{% for item in map %}{{ item }}{% endfor %}",
      { map: { a: 1 } },
    );

    assert.equal(endifOutput, "after");
    assert.equal(loopOutput, "");
  });
});

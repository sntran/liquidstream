import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { HTMLRewriter } from "@sntran/html-rewriter";
import { Liquid } from "../src/index.js";
import { Liquid as LiquidJS } from "liquidjs";

const KB = 1024;
const MB = KB * KB;

function toMb(bytes) {
  return Number((bytes / MB).toFixed(2));
}

function gzipSize(source) {
  return gzipSync(source).length;
}

function detectDynamicCode(source) {
  return /\beval\s*\(|new Function\s*\(/.test(source);
}

async function measureAverageRender(engine, template, context, iterations = 100) {
  for (let index = 0; index < 20; index += 1) {
    await engine.parseAndRender(template, context);
  }

  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    await engine.parseAndRender(template, context);
  }

  return Number(((performance.now() - start) / iterations).toFixed(3));
}

function legacyNeedsElementHandling(template = "") {
  let inTag = false;

  for (let index = 0; index < template.length; index += 1) {
    const char = template[index];

    if (char === "<") {
      inTag = true;
      continue;
    }

    if (char === ">") {
      inTag = false;
      continue;
    }

    if (template.startsWith("{%", index)) {
      return true;
    }

    if (inTag && template.startsWith("{{", index)) {
      return true;
    }
  }

  return false;
}

async function measureStreamTtfb(engine, template, context, options = {}) {
  const { iterations = 10, preScan = false } = options;
  let totalMs = 0;
  let firstChunkBytes = 0;

  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();

    if (preScan) {
      legacyNeedsElementHandling(template);
    }

    const handler = engine.createHandler(context);
    const rewriter = new HTMLRewriter()
      .on("*", { element: handler.element })
      .onDocument({ text: handler.text });
    const response = rewriter.transform(new Response(template));
    const reader = response.body.getReader();
    const chunk = await reader.read();
    totalMs += performance.now() - start;
    firstChunkBytes = chunk.value?.length ?? 0;
    let nextChunk = chunk;

    while (!nextChunk.done) {
      nextChunk = await reader.read();
    }
  }

  return {
    firstChunkBytes,
    ttfbMs: Number((totalMs / iterations).toFixed(3)),
  };
}

async function measureStringTtfb(engine, template, context, iterations = 10) {
  let totalMs = 0;
  let output = "";

  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    output = await engine.parseAndRender(template, context);
    totalMs += performance.now() - start;
  }

  return {
    firstChunkBytes: output ? 1 : 0,
    ttfbMs: Number((totalMs / iterations).toFixed(3)),
  };
}

async function measurePeakHeap(label, render) {
  if (globalThis.gc) {
    globalThis.gc();
  }

  const startHeap = process.memoryUsage().heapUsed;
  let peakHeap = startHeap;
  const sampler = setInterval(() => {
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
  }, 1);

  const start = performance.now();
  const output = await render();
  const elapsedMs = performance.now() - start;
  peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);

  clearInterval(sampler);

  if (globalThis.gc) {
    globalThis.gc();
  }

  const endHeap = process.memoryUsage().heapUsed;

  return {
    label,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    outputBytes: Buffer.byteLength(output),
    startHeapMb: toMb(startHeap),
    peakHeapMb: toMb(peakHeap),
    peakDeltaMb: toMb(peakHeap - startHeap),
    endHeapMb: toMb(endHeap),
  };
}

const workerEngine = new Liquid();
const liquidjsEngine = new LiquidJS();

const simpleTemplate = "<div>{{ user.name }}</div>";
const simpleContext = { user: { name: "Alice" } };

const ttfbTemplate = [
  "<main>",
  `<header>${"H".repeat(MB)}</header>`,
  "{% for item in items %}",
  `<article>${"x".repeat(1024)}{{ item.name | capitalize }}</article>`,
  "{% endfor %}",
  "</main>",
].join("");
const loopItems = Array.from({ length: 1000 }, (_, index) => ({
  name: `item-${index}`,
}));
const heavyContext = { items: loopItems };

const bundleSources = await Promise.all([
  readFile(new URL("../src/index.js", import.meta.url)),
  readFile(new URL("../../../node_modules/liquidjs/dist/liquid.browser.mjs", import.meta.url)),
]);

const [workerSource, liquidjsSource] = bundleSources;

const report = {
  bundleSize: {
    workerLiquidGzipBytes: gzipSize(workerSource),
    liquidjsBrowserGzipBytes: gzipSize(liquidjsSource),
  },
  isolateSafety: {
    workerLiquidUsesDynamicCode: detectDynamicCode(workerSource.toString("utf8")),
    liquidjsBrowserUsesDynamicCode: detectDynamicCode(liquidjsSource.toString("utf8")),
  },
  timings: {
    simpleTemplateBytes: Buffer.byteLength(simpleTemplate),
    simpleAverageMs: {
      workerLiquid: await measureAverageRender(workerEngine, simpleTemplate, simpleContext),
      liquidjs: await measureAverageRender(liquidjsEngine, simpleTemplate, simpleContext),
    },
    firstByte: {
      workerLiquid: await measureStreamTtfb(workerEngine, ttfbTemplate, heavyContext),
      workerLiquidWithPreScan: await measureStreamTtfb(workerEngine, ttfbTemplate, heavyContext, {
        preScan: true,
      }),
      liquidjs: await measureStringTtfb(liquidjsEngine, ttfbTemplate, heavyContext),
    },
  },
  memory: {
    templateBytes: Buffer.byteLength(ttfbTemplate),
    itemCount: loopItems.length,
    workerLiquid: await measurePeakHeap("workerLiquid", () =>
      workerEngine.parseAndRender(ttfbTemplate, heavyContext),
    ),
    liquidjs: await measurePeakHeap("liquidjs", () =>
      liquidjsEngine.parseAndRender(ttfbTemplate, heavyContext),
    ),
  },
};

console.log(JSON.stringify(report, null, 2));

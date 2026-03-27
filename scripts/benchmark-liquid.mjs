import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { build } from "esbuild";
import { Liquid } from "../lib/mod.js";
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

function roundMs(value) {
  return Number(value.toFixed(3));
}

function summarizeDurations(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (ratio) => {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index];
  };

  const average = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    averageMs: roundMs(average),
    medianMs: roundMs(percentile(0.5)),
    p95Ms: roundMs(percentile(0.95)),
    minMs: roundMs(sorted[0]),
    maxMs: roundMs(sorted[sorted.length - 1]),
    samples: sorted.length,
  };
}

async function measureTransformAverage(engine, template, iterations = 100) {
  for (let index = 0; index < 20; index += 1) {
    await engine.transform(new Response(template)).text();
  }

  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    await engine.transform(new Response(template)).text();
  }

  return Number(((performance.now() - start) / iterations).toFixed(3));
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

async function measureTransformTtfb(engine, template, iterations = 25) {
  const durations = [];
  let firstChunkBytes = 0;

  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    const response = engine.transform(new Response(template));
    const reader = response.body.getReader();
    const chunk = await reader.read();
    durations.push(performance.now() - start);
    firstChunkBytes = chunk.value?.length ?? 0;
    let nextChunk = chunk;

    while (!nextChunk.done) {
      nextChunk = await reader.read();
    }
  }

  return {
    firstChunkBytes,
    ...summarizeDurations(durations),
  };
}

async function measureStringTtfb(engine, template, context, iterations = 25) {
  const durations = [];
  let output = "";

  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    output = await engine.parseAndRender(template, context);
    durations.push(performance.now() - start);
  }

  return {
    firstChunkBytes: output ? 1 : 0,
    ...summarizeDurations(durations),
  };
}

async function measureTransformText(engine, template) {
  return engine.transform(new Response(template)).text();
}

async function bundleSource(entryPoint) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    minify: true,
    platform: "node",
    target: "esnext",
    write: false,
  });

  return Buffer.from(result.outputFiles[0].contents);
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
const filterFirstByteTemplate = "{{ item.name | capitalize }}".repeat(16);
const loopItems = Array.from({ length: 1000 }, (_, index) => ({
  name: `item-${index}`,
}));
const heavyContext = { items: loopItems };
const filterFirstByteContext = { item: loopItems[0] };
const workerEngine = new Liquid()
  .on("user", {
    async node() {
      return simpleContext.user;
    },
  })
  .on("items", {
    async node() {
      return heavyContext.items;
    },
  })
  .on("item", {
    async node() {
      return filterFirstByteContext.item;
    },
  });
const liquidjsEngine = new LiquidJS();
const [workerSource, workerBundle, liquidjsSource] = await Promise.all([
  readFile(new URL("../lib/mod.js", import.meta.url)),
  bundleSource(new URL("../lib/mod.js", import.meta.url).pathname),
  readFile(new URL("../node_modules/liquidjs/dist/liquid.browser.mjs", import.meta.url)),
]);

const report = {
  bundleSize: {
    workerLiquidEntryGzipBytes: gzipSize(workerSource),
    workerLiquidBundleGzipBytes: gzipSize(workerBundle),
    liquidjsBrowserGzipBytes: gzipSize(liquidjsSource),
  },
  isolateSafety: {
    workerLiquidUsesDynamicCode: detectDynamicCode(workerSource.toString("utf8")),
    liquidjsBrowserUsesDynamicCode: detectDynamicCode(liquidjsSource.toString("utf8")),
  },
  timings: {
    simpleTemplateBytes: Buffer.byteLength(simpleTemplate),
    transformAverageMs: {
      workerLiquid: await measureTransformAverage(workerEngine, simpleTemplate),
      liquidjs: await measureAverageRender(liquidjsEngine, simpleTemplate, simpleContext),
    },
    firstByte: {
      staticPrefix: {
        workerLiquid: await measureTransformTtfb(workerEngine, ttfbTemplate),
        liquidjs: await measureStringTtfb(liquidjsEngine, ttfbTemplate, heavyContext),
      },
      filterDependent: {
        workerLiquid: await measureTransformTtfb(workerEngine, filterFirstByteTemplate),
        liquidjs: await measureStringTtfb(liquidjsEngine, filterFirstByteTemplate, filterFirstByteContext),
      },
    },
  },
  memory: {
    templateBytes: Buffer.byteLength(ttfbTemplate),
    itemCount: loopItems.length,
    workerLiquid: await measurePeakHeap("workerLiquid", () => measureTransformText(workerEngine, ttfbTemplate)),
    liquidjs: await measurePeakHeap("liquidjs", () =>
      liquidjsEngine.parseAndRender(ttfbTemplate, heavyContext),
    ),
  },
};

console.log(JSON.stringify(report, null, 2));

import { marked } from "marked";
import { Liquid } from "./src/index.js";
import jekyll from "./src/plugins/jekyll.js";

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=60",
};

const SITE_DATA = {
  title: "@sntran/liquidstream",
  description: "Streaming-first Liquid for Cloudflare Workers, edge runtimes, and Node.js.",
  environment: "Cloudflare Pages",
  url: "https://liquidstream.pages.dev",
  baseurl: "",
  benchmark_label: "Median TTFB 2.033 ms",
};

function slugifyHeading(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[`~!@#$%^&*()+=[\]{}|\\:;"'<>,.?/]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function createUniqueIdFactory() {
  const counts = new Map();

  return (value) => {
    const base = slugifyHeading(value) || "section";
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  };
}

async function fetchText(env, request, pathname) {
  const candidates = Array.isArray(pathname) ? pathname : [pathname];

  for (const candidate of candidates) {
    const assetRequest = new Request(new URL(candidate, request.url), request);
    const response = await env.ASSETS.fetch(assetRequest);

    if (response.ok) {
      return await response.text();
    }
  }

  throw new Error(`Missing asset: ${candidates.join(", ")}`);
}

function createLiquidFetch(env, request) {
  return async (input) => {
    const pathname = input instanceof Request
      ? new URL(input.url).pathname
      : new URL(String(input), "https://liquid.local/").pathname;

    if (pathname.startsWith("/") && pathname !== "/") {
      const candidates = [
        pathname,
        `/_includes${pathname}`,
      ];

      if (pathname.endsWith("/")) {
        candidates.unshift(`${pathname}index.html`);
      }

      for (const candidate of candidates) {
        const assetRequest = new Request(new URL(candidate, request.url), request);
        const response = await env.ASSETS.fetch(assetRequest);
        if (response.ok) {
          return response;
        }
      }
    }

    return new Response("", { status: 404 });
  };
}

function renderReadmePage(markdown) {
  const tokens = marked.lexer(markdown);
  const introTokens = [];
  const sections = [];
  const toc = [];
  const nextId = createUniqueIdFactory();
  let currentHeading = null;
  let currentTokens = [];
  let title = SITE_DATA.title;
  let description = SITE_DATA.description;

  const flushSection = () => {
    if (!currentHeading) {
      return;
    }

    const id = nextId(currentHeading.text);
    const headingHtml = marked.parser([currentHeading]).replace(
      /^<h2>/,
      `<h2 id="${id}">`,
    );
    const bodyHtml = marked.parser(currentTokens);
    sections.push({
      id,
      title: currentHeading.text.replace(/`/g, ""),
      html: `${headingHtml}${bodyHtml}`,
      body: bodyHtml,
    });
    toc.push({
      id,
      title: currentHeading.text.replace(/`/g, ""),
    });
    currentHeading = null;
    currentTokens = [];
  };

  for (const token of tokens) {
    if (token.type === "heading" && token.depth === 1 && token.text) {
      title = token.text.replace(/`/g, "");
    }

    if (description === SITE_DATA.description && token.type === "paragraph" && token.text) {
      description = token.text.replace(/`/g, "");
    }

    if (token.type === "heading" && token.depth === 2) {
      flushSection();
      currentHeading = token;
      continue;
    }

    if (currentHeading) {
      currentTokens.push(token);
    } else {
      introTokens.push(token);
    }
  }

  flushSection();

  return {
    title,
    description,
    toc,
    intro: marked.parser(introTokens),
    sections,
    content: `${marked.parser(introTokens)}${sections.map((section) => section.html).join("")}`,
  };
}

export function buildReadmePage(markdown, liquid) {
  if (!liquid) {
    return renderReadmePage(markdown);
  }

  return liquid.parseAndRender(markdown, {}).then((liquidProcessed) => renderReadmePage(liquidProcessed));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/" && url.pathname !== "/README.md" && url.pathname !== "/index.html") {
      return env.ASSETS.fetch(request);
    }

    const startedAt = Date.now();
    const [layout, readmeSource] = await Promise.all([
      fetchText(env, request, ["/_layouts/index.html", "/_layouts/"]),
      fetchText(env, request, "/README.md"),
    ]);
    const liquid = new Liquid({
      fetch: createLiquidFetch(env, request),
    }).plugin(jekyll);
    const readme = await buildReadmePage(readmeSource, liquid);

    const html = await liquid.parseAndRender(layout, {
      content: readme.content,
      page: {
        title: readme.title,
        description: readme.description,
        url: "/",
      },
      perf: {
        render_ms: Date.now() - startedAt,
        benchmark_label: SITE_DATA.benchmark_label,
      },
      site: SITE_DATA,
    });

    return new Response(html, {
      headers: HTML_HEADERS,
      status: 200,
    });
  },
};

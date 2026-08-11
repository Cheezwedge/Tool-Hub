/**
 * HTML → Markdown extraction, shared by every input mode of this tool.
 *
 * Nothing here touches the live DOM: pages are parsed with DOMParser into a
 * detached document, which never runs scripts, and only the resulting
 * Markdown *text* is ever shown. Fetched HTML is never injected into the page.
 */

import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/**
 * Containers docs sites actually use for the article body, most specific
 * first. Mirrors the heuristic in the Python crawler this tool replaces.
 */
const CONTENT_SELECTORS = [
  "main",
  "article",
  '[role="main"]',
  ".markdown-body",
  ".rm-Article",
  ".theme-doc-markdown",
  ".content",
  "#content",
  "#main",
];

/** Chrome that carries no information once the page is a Markdown archive. */
const DEFAULT_STRIP = [
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "button",
  '[aria-hidden="true"]',
  '[class*="sidebar" i]',
  '[class*="breadcrumb" i]',
  '[class*="pagination" i]',
  '[class*="cookie" i]',
  '[class*="banner" i]',
  '[class*="skip-link" i]',
];

function createTurndown() {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
    hr: "---",
  });

  // Tables are most of the value in API docs, so keep them as real GFM tables.
  service.use(gfm);

  // Turndown drops the language on highlighted code blocks that carry it on a
  // wrapper class rather than on <code> itself; docs sites do this constantly.
  service.addRule("fencedCodeWithLanguage", {
    filter: (node) =>
      node.nodeName === "PRE" && node.firstChild?.nodeName === "CODE",
    replacement: (_content, node) => {
      const code = node.firstChild;
      const className = `${code.getAttribute("class") ?? ""} ${
        node.getAttribute("class") ?? ""
      }`;
      const language = className.match(/(?:language|lang|highlight)-(\w+)/i);
      const text = code.textContent.replace(/\n$/, "");
      return `\n\n\`\`\`${language ? language[1] : ""}\n${text}\n\`\`\`\n\n`;
    },
  });

  return service;
}

const turndown = createTurndown();

/**
 * Parse an HTML string into a detached Document.
 *
 * @param {string} html
 * @returns {Document}
 */
export function parseHtml(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

/**
 * The page's title, preferring the visible heading over the <title> tag
 * (which usually carries a " | Site Name" suffix).
 *
 * @param {Document} doc
 * @param {string} fallback
 */
export function extractTitle(doc, fallback = "Untitled") {
  const heading = doc.querySelector("h1")?.textContent?.trim();
  if (heading) return heading;

  const title = doc.querySelector("title")?.textContent?.trim();
  return title || fallback;
}

/**
 * Pick the element holding the article body.
 *
 * @param {Document} doc
 * @param {string} [selector] explicit override; falls back to the heuristic
 * @returns {Element}
 */
export function findContent(doc, selector) {
  if (selector) {
    const chosen = doc.querySelector(selector);
    if (chosen) return chosen;
  }

  for (const candidate of CONTENT_SELECTORS) {
    const found = doc.querySelector(candidate);
    // Guard against empty shells — some sites have a <main> wrapping nothing.
    if (found && found.textContent.trim().length > 200) return found;
  }

  return doc.body ?? doc.documentElement;
}

/**
 * Make links and images absolute so the archive stays useful away from the
 * original site, and drop the chrome we never want in the output.
 *
 * @param {Element} root  mutated in place; it is a detached node
 * @param {string} baseUrl
 * @param {string[]} stripSelectors
 */
function cleanContent(root, baseUrl, stripSelectors) {
  for (const selector of [...DEFAULT_STRIP, ...stripSelectors]) {
    // A bad user-supplied selector should skip, not abort the whole crawl.
    try {
      for (const node of root.querySelectorAll(selector)) node.remove();
    } catch {
      /* invalid selector — ignore it */
    }
  }

  if (!baseUrl) return;

  for (const [tag, attribute] of [
    ["a", "href"],
    ["img", "src"],
  ]) {
    for (const node of root.querySelectorAll(`${tag}[${attribute}]`)) {
      const value = node.getAttribute(attribute);
      if (!value || value.startsWith("data:")) continue;
      try {
        node.setAttribute(attribute, new URL(value, baseUrl).href);
      } catch {
        /* unparseable URL — leave it as-is */
      }
    }
  }
}

/**
 * Convert one page of HTML into Markdown.
 *
 * @param {string} html
 * @param {object} [options]
 * @param {string} [options.baseUrl]          for resolving relative links
 * @param {string} [options.contentSelector]  override the auto-detection
 * @param {string[]} [options.stripSelectors] extra selectors to remove
 * @returns {{title: string, markdown: string, links: string[]}}
 */
export function convertPage(html, options = {}) {
  const { baseUrl = "", contentSelector = "", stripSelectors = [] } = options;

  const doc = parseHtml(html);
  const title = extractTitle(doc, baseUrl);

  // Collect links from the whole document, before stripping nav — the nav is
  // exactly where a docs site keeps its table of contents.
  const links = baseUrl ? collectLinks(doc, baseUrl) : [];

  const content = findContent(doc, contentSelector);
  cleanContent(content, baseUrl, stripSelectors);

  const raw = turndown
    .turndown(content.innerHTML)
    // Collapse the runs of blank lines that stripping leaves behind.
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const markdown = nestHeadings(raw, title).trim();

  return { title, markdown, links };
}

/**
 * Fit one page's headings under the `## <page title>` the archive gives it.
 *
 * Without this, a page's own `#` and `##` collide with the archive's own
 * levels and the combined document has no usable hierarchy — which matters
 * both for the table of contents and for anything reading the structure.
 *
 * Drops a leading H1 that just repeats the title, then pushes every remaining
 * heading down one level. Headings inside fenced code blocks are left alone —
 * a shell comment is not a heading.
 *
 * @param {string} markdown
 * @param {string} title
 * @returns {string}
 */
export function nestHeadings(markdown, title) {
  const normalise = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();
  const lines = markdown.split("\n");
  const out = [];

  let inFence = false;
  let seenContent = false;

  for (const line of lines) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push(line);
      seenContent = true;
      continue;
    }

    const heading = inFence ? null : line.match(/^(#{1,6})\s+(.*)$/);
    if (!heading) {
      if (line.trim()) seenContent = true;
      out.push(line);
      continue;
    }

    const [, hashes, text] = heading;

    // The page's own title, repeated at the very top — the archive already
    // printed it as the section heading.
    if (!seenContent && hashes.length === 1 && normalise(text) === normalise(title)) {
      continue;
    }

    seenContent = true;
    out.push(`${"#".repeat(Math.min(6, hashes.length + 1))} ${text}`);
  }

  return out.join("\n").replace(/^\n+/, "");
}

/**
 * Every absolute http(s) link on the page, de-duplicated.
 *
 * @param {Document} doc
 * @param {string} baseUrl
 * @returns {string[]}
 */
export function collectLinks(doc, baseUrl) {
  const found = new Set();

  for (const anchor of doc.querySelectorAll("a[href]")) {
    try {
      const url = new URL(anchor.getAttribute("href"), baseUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        found.add(url.href);
      }
    } catch {
      /* not a URL we can follow */
    }
  }

  return [...found];
}

/**
 * Drop the fragment and (optionally) the query so the same page isn't
 * crawled twice under different URLs.
 *
 * @param {string} url
 * @param {boolean} [keepQuery]
 */
export function normalizeUrl(url, keepQuery = false) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (!keepQuery) parsed.search = "";
    // Treat /docs and /docs/ as one page.
    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    return parsed.href;
  } catch {
    return url;
  }
}

/** Rough token estimate — English prose and code both land near 4 chars/token. */
export function estimateTokens(text) {
  return Math.round(text.length / 4);
}

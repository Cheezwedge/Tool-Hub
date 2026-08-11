import { mountHeader } from "../../components/header.js";
import { loadSettings, saveSettings, clearSettings } from "../../lib/storage.js";
import { downloadText, safeFilename } from "../../lib/download.js";
import { buildPythonScript } from "./script-template.js";
import {
  convertPage,
  estimateTokens,
  normalizeUrl,
} from "./extract.js";

const TOOL_ID = "site-to-markdown";

const DEFAULTS = {
  mode: "files",
  startUrl: "",
  scope: "prefix",
  maxPages: 200,
  delay: 500,
  proxy: "",
  renderJs: false,
  respectRobots: true,
  contentSelector: "",
  stripSelectors: "",
  excludePatterns: "",
  outputName: "site-archive.md",
  includeToc: true,
  sourceLinks: true,
};

const el = {
  modes: document.querySelectorAll(".s2m__mode"),
  panels: document.querySelectorAll("[data-panel]"),

  dropzone: document.getElementById("s2m-dropzone"),
  pickFiles: document.getElementById("s2m-pick-files"),
  pickDir: document.getElementById("s2m-pick-dir"),
  clear: document.getElementById("s2m-clear"),
  fileInput: document.getElementById("s2m-file-input"),
  dirInput: document.getElementById("s2m-dir-input"),
  queue: document.getElementById("s2m-queue"),

  startUrl: document.getElementById("s2m-url"),
  scope: document.getElementById("s2m-scope"),
  maxPages: document.getElementById("s2m-max"),
  maxPagesValue: document.getElementById("s2m-max-value"),
  delay: document.getElementById("s2m-delay"),
  delayValue: document.getElementById("s2m-delay-value"),
  proxy: document.getElementById("s2m-proxy"),
  renderJs: document.getElementById("s2m-render-js"),
  respectRobots: document.getElementById("s2m-robots"),

  contentSelector: document.getElementById("s2m-content"),
  stripSelectors: document.getElementById("s2m-strip"),
  excludePatterns: document.getElementById("s2m-exclude"),

  outputName: document.getElementById("s2m-output-name"),
  includeToc: document.getElementById("s2m-toc"),
  sourceLinks: document.getElementById("s2m-source-links"),
  reset: document.getElementById("s2m-reset"),

  run: document.getElementById("s2m-run"),
  stop: document.getElementById("s2m-stop"),
  download: document.getElementById("s2m-download"),
  copy: document.getElementById("s2m-copy"),
  progressBar: document.getElementById("s2m-progress-bar"),
  progressText: document.getElementById("s2m-progress-text"),
  stats: document.getElementById("s2m-stats"),
  statPages: document.getElementById("s2m-stat-pages"),
  statWords: document.getElementById("s2m-stat-words"),
  statChars: document.getElementById("s2m-stat-chars"),
  statTokens: document.getElementById("s2m-stat-tokens"),
  log: document.getElementById("s2m-log"),
  preview: document.getElementById("s2m-preview"),
};

const state = {
  mode: "files",
  /** Loaded local files: {name, path, file} */
  files: [],
  /** The built document, and what it should be called on disk. */
  output: "",
  outputFilename: "",
  running: false,
  stopRequested: false,
};

init();

function init() {
  mountHeader(TOOL_ID);
  applySettings(loadSettings(TOOL_ID, DEFAULTS));
  wireEvents();
  updateQueueUi();
  log("Ready.", "info");
}

/* ------------------------------------------------------------- settings */

function readSettings() {
  return {
    mode: state.mode,
    startUrl: el.startUrl.value.trim(),
    scope: el.scope.value,
    maxPages: Number(el.maxPages.value),
    delay: Number(el.delay.value),
    proxy: el.proxy.value.trim(),
    renderJs: el.renderJs.checked,
    respectRobots: el.respectRobots.checked,
    contentSelector: el.contentSelector.value.trim(),
    stripSelectors: el.stripSelectors.value,
    excludePatterns: el.excludePatterns.value,
    outputName: el.outputName.value.trim() || DEFAULTS.outputName,
    includeToc: el.includeToc.checked,
    sourceLinks: el.sourceLinks.checked,
  };
}

function applySettings(settings) {
  el.startUrl.value = settings.startUrl;
  el.scope.value = settings.scope;
  el.maxPages.value = settings.maxPages;
  el.delay.value = settings.delay;
  el.proxy.value = settings.proxy;
  el.renderJs.checked = settings.renderJs;
  el.respectRobots.checked = settings.respectRobots;
  el.contentSelector.value = settings.contentSelector;
  el.stripSelectors.value = settings.stripSelectors;
  el.excludePatterns.value = settings.excludePatterns;
  el.outputName.value = settings.outputName;
  el.includeToc.checked = settings.includeToc;
  el.sourceLinks.checked = settings.sourceLinks;

  setMode(settings.mode);
}

function syncDerivedUi() {
  el.maxPagesValue.value = `${el.maxPages.value} pages`;
  el.delayValue.value = `${el.delay.value} ms`;
  el.run.textContent = state.mode === "script" ? "Generate script" : "Convert";
}

function persist() {
  saveSettings(TOOL_ID, readSettings());
}

function setMode(mode) {
  state.mode = mode;

  for (const button of el.modes) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  }
  for (const panel of el.panels) {
    panel.hidden = !panel.dataset.panel.split(" ").includes(mode);
  }

  syncDerivedUi();
}

/* --------------------------------------------------------------- events */

function wireEvents() {
  for (const button of el.modes) {
    button.addEventListener("click", () => {
      if (state.running) return;
      setMode(button.dataset.mode);
      persist();
    });
  }

  const inputs = [
    el.startUrl,
    el.scope,
    el.maxPages,
    el.delay,
    el.proxy,
    el.renderJs,
    el.respectRobots,
    el.contentSelector,
    el.stripSelectors,
    el.excludePatterns,
    el.outputName,
    el.includeToc,
    el.sourceLinks,
  ];

  for (const input of inputs) {
    input.addEventListener("input", () => {
      syncDerivedUi();
      persist();
    });
  }

  el.pickFiles.addEventListener("click", () => el.fileInput.click());
  el.pickDir.addEventListener("click", () => el.dirInput.click());
  el.clear.addEventListener("click", () => {
    state.files = [];
    updateQueueUi();
  });

  el.fileInput.addEventListener("change", () => {
    addFiles([...el.fileInput.files].map((file) => ({ file, path: file.name })));
    el.fileInput.value = "";
  });

  el.dirInput.addEventListener("change", () => {
    addFiles(
      [...el.dirInput.files].map((file) => ({
        file,
        path: file.webkitRelativePath || file.name,
      }))
    );
    el.dirInput.value = "";
  });

  wireDropzone();

  el.reset.addEventListener("click", () => {
    clearSettings(TOOL_ID);
    applySettings({ ...DEFAULTS, mode: state.mode });
    persist();
    log("Options reset to defaults.", "info");
  });

  el.run.addEventListener("click", run);
  el.stop.addEventListener("click", () => {
    state.stopRequested = true;
    el.stop.disabled = true;
    log("Stopping after the current page…", "warn");
  });

  el.download.addEventListener("click", () => {
    if (!state.output) return;
    downloadText(
      state.output,
      state.outputFilename,
      state.outputFilename.endsWith(".py") ? "text/x-python" : "text/markdown"
    );
  });

  el.copy.addEventListener("click", async () => {
    if (!state.output) return;
    try {
      await navigator.clipboard.writeText(state.output);
      log("Copied to clipboard.", "ok");
    } catch {
      log("Clipboard blocked by the browser — use Download instead.", "warn");
    }
  });
}

function wireDropzone() {
  const zone = el.dropzone;

  zone.addEventListener("click", () => el.fileInput.click());
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      el.fileInput.click();
    }
  });

  for (const type of ["dragenter", "dragover"]) {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add("s2m__dropzone--over");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    zone.addEventListener(type, () => zone.classList.remove("s2m__dropzone--over"));
  }

  zone.addEventListener("drop", async (event) => {
    event.preventDefault();

    // Entries must be read synchronously — awaiting neuters the DataTransfer.
    const entries = [...(event.dataTransfer.items ?? [])]
      .filter((item) => item.kind === "file")
      .map((item) => item.webkitGetAsEntry?.())
      .filter(Boolean);

    if (entries.length > 0) {
      const collected = [];
      for (const entry of entries) await walkEntry(entry, "", collected);
      addFiles(collected);
      return;
    }

    addFiles([...event.dataTransfer.files].map((file) => ({ file, path: file.name })));
  });
}

async function walkEntry(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push({ file, path: prefix + entry.name });
    return;
  }
  if (!entry.isDirectory) return;

  const reader = entry.createReader();
  let batch;
  do {
    batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    for (const child of batch) await walkEntry(child, `${prefix + entry.name}/`, out);
  } while (batch.length > 0);
}

function isHtmlFile(path) {
  return /\.x?html?$/i.test(path);
}

function addFiles(items) {
  const html = items.filter(({ path, file }) => isHtmlFile(path || file.name));
  const seen = new Set(state.files.map((item) => item.path));

  for (const { file, path } of html) {
    if (seen.has(path)) continue;
    seen.add(path);
    state.files.push({ name: file.name, path, file });
  }

  // Directory order is arbitrary; a stable path sort makes output reproducible.
  state.files.sort((a, b) => a.path.localeCompare(b.path));

  const ignored = items.length - html.length;
  if (html.length > 0) log(`Added ${html.length} HTML file(s).`, "info");
  if (ignored > 0) log(`Ignored ${ignored} non-HTML file(s).`, "warn");

  updateQueueUi();
}

function updateQueueUi() {
  const count = state.files.length;
  el.queue.textContent =
    count === 0 ? "No files loaded yet." : `${count} HTML file(s) ready.`;
  el.queue.classList.toggle("s2m__queue--ready", count > 0);
}

/* ------------------------------------------------------------- building */

async function run() {
  if (state.running) return;

  const settings = readSettings();

  if (state.mode === "script") {
    generateScript(settings);
    return;
  }
  if (state.mode === "files") {
    await convertLocalFiles(settings);
    return;
  }
  await crawl(settings);
}

function generateScript(settings) {
  if (!settings.startUrl) {
    log("Enter a start URL first.", "error");
    return;
  }

  const script = buildPythonScript({
    ...settings,
    stripSelectors: splitList(settings.stripSelectors),
    excludePatterns: splitList(settings.excludePatterns),
  });

  const base = safeFilename(
    settings.outputName.replace(/\.md$/i, ""),
    "site-archive"
  );
  setOutput(script, `scrape_${base}.py`, null);

  log(`Generated ${script.split("\n").length} lines of Python.`, "ok");
  log(
    settings.renderJs
      ? "Run: pip install playwright beautifulsoup4 markdownify && playwright install chromium"
      : "Run: pip install requests beautifulsoup4 markdownify",
    "info"
  );
  el.progressText.textContent = "Script ready.";
  el.progressBar.style.width = "100%";
}

async function convertLocalFiles(settings) {
  if (state.files.length === 0) {
    log("Drop in some saved HTML pages first.", "error");
    return;
  }

  startRun();
  const pages = [];

  for (const [index, item] of state.files.entries()) {
    if (state.stopRequested) break;

    try {
      const html = await item.file.text();
      const page = convertPage(html, {
        contentSelector: settings.contentSelector,
        stripSelectors: splitList(settings.stripSelectors),
      });

      if (page.markdown) {
        pages.push({ title: page.title || item.name, url: item.path, markdown: page.markdown });
        log(`${item.path} — ${page.markdown.length} chars`, "ok");
      } else {
        log(`${item.path} — no content found, skipped`, "warn");
      }
    } catch (error) {
      log(`${item.path} — failed: ${error.message}`, "error");
    }

    setProgress(index + 1, state.files.length);
    await yieldToUi();
  }

  finishRun(pages, settings);
}

/* -------------------------------------------------------------- crawler */

/**
 * Fetch one page's HTML, through the configured proxy when there is one.
 *
 * A direct cross-origin fetch is almost always blocked by CORS; the failure
 * is deliberately reported in those terms rather than as a generic error.
 */
async function fetchPage(url, proxy) {
  const target = proxy ? proxy.replace("{url}", encodeURIComponent(url)) : url;

  let response;
  try {
    response = await fetch(target, { redirect: "follow" });
  } catch (error) {
    throw new Error(
      proxy
        ? `proxy request failed (${error.message})`
        : "blocked by CORS — set a fetch proxy, or use the script generator"
    );
  }

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const type = response.headers.get("Content-Type") ?? "";
  // Proxies often return text/plain; trust the extension-less default instead
  // of rejecting, but skip anything clearly not a document.
  if (/^(image|video|audio|application\/(pdf|zip|octet))/i.test(type)) {
    throw new Error(`not HTML (${type})`);
  }

  return response.text();
}

async function crawl(settings) {
  if (!settings.startUrl) {
    log("Enter a start URL first.", "error");
    return;
  }

  let origin;
  let prefix;
  try {
    const parsed = new URL(settings.startUrl);
    origin = parsed.origin;
    prefix = settings.scope === "prefix" ? parsed.pathname.replace(/\/[^/]*$/, "/") : "/";
  } catch {
    log("That start URL isn't valid.", "error");
    return;
  }

  const excludes = splitList(settings.excludePatterns)
    .map((pattern) => {
      try {
        return new RegExp(pattern);
      } catch {
        log(`Ignoring invalid exclude pattern: ${pattern}`, "warn");
        return null;
      }
    })
    .filter(Boolean);

  const inScope = (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== origin) return false;
      if (!parsed.pathname.startsWith(prefix)) return false;
      return !excludes.some((pattern) => pattern.test(url));
    } catch {
      return false;
    }
  };

  startRun();

  if (!settings.proxy) {
    log("No proxy set — trying a direct fetch. This fails on most sites.", "warn");
  }

  const queue = [normalizeUrl(settings.startUrl)];
  const seen = new Set(queue);
  const pages = [];

  while (queue.length > 0 && pages.length < settings.maxPages) {
    if (state.stopRequested) break;

    const url = queue.shift();

    try {
      const html = await fetchPage(url, settings.proxy);
      const page = convertPage(html, {
        baseUrl: url,
        contentSelector: settings.contentSelector,
        stripSelectors: splitList(settings.stripSelectors),
      });

      if (page.markdown) {
        pages.push({ title: page.title, url, markdown: page.markdown });
        log(`${page.title} — ${url}`, "ok");
      } else {
        log(`${url} — no content found, skipped`, "warn");
      }

      for (const link of page.links) {
        const next = normalizeUrl(link);
        if (!seen.has(next) && inScope(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    } catch (error) {
      log(`${url} — ${error.message}`, "error");
      // A CORS failure on the very first page means nothing will ever work.
      if (pages.length === 0 && !settings.proxy) break;
    }

    setProgress(pages.length, Math.min(settings.maxPages, pages.length + queue.length));
    if (settings.delay > 0) await sleep(settings.delay);
    else await yieldToUi();
  }

  finishRun(pages, settings);
}

/* ------------------------------------------------------------ assembling */

function startRun() {
  state.running = true;
  state.stopRequested = false;
  el.run.disabled = true;
  el.stop.disabled = false;
  el.progressBar.style.width = "0%";
}

function finishRun(pages, settings) {
  state.running = false;
  el.run.disabled = false;
  el.stop.disabled = true;
  el.progressBar.style.width = "100%";

  if (pages.length === 0) {
    el.progressText.textContent = "Nothing captured.";
    log("No pages produced any content.", "error");
    return;
  }

  const markdown = assemble(pages, settings);
  setOutput(markdown, safeFilename(settings.outputName, "site-archive"), pages.length);

  el.progressText.textContent = `Done — ${pages.length} page(s).`;
  log(`Built ${settings.outputName} from ${pages.length} page(s).`, "ok");
}

/** Turn the collected pages into one Markdown document. */
function assemble(pages, settings) {
  const parts = [];
  const heading = titleFor(settings);

  parts.push(`# ${heading}\n`);
  if (settings.startUrl) parts.push(`Source: ${settings.startUrl}  `);
  parts.push(`Pages: ${pages.length}  `);
  parts.push(`Generated: ${new Date().toISOString().slice(0, 10)}\n`);

  if (settings.includeToc) {
    parts.push("## Contents\n");
    for (const page of pages) parts.push(`- [${page.title}](#${slugify(page.title)})`);
    parts.push("");
  }

  parts.push("---\n");

  for (const page of pages) {
    parts.push(`## ${page.title}\n`);
    if (settings.sourceLinks) parts.push(`*Source: ${page.url}*\n`);
    parts.push(page.markdown);
    parts.push("\n---\n");
  }

  return parts.join("\n");
}

function titleFor(settings) {
  if (!settings.startUrl) return "Documentation archive";
  try {
    return `Archive of ${new URL(settings.startUrl).hostname}`;
  } catch {
    return "Documentation archive";
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Publish a built document: preview, stats and the download/copy buttons. */
function setOutput(text, filename, pageCount) {
  state.output = text;
  state.outputFilename = filename;

  el.download.disabled = false;
  el.copy.disabled = false;
  el.download.textContent = `Download ${filename}`;

  const words = text.trim().split(/\s+/).length;
  el.stats.hidden = false;
  el.statPages.textContent = pageCount === null ? "—" : pageCount.toLocaleString();
  el.statWords.textContent = words.toLocaleString();
  el.statChars.textContent = text.length.toLocaleString();
  el.statTokens.textContent = estimateTokens(text).toLocaleString();

  el.preview.textContent =
    text.length > 40000 ? `${text.slice(0, 40000)}\n\n… preview truncated` : text;
}

/* ------------------------------------------------------------------- ui */

function setProgress(done, total) {
  const percent = total === 0 ? 0 : Math.min(100, (done / total) * 100);
  el.progressBar.style.width = `${percent}%`;
  el.progressText.textContent = `${done} of ${total}`;
}

function log(message, kind = "info") {
  const line = document.createElement("div");
  line.className = `log__line log__line--${kind}`;
  line.textContent = message;

  el.log.append(line);
  while (el.log.childElementCount > 500) el.log.firstElementChild.remove();
  el.log.scrollTop = el.log.scrollHeight;
}

function splitList(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Let the browser paint progress and keep Stop responsive. */
function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

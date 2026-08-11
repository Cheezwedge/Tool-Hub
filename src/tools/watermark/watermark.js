import JSZip from "jszip";
import { saveAs } from "file-saver";

import { mountHeader } from "../../components/header.js";
import { loadSettings, saveSettings, clearSettings } from "../../lib/storage.js";
import { canvasToBlob } from "../../lib/download.js";
import {
  JPEG_QUALITY,
  composite,
  decodeImage,
  hasSuffix,
  isImageFilename,
  outputFilename,
  resolveOutputType,
} from "./composite.js";

const TOOL_ID = "watermark";

const DEFAULTS = {
  mode: "folder",
  suffix: "_wm",
  position: "SouthEast",
  opacity: 70,
  scale: 10,
  margin: 10,
  autoOrient: true,
  shadow: true,
  shadowOpacity: 100,
  shadowBlur: 10,
  shadowOffsetX: 10,
  shadowOffsetY: 10,
  format: "keep",
  watermarkName: "",
};

/** Chromium-only; Firefox and Safari get the ZIP path instead. */
const SUPPORTS_DIRECTORY_PICKER =
  typeof window.showDirectoryPicker === "function";

/** Widest edge used for the placement preview, to keep it cheap to redraw. */
const PREVIEW_MAX_WIDTH = 900;

const el = {
  modes: document.getElementById("wm-modes"),
  modeFolder: document.getElementById("wm-mode-folder"),
  modeZip: document.getElementById("wm-mode-zip"),
  sourcePanels: document.querySelectorAll("[data-source-panel]"),

  pickFolder: document.getElementById("wm-pick-folder"),
  dropzone: document.getElementById("wm-dropzone"),
  pickFiles: document.getElementById("wm-pick-files"),
  pickDirInput: document.getElementById("wm-pick-dir-input"),
  clearFiles: document.getElementById("wm-clear-files"),
  fileInput: document.getElementById("wm-file-input"),
  dirInput: document.getElementById("wm-dir-input"),
  queue: document.getElementById("wm-queue"),

  watermarkInput: document.getElementById("wm-image"),
  watermarkName: document.getElementById("wm-image-name"),
  previewWrap: document.getElementById("wm-preview-wrap"),
  preview: document.getElementById("wm-preview"),

  suffix: document.getElementById("wm-suffix"),
  position: document.getElementById("wm-position"),
  opacity: document.getElementById("wm-opacity"),
  scale: document.getElementById("wm-scale"),
  margin: document.getElementById("wm-margin"),
  autoOrient: document.getElementById("wm-autoorient"),
  format: document.getElementById("wm-format"),

  shadow: document.getElementById("wm-shadow"),
  shadowFields: document.getElementById("wm-shadow-fields"),
  shadowOpacity: document.getElementById("wm-shadow-opacity"),
  shadowBlur: document.getElementById("wm-shadow-blur"),
  shadowOffsetX: document.getElementById("wm-shadow-x"),
  shadowOffsetY: document.getElementById("wm-shadow-y"),
  reset: document.getElementById("wm-reset"),

  start: document.getElementById("wm-start"),
  stop: document.getElementById("wm-stop"),
  progressBar: document.getElementById("wm-progress-bar"),
  progressText: document.getElementById("wm-progress-text"),
  log: document.getElementById("wm-log"),
};

/** Live state. Nothing here is persisted — only the option values are. */
const state = {
  mode: "zip",
  /** Every image found, before the suffix filter: {name, dir?, handle?, file?, path} */
  scanned: [],
  directoryLabel: "",
  watermark: null,
  previewSource: null,
  running: false,
  stopRequested: false,
};

/** Canvas reused for every processed image. */
const workCanvas = document.createElement("canvas");
let previewTimer;

init();

function init() {
  mountHeader(TOOL_ID);

  el.modeFolder.hidden = !SUPPORTS_DIRECTORY_PICKER;
  // With only one mode available the switcher is noise.
  el.modes.hidden = !SUPPORTS_DIRECTORY_PICKER;

  const saved = loadSettings(TOOL_ID, DEFAULTS);
  if (!SUPPORTS_DIRECTORY_PICKER) saved.mode = "zip";
  applySettings(saved);

  wireEvents();
  updateQueueUi();

  log(
    SUPPORTS_DIRECTORY_PICKER
      ? "Ready. Folder mode will write watermarked copies next to the originals."
      : "Ready. This browser can't write files back to a folder, so results come out as a ZIP.",
    "info"
  );

  if (saved.watermarkName) {
    el.watermarkName.textContent = `Last used: ${saved.watermarkName} — reload it to start.`;
  }
}

/* ------------------------------------------------------------- settings */

function readSettings() {
  return {
    mode: state.mode,
    suffix: el.suffix.value,
    position: el.position.value,
    opacity: Number(el.opacity.value),
    scale: Number(el.scale.value),
    margin: Number(el.margin.value),
    autoOrient: el.autoOrient.checked,
    shadow: el.shadow.checked,
    shadowOpacity: Number(el.shadowOpacity.value),
    shadowBlur: Number(el.shadowBlur.value),
    shadowOffsetX: Number(el.shadowOffsetX.value),
    shadowOffsetY: Number(el.shadowOffsetY.value),
    format: el.format.value,
    watermarkName: state.watermark ? state.watermark.name : "",
  };
}

function applySettings(settings) {
  el.suffix.value = settings.suffix;
  el.position.value = settings.position;
  el.opacity.value = settings.opacity;
  el.scale.value = settings.scale;
  el.margin.value = settings.margin;
  el.autoOrient.checked = settings.autoOrient;
  el.shadow.checked = settings.shadow;
  el.shadowOpacity.value = settings.shadowOpacity;
  el.shadowBlur.value = settings.shadowBlur;
  el.shadowOffsetX.value = settings.shadowOffsetX;
  el.shadowOffsetY.value = settings.shadowOffsetY;
  el.format.value = settings.format;

  setMode(settings.mode);
  syncDerivedUi();
}

/** Readouts and enabled/disabled states that follow from the inputs. */
function syncDerivedUi() {
  document.getElementById("wm-opacity-value").value = `${el.opacity.value}%`;
  document.getElementById("wm-scale-value").value = `${el.scale.value}%`;
  document.getElementById("wm-margin-value").value = `${el.margin.value} px`;
  document.getElementById("wm-shadow-opacity-value").value = `${el.shadowOpacity.value}%`;
  document.getElementById("wm-shadow-blur-value").value = `${el.shadowBlur.value} px`;
  document.getElementById("wm-shadow-x-value").value = `${el.shadowOffsetX.value} px`;
  document.getElementById("wm-shadow-y-value").value = `${el.shadowOffsetY.value} px`;

  el.shadowFields.disabled = !el.shadow.checked;
}

function persist() {
  saveSettings(TOOL_ID, readSettings());
}

function setMode(mode) {
  state.mode = SUPPORTS_DIRECTORY_PICKER ? mode : "zip";

  el.modeFolder.setAttribute("aria-pressed", String(state.mode === "folder"));
  el.modeZip.setAttribute("aria-pressed", String(state.mode === "zip"));

  for (const panel of el.sourcePanels) {
    panel.hidden = panel.dataset.sourcePanel !== state.mode;
  }
}

/* --------------------------------------------------------------- events */

function wireEvents() {
  el.modeFolder.addEventListener("click", () => switchMode("folder"));
  el.modeZip.addEventListener("click", () => switchMode("zip"));

  el.pickFolder.addEventListener("click", pickDirectory);
  el.pickFiles.addEventListener("click", () => el.fileInput.click());
  el.pickDirInput.addEventListener("click", () => el.dirInput.click());
  el.clearFiles.addEventListener("click", () => {
    state.scanned = [];
    state.directoryLabel = "";
    setPreviewSource(null);
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

  el.watermarkInput.addEventListener("change", loadWatermark);

  const optionInputs = [
    el.suffix,
    el.position,
    el.opacity,
    el.scale,
    el.margin,
    el.autoOrient,
    el.format,
    el.shadow,
    el.shadowOpacity,
    el.shadowBlur,
    el.shadowOffsetX,
    el.shadowOffsetY,
  ];

  for (const input of optionInputs) {
    input.addEventListener("input", () => {
      syncDerivedUi();
      persist();
      updateQueueUi();

      // Orientation changes how the backdrop itself decodes, so the preview
      // needs a fresh decode rather than just a redraw.
      if (input === el.autoOrient) refreshPreviewSource();
      else schedulePreview();
    });
  }

  el.reset.addEventListener("click", () => {
    clearSettings(TOOL_ID);
    applySettings({ ...DEFAULTS, mode: state.mode });
    persist();
    updateQueueUi();
    schedulePreview();
    log("Options reset to defaults.", "info");
  });

  el.start.addEventListener("click", start);
  el.stop.addEventListener("click", () => {
    state.stopRequested = true;
    el.stop.disabled = true;
    log("Stopping after the current image…", "warn");
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.running) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function switchMode(mode) {
  if (state.running) return;

  setMode(mode);
  state.scanned = [];
  state.directoryLabel = "";
  setPreviewSource(null);
  persist();
  updateQueueUi();
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
      zone.classList.add("wm__dropzone--over");
    });
  }

  for (const type of ["dragleave", "drop"]) {
    zone.addEventListener(type, () => zone.classList.remove("wm__dropzone--over"));
  }

  zone.addEventListener("drop", async (event) => {
    event.preventDefault();

    // Entries must be taken synchronously — the DataTransfer is neutered
    // as soon as we await.
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

/* ------------------------------------------------------- source gathering */

/** Recurse a dropped FileSystemEntry, preserving its relative path. */
async function walkEntry(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push({ file, path: prefix + entry.name });
    return;
  }

  if (!entry.isDirectory) return;

  const reader = entry.createReader();
  let batch;

  // readEntries returns at most ~100 entries per call; loop until empty.
  do {
    batch = await new Promise((resolve, reject) =>
      reader.readEntries(resolve, reject)
    );
    for (const child of batch) {
      await walkEntry(child, `${prefix + entry.name}/`, out);
    }
  } while (batch.length > 0);
}

function addFiles(items) {
  const images = items.filter(({ file, path }) => isImageFilename(path || file.name));
  const seen = new Set(state.scanned.map((item) => item.path));

  for (const { file, path } of images) {
    if (seen.has(path)) continue;
    seen.add(path);
    state.scanned.push({ name: file.name, path, file });
  }

  const skipped = items.length - images.length;
  if (images.length > 0) {
    log(`Added ${images.length} image${images.length === 1 ? "" : "s"}.`, "info");
  }
  if (skipped > 0) {
    log(`Ignored ${skipped} non-image file${skipped === 1 ? "" : "s"}.`, "warn");
  }

  updateQueueUi();
  refreshPreviewSource();
}

async function pickDirectory() {
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });

    const permission = await handle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      log("Write permission denied for that folder.", "error");
      return;
    }

    el.pickFolder.disabled = true;
    log(`Scanning "${handle.name}"…`, "info");

    const found = [];
    await scanDirectory(handle, "", found);

    state.scanned = found;
    state.directoryLabel = handle.name;
    el.pickFolder.disabled = false;

    log(`Found ${found.length} image${found.length === 1 ? "" : "s"}.`, "info");
    updateQueueUi();
    refreshPreviewSource();
  } catch (error) {
    el.pickFolder.disabled = false;
    if (error?.name === "AbortError") return;
    log(`Could not open that folder: ${error.message}`, "error");
  }
}

async function scanDirectory(dirHandle, prefix, out) {
  for await (const entry of dirHandle.values()) {
    if (entry.kind === "directory") {
      await scanDirectory(entry, `${prefix + entry.name}/`, out);
    } else if (isImageFilename(entry.name)) {
      out.push({
        name: entry.name,
        path: prefix + entry.name,
        handle: entry,
        dir: dirHandle,
      });
    }
  }
}

/** The subset of scanned images that will actually be processed. */
function pendingImages() {
  const suffix = el.suffix.value;
  return state.scanned.filter((item) => !hasSuffix(item.name, suffix));
}

function updateQueueUi() {
  const pending = pendingImages();
  const skipped = state.scanned.length - pending.length;

  if (state.scanned.length === 0) {
    el.queue.textContent =
      state.mode === "folder"
        ? "No folder chosen yet."
        : "No images selected yet.";
    el.queue.classList.remove("wm__queue--ready");
  } else {
    const where = state.directoryLabel ? ` in "${state.directoryLabel}"` : "";
    const skipNote = skipped > 0 ? ` (${skipped} already watermarked, skipped)` : "";
    el.queue.textContent = `${pending.length} image${pending.length === 1 ? "" : "s"} ready${where}${skipNote}.`;
    el.queue.classList.toggle("wm__queue--ready", pending.length > 0);
  }

  el.start.disabled = state.running || pending.length === 0 || !state.watermark;
}

/* ----------------------------------------------------------- watermark */

async function loadWatermark() {
  const file = el.watermarkInput.files?.[0];
  if (!file) return;

  try {
    state.watermark?.bitmap?.close?.();

    const bitmap = await decodeImage(file, true);
    state.watermark = { name: file.name, bitmap };

    el.watermarkName.textContent = `${file.name} — ${bitmap.width}×${bitmap.height}`;
    log(`Watermark loaded: ${file.name}`, "ok");

    persist();
    updateQueueUi();
    schedulePreview();
  } catch (error) {
    state.watermark = null;
    el.watermarkName.textContent = "Could not read that image.";
    log(`Watermark failed to load: ${error.message}`, "error");
    updateQueueUi();
  }
}

/* ------------------------------------------------------------- preview */

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 120);
}

/** Use the first queued image as the preview backdrop when we can. */
async function refreshPreviewSource() {
  const [first] = pendingImages();
  if (!first) {
    setPreviewSource(null);
    return;
  }

  try {
    const blob = first.file ?? (await first.handle.getFile());
    setPreviewSource(await decodeImage(blob, el.autoOrient.checked));
    renderPreview();
  } catch {
    setPreviewSource(null);
  }
}

function setPreviewSource(bitmap) {
  state.previewSource?.close?.();
  state.previewSource = bitmap;

  if (!bitmap) renderPreview();
}

/**
 * Draw the placement preview.
 *
 * The backdrop is downscaled first so redrawing on every slider move stays
 * cheap. Pixel-based options (margin, shadow) are scaled by the same ratio,
 * which keeps the preview geometrically faithful to the full-size output —
 * scale is a percentage of width, so it needs no adjustment.
 */
function renderPreview() {
  if (!state.watermark) {
    el.previewWrap.hidden = true;
    return;
  }

  const backdrop = state.previewSource ?? sampleBackdrop(1600, 1050);
  const width = Math.min(PREVIEW_MAX_WIDTH, backdrop.width);
  const ratio = width / backdrop.width;
  const height = Math.max(1, Math.round(backdrop.height * ratio));

  const scaled = document.createElement("canvas");
  scaled.width = width;
  scaled.height = height;
  scaled.getContext("2d").drawImage(backdrop, 0, 0, width, height);

  composite(el.preview, scaled, state.watermark.bitmap, readSettings(), { ratio });
  el.previewWrap.hidden = false;
}

/** A neutral gradient stand-in used before any images are selected. */
function sampleBackdrop(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#5a6472");
  gradient.addColorStop(0.5, "#d8dde3");
  gradient.addColorStop(1, "#2b3038");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  return canvas;
}

/* ------------------------------------------------------------ processing */

async function start() {
  if (state.running) return;

  const queue = pendingImages();
  if (queue.length === 0 || !state.watermark) return;

  const settings = readSettings();

  state.running = true;
  state.stopRequested = false;
  el.start.disabled = true;
  el.stop.disabled = false;
  setProgress(0, queue.length);

  const zip = state.mode === "zip" ? new JSZip() : null;
  let succeeded = 0;
  let failed = 0;

  log(`Processing ${queue.length} image${queue.length === 1 ? "" : "s"}…`, "info");

  for (const [index, item] of queue.entries()) {
    if (state.stopRequested) {
      log("Stopped.", "warn");
      break;
    }

    try {
      await processImage(item, settings, zip);
      succeeded += 1;
      log(`${item.path} — OK`, "ok");
    } catch (error) {
      failed += 1;
      log(`${item.path} — failed: ${error.message}`, "error");
    }

    setProgress(index + 1, queue.length);
    // Yield so the progress bar paints and Stop stays responsive.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (zip && succeeded > 0) {
    try {
      el.progressText.textContent = "Building ZIP…";
      const blob = await zip.generateAsync({ type: "blob" }, (meta) => {
        el.progressBar.style.width = `${meta.percent}%`;
      });
      saveAs(blob, `watermarked-${timestamp()}.zip`);
      log("ZIP ready — check your downloads.", "ok");
    } catch (error) {
      log(`Could not build the ZIP: ${error.message}`, "error");
    }
  }

  state.running = false;
  el.stop.disabled = true;
  el.progressBar.style.width = "100%";
  el.progressText.textContent = `Done — ${succeeded} written, ${failed} failed.`;

  if (state.mode === "folder" && succeeded > 0) {
    log("Watermarked copies written next to the originals.", "ok");
  }

  updateQueueUi();
}

async function processImage(item, settings, zip) {
  const file = item.file ?? (await item.handle.getFile());
  const bitmap = await decodeImage(file, settings.autoOrient);

  try {
    const outputType = resolveOutputType(file.type, settings.format);
    // JPEG has no alpha channel: flatten onto white rather than black.
    const background = outputType === "image/jpeg" ? "#ffffff" : null;

    composite(workCanvas, bitmap, state.watermark.bitmap, settings, { background });

    const blob = await canvasToBlob(
      workCanvas,
      outputType,
      outputType === "image/jpeg" ? JPEG_QUALITY : undefined
    );

    const name = outputFilename(item.name, settings.suffix, outputType);

    if (zip) {
      const folder = item.path.includes("/")
        ? `${item.path.slice(0, item.path.lastIndexOf("/"))}/`
        : "";
      zip.file(folder + name, blob);
    } else {
      const handle = await item.dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    }
  } finally {
    bitmap.close?.();
  }
}

/* ------------------------------------------------------------------- ui */

function setProgress(done, total) {
  const percent = total === 0 ? 0 : (done / total) * 100;
  el.progressBar.style.width = `${percent}%`;
  el.progressText.textContent = `${done} of ${total}`;
}

/** Append a line to the log, trimming history so it can't grow unbounded. */
function log(message, kind = "info") {
  const line = document.createElement("div");
  line.className = `log__line log__line--${kind}`;
  line.textContent = message;

  el.log.append(line);

  while (el.log.childElementCount > 500) el.log.firstElementChild.remove();
  el.log.scrollTop = el.log.scrollHeight;
}

function timestamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

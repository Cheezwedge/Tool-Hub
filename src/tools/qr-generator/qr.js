import QRCode from "qrcode";

import { mountHeader } from "../../components/header.js";
import { loadSettings, saveSettings, clearSettings } from "../../lib/storage.js";
import {
  downloadCanvas,
  downloadText,
  safeFilename,
} from "../../lib/download.js";

const TOOL_ID = "qr-generator";

const DEFAULTS = {
  mode: "text",
  logoScale: 20,
  size: 512,
  margin: 4,
  foreground: "#000000",
  background: "#ffffff",
  transparent: false,
  errorCorrection: "M",
};

/** How long to wait after the last keystroke before regenerating. */
const DEBOUNCE_MS = 220;

const el = {
  mode: document.getElementById("qr-mode"),
  text: document.getElementById("qr-text"),
  textLabel: document.querySelector('[data-mode-label="text"]'),
  wifiSsid: document.getElementById("wifi-ssid"),
  wifiSecurity: document.getElementById("wifi-security"),
  wifiPassword: document.getElementById("wifi-password"),
  wifiHidden: document.getElementById("wifi-hidden"),
  size: document.getElementById("qr-size"),
  sizeValue: document.getElementById("qr-size-value"),
  margin: document.getElementById("qr-margin"),
  marginValue: document.getElementById("qr-margin-value"),
  foreground: document.getElementById("qr-fg"),
  background: document.getElementById("qr-bg"),
  transparent: document.getElementById("qr-transparent"),
  errorCorrection: document.getElementById("qr-ec"),
  reset: document.getElementById("qr-reset"),
  logoInput: document.getElementById("qr-logo"),
  logoPreview: document.getElementById("qr-logo-preview"),
  logoThumb: document.getElementById("qr-logo-thumb"),
  logoName: document.getElementById("qr-logo-name"),
  logoRemove: document.getElementById("qr-logo-remove"),
  logoSizeField: document.getElementById("qr-logo-size-field"),
  logoScale: document.getElementById("qr-logo-scale"),
  logoScaleValue: document.getElementById("qr-logo-scale-value"),
  canvas: document.getElementById("qr-canvas"),
  placeholder: document.getElementById("qr-placeholder"),
  status: document.getElementById("qr-status"),
  downloadPng: document.getElementById("qr-download-png"),
  downloadSvg: document.getElementById("qr-download-svg"),
  modePanels: document.querySelectorAll("[data-mode-panel]"),
};

/** The payload currently rendered, or "" when there is nothing to show. */
let currentPayload = "";
let debounceTimer;

/**
 * The centre logo, once one is chosen. Kept as both a decoded image (for the
 * canvas) and a data URL (to embed in the SVG), so neither export needs the
 * original File again.
 */
let logo = null;

mountHeader(TOOL_ID);
applySettings(loadSettings(TOOL_ID, DEFAULTS));
wireEvents();
render();

/* ------------------------------------------------------------- settings */

function readSettings() {
  return {
    mode: el.mode.value,
    size: Number(el.size.value),
    margin: Number(el.margin.value),
    foreground: el.foreground.value,
    background: el.background.value,
    transparent: el.transparent.checked,
    errorCorrection: el.errorCorrection.value,
    logoScale: Number(el.logoScale.value),
  };
}

function applySettings(settings) {
  el.mode.value = settings.mode;
  el.size.value = settings.size;
  el.margin.value = settings.margin;
  el.foreground.value = settings.foreground;
  el.background.value = settings.background;
  el.transparent.checked = settings.transparent;
  el.errorCorrection.value = settings.errorCorrection;
  el.logoScale.value = settings.logoScale;

  syncDerivedUi();
}

/** Keep the readouts, disabled states and mode panels in step with inputs. */
function syncDerivedUi() {
  const mode = el.mode.value;

  el.sizeValue.value = `${el.size.value} px`;
  el.marginValue.value = `${el.margin.value} modules`;
  el.logoScaleValue.value = `${el.logoScale.value}%`;
  el.logoSizeField.hidden = logo === null;
  el.logoPreview.hidden = logo === null;
  el.background.disabled = el.transparent.checked;
  el.textLabel.textContent = mode === "url" ? "URL to encode" : "Text to encode";
  el.text.placeholder =
    mode === "url"
      ? "https://example.com"
      : "Type or paste anything — a link, a note, a phone number…";

  for (const panel of el.modePanels) {
    panel.hidden = !panel.dataset.modePanel.split(" ").includes(mode);
  }
}

/* --------------------------------------------------------------- events */

function wireEvents() {
  // Anything that changes the encoded payload gets debounced; option changes
  // are cheap enough to run immediately.
  const debounced = [el.text, el.wifiSsid, el.wifiPassword];
  const immediate = [
    el.mode,
    el.size,
    el.margin,
    el.foreground,
    el.background,
    el.transparent,
    el.errorCorrection,
    el.wifiSecurity,
    el.wifiHidden,
    el.logoScale,
  ];

  for (const input of debounced) {
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(render, DEBOUNCE_MS);
    });
  }

  for (const input of immediate) {
    input.addEventListener("input", () => {
      syncDerivedUi();
      persist();
      render();
    });
  }

  el.reset.addEventListener("click", () => {
    clearSettings(TOOL_ID);
    applySettings({ ...DEFAULTS });
    render();
  });

  el.logoInput.addEventListener("change", loadLogo);
  el.logoRemove.addEventListener("click", clearLogo);

  el.downloadPng.addEventListener("click", downloadPng);
  el.downloadSvg.addEventListener("click", downloadSvg);
}

function persist() {
  saveSettings(TOOL_ID, readSettings());
}

/* -------------------------------------------------------------- payload */

/**
 * Escape a value for the WIFI: URI scheme, where `\ ; , : "` are special.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeWifi(value) {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

/** Build the string to encode from whichever mode is active. */
function buildPayload() {
  if (el.mode.value !== "wifi") return el.text.value.trim();

  const ssid = el.wifiSsid.value.trim();
  if (!ssid) return "";

  const security = el.wifiSecurity.value;
  const parts = [`T:${security}`, `S:${escapeWifi(ssid)}`];

  if (security !== "nopass") {
    parts.push(`P:${escapeWifi(el.wifiPassword.value)}`);
  }
  if (el.wifiHidden.checked) {
    parts.push("H:true");
  }

  return `WIFI:${parts.join(";")};;`;
}

/** Options shared by the canvas and SVG renderers. */
function encodeOptions() {
  const settings = readSettings();

  return {
    width: settings.size,
    margin: settings.margin,
    errorCorrectionLevel: settings.errorCorrection,
    color: {
      dark: settings.foreground,
      // 8-digit hex: fully transparent light modules.
      light: settings.transparent ? "#00000000" : settings.background,
    },
  };
}

/* --------------------------------------------------------------- render */

async function render() {
  persist();

  const payload = buildPayload();
  currentPayload = payload;

  if (!payload) {
    showPlaceholder(
      el.mode.value === "wifi"
        ? "Enter a network name to generate a code."
        : ""
    );
    return;
  }

  try {
    await QRCode.toCanvas(el.canvas, payload, encodeOptions());
    if (logo) drawLogo(el.canvas);

    el.canvas.hidden = false;
    el.placeholder.hidden = true;
    el.downloadPng.disabled = false;
    el.downloadSvg.disabled = false;

    setStatus(
      logo
        ? `${payload.length} characters encoded — scan-test before printing.`
        : `${payload.length} characters encoded.`
    );
  } catch (error) {
    currentPayload = "";
    showPlaceholder();
    setStatus(describeError(error), true);
  }
}

function showPlaceholder(message = "Your QR code will appear here.") {
  el.canvas.hidden = true;
  el.placeholder.hidden = false;
  el.placeholder.textContent = message || "Your QR code will appear here.";
  el.downloadPng.disabled = true;
  el.downloadSvg.disabled = true;
  setStatus("");
}

function setStatus(message, isError = false) {
  el.status.textContent = message;
  el.status.classList.toggle("qr__status--error", isError);
}

/**
 * The library's "too big" error is the one users actually hit; make it
 * actionable rather than passing the raw message through.
 */
function describeError(error) {
  const message = String(error?.message ?? error);

  if (/too (big|long)|data too/i.test(message)) {
    return "That's too much data for one QR code. Shorten the text, or drop the error correction level.";
  }
  return message;
}

/* ----------------------------------------------------------------- logo */

/** Geometry of the logo plate, in whatever units `size` is given in. */
function logoBox(size) {
  const logoSize = size * (Number(el.logoScale.value) / 100);
  const pad = logoSize * 0.12;
  const box = logoSize + pad * 2;

  return {
    logoSize,
    pad,
    box,
    x: (size - box) / 2,
    y: (size - box) / 2,
    radius: box * 0.15,
  };
}

/**
 * The plate sits behind the logo so it reads as deliberate rather than as
 * damage. It matches the code's own background — white when the background is
 * transparent, since the logo still needs something to sit on.
 */
function plateColour() {
  return el.transparent.checked ? "#ffffff" : el.background.value;
}

function drawLogo(canvas) {
  const ctx = canvas.getContext("2d");
  const { logoSize, pad, box, x, y, radius } = logoBox(canvas.width);

  ctx.fillStyle = plateColour();
  ctx.beginPath();
  ctx.roundRect(x, y, box, box, radius);
  ctx.fill();

  // Letterbox rather than stretch: a squashed logo looks broken.
  const aspect = logo.image.width / logo.image.height;
  const width = aspect >= 1 ? logoSize : logoSize * aspect;
  const height = aspect >= 1 ? logoSize / aspect : logoSize;

  ctx.drawImage(
    logo.image,
    x + pad + (logoSize - width) / 2,
    y + pad + (logoSize - height) / 2,
    width,
    height
  );
}

/** Append the same plate + logo to a `qrcode`-produced SVG string. */
function addLogoToSvg(svg) {
  const viewBox = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) /);
  if (!viewBox) return svg;

  const units = Number(viewBox[1]);
  const { logoSize, pad, box, x, y, radius } = logoBox(units);

  const aspect = logo.image.width / logo.image.height;
  const width = aspect >= 1 ? logoSize : logoSize * aspect;
  const height = aspect >= 1 ? logoSize / aspect : logoSize;

  const overlay =
    `<rect x="${x}" y="${y}" width="${box}" height="${box}" rx="${radius}" ` +
    `fill="${plateColour()}"/>` +
    `<image x="${x + pad + (logoSize - width) / 2}" ` +
    `y="${y + pad + (logoSize - height) / 2}" ` +
    `width="${width}" height="${height}" ` +
    `preserveAspectRatio="xMidYMid meet" href="${logo.dataUrl}"/>`;

  return svg.replace("</svg>", `${overlay}</svg>`);
}

async function loadLogo() {
  const file = el.logoInput.files?.[0];
  if (!file) return;

  try {
    const dataUrl = await readAsDataUrl(file);
    const image = new Image();
    image.src = dataUrl;
    await image.decode();

    logo = { image, dataUrl, name: file.name };

    el.logoThumb.src = dataUrl;
    el.logoName.textContent = file.name;

    // A logo punches a hole in the code. Q recovers 25% of the modules, which
    // is what makes a centre logo survivable; L and M generally do not.
    if (el.errorCorrection.value === "L" || el.errorCorrection.value === "M") {
      el.errorCorrection.value = "Q";
    }

    syncDerivedUi();
    persist();
    render();
  } catch {
    setStatus("Could not read that image.", true);
  }
}

function clearLogo() {
  logo = null;
  el.logoInput.value = "";
  el.logoThumb.removeAttribute("src");
  syncDerivedUi();
  render();
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------ downloads */

/** A filename derived from the encoded content, e.g. "qr-example_com.png". */
function outputName(extension) {
  const base =
    el.mode.value === "wifi"
      ? el.wifiSsid.value.trim()
      : currentPayload.replace(/^https?:\/\//i, "");

  return `qr-${safeFilename(base.slice(0, 40), "code")}.${extension}`;
}

async function downloadPng() {
  if (!currentPayload) return;

  try {
    await downloadCanvas(el.canvas, outputName("png"), "image/png");
  } catch (error) {
    setStatus(describeError(error), true);
  }
}

async function downloadSvg() {
  if (!currentPayload) return;

  try {
    const svg = await QRCode.toString(currentPayload, {
      ...encodeOptions(),
      type: "svg",
    });
    downloadText(
      logo ? addLogoToSvg(svg) : svg,
      outputName("svg"),
      "image/svg+xml"
    );
  } catch (error) {
    setStatus(describeError(error), true);
  }
}

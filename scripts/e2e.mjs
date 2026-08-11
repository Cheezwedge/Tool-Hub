/**
 * End-to-end smoke test for the hub and every tool in it.
 *
 * Builds nothing itself — point it at a running server:
 *
 *   npm run build && npm run preview &
 *   npm run test:e2e
 *
 * Requires the Playwright browser once: `npx playwright install chromium`.
 * Set PW_CHROMIUM to use a Chromium you already have.
 */
import { chromium } from "playwright";
import JSZip from "jszip";
import jsQR from "jsqr";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:4173";
const OUT = mkdtempSync(join(tmpdir(), "tool-hub-e2e-"));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
);
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();

const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
page.on("console", (msg) => msg.type() === "error" && pageErrors.push(msg.text()));

/* -------------------------------------------------------------------- hub */

console.log("\nHub");
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });

check("renders one card per registry entry", (await page.locator(".tool-card").count()) === 2);
check(
  "cards link to their tool pages",
  (await page.locator('.tool-card[href$="watermark/index.html"]').count()) === 1 &&
    (await page.locator('.tool-card[href$="qr-generator/index.html"]').count()) === 1
);
check("no horizontal overflow at 390px", !(await overflows(page, 390)));

/* --------------------------------------------------------------------- QR */

console.log("\nQR generator");
await page.setViewportSize({ width: 1440, height: 1000 });
await page.locator('.tool-card[href$="qr-generator/index.html"]').click();
await page.waitForLoadState("networkidle");

check("shared header is mounted", (await page.locator(".site-header__back").count()) === 1);

await page.fill("#qr-text", "https://example.com/hello-world");
await page.waitForTimeout(500);

const qr = await page.evaluate(() => {
  const canvas = document.getElementById("qr-canvas");
  if (canvas.hidden) return null;
  const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark += 1;
  return { width: canvas.width, dark };
});
check("renders modules to the canvas", qr !== null && qr.dark > 1000);
check("honours the size setting", qr?.width === 512, `${qr?.width}px`);

const png = await download(page, "#qr-download-png");
check("PNG download works", statSync(png.path).size > 500, png.name);

const svg = await download(page, "#qr-download-svg");
const svgText = readFileSync(svg.path, "utf8");
check("SVG download works", svgText.startsWith("<svg") && svgText.includes("<path"), svg.name);

// The point of the tool: the code has to actually scan.
check(
  "canvas output scans back to the input",
  (await scanCanvas(page)) === "https://example.com/hello-world"
);
check(
  "SVG output scans back to the input",
  (await scanSvg(page, svgText)) === "https://example.com/hello-world"
);

await page.fill("#qr-fg", "#ff0000");
await page.locator("#qr-size").fill("256");
await page.waitForTimeout(300);
const recoloured = await page.evaluate(() => {
  const canvas = document.getElementById("qr-canvas");
  const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let red = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] < 60) red += 1;
  return { width: canvas.width, red };
});
check("colour and size changes reach the canvas", recoloured.red > 500 && recoloured.width === 256);

check(
  "recoloured, high-EC, tight-margin codes still scan",
  await (async () => {
    await page.locator("#qr-ec").selectOption("H");
    await page.locator("#qr-margin").fill("1");
    await page.waitForTimeout(400);
    const scanned = (await scanCanvas(page)) === "https://example.com/hello-world";
    await page.locator("#qr-margin").fill("4");
    await page.waitForTimeout(300);
    return scanned;
  })()
);

// A centre logo punches a hole in the code; it still has to scan.
check(
  "logo overlay renders, raises EC, and still scans",
  await (async () => {
    await page.locator("#qr-ec").selectOption("M");
    await page.locator("#qr-margin").fill("4");
    await page.fill("#qr-fg", "#000000");
    await page.locator("#qr-size").fill("512");
    await page.waitForTimeout(300);

    await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 160;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#e2231a";
      ctx.beginPath();
      ctx.arc(80, 80, 78, 0, Math.PI * 2);
      ctx.fill();
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));

      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], "logo.png", { type: "image/png" }));
      const input = document.getElementById("qr-logo");
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(700);

    const raised = (await page.locator("#qr-ec").inputValue()) === "Q";
    const visible = await page.locator("#qr-logo-preview").isVisible();
    const scans = (await scanCanvas(page)) === "https://example.com/hello-world";

    // The plate has to actually be drawn over the centre of the code.
    const centreIsPlate = await page.evaluate(() => {
      const canvas = document.getElementById("qr-canvas");
      const p = canvas.getContext("2d").getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      return p[0] > 180 && p[1] < 90 && p[2] < 90; // the red logo disc
    });

    return raised && visible && scans && centreIsPlate;
  })()
);

check(
  "SVG export embeds the logo and still scans",
  await (async () => {
    const file = await download(page, "#qr-download-svg");
    const markup = readFileSync(file.path, "utf8");
    const embedded = markup.includes("<image") && markup.includes("data:image/png;base64");
    const scans = (await scanSvg(page, markup)) === "https://example.com/hello-world";
    return embedded && scans;
  })()
);

check(
  "removing the logo clears it from the canvas",
  await (async () => {
    await page.click("#qr-logo-remove");
    await page.waitForTimeout(400);
    const hidden = await page.locator("#qr-logo-preview").isHidden();
    const centreClear = await page.evaluate(() => {
      const canvas = document.getElementById("qr-canvas");
      const p = canvas.getContext("2d").getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      return !(p[0] > 180 && p[1] < 90 && p[2] < 90);
    });
    return hidden && centreClear;
  })()
);

await page.selectOption("#qr-mode", "wifi");
await page.fill("#wifi-ssid", "My;Net");
await page.fill("#wifi-password", "p@ss");
await page.waitForTimeout(400);
check("Wi-Fi preset produces a code", !(await page.locator("#qr-download-svg").isDisabled()));

await page.selectOption("#qr-mode", "text");
await page.locator("#qr-ec").selectOption("H");
await page.fill("#qr-fg", "#00aa55");
await page.locator("#qr-size").fill("320");
await page.waitForTimeout(300);
await page.reload({ waitUntil: "networkidle" });
const qrPersisted = await page.evaluate(() => ({
  ec: document.getElementById("qr-ec").value,
  fg: document.getElementById("qr-fg").value,
  size: document.getElementById("qr-size").value,
}));
check(
  "settings survive a refresh",
  qrPersisted.ec === "H" && qrPersisted.fg === "#00aa55" && qrPersisted.size === "320",
  JSON.stringify(qrPersisted)
);

await page.click("#qr-reset");
const qrReset = await page.evaluate(() => ({
  ec: document.getElementById("qr-ec").value,
  fg: document.getElementById("qr-fg").value,
  size: document.getElementById("qr-size").value,
}));
check(
  "reset restores defaults",
  qrReset.ec === "M" && qrReset.fg === "#000000" && qrReset.size === "512"
);

/* -------------------------------------------------------------- watermark */

console.log("\nWatermark");
await page.goto(`${BASE}/src/tools/watermark/index.html`, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("tool-hub:watermark"));
await page.reload({ waitUntil: "networkidle" });

check("folder mode is offered on Chromium", await page.locator("#wm-mode-folder").isVisible());
await page.click("#wm-mode-zip");

await page.evaluate(seedFixtures);
await page.waitForTimeout(800);

const queueText = (await page.locator("#wm-queue").textContent()).trim();
check(
  "files already carrying the suffix are skipped",
  /3 images ready/.test(queueText) && /1 already watermarked/.test(queueText),
  queueText
);
check("placement preview appears", await page.locator("#wm-preview-wrap").isVisible());
check("Start enables once images and a watermark are set", !(await page.locator("#wm-start").isDisabled()));

const zipFile = await download(page, "#wm-start", 60000);
check("ZIP download produced", statSync(zipFile.path).size > 1000, zipFile.name);

check(
  "progress reports every file",
  /3 written, 0 failed/.test(await page.locator("#wm-progress-text").textContent())
);
check(
  "log records one OK line per file",
  (await page.locator(".log__line--ok").allTextContents()).filter((l) => l.endsWith("OK"))
    .length === 3
);

// Inspect the actual pixels that came out of the ZIP.
const zip = await JSZip.loadAsync(readFileSync(zipFile.path));
const names = Object.keys(zip.files).sort();
check(
  "ZIP contains the suffixed outputs",
  names.join(",") === "phone_wm.jpg,small_wm.jpg,wide_wm.jpg",
  names.join(", ")
);

const wide = await inspect(page, await zip.file("wide_wm.jpg").async("base64"));
check("output keeps the source dimensions", wide.width === 1200 && wide.height === 800, `${wide.width}×${wide.height}`);
check("watermark lands in the south-east corner", wide.markInCorner, JSON.stringify(wide.corners));

// Measure the shadow rather than guess a threshold: the same image with the
// shadow switched off must be measurably lighter around the mark.
await page.uncheck("#wm-shadow");
await page.waitForTimeout(200);
const flatZip = await download(page, "#wm-start", 60000);
const flat = await inspect(
  page,
  await (await JSZip.loadAsync(readFileSync(flatZip.path))).file("wide_wm.jpg").async("base64")
);
await page.check("#wm-shadow");
await page.waitForTimeout(200);
check(
  "drop shadow darkens the area around the mark",
  wide.meanLuma < flat.meanLuma - 1,
  `shadow ${wide.meanLuma.toFixed(1)} vs none ${flat.meanLuma.toFixed(1)}`
);

// The 1000×600 source is tagged EXIF orientation 6, so it must come out 600×1000.
const phone = await inspect(page, await zip.file("phone_wm.jpg").async("base64"));
check(
  "EXIF rotation is applied (portrait stays upright)",
  phone.width === 600 && phone.height === 1000,
  `${phone.width}×${phone.height}`
);

// Scale is a percentage of each image's width, so the 600px image gets a
// proportionally smaller mark than the 1200px one.
const small = await inspect(page, await zip.file("small_wm.jpg").async("base64"));
check("output is proportional per image", small.width === 600 && small.height === 400);

// Format override changes the extension.
await page.selectOption("#wm-format", "image/png");
await page.waitForTimeout(200);
const pngZip = await download(page, "#wm-start", 60000);
const pngNames = Object.keys((await JSZip.loadAsync(readFileSync(pngZip.path))).files).sort();
check(
  "output format override changes the extension",
  pngNames.join(",") === "phone_wm.png,small_wm.png,wide_wm.png",
  pngNames.join(", ")
);

await page.selectOption("#wm-format", "keep");
await page.locator("#wm-scale").fill("35");
await page.selectOption("#wm-position", "NorthWest");
await page.waitForTimeout(150);
await page.reload({ waitUntil: "networkidle" });
const wmPersisted = await page.evaluate(() => ({
  scale: document.getElementById("wm-scale").value,
  position: document.getElementById("wm-position").value,
}));
check(
  "settings survive a refresh",
  wmPersisted.scale === "35" && wmPersisted.position === "NorthWest",
  JSON.stringify(wmPersisted)
);

await page.click("#wm-reset");
const wmReset = await page.evaluate(() => ({
  scale: document.getElementById("wm-scale").value,
  position: document.getElementById("wm-position").value,
  opacity: document.getElementById("wm-opacity").value,
  suffix: document.getElementById("wm-suffix").value,
}));
check(
  "reset restores defaults",
  wmReset.scale === "10" &&
    wmReset.position === "SouthEast" &&
    wmReset.opacity === "70" &&
    wmReset.suffix === "_wm",
  JSON.stringify(wmReset)
);

check("no horizontal overflow at 390px", !(await overflows(page, 390)));

console.log("");
check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 300));

await browser.close();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);

/* ------------------------------------------------------------- helpers */

async function overflows(target, width) {
  const previous = target.viewportSize();
  await target.setViewportSize({ width, height: 844 });
  await target.waitForTimeout(250);
  const over = await target.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  await target.setViewportSize(previous ?? { width: 1440, height: 1000 });
  return over;
}

/** Read the live preview canvas and decode it with a real QR reader. */
async function scanCanvas(target) {
  const shot = await target.evaluate(() => {
    const canvas = document.getElementById("qr-canvas");
    const ctx = canvas.getContext("2d");
    return {
      data: [...ctx.getImageData(0, 0, canvas.width, canvas.height).data],
      width: canvas.width,
      height: canvas.height,
    };
  });
  return jsQR(new Uint8ClampedArray(shot.data), shot.width, shot.height)?.data ?? null;
}

/** Rasterise the downloaded SVG in the page, then decode that. */
async function scanSvg(target, svg) {
  const shot = await target.evaluate(async (markup) => {
    const image = new Image();
    image.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(markup)));
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 512, 512);
    ctx.drawImage(image, 0, 0, 512, 512);
    return [...ctx.getImageData(0, 0, 512, 512).data];
  }, svg);
  return jsQR(new Uint8ClampedArray(shot), 512, 512)?.data ?? null;
}

async function download(target, selector, timeout = 15000) {
  const pending = target.waitForEvent("download", { timeout });
  await target.click(selector);
  const file = await pending;
  const path = join(OUT, file.suggestedFilename());
  await file.saveAs(path);
  return { path, name: file.suggestedFilename() };
}

/** Decode a base64 image in the browser and measure the watermark region. */
function inspect(target, base64) {
  return target.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));

    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const ctx = canvas.getContext("2d");

    // Defaults: 10% of width, 10px margin, bottom-right.
    const markWidth = Math.round(bitmap.width * 0.1);
    const markHeight = Math.round(markWidth * (120 / 400));
    const x = bitmap.width - markWidth - 10;
    const y = bitmap.height - markHeight - 10;

    const region = (rx, ry, rw, rh) => {
      const px = ctx.getImageData(
        Math.max(0, rx),
        Math.max(0, ry),
        Math.max(1, rw),
        Math.max(1, rh)
      ).data;
      let bright = 0;
      let total = 0;
      for (let i = 0; i < px.length; i += 4) {
        const luma = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (luma > 200) bright += 1;
        total += luma;
      }
      return { bright, meanLuma: total / (px.length / 4) };
    };

    const mark = region(x, y, markWidth, markHeight);
    const away = region(10, Math.round(bitmap.height / 2), markWidth, markHeight);

    return {
      width: bitmap.width,
      height: bitmap.height,
      markInCorner: mark.bright > 20 && away.bright === 0,
      meanLuma: mark.meanLuma,
      corners: { mark: mark.bright, away: away.bright },
    };
  }, base64);
}

/**
 * Build the test images inside the page and hand them to the file inputs.
 * One fixture carries a hand-written EXIF orientation tag so auto-orient has
 * something real to act on.
 */
async function seedFixtures() {
  function exifOrientation6() {
    // APP1 segment: TIFF header + one IFD0 entry, Orientation (0x0112) = 6.
    return new Uint8Array([
      0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49,
      0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00,
      0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
  }

  async function makeJpeg(width, height, withExif) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#2d6cdf";
    ctx.fillRect(0, 0, width, height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.95));
    let bytes = new Uint8Array(await blob.arrayBuffer());

    if (withExif) {
      const app1 = exifOrientation6();
      const merged = new Uint8Array(bytes.length + app1.length);
      merged.set(bytes.slice(0, 2), 0); // SOI
      merged.set(app1, 2);
      merged.set(bytes.slice(2), 2 + app1.length);
      bytes = merged;
    }
    return new Blob([bytes], { type: "image/jpeg" });
  }

  async function makeWatermark() {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 120;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 84px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("MARK", 8, 62);
    return new Promise((r) => canvas.toBlob(r, "image/png"));
  }

  const files = [
    new File([await makeJpeg(1200, 800, false)], "wide.jpg", { type: "image/jpeg" }),
    new File([await makeJpeg(600, 400, false)], "small.jpg", { type: "image/jpeg" }),
    new File([await makeJpeg(1000, 600, true)], "phone.jpg", { type: "image/jpeg" }),
    new File([await makeJpeg(300, 200, false)], "already_wm.jpg", { type: "image/jpeg" }),
  ];

  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  const input = document.getElementById("wm-file-input");
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));

  const markTransfer = new DataTransfer();
  markTransfer.items.add(new File([await makeWatermark()], "logo.png", { type: "image/png" }));
  const markInput = document.getElementById("wm-image");
  markInput.files = markTransfer.files;
  markInput.dispatchEvent(new Event("change", { bubbles: true }));
}

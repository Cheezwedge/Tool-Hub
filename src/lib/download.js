/**
 * Download helpers shared by every tool: canvas → blob → file on disk.
 */

/**
 * Save a Blob to the user's downloads.
 *
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();

  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Save a string (SVG markup, CSV, JSON, …) as a file.
 *
 * @param {string} text
 * @param {string} filename
 * @param {string} [mimeType]
 */
export function downloadText(text, filename, mimeType = "text/plain") {
  downloadBlob(new Blob([text], { type: `${mimeType};charset=utf-8` }), filename);
}

/**
 * Promise-based `canvas.toBlob`.
 *
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas
 * @param {string} [type]     e.g. "image/png", "image/jpeg"
 * @param {number} [quality]  0–1, only meaningful for lossy formats
 * @returns {Promise<Blob>}
 */
export function canvasToBlob(canvas, type = "image/png", quality) {
  if (typeof canvas.convertToBlob === "function") {
    // OffscreenCanvas
    return canvas.convertToBlob({ type, quality });
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error(`Could not encode canvas as ${type}`)),
      type,
      quality
    );
  });
}

/**
 * Encode a canvas and immediately download it.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} filename
 * @param {string} [type]
 * @param {number} [quality]
 */
export async function downloadCanvas(canvas, filename, type = "image/png", quality) {
  downloadBlob(await canvasToBlob(canvas, type, quality), filename);
}

/**
 * Strip a file extension: "photo.jpg" → "photo".
 *
 * @param {string} filename
 * @returns {string}
 */
export function stripExtension(filename) {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/**
 * Make a string safe to use as a filename across platforms.
 *
 * @param {string} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function safeFilename(value, fallback = "download") {
  const cleaned = value
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

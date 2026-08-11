/**
 * The image side of the watermark tool: decoding, placement and compositing.
 * Kept free of DOM/UI concerns so it can be unit-tested or reused.
 */

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "avif",
  "tif",
  "tiff",
]);

/** Extensions we write, keyed by canvas encoder MIME type. */
const EXTENSION_FOR_TYPE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Formats the canvas can re-encode. Anything else falls back to PNG. */
const ENCODABLE = new Set(Object.keys(EXTENSION_FOR_TYPE));

export const JPEG_QUALITY = 0.92;

/** Canvas shadowBlur ≈ 2× the Gaussian sigma ImageMagick's -shadow takes. */
const SHADOW_BLUR_TO_CANVAS = 2;

/**
 * @param {string} filename
 * @returns {boolean} true if the extension looks like an image we can try
 */
export function isImageFilename(filename) {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(filename.slice(dot + 1).toLowerCase());
}

/**
 * Has this file already been through the tool? Used so re-running over a
 * folder doesn't watermark the watermarked copies.
 *
 * @param {string} filename
 * @param {string} suffix
 */
export function hasSuffix(filename, suffix) {
  if (!suffix) return false;
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return base.toLowerCase().endsWith(suffix.toLowerCase());
}

/**
 * Build the output filename: "photo.jpg" + "_wm" → "photo_wm.jpg", with the
 * extension swapped when the output format differs from the source.
 *
 * @param {string} filename
 * @param {string} suffix
 * @param {string} outputType  MIME type the canvas will encode to
 */
export function outputFilename(filename, suffix, outputType) {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = EXTENSION_FOR_TYPE[outputType] ?? "png";
  return `${base}${suffix}.${extension}`;
}

/**
 * Decide what MIME type to encode as.
 *
 * @param {string} sourceType  the source file's MIME type (may be empty)
 * @param {string} setting     "keep" | "image/jpeg" | "image/png"
 */
export function resolveOutputType(sourceType, setting) {
  if (setting !== "keep") return setting;

  const type = (sourceType || "").toLowerCase();
  return ENCODABLE.has(type) ? type : "image/png";
}

/**
 * Decode a Blob into an ImageBitmap.
 *
 * `imageOrientation: "from-image"` applies EXIF rotation, so portrait photos
 * off a phone come out upright instead of being watermarked sideways. Older
 * engines reject the option object, hence the progressive fallback.
 *
 * @param {Blob} blob
 * @param {boolean} autoOrient
 * @returns {Promise<ImageBitmap>}
 */
export async function decodeImage(blob, autoOrient) {
  try {
    return await createImageBitmap(blob, {
      imageOrientation: autoOrient ? "from-image" : "none",
    });
  } catch {
    return createImageBitmap(blob);
  }
}

/**
 * Where the watermark lands on an image of the given size.
 *
 * Scale is a percentage of the *image's* width, computed per image, so the
 * watermark stays proportional across mixed-size photos.
 *
 * @param {{width: number, height: number}} image
 * @param {{width: number, height: number}} watermark
 * @param {{position: string, scale: number, margin: number}} options
 */
export function computePlacement(image, watermark, { position, scale, margin }) {
  const width = Math.max(1, Math.round((image.width * scale) / 100));
  const height = Math.max(1, Math.round(width * (watermark.height / watermark.width)));

  let x;
  if (position.includes("West")) x = margin;
  else if (position.includes("East")) x = image.width - width - margin;
  else x = (image.width - width) / 2;

  let y;
  if (position.startsWith("North")) y = margin;
  else if (position.startsWith("South")) y = image.height - height - margin;
  else y = (image.height - height) / 2;

  return { x: Math.round(x), y: Math.round(y), width, height };
}

/**
 * Render the watermark's drop shadow to a small offscreen tile.
 *
 * The watermark is drawn far off the tile's left edge with a matching
 * positive shadow offset, so only the shadow lands inside the tile. That
 * gives a shadow whose opacity is genuinely independent of the watermark's
 * own opacity — which drawing them in one pass could not do.
 *
 * @returns {{canvas: HTMLCanvasElement, pad: number}|null} null when invisible
 */
function renderShadowTile(watermark, placement, shadow) {
  const { opacity, blur, offsetX, offsetY } = shadow;
  if (opacity <= 0) return null;

  const pad = Math.ceil(blur * 2 + Math.max(Math.abs(offsetX), Math.abs(offsetY)) + 4);
  const tile = document.createElement("canvas");
  tile.width = placement.width + pad * 2;
  tile.height = placement.height + pad * 2;

  const ctx = tile.getContext("2d");
  const escape = tile.width + placement.width + 8;

  ctx.globalAlpha = opacity / 100;
  ctx.shadowColor = "rgba(0, 0, 0, 1)";
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = offsetX + escape;
  ctx.shadowOffsetY = offsetY;
  ctx.drawImage(watermark, pad - escape, pad, placement.width, placement.height);

  return { canvas: tile, pad };
}

/**
 * Composite one image plus its watermark onto `canvas`, sized to the image.
 *
 * @param {HTMLCanvasElement} canvas    reused between images to limit GC churn
 * @param {CanvasImageSource & {width: number, height: number}} image
 * @param {CanvasImageSource & {width: number, height: number}} watermark
 * @param {object} settings             the tool's option values
 * @param {object} [extra]
 * @param {number} [extra.ratio]        scales px-based options; <1 for previews
 * @param {string} [extra.background]   fill colour for formats without alpha
 * @returns {HTMLCanvasElement} the same canvas, for chaining
 */
export function composite(canvas, image, watermark, settings, extra = {}) {
  const { ratio = 1, background = null } = extra;

  canvas.width = image.width;
  canvas.height = image.height;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const placement = computePlacement(image, watermark, {
    position: settings.position,
    scale: settings.scale,
    margin: Math.round(settings.margin * ratio),
  });

  if (settings.shadow) {
    const tile = renderShadowTile(watermark, placement, {
      // ImageMagick builds the shadow from a clone of the *already
      // opacity-reduced* watermark, so the two opacities multiply. Matching
      // that keeps output identical to the desktop tool at its defaults.
      opacity: (settings.shadowOpacity * settings.opacity) / 100,
      // IM's `-shadow NxS` takes S as a Gaussian sigma; canvas `shadowBlur`
      // is roughly twice the sigma, so the slider needs doubling to match.
      blur: settings.shadowBlur * SHADOW_BLUR_TO_CANVAS * ratio,
      offsetX: settings.shadowOffsetX * ratio,
      offsetY: settings.shadowOffsetY * ratio,
    });

    if (tile) {
      ctx.drawImage(tile.canvas, placement.x - tile.pad, placement.y - tile.pad);
    }
  }

  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, settings.opacity / 100));
  ctx.drawImage(watermark, placement.x, placement.y, placement.width, placement.height);
  ctx.restore();

  return canvas;
}

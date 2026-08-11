/**
 * The tool registry — the single source of truth for what lives in this hub.
 *
 * Adding a tool means adding one object here and creating the matching
 * `src/tools/<id>/` folder. The landing grid, the page titles and the build
 * entry points all follow from this list. See README.md.
 *
 * Fields:
 *   id          folder name under src/tools/ — also the localStorage namespace
 *   name        display name, shown on the card and in the tool page header
 *   description one line, shown on the card
 *   icon        emoji or short glyph
 *   path        page path relative to the site root (no leading slash)
 */
export const tools = [
  {
    id: "watermark",
    name: "Batch Watermark",
    description:
      "Add a watermark to many images at once, entirely in your browser.",
    icon: "💧",
    path: "src/tools/watermark/index.html",
  },
  {
    id: "qr-generator",
    name: "QR Code Generator",
    description:
      "Turn any text or link into a QR code, with an optional centre logo.",
    icon: "▦",
    path: "src/tools/qr-generator/index.html",
  },
  {
    id: "site-to-markdown",
    name: "Site to Markdown",
    description:
      "Compile documentation pages into one Markdown file to feed an AI model.",
    icon: "📚",
    path: "src/tools/site-to-markdown/index.html",
  },
];

/** Look up a registry entry by id. Returns undefined if there is no match. */
export function getTool(id) {
  return tools.find((tool) => tool.id === id);
}

/**
 * Resolve a registry path against the deployed base URL, so links work both
 * at the domain root and under a sub-path like /Tool-Hub/ on GitHub Pages.
 */
export function toolUrl(tool) {
  return import.meta.env.BASE_URL + tool.path;
}

/** The hub's own URL, resolved the same way. */
export function hubUrl() {
  return import.meta.env.BASE_URL;
}

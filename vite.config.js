import { defineConfig } from "vite";
import { readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const toolsDir = resolve(root, "src/tools");

/**
 * Every `src/tools/<id>/index.html` becomes its own build entry point.
 *
 * This is discovered from the filesystem rather than hand-maintained, so
 * adding a tool never means remembering to edit this file. See README.md
 * ("Adding a new tool").
 */
function toolEntries() {
  if (!existsSync(toolsDir)) return {};

  return Object.fromEntries(
    readdirSync(toolsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => [entry.name, resolve(toolsDir, entry.name, "index.html")])
      .filter(([, htmlPath]) => existsSync(htmlPath))
  );
}

export default defineConfig({
  // Overridable so the same build can be published under a sub-path
  // (GitHub Pages serves from /<repo>/). See README.md ("Deployment").
  base: process.env.BASE_PATH || "/",
  build: {
    rollupOptions: {
      input: {
        hub: resolve(root, "index.html"),
        ...toolEntries(),
      },
    },
  },
});

# Tool Hub

A single static site that collects small, self-contained browser tools.

Everything runs **client-side**. There is no backend, no account, no upload —
images are decoded and re-encoded on your own device, and once the page has
loaded the tools keep working with the network off. That also means the whole
thing hosts for free anywhere that serves static files.

| Tool | What it does |
| --- | --- |
| **Batch Watermark** | Composites a PNG watermark onto many images at once, with position, scale, opacity and drop-shadow control. Writes results back into your folders (Chrome/Edge) or hands you a ZIP (any browser). |
| **QR Code Generator** | Turns text, a URL, or Wi-Fi credentials into a QR code, with an optional logo in the centre. Downloads as PNG or vector SVG. |

---

## Local development

Requires Node 20 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
```

Other commands:

```bash
npm run build      # static output into dist/
npm run preview    # serve the built dist/ on http://localhost:4173
npm run test:e2e   # browser smoke test — see "Testing" below
```

---

## Adding a new tool

This is the whole point of the project, so it is deliberately short. To add a
tool with the id `my-tool`:

**1. Create the folder** `src/tools/my-tool/` with three files.

`index.html` — copy an existing tool's head block so it picks up the shared
styles, and keep the `#site-header` placeholder:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>My Tool · Tool Hub</title>
    <link rel="stylesheet" href="../../styles/tokens.css" />
    <link rel="stylesheet" href="../../styles/base.css" />
    <link rel="stylesheet" href="./my-tool.css" />
  </head>
  <body>
    <div id="site-header"></div>
    <main class="page page--narrow">
      <!-- your UI -->
    </main>
    <script type="module" src="./my-tool.js"></script>
  </body>
</html>
```

`my-tool.js` — mount the shared header and reach for the shared helpers:

```js
import { mountHeader } from "../../components/header.js";
import { loadSettings, saveSettings } from "../../lib/storage.js";
import { downloadBlob } from "../../lib/download.js";

const TOOL_ID = "my-tool";
const DEFAULTS = { /* … */ };

mountHeader(TOOL_ID);
const settings = loadSettings(TOOL_ID, DEFAULTS);
```

`my-tool.css` — only the layout unique to this tool. Panels, buttons, fields,
sliders, progress bars and the log are already styled in `base.css`.

**2. Register it** — add one object to the `tools` array in
[`src/registry.js`](src/registry.js):

```js
{
  id: "my-tool",
  name: "My Tool",
  description: "One line describing what it does.",
  icon: "🔧",
  path: "src/tools/my-tool/index.html",
}
```

That's it. The card appears on the hub, and `vite.config.js` picks the page up
as a build entry point automatically by scanning `src/tools/*/index.html` — no
build config to edit.

### What you get for free

- **`src/styles/tokens.css`** — the design variables (colours, radius, fonts,
  spacing scale). Never hard-code a colour; use a token so a future theme
  change reaches every tool.
- **`src/styles/base.css`** — reset plus shared components: `.panel`,
  `.section`, `.field`, `.btn` (`--primary`, `--danger`, `--block`),
  `.checkbox`, `.progress`, `.log`, `.empty-state`, `.visually-hidden`.
- **`src/components/header.js`** — `mountHeader(toolId)` renders the top bar
  with a back link and sets the document title from the registry.
- **`src/lib/storage.js`** — `loadSettings(toolId, defaults)`,
  `saveSettings(toolId, obj)`, `clearSettings(toolId)`. Namespaced per tool and
  safe when storage is blocked (private browsing).
- **`src/lib/download.js`** — `downloadBlob`, `downloadText`, `canvasToBlob`,
  `downloadCanvas`, `stripExtension`, `safeFilename`.

Prefer platform APIs (Canvas, File System Access, `createImageBitmap`) over new
dependencies. If a tool genuinely needs a library, `npm install` it — because
each tool is its own bundle, only the pages that import it pay the cost.

---

## Project structure

```
index.html                  Landing page (tool grid)
vite.config.js              Multi-page config; discovers tool entry points
public/favicon.svg
scripts/e2e.mjs             Browser smoke test
src/
  main.js                   Boots the landing page from the registry
  registry.js               THE list of all tools — single source of truth
  styles/tokens.css         Design variables
  styles/base.css           Reset + shared component styles
  styles/hub.css            Landing page only
  components/header.js      Shared top bar for tool pages
  components/card.js        Tool card for the landing grid
  lib/storage.js            Namespaced localStorage helper
  lib/download.js           Canvas → blob → file helpers
  tools/watermark/          index.html, watermark.js, composite.js, watermark.css
  tools/qr-generator/       index.html, qr.js, qr.css
```

---

## Tool notes

### Batch Watermark

Two input modes, offered based on what the browser can actually do:

- **Folder (in place)** — Chrome and Edge only, via the File System Access
  API. Recurses through the folder you pick and every subfolder, and writes
  `photo.jpg` → `photo_wm.jpg` next to each original. Files that already end
  with the suffix are skipped, so re-running over the same folder is safe.
- **Files → ZIP** — everywhere else. Drop images or whole folders, or use the
  file pickers; results come back as a ZIP with the relative folder structure
  preserved. Firefox and Safari only ever see this mode.

Details worth knowing:

- **Scale is a percentage of each image's width**, computed per image, so a
  mixed batch of 6000px and 1200px photos gets proportionally matched marks.
- **Auto-orient** decodes with `imageOrientation: "from-image"`, so portrait
  photos off a phone come out upright rather than watermarked sideways.
- **The drop shadow is rendered on its own tile**, not as a side effect of
  drawing the mark, so its opacity, blur and offset are genuinely independent
  controls. It is what makes a white watermark legible on a light background —
  turn it off over a light photo and the mark all but disappears.
- Images are processed **one at a time** with a progress bar, a live log and a
  working **Stop** button.
- All options persist to `localStorage`; **Reset to defaults** restores them.
  The watermark image itself is not stored — reload it after a refresh.

### QR Code Generator

Live preview (debounced), size, quiet-zone margin, foreground/background
colour, transparent background, and error-correction level L/M/Q/H. Content
presets cover plain text, URLs, and Wi-Fi credentials — the Wi-Fi payload is
built locally and, like everything else here, never leaves the page.

**Centre logo.** Drop in an image and it is composited into the middle of the
code on a rounded plate, sized 10–30% of the code. Adding a logo raises error
correction to Q automatically, because that is the level whose 25% recovery
budget makes a covered centre survivable. The logo is embedded in the SVG
export too, so print output matches the PNG. Scan-test before you print
anything — the tool says so, and it means it.

Both exports come from the same settings: **PNG** off the canvas, **SVG** as
real vector for print or large-format work.

### Parity with the original tools

Both tools are browser reimplementations of things that already existed — a
PowerShell + ImageMagick watermark GUI, and a standalone QR/logo page. Two
details were matched deliberately rather than reinvented, because they decide
what the output actually looks like:

- **Shadow opacity compounds with watermark opacity.** ImageMagick builds the
  shadow from a clone of the already-transparent watermark, so at the defaults
  (70% mark, 100% shadow) the shadow lands at 70%, not 100%. This port does the
  same, so existing settings produce the same result.
- **Shadow blur is a Gaussian sigma.** ImageMagick's `-shadow NxS` takes `S` as
  a sigma; the canvas `shadowBlur` property is roughly twice that. The slider
  keeps the ImageMagick meaning and the doubling happens internally.

One difference worth knowing: for the six non-corner positions, ImageMagick
applies the margin as an offset from the anchor even along the centred axis
(so `North` with a 10px margin sits 10px right of centre). This port centres
exactly on that axis. Corner positions — including the `SouthEast` default —
are identical.

---

## Testing

`scripts/e2e.mjs` drives a real Chromium through the hub and both tools:
rendering, downloads, settings persistence and reset, mobile layout, and the
things that actually matter — that generated QR codes **scan back** to their
input, and that watermarked output has the right dimensions, EXIF rotation,
placement and shadow.

```bash
npx playwright install chromium   # once
npm run build
npm run preview &                 # serves http://localhost:4173
npm run test:e2e
```

Set `BASE_URL` to test a different server, or `PW_CHROMIUM` to point at a
Chromium binary you already have.

Not covered automatically: the File System Access folder mode, because the
native directory picker cannot be driven by a test. Check that one by hand in
Chrome or Edge.

---

## Deployment

`npm run build` produces plain static files in `dist/`. Any static host works,
and none of them need a custom domain — each gives you a free URL.

### Option A — Netlify or Cloudflare Pages (simplest)

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
3. Build command `npm run build`, publish directory `dist`.
4. Deploy. Every push to the branch redeploys automatically.

You get `https://<name>.netlify.app`, reachable from any phone or computer.
Cloudflare Pages is the same three settings. A `netlify.toml` with these
values is already committed, so Netlify should pre-fill them.

### Option B — GitHub Pages

A workflow is committed at
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). To turn it on:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Push to `main`.

The site lands at `https://<user>.github.io/<repo>/`. Because Pages serves from
a sub-path, the workflow builds with `BASE_PATH=/<repo>/`; `vite.config.js`
reads that env var and every link and asset URL is rewritten to match. Nothing
in the source hard-codes a domain.

### Custom domain (optional, later)

All three hosts let you point a domain you own at the site without any code
change — add the domain in the host's dashboard and update your DNS. Worth
about $10–15/yr, purely cosmetic, and easy to add whenever.

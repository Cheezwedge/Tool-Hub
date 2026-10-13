# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions are not git-tagged; each heading links to the commit range it covers.
Every push to `main` deploys, so a dated entry here is a release.

## [1.1.1] — 2026-10-13

### Added

- `CLAUDE.md` — architecture decisions and the reasoning behind them,
  conventions, and the gotchas that cost time (ImageMagick shadow semantics,
  escaping inside the Python generator, the `[hidden]` specificity trap, Pages
  environment branch pinning).
- `CHANGELOG.md` (this file).
- E2E regression check: starting a run must clear the previous run's status,
  stats and download affordances.

### Fixed

- **Site to Markdown: a new run no longer advertises the previous run's
  result.** `startRun()` left the status line reading `Done — N page(s).`, the
  stats panel populated and the Download button enabled while the next run was
  still in flight, so output could be downloaded in the belief it was fresh.
  This also made the e2e suite intermittently assert against stale state and
  fail roughly one run in five.

### Changed

- README: documented `npm run fixture`, and that the crawler's Python
  dependencies must be installed with `python3 -m pip` rather than bare `pip`
  (a mismatched interpreter fails with `ModuleNotFoundError: No module named
  'bs4'` after an install that reports success).

## [1.1.0] — 2026-08-11

### Added

- **Site to Markdown** — compiles documentation pages into a single Markdown
  file for feeding to a model. Because a browser cannot fetch cross-origin
  pages (CORS), it offers three routes rather than one that fails on real
  sites:
  - local HTML files, fully offline;
  - a generated, self-contained Python crawler with the configured settings
    baked in, covering robots.txt, path scoping, exclude patterns, a polite
    delay and an optional Playwright mode for JS-rendered docs;
  - in-browser BFS crawling through a user-supplied fetch proxy (deliberately
    not pre-filled with a third-party service).
- Shared extraction: article-body heuristic with selector override, chrome
  stripping, relative links and images rewritten to absolute, GFM tables, and
  fenced code that keeps its language even when the site puts it on a wrapper
  element. Page headings are demoted below the archive's section heading and a
  duplicate leading `<h1>` dropped, so the combined file has one hierarchy.
- Output carries a table of contents, per-page source links, and a
  character/word/token count.
- `scripts/fixture-site.mjs` — a throwaway CORS-permitting docs site. The e2e
  suite crawls it in the browser *and* executes the generated Python against
  it, so the script the tool hands out is verified to run.

### Changed

- Landing copy no longer claims every tool works offline, since the crawl mode
  makes network requests by definition. Each tool now states its own network
  behaviour.

## [1.0.1] — 2026-08-11

### Fixed

- GitHub Pages deployment. Documented that the `github-pages` environment pins
  deployments to the default branch as it was when Pages was first enabled, so
  changing the default branch afterwards leaves the deploy job failing in
  seconds with no logs.

## [1.0.0] — 2026-08-11

### Added

- Static, multi-page Vite hub with `src/registry.js` as the single source of
  truth; build entry points discovered by scanning `src/tools/*/index.html`, so
  adding a tool never requires editing build config.
- Shared toolkit: design tokens, base component styles, header component,
  namespaced `localStorage` helper that degrades gracefully when storage is
  blocked, and canvas/blob download helpers.
- `BASE_PATH`-driven `base`, so one commit deploys correctly to both a domain
  root and a GitHub Pages sub-path.
- **Batch Watermark** — a browser port of the PowerShell + ImageMagick tool.
  File System Access folder mode writes watermarked copies next to the
  originals, recursing subfolders and skipping files already carrying the
  suffix; ZIP mode is the fallback elsewhere, preserving relative paths. Scale
  is per-image relative to width, EXIF rotation is applied so portrait phone
  photos stay upright, and the drop shadow matches ImageMagick's semantics
  (opacity compounds with the mark's; the blur slider keeps IM's Gaussian-sigma
  meaning). Sequential processing with progress, live log and a working Stop.
- **QR Code Generator** — live debounced preview, size, quiet zone, colours,
  transparency, error correction, and text/URL/Wi-Fi presets. Optional centre
  logo on a rounded plate, embedded in both the PNG and the SVG export, with
  error correction raised to Q automatically.
- `scripts/e2e.mjs` — real-browser suite that verifies outcomes rather than
  appearances: QR codes are decoded back with a QR reader, and watermarked
  output is checked for dimensions, EXIF rotation, placement and shadow.
- GitHub Pages workflow and `netlify.toml`.

[1.1.1]: https://github.com/Cheezwedge/Tool-Hub/compare/a3dc508...main
[1.1.0]: https://github.com/Cheezwedge/Tool-Hub/compare/4a6135e...a3dc508
[1.0.1]: https://github.com/Cheezwedge/Tool-Hub/compare/d93dc29...4a6135e
[1.0.0]: https://github.com/Cheezwedge/Tool-Hub/commit/d93dc29

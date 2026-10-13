# CLAUDE.md

Working notes for anyone — human or AI — picking this repo up cold. It covers
the decisions behind the code and the things that will bite you, not what the
code already says. For what the project *is* and how to run it, read
[README.md](README.md) first.

---

## 1. The one constraint everything follows from

**There is no backend and there never will be.** Every tool runs in the
browser, the build is static files, and hosting is a free static host. That is
not incidental — it is the reason the project exists. The predecessors were a
PowerShell + ImageMagick script and a standalone HTML page, and the whole
point of the hub is that it opens from a URL on any machine or phone with
nothing installed.

Before adding anything, check it against that: no server, no database, no
accounts, no API keys, no paid services.

When a feature genuinely cannot be done client-side, **say so and offer the
honest alternative** rather than quietly degrading. Site to Markdown is the
worked example — see §5.

---

## 2. Architecture, and why

### The registry is the single source of truth

`src/registry.js` lists the tools. The landing grid renders from it, page
titles come from it, and the shared header reads it. Adding a tool is one
folder plus one array entry.

### Build entry points are discovered, not declared

`vite.config.js` scans `src/tools/*/index.html` with `readdirSync` instead of
keeping a hand-written `input` map. The original plan specified a manual map;
it was dropped deliberately because it is the step a contributor forgets, and
forgetting it produces a tool that works in `dev` and silently 404s in
production. Discovery removes the failure mode entirely.

**Consequence:** a directory under `src/tools/` with an `index.html` becomes a
public page whether or not it is in the registry. Registry absence only hides
the card.

### `base` is driven by an env var

`vite.config.js` reads `process.env.BASE_PATH`. GitHub Pages serves from
`/<repo>/`, Netlify from the domain root, and the *same commit* must work on
both. Nothing in the source hard-codes a domain or a leading slash:

- JS resolves links through `import.meta.env.BASE_URL` (`toolUrl`, `hubUrl` in
  the registry).
- HTML uses root-relative `/favicon.svg`; Vite rewrites those at build time.

If you add a link or asset reference, use one of those two mechanisms. A
literal `/something` in JS will break the Pages deployment and *not* the local
one, which is the worst way to find out.

### One bundle per tool

Multi-page Vite, so a heavy dependency only costs the page that imports it.
`turndown` does not load on the watermark page. This is why "just npm install
it" is acceptable here when a tool genuinely needs a library.

### Shared toolkit, not a framework

Plain functions returning DOM nodes. `src/lib/storage.js` and
`src/lib/download.js` are the shared primitives; reuse them rather than
re-rolling. `storage.js` wraps every access in try/catch because Safari private
mode *throws* on `localStorage` access rather than returning null — a tool must
keep working, just without remembering settings.

---

## 3. Conventions

- **Design tokens only.** Colours, radius, fonts and spacing live in
  `src/styles/tokens.css`. Never hard-code a colour in a tool stylesheet.
- **`base.css` owns the components.** `.panel`, `.field`, `.btn`, `.checkbox`,
  `.progress`, `.log`, `.empty-state`. A tool's own CSS should be layout only.
- **Settings are namespaced per tool** under `tool-hub:<toolId>`, loaded through
  `loadSettings(id, DEFAULTS)` which merges over defaults and drops unknown
  keys, so changing `DEFAULTS` later never leaves a half-populated object.
- **Every tool with options has Reset to defaults.**
- **Long jobs get progress + a live log + a working Stop**, processed
  sequentially with a `setTimeout(0)` yield between items so the UI paints and
  Stop stays responsive.
- **Comments explain *why*.** The code says what. Don't narrate.
- **British spelling** in user-facing copy ("centre", "colour").

### Visibility is toggled with the `hidden` attribute

`base.css` carries `[hidden] { display: none !important; }`. This is not
decoration. Without it, a component rule with higher specificity than a utility
class — `input[type="file"] { width: 100% }` beats `.visually-hidden` — leaves
a "hidden" element laid out and overflowing the page. That exact bug shipped
once and was caught by the mobile-overflow check.

---

## 4. Gotchas that cost real time

### ImageMagick semantics the watermark port must preserve

The watermark tool is a port of `watermark_gui.ps1`, and two details decide
whether output matches what the user already has:

1. **Shadow opacity compounds with watermark opacity.** ImageMagick builds the
   shadow from a clone of the *already alpha-reduced* watermark, so at the
   defaults (70% mark, 100% shadow) the real shadow is 70%. The first
   implementation made them independent — which reads as more "correct" but
   produces visibly heavier shadows than the tool being replaced.
2. **`-shadow NxS` takes `S` as a Gaussian sigma; canvas `shadowBlur` is
   roughly 2× sigma.** The slider keeps ImageMagick's meaning and doubles
   internally (`SHADOW_BLUR_TO_CANVAS`).

Both are in `composite.js`. Changing either silently changes everyone's output.

### The shadow is drawn off-canvas on purpose

`renderShadowTile` draws the watermark far off the left edge of a small tile
with a matching positive `shadowOffsetX`, so only the shadow lands inside. That
is the only way to get a shadow whose opacity is independent of the mark's own
alpha in one pass. The alternatives were tried and rejected: drawing both
together couples the alphas, and erasing the mark afterwards with
`destination-out` punches a hole in the shadow that shows through whenever mark
opacity < 100%.

### Known, accepted divergence from ImageMagick

For the six non-corner anchors, ImageMagick applies the margin along the
centred axis too (`North` + 10px sits 10px right of centre). This port centres
exactly. Corners — including the `SouthEast` default — are identical. Documented
in the README; don't "fix" it without asking.

### Escaping inside the Python generator

`script-template.js` builds Python source inside a **JS template literal**.
Anything destined for the generated file needs doubling:

- `\\n` in the JS source → `\n` in the Python. A single `\n` becomes a real
  newline and produces `SyntaxError: unterminated string literal`.
- `\\s` likewise; a lone `\s` in a template literal silently collapses to `s`
  and quietly corrupts the regex.
- Backticks must be escaped. Rather than fight three of them in a row, the
  generated code builds its fence as `fence = "\`" * 3`.

Both classes of bug shipped during development and were caught **only** because
the test executes the generated script. Keep it that way.

### Re-running a job must retire the previous result

Fixed in `startRun()`. Previously the status line, the stats panel and the
Download button kept describing the *last* run while a new one was in flight,
so a user could download stale output believing it was fresh. It also made the
test suite intermittently read stale state and fail ~1 run in 5. If you add
another long-running tool, reset the output affordances when the job starts,
not when it finishes.

---

## 5. Site to Markdown: why it has three modes

A browser **cannot** crawl arbitrary sites. Cross-origin `fetch` of another
origin's HTML is blocked by CORS; that is the security model, not a gap. The
Python original works precisely because it is not in a browser.

Rather than ship something that fails on every real docs site, the tool offers
three routes and is explicit about each:

1. **Local HTML files** — fully offline, no caveats, best for a few pages.
2. **Generate a crawler script** — the honest answer for a whole site. The
   browser configures; Python does the crawling.
3. **Crawl from the page** — real crawling, but only through a user-supplied
   fetch proxy.

**The proxy field is deliberately left empty.** Pre-filling a public CORS proxy
would route everything the user crawls through a third party while the hub's
front page talks about work happening in your browser. Making them paste one is
the disclosure. Do not "improve" this by adding a default.

The landing copy was weakened accordingly — it no longer claims every tool
works offline, because that stopped being true. Keep product copy honest as
features land.

### Output structure

Page headings are demoted one level and a leading `<h1>` duplicating the page
title is dropped (`nestHeadings`), so the combined file has one coherent
hierarchy instead of every page contributing a competing `#`. The same logic is
reimplemented in the generated Python so both paths produce identical
structure — change one, change the other.

### Safety note

Fetched HTML is parsed with `DOMParser` into a **detached** document (scripts
never execute) and only the resulting Markdown *text* is rendered, into
`textContent`. Never `innerHTML` fetched content into the live page.

---

## 6. Testing

`scripts/e2e.mjs` is the whole suite: one script, real Chromium, no framework.
54 checks. It is written to verify **outcomes, not appearances**:

- QR codes are decoded back with `jsqr` — including recoloured, high-EC,
  tight-margin, and logo-covered variants. "Pixels appeared" proves nothing.
- Watermark output is inspected from inside the downloaded ZIP: dimensions,
  EXIF rotation (a 1000×600 source tagged orientation 6 must come out
  600×1000), corner placement, and the shadow measured against a shadow-off
  run rather than an absolute darkness threshold.
- The generated Python is **written to a temp dir and executed** against the
  fixture site, then its output is compared to the browser's.

`scripts/fixture-site.mjs` is a throwaway CORS-permitting docs site with a
deliberate out-of-scope `/blog/` page so scope rules are actually exercised.

Install the Python side with `python3 -m pip`, not bare `pip` — see the README;
a mismatched interpreter fails that one check with a confusing
`ModuleNotFoundError` after a successful-looking install.

### When a check fails, debug it — don't re-run it

The stale-state bug above passed three consecutive runs before reappearing. A
flaky check is a defect report with bad formatting. Reproduce it in isolation
(a small focused script is cheap), find the mechanism, fix the product if the
product is wrong, and add a check that pins the behaviour.

---

## 7. Deployment

Live at <https://cheezwedge.github.io/Tool-Hub/>, published by
`.github/workflows/deploy.yml` on every push to `main`.

Two setup facts that cost a debugging cycle and are not obvious from the
failure messages:

1. **Pages source must be "GitHub Actions"**, not "Deploy from a branch".
   Until then `configure-pages` fails with a 404 while the build itself is fine.
2. **The `github-pages` environment pins deployments to the default branch as
   it was when Pages was enabled.** This repo was first pushed to a
   Claude-generated branch, which GitHub made the default; enabling Pages
   recorded *that* branch, and changing the default to `main` afterwards did
   not rewrite the stored policy. The deploy job then fails in ~2 seconds with
   no logs and no runner. Fix under Settings → Environments → github-pages →
   Deployment branches.

The session's GitHub token cannot dispatch or re-run workflows (`403 Resource
not accessible by integration`). Trigger a deploy with a push, or ask the user
to press the button.

Note for cloud sessions: the agent proxy blocks `*.github.io`, so you cannot
curl the live site to verify a deploy. Check the workflow run conclusion via
the GitHub API instead, and say that is what you checked.

---

## 8. Branches

`main` is the deploy branch and the source of truth. The original
`claude/tool-hub-project-ugqbzx` branch still exists at the first commit and is
**stale** — a fresh container may check it out by default, which makes the repo
look like it has lost two commits' worth of work. Check `git log origin/main`
before concluding anything is missing.

---

## 9. Adding a tool

The mechanical steps are in the README. Beyond those:

- Reuse `mountHeader`, `loadSettings`/`saveSettings`, and the `download.js`
  helpers rather than reimplementing them.
- Prefer platform APIs (Canvas, File System Access, `createImageBitmap`) over
  dependencies.
- Detect capability and offer the fallback — never show a control the browser
  cannot honour. The watermark tool hides folder mode entirely when
  `showDirectoryPicker` is absent.
- Add e2e checks that assert the output is *correct*, not that the UI rendered.
- State the tool's network behaviour in its own UI if it is anything other than
  "none".

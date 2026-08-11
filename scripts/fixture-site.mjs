/**
 * A tiny CORS-permitting docs site, used by the e2e test to exercise the
 * Site-to-Markdown crawler and the Python script it generates.
 *
 *   node scripts/fixture-site.mjs [port]
 */
import { createServer } from "node:http";

const PORT = Number(process.argv[2] ?? 4180);

const PAGES = {
  "/docs/": {
    title: "Getting Started",
    body: `
      <p>Welcome to the <strong>Fixture API</strong>. This paragraph exists so
      the content heuristic sees a real article rather than an empty shell, and
      it needs to be comfortably longer than two hundred characters to clear
      that bar without any trouble at all.</p>
      <h2>Install</h2>
      <pre><code class="language-bash">npm install fixture-api</code></pre>
      <p>See <a href="/docs/auth">Authentication</a> and
      <a href="/docs/rates">Rates</a>. Also <a href="/blog/news">our blog</a>
      and <a href="https://elsewhere.example/">an external site</a>.</p>`,
  },
  "/docs/auth": {
    title: "Authentication",
    body: `
      <p>Every request needs a bearer token in the Authorization header, and
      this sentence is padding so that the extractor treats the page as real
      content instead of discarding it as an empty wrapper element.</p>
      <table>
        <thead><tr><th>Field</th><th>Type</th></tr></thead>
        <tbody><tr><td>token</td><td>string</td></tr></tbody>
      </table>
      <p><a href="/docs/">Back to start</a> · <a href="/docs/rates">Rates</a></p>
      <p><img src="../img/diagram.png" alt="Auth flow"></p>`,
  },
  "/docs/rates": {
    title: "Rates",
    body: `
      <p>Rate objects describe the cost of a shipment, and once again there is
      enough prose here to be sure the main-content detection picks this
      element rather than falling back to the whole body of the document.</p>
      <ul><li>amount</li><li>currency</li></ul>
      <p><a href="/docs/">Home</a></p>`,
  },
  "/blog/news": {
    title: "Blog — should be out of scope",
    body: "<p>This page lives outside /docs/ and must not be crawled.</p>",
  },
};

function render(path) {
  const page = PAGES[path];
  if (!page) return null;

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${page.title} | Fixture Docs</title></head>
<body>
  <header><h3>Fixture Docs</h3></header>
  <nav><a href="/docs/">Start</a> <a href="/docs/auth">Auth</a> <a href="/docs/rates">Rates</a></nav>
  <aside class="sidebar"><p>Sidebar noise that must be stripped.</p></aside>
  <main>
    <h1>${page.title}</h1>
    ${page.body}
  </main>
  <footer><p>Footer noise that must be stripped.</p></footer>
  <script>window.__junk = "scripts must never survive";</script>
</body>
</html>`;
}

createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname.replace(/\/+$/, "") || "/docs";
  const html = render(path === "/docs" ? "/docs/" : path);

  // Permissive CORS is the whole point: it lets the browser-side crawler be
  // tested against a real cross-origin host.
  response.setHeader("Access-Control-Allow-Origin", "*");

  if (!html) {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("not found");
    return;
  }

  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}).listen(PORT, () => console.log(`fixture site on http://localhost:${PORT}/docs/`));

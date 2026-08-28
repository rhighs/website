import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(repositoryRoot, "web.static");
const fixture = JSON.parse(
  await readFile(
    join(repositoryRoot, "test/fixtures/legacy-urls.json"),
    "utf8",
  ),
);
const allRoutes = [...fixture.routes, ...(fixture.additionalRoutes ?? [])];
const postRoutes = [
  "/posts/mini-rproxy.html",
  "/posts/mistuck.html",
  "/posts/quadtrees.html",
];
const prototypeRoutes = new Set([
  "/home-variants.html",
  "/quote-variants.html",
]);

test("the generated site preserves all published routes, headings, and assets", async () => {
  for (const page of allRoutes) {
    const html = await readFile(outputPathForRoute(page.route), "utf8");
    const actualIds = new Set(
      [...html.matchAll(/<h[1-6]\b[^>]*\bid="([^"]+)"[^>]*>/giu)].map(
        (match) => match[1],
      ),
    );
    for (const id of page.headingIds) {
      assert.ok(
        actualIds.has(id),
        `${page.route} is missing published heading #${id}`,
      );
    }
  }

  for (const asset of fixture.assets) {
    assert.ok(
      (await stat(join(outputRoot, asset.slice(1)))).isFile(),
      `${asset} is missing`,
    );
  }
});

test("the published HTML route inventory is exact", async () => {
  const actual = (await listFiles(outputRoot))
    .filter((file) => file.endsWith(".html"))
    .map((file) => `/${relative(outputRoot, file).replaceAll("\\", "/")}`)
    .filter((route) => !prototypeRoutes.has(route))
    .sort();
  const expected = allRoutes.map((page) => page.route).sort();
  assert.deepEqual(actual, expected);
});

test("layout studies stay private", async () => {
  const homePreview = await readFile(
    join(outputRoot, "home-variants.html"),
    "utf8",
  );
  const quotePreview = await readFile(
    join(outputRoot, "quote-variants.html"),
    "utf8",
  );
  for (const preview of [homePreview, quotePreview]) {
    assert.match(
      preview,
      /<meta name="robots" content="noindex, nofollow"\s*\/?>/iu,
    );
  }
  assert.match(homePreview, /data-variant="original-tight"/iu);
  assert.match(homePreview, /data-variant="offset-content"/iu);
  assert.match(quotePreview, /data-variant="quiet-wide"/iu);
  assert.match(quotePreview, /data-variant="split-mark"/iu);
});

test("every generated local link, asset, and fragment resolves", async () => {
  for (const page of allRoutes) {
    const html = await readFile(outputPathForRoute(page.route), "utf8");
    for (const [, attribute, value] of html.matchAll(
      /\b(href|src)="([^"]+)"/giu,
    )) {
      await assertLocalReferenceResolves(page.route, attribute, value);
    }
  }
});

test("navigation drops the old broken assets page", async () => {
  const home = await readFile(join(outputRoot, "index.html"), "utf8");
  assert.doesNotMatch(home, /href="(?:\.\/)?assets\/index\.html"/u);
  assert.match(home, /href="posts\/index\.html"/u);
  assert.match(home, /href="quotes\/index\.html"/u);
  assert.match(home, /href="resources\/index\.html"/u);
  assert.doesNotMatch(home, />\.{1,2}<\/a>/u);
});

test("posts use unique IMD covers with shared cached runtime and pack assets", async () => {
  const runtimePaths = new Set();
  const artScriptPaths = new Set();
  const artStylePaths = new Set();
  const highlightScriptPaths = new Set();
  const coverPaths = new Set();

  for (const route of postRoutes) {
    const html = await readFile(outputPathForRoute(route), "utf8");
    assert.match(html, /data-imd-typeface="book"/iu);
    assert.match(html, /class="imd-art imd-art--cover"/iu);
    assert.doesNotMatch(html, /class="imd-art imd-art--footer"/iu);
    assert.match(html, /data-imd-hydration="imd-hydration"/iu);
    const cover = html.match(/<img class="imd-art__image"[^>]*src="([^"]+)"/iu);
    assert.ok(cover, `${route} is missing its generated cover image`);
    coverPaths.add(
      new URL(cover[1], new URL(route, "https://site.test/")).pathname,
    );

    const base = new URL(route, "https://site.test/");
    for (const [, source] of html.matchAll(
      /<script\b[^>]*\bsrc="([^"]+)"/giu,
    )) {
      const path = new URL(source, base).pathname;
      if (path.includes("/_imd/runtime/")) runtimePaths.add(path);
      if (path.includes("/_imd/feature-highlight/"))
        highlightScriptPaths.add(path);
      if (path.includes("/_imd/pack-art/")) artScriptPaths.add(path);
    }
    for (const [, href] of html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/giu)) {
      const path = new URL(href, base).pathname;
      if (path.includes("/_imd/pack-art/")) artStylePaths.add(path);
    }
  }

  assert.equal(
    runtimePaths.size,
    1,
    "pages should share one cached IMD runtime",
  );
  assert.equal(
    artScriptPaths.size,
    1,
    "pages should share one cached art script",
  );
  assert.equal(
    artStylePaths.size,
    1,
    "pages should share one cached art stylesheet",
  );
  assert.equal(
    highlightScriptPaths.size,
    1,
    "code posts should share one syntax highlighter",
  );
  assert.equal(
    coverPaths.size,
    postRoutes.length,
    "every post should have its own cover",
  );
});

test("plain pages stay static while preserving IMD's book typography", async () => {
  for (const route of allRoutes
    .map((page) => page.route)
    .filter((route) => !postRoutes.includes(route))) {
    const html = await readFile(outputPathForRoute(route), "utf8");
    if (!route.endsWith("/index.html") || route === "/index.html") {
      assert.match(html, /data-imd-typeface="book"/iu);
    }
    assert.doesNotMatch(html, /data-imd-hydration="imd-hydration"/iu);
    assert.doesNotMatch(html, /<script\b/iu);
  }
});

test("long posts use IMD's embedded outline", async () => {
  for (const route of postRoutes) {
    const html = await readFile(outputPathForRoute(route), "utf8");
    assert.match(
      html,
      /class="imd-outline-compact"/iu,
      `${route} is missing its IMD outline`,
    );
    assert.match(
      html,
      /class="imd-outline__link"/iu,
      `${route} has an empty IMD outline`,
    );
  }

  for (const file of await listFiles(join(repositoryRoot, "web"))) {
    if (!/\.(?:md|imd)$/u.test(file)) continue;
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      /^## Talbe of contents$/gmu,
      `${file} has a hand-written outline`,
    );
  }

  const style = await readFile(
    join(repositoryRoot, "static/style.css"),
    "utf8",
  );
  assert.match(
    style,
    /\.site-main\[data-section="posts"\] \.imd-outline\s*\{[^}]*position:\s*sticky\s*!important/isu,
  );
  assert.match(
    style,
    /@media \(max-width:\s*800px\)[\s\S]*?\.imd-outline-compact\s*\{[^}]*display:\s*none\s*!important/isu,
  );
});

test("the site shell leaves IMD typography and tokens intact", async () => {
  const style = await readFile(
    join(repositoryRoot, "static/style.css"),
    "utf8",
  );
  assert.match(
    style,
    /\.imd-document\s*\{[^}]*--imd-font-mono:\s*var\(--site-font-mono\)\s*!important/isu,
  );
  assert.doesNotMatch(style, /--imd-font-prose\s*:/iu);
  assert.match(style, /font-family:\s*"Source Code Pro"/iu);
  assert.match(style, /\.site-header\s*\{[^}]*white-space:\s*nowrap/isu);
  assert.match(style, /\.site-nav ul\s*\{[^}]*flex-wrap:\s*nowrap/isu);

  for (const page of allRoutes) {
    const html = await readFile(outputPathForRoute(page.route), "utf8");
    assert.match(html, /<header class="site-header">/iu);
    assert.match(html, /<a class="site-title"[^>]*>~rhighs<\/a>/iu);
    assert.match(html, /<nav class="site-nav" aria-label="Site navigation">/iu);
    assert.match(html, /<main id="main" class="site-main"/iu);
    assert.match(
      html,
      /<footer class="site-footer" aria-label="End of page">/iu,
    );
  }
});

test("post headers show publication date and reading stats", async () => {
  for (const route of postRoutes) {
    const html = await readFile(outputPathForRoute(route), "utf8");
    assert.match(html, /<header class="post-header">/iu);
    assert.match(html, /<time datetime="\d{4}-\d{2}-\d{2}">/iu);
    assert.match(html, /<span>\d+ min read<\/span>/iu);
    assert.match(html, /<span>[\d,]+ words<\/span>/iu);
  }
});

test("directory pages are native generated indexes", async () => {
  const posts = await readFile(join(outputRoot, "posts/index.html"), "utf8");
  const quotes = await readFile(join(outputRoot, "quotes/index.html"), "utf8");
  const resources = await readFile(
    join(outputRoot, "resources/index.html"),
    "utf8",
  );

  for (const html of [posts, quotes, resources]) {
    assert.match(html, /class="imd-site-index"/iu);
    assert.match(html, /class="imd-site-index__list"/iu);
  }
  const postList = posts.slice(
    posts.indexOf('<ol class="imd-site-index__list">'),
  );
  assert.ok(
    postList.indexOf("mistuck.html") < postList.indexOf("mini-rproxy.html"),
  );
  assert.ok(
    postList.indexOf("mini-rproxy.html") < postList.indexOf("quadtrees.html"),
  );
  assert.match(posts, /May 13, 2026/iu);
  assert.match(posts, /\d+ min read/iu);
  assert.match(posts, /[\d,]+ words/iu);
  assert.match(resources, /engrams-and-neuronal-memory\.html/iu);
  assert.doesNotMatch(quotes, /class="section-art/iu);
  assert.doesNotMatch(resources, /class="section-art/iu);
});

test("quote pages hide the repeated title and use open typographic quotes", async () => {
  const style = await readFile(
    join(repositoryRoot, "static/style.css"),
    "utf8",
  );
  const html = await readFile(
    join(outputRoot, "quotes/alan-watts-mol.html"),
    "utf8",
  );
  assert.match(html, /<blockquote>/iu);
  assert.doesNotMatch(html, /class="imd-art/iu);
  assert.match(html, /~ Alan Watts/iu);
  assert.match(
    style,
    /\.site-main\[data-section="quotes"\] \.imd-markdown > h2:first-child\s*\{[^}]*clip-path:\s*inset\(50%\)/isu,
  );
  assert.match(
    style,
    /\.site-main\[data-section="quotes"\] \.imd-markdown blockquote\s*\{[^}]*max-width:\s*760px[^}]*border-inline-start:\s*0[^}]*font-size:\s*clamp\(1\.3rem,\s*2\.4vw,\s*2rem\)/isu,
  );
  assert.match(
    style,
    /\.site-main\[data-section="quotes"\] \.imd-markdown blockquote \+ p\s*\{[^}]*margin-block-start:/isu,
  );
  assert.match(style, /background:\s*transparent/iu);
  assert.match(style, /content:\s*"“"/iu);
  assert.match(style, /content:\s*"”"/iu);
});

test("navigation uses color only while external links underline on hover", async () => {
  const style = await readFile(
    join(repositoryRoot, "static/style.css"),
    "utf8",
  );
  assert.match(
    style,
    /\.site-main a\s*\{[^}]*color:\s*var\(--site-muted\)[^}]*text-decoration:\s*none/isu,
  );
  assert.match(
    style,
    /h2#links \+ ul li\s*\{[^}]*margin-block:\s*0/isu,
  );
  assert.match(
    style,
    /\.site-main a\[href\^="https:\/\/"\]:hover[\s\S]*text-decoration:\s*underline/iu,
  );
  assert.match(
    style,
    /\.site-nav a\[aria-current="location"\]\s*\{[^}]*color:\s*var\(--site-ink\)[^}]*font-weight:\s*400/isu,
  );
  assert.doesNotMatch(style, /aria-current="location"\]\s*::before/iu);
});

test("generated artwork stays lightweight and the footer can anchor short pages", async () => {
  for (const asset of [
    "web/assets/art/mini-rproxy.webp",
    "web/assets/art/mistuck.webp",
    "web/assets/art/quadtrees.webp",
    "static/art/home.webp",
    "static/art/quotes.webp",
    "static/art/resources.webp",
    "static/art/site-footer.webp",
    "static/art/site-footer-codex.webp",
    "static/fonts/source-code-pro-400.ttf",
    "static/fonts/source-code-pro-600.ttf",
  ]) {
    assert.ok(
      (await stat(join(repositoryRoot, asset))).size < 300_000,
      `${asset} is too large`,
    );
  }
  const style = await readFile(
    join(repositoryRoot, "static/style.css"),
    "utf8",
  );
  assert.match(style, /\.site-page\s*\{[^}]*min-height:\s*100dvh/isu);
  assert.match(style, /\.site-page\s*\{[^}]*display:\s*flex/isu);
  assert.match(style, /\.site-footer\s*\{[^}]*margin-block-start:\s*auto/isu);
  assert.match(style, /html::-webkit-scrollbar\s*\{[^}]*display:\s*none/isu);
  assert.match(style, /\.site-page--home\s*\{[^}]*height:\s*100dvh/isu);
  assert.match(style, /\.site-page--home\s*\{[^}]*overflow:\s*hidden/isu);
  const home = await readFile(join(outputRoot, "index.html"), "utf8");
  assert.doesNotMatch(home, /class="section-art/iu);
  assert.match(home, /src="art\/site-footer-codex\.webp"/iu);
  assert.match(home, /<a class="site-title" href="index\.html">~rhighs<\/a>/iu);
  assert.match(
    home,
    /<header class="site-header">[\s\S]*<nav class="site-nav"/iu,
  );
  assert.match(home, /id="roberto-montalti"/iu);
  assert.doesNotMatch(home, /Software, systems, and the machinery of life/iu);
});

test("the quadtrees page keeps a poster and local video access", async () => {
  const html = await readFile(join(outputRoot, "posts/quadtrees.html"), "utf8");
  assert.match(html, /<img\b[^>]*src="\.\.\/assets\/qt\/qt-nodebug\.png"/iu);
  assert.match(html, /href="\.\.\/assets\/qt\/qt-demo\.mp4"/iu);
});

test("RSS contains the expected dated posts in newest-first order", async () => {
  const rss = await readFile(join(outputRoot, "rss.xml"), "utf8");
  const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/gu)].map(
    (match) => match[1],
  );
  assert.equal(items.length, fixture.feedEntries.length);
  for (const [index, expected] of fixture.feedEntries.entries()) {
    const item = items[index];
    assert.match(
      item,
      new RegExp(`<title>${escapeRegExp(expected.title)}</title>`, "u"),
    );
    assert.match(
      item,
      new RegExp(`${escapeRegExp(expected.route.slice(1))}</link>`, "u"),
    );
    assert.equal(
      new Date(extractTag(item, "pubDate")).toISOString().slice(0, 10),
      expected.date,
    );
  }
});

test("source documents contain no raw HTML outside fenced code", async () => {
  for (const file of await listFiles(join(repositoryRoot, "web"))) {
    if (!/\.(?:md|imd)$/u.test(file)) continue;
    const source = await readFile(file, "utf8");
    const prose = source
      .replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gmu, "")
      .replace(/`[^`\n]*`/gu, "");
    assert.doesNotMatch(
      prose,
      /<\/?[A-Za-z][^>]*>/u,
      `${relative(repositoryRoot, file)} contains raw HTML`,
    );
  }
});

test("Markdown stays static and .md/.imd use the same route", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "rmontalti-imd-route-"));
  try {
    await copyProjectInputs(temporary);
    await rename(
      join(temporary, "web/quotes/alan-watts-mol.imd"),
      join(temporary, "web/quotes/alan-watts-mol.md"),
    );
    await writeFile(
      join(temporary, "web/plain.md"),
      "---\ntitle: Plain Markdown\n---\n\n# Plain Markdown\n\nThis page needs no pack.\n",
      "utf8",
    );
    await execFileAsync(
      process.execPath,
      [
        join(repositoryRoot, "node_modules/imd-site/dist/bin/imd-site.js"),
        "build",
      ],
      { cwd: temporary },
    );
    assert.ok(
      (
        await stat(join(temporary, "web.static/quotes/alan-watts-mol.html"))
      ).isFile(),
    );
    const plain = await readFile(
      join(temporary, "web.static/plain.html"),
      "utf8",
    );
    assert.match(plain, /<h1 id="plain-markdown"/iu);
    assert.doesNotMatch(plain, /<script\b/iu);
    assert.doesNotMatch(plain, /data-imd-hydration/iu);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

function outputPathForRoute(route) {
  return join(outputRoot, route.slice(1));
}

async function listFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await listFiles(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

async function copyProjectInputs(target) {
  const { cp } = await import("node:fs/promises");
  for (const path of ["imd-site.config.mjs", "layouts", "static", "web"]) {
    await cp(join(repositoryRoot, path), join(target, path), {
      recursive: true,
    });
  }
}

async function assertLocalReferenceResolves(route, attribute, value) {
  const base = new URL(route, "https://site.test/");
  const reference = new URL(value.replaceAll("&amp;", "&"), base);
  if (reference.origin !== base.origin) return;

  const pathname = decodeURIComponent(reference.pathname);
  const relativePath = pathname.endsWith("/")
    ? `${pathname.slice(1)}index.html`
    : pathname.slice(1);
  const target = join(outputRoot, relativePath);
  let targetStats;
  try {
    targetStats = await stat(target);
  } catch {
    assert.fail(`${route} contains broken ${attribute} ${value}`);
  }
  assert.ok(
    targetStats.isFile(),
    `${route} contains broken ${attribute} ${value}`,
  );

  if (!reference.hash || !target.endsWith(".html")) return;
  const html = await readFile(target, "utf8");
  const ids = new Set(
    [...html.matchAll(/\bid="([^"]+)"/giu)].map((match) => match[1]),
  );
  const fragment = decodeURIComponent(reference.hash.slice(1));
  assert.ok(ids.has(fragment), `${route} contains broken fragment ${value}`);
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, "u"));
  assert.ok(match, `missing <${tag}>`);
  return match[1];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(repositoryRoot, "web.static");
const fixture = JSON.parse(
  await readFile(join(repositoryRoot, "test/fixtures/legacy-urls.json"), "utf8"),
);

test("the generated site preserves all published routes, headings, and assets", async () => {
  for (const page of fixture.routes) {
    const html = await readFile(outputPathForRoute(page.route), "utf8");
    const actualIds = new Set(
      [...html.matchAll(/<h[1-6]\b[^>]*\bid="([^"]+)"[^>]*>/giu)].map((match) => match[1]),
    );
    for (const id of page.headingIds) {
      assert.ok(actualIds.has(id), `${page.route} is missing published heading #${id}`);
    }
  }

  for (const asset of fixture.assets) {
    assert.ok((await stat(join(outputRoot, asset.slice(1)))).isFile(), `${asset} is missing`);
  }
});

test("every generated local fragment and favicon reference resolves", async () => {
  for (const page of fixture.routes) {
    const file = outputPathForRoute(page.route);
    const html = await readFile(file, "utf8");
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/giu)].map((match) => match[1]));
    for (const [, fragment] of html.matchAll(/\bhref="#([^"]+)"/giu)) {
      assert.ok(ids.has(fragment), `${page.route} contains broken fragment #${fragment}`);
    }
    for (const [, href] of html.matchAll(/<link\b[^>]*\brel="icon"[^>]*\bhref="([^"]+)"/giu)) {
      const target = href.startsWith("/")
        ? join(outputRoot, href.slice(1))
        : resolve(dirname(file), href);
      assert.ok((await stat(target)).isFile(), `${page.route} contains broken favicon ${href}`);
    }
  }
});

test("navigation drops the old broken assets page", async () => {
  const home = await readFile(join(outputRoot, "index.html"), "utf8");
  assert.doesNotMatch(home, /href="(?:\.\/)?assets\/index\.html"/u);
  assert.match(home, /href="posts\/index\.html"/u);
  assert.match(home, /href="quotes\/index\.html"/u);
  assert.match(home, /href="resources\/index\.html"/u);
});

test("ordinary Markdown pages stay static and load no runtime scripts", async () => {
  for (const page of fixture.routes) {
    const html = await readFile(outputPathForRoute(page.route), "utf8");
    assert.doesNotMatch(html, /<script\b/iu, `${page.route} unexpectedly loads JavaScript`);
    assert.doesNotMatch(html, /data-imd-hydration/iu, `${page.route} unexpectedly hydrates`);
  }
});

test("the quadtrees page keeps a poster and local video access", async () => {
  const html = await readFile(join(outputRoot, "posts/quadtrees.html"), "utf8");
  assert.match(html, /<img\b[^>]*src="\.\.\/assets\/qt\/qt-nodebug\.png"/iu);
  assert.match(html, /href="\.\.\/assets\/qt\/qt-demo\.mp4"/iu);
});

test("RSS contains the expected dated posts in newest-first order", async () => {
  const rss = await readFile(join(outputRoot, "rss.xml"), "utf8");
  const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/gu)].map((match) => match[1]);
  assert.equal(items.length, fixture.feedEntries.length);
  for (const [index, expected] of fixture.feedEntries.entries()) {
    const item = items[index];
    assert.match(item, new RegExp(`<title>${escapeRegExp(expected.title)}</title>`, "u"));
    assert.match(item, new RegExp(`${escapeRegExp(expected.route.slice(1))}</link>`, "u"));
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

test("renaming an ordinary Markdown page to IMD keeps its route", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "rmontalti-imd-route-"));
  try {
    await copyProjectInputs(temporary);
    await rename(
      join(temporary, "web/quotes/alan-watts-mol.md"),
      join(temporary, "web/quotes/alan-watts-mol.imd"),
    );
    await execFileAsync(
      process.execPath,
      [join(repositoryRoot, "node_modules/imd-site/dist/bin/imd-site.js"), "build"],
      { cwd: temporary },
    );
    assert.ok(
      (await stat(join(temporary, "web.static/quotes/alan-watts-mol.html"))).isFile(),
    );
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
    await cp(join(repositoryRoot, path), join(target, path), { recursive: true });
  }
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, "u"));
  assert.ok(match, `missing <${tag}>`);
  return match[1];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

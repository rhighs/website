const SITE_SUBTITLE = "~rhighs";

export default ({ site, page, content, escapeHtml }) => {
  const homeHref = relativeHref(page.route, "/index.html");
  const section = sectionForRoute(page.route);
  const nav = navigationItems(section)
    .map(
      ({ href, label, current }) =>
        `<li><a href="${escapeHtml(relativeHref(page.route, href))}"${current ? ' aria-current="location"' : ""}>${escapeHtml(label)}</a></li>`,
    )
    .join("");
  const pageLead = [
    legacyFragments(page.route),
    postHeader(site, page, escapeHtml),
  ]
    .filter(Boolean)
    .join("\n");
  const codeThemeScript = content.includes('class="imd-code"')
    ? `\n    <script src="${escapeHtml(relativeHref(page.route, "/code-theme.js"))}" defer></script>`
    : "";

  return `
    <a class="skip-link" href="#main">Skip to content</a>
    <div class="site-page site-page--${escapeHtml(section)}">
      <div class="site-shell">
        <header class="site-header">
          <a class="site-title" href="${escapeHtml(homeHref)}">${escapeHtml(SITE_SUBTITLE)}</a>
          <nav class="site-nav" aria-label="Site navigation"><ul>${nav}</ul></nav>
        </header>
      </div>
      <main id="main" class="site-main" data-section="${escapeHtml(section)}" data-page-kind="${escapeHtml(page.kind)}">
${pageLead}${pageLead === "" ? "" : "\n"}${content}
      </main>
      <footer class="site-footer" aria-label="End of page"></footer>
    </div>${codeThemeScript}
  `;
};

function legacyFragments(route) {
  if (route === "/resources/index.html") {
    return '<h2 id="neuroscience" class="legacy-fragment" aria-hidden="true">Neuroscience</h2>';
  }
  return "";
}

function postHeader(site, page, escapeHtml) {
  if (!isPost(page.route)) return "";
  const date = page.metadata.date;
  const details = [
    date === undefined
      ? undefined
      : `<time datetime="${escapeHtml(date)}">${escapeHtml(formatDate(date, site.language))}</time>`,
  ].filter(Boolean);

  return `<header class="post-header">
    <h1 id="${escapeHtml(slug(page.title))}">${escapeHtml(page.title)}</h1>
    ${page.metadata.description === undefined ? "" : `<p class="post-deck">${escapeHtml(page.metadata.description)}</p>`}
    ${details.length === 0 ? "" : `<p class="post-meta" aria-label="Post details">${details.map((detail) => `<span>${detail}</span>`).join("")}</p>`}
  </header>`;
}

function navigationItems(section) {
  return ["posts", "quotes", "resources"].map((label) => ({
    href: `/${label}/index.html`,
    label,
    current: section === label,
  }));
}

function isPost(route) {
  return route.startsWith("/posts/") && !route.endsWith("/index.html");
}

function sectionForRoute(route) {
  if (route === "/index.html") return "home";
  return (
    route
      .split("/")
      .filter(Boolean)
      .at(0)
      ?.replace(/\.html$/u, "") ?? "home"
  );
}

function relativeHref(fromRoute, toRoute) {
  const from = fromRoute.slice(1).split("/");
  from.pop();
  const target = toRoute.slice(1).split("/");
  while (from.length > 0 && target.length > 0 && from[0] === target[0]) {
    from.shift();
    target.shift();
  }
  return `${"../".repeat(from.length)}${target.join("/")}`;
}

function formatDate(value, language) {
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function slug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

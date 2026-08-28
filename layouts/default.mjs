const SITE_SUBTITLE = "~rhighs";

export default ({ site, page, navigation, content, escapeHtml }) => {
  const homeHref = relativeHref(page.route, "/index.html");
  const nav = navigationItems(page.route, navigation)
    .map(
      ({ href, label }) =>
        `<li><a href="${escapeHtml(relativeHref(page.route, href))}">${escapeHtml(label)}</a></li>`,
    )
    .join("");

  return `
    <a class="skip-link" href="#main">Skip to content</a>
    <header>
      <h1 class="headerTitle"><a href="${escapeHtml(homeHref)}">${escapeHtml(site.title)}</a></h1>
      <p class="headerSubtitle">${escapeHtml(SITE_SUBTITLE)}</p>
    </header>
    <nav id="side-bar" aria-label="Site navigation"><ul>${nav}</ul></nav>
    <main id="main">${content}</main>
  `;
};

function navigationItems(route, navigation) {
  if (route === "/index.html") {
    return navigation.children.map((entry) => ({ href: entry.route, label: routeLabel(entry.route) }));
  }

  if (route.endsWith("/index.html")) {
    return [
      ...(navigation.parent === undefined
        ? []
        : [{ href: navigation.parent.route, label: ".." }]),
      ...navigation.children.map((entry) => ({ href: entry.route, label: routeLabel(entry.route) })),
    ];
  }

  const parent = navigation.parent;
  return [
    ...(parent === undefined ? [] : [{ href: parent.route, label: "." }]),
    { href: "/index.html", label: ".." },
    ...(parent?.children ?? []).map((entry) => ({
      href: entry.route,
      label: routeLabel(entry.route),
    })),
  ];
}

function routeLabel(route) {
  const parts = route.split("/").filter(Boolean);
  const filename = parts.at(-1) ?? "index.html";
  if (filename === "index.html") return parts.at(-2) ?? ".";
  return filename.replace(/\.html$/u, "");
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

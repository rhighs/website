/* Enforce rhighs/darkened for code, independent of the bundled highlight theme. */
(() => {
  const DARKENED = {
    name: "darkened",
    type: "dark",
    colors: {
      "editor.background": "#000000",
      "editor.foreground": "#bec7d1",
    },
    tokenColors: [
      { scope: "comment", settings: { foreground: "#8784ad" } },
      { scope: "string", settings: { foreground: "#cfa1ed" } },
      { scope: "variable", settings: { foreground: "#bec7d1" } },
      { scope: "keyword", settings: { foreground: "#7ca8de" } },
      {
        scope: "constant.numeric",
        settings: { foreground: "#dedc52" },
      },
      {
        scope: "entity.name.function",
        settings: { foreground: "#bec7d1" },
      },
      {
        scope: ["storage.type", "storage.modifier"],
        settings: { foreground: "#b968fc" },
      },
      { scope: "entity.name.tag", settings: { foreground: "#b968fc" } },
      {
        scope: "entity.other.attribute-name",
        settings: { foreground: "#bec7d1" },
      },
      {
        scope: "invalid",
        settings: { foreground: "#db6088", background: "#2b1211" },
      },
      { scope: "markup.inserted", settings: { foreground: "#9cda7c" } },
      { scope: "markup.deleted", settings: { foreground: "#db6088" } },
      { scope: "markup.changed", settings: { foreground: "#d787af" } },
      { scope: "entity.name.section", settings: { foreground: "#db6088" } },
    ],
  };

  const BRIGHTENED = {
    name: "brightened",
    type: "light",
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#2f2b3b",
    },
    tokenColors: [
      { scope: "comment", settings: { foreground: "#7a7490" } },
      { scope: "string", settings: { foreground: "#6f4c93" } },
      { scope: "variable", settings: { foreground: "#2f2b3b" } },
      { scope: "keyword", settings: { foreground: "#2c659b" } },
      {
        scope: "constant.numeric",
        settings: { foreground: "#8a7715" },
      },
      {
        scope: "entity.name.function",
        settings: { foreground: "#2f2b3b" },
      },
      {
        scope: ["storage.type", "storage.modifier"],
        settings: { foreground: "#875faf" },
      },
      { scope: "entity.name.tag", settings: { foreground: "#875faf" } },
      {
        scope: "entity.other.attribute-name",
        settings: { foreground: "#2f2b3b" },
      },
      {
        scope: "invalid",
        settings: { foreground: "#a3263f", background: "#fae6ea" },
      },
      { scope: "markup.inserted", settings: { foreground: "#2e7033" } },
      { scope: "markup.deleted", settings: { foreground: "#a3263f" } },
      { scope: "markup.changed", settings: { foreground: "#b8567a" } },
      { scope: "entity.name.section", settings: { foreground: "#a3263f" } },
    ],
  };

  const lightQuery = window.matchMedia("(prefers-color-scheme: light)");
  const activeTheme = () => (lightQuery.matches ? BRIGHTENED : DARKENED);

  const escapeHtml = (value) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

  const render = (node) => {
    if (node.type === "text") return escapeHtml(node.value);
    if (node.type === "root")
      return (node.children ?? []).map(render).join("");
    if (node.type !== "element") return "";
    const attributes = Object.entries(node.properties ?? {})
      .map(([name, value]) => ` ${name}="${escapeHtml(String(value))}"`)
      .join("");
    return `<${node.tagName}${attributes}>${(node.children ?? []).map(render).join("")}</${node.tagName}>`;
  };

  const languageFor = (code, block) => {
    const declared = block.dataset?.imdLang;
    if (declared) return declared;
    const language = [...code.classList].find((name) =>
      name.startsWith("language-"),
    );
    return language?.slice("language-".length);
  };

  const retheme = async () => {
    const highlight = window.__IMD__?.features?.highlight;
    if (!highlight?.codeToHast) return;
    const theme = activeTheme();

    const blocks = [
      ...document.querySelectorAll(".imd-code"),
      ...document.querySelectorAll(".imd-markdown > pre"),
    ];

    await Promise.all(
      blocks.map(async (block) => {
        const code = block.matches("pre")
          ? block.querySelector(":scope > code")
          : block.querySelector("pre > code");
        if (!code) return;

        const language = languageFor(code, block);
        if (!language || language === "mermaid") return;
        if (code.dataset.imdTheme === theme.name) return;
        if (code.dataset.imdTheming === "true") return;

        code.dataset.imdTheming = "true";
        try {
          const hast = await highlight.codeToHast(code.textContent, {
            lang: language,
            theme,
          });
          const pre = hast.children?.find(
            (node) => node.type === "element" && node.tagName === "pre",
          );
          const themed = pre?.children?.find(
            (node) => node.type === "element" && node.tagName === "code",
          );
          if (!themed) return;
          code.innerHTML = (themed.children ?? []).map(render).join("");
          code.dataset.imdTheme = theme.name;
        } catch {
          /* Keep the readable server-rendered code if highlighting fails. */
        } finally {
          delete code.dataset.imdTheming;
        }
      }),
    );
  };

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      void retheme();
    }, 40);
  };

  schedule();
  window.addEventListener("load", schedule);
  lightQuery.addEventListener("change", () => {
    for (const code of document.querySelectorAll("code[data-imd-theme]")) {
      delete code.dataset.imdTheme;
    }
    schedule();
  });
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();

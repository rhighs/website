const buttons = [...document.querySelectorAll("[data-variant-button]")];
const variants = [...document.querySelectorAll("[data-variant]")];
const variantNames = new Set(
  variants.map((variant) => variant.dataset.variant),
);

function showVariant(name, { updateHistory = true } = {}) {
  if (!variantNames.has(name)) return;

  for (const button of buttons) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.variantButton === name),
    );
  }

  for (const variant of variants) {
    variant.hidden = variant.dataset.variant !== name;
  }

  if (updateHistory) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("layout", name);
      window.history.replaceState(null, "", url);
    } catch {
      // The preview still works if browser history is unavailable.
    }
  }

  document.title = `${
    buttons
      .find((button) => button.dataset.variantButton === name)
      ?.textContent.trim()
      .replace(/^\d\s*/, "") ?? "Homepage layout"
  } · Roberto Montalti`;
  window.scrollTo({ top: 0, behavior: "auto" });
}

for (const button of buttons) {
  button.addEventListener("click", () =>
    showVariant(button.dataset.variantButton),
  );
}

window.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement
  )
    return;

  const index = Number.parseInt(event.key, 10) - 1;
  const button = buttons[index];
  if (button === undefined) return;

  event.preventDefault();
  button.focus();
  showVariant(button.dataset.variantButton);
});

document.documentElement.dataset.enhanced = "true";
const requestedVariant = new URLSearchParams(window.location.search).get(
  "layout",
);
showVariant(
  variantNames.has(requestedVariant) ? requestedVariant : "original-tight",
  { updateHistory: false },
);

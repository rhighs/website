const buttons = [...document.querySelectorAll("[data-variant-button]")];
const variants = [...document.querySelectorAll("[data-variant]")];
const names = new Set(variants.map((variant) => variant.dataset.variant));

function showVariant(name, { updateHistory = true } = {}) {
  if (!names.has(name)) return;

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
      url.searchParams.set("style", name);
      window.history.replaceState(null, "", url);
    } catch {
      // The styles remain usable if browser history is unavailable.
    }
  }

  window.scrollTo({ top: 0, behavior: "auto" });
}

for (const button of buttons) {
  button.addEventListener("click", () =>
    showVariant(button.dataset.variantButton),
  );
}

window.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const index = Number.parseInt(event.key, 10) - 1;
  const button = buttons[index];
  if (button === undefined) return;
  event.preventDefault();
  button.focus();
  showVariant(button.dataset.variantButton);
});

document.documentElement.dataset.enhanced = "true";
const requested = new URLSearchParams(window.location.search).get("style");
showVariant(names.has(requested) ? requested : "quiet-wide", {
  updateHistory: false,
});

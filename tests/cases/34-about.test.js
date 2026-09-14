// The About window behind the mark: the version content.js stamped on the
// shell, the code-list issue, the shortcuts and the links.
const {
  test, describe, assert, render, $$,
} = require("../harness");

const mark = (w) => w.document.querySelector('#oxv-toolbar [data-action="about"]');
const modal = (w) => w.document.getElementById("oxv-about");

describe("About window", () => {
  test("clicking the mark opens it with the version and the code-list issue", () => {
    const w = render("onix-3.1-valid.xml");
    assert(!modal(w), "not built until asked for");
    mark(w).focus();
    mark(w).click();
    assert(modal(w) && !modal(w).hidden, "opens");
    assert(w.document.getElementById("oxv-about-title").textContent === "About ONIX Viewer");
    assert(w.document.getElementById("oxv-about-version").textContent === "Version 0.0.0-test",
      `the version the shell was stamped with; got "${w.document.getElementById("oxv-about-version").textContent}"`);
    const facts = [...$$(w, "#oxv-about dt")].map((dt) => `${dt.textContent}: ${dt.nextElementSibling.textContent}`);
    const schema = w.OnixViewerCodeListSchema;
    const dated = schema.releaseDate ? ` (${schema.releaseDate})` : "";
    assert(facts.join("; ") === `Version: 0.0.0-test; Code lists: EDItEUR Issue ${schema.issue}${dated}`,
      `the facts; got ${facts.join("; ")}`);
    const dialog = modal(w).querySelector(".px-popup");
    assert(dialog.getAttribute("aria-modal") === "true" &&
      dialog.getAttribute("aria-labelledby") === "oxv-about-title", "the dialog contract");
    assert(w.document.activeElement === modal(w).querySelector(".px-popup-close"), "focus on close");
  });

  test("it lists every keyboard shortcut the viewer answers to, and the links", () => {
    const w = render("onix-3.1-valid.xml");
    mark(w).click();
    const keys = [...$$(w, "#oxv-about kbd")].map((k) => k.textContent);
    assert(keys.join("") === "/ectvw?", `got ${keys.join(" ")}`);
    const links = [...$$(w, "#oxv-about a")].map((a) => a.href);
    assert(links.length === 3 && links.every((href) => href.startsWith("https://")), `got ${links.join(", ")}`);
    assert(links.some((href) => href.includes("afdfkehnjkpgfhkgpacimefkkgfgkife")), "the store listing by item ID");
    assert([...$$(w, "#oxv-about a")].every((a) => a.target === "_blank" && a.rel.includes("noopener")),
      "links open in a new tab without a referrer to the page");
  });

  test("? opens it, Escape closes it, and shortcuts stay quiet while it is up", () => {
    const w = render("onix-3.1-valid.xml");
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "?", bubbles: true }));
    assert(modal(w) && !modal(w).hidden, "? opens");
    const before = w.document.querySelectorAll("#oxv-root .px-folded").length;
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "c", bubbles: true }));
    assert(w.document.querySelectorAll("#oxv-root .px-folded").length === before, "c did not collapse behind it");
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert(modal(w).hidden, "closed");
  });

  test("without a stamped version it says so rather than nothing", () => {
    const w = render("onix-3.1-valid.xml");
    w.document.documentElement.removeAttribute("data-oxv-version");
    mark(w).click();
    assert(w.document.getElementById("oxv-about-version").textContent === "", "no eyebrow");
    assert($$(w, "#oxv-about dd")[0].textContent === "unknown", "but the fact row is honest");
  });
});

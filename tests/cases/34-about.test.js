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

  // content.js stamps the browser on the shell; the harness says "chrome".
  // Under another stamp the wording stays neutral and the install link is
  // the web page, since only Chrome has a listing to point at yet.
  test("the wording names no browser, and the install link follows the stamped one", () => {
    const chrome = render("onix-3.1-valid.xml");
    mark(chrome).click();
    assert(!chrome.document.querySelector("#oxv-about .px-about-text").textContent.includes("Chrome"),
      "the description does not say which browser");
    const stamped = (browser) => render("onix-3.1-valid.xml", (w) => {
      w.document.documentElement.setAttribute("data-oxv-browser", browser);
    });
    const linksIn = (browser) => {
      const w = stamped(browser);
      mark(w).click();
      return [...$$(w, "#oxv-about a")].map((a) => `${a.textContent} → ${a.href}`);
    };
    const firefox = linksIn("firefox");
    assert(firefox.some((l) => l.startsWith("Firefox Add-ons → https://addons.mozilla.org/firefox/addon/onix-viewer/")),
      `Firefox gets its AMO listing; got ${firefox.join(", ")}`);
    const safari = linksIn("safari");
    assert(safari.some((l) => l.startsWith("Web page → https://maendeleo.io/onix-viewer/")),
      `Safari gets the web page until it has a listing; got ${safari.join(", ")}`);
    for (const labels of [firefox, safari]) {
      assert(!labels.some((l) => l.includes("chromewebstore")), "neither gets the Chrome store");
    }
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

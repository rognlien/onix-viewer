// What ships while the custom-rules editor is held back: no cog, and no
// rules read from the page. The feature's own tests (32, 33) turn it on
// through window.OnixViewerFeatures; these run with the shipped defaults.
const fs = require("fs");
const path = require("path");
const { test, describe, assert, render, renderSource, validationLabel, FIXTURES } = require("../harness");

const HOUSE_RULES = fs.readFileSync(path.join(FIXTURES, "house-rules.sch"), "utf8");
const VALID = fs.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");

describe("Held-back features", () => {
  test("the shipped default holds the custom rules off", () => {
    const w = render("onix-3.1-valid.xml");
    assert(w.OnixViewerFeatures.customRules === false, `got ${JSON.stringify(w.OnixViewerFeatures)}`);
  });

  test("the toolbar has no cog, and a rules block on the page is ignored", () => {
    const w = renderSource(VALID, "valid.xml", (win) => {
      const holder = win.document.createElement("script");
      holder.setAttribute("type", "application/xml");
      holder.id = "__oxv-rules__";
      holder.textContent = HOUSE_RULES;
      win.document.body.appendChild(holder);
    });
    assert(!w.document.querySelector('#oxv-toolbar [data-action="rules"]'), "no cog in the toolbar");
    assert(validationLabel(w).textContent === "Valid", `the house rules did not run; got "${validationLabel(w).textContent}"`);
    assert(!w.document.getElementById("oxv-rules"), "and no editor was built");
  });

  test("the release selector is not held back: the document's release is the default, the other a choice", () => {
    const w = render("onix-3.0-reference.xml");
    const select = w.document.getElementById("oxv-release");
    assert(!select.disabled && select.value === "3.0", `starts on the document's release; got ${select.value}`);
    assert([...select.options].map((o) => o.value).join() === "3.0,3.1", "and offers both bundled releases");
  });

  test("turned on, the cog comes back", () => {
    const w = render("onix-3.1-valid.xml", (win) => { win.OnixViewerFeatures = { customRules: true }; });
    assert(w.document.querySelector('#oxv-toolbar [data-action="rules"]'), "the cog");
  });
});

// What ships while the custom-rules editor and the release selector are held
// back: no cog, no rules read from the page, the release pill a fact rather
// than a choice. The features' own tests (32, 33, 37) turn them on through
// window.OnixViewerFeatures; these run with the shipped defaults.
const fs = require("fs");
const path = require("path");
const { test, describe, assert, render, renderSource, validationLabel, RES, FIXTURES } = require("../harness");

const HOUSE_RULES = fs.readFileSync(path.join(FIXTURES, "house-rules.sch"), "utf8");
const VALID = fs.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");

describe("Held-back features", () => {
  test("the shipped defaults hold both features off", () => {
    const w = render("onix-3.1-valid.xml");
    assert(w.OnixViewerFeatures.customRules === false && w.OnixViewerFeatures.releaseSelector === false,
      `got ${JSON.stringify(w.OnixViewerFeatures)}`);
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

  test("the release pill states the document's release and offers no choice", () => {
    for (const [fixture, release] of [["onix-3.0-reference.xml", "3.0"], ["onix-3.1-valid.xml", "3.1"], ["onix-2.1-doctype.xml", "2.1"]]) {
      const w = render(fixture);
      const select = w.document.getElementById("oxv-release");
      assert(select.disabled, `${fixture}: not a control`);
      assert(select.options.length === 1 && select.value === release, `${fixture}: one option, ${release}; got ${select.value}`);
      assert(select.parentElement.classList.contains("px-static"), `${fixture}: styled as the plain pill`);
      assert(select.options[0].textContent.startsWith(`ONIX ${release}`), `${fixture}: reads ONIX ${release}`);
    }
  });

  test("the plain pill draws no chevron", () => {
    const css = fs.readFileSync(path.join(RES, "viewer.css"), "utf8");
    assert(/#oxv-release-group\.px-static::after\s*\{\s*display:\s*none;/.test(css), "the chevron rule is off for px-static");
  });

  test("turned on, the cog and the choice come back", () => {
    const w = render("onix-3.1-valid.xml", (win) => { win.OnixViewerFeatures = { customRules: true, releaseSelector: true }; });
    assert(w.document.querySelector('#oxv-toolbar [data-action="rules"]'), "the cog");
    const select = w.document.getElementById("oxv-release");
    assert(!select.disabled && select.options.length === 2, "the two bundled releases to choose from");
  });
});

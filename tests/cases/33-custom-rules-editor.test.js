// The cog in the toolbar and the modal behind it: where a reader pastes a
// Schematron rule set. The storage round trip is content.js's, which jsdom
// never loads; the browser test covers that end.
const fs = require("fs");
const path = require("path");
const {
  test, describe, assert, render, renderSource, rowsNamed, validationLabel, FIXTURES,
} = require("../harness");

const HOUSE_RULES = fs.readFileSync(path.join(FIXTURES, "house-rules.sch"), "utf8");
const VALID = fs.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
const FOREIGN = VALID.replace("<IDValue>9788234567896</IDValue>", "<IDValue>9780306406157</IDValue>");

const cog = (w) => w.document.querySelector('#oxv-toolbar [data-action="rules"]');
const modal = (w) => w.document.getElementById("oxv-rules");
const field = (w) => w.document.getElementById("oxv-rules-text");
const status = (w) => w.document.getElementById("oxv-rules-status");
const button = (w, cls) => modal(w).querySelector(`.${cls}`);

// What the page posted to its own window, which is content.js's cue to store.
function postedRules(w) {
  const posted = [];
  w.postMessage = (data) => posted.push(data);
  return posted;
}
function withRulesBlock(text) {
  return (w) => {
    const holder = w.document.createElement("script");
    holder.setAttribute("type", "application/xml");
    holder.id = "__oxv-rules__";
    holder.textContent = text;
    w.document.body.appendChild(holder);
  };
}

describe("Custom rules editor", () => {
  test("the toolbar carries a cog that is not pressed without rules", () => {
    const w = render("onix-3.1-valid.xml");
    const button = cog(w);
    assert(button && button.querySelector("svg"), "a cog icon in the toolbar");
    assert(button.getAttribute("aria-pressed") === "false", "unpressed");
    assert(button.title === "Custom rules", `plain title, got "${button.title}"`);
    assert(!modal(w), "the modal is not built until asked for");
  });

  test("the cog opens a modal with the current rules and focus in the field", () => {
    const w = renderSource(VALID, "valid.xml", withRulesBlock(HOUSE_RULES));
    assert(cog(w).getAttribute("aria-pressed") === "true", "pressed while rules are installed");
    assert(cog(w).title === "Custom rules (5 active)", `the count in the title, got "${cog(w).title}"`);
    cog(w).click();
    assert(modal(w) && !modal(w).hidden, "the modal opens");
    assert(field(w).value === HOUSE_RULES, "prefilled with the installed rule set");
    assert(status(w).textContent === "3 patterns, 5 assertions, applied.",
      `opens already applied, with the status of the rules in force; got "${status(w).textContent}"`);
    assert(w.document.activeElement === field(w), "focus in the field");
    const dialog = modal(w).querySelector(".px-popup");
    assert(dialog.getAttribute("aria-modal") === "true" &&
      dialog.getAttribute("aria-labelledby") === "oxv-rules-title", "the dialog contract");
  });

  test("opened with no rules, the status says so", () => {
    const w = render("onix-3.1-valid.xml");
    cog(w).click();
    assert(status(w).textContent === "No custom rules.", `got "${status(w).textContent}"`);
  });

  test("opened on a rule set with problems, they are listed at once", () => {
    const broken = `<schema xmlns="http://purl.oclc.org/dsdl/schematron"><pattern>
      <rule context="Product"><assert id="bad" test="Product[">x</assert></rule></pattern></schema>`;
    const w = renderSource(VALID, "valid.xml", withRulesBlock(broken));
    cog(w).click();
    assert(status(w).textContent.startsWith("0 applied; 1 problem:"), `got "${status(w).textContent}"`);
    assert(status(w).querySelector("li"), "the problem listed");
  });

  test("Apply installs the rules, re-validates and posts them for storage", () => {
    const w = renderSource(FOREIGN, "foreign.xml");
    assert(validationLabel(w).textContent.includes("Valid"), "clean before");
    const posted = postedRules(w);
    cog(w).click();
    assert(status(w).textContent === "No custom rules.", "nothing in force yet");
    field(w).value = HOUSE_RULES;
    button(w, "px-rules-apply").click();
    assert(status(w).textContent === "3 patterns, 5 assertions, applied.",
      `the status line, got "${status(w).textContent}"`);
    assert(validationLabel(w).textContent.includes("1 warning"),
      `re-validated, got "${validationLabel(w).textContent}"`);
    const pill = rowsNamed(w, "ProductIdentifier")[0].querySelector(".px-finding");
    assert(pill && pill.getAttribute("aria-label").includes("978-82"), "the pill on the row");
    assert(posted.length === 1 && posted[0].type === "oxv-rules" && posted[0].rules === HOUSE_RULES,
      `posted once for storage, got ${JSON.stringify(posted)}`);
    assert(cog(w).getAttribute("aria-pressed") === "true", "the cog is pressed");
    assert(!modal(w).hidden, "the modal stays open to show the status");
  });

  test("problems with the rule set are listed in the status", () => {
    const w = render("onix-3.1-valid.xml");
    postedRules(w);
    cog(w).click();
    field(w).value = `<schema xmlns="http://purl.oclc.org/dsdl/schematron"><pattern>
      <rule context="Product"><assert id="bad" test="Product[">x</assert></rule>
      <rule context="Header"><report id="fine" test="true()">fine</report></rule></pattern></schema>`;
    button(w, "px-rules-apply").click();
    const text = status(w).textContent;
    assert(text.startsWith("1 applied; 1 problem:"), `the summary, got "${text}"`);
    assert(status(w).querySelector("li").textContent.includes("not valid XPath 1.0"), "the problem itself");
    assert(status(w).classList.contains("px-rules-status-problems"), "styled as a problem");
    assert(validationLabel(w).textContent.includes("1 error, 1 warning"),
      `the sound rule fires and the problem is a warning; got "${validationLabel(w).textContent}"`);
  });

  test("Clear removes the rules, the findings and the stored copy", () => {
    const w = renderSource(FOREIGN, "foreign.xml", withRulesBlock(HOUSE_RULES));
    assert(validationLabel(w).textContent.includes("1 warning"), "the rules fire on load");
    const posted = postedRules(w);
    cog(w).click();
    button(w, "px-rules-clear").click();
    assert(field(w).value === "", "the field is emptied");
    assert(status(w).textContent === "No custom rules.", `got "${status(w).textContent}"`);
    assert(validationLabel(w).textContent.includes("Valid"), "clean again");
    assert(posted.length === 1 && posted[0].rules === "", "an empty set is posted, which content.js removes");
    assert(cog(w).getAttribute("aria-pressed") === "false" && cog(w).title === "Custom rules", "the cog is released");
  });

  test("whitespace alone counts as no rules", () => {
    const w = render("onix-3.1-valid.xml");
    const posted = postedRules(w);
    cog(w).click();
    field(w).value = "  \n ";
    button(w, "px-rules-apply").click();
    assert(status(w).textContent === "No custom rules." && posted[0].rules === "", "treated as empty");
  });

  test("typing in the field does not drive the tree, and Escape closes", () => {
    const w = render("onix-3.1-valid.xml");
    cog(w).focus();
    cog(w).click();
    const before = w.document.querySelectorAll("#oxv-root .px-folded").length;
    field(w).dispatchEvent(new w.KeyboardEvent("keydown", { key: "c", bubbles: true }));
    assert(w.document.querySelectorAll("#oxv-root .px-folded").length === before, "c did not collapse");
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert(modal(w).hidden, "closed");
    assert(w.document.activeElement === cog(w), "focus back on the cog");
  });

  test("the modal opens for non-ONIX XML too, but validates nothing", () => {
    const w = render("generic-note.xml");
    postedRules(w);
    cog(w).click();
    field(w).value = HOUSE_RULES;
    button(w, "px-rules-apply").click();
    assert(status(w).textContent.includes("applied"), "the rules install");
    assert(validationLabel(w).textContent === "", "no validation of a non-ONIX document");
  });
});

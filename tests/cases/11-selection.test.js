const {
  test, describe, assert, render,
} = require("../harness");

describe("Selection", () => {
  test("viewer decorations opt out of text selection so a drag-copy yields only XML", () => {
    const w = render("onix-3.0-reference.xml");
    const decorated = new Set();
    for (const sheet of w.document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (rule.style && rule.style.getPropertyValue("user-select") === "none") {
          rule.selectorText.split(",").forEach((s) => decorated.add(s.trim()));
        }
      }
    }
    for (const sel of [".px-codelist", ".px-codelist-link", ".px-summary", ".px-block-label",
                       ".px-fold-ellipsis", ".px-fold-close", ".px-node-menu-btn", ".px-toggle"]) {
      assert(decorated.has(sel), `${sel} should have user-select: none`);
    }
  });
});

const {
  test, describe, assert, render, $$,
} = require("../harness");

describe("Folding", () => {
  test("collapsible row produces a tagged close row", () => {
    const w = render("onix-3.0-reference.xml");
    const closeRows = $$(w, "#oxv-root .px-close-row");
    const collapsibleRows = $$(w, "#oxv-root .px-row.px-collapsible");
    assert(closeRows.length === collapsibleRows.length,
      `expected one close row per collapsible row (${collapsibleRows.length}); got ${closeRows.length}`);
  });

  test("folding hides the dedicated close row (only inline </Tag> remains)", () => {
    const w = render("onix-3.0-reference.xml");
    const openRow = $$(w, "#oxv-root .px-row.px-collapsible")[0];
    openRow.classList.add("px-folded");
    const closeRow = openRow.parentNode.querySelector(":scope > .px-close-row");
    assert(closeRow, "no close row found");
    const display = w.getComputedStyle(closeRow).display;
    assert(display === "none",
      `folded close row should be display:none, got "${display}"`);
  });
});

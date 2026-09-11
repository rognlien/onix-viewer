const fs = require("fs");
const path = require("path");
const {
  test, describe, assert, render, renderSource, $$, rowsNamed, FIXTURES, SAMPLES,
} = require("../harness");

describe("Stepped collapse and expand", () => {
  const collapse = (w) => w.document.querySelector('[data-action="collapse"]').click();
  const expand = (w) => w.document.querySelector('[data-action="expand"]').click();
  const foldedNames = (w) => rowsNamed(w, "Product").map((r) => r.classList.contains("px-folded"));

  test("step 1 folds each Product's contents and the header, leaving Products open", () => {
    const w = render("onix-3.0-reference.xml");
    const products = rowsNamed(w, "Product");
    assert(products.every((r) => !r.classList.contains("px-folded")), "products start expanded");
    collapse(w);
    assert(products.every((r) => !r.classList.contains("px-folded")),
      "step 1 leaves the Products open so their one-line children are visible");
    const blocks = [...rowsNamed(w, "DescriptiveDetail"), ...rowsNamed(w, "PublishingDetail")];
    assert(blocks.length >= 2, "expected block rows in the fixture");
    assert(blocks.every((r) => r.classList.contains("px-folded")), "block rows should be folded");
    assert(rowsNamed(w, "Header").every((r) => r.classList.contains("px-folded")),
      "the message Header folds with them");
  });

  test("step 1 folds the block-0 composites too, so a Product is one line per child", () => {
    const w = render("onix-3.0-reference.xml");
    collapse(w);
    const identifiers = rowsNamed(w, "ProductIdentifier");
    assert(identifiers.length >= 1, "expected ProductIdentifier rows in the fixture");
    assert(identifiers.every((r) => r.classList.contains("px-folded")),
      "ProductIdentifier sits directly in <Product> and should fold with the blocks");
    // Composites deeper than a Product's own children stay as they are —
    // they're hidden inside a folded block anyway.
    assert(rowsNamed(w, "TitleDetail").every((r) => !r.classList.contains("px-folded")),
      "TitleDetail is inside DescriptiveDetail and should be untouched");
  });

  test("step 2 folds the Products, step 3 the root", () => {
    const w = render("onix-3.0-reference.xml");
    collapse(w);
    assert(foldedNames(w).every((f) => !f), "after step 1 the Products are open");
    collapse(w);
    assert(foldedNames(w).every((f) => f), "step 2 folds the Products");
    const messageRow = rowsNamed(w, "ONIXMessage")[0];
    assert(!messageRow.classList.contains("px-folded"), "the root is still open");
    collapse(w);
    assert(messageRow.classList.contains("px-folded"), "step 3 folds the root");
    // Nothing left to do; pressing again must not undo any of it.
    collapse(w);
    assert(messageRow.classList.contains("px-folded") && foldedNames(w).every((f) => f),
      "a fourth press is a no-op, not a reversal");
  });

  test("the header folds in both dialects", () => {
    for (const [fixture, name] of [["onix-3.0-reference.xml", "Header"],
                                   ["onix-3.1-shorttags.xml", "header"]]) {
      const xml = fixture.startsWith("onix-3.1-short")
        ? fs.readFileSync(path.join(SAMPLES, fixture), "utf8")
        : fs.readFileSync(path.join(FIXTURES, fixture), "utf8");
      const w = renderSource(xml, fixture);
      const header = rowsNamed(w, name);
      assert(header.length === 1, `expected one <${name}> row in ${fixture}, got ${header.length}`);
      assert(!header[0].classList.contains("px-folded"), "it should start expanded");
      collapse(w);
      assert(header[0].classList.contains("px-folded"), `<${name}> should fold in ${fixture}`);
    }
  });

  test("works in short dialect and via the b shortcut", () => {
    const w = render("onix-3.0-short.xml");
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "b", bubbles: true }));
    const blocks = rowsNamed(w, "descriptivedetail");
    assert(blocks.length >= 1, "expected short-tag block rows");
    assert(blocks.every((r) => r.classList.contains("px-folded")), "short-tag block rows should be folded");
    const identifiers = rowsNamed(w, "productidentifier");
    assert(identifiers.length >= 1, "expected short-tag ProductIdentifier rows");
    assert(identifiers.every((r) => r.classList.contains("px-folded")),
      "short-tag block-0 composites should fold too");
  });

  test("non-ONIX XML zips up from the leaves, a level per press", () => {
    // A generic document has no ONIX shape to step through, so Collapse is the
    // mirror of Expand: the deepest visible level goes first.
    const w = render("rss.xml");
    const depthOf = (r) => Number(r.style.getPropertyValue("--depth"));
    const rows = $$(w, "#oxv-root .px-row.px-collapsible");
    const byDepth = (d) => rows.filter((r) => depthOf(r) === d);
    assert(byDepth(2).length >= 2 && byDepth(1).length === 1 && byDepth(0).length === 1,
      "the fixture should have three levels to fold");

    collapse(w);
    assert(byDepth(2).every((r) => r.classList.contains("px-folded")), "deepest level first");
    assert(!byDepth(1)[0].classList.contains("px-folded"), "and only that level");
    collapse(w);
    assert(byDepth(1)[0].classList.contains("px-folded"), "then the level above");
    collapse(w);
    assert(byDepth(0)[0].classList.contains("px-folded"), "then the root");
  });

  test("Expand reveals one more level per press, and stops when done", () => {
    const w = render("rss.xml");
    const depthOf = (r) => Number(r.style.getPropertyValue("--depth"));
    const rows = $$(w, "#oxv-root .px-row.px-collapsible");
    for (const r of rows) r.classList.add("px-folded");

    expand(w);
    assert(!rows.find((r) => depthOf(r) === 0).classList.contains("px-folded"),
      "the root opens first");
    assert(rows.filter((r) => depthOf(r) === 1).every((r) => r.classList.contains("px-folded")),
      "and only the root");
    expand(w);
    assert(rows.filter((r) => depthOf(r) === 1).every((r) => !r.classList.contains("px-folded")),
      "then the level below");
    expand(w);
    expand(w);
    assert(rows.every((r) => !r.classList.contains("px-folded")), "until everything is open");
    expand(w);
    assert(rows.every((r) => !r.classList.contains("px-folded")), "a further press is a no-op");
  });

  test("Expand undoes a stepped collapse, level by level", () => {
    const w = render("onix-3.0-reference.xml");
    collapse(w); collapse(w); collapse(w);
    const messageRow = rowsNamed(w, "ONIXMessage")[0];
    assert(messageRow.classList.contains("px-folded"), "fully collapsed");
    expand(w);
    assert(!messageRow.classList.contains("px-folded"), "the root reopens first");
    assert(foldedNames(w).every((f) => f), "the Products are still folded");
    expand(w);
    assert(foldedNames(w).every((f) => !f), "then the Products");
  });

  test("the control row is a flex row, so icons cannot shift a button off the line", () => {
    // An inline-flex button takes its baseline from its first flex item, so a
    // button carrying an icon aligned on the icon's bottom edge while a
    // text-only one aligned on its text — measured in Chrome, that put the
    // two 3.3px apart. Flex items are aligned by the container instead.
    const w = render("onix-3.0-reference.xml");
    const left = w.document.querySelector("#oxv-toolbar .px-left");
    assert(left, "the control group should exist");
    const style = w.getComputedStyle(left);
    assert(style.display === "flex", `expected a flex row, got "${style.display}"`);
    assert(style.alignItems === "center", `expected centred items, got "${style.alignItems}"`);
  });

  test("the toolbar carries the extension's mark, and drops it if blocked", () => {
    const w = render("onix-3.0-reference.xml");
    const logo = w.document.getElementById("oxv-logo");
    assert(logo, "the toolbar should carry the mark");
    assert(logo.getAttribute("alt") === "ONIX Viewer",
      "a mark with no text beside it needs an accessible name");
    assert(logo.getAttribute("width") === "28" && logo.getAttribute("height") === "28",
      "28px is the toolbar's content height — the largest that does not make it taller");
    assert(logo.closest(".px-left"), "it belongs with the controls, at the left");
    assert(logo === logo.parentElement.firstElementChild, "and leads them");

    // A page whose img-src CSP refuses chrome-extension:// URLs must not be
    // left with a broken-image glyph in the toolbar.
    logo.dispatchEvent(new w.Event("error"));
    assert(!w.document.getElementById("oxv-logo"), "a blocked mark should be removed");
  });

  test("the labelled toolbar buttons carry icons", () => {
    const w = render("onix-3.0-reference.xml");
    for (const action of ["expand", "collapse", "toggle-wrap", "copy-xml"]) {
      const button = w.document.querySelector(`[data-action="${action}"]`);
      const glyph = button.querySelector("svg");
      assert(glyph, `${action} should carry an icon`);
      assert(glyph.getAttribute("viewBox") === "0 0 16 16", "from the shared icon set");
      assert(glyph.classList.contains("px-icon"), "and be sized by the shared class");
    }
  });

  test("Copy XML keeps its icon through the Copied flash", () => {
    // flashButton used to write the button's textContent, which took the
    // prepended icon with it: after the first copy the button was text only.
    // The harness is synchronous, so take the execCommand path, which flashes
    // in the same tick; the verdict it flashes is beside the point.
    const w = render("onix-3.0-reference.xml");
    Object.defineProperty(w.navigator, "clipboard", { configurable: true, value: undefined });
    w.document.execCommand = () => true;
    const button = w.document.querySelector('[data-action="copy-xml"]');
    button.textContent = "Copy XML";
    button.prepend(w.document.querySelector('[data-action="expand"] svg').cloneNode(true));
    button.click();
    assert(button.querySelector("svg"), "the icon should survive the flash");
    assert(button.textContent === "Copied", `the label should flash, got: ${button.textContent}`);
  });
});

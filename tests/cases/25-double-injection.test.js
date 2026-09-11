const {
  test, describe, assert, render, $$, rowsNamed, viewerJs,
} = require("../harness");

describe("Double injection", () => {
  test("a second viewer.js instance leaves the rendered tree alone", () => {
    // Two enabled copies of the extension both inject the viewer bundle into
    // the surviving shell. Without a guard the tree is rendered twice and
    // every click handler is registered twice, which makes the fold chevrons
    // dead. The second instance must find #oxv-root already filled and stop.
    const w = render("onix-3.1-standalone-product.xml");
    const before = $$(w, "#oxv-root .px-row").length;
    w.eval(viewerJs);
    assert(before > 0, "first pass should have rendered rows");
    assert($$(w, "#oxv-root .px-row").length === before, "second pass must not add rows");
    assert(rowsNamed(w, "Product").length === 1, "the root <Product> must appear once");
  });
});

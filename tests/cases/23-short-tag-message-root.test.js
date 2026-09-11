const {
  test, describe, assert, render, $$, meta, badges,
} = require("../harness");

describe("Short-tag message root", () => {
  test("<ONIXmessage> is the short-tag root, so a namespaced short feed is detected", () => {
    const w = render("onix-3.0-short-codelists.xml");
    assert(meta(w).startsWith("ONIX 3.0 short tags (1 product)"), `got: ${meta(w)}`);
    assert($$(w, "#oxv-root .px-onix-short").length > 0, "short-tag rows should carry .px-onix-short");
  });

  test("a namespace-less <ONIXmessage> is read as short dialect at its release version", () => {
    const w = render("onix-short-no-namespace.xml");
    assert(meta(w).startsWith("ONIX 3.1 short tags (1 product)"),
      `release attribute should give the version; got: ${meta(w)}`);
    assert($$(w, "#oxv-root .px-onix-short").length > 0,
      "the root's spelling alone should select the short dialect");
    assert(badges(w).includes("→ ISBN-13"), "short-tag code lists should still resolve");
  });
});

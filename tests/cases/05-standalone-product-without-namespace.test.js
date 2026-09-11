const {
  test, describe, assert, render, $$, meta, badges,
} = require("../harness");

describe("Standalone Product without namespace", () => {
  test("detects a bare <Product> root as ONIX (no envelope, no namespace)", () => {
    const w = render("onix-standalone-product-no-namespace.xml");
    // Version is unknown without a namespace, so the label omits it.
    assert(/^ONIX \(1 product\)/.test(meta(w)), `bad meta: ${meta(w)}`);
  });

  test("resolves codelists on the un-namespaced Product (ProductForm BB → Hardback)", () => {
    const w = render("onix-standalone-product-no-namespace.xml");
    assert(badges(w).some((b) => b.includes("Hardback")), "ProductForm not resolved");
    assert(badges(w).some((b) => b.includes("ISBN-13")), "ProductIDType not resolved");
  });

  test("classifies tags with px-onix-ref (reference dialect inferred)", () => {
    const w = render("onix-standalone-product-no-namespace.xml");
    const refs = $$(w, "#oxv-root .px-tag.px-onix-ref");
    assert(refs.length > 5, `expected ONIX-ref tags, got ${refs.length}`);
  });

  test("a non-ONIX <Product> root is NOT misdetected as ONIX", () => {
    const w = render("non-onix-product.xml");
    assert(!meta(w).startsWith("ONIX"), `non-ONIX Product misdetected: ${meta(w)}`);
  });
});

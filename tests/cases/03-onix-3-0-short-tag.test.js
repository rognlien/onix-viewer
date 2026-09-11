const {
  test, describe, assert, render, $$, meta, badges,
} = require("../harness");

describe("ONIX 3.0 short-tag", () => {
  test("detects dialect", () => {
    const w = render("onix-3.0-short.xml");
    assert(/^ONIX 3\.0 short tags \(\d+ products?\)/.test(meta(w)), `bad meta: ${meta(w)}`);
  });

  test("classifies tag spans with px-onix-short", () => {
    const w = render("onix-3.0-short.xml");
    const shorts = $$(w, "#oxv-root .px-tag.px-onix-short");
    assert(shorts.length > 5, `expected ONIX-short tags, got ${shorts.length}`);
  });

  test("resolves codelists via short-to-reference mapping (b221=15 → ISBN-13)", () => {
    const w = render("onix-3.0-short.xml");
    assert(badges(w).some((b) => b.includes("ISBN-13")), "ISBN-13 not resolved through short tag");
  });
});

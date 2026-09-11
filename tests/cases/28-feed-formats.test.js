const {
  test, describe, assert, render, $$, meta,
} = require("../harness");

describe("Feed formats", () => {
  test("RSS feed renders without ONIX detection", () => {
    const w = render("rss.xml");
    assert(!meta(w).startsWith("ONIX"), "RSS misdetected as ONIX");
    const rows = $$(w, "#oxv-root .px-row");
    assert(rows.length >= 5, "expected RSS items rendered");
  });
});

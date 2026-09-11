const {
  test, describe, assert, render, $$, meta,
} = require("../harness");

describe("Generic XML", () => {
  test("renders w3schools note.xml-like document", () => {
    const w = render("generic-note.xml");
    const rows = $$(w, "#oxv-root .px-row");
    assert(rows.length >= 5, `expected ≥5 rows, got ${rows.length}`);
    assert(meta(w).includes("KB"), "meta should include size");
    assert(!meta(w).startsWith("ONIX"), "should not be detected as ONIX");
  });

  test("preserves XML declaration as a PI row", () => {
    const w = render("generic-note.xml");
    const piRows = $$(w, "#oxv-root .px-pi");
    assert(piRows.some((p) => p.textContent.startsWith("<?xml")), "missing <?xml declaration");
  });

  test("renders a DOCTYPE with its SYSTEM keyword", () => {
    // Every ONIX 2.1 file references its DTD this way, and the row used to
    // drop the keyword: <!DOCTYPE ONIXMessage "http://…dtd">.
    const w = render("onix-2.1-doctype.xml");
    const doctype = $$(w, "#oxv-root .px-pi").map((p) => p.textContent).find((t) => t.startsWith("<!DOCTYPE"));
    assert(doctype === '<!DOCTYPE ONIXMessage SYSTEM "http://www.editeur.org/onix/2.1/reference/onix-international.dtd">',
      `got: ${doctype}`);
  });

  test("renders comments distinctly", () => {
    const w = render("with-comments.xml");
    const comments = $$(w, "#oxv-root .px-comment");
    assert(comments.length >= 1, "expected at least one comment");
    assert(comments[0].textContent.includes("<!--"), "comment should include marker");
  });

  test("renders CDATA sections distinctly", () => {
    const w = render("with-cdata.xml");
    const markers = $$(w, "#oxv-root .px-cdata-marker");
    assert(markers.length >= 2, "expected opening + closing CDATA markers");
  });

  test("malformed XML produces an error UI, not a crash", () => {
    const w = render("malformed.xml");
    const err = w.document.querySelector(".px-error");
    assert(err, "should render error block");
    assert(meta(w) === "parse error", "meta should say parse error");
  });
});

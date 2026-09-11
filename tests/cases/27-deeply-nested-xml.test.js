const {
  test, describe, assert, renderSource, $$, meta,
} = require("../harness");

describe("Deeply nested XML", () => {
  test("a document nested past the old stack limit renders completely", () => {
    const depth = 2000;
    const w = renderSource('<?xml version="1.0"?>' +
      '<ONIXMessage xmlns="http://ns.editeur.org/onix/3.1/reference" release="3.1">' +
      "<a>".repeat(depth) + "</a>".repeat(depth) + "</ONIXMessage>", "deep.xml");

    // One open and one close row per level, plus the message element's pair
    // and the XML declaration.
    const rows = $$(w, "#oxv-root .px-row").length;
    assert(rows === 2 * (depth + 1), `expected ${2 * (depth + 1)} rows, got ${rows}`);
    assert(!$$(w, "#oxv-root .px-error").length, "no parse-error panel");

    // The things a mid-render throw used to skip.
    assert(meta(w).includes("KB"), `the meta pill should be filled in, got "${meta(w)}"`);
    assert(w.document.getElementById("oxv-validation").textContent,
      "validation should have run");
  });
});

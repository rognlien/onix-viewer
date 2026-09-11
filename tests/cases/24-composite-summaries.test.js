const {
  test, describe, assert, render, summariesOf,
} = require("../harness");

describe("Composite summaries", () => {
  test("an identifier composite reads as its resolved type plus value", () => {
    const w = render("onix-3.0-gtin-only.xml");
    const summaries = summariesOf(w, "ProductIdentifier");
    assert(summaries.length === 2, `expected a chip per ProductIdentifier, got ${summaries.length}`);
    assert(summaries[1] === "GTIN-13 9780000000002",
      `expected the List 5 label and the IDValue, got: ${summaries[1]}`);
    assert(summaries[0] === "Proprietary product ID scheme internal-1234",
      `expected the list label when no IDTypeName is given, got: ${summaries[0]}`);
  });

  test("the identifier rule is shape-based, so it covers other *IDType composites", () => {
    const w = render("onix-3.0-single-product-blocks.xml");
    const summaries = summariesOf(w, "RecordSourceIdentifier");
    assert(summaries.length === 1, "expected a RecordSourceIdentifier chip");
    assert(summaries[0] === "Bokbasen 14349",
      `RecordSourceIdentifier should summarise with no rule of its own, got: ${summaries[0]}`);
  });

  test("a proprietary scheme names itself via IDTypeName", () => {
    const w = render("onix-3.0-proprietary-only.xml");
    const summaries = summariesOf(w, "ProductIdentifier");
    assert(summaries[0] === "internal internal-XYZ",
      `expected IDTypeName in place of the "Proprietary" label, got: ${summaries[0]}`);
  });

  test("contributor reads as role plus name; price as amount plus currency", () => {
    const w = render("onix-3.0-reference.xml");
    assert(summariesOf(w, "Contributor")[0] === "By (author) Ola Nordmann",
      `got: ${summariesOf(w, "Contributor")[0]}`);
    const priced = render("onix-3.0-single-product-blocks.xml");
    assert(summariesOf(priced, "Price")[0] === "399.00 NOK",
      `got: ${summariesOf(priced, "Price")[0]}`);
  });

  test("title composites read as the quoted title", () => {
    const w = render("onix-3.0-multi-title.xml");
    assert(summariesOf(w, "TitleDetail")[0] === '"Fra en dag til en annen"',
      `got: ${summariesOf(w, "TitleDetail")[0]}`);
  });

  test("the seven blocks deliberately carry no chip", () => {
    const w = render("onix-3.0-single-product-blocks.xml");
    for (const block of ["DescriptiveDetail", "PublishingDetail", "ProductSupply"]) {
      assert(summariesOf(w, block).length === 0, `${block} should have no summary chip`);
    }
  });

  test("works in short dialect", () => {
    const w = render("onix-3.0-short.xml");
    assert(summariesOf(w, "productidentifier")[0] === "ISBN-13 9788234567896",
      `got: ${summariesOf(w, "productidentifier")[0]}`);
    assert(summariesOf(w, "contributor")[0] === "By (author) Kari Nordmann",
      `got: ${summariesOf(w, "contributor")[0]}`);
    // Dispatch is on the lower-cased name, so <price> works too.
    const priced = render("onix-3.0-short-codelists.xml");
    assert(summariesOf(priced, "price")[0] === "399.00 NOK",
      `got: ${summariesOf(priced, "price")[0]}`);
  });

  test("a long title is clamped so the chip cannot wrap", () => {
    const w = render("onix-3.0-multi-title.xml");
    for (const chip of summariesOf(w, "TitleDetail")) {
      assert(chip.length <= 62, `chip should stay within the cap, got ${chip.length}: ${chip}`);
    }
  });
});

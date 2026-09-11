const path = require("path");
const {
  test, describe, assert, render, findingsFor, codes, withDescriptiveDetail, FIXTURES,
} = require("../harness");

describe("Datatype lexical space", () => {
  const fsd = require("fs");
  function messagesFor(window, xml, prefix) {
    return findingsFor(window, xml).findings
      .filter((f) => f.code.startsWith(prefix))
      .map((f) => window.OnixViewerValidation.message(f));
  }

  test("every datatype the schema names is compiled", () => {
    const w = render("onix-3.1-valid.xml");
    const datatypes = w.OnixViewerContentModels["3.1"].datatypes;
    // Four of these carry no facets at all — only a base type — and were
    // therefore unchecked until the base was recorded.
    for (const name of ["Decimal", "Integer", "PositiveInteger", "PositiveIntegerOrZero"]) {
      assert(datatypes[name] && datatypes[name].base,
        `${name} needs its base type recorded, got ${JSON.stringify(datatypes[name])}`);
    }
    assert(Object.keys(datatypes).length === 19,
      `expected all 19 dt.* types, got ${Object.keys(datatypes).length}`);
  });

  test("a value outside its base type's lexical space is reported", () => {
    const w = render("onix-3.1-valid.xml");
    const edition = (value) => "<EditionNumber>" + value + "</EditionNumber>";
    assert(messagesFor(w, withDescriptiveDetail(edition("2")), "datatype.").length === 0,
      "2 is a positive integer");
    for (const [value, why] of [["abc", "not numeric"], ["2.5", "not an integer"],
                                ["0", "not positive"], ["-1", "negative"]]) {
      const found = messagesFor(w, withDescriptiveDetail(edition(value)), "datatype.lexical");
      assert(found.length === 1 && found[0] === `"${value}" is not a positive integer`,
        `${value} (${why}) should be reported; got: ${found.join("; ")}`);
    }
  });

  test("a decimal-based type rejects non-numbers", () => {
    const w = render("onix-3.1-valid.xml");
    const extent = (value) => "<Extent><ExtentType>00</ExtentType><ExtentValue>" + value +
      "</ExtentValue><ExtentUnit>03</ExtentUnit></Extent>";
    assert(messagesFor(w, withDescriptiveDetail(extent("12.5")), "datatype.").length === 0,
      "12.5 is a decimal");
    const found = messagesFor(w, withDescriptiveDetail(extent("abc")), "datatype.lexical");
    assert(found.length === 1 && found[0] === '"abc" is not a decimal number', `got: ${found.join("; ")}`);
  });

  test("space-separated code lists have their members checked", () => {
    const w = render("onix-3.1-valid.xml");
    const territory = (codes) => {
      const valid = fsd.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
      return valid.replace("</PublishingDetail>",
        "<SalesRights><SalesRightsType>01</SalesRightsType><Territory><CountriesIncluded>" +
        codes + "</CountriesIncluded></Territory></SalesRights></PublishingDetail>");
    };
    assert(messagesFor(w, territory("NO SE DK"), "datatype.").length === 0,
      "three real country codes should pass");
    const bad = messagesFor(w, territory("NO XX DK"), "datatype.list-member");
    assert(bad.length === 1 && bad[0] === '"XX" is not in List 91 (Country – based on ISO 3166-1)',
      `got: ${bad.join("; ")}`);
  });
});

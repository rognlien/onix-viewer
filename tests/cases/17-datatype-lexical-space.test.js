const path = require("path");
const {
  test, describe, assert, render, findingsCoded, described, withDescriptiveDetail, FIXTURES,
} = require("../harness");

describe("Datatype lexical space", () => {
  const fsd = require("fs");
  const lexical = (list) => list.map((f) => `${f.data.value} is not ${f.data.base}`);

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
    assert(findingsCoded(w, withDescriptiveDetail(edition("2")), "datatype.").length === 0,
      "2 is a positive integer");
    for (const [value, why] of [["abc", "not numeric"], ["2.5", "not an integer"],
                                ["0", "not positive"], ["-1", "negative"]]) {
      const found = findingsCoded(w, withDescriptiveDetail(edition(value)), "datatype.lexical");
      assert(lexical(found).join() === `${value} is not positive integer`,
        `${value} (${why}) should be reported; got: ${described(w, found)}`);
    }
  });

  test("a decimal-based type rejects non-numbers", () => {
    const w = render("onix-3.1-valid.xml");
    const extent = (value) => "<Extent><ExtentType>00</ExtentType><ExtentValue>" + value +
      "</ExtentValue><ExtentUnit>03</ExtentUnit></Extent>";
    assert(findingsCoded(w, withDescriptiveDetail(extent("12.5")), "datatype.").length === 0,
      "12.5 is a decimal");
    const found = findingsCoded(w, withDescriptiveDetail(extent("abc")), "datatype.lexical");
    assert(lexical(found).join() === "abc is not decimal number", `got: ${described(w, found)}`);
  });

  test("space-separated code lists have their members checked", () => {
    const w = render("onix-3.1-valid.xml");
    const territory = (codes) => {
      const valid = fsd.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
      return valid.replace("</PublishingDetail>",
        "<SalesRights><SalesRightsType>01</SalesRightsType><Territory><CountriesIncluded>" +
        codes + "</CountriesIncluded></Territory></SalesRights></PublishingDetail>");
    };
    assert(findingsCoded(w, territory("NO SE DK"), "datatype.").length === 0,
      "three real country codes should pass");
    const bad = findingsCoded(w, territory("NO XX DK"), "datatype.list-member");
    assert(bad.length === 1 && bad[0].data.member === "XX" && bad[0].data.list === 91,
      `the member and its list should be named; got: ${described(w, bad)}`);
    assert(bad[0].data.title === "Country – based on ISO 3166-1",
      `List 91 is bound to no element, so its title comes by number; got: ${bad[0].data.title}`);
  });
});

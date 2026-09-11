const {
  test, describe, assert, render, findingsCoded, described,
} = require("../harness");

describe("Deprecated elements", () => {
  function deprecations(window, xml) {
    return findingsCoded(window, xml, "element.deprecated");
  }

  test("a deprecated element is reported as a warning, naming the replacement", () => {
    const w = render("onix-3.1-standalone-product.xml");
    const found = deprecations(w, w.__OXV_SOURCE__);
    assert(found.length === 1, `expected one deprecation, got: ${described(w, found)}`);
    assert(found[0].data.name === "TitleText" && found[0].severity === "warning",
      "deprecation is valid ONIX, so a warning about <TitleText>");
    // The one place the wording is pinned: {since} and {advice} each carry
    // their own connective, and this is what proves they compose.
    const message = w.OnixViewerValidation.message(found[0]);
    assert(message === "<TitleText> is deprecated from release 3.1 — use either " +
      "<TitlePrefix> or <NoPrefix/>, plus <TitleWithoutPrefix> instead", `got: ${message}`);
  });

  test("a note about an element's children does not deprecate the element", () => {
    // <Header> and <TitleElement> both carry a "Deprecated <Child>" note, and
    // both appear in nearly every ONIX file — flagging them would bury a valid
    // document in false warnings. <SalesRestriction>'s note names P.21 clauses.
    const w = render("onix-3.1-valid.xml");
    for (const version of ["3.1", "3.0"]) {
      const deprecated = w.OnixViewerContentModels[version].deprecated;
      for (const name of ["Header", "TitleElement", "SalesRestriction"]) {
        assert(!deprecated[name], `${version}: <${name}> must not be marked deprecated`);
      }
    }
    // And the fixture using both of them reports nothing.
    assert(deprecations(w, w.__OXV_SOURCE__).length === 0,
      `a valid 3.1 document should carry no deprecation: ${described(w, deprecations(w, w.__OXV_SOURCE__))}`);
  });

  test("a deprecation limited to one parent fires only there", () => {
    // <TextSourceDescription> is deprecated within <TextContent>, but not
    // within <TextSource>, so the parent decides.
    const w = render("onix-3.1-valid.xml");
    const within = w.OnixViewerContentModels["3.1"].deprecated.TextSourceDescription;
    assert(within && within.within === "TextContent",
      `expected the context to be recorded, got ${JSON.stringify(within)}`);
  });

  test("ONIX 3.0's deprecated elements are covered too", () => {
    const w = render("onix-3.0-reference.xml");
    const deprecated = w.OnixViewerContentModels["3.0"].deprecated;
    for (const name of ["AudienceCode", "Conference", "ConferenceName", "CurrencyZone",
                        "Reissue", "DateFormat"]) {
      assert(deprecated[name], `<${name}> should be marked deprecated in 3.0`);
    }
    // 3.1 dropped these entirely, so they are unknown there rather than deprecated.
    assert(!w.OnixViewerContentModels["3.1"].elements.ConferenceName,
      "<ConferenceName> should not exist in the 3.1 model at all");
  });
});

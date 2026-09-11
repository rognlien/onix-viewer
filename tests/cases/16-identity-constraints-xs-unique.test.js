const path = require("path");
const {
  test, describe, assert, render, findingsFor, withDescriptiveDetail, FIXTURES, SAMPLES,
} = require("../harness");

describe("Identity constraints (xs:unique)", () => {
  const fsu = require("fs");
  function duplicates(window, xml) {
    return findingsFor(window, xml).findings
      .filter((f) => f.code === "unique.duplicate")
      .map((f) => window.OnixViewerValidation.message(f));
  }
  // The valid fixture with extra children spliced into <DescriptiveDetail>,
  // after <ProductForm> where the schema's sequence expects them.

  test("the schema's constraints are compiled, all of them", () => {
    const w = render("onix-3.1-valid.xml");
    const count = (version) => Object.values(w.OnixViewerContentModels[version].elements)
      .reduce((total, shape) => total + (shape.u ? shape.u.length : 0), 0);
    // Counted straight out of the XSDs: 142 <xs:unique> in 3.1, 85 in 3.0.
    assert(count("3.1") === 142, `expected 142 constraints in 3.1, got ${count("3.1")}`);
    assert(count("3.0") === 85, `expected 85 in 3.0, got ${count("3.0")}`);
  });

  test("two <Product> with the same RecordReference are reported", () => {
    const w = render("onix-3.1-valid.xml");
    const valid = fsu.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
    const product = valid.match(/<Product>[\s\S]*<\/Product>/)[0];
    const twice = valid.replace(product, product + "\n" + product);
    const found = duplicates(w, twice);
    assert(found.length === 1 &&
      found[0] === "<ONIXMessage> repeats <Product> with the same RecordReference",
      `got: ${found.join("; ")}`);
    // Distinct references are fine.
    const distinct = valid.replace(product,
      product + "\n" + product.replace("<RecordReference>valid-9788234567896</RecordReference>",
        "<RecordReference>valid-other</RecordReference>"));
    assert(duplicates(w, distinct).length === 0,
      `distinct references should pass; got: ${duplicates(w, distinct).join("; ")}`);
  });

  test("a two-field key needs both parts to match", () => {
    const w = render("onix-3.1-valid.xml");
    const measure = (type, unit) => "<Measure><MeasureType>" + type +
      "</MeasureType><Measurement>10</Measurement><MeasureUnitCode>" + unit +
      "</MeasureUnitCode></Measure>";
    const clash = duplicates(w, withDescriptiveDetail(measure("01", "mm") + measure("01", "mm")));
    assert(clash.length === 1 &&
      clash[0] === "<DescriptiveDetail> repeats <Measure> with the same MeasureType and MeasureUnitCode",
      `got: ${clash.join("; ")}`);
    // Differing in either field is legal.
    assert(duplicates(w, withDescriptiveDetail(measure("01", "mm") + measure("01", "cm"))).length === 0,
      "a different unit is a different key");
    assert(duplicates(w, withDescriptiveDetail(measure("01", "mm") + measure("02", "mm"))).length === 0,
      "a different type is a different key");
  });

  test("an incomplete key falls outside the constraint", () => {
    // XSD semantics: xs:unique only compares nodes whose *every* field is
    // present. <Text>'s key is (@language, @textscript) — both — which is the
    // Specification's multilingual rule. So two <Text language="eng"> with no
    // textscript have an incomplete key and are legal; add the same textscript
    // to both and they clash.
    const w = render("onix-3.1-valid.xml");
    const collateral = (inner) => {
      const valid = fsu.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
      return valid.replace("</DescriptiveDetail>",
        "</DescriptiveDetail>\n    <CollateralDetail><TextContent>" +
        "<TextType>03</TextType><ContentAudience>00</ContentAudience>" +
        inner + "</TextContent></CollateralDetail>");
    };

    const languageOnly = collateral('<Text language="eng">A</Text><Text language="eng">B</Text>');
    assert(duplicates(w, languageOnly).length === 0,
      `language alone is an incomplete key; got: ${duplicates(w, languageOnly).join("; ")}`);

    const both = collateral('<Text language="eng" textscript="Latn">A</Text>' +
      '<Text language="eng" textscript="Latn">B</Text>');
    const clash = duplicates(w, both);
    assert(clash.length === 1 &&
      clash[0] === "<TextContent> repeats <Text> with the same language and textscript",
      `got: ${clash.join("; ")}`);

    const differing = collateral('<Text language="eng" textscript="Latn">A</Text>' +
      '<Text language="nob" textscript="Latn">B</Text>');
    assert(duplicates(w, differing).length === 0,
      `distinct languages should pass; got: ${duplicates(w, differing).join("; ")}`);
  });

  test("a single-attribute key clashes on that attribute alone", () => {
    const w = render("onix-3.1-valid.xml");
    const collateral = (inner) => {
      const valid = fsu.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
      return valid.replace("</DescriptiveDetail>",
        "</DescriptiveDetail>\n    <CollateralDetail><TextContent>" +
        "<TextType>03</TextType><ContentAudience>00</ContentAudience><Text>T</Text>" +
        inner + "</TextContent></CollateralDetail>");
    };
    // <SourceTitle>'s key is @language on its own.
    const clash = duplicates(w, collateral('<SourceTitle language="eng">A</SourceTitle>' +
      '<SourceTitle language="eng">B</SourceTitle>'));
    assert(clash.some((f) => f === "<TextContent> repeats <SourceTitle> with the same language"),
      `got: ${clash.join("; ")}`);
    assert(duplicates(w, collateral('<SourceTitle language="eng">A</SourceTitle>' +
      '<SourceTitle language="nob">B</SourceTitle>')).length === 0, "distinct languages pass");
  });

  test("a self-valued key compares the element's own text", () => {
    const w = render("onix-3.1-valid.xml");
    const detail = "<ProductFormDetail>B206</ProductFormDetail>";
    const found = duplicates(w, withDescriptiveDetail(detail + detail));
    assert(found.length === 1 && found[0].includes("with the same value"), `got: ${found.join("; ")}`);
    assert(duplicates(w, withDescriptiveDetail(detail +
      "<ProductFormDetail>B221</ProductFormDetail>")).length === 0, "distinct values pass");
  });

  test("no fixture or EDItEUR sample gains a duplicate finding", () => {
    // The constraints must not fire on conformant documents — this is the check
    // that would have caught a mis-compiled selector.
    const w = render("onix-3.1-valid.xml");
    const wrong = [];
    const dir = FIXTURES;
    const samples = fsu.readdirSync(dir).filter((f) => f.startsWith("onix-"))
      .map((f) => path.join(dir, f))
      .concat(["onix-3.1-refnames.xml", "onix-3.1-shorttags.xml"]
        .map((f) => path.join(SAMPLES, f)));
    for (const file of samples) {
      const found = duplicates(w, fsu.readFileSync(file, "utf8"));
      if (found.length) wrong.push(`${path.basename(file)}: ${found.join(", ")}`);
    }
    assert(wrong.length === 0, wrong.join("; "));
  });
});

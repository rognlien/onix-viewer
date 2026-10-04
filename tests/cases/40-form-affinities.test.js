const fs = require("fs");
const path = require("path");
const {
  test, describe, assert, renderSource, findingsCoded, described, shortTwin, withDescriptiveDetail, FIXTURES,
} = require("../harness");

describe("Form/detail affinities", () => {
  // A <ProductFormDetail> code tied by the strict schema to certain forms is
  // reported on any other: B115 (Kartonnage) only on a hardback.
  const valid = fs.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
  const window = renderSource(valid, "probe.xml");

  function withForm(form, ...details) {
    return valid.replace("<ProductForm>BC</ProductForm>",
      `<ProductForm>${form}</ProductForm>` + details.map((d) => `<ProductFormDetail>${d}</ProductFormDetail>`).join(""));
  }

  function affinityFindings(xml) {
    return findingsCoded(window, xml, "form.detail");
  }

  test("a detail on a form it does not belong to is an error, worded with both labels", () => {
    const found = affinityFindings(withForm("BC", "B115"));
    assert(found.length === 1, described(window, found));
    const [finding] = found;
    assert(window.OnixViewerValidation.severity(finding) === "error", finding.code);
    const text = window.OnixViewerValidation.message(finding);
    assert(text === "\"B115\" (Kartonnage (Sweden)) can only be used with <ProductForm> BB, not BC (Paperback / softback)", text);
  });

  test("a detail on a form it belongs to is not reported", () => {
    const found = affinityFindings(withForm("BC", "B101", "B133"));
    assert(found.length === 0, described(window, found));
  });

  test("a dot in the schema's pattern stands for any form in the family", () => {
    assert(affinityFindings(withForm("DA", "D201")).length === 0, "D201 on DA");
    assert(affinityFindings(withForm("EA", "A103")).length === 0, "MP3 on EA: the strict schema allows E.");
    const found = affinityFindings(withForm("EA", "A101"));
    assert(found.length === 1 && found[0].data.allowed === "AA, AC", described(window, found));
    const families = affinityFindings(withForm("BB", "A103"));
    assert(families.length === 1 && families[0].data.allowed.endsWith("D*, E*"), described(window, families));
  });

  test("each bad detail is reported on its own row", () => {
    const found = affinityFindings(withForm("EA", "B115", "E101", "B301"));
    assert(found.map((f) => f.data.value).join(" ") === "B115 B301", described(window, found));
    assert(found.every((f) => f.node.textContent === f.data.value), "pinned to the detail");
  });

  test("a detail the schema ties to no form is never judged", () => {
    assert(affinityFindings(withForm("BC", "E101", "B501")).length === 0, "free details");
  });

  test("the short-tag dialect gives the same finding, in its own names", () => {
    const found = affinityFindings(shortTwin(window, withForm("BC", "B115")));
    assert(found.length === 1 && found[0].data.form === "b012", described(window, found));
  });

  test("<ProductPart> is judged too, and <RelatedProduct> is not", () => {
    const part = "<ProductPart><ProductForm>BC</ProductForm><ProductFormDetail>B115</ProductFormDetail>" +
      "<NumberOfCopies>1</NumberOfCopies></ProductPart>";
    const inPart = affinityFindings(withDescriptiveDetail(part));
    assert(inPart.length === 1, described(window, inPart));
    const related = valid.replace("</Product>",
      "<RelatedMaterial><RelatedProduct><ProductRelationCode>06</ProductRelationCode>" +
      "<ProductIdentifier><ProductIDType>01</ProductIDType><IDValue>X</IDValue></ProductIdentifier>" +
      "<ProductForm>BC</ProductForm><ProductFormDetail>B115</ProductFormDetail>" +
      "</RelatedProduct></RelatedMaterial></Product>");
    assert(affinityFindings(related).length === 0, "RelatedProduct");
  });

  test("the generated table holds every detail in List 175 and names only known forms", () => {
    const { hosts, forms } = window.OnixViewerFormAffinities;
    assert(hosts.join(" ") === "DescriptiveDetail ProductPart", hosts.join(" "));
    const details = window.OnixViewerCodeListsByNumber[175];
    const families = new Set([...window.OnixViewerCodeListsByNumber[150].keys()].map((code) => code[0]));
    for (const [detail, patterns] of Object.entries(forms)) {
      assert(details.has(detail), `${detail} is in List 175`);
      for (const pattern of patterns) {
        const known = pattern.endsWith(".") ? families.has(pattern[0])
          : window.OnixViewerCodeListsByNumber[150].has(pattern);
        assert(known, `${detail}: ${pattern} is a List 150 form`);
      }
    }
    assert(Object.keys(forms).length === 98, `${Object.keys(forms).length} details`);
  });
});

// Custom rules: a Schematron rule set, evaluated with the browser's XPath.
const fs = require("fs");
const path = require("path");
const {
  test, describe, assert, render, renderSource, rowsNamed, findingsFor,
  findingsCoded, described, validationLabel, shortTwin, FIXTURES, SAMPLES,
} = require("../harness");

const HOUSE_RULES = fs.readFileSync(path.join(FIXTURES, "house-rules.sch"), "utf8");
const VALID = fs.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
const SAMPLE = fs.readFileSync(path.join(SAMPLES, "onix-3.1-refnames.xml"), "utf8");

const schema = (body) =>
  `<schema xmlns="http://purl.oclc.org/dsdl/schematron">${body}</schema>`;
const pattern = (body) => schema(`<pattern>${body}</pattern>`);

// A window with a rule set installed, and the custom findings it produces.
function installed(text) {
  const w = render("onix-3.1-valid.xml");
  const result = w.OnixViewerSchematron.install(text);
  return { w, result };
}
function custom(w, xml) {
  return findingsCoded(w, xml, "schematron.");
}
function messages(w, list) {
  return list.map((f) => w.OnixViewerValidation.message(f));
}
// The rules block content.js will one day write, placed the way it would be.
function withRulesBlock(text) {
  return (w) => {
    const holder = w.document.createElement("script");
    holder.setAttribute("type", "application/xml");
    holder.id = "__oxv-rules__";
    holder.textContent = text;
    w.document.body.appendChild(holder);
  };
}

describe("Custom Schematron rules", () => {
  test("a rule set installs and reports what it holds", () => {
    const { result } = installed(HOUSE_RULES);
    assert(result.patterns === 3, `three patterns, got ${result.patterns}`);
    assert(result.assertions === 5, `five assertions, got ${result.assertions}`);
    assert(result.problems.length === 0, `no problems, got: ${result.problems.join("; ")}`);
  });

  test("the valid fixture satisfies the house rules", () => {
    const { w } = installed(HOUSE_RULES);
    const found = custom(w, VALID);
    assert(found.length === 0, `expected nothing, got ${described(w, found)}`);
  });

  test("an assert fires when its test fails, with the value-of filled in", () => {
    const { w } = installed(HOUSE_RULES);
    const foreign = VALID.replace("<IDValue>9788234567896</IDValue>", "<IDValue>9780306406157</IDValue>");
    const found = custom(w, foreign);
    assert(found.length === 1, `one finding, got ${described(w, found)}`);
    const [finding] = found;
    assert(finding.code === "schematron.isbn-prefix", `the assert's id is the code, got ${finding.code}`);
    assert(finding.severity === "warning", "role=\"warning\" sets the severity");
    assert(messages(w, found)[0] === "ISBN 9780306406157 is outside the 978-82 prefix",
      `the message with the value in it; got: ${messages(w, found)[0]}`);
    assert(finding.node.nodeName === "ProductIdentifier",
      `pinned to the context element, got <${finding.node.nodeName}>`);
  });

  test("a report fires when its test holds", () => {
    const { w } = installed(HOUSE_RULES);
    const skipped = VALID.replace("<SequenceNumber>1</SequenceNumber>", "<SequenceNumber>2</SequenceNumber>");
    const found = custom(w, skipped);
    assert(found.length === 1 && found[0].code === "schematron.sequence-gap",
      `the report, got ${described(w, found)}`);
    assert(found[0].severity === "error", "no role means an error");
    assert(messages(w, found)[0] === "Contributor 2 is out of sequence: expected 1",
      `a count() in a value-of; got: ${messages(w, found)[0]}`);
  });

  test("<name/> names the element the way the file spells it", () => {
    const { w } = installed(HOUSE_RULES);
    const nameless = VALID.replace("<SequenceNumber>1</SequenceNumber>", "");
    const reference = custom(w, nameless);
    assert(messages(w, reference)[0] === "Contributor in DescriptiveDetail has no SequenceNumber",
      `got: ${messages(w, reference)[0]}`);
    const short = custom(w, shortTwin(w, nameless));
    assert(messages(w, short)[0] === "contributor in DescriptiveDetail has no SequenceNumber",
      `the bare <name/> follows the file, a path names the reference form; got: ${messages(w, short)[0]}`);
  });

  test("one rule set serves both dialects, with the same findings", () => {
    const { w } = installed(HOUSE_RULES);
    const reference = custom(w, SAMPLE);
    const short = custom(w, shortTwin(w, SAMPLE));
    assert(reference.length > 0, "the EDItEUR sample trips at least one house rule");
    const key = (list) => list.map((f) => f.code).join(",");
    assert(key(reference) === key(short),
      `reference: ${described(w, reference)}\nshort: ${described(w, short)}`);
    const shortNode = short[0].node;
    assert(shortNode.nodeName === shortNode.nodeName.toLowerCase(),
      `pinned to the short-tag element itself, got <${shortNode.nodeName}>`);
  });

  test("sum() adds up a composite's amounts", () => {
    const { w } = installed(HOUSE_RULES);
    const priced = (amount) => VALID.replace("</PublishingDetail>", `</PublishingDetail>
    <ProductSupply><SupplyDetail><Supplier><SupplierRole>01</SupplierRole></Supplier>
      <ProductAvailability>20</ProductAvailability>
      <Price><PriceType>02</PriceType><PriceAmount>${amount}</PriceAmount>
        <Tax><TaxType>01</TaxType><TaxRateCode>S</TaxRateCode><TaxableAmount>80</TaxableAmount><TaxAmount>20</TaxAmount></Tax>
      </Price></SupplyDetail></ProductSupply>`);
    assert(custom(w, priced("100")).length === 0, "80 + 20 is 100");
    const wrong = custom(w, priced("99"));
    assert(wrong.length === 1 && wrong[0].code === "schematron.tax-arithmetic",
      `99 is not; got ${described(w, wrong)}`);
  });

  test("within a pattern the first rule whose context matches owns the node", () => {
    const { w } = installed(pattern(`
      <rule context="ProductIdentifier"><report id="first" test="true()">first</report></rule>
      <rule context="ProductIdentifier[ProductIDType = '15']"><report id="second" test="true()">second</report></rule>`));
    const codes = custom(w, VALID).map((f) => f.code);
    assert(codes.join() === "schematron.first", `only the first rule fires, got ${codes.join()}`);
  });

  test("a context may be a union, an absolute path, or an attribute", () => {
    const { w } = installed(schema(`
      <pattern><rule context="RecordReference | IDValue"><report id="union" test="true()">u</report></rule></pattern>
      <pattern><rule context="/ONIXMessage/Header"><report id="absolute" test="true()">a</report></rule></pattern>
      <pattern><rule context="ONIXMessage/@release"><report id="attribute" test=". = '3.1'">r</report></rule></pattern>`));
    const found = custom(w, VALID);
    const by = (code) => found.filter((f) => f.code === `schematron.${code}`);
    assert(by("union").map((f) => f.node.nodeName).join() === "RecordReference,IDValue",
      `both branches, in document order; got ${described(w, by("union"))}`);
    assert(by("absolute").length === 1 && by("absolute")[0].node.nodeName === "Header",
      `the absolute path; got ${described(w, by("absolute"))}`);
    assert(by("attribute").length === 1 && by("attribute")[0].node.nodeName === "ONIXMessage",
      `an attribute reports on its element; got ${described(w, by("attribute"))}`);
  });

  test("custom findings come after the schema's", () => {
    const { w } = installed(pattern(`<rule context="Product"><report id="last" test="true()">last</report></rule>`));
    const broken = VALID.replace("<NotificationType>03</NotificationType>", "<NotificationType>99</NotificationType>");
    const codes = findingsFor(w, broken).findings.map((f) => f.code);
    assert(codes[0] === "codelist.unknown" && codes[codes.length - 1] === "schematron.last",
      `schema first, rules last; got ${codes.join(", ")}`);
  });

  test("problems with the rule set are reported, and the rest still installs", () => {
    const { w, result } = installed(schema(`
      <pattern id="p">
        <rule context="onix:Product"><assert id="prefixed" test="true()">x</assert></rule>
        <rule context="Product"><assert id="broken" test="Product[">x</assert><let name="n" value="1"/></rule>
        <rule><assert test="true()">x</assert></rule>
      </pattern>
      <pattern><rule context="Product"><report id="fine" test="true()">fine</report></rule></pattern>`));
    const problems = result.problems.join("\n");
    assert(problems.includes("the context of rule p-rule1 uses a namespace prefix"), `prefix: ${problems}`);
    assert(problems.includes("the test of broken is not valid XPath 1.0"), `syntax: ${problems}`);
    assert(problems.includes("<let> in rule p-rule2 is not supported"), `let: ${problems}`);
    assert(problems.includes("rule p-rule3 has no context"), `context: ${problems}`);
    assert(result.problems.length === 4, `four problems, got ${result.problems.length}: ${problems}`);
    const found = custom(w, VALID);
    const invalid = found.filter((f) => f.code === "schematron.invalid");
    assert(invalid.length === 4 && invalid.every((f) => f.severity === "warning" && f.node.nodeName === "ONIXMessage"),
      `each problem is a warning on the root; got ${described(w, found)}`);
    assert(found.some((f) => f.code === "schematron.fine"), `the sound rule still runs; got ${described(w, found)}`);
  });

  test("a rule set that is not Schematron is refused whole", () => {
    const { w, result } = installed("<rules><rule/></rules>");
    assert(result.patterns === 0 && result.problems.length === 1 && result.problems[0].includes("expected a Schematron <schema>"),
      `got ${result.problems.join("; ")}`);
    const malformed = w.OnixViewerSchematron.install("<schema xmlns=\"http://purl.oclc.org/dsdl/schematron\">");
    assert(malformed.problems[0] === "the rule set is not well-formed XML", `got ${malformed.problems.join("; ")}`);
  });

  test("the viewer installs the rules block and pins the pill to the row", () => {
    const foreign = VALID.replace("<IDValue>9788234567896</IDValue>", "<IDValue>9780306406157</IDValue>");
    const w = renderSource(foreign, "foreign.xml", withRulesBlock(HOUSE_RULES));
    const label = validationLabel(w).textContent;
    assert(label.includes("1 warning"), `the toolbar counts it; got "${label}"`);
    const pill = rowsNamed(w, "ProductIdentifier")[0].querySelector(".px-finding");
    assert(pill && pill.classList.contains("px-sev-warning"), "a warning pill on the ProductIdentifier row");
    assert(pill.getAttribute("aria-label").includes("outside the 978-82 prefix"),
      `with the rule's own wording; got ${pill.getAttribute("aria-label")}`);
  });

  test("without a rules block the viewer installs nothing", () => {
    const w = render("onix-3.1-valid.xml");
    assert(validationLabel(w).textContent.includes("Valid"), "the fixture stays clean");
    assert(custom(w, VALID).length === 0, "and no custom rule is registered");
  });

  test("reset() forgets every installed set, codes included", () => {
    const rules = pattern(`<rule context="Product"><report id="gone" test="true()">g</report></rule>`);
    const { w } = installed(rules);
    assert(custom(w, VALID).length === 1, "installed");
    w.OnixViewerSchematron.reset();
    assert(custom(w, VALID).length === 0, "forgotten");
    w.OnixViewerSchematron.install(rules);
    assert(custom(w, VALID)[0].code === "schematron.gone", "and the id is free again");
  });

  test("two sets claiming one id get distinct codes", () => {
    const { w } = installed(pattern(`<rule context="Product"><report id="same" test="true()">one</report></rule>`));
    w.OnixViewerSchematron.install(pattern(`<rule context="Header"><report id="same" test="true()">two</report></rule>`));
    const codes = custom(w, VALID).map((f) => f.code).sort();
    assert(codes.join() === "schematron.same,schematron.same-2", `got ${codes.join()}`);
  });
});

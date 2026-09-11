const {
  test, describe, assert, render, findingsFor, findingsCoded, described,
} = require("../harness");

describe("Attributes", () => {

  const NS = 'xmlns="http://ns.editeur.org/onix/3.1/reference"';
  // A minimal valid 3.1 message, with hooks to break one attribute at a time.
  function message(opts) {
    const o = opts || {};
    return '<?xml version="1.0"?><ONIXMessage ' + (o.rootNs || NS) + " " +
      (o.release === undefined ? 'release="3.1"' : o.release) + ">" +
      "<Header><Sender><SenderName>T</SenderName></Sender>" +
      "<SentDateTime>20260101</SentDateTime></Header><Product>" +
      "<RecordReference>r</RecordReference><NotificationType>03</NotificationType>" +
      "<ProductIdentifier><ProductIDType>15</ProductIDType>" +
      "<IDValue>9788234567896</IDValue></ProductIdentifier>" +
      "<DescriptiveDetail><ProductComposition>00</ProductComposition>" +
      "<ProductForm" + (o.formAttrs || "") + ">BB</ProductForm>" +
      "<TitleDetail><TitleType>01</TitleType><TitleElement>" +
      "<TitleElementLevel>01</TitleElementLevel><NoPrefix/>" +
      "<TitleWithoutPrefix" + (o.titleAttrs || "") + ">T</TitleWithoutPrefix>" +
      "</TitleElement></TitleDetail></DescriptiveDetail></Product></ONIXMessage>";
  }
  function attributeFindings(window, xml) {
    return findingsCoded(window, xml, "attribute.");
  }
  // One finding, summarised as "code name=value" for the assertions below.
  const only = (list) => list.length === 1 ? list[0] : null;
  const is = (f, code, fields) => Boolean(f) && f.code === code &&
    Object.entries(fields).every(([k, v]) => f.data[k] === v);

  test("the baseline message has no attribute findings", () => {
    const w = render("onix-3.1-valid.xml");
    assert(findingsFor(w, message()).total === 0,
      `expected a clean baseline, got: ${described(w, attributeFindings(w, message()))}`);
  });

  test("legal attribute values pass", () => {
    const w = render("onix-3.1-valid.xml");
    const found = attributeFindings(w, message({
      titleAttrs: ' language="nob" textcase="02" collationkey="T" datestamp="20260101"',
      formAttrs: ' sourcename="Bokbasen" sourcetype="01"',
    }));
    assert(found.length === 0, `expected none, got: ${described(w, found)}`);
  });

  test("an attribute that does not belong to the element is reported", () => {
    const w = render("onix-3.1-valid.xml");
    const found = attributeFindings(w, message({ formAttrs: ' colour="red"' }));
    assert(is(only(found), "attribute.unknown", { name: "colour", element: "ProductForm" }),
      `got: ${described(w, found)}`);
    // language is a real ONIX attribute, but not on <ProductForm>.
    const wrongPlace = attributeFindings(w, message({ formAttrs: ' language="nob"' }));
    assert(is(only(wrongPlace), "attribute.unknown", { name: "language", element: "ProductForm" }),
      `a real attribute in the wrong place should still be reported; got: ${described(w, wrongPlace)}`);
  });

  test("a bad code in an attribute is reported, and the list is named", () => {
    const w = render("onix-3.1-valid.xml");
    const found = attributeFindings(w, message({ titleAttrs: ' textcase="99"' }));
    // List 14 is bound to an attribute, not to any element, so naming it
    // needs the by-number titles rather than the element meta.
    assert(is(only(found), "attribute.code", { name: "textcase", value: "99", list: 14, title: "Text case flag" }),
      `got: ${described(w, found)}`);
  });

  test("a deprecated code in an attribute is a warning, not an error", () => {
    const w = render("onix-3.1-valid.xml");
    const result = findingsFor(w, message({ titleAttrs: ' language="scr"' }));
    const finding = result.findings.find((f) => f.code === "attribute.deprecated");
    assert(finding, `expected a deprecation; got: ${result.findings.map((f) => f.code).join(", ")}`);
    assert(finding.severity === "warning", "valid ONIX that shouldn't be sent");
  });

  test("an attribute that breaks its datatype is reported", () => {
    const w = render("onix-3.1-valid.xml");
    const found = attributeFindings(w, message({ formAttrs: ' datestamp="not-a-date"' }));
    assert(is(only(found), "attribute.pattern", { name: "datestamp", type: "DateOrDateTime" }),
      `got: ${described(w, found)}`);
    // A well-formed datestamp passes.
    assert(attributeFindings(w, message({ formAttrs: ' datestamp="20260101"' })).length === 0,
      "a valid date should pass");
  });

  test("release is required on the message root, and must say 3.1", () => {
    const w = render("onix-3.1-valid.xml");
    const missing = attributeFindings(w, message({ release: "" }));
    assert(missing.some((f) => is(f, "attribute.missing", { name: "release" })),
      `got: ${described(w, missing)}`);
    const wrong = attributeFindings(w, message({ release: 'release="3.2"' }));
    assert(wrong.some((f) => is(f, "attribute.value", { name: "release", value: "3.2", expected: '"3.1"' })),
      `got: ${described(w, wrong)}`);
  });

  test("refname and shortname must match the element they sit on", () => {
    const w = render("onix-3.1-valid.xml");
    // Correct in both dialects — the short tag comes from the generated map.
    assert(attributeFindings(w, message({
      formAttrs: ' refname="ProductForm" shortname="b012"' })).length === 0,
      "the element's own names should pass");
    const wrong = attributeFindings(w, message({ formAttrs: ' refname="ProductFrom"' }));
    assert(is(only(wrong), "attribute.value", { name: "refname", expected: '"ProductForm"' }),
      `got: ${described(w, wrong)}`);
    const wrongShort = attributeFindings(w, message({ formAttrs: ' shortname="b999"' }));
    assert(is(only(wrongShort), "attribute.value", { name: "shortname", expected: '"b012"' }),
      `got: ${described(w, wrongShort)}`);
  });

  test("namespace, xsi and xml attributes are not ONIX's to judge", () => {
    const w = render("onix-3.1-valid.xml");
    const xml = message({
      rootNs: NS + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="a b"',
      titleAttrs: ' xml:lang="nb"',
    });
    const found = attributeFindings(w, xml);
    assert(found.length === 0,
      `xmlns/xsi/xml:lang are legal and not ONIX's; got: ${described(w, found)}`);
  });

  test("short-tag documents use the same attribute names", () => {
    // Only element names shorten; language stays language.
    const short = '<?xml version="1.0"?>' +
      '<ONIXmessage xmlns="http://ns.editeur.org/onix/3.1/short" release="3.1">' +
      "<header><x298><x299>T</x299></x298><m182>20260101</m182></header><product>" +
      "<a001>r</a001><a002>03</a002>" +
      "<productidentifier><b221>15</b221><b244>9788234567896</b244></productidentifier>" +
      "<descriptivedetail><x314>00</x314><b012>BB</b012>" +
      "<titledetail><b202>01</b202><titleelement><x409>01</x409><x501/>" +
      '<b031 textcase="99">T</b031></titleelement></titledetail>' +
      "</descriptivedetail></product></ONIXmessage>";
    const w = render("onix-3.1-valid.xml");
    const found = attributeFindings(w, short);
    assert(is(only(found), "attribute.code", { name: "textcase", value: "99" }),
      `the same attribute check should apply in short tags; got: ${described(w, found)}`);
  });
  test("an empty attribute value is reported, whatever the attribute's type", () => {
    // No ONIX attribute has a legal empty value: each is code-list bound, an
    // enumeration, or a datatype whose pattern demands a character. The rule
    // used to bail on a falsy value, so language="" sailed through unchecked —
    // the same class of hole as the four datatypes that carried no facets.
    const w = render("onix-3.1-valid.xml");
    for (const attribute of ["language", "collationkey", "datestamp"]) {
      const xml = message({ titleAttrs: ` ${attribute}=""` });
      const found = attributeFindings(w, xml);
      assert(is(only(found), "attribute.empty", { name: attribute }),
        `${attribute}="" should be reported empty; got: ${described(w, found)}`);
    }

    // Whitespace-only is the empty string too: every enumerated type in ONIX
    // restricts xs:token, which collapses whitespace before validating.
    const blank = attributeFindings(w, message({ titleAttrs: ' language="   "' }));
    assert(is(only(blank), "attribute.empty", { name: "language" }),
      `whitespace-only collapses to empty; got: ${described(w, blank)}`);

    // Which is also why a padded but real code has to stay valid.
    const padded = attributeFindings(w, message({ titleAttrs: ' language=" eng "' }));
    assert(padded.length === 0, `language=" eng " must stay valid; got: ${described(w, padded)}`);
  });

  test("an ONIX-namespaced attribute is reported, a foreign one is not", () => {
    // ONIX declares all ten attributes unqualified — none is global and
    // neither schema sets attributeFormDefault — so onix:language is not a
    // valid ONIX attribute at all. The rule skipped every namespaced
    // attribute, so onix:language="zzz" was neither judged nor complained
    // about. A foreign namespace stays tolerated: that is where real feeds put
    // their own annotations, and flagging it would report their conventions as
    // errors.
    const w = render("onix-3.1-valid.xml");
    const withNs = (attrs) => message({
      rootNs: 'xmlns="http://ns.editeur.org/onix/3.1/reference" ' +
        'xmlns:onix="http://ns.editeur.org/onix/3.1/reference" ' +
        'xmlns:foo="http://example.invalid/x"',
      titleAttrs: " " + attrs,
    });

    for (const attrs of ['onix:language="zzz"', 'onix:language="eng"', 'onix:bogus="1"']) {
      const found = attributeFindings(w, withNs(attrs));
      assert(is(only(found), "attribute.qualified", {}),
        `${attrs} should be reported; got: ${described(w, found)}`);
    }
    for (const attrs of ['foo:anything="1"', 'xml:lang="en"']) {
      const found = attributeFindings(w, withNs(attrs));
      assert(found.length === 0, `${attrs} must stay silent; got: ${described(w, found)}`);
    }
  });

});

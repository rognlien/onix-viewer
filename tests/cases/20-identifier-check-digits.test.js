const {
  test, describe, assert, render, findingsFor,
} = require("../harness");

describe("Identifier check digits", () => {
  // A product record carrying one identifier of the given type and value.
  function record(type, value) {
    return '<?xml version="1.0" encoding="UTF-8"?>' +
      '<ONIXMessage xmlns="http://ns.editeur.org/onix/3.1/reference" release="3.1">' +
      "<Header><Sender><SenderName>T</SenderName></Sender>" +
      "<SentDateTime>20260101</SentDateTime></Header><Product>" +
      "<RecordReference>r1</RecordReference><NotificationType>03</NotificationType>" +
      `<ProductIdentifier><ProductIDType>${type}</ProductIDType>` +
      (type === "01" ? "<IDTypeName>Internal</IDTypeName>" : "") +
      `<IDValue>${value}</IDValue></ProductIdentifier>` +
      "<DescriptiveDetail><ProductComposition>00</ProductComposition>" +
      "<ProductForm>BB</ProductForm></DescriptiveDetail></Product></ONIXMessage>";
  }
  function checkDigitFindings(window, type, value) {
    return findingsFor(window, record(type, value)).findings
      .filter((f) => f.code === "gtin.checkdigit")
      .map((f) => window.OnixViewerValidation.message(f));
  }

  test("real ISBN-13s pass", () => {
    const w = render("onix-3.1-valid.xml");
    // Two canonical examples plus the one the fixtures use.
    for (const isbn of ["9780306406157", "9783161484100", "9788234567896"]) {
      assert(checkDigitFindings(w, "15", isbn).length === 0, `${isbn} should pass`);
    }
  });

  test("a wrong check digit is reported, with the digit it should be", () => {
    const w = render("onix-3.1-valid.xml");
    const messages = checkDigitFindings(w, "15", "9788234567892");
    assert(messages.length === 1, `expected one finding, got: ${messages.join(" | ")}`);
    assert(messages[0] === '"9788234567892" has an invalid check digit for ISBN-13 (expected 6)',
      `got: ${messages[0]}`);
  });

  test("GTIN-13 and ISBN-10 are checked, ISBN-10's X included", () => {
    const w = render("onix-3.1-valid.xml");
    assert(checkDigitFindings(w, "03", "9780000000002").length === 0, "valid GTIN-13");
    assert(checkDigitFindings(w, "03", "9780000000003").length === 1, "invalid GTIN-13");
    // 043942089X is a real ISBN-10 whose check digit is X (remainder 10).
    assert(checkDigitFindings(w, "02", "043942089X").length === 0, "valid ISBN-10 ending X");
    assert(checkDigitFindings(w, "02", "0439420891").length === 1, "invalid ISBN-10");
  });

  test("schemes without a check digit are left alone", () => {
    const w = render("onix-3.1-valid.xml");
    // A proprietary ID (01) is any string the sender likes; a DOI (06) has no
    // check digit either. Neither may be judged by the GTIN algorithm.
    assert(checkDigitFindings(w, "01", "9788234567892").length === 0, "proprietary IDs are opaque");
    assert(checkDigitFindings(w, "06", "10.1000/182").length === 0, "DOIs have no check digit");
  });

  test("a value of the wrong length is left to the datatype rule", () => {
    const w = render("onix-3.1-valid.xml");
    // Reporting a check digit for a 12-digit "ISBN-13" would only add noise on
    // top of the length error the schema already catches.
    assert(checkDigitFindings(w, "15", "978823456789").length === 0, "too short");
    assert(checkDigitFindings(w, "15", "97882345678966").length === 0, "too long");
  });
  test("a wrong-length identifier is reported, not silently skipped", () => {
    // <IDValue> is dt.NonEmptyString, so the schema constrains neither length
    // nor alphabet — a hyphenated or truncated ISBN is schema-valid and no
    // other rule can see it. This rule owns the length for the schemes it
    // knows, and reports it instead of the check digit, which cannot be
    // computed for a value of the wrong shape.
    const w = render("onix-3.1-valid.xml");
    const lengthFindings = (type, value) =>
      findingsFor(w, record(type, value)).findings
        .filter((f) => f.code === "gtin.length")
        .map((f) => w.OnixViewerValidation.message(f));

    for (const [type, value] of [["15", "978-82-345-6789-6"], ["15", "97882345"],
                                 ["03", "978823456789"], ["02", "03854908"]]) {
      const found = lengthFindings(type, value);
      assert(found.length === 1, `${type}/${value} should report its length; got: ${found.join("; ") || "nothing"}`);
      assert(checkDigitFindings(w, type, value).length === 0,
        `${type}/${value} must not also complain about the check digit`);
    }

    // A correct-length value still gets its digit checked, and a scheme with
    // no check digit stays silent whatever its length.
    assert(lengthFindings("15", "9788234567896").length === 0, "a valid ISBN-13 passes");
    assert(checkDigitFindings(w, "15", "9788234567890").length === 1,
      "a correct-length ISBN-13 with a bad digit is still reported");
    assert(lengthFindings("01", "ABC-123").length === 0,
      "a proprietary identifier has no length to enforce");
  });

  test("a lower-case x is accepted in an ISBN-10 check position", () => {
    // Deliberate tolerance: the standard writes X upper case, but the schema
    // constrains neither, and rejecting it would fail otherwise-correct feeds.
    const w = render("onix-3.1-valid.xml");
    for (const value of ["038549081X", "038549081x"]) {
      assert(checkDigitFindings(w, "02", value).length === 0,
        `${value} should pass; got: ${checkDigitFindings(w, "02", value).join("; ")}`);
    }
  });

});

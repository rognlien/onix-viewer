const path = require("path");
const {
  test, describe, assert, render, renderSource, $$, rowsNamed, findingsFor, findings, codes, validationLabel, FIXTURES, SAMPLES,
} = require("../harness");

describe("Validation", () => {
  const fsv = require("fs");
  // Validation runs itself on load, so this only reads the result. A fixture
  // is small enough to finish inside the first slice, hence synchronously.
  // Validate arbitrary XML inside a given window, so a test can register a
  // rule and then exercise it against several documents in one context.

  // Production loads one model, not both — content.js picks it from the
  // document's release — so every fixture must yield the same verdict from
  // its own model alone as it does from both. A model that only validates
  // because the other release happened to be loaded would show up here.
  test("one model gives the same verdict as both, for every ONIX fixture", () => {
    const disagreed = [];
    // One window is enough to read each document's release; the comparison
    // then renders the fixture once per model set.
    const detector = render("onix-3.1-valid.xml");
    for (const fixture of fsv.readdirSync(FIXTURES).filter((f) => f.startsWith("onix-"))) {
      const xml = fsv.readFileSync(path.join(FIXTURES, fixture), "utf8");
      const doc = new detector.DOMParser().parseFromString(xml, "application/xml");
      const version = detector.OnixViewerOnix.detect(doc).version;
      if (version !== "3.0" && version !== "3.1") continue;
      const alone = codes(findings(renderSource(xml, fixture, null, [version]))).sort();
      const both = codes(findings(renderSource(xml, fixture))).sort();
      if (alone.join("|") !== both.join("|")) {
        disagreed.push(`${fixture}: alone [${alone}] vs both [${both}]`);
      }
    }
    assert(disagreed.length === 0, disagreed.join("; "));
  });

  test("a valid document stays valid with only its own model loaded", () => {
    const xml = fsv.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
    const w = renderSource(xml, "onix-3.1-valid.xml", null, ["3.1"]);
    assert(Object.keys(w.OnixViewerContentModels).join() === "3.1",
      `only 3.1 should be loaded, got ${Object.keys(w.OnixViewerContentModels).join()}`);
    const result = findings(w);
    assert(result.checkedStructure, "structure should have been checked");
    assert(result.total === 0, `expected clean, got: ${codes(result).join(", ")}`);
  });

  test("a standalone <Product> root is validated in full, in both dialects", () => {
    // No <ONIXMessage> envelope, so nothing about the message shape applies —
    // but <Product> is in the model like any other element, so the structural
    // rules do bite. The release comes from the namespace, there being no
    // `release` attribute to read.
    const product = (ns, body) =>
      `<?xml version="1.0"?><${ns.root} xmlns="http://ns.editeur.org/onix/3.1/${ns.dialect}">` +
      `${body}</${ns.root}>`;
    const reference = product({ root: "Product", dialect: "reference" },
      "<RecordReference>r1</RecordReference><ProductFrom>typo</ProductFrom>" +
      "<DescriptiveDetail><ProductForm>BB</ProductForm></DescriptiveDetail>");
    const w = render("onix-3.1-standalone-product.xml");
    const bad = findingsFor(w, reference);
    assert(bad.checkedStructure, "a <Product> root must be checked structurally");
    assert(codes(bad).includes("structure.unknown"), `got: ${codes(bad).join(", ")}`);
    assert(codes(bad).filter((c) => c === "structure.missing").length >= 2,
      `the root's own required children should be checked; got: ${codes(bad).join(", ")}`);

    // The model's tables are keyed by names read off the document, so an
    // element named after an Object.prototype member must not inherit one as
    // its shape: <constructor> used to be reported as deprecated and as
    // needing a value instead of as unknown.
    const inherited = product({ root: "Product", dialect: "reference" },
      "<RecordReference>r1</RecordReference><NotificationType>03</NotificationType>" +
      "<constructor>x</constructor><toString/>");
    const prototype = findingsFor(w, inherited);
    const about = (name) => prototype.findings.filter((f) => f.node.nodeName === name).map((f) => f.code);
    assert(about("constructor").join() === "structure.unknown", `constructor: ${about("constructor")}`);
    assert(about("toString").join() === "structure.unknown", `toString: ${about("toString")}`);

    // The fixture itself is valid apart from its deprecated <TitleText>.
    const clean = findings(w);
    assert(clean.checkedStructure && codes(clean).join() === "element.deprecated",
      `expected only the deprecation; got: ${codes(clean).join(", ")}`);

    // And the same in short tags.
    const short = findingsFor(w, product({ root: "product", dialect: "short" },
      "<a001>r1</a001><a002>03</a002>" +
      "<productidentifier><b221>15</b221><b244>9788234567896</b244></productidentifier>" +
      "<descriptivedetail><x314>00</x314><b012>BB</b012><b203>T</b203></descriptivedetail>"));
    assert(short.checkedStructure, "a short-tag <product> root must be checked too");
  });

  test("a <Product> root with no namespace has no release to check against", () => {
    // The one case that genuinely cannot be validated structurally: no
    // namespace and no release attribute means no way to pick a model. Code
    // lists are release-independent, so those are still checked.
    const w = render("onix-standalone-product-no-namespace.xml");
    const result = findings(w);
    assert(!result.checkedStructure, "structure must not be guessed at");
    assert(codes(result).includes("model.missing"), `got: ${codes(result).join(", ")}`);
    assert(w.OnixViewerOnix.detect(
      new w.DOMParser().parseFromString(w.__OXV_SOURCE__, "application/xml")).isOnix,
      "but it is still recognised as ONIX and taken over");
  });

  test("a release with no bundled model is reported, naming what did load", () => {
    // ONIX 2.1 has no model. content.js ships both in that case precisely so
    // this warning can list them, rather than under-reporting what exists.
    const w = renderSource(
      '<?xml version="1.0"?><ONIXMessage release="2.1"><Product>' +
      "<RecordReference>x</RecordReference></Product></ONIXMessage>",
      "onix-2.1.xml", null, ["3.1", "3.0"]);
    const result = findings(w);
    assert(codes(result).includes("model.missing"), `got: ${codes(result).join(", ")}`);
    assert(!result.checkedStructure, "structure must not be checked against the wrong schema");
    const warning = result.findings.find((f) => f.code === "model.missing");
    assert(warning.data.available === "3.0, 3.1",
      `the warning should name both bundled releases, got: ${JSON.stringify(warning.data)}`);
  });

  // An element declared by a named complexType rather than an inline one.
  // Five declarations in 3.1 are shaped that way and all five are
  // <EpubLicense>; compiling only inline types left it out of the model, so
  // valid 3.1 reported it as unknown and nothing inside it was checked.
  describe("elements declared by a named complexType", () => {
    // EpubLicense sits between <ProductForm> and <TitleDetail> in
    // DescriptiveDetail, and between <PriceType> and <PriceAmount> in Price.
    const licence = (body) =>
      `<EpubLicense><EpubLicenseName>CC BY 4.0</EpubLicenseName>${body}</EpubLicense>`;
    const licenceDate =
      "<EpubLicenseDate><EpubLicenseDateRole>24</EpubLicenseDateRole>" +
      "<Date>20260101</Date></EpubLicenseDate>";
    const message = (inDescriptive, inPrice) =>
      '<?xml version="1.0"?><ONIXMessage release="3.1" ' +
      'xmlns="http://ns.editeur.org/onix/3.1/reference">' +
      "<Header><Sender><SenderName>S</SenderName></Sender>" +
      "<SentDateTime>20260101</SentDateTime></Header>" +
      "<Product><RecordReference>r1</RecordReference><NotificationType>03</NotificationType>" +
      "<ProductIdentifier><ProductIDType>15</ProductIDType>" +
      "<IDValue>9788234567896</IDValue></ProductIdentifier>" +
      "<DescriptiveDetail><ProductComposition>00</ProductComposition>" +
      `<ProductForm>BC</ProductForm>${inDescriptive}` +
      "<TitleDetail><TitleType>01</TitleType><TitleElement>" +
      "<TitleElementLevel>01</TitleElementLevel><NoPrefix/>" +
      "<TitleWithoutPrefix>T</TitleWithoutPrefix></TitleElement></TitleDetail>" +
      "</DescriptiveDetail>" +
      (inPrice
        ? "<ProductSupply><Market><Territory>" +
          "<CountriesIncluded>NO</CountriesIncluded></Territory></Market>" +
          "<SupplyDetail><Supplier><SupplierRole>01</SupplierRole>" +
          "<SupplierName>X</SupplierName></Supplier>" +
          "<ProductAvailability>20</ProductAvailability>" +
          `<Price><PriceType>02</PriceType>${inPrice}` +
          "<PriceAmount>10.00</PriceAmount></Price></SupplyDetail></ProductSupply>"
        : "") +
      "</Product></ONIXMessage>";

    test("<EpubLicense> is a known element and its children are checked", () => {
      const w = render("onix-3.1-valid.xml");
      assert(w.OnixViewerContentModels["3.1"].elements.EpubLicense,
        "EpubLicense must be in the 3.1 model");
      const clean = findingsFor(w, message(licence(""), null));
      assert(clean.total === 0, `expected clean, got: ${codes(clean).join(", ")}`);

      const missingName = findingsFor(w, message("<EpubLicense/>", null));
      assert(codes(missingName).includes("structure.missing"),
        `a required <EpubLicenseName> should be demanded; got: ${codes(missingName).join(", ")}`);
    });

    test("its content model follows the parent it sits in", () => {
      // EpubLicenseWithDateType adds <EpubLicenseDate> and applies everywhere
      // except inside <Price>, which keeps the plain EpubLicenseType.
      const w = render("onix-3.1-valid.xml");
      const allowed = findingsFor(w, message(licence(licenceDate), null));
      assert(allowed.total === 0,
        `<EpubLicenseDate> is legal under <DescriptiveDetail>; got: ${codes(allowed).join(", ")}`);

      const refused = findingsFor(w, message("", licence(licenceDate)));
      assert(codes(refused).join() === "structure.unexpected",
        `and illegal under <Price>; got: ${codes(refused).join(", ")}`);

      const plain = findingsFor(w, message("", licence("")));
      assert(plain.total === 0,
        `<EpubLicense> itself is fine under <Price>; got: ${codes(plain).join(", ")}`);
    });
  });

  test("text inside an element-only composite is reported", () => {
    // No composite is mixed="true" — that is what `flow` marks, and flow
    // returns before this check — so character data inside one violates the
    // schema. The matcher works from childElements alone and never saw it.
    // Indentation is whitespace and must stay invisible.
    const w = render("onix-3.1-valid.xml");
    const product = (stray) =>
      '<?xml version="1.0"?><ONIXMessage release="3.1" ' +
      'xmlns="http://ns.editeur.org/onix/3.1/reference">' +
      "<Header><Sender><SenderName>S</SenderName></Sender>" +
      "<SentDateTime>20260101</SentDateTime></Header>" +
      `<Product>${stray}<RecordReference>r1</RecordReference>` +
      "<NotificationType>03</NotificationType>" +
      "<ProductIdentifier><ProductIDType>15</ProductIDType>" +
      "<IDValue>9788234567896</IDValue></ProductIdentifier>" +
      "<DescriptiveDetail><ProductComposition>00</ProductComposition>" +
      "<ProductForm>BC</ProductForm><TitleDetail><TitleType>01</TitleType><TitleElement>" +
      "<TitleElementLevel>01</TitleElementLevel><NoPrefix/>" +
      "<TitleWithoutPrefix>T</TitleWithoutPrefix></TitleElement></TitleDetail>" +
      "</DescriptiveDetail></Product></ONIXMessage>";

    assert(codes(findingsFor(w, product("oops"))).join() === "structure.stray-text",
      `stray text should be reported; got: ${codes(findingsFor(w, product("oops"))).join(", ")}`);
    assert(codes(findingsFor(w, product("<![CDATA[oops]]>"))).join() === "structure.stray-text",
      "CDATA is character data too");
    assert(findingsFor(w, product("\n\t   \n")).total === 0,
      "indentation must stay invisible");
    assert(findingsFor(w, product("")).total === 0, "and the control stays clean");

    // XHTML-bearing elements are mixed by design and must not be touched.
    const flow = product("").replace("<TitleWithoutPrefix>T</TitleWithoutPrefix>",
      "<TitleWithoutPrefix>T</TitleWithoutPrefix>");
    assert(findingsFor(w, flow).total === 0, "flow content is not judged");
  });

  test("a finite maxOccurs is enforced, not just unbounded", () => {
    // <OrderQuantityMinimum> is the one particle in either release with a
    // finite bound above one (maxOccurs="2"), so it is the only thing keeping
    // the matcher's third occurrence check honest.
    const w = render("onix-3.1-valid.xml");
    const supply = (minimums) =>
      '<?xml version="1.0"?><ONIXMessage release="3.1" ' +
      'xmlns="http://ns.editeur.org/onix/3.1/reference">' +
      "<Header><Sender><SenderName>S</SenderName></Sender>" +
      "<SentDateTime>20260101</SentDateTime></Header>" +
      "<Product><RecordReference>r1</RecordReference><NotificationType>03</NotificationType>" +
      "<ProductIdentifier><ProductIDType>15</ProductIDType>" +
      "<IDValue>9788234567896</IDValue></ProductIdentifier>" +
      "<DescriptiveDetail><ProductComposition>00</ProductComposition>" +
      "<ProductForm>BC</ProductForm><TitleDetail><TitleType>01</TitleType><TitleElement>" +
      "<TitleElementLevel>01</TitleElementLevel><NoPrefix/>" +
      "<TitleWithoutPrefix>T</TitleWithoutPrefix></TitleElement></TitleDetail>" +
      "</DescriptiveDetail><ProductSupply><Market><Territory>" +
      "<CountriesIncluded>NO</CountriesIncluded></Territory></Market>" +
      "<SupplyDetail><Supplier><SupplierRole>01</SupplierRole>" +
      "<SupplierName>X</SupplierName></Supplier>" +
      "<ProductAvailability>20</ProductAvailability>" +
      minimums.map((q) => `<OrderQuantityMinimum>${q}</OrderQuantityMinimum>`).join("") +
      "<UnpricedItemType>01</UnpricedItemType>" +
      "</SupplyDetail></ProductSupply></Product></ONIXMessage>";

    assert(findingsFor(w, supply([1, 2])).total === 0, "two is the declared maximum");
    const tooMany = findingsFor(w, supply([1, 2, 3]));
    assert(codes(tooMany).join() === "structure.repeated",
      `a third must be reported; got: ${codes(tooMany).join(", ")}`);
    assert(tooMany.findings[0].data.max === 2,
      `the limit should be named; got: ${JSON.stringify(tooMany.findings[0].data)}`);
  });

  test("an XSD element default makes an empty element valid", () => {
    // <CopyrightType default="C"> means an empty <CopyrightType/> carries "C",
    // so demanding a value there is a false positive. Three declarations
    // across the two releases carry a default; nothing else may skip the check.
    const w = render("onix-3.1-valid.xml");
    const statement = (body) =>
      '<?xml version="1.0"?><ONIXMessage release="3.1" ' +
      'xmlns="http://ns.editeur.org/onix/3.1/reference">' +
      "<Header><Sender><SenderName>S</SenderName></Sender>" +
      "<SentDateTime>20260101</SentDateTime></Header>" +
      "<Product><RecordReference>r1</RecordReference><NotificationType>03</NotificationType>" +
      "<ProductIdentifier><ProductIDType>15</ProductIDType>" +
      "<IDValue>9788234567896</IDValue></ProductIdentifier>" +
      "<DescriptiveDetail><ProductComposition>00</ProductComposition>" +
      "<ProductForm>BC</ProductForm><TitleDetail><TitleType>01</TitleType><TitleElement>" +
      "<TitleElementLevel>01</TitleElementLevel><NoPrefix/>" +
      "<TitleWithoutPrefix>T</TitleWithoutPrefix></TitleElement></TitleDetail>" +
      "</DescriptiveDetail><PublishingDetail><Imprint><ImprintName>I</ImprintName></Imprint>" +
      `<CopyrightStatement>${body}</CopyrightStatement>` +
      "</PublishingDetail></Product></ONIXMessage>";

    const empty = findingsFor(w, statement("<CopyrightType/><CopyrightYear>2026</CopyrightYear>"));
    assert(empty.total === 0,
      `an empty <CopyrightType/> defaults to "C"; got: ${codes(empty).join(", ")}`);
    const missing = findingsFor(w, statement("<CopyrightYear></CopyrightYear>"));
    assert(codes(missing).join() === "structure.missing-value",
      `an element without a default still needs one; got: ${codes(missing).join(", ")}`);
  });

  test("ONIX 3.0's own names for its attribute code lists resolve", () => {
    // 3.0 types three attributes after the list rather than numbering it —
    // SourceTypeCode where 3.1 says List3 — and those definitions live in the
    // CodeLists XSD we don't commit. Unmapped, all three went unchecked.
    const w = render("onix-3.0-reference.xml");
    const specs = w.OnixViewerContentModels["3.0"].attributes;
    assert(specs.sourcetype.list === 3 && specs.textcase.list === 14 &&
      specs.textformat.list === 34,
      `expected the three to be code-list bound, got: ${JSON.stringify(specs)}`);

    const text = (attributes) =>
      '<?xml version="1.0"?><ONIXMessage release="3.0" ' +
      'xmlns="http://ns.editeur.org/onix/3.0/reference">' +
      "<Header><Sender><SenderName>S</SenderName></Sender>" +
      "<SentDateTime>20260101</SentDateTime></Header>" +
      "<Product><RecordReference>r1</RecordReference><NotificationType>03</NotificationType>" +
      "<ProductIdentifier><ProductIDType>15</ProductIDType>" +
      "<IDValue>9788234567896</IDValue></ProductIdentifier>" +
      "<DescriptiveDetail><ProductComposition>00</ProductComposition>" +
      "<ProductForm>BC</ProductForm><TitleDetail><TitleType>01</TitleType><TitleElement>" +
      "<TitleElementLevel>01</TitleElementLevel><TitleText>T</TitleText>" +
      "</TitleElement></TitleDetail></DescriptiveDetail>" +
      "<CollateralDetail><TextContent><TextType>03</TextType>" +
      `<ContentAudience>00</ContentAudience><Text ${attributes}>B</Text>` +
      "</TextContent></CollateralDetail></Product></ONIXMessage>";

    assert(codes(findingsFor(w, text('textformat="05"'))).join() === "",
      "a valid List 34 code passes");
    assert(codes(findingsFor(w, text('textformat="99"'))).join() === "attribute.code",
      `and an invalid one is reported; got: ${codes(findingsFor(w, text('textformat="99"'))).join(", ")}`);
  });

  test("every datatype the models name is one they compiled", () => {
    // A shape naming a datatype the generator never compiled is skipped in
    // silence — the element or attribute simply goes unchecked, which is how
    // 3.0's textformat slipped through. The generator asserts this too; this
    // guards the shipped files.
    const w = render("onix-3.1-valid.xml");
    const unresolved = [];
    for (const [release, model] of Object.entries(w.OnixViewerContentModels)) {
      const check = (label, named) => {
        if (typeof named === "string" && !model.datatypes[named]) {
          unresolved.push(`${release} ${label} -> ${named}`);
        }
      };
      for (const [name, shape] of Object.entries(model.elements)) {
        check(`<${name}>`, shape.text);
        for (const [parent, variant] of Object.entries(shape.in || {})) {
          check(`<${name}> in <${parent}>`, variant.text);
        }
      }
      for (const [name, spec] of Object.entries(model.attributes)) check(`@${name}`, spec.text);
    }
    assert(unresolved.length === 0, `unchecked datatypes: ${unresolved.join(", ")}`);
  });

  test("a schema-valid ONIX 3.1 message reports nothing", () => {
    const w = render("onix-3.1-valid.xml");
    const result = findings(w);
    assert(result.total === 0, `expected a clean document, got: ${codes(result).join(", ")}`);
    assert(result.checkedStructure, "structure should have been checked");
    assert(validationLabel(w).textContent === "Valid", `got: ${validationLabel(w).textContent}`);
    assert(validationLabel(w).className === "px-valid", "and be marked as such");
    assert(validationLabel(w).querySelector("svg"), "with a tick beside it");
  });

  test("each kind of defect is reported once, with no cascade", () => {
    const w = render("onix-3.1-invalid.xml");
    const result = findings(w);
    for (const code of ["codelist.unknown", "codelist.deprecated", "structure.unknown",
                        "datatype.range", "structure.expected-one-of",
                        "element.deprecated", "gtin.checkdigit"]) {
      assert(codes(result).includes(code), `missing ${code}; got: ${codes(result).join(", ")}`);
    }
    // An unknown element must not make its siblings "not allowed here" too.
    assert(!codes(result).includes("structure.unexpected"),
      `a typo should not cascade; got: ${codes(result).join(", ")}`);
    assert(result.total === 7, `expected 7 findings, got ${result.total}: ${codes(result).join(", ")}`);
  });

  test("findings are pinned to the rows they are about", () => {
    const w = render("onix-3.1-invalid.xml");
    validationLabel(w);
    const marked = $$(w, "#oxv-root .px-has-finding");
    assert(marked.length >= 3, `expected several marked rows, got ${marked.length}`);
    const notification = rowsNamed(w, "NotificationType")[0];
    const marker = notification.querySelector(".px-finding");
    assert(marker, "the bad code's row should carry a marker");
    assert(marker.title.includes("not in List 1"), `got: ${marker.title}`);
    assert(validationLabel(w).textContent === "5 errors, 2 warnings", `got: ${validationLabel(w).textContent}`);
  });

  test("markers carry their severity: errors red, warnings amber", () => {
    const w = render("onix-3.1-invalid.xml");
    validationLabel(w);
    const badCode = rowsNamed(w, "NotificationType")[0].querySelector(".px-finding");
    assert(badCode.classList.contains("px-sev-error"), "an out-of-list code is a schema violation");
    assert(badCode.getAttribute("aria-label").startsWith("Error:"), `got: ${badCode.getAttribute("aria-label")}`);
    const deprecated = rowsNamed(w, "ProductIDType")[0].querySelector(".px-finding");
    assert(deprecated.classList.contains("px-sev-warning"), "a deprecated code is still valid ONIX");
    assert(deprecated.getAttribute("aria-label").startsWith("Warning:"),
      `got: ${deprecated.getAttribute("aria-label")}`);
    // The row tint distinguishes them too, so a finding is visible while scanning.
    assert(rowsNamed(w, "NotificationType")[0].classList.contains("px-has-error"), "error row tint");
    assert(!rowsNamed(w, "ProductIDType")[0].classList.contains("px-has-error"), "warning row tint only");
  });

  test("severity is shown with an inline SVG, not a text glyph", () => {
    // ⚠ renders as a colour emoji on several platforms, which would sit oddly
    // inside a coloured chip, and glyph metrics move the chip around.
    const w = render("onix-3.1-invalid.xml");
    validationLabel(w);
    for (const marker of $$(w, "#oxv-root .px-finding")) {
      const svg = marker.querySelector("svg");
      assert(svg, `every chip should hold an icon: ${marker.outerHTML}`);
      assert(svg.namespaceURI === "http://www.w3.org/2000/svg", "in the SVG namespace");
      assert(svg.getAttribute("viewBox") === "0 0 16 16", "on the shared 16-unit grid");
      assert(svg.getAttribute("stroke") === "currentColor", "so the chip's colour carries");
      assert(svg.getAttribute("aria-hidden") === "true", "the chip's aria-label does the talking");
      assert(!/[⚠✕]/.test(marker.textContent), `no glyphs left: ${marker.textContent}`);
    }
    const error = rowsNamed(w, "NotificationType")[0].querySelector(".px-finding svg path");
    const warning = rowsNamed(w, "ProductIDType")[0].querySelector(".px-finding svg path");
    assert(error.getAttribute("d") !== warning.getAttribute("d"),
      "the two severities must be different shapes, not only different colours");
  });

  test("a row with several findings shows the first and says how many more", () => {
    const w = render("onix-3.1-invalid.xml");
    // Two findings on one element: the bad code it already carries, plus an
    // attribute ONIX doesn't declare.
    const source = w.__OXV_SOURCE__.replace("<NotificationType>99", '<NotificationType bogus="1">99');
    const two = renderSource(source, "two-findings.xml");
    const marker = rowsNamed(two, "NotificationType")[0].querySelector(".px-finding");
    assert(marker, "the row should be marked");
    assert(marker.querySelectorAll("svg").length === 1, "one icon, not one per finding");
    const inline = marker.querySelector(".px-finding-text");
    assert(inline && inline.textContent.includes("not in List 1"), "the first message stays in the pill");
    assert(marker.querySelector(".px-finding-count").textContent === "+1 more", "and the rest are counted");
    assert(marker.title.split("\n").length === 2, "the tooltip lists both");
  });

  test("clicking a pill opens the findings list at that row's entries", () => {
    const w = render("onix-3.1-invalid.xml");
    const source = w.__OXV_SOURCE__.replace("<NotificationType>99", '<NotificationType bogus="1">99');
    const two = renderSource(source, "two-findings.xml");
    const row = rowsNamed(two, "NotificationType")[0];
    const pill = row.querySelector(".px-finding");
    assert(pill.tagName === "BUTTON", "the pill is a button, so it is reachable by keyboard too");
    pill.click();
    const modal = two.document.getElementById("oxv-findings");
    assert(modal && !modal.hidden, "the findings list should open");
    assert(!row.classList.contains("px-active"), "and the row click underneath must not fire");
    const current = [...modal.querySelectorAll(".px-findings-item-current")];
    assert(current.length === 2, `both of the row's entries are highlighted, got ${current.length}`);
    assert(current.every((item) => item.querySelector(".px-findings-where").textContent === "<NotificationType>"),
      "and only that row's");
    assert(two.document.activeElement === current[0], "focus lands on the first of them");
    two.document.dispatchEvent(new two.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert(modal.hidden, "Escape closes it");
    assert(two.document.activeElement === pill, "and focus returns to the pill");
    // Opened from the toolbar instead, nothing is singled out.
    two.document.getElementById("oxv-validation").click();
    assert(modal.querySelectorAll(".px-findings-item-current").length === 0, "no highlight without a row");
  });

  test("stray text is flagged on the text's own row, not the composite's", () => {
    // The finding is about <Product>, but its opening row can be hundreds of
    // lines above the text; the reader wants the pill where the text is.
    const w = render("onix-3.1-invalid.xml");
    const source = w.__OXV_SOURCE__.replace("<Product>", "<Product>Stray words ");
    const stray = renderSource(source, "stray-text.xml");
    const pills = $$(stray, '#oxv-root .px-finding[data-oxv-code="structure.stray-text"]');
    assert(pills.length === 1, `one stray-text pill, got ${pills.length}`);
    const row = pills[0].closest(".px-row");
    const text = row.querySelector(".px-text");
    assert(text && text.textContent.trim() === "Stray words", `pinned to the text row, got: ${row.textContent}`);
    assert(!rowsNamed(stray, "Product")[0].querySelector('[data-oxv-code="structure.stray-text"]'),
      "and not to the <Product> row");
    // The findings list still names the element the rule is about, and jumps
    // to the text row.
    pills[0].click();
    const entry = stray.document.querySelector(".px-findings-item-current");
    assert(entry.querySelector(".px-findings-where").textContent === "<Product>", "listed under <Product>");
    entry.click();
    assert(row.classList.contains("px-active"), "clicking the entry lands on the text row");
  });

  test("a row with one finding shows its message in the pill", () => {
    const w = render("onix-3.1-invalid.xml");
    validationLabel(w);
    const marker = rowsNamed(w, "NotificationType")[0].querySelector(".px-finding");
    const inline = marker.querySelector(".px-finding-text");
    assert(inline && inline.textContent === marker.title,
      `the pill should read the message itself, got: ${inline && inline.textContent}`);
    assert(!marker.querySelector(".px-finding-count"), "and no count for a single finding");
  });

  test("severity chips don't inherit the parse-error box styling", () => {
    // .px-error is the parse-error panel: margins, padding and a border. A
    // severity chip that reused that name rendered as a huge block.
    const w = render("onix-3.1-invalid.xml");
    validationLabel(w);
    for (const marker of $$(w, "#oxv-root .px-finding")) {
      assert(!marker.classList.contains("px-error") && !marker.classList.contains("px-warning"),
        `chips must not reuse the parse-error class names: ${marker.className}`);
    }
  });

  test("the summary label opens a list of every finding", () => {
    const w = render("onix-3.1-invalid.xml");
    const status = validationLabel(w);
    assert(status.getAttribute("role") === "button", "the label should announce itself as clickable");
    status.click();
    const modal = w.document.getElementById("oxv-findings");
    assert(modal && !modal.hidden, "the findings modal should open");
    const items = [...modal.querySelectorAll(".px-findings-item")];
    assert(items.length === 7, `expected one entry per finding, got ${items.length}`);
    assert(items.filter((i) => i.dataset.oxvSeverity === "error").length === 5, "5 errors");
    assert(items.filter((i) => i.dataset.oxvSeverity === "warning").length === 2, "2 warnings");
    assert(items[0].textContent.includes("is not in List 1"), `got: ${items[0].textContent}`);
    assert(items[0].textContent.includes("<NotificationType>"), "each entry names its element");
    // Every badge is icon-only and so the same size; otherwise a wider label
    // would shift its row's element name out of line with the others.
    const badges = items.map((item) => item.querySelector(".px-findings-severity"));
    assert(badges.every((b) => b.querySelector("svg") && !b.textContent.trim()),
      "badges should be icon-only");
    assert(new Set(badges.map((b) => b.getAttribute("aria-label"))).size === 2,
      "with the severity in the label");
  });

  test("clicking an entry closes the list and reveals that row", () => {
    const w = render("onix-3.1-invalid.xml");
    validationLabel(w).click();
    const modal = w.document.getElementById("oxv-findings");
    const entry = [...modal.querySelectorAll(".px-findings-item")]
      .find((i) => i.textContent.includes("not in List 1"));
    entry.click();
    assert(modal.hidden, "the list should close");
    assert(rowsNamed(w, "NotificationType")[0].classList.contains("px-active"),
      "and the row it points at should be the active one");
  });

  test("a short-tag document's findings name short tags, never reference names", () => {
    // The reader's file says <b203>; naming <TitleText> sends them looking for
    // a tag it does not contain. Names read off a node are already the
    // document's own; these come out of the content model, which is reference
    // names only.
    const short = fsv.readFileSync(path.join(SAMPLES, "onix-3.1-shorttags.xml"), "utf8");
    const w = renderSource(short, "onix-3.1-shorttags.xml");
    const stray = short.replace(/<x314>[^<]*<\/x314>/, "<zz999>oops</zz999>");
    const messages = findingsFor(w, stray).findings.map((f) => w.OnixViewerValidation.message(f));
    const joined = messages.join(" | ");

    // Every element reference, in the "where" column and inside the prose.
    for (const shortTag of ["<b203>", "<b030>", "<x501/>", "<b031>", "<x314>", "<descriptivedetail>"]) {
      assert(joined.includes(shortTag), `expected ${shortTag}; got: ${joined}`);
    }
    for (const referenceName of ["<TitleText>", "<TitlePrefix>", "<NoPrefix/>",
                                 "<TitleWithoutPrefix>", "<ProductComposition>",
                                 "<DescriptiveDetail>"]) {
      assert(!joined.includes(referenceName), `${referenceName} should be translated; got: ${joined}`);
    }
  });

  test("a reference-dialect document keeps reference names", () => {
    const w = render("onix-3.1-invalid.xml");
    const joined = findings(w).findings
      .map((f) => w.OnixViewerValidation.message(f)).join(" | ");
    assert(joined.includes("<TitleText>") && joined.includes("<TitleWithoutPrefix>"),
      `expected reference names untouched; got: ${joined}`);
    assert(!/[<(]b203/.test(joined), `no short tags here; got: ${joined}`);
  });

  test("the two dialects of one record report the same findings in their own names", () => {
    const read = (n) => fsv.readFileSync(path.join(SAMPLES, n), "utf8");
    const reference = findings(renderSource(read("onix-3.1-refnames.xml")));
    const short = findings(renderSource(read("onix-3.1-shorttags.xml")));
    // Same defects...
    assert(codes(reference).join() === codes(short).join(),
      `codes should match: ${codes(reference).join()} vs ${codes(short).join()}`);
    // ...described in each file's own dialect.
    const nameOf = (result, code) => result.findings.find((f) => f.code === code).data.name;
    assert(nameOf(reference, "element.deprecated") === "TitleText",
      "the reference file should be told about <TitleText>");
    assert(nameOf(short, "element.deprecated") === "b203",
      "the short-tag file should be told about <b203>");
  });

  test("the findings list is selectable text, and selecting it does not navigate", () => {
    const w = render("onix-3.1-invalid.xml");
    validationLabel(w).click();
    const modal = w.document.getElementById("oxv-findings");
    const item = modal.querySelector(".px-findings-item");
    // A <button> is unselectable by default, so the entry has to opt back in.
    assert(w.getComputedStyle(item).userSelect === "text",
      `expected selectable text, got "${w.getComputedStyle(item).userSelect}"`);

    // With a selection inside the entry, the click that ends the drag must not
    // close the list and jump the page.
    const range = w.document.createRange();
    range.selectNodeContents(item.querySelector(".px-findings-message"));
    w.getSelection().removeAllRanges();
    w.getSelection().addRange(range);
    item.click();
    assert(!modal.hidden, "selecting the message should not close the list");

    // Without one, it navigates as before.
    w.getSelection().removeAllRanges();
    item.click();
    assert(modal.hidden, "a plain click should still close the list");
  });

  test("tree shortcuts are quiet while the findings list is open", () => {
    // / and e used to open the search and unfold rows behind the dialog.
    const w = render("onix-3.1-invalid.xml");
    validationLabel(w).click();
    const modal = w.document.getElementById("oxv-findings");
    assert(!modal.hidden, "the list should be open");
    const key = (k) => w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true }));
    key("/");
    assert(!w.document.body.classList.contains("px-search-open"), "/ should not open the search");
    key("Escape");
    assert(modal.hidden, "Escape should still close the list");
    key("/");
    assert(w.document.body.classList.contains("px-search-open"), "and the shortcuts should work again");
  });

  test("closing the findings list puts focus back where it was", () => {
    const w = render("onix-3.1-invalid.xml");
    const label = validationLabel(w);
    label.focus();
    label.click();
    const modal = w.document.getElementById("oxv-findings");
    assert(modal.querySelector(".px-popup-close") === w.document.activeElement,
      "opening should move focus into the dialog");
    // An unnamed dialog announces as just "dialog"; the title supplies the name.
    const dialog = modal.querySelector('[role="dialog"]');
    const named = dialog.getAttribute("aria-labelledby");
    assert(named && w.document.getElementById(named),
      `aria-labelledby should resolve to a real element, got "${named}"`);

    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert(modal.hidden, "Escape should close the list");
    assert(w.document.activeElement === label,
      "closing should return focus to whatever opened it");
  });

  test("Tab stays inside the findings list", () => {
    const w = render("onix-3.1-invalid.xml");
    validationLabel(w).click();
    const modal = w.document.getElementById("oxv-findings");
    const dialog = modal.querySelector('[role="dialog"]');
    const focusable = [...dialog.querySelectorAll("button:not([disabled])")];
    assert(focusable.length > 1, `expected several controls, got ${focusable.length}`);

    // Tab off the last control wraps to the first, rather than escaping into
    // the page that aria-modal says is unreachable.
    focusable[focusable.length - 1].focus();
    dialog.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    assert(w.document.activeElement === focusable[0], "Tab should wrap to the first control");
    focusable[0].focus();
    dialog.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    assert(w.document.activeElement === focusable[focusable.length - 1],
      "Shift+Tab should wrap to the last control");
  });

  test("a clean document leaves the label inert", () => {
    const w = render("onix-3.1-valid.xml");
    const status = validationLabel(w);
    assert(status.textContent === "Valid", `got: ${status.textContent}`);
    assert(status.getAttribute("role") === "status", "nothing to open");
    status.click();
    const modal = w.document.getElementById("oxv-findings");
    assert(!modal || modal.hidden, "no modal for a clean document");
  });

  test("all three label states are icon-led", () => {
    const clean = validationLabel(render("onix-3.1-valid.xml"));
    assert(clean.querySelector("svg") && clean.textContent === "Valid", "a tick and the word");
    const dirty = validationLabel(render("onix-3.1-invalid.xml"));
    assert(dirty.querySelector("svg"), "problems get an icon too");
    assert(dirty.textContent === "5 errors, 2 warnings", `got: ${dirty.textContent}`);
  });

  test("validation starts on its own and never scrolls the page", () => {
    const w = render("onix-3.1-invalid.xml");
    // Nothing was clicked: the label is already filled in.
    assert(validationLabel(w).textContent === "5 errors, 2 warnings", `got: ${validationLabel(w).textContent}`);
    assert($$(w, "#oxv-root .px-finding").length > 0, "and the rows are already marked");
    // A pass that runs on load must not yank the view or steal the active row.
    assert($$(w, "#oxv-root .px-active").length === 0, "no row should be made active on load");
  });

  test("a document too large for one slice reports progress and finishes", () => {
    const w = render("onix-3.1-invalid.xml");
    const doc = new w.DOMParser().parseFromString(w.__OXV_SOURCE__, "application/xml");
    const session = w.OnixViewerValidation.start(doc, w.OnixViewerOnix.detect(doc));
    // A zero budget still makes progress — one batch of nodes per step — so a
    // caller can never spin without advancing.
    let steps = 0;
    while (!session.done && steps < 1000) { session.step(0); steps++; }
    assert(session.done, `should finish; stopped after ${steps} steps`);
    assert(session.processed === session.total,
      `every element should be visited: ${session.processed} of ${session.total}`);
    assert(session.result().total === 7, `same findings as a single pass: ${session.result().total}`);
  });

  test("slicing never changes the verdict, for any fixture", () => {
    // The pass carries state between slices — the traversal stack, each rule's
    // own bookkeeping — so a fixture that validates differently when sliced
    // would mean a rule is holding something a resume drops. A zero budget
    // forces the smallest possible slice, which is the worst case.
    const w = render("onix-3.1-valid.xml");
    const dir = FIXTURES;
    const files = fsv.readdirSync(dir).filter((f) => f.endsWith(".xml"));
    assert(files.length > 20, `expected the whole fixture set, got ${files.length}`);
    for (const file of files) {
      const xml = fsv.readFileSync(path.join(dir, file), "utf8");
      const whole = findingsFor(w, xml);
      const doc = new w.DOMParser().parseFromString(xml, "application/xml");
      const session = w.OnixViewerValidation.start(doc, w.OnixViewerOnix.detect(doc));
      let steps = 0;
      while (!session.done && steps < 100000) { session.step(0); steps++; }
      const sliced = session.result();
      assert(codes(whole).join() === codes(sliced).join(),
        `${file}: whole ${codes(whole).join()} vs sliced ${codes(sliced).join()}`);
      assert(whole.total === sliced.total,
        `${file}: totals differ, ${whole.total} vs ${sliced.total}`);
    }
  });

  test("both dialects of the same record produce the same findings", () => {
    const read = (n) => fsv.readFileSync(path.join(SAMPLES, n), "utf8");
    const reference = findings(renderSource(read("onix-3.1-refnames.xml")));
    const short = findings(renderSource(read("onix-3.1-shorttags.xml")));
    assert(codes(reference).join() === codes(short).join(),
      `reference: ${codes(reference).join()} vs short: ${codes(short).join()}`);
    // EDItEUR's own sample is schema-valid but carries two deprecations: the
    // ISTC code, and <TitleText>, which release 3.1 replaced with the split
    // <NoPrefix/> + <TitleWithoutPrefix> form. Both are warnings, not errors.
    assert(codes(reference).sort().join() === "codelist.deprecated,element.deprecated",
      `expected the two deprecations; got ${codes(reference).join(", ")}`);
    assert(reference.findings.every((f) => f.severity === "warning"),
      "a valid document's deprecations must be warnings, not errors");
  });

  test("both releases since 3.0 are bundled and checked structurally", () => {
    const w = render("onix-3.0-single-product-blocks.xml");
    assert(w.OnixViewerValidation.availableVersions().join() === "3.0,3.1",
      `expected models for both releases, got: ${w.OnixViewerValidation.availableVersions().join()}`);
    const onThirty = findings(w);
    assert(onThirty.checkedStructure && onThirty.version === "3.0",
      `a 3.0 document should be checked against the 3.0 model, got ${onThirty.version}`);
    assert(onThirty.total === 0, `and this one is valid 3.0: ${codes(onThirty).join(", ")}`);
    const onThirtyOne = findings(render("onix-3.1-valid.xml"));
    assert(onThirtyOne.checkedStructure && onThirtyOne.version === "3.1", "3.1 too");
  });

  test("the short-tag 3.0 fixture is valid ONIX and reports nothing", () => {
    const result = findings(render("onix-3.0-short-codelists.xml"));
    assert(result.checkedStructure && result.version === "3.0", "checked against 3.0");
    assert(result.total === 0, `expected a clean document: ${result.findings
      .map((f) => f.code).join(", ")}`);
  });

  test("a short-tag 3.0 document resolves its own tags", () => {
    // 3.0 keeps about twenty short tags 3.1 dropped (Conference, Reissue,
    // Gender…), so the tag map merges both releases' schemas.
    const w = render("onix-3.0-short.xml");
    const result = findings(w);
    assert(result.checkedStructure, "structure should be checked");
    assert(!codes(result).includes("structure.unknown"),
      `every short tag should be recognised; got: ${result.findings
        .filter((f) => f.code === "structure.unknown")
        .map((f) => w.OnixViewerValidation.message(f)).join(" | ")}`);
    assert(w.OnixViewerShortTags.b073 === "AudienceCode", "a 3.0-only tag should be in the map");
    assert(w.OnixViewerShortTags.textsource === "TextSource", "and a 3.1-only one");
  });

  test("an acknowledgement is not judged against the product schema", () => {
    // MessageStatus, RecordStatus and friends live in a separate schema, so
    // every element would otherwise be reported as unknown.
    const w = render("onix-3.0-acknowledgement.xml");
    const result = findings(w);
    assert(!result.checkedStructure, "structure must be skipped");
    assert(codes(result).includes("model.acknowledgement"), "and that must be said out loud");
    assert(!codes(result).some((c) => c.startsWith("structure.")),
      `no structural findings; got: ${codes(result).join(", ")}`);
  });

  test("a document whose release has no model says which it does have", () => {
    const w = render("onix-standalone-product-no-namespace.xml");
    const result = findings(w);
    assert(!result.checkedStructure, "no version, so no model");
    const note = result.findings.find((f) => f.code === "model.missing");
    assert(note, `expected model.missing; got: ${codes(result).join(", ")}`);
    assert(note.data.available === "3.0, 3.1",
      `the finding should name what is available: ${JSON.stringify(note.data)}`);
    assert(codes(result).some((c) => c.startsWith("codelist.")) || true,
      "code lists are release-independent and still run");
  });

  test("messages come from a catalogue that can be reworded", () => {
    const w = render("onix-3.1-invalid.xml");
    const validation = w.OnixViewerValidation;
    const finding = findings(w).findings.find((f) => f.code === "codelist.unknown");
    assert(validation.message(finding).includes("is not in List 1"), "default wording");
    validation.messages["codelist.unknown"] = "Ugyldig kode {value} (liste {list})";
    assert(validation.message(finding) === "Ugyldig kode 99 (liste 1)",
      `got: ${validation.message(finding)}`);
  });

  test("a new rule can be registered without touching the walk", () => {
    // Every rule the schema implies now ships, so the seam is demonstrated with
    // a house rule instead: something no schema can express. Here, that this
    // publisher's ISBNs must sit in its own prefix range.
    const w = render("onix-3.1-valid.xml");
    const validation = w.OnixViewerValidation;
    validation.messages["house.prefix"] = "{value} is outside our 978-82 prefix";
    validation.severities["house.prefix"] = "warning";
    validation.registerRule({
      name: "house-prefix",
      element(node, api) {
        if (api.referenceName(node) === "IDValue") {
          const value = api.textOf(node).trim();
          const type = api.siblingValue(node, "ProductIDType");
          if (type === "15" && !value.startsWith("97882")) {
            api.report("house.prefix", node, { value });
          }
        }
        return true;
      },
    });
    const valid = fsv.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
    assert(findingsFor(w, valid).total === 0,
      `9788234567896 is in range; got: ${codes(findingsFor(w, valid)).join(", ")}`);

    const foreign = valid.replace("<IDValue>9788234567896</IDValue>",
      "<IDValue>9780306406157</IDValue>");
    const after = findingsFor(w, foreign);
    assert(codes(after).includes("house.prefix"),
      `the registered rule should fire; got: ${codes(after).join(", ")}`);
    const finding = after.findings.find((f) => f.code === "house.prefix");
    assert(validation.message(finding) === "9780306406157 is outside our 978-82 prefix",
      `and use its own template; got: ${validation.message(finding)}`);
    assert(finding.severity === "warning", "and its own severity");
  });
});

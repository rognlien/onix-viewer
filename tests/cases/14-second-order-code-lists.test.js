const path = require("path");
const {
  test, describe, assert, render, renderSource, $$, meta, rowsNamed, badges, findingsFor, codes, shortTwin, FIXTURES,
} = require("../harness");

describe("Second-order code lists", () => {
  // <ProductFormFeatureValue> and its kin take their code from whichever
  // list the sibling type element selects. The strict schema spells these out
  // as assertions; here they are a table in onix.js, feeding the badge, the
  // popup and the validator alike.
  const FIXTURE = "onix-3.1-dependent-codelists.xml";
  const fsd = require("fs");
  const source = () => fsd.readFileSync(path.join(FIXTURES, FIXTURE), "utf8");

  function resolvedContexts(window) {
    return $$(window, "#oxv-root .px-codelist")
      .map((b) => b.title.replace(/: code resolved.*$/, ""))
      .filter((t) => t.includes(" when "));
  }

  test("a value resolves through the list its type sibling selects", () => {
    const w = render(FIXTURE);
    const labels = badges(w);
    const expect = [
      "Blue",                       // ProductFormFeatureType 01 → List 98
      "All non-decorative content supports reading without sight", // 09 → 196
      "Teenage",                    // AudienceCodeType 01 → List 28
      "Fifth Grade", "Eighth Grade", // AudienceRangeQualifier 11 → List 77, both values
      "Amazon",                     // SalesOutletIDType 03 → List 139
      "Yes, returnable, full copies only", // ReturnsCodeType 02 → List 66
    ];
    for (const label of expect) {
      assert(labels.some((l) => l.includes(label)), `no badge reading "${label}" in: ${labels.join(" | ")}`);
    }
  });

  test("an EUDR location reads the country from the value's first token only", () => {
    const w = render(FIXTURE);
    const rows = rowsNamed(w, "ProductFormFeatureValue");
    const eudr = rows.find((r) => r.textContent.includes("Picea abies"));
    assert(eudr, "the EUDR row should render");
    const badge = eudr.querySelector(".px-codelist");
    assert(badge && badge.textContent.includes("Norway"), `expected Norway, got ${badge && badge.textContent}`);
  });

  test("a type that selects no list leaves its value plain", () => {
    const w = render(FIXTURE);
    // Type 07 (system requirements) takes free text, and the IDValue of a
    // ProductIdentifier has no SalesOutletIDType sibling to consult.
    const contexts = resolvedContexts(w);
    assert(!contexts.some((c) => c.endsWith("is 07")), `type 07 should not resolve: ${contexts}`);
    const isbnRow = rowsNamed(w, "IDValue").find((r) => r.textContent.includes("9788234567896"));
    assert(isbnRow && !isbnRow.querySelector(".px-codelist"), "the ISBN's IDValue must carry no badge");
  });

  test("the badge links to the selected list and its popup names the selector", () => {
    const w = render(FIXTURE);
    const links = $$(w, "#oxv-root .px-codelist-link");
    const list196 = links.find((a) => a.getAttribute("href") === "https://ns.editeur.org/onix/en/196");
    assert(list196, "no link to List 196");
    assert(list196.textContent.startsWith("List 196"), `link text: ${list196.textContent}`);
    list196.click();
    const popup = w.document.querySelector(".px-popup");
    assert(popup, "the popup should open");
    const title = popup.querySelector("#px-popup-title").textContent;
    assert(title === "E-publication Accessibility Details", `popup title: ${title}`);
    const eyebrow = popup.querySelector(".px-popup-eyebrow").textContent;
    assert(eyebrow === "List 196 · ProductFormFeatureValue when ProductFormFeatureType is 09",
      `eyebrow: ${eyebrow}`);
    assert(popup.querySelectorAll(".px-popup-row, [data-code]").length > 0 || popup.textContent.includes("52"),
      "the popup should list the codes");
  });

  test("a code outside the selected list still gets the list chip, without a label", () => {
    const w = renderSource(source().replace("<ProductFormFeatureValue>52", "<ProductFormFeatureValue>XX"), "dependent-bad.xml");
    const row = rowsNamed(w, "ProductFormFeatureValue").find((r) => r.textContent.includes("XX"));
    assert(row, "the row with the bad code should render");
    assert(!row.querySelector(".px-codelist"), "an unknown code must not get a label badge");
    const link = row.querySelector(".px-codelist-link");
    assert(link && link.textContent.startsWith("List 196"), `expected a List 196 chip, got ${link && link.textContent}`);
    assert(link.getAttribute("href") === "https://ns.editeur.org/onix/en/196");
    link.click();
    const eyebrow = w.document.querySelector(".px-popup-eyebrow");
    assert(eyebrow && eyebrow.textContent.includes("when ProductFormFeatureType is 09"),
      `the popup should still name the selector: ${eyebrow && eyebrow.textContent}`);
  });

  test("resolves in short-tag dialect, naming the selector the document's way", () => {
    const w = render(FIXTURE);
    const short = renderSource(shortTwin(w, source()), "dependent-short.xml");
    assert(meta(short).includes("short tags"), `expected a short-tag document, got ${meta(short)}`);
    const contexts = resolvedContexts(short);
    assert(contexts.includes("b335 when b334 is 09"), `contexts: ${contexts.join(" | ")}`);
    assert(badges(short).length === badges(w).length,
      `short dialect resolved ${badges(short).length} badges, reference ${badges(w).length}`);
  });

  // ---- validation ----

  test("validation: the fixture is clean, in both dialects", () => {
    const w = render(FIXTURE);
    const reference = findingsFor(w, source());
    assert(reference.total === 0, `reference: ${codes(reference).join(", ")}`);
    const short = findingsFor(w, shortTwin(w, source()));
    assert(short.total === 0, `short: ${codes(short).join(", ")}`);
  });

  test("validation: a code outside the selected list is reported, naming the selector", () => {
    const w = render(FIXTURE);
    const bad = findingsFor(w, source().replace("<ProductFormFeatureValue>52", "<ProductFormFeatureValue>XX"));
    assert(codes(bad).join() === "codelist.dependent", `got: ${codes(bad).join(", ")}`);
    const text = w.OnixViewerValidation.message(bad.findings[0]);
    assert(text === '"XX" is not in List 196 (E-publication Accessibility Details), which applies when <ProductFormFeatureType> is 09',
      `message: ${text}`);
    assert(bad.findings[0].severity === "error", "a code outside the list is a schema violation");
  });

  test("validation: the finding is worded in the document's dialect", () => {
    const w = render(FIXTURE);
    const short = shortTwin(w, source()).replace("<b335>52", "<b335>XX");
    const bad = findingsFor(w, short);
    const text = w.OnixViewerValidation.message(bad.findings[0]);
    assert(text.includes("when <b334> is 09"), `message: ${text}`);
  });

  test("validation: a deprecated code in a selected list is a warning", () => {
    const w = render(FIXTURE);
    const bad = findingsFor(w, source().replace("<IDValue>AMZ", "<IDValue>POK"));
    assert(codes(bad).join() === "codelist.deprecated", `got: ${codes(bad).join(", ")}`);
    assert(bad.findings[0].severity === "warning");
    assert(w.OnixViewerValidation.message(bad.findings[0]).includes("List 139"));
  });

  test("validation: an EUDR location is judged on its country code alone", () => {
    const w = render(FIXTURE);
    const bad = findingsFor(w, source().replace("NO Picea abies", "XX Picea abies"));
    assert(codes(bad).join() === "codelist.dependent", `got: ${codes(bad).join(", ")}`);
    assert(w.OnixViewerValidation.message(bad.findings[0]).startsWith('"XX" is not in List 91'));
  });

  test("validation: a value under an unmapped type is not judged", () => {
    const w = render(FIXTURE);
    // Type 07's value is free text; "zzz" is fine there.
    const doc = source().replace("<ProductFormFeatureValue>01</ProductFormFeatureValue>",
      "<ProductFormFeatureValue>zzz</ProductFormFeatureValue>");
    assert(findingsFor(w, doc).total === 0);
  });

  test("every entry in the table names a bundled list and modelled elements with short tags", () => {
    const w = render(FIXTURE);
    const onix = w.OnixViewerOnix;
    const model = w.OnixViewerContentModels["3.1"];
    const numbered = w.OnixViewerCodeListsByNumber;
    // Reach the table through its own lookup: one element per row, with a
    // synthetic type sibling, so the test needs no export of the table itself.
    const rows = [
      ["ProductFormFeatureValue", "ProductFormFeatureType", ["01", "02", "26", "27", "55", "57", "58", "59", "04", "05", "06", "09", "12", "13", "15", "19", "21", "41", "42", "43", "44", "45", "46", "47", "48", "49"]],
      ["AudienceCodeValue", "AudienceCodeType", ["01", "22"]],
      ["AudienceRangeValue", "AudienceRangeQualifier", ["11", "26", "29", "31"]],
      ["ReturnsCode", "ReturnsCodeType", ["02", "04"]],
      ["ReligiousTextFeatureCode", "ReligiousTextFeatureType", ["01"]],
      ["IDValue", "SalesOutletIDType", ["03"]],
      ["FeatureValue", "ResourceFeatureType", ["09"]],
      ["FeatureValue", "ResourceVersionFeatureType", ["01"]],
      ["ResourceFileFeatureValue", "ResourceFileFeatureType", ["01"]],
      ["SpecificationFeatureValue", "SpecificationFeatureType", ["43", "45"]],
    ];
    const seen = new Set();
    for (const [valueName, typeName, typeCodes] of rows) {
      for (const name of [valueName, typeName]) {
        assert(model.elements[name], `<${name}> is not in the 3.1 model`);
        assert(onix.translatedName(name, "short"), `<${name}> has no short tag`);
      }
      for (const code of typeCodes) {
        const doc = new w.DOMParser().parseFromString(
          `<x><${typeName}>${code}</${typeName}><${valueName}>?</${valueName}></x>`, "application/xml");
        const dependent = onix.dependentCodelist(doc.documentElement.lastElementChild);
        assert(dependent, `<${typeName}> ${code} selects no list`);
        assert(numbered[dependent.listNumber], `List ${dependent.listNumber} is not bundled`);
        seen.add(dependent.listNumber);
      }
    }
    // Graham Bell's list of the second-order code lists the strict schema
    // enforces, from the schema's own change log.
    const strict = [28, 66, 76, 77, 90, 91, 98, 99, 139, 143, 176, 178, 184, 196, 203, 204, 220, 227, 238, 242, 243, 256, 257, 258, 262];
    const missing = strict.filter((n) => !seen.has(n));
    assert(missing.length === 0, `second-order lists never selected: ${missing.join(", ")}`);
  });
});

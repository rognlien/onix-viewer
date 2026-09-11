const fs = require("fs");
const path = require("path");
const {
  test, describe, assert, render, badges, ROOT,
} = require("../harness");

describe("Short-tag code lists", () => {
  test("code lists the hand-kept map used to miss now resolve", () => {
    const w = render("onix-3.0-short-codelists.xml");
    const found = badges(w);
    for (const label of ["→ Language of text", "→ Norwegian Bokmål", "→ Active",
                         "→ Proprietary name ID scheme", "→ RRP including tax"]) {
      assert(found.includes(label), `missing ${label}; got: ${found.join(" | ")}`);
    }
  });

  test("the short-tag map is generated, not a hand-kept subset", () => {
    const w = render("onix-3.0-short-codelists.xml");
    const pairs = w.OnixViewerShortTags;
    assert(pairs && Object.keys(pairs).length > 400,
      `expected the generated short-tag map, got ${pairs ? Object.keys(pairs).length : 0} pairs`);
    // Every key is lower-cased, because both lookups use name.toLowerCase().
    const mixed = Object.keys(pairs).filter((k) => k !== k.toLowerCase());
    assert(mixed.length === 0, `keys must be lower-cased, found: ${mixed.join(", ")}`);
    assert(pairs.onixmessage === "ONIXMessage", "the one mixed-case tag must still be reachable");
  });

  // The generated map used to be scraped out of the schema with a regex that
  // required name="x" to be the declaration's last attribute, so <xs:element
  // name="x512" default="C"> was skipped and CopyrightType had no short tag.
  // Reading the schema as XML makes that structurally impossible; this checks
  // the whole set rather than the one tag that exposed it.
  test("every element declared in the short schemas has a short-tag pair", () => {
    const { JSDOM: SchemaDOM } = require("jsdom");
    const XS = "http://www.w3.org/2001/XMLSchema";
    const pairs = render("onix-3.0-short-codelists.xml").OnixViewerShortTags;
    const missing = [];
    for (const file of ["ONIX_BookProduct_3.1_short.xsd", "ONIX_BookProduct_3.0_short.xsd"]) {
      const xsd = fs.readFileSync(path.join(ROOT, "tools", "data", file), "utf8");
      const doc = new (new SchemaDOM().window.DOMParser)().parseFromString(xsd, "application/xml");
      const declared = [...doc.getElementsByTagNameNS(XS, "element")]
        .filter((el) => el.parentNode === doc.documentElement && el.getAttribute("name"))
        .map((el) => el.getAttribute("name").toLowerCase());
      for (const tag of declared) if (!pairs[tag]) missing.push(`${file}:${tag}`);
    }
    assert(missing.length === 0, `short tags absent from the map: ${missing.join(", ")}`);
  });

  test("x512 (CopyrightType) resolves its code list in short dialect", () => {
    const w = render("onix-3.0-short-codelists.xml");
    assert(w.OnixViewerOnix.translatedName("x512", "reference") === "CopyrightType",
      "x512 should translate to CopyrightType");
    assert(w.OnixViewerCodeListMeta.CopyrightType,
      "CopyrightType should carry a code-list binding");
  });

  test("every code-list-bound element with a short tag resolves in short dialect", () => {
    const w = render("onix-3.0-short-codelists.xml");
    const pairs = w.OnixViewerShortTags;
    const reverse = Object.create(null);
    for (const [short, ref] of Object.entries(pairs)) if (!reverse[ref]) reverse[ref] = short;
    const unresolved = Object.keys(w.OnixViewerCodeLists)
      .filter((ref) => reverse[ref] && pairs[reverse[ref]] !== ref);
    assert(unresolved.length === 0, `unlabelled in short dialect: ${unresolved.join(", ")}`);
  });

  test("ONIX 2.1-era short tags are still mapped alongside their 3.1 replacements", () => {
    const w = render("onix-3.0-short.xml");
    // b005/b332 are absent from the 3.1 schema; b253/b394 are its replacements.
    assert(w.OnixViewerShortTags.b253 === "LanguageRole", "3.1 tag should come from the schema");
    assert(w.OnixViewerShortTags.b394 === "PublishingStatus", "3.1 tag should come from the schema");
    assert(w.OnixViewerShortTags.b005 === undefined, "2.1 tags are not in the generated map");
  });
});

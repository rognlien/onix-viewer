const path = require("path");
const {
  test, describe, assert, render, renderSource, rowsNamed, stubClipboard, FIXTURES, SAMPLES,
} = require("../harness");

describe("Copying the displayed dialect", () => {
  const fs2 = require("fs");
  function flip(window) {
    window.document.querySelector('[data-action="dialect-toggle"]').click();
  }
  function copyAll(window) {
    const copied = stubClipboard(window);
    window.document.querySelector('[data-action="copy-xml"]').click();
    return copied;
  }
  function elementNames(xml) {
    return new Set([...xml.matchAll(/<([A-Za-z][A-Za-z0-9]*)[\s>/]/g)].map((m) => m[1]));
  }

  test("untranslated, Copy XML still hands over the source byte for byte", () => {
    const w = render("onix-3.0-short-codelists.xml");
    const source = fs2.readFileSync(path.join(FIXTURES, "onix-3.0-short-codelists.xml"), "utf8");
    assert(copyAll(w).text === source, "an untouched view must copy the file unchanged");
  });

  test("translated, Copy XML hands over the converted document", () => {
    const w = render("onix-3.0-short-codelists.xml");
    flip(w);
    const xml = copyAll(w).text;
    assert(xml.includes("<ProductIdentifier>"), `expected reference names, got: ${xml.slice(0, 200)}`);
    assert(xml.includes("<LanguageRole>01</LanguageRole>"), "data elements should translate too");
    assert(!/<b221>|<b253>|<productidentifier>/.test(xml), "no short tags should remain");
    assert(xml.includes('xmlns="http://ns.editeur.org/onix/3.0/reference"'),
      "the namespace must follow the dialect, or the copy isn't valid ONIX");
    assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'),
      "the XML declaration should be carried across");
    assert(xml.includes("<!-- Short dialect"), "comments should survive");
  });

  test("translated, Copy node XML hands over the converted subtree", () => {
    const w = render("onix-3.0-short-codelists.xml");
    flip(w);
    const row = rowsNamed(w, "ProductIdentifier")[0];
    const copied = stubClipboard(w);
    row.querySelector(".px-node-menu-btn").click();
    w.document.querySelector('[data-node-action="copy-xml"]').click();
    assert(copied.text.startsWith("<ProductIdentifier>"), `got: ${copied.text}`);
    assert(copied.text.includes("<ProductIDType>15</ProductIDType>"), `got: ${copied.text}`);
    // A subtree that inherited the namespace still shouldn't gain one.
    assert(!copied.text.includes("xmlns="), `subtree should not declare a namespace: ${copied.text}`);
  });

  test("converting the real sample reproduces the reference-dialect file", () => {
    // Onix/ holds one record supplied in both dialects — an exact oracle.
    const shortFile = fs2.readFileSync(path.join(SAMPLES, "onix-3.1-shorttags.xml"), "utf8");
    const referenceFile = fs2.readFileSync(path.join(SAMPLES, "onix-3.1-refnames.xml"), "utf8");
    const w = renderSource(shortFile);
    flip(w);
    const converted = copyAll(w).text;
    const produced = elementNames(converted);
    const expected = elementNames(referenceFile);
    const missing = [...expected].filter((n) => !produced.has(n));
    const extra = [...produced].filter((n) => !expected.has(n));
    assert(missing.length === 0, `names missing from the conversion: ${missing.join(", ")}`);
    assert(extra.length === 0, `names the conversion invented: ${extra.join(", ")}`);
    assert(converted.includes('xmlns="http://ns.editeur.org/onix/3.1/reference"'),
      "converted document should carry the reference namespace");
    // XHTML inside textformat="05" content is not ONIX and must be left alone.
    assert(converted.includes("<p><strong>Maj Sjöwall</strong>"), "inline XHTML should be untouched");
  });

  test("the reverse conversion reproduces the short-tag file", () => {
    const shortFile = fs2.readFileSync(path.join(SAMPLES, "onix-3.1-shorttags.xml"), "utf8");
    const referenceFile = fs2.readFileSync(path.join(SAMPLES, "onix-3.1-refnames.xml"), "utf8");
    const w = renderSource(referenceFile);
    flip(w);
    const converted = copyAll(w).text;
    const produced = elementNames(converted);
    const expected = elementNames(shortFile);
    const missing = [...expected].filter((n) => !produced.has(n));
    const extra = [...produced].filter((n) => !expected.has(n));
    assert(missing.length === 0, `names missing from the conversion: ${missing.join(", ")}`);
    assert(extra.length === 0, `names the conversion invented: ${extra.join(", ")}`);
    assert(converted.includes('xmlns="http://ns.editeur.org/onix/3.1/short"'),
      "converted document should carry the short namespace");
    assert(converted.includes("<ONIXmessage "), "the root should use the short spelling");
  });

  test("returning to the source dialect hands back the untouched source", () => {
    const w = render("onix-3.0-short-codelists.xml");
    const source = fs2.readFileSync(path.join(FIXTURES, "onix-3.0-short-codelists.xml"), "utf8");
    flip(w);
    flip(w);
    assert(copyAll(w).text === source, "back at the source dialect, the copy is the file itself");
  });
});

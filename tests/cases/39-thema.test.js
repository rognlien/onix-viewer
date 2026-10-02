const fs = require("fs");
const path = require("path");
const {
  test, describe, assert, renderSource, rowsNamed, findingsFor, codes, shortTwin, FIXTURES, ROOT,
} = require("../harness");

describe("Thema", () => {
  // A <SubjectCode> under one of the seven Thema schemes, 93 to 99, resolves
  // through onix-thema.js: a heading badge, a "Thema 1.6" chip that opens the
  // scheme in the popup, and a warning for a code Thema does not have.
  const valid = fs.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");

  function subject(scheme, code) {
    return `<Subject><SubjectSchemeIdentifier>${scheme}</SubjectSchemeIdentifier>` +
      `<SubjectSchemeVersion>1.3</SubjectSchemeVersion><SubjectCode>${code}</SubjectCode></Subject>`;
  }

  function withSubjects(...subjects) {
    return valid.replace("</DescriptiveDetail>", `${subjects.join("")}</DescriptiveDetail>`);
  }

  function subjectRow(window, code) {
    return rowsNamed(window, "SubjectCode").concat(rowsNamed(window, "b069"))
      .find((row) => row.textContent.includes(code));
  }

  test("a subject category resolves to its heading, with a Thema chip", () => {
    const w = renderSource(withSubjects(subject("93", "FYT")), "thema.xml");
    const row = subjectRow(w, "FYT");
    const badge = row.querySelector(".px-codelist");
    assert(badge && badge.textContent.includes("Fiction in translation"), `badge: ${badge && badge.textContent}`);
    assert(badge.title === "SubjectCode when SubjectSchemeIdentifier is 93: code resolved via Thema 1.6",
      `title: ${badge.title}`);
    const link = row.querySelector(".px-codelist-link");
    assert(link.textContent.startsWith("Thema 1.6"), `chip: ${link.textContent}`);
    assert(link.getAttribute("href") === "https://ns.editeur.org/thema/en/FYT", `href: ${link.getAttribute("href")}`);
  });

  test("each qualifier scheme resolves through its own family", () => {
    const w = renderSource(withSubjects(
      subject("94", "1DNN"), subject("95", "2ACSN"), subject("96", "3MPBF"),
      subject("97", "4Z-NO-"), subject("98", "5AN"), subject("99", "6AA")), "thema-qualifiers.xml");
    const expected = {
      "1DNN": "Norway", "2ACSN": "Norwegian", "3MPBF": "c 1910 to c 1919",
      "4Z-NO-": "For the educational curriculum of Norway", "5AN": "Interest age: from c 12 years",
      "6AA": "Abstractism",
    };
    for (const [code, heading] of Object.entries(expected)) {
      const badge = subjectRow(w, code).querySelector(".px-codelist");
      assert(badge && badge.textContent.includes(heading), `${code}: ${badge && badge.textContent}`);
    }
  });

  test("the short-tag dialect resolves the same codes", () => {
    const probe = renderSource(valid, "probe.xml");
    const short = shortTwin(probe, withSubjects(subject("93", "FYT")));
    const w = renderSource(short, "thema-short.xml");
    const badge = subjectRow(w, "FYT").querySelector(".px-codelist");
    assert(badge && badge.textContent.includes("Fiction in translation"), `badge: ${badge && badge.textContent}`);
    assert(badge.title.startsWith("b069 when b067 is 93"), `title: ${badge.title}`);
  });

  test("a scheme that is not Thema leaves the code plain", () => {
    const w = renderSource(withSubjects(subject("10", "FIC000000")), "bisac.xml");
    const row = subjectRow(w, "FIC000000");
    assert(!row.querySelector(".px-codelist") && !row.querySelector(".px-codelist-link"), "BISAC is not bundled");
  });

  test("the chip opens the scheme in the popup, the code highlighted", () => {
    const w = renderSource(withSubjects(subject("93", "FYT")), "thema-popup.xml");
    subjectRow(w, "FYT").querySelector(".px-codelist-link").click();
    const popup = w.document.querySelector(".px-popup");
    assert(popup.querySelector("#px-popup-title").textContent === "Thema subject category", "title");
    const eyebrow = popup.querySelector(".px-popup-eyebrow").textContent;
    assert(eyebrow === "Thema 1.6 · SubjectCode when SubjectSchemeIdentifier is 93", `eyebrow: ${eyebrow}`);
    const current = popup.querySelector(".px-popup-row-current");
    assert(current && current.textContent.startsWith("FYT"), `current: ${current && current.textContent}`);
  });

  test("a code Thema lacks is a warning, and keeps a chip to the scheme", () => {
    const xml = withSubjects(subject("93", "1DNN"));
    const w = renderSource(xml, "thema-bad.xml");
    const row = subjectRow(w, "1DNN");
    assert(!row.querySelector(".px-codelist"), "a qualifier is no subject category");
    const link = row.querySelector(".px-codelist-link");
    assert(link && link.getAttribute("href") === "https://ns.editeur.org/thema/en", "the chip links to Thema itself");
    const result = findingsFor(w, xml);
    assert(codes(result).join() === "codelist.thema", `codes: ${codes(result)}`);
    assert(w.OnixViewerValidation.severity(result.findings[0]) === "warning", "Thema grows; an unknown code warns");
    const message = w.OnixViewerValidation.message(result.findings[0]);
    assert(message === "\"1DNN\" is not a code in Thema 1.6 (Thema subject category), which applies " +
      "when <SubjectSchemeIdentifier> is 93", `message: ${message}`);
  });

  test("known Thema codes add no findings", () => {
    const xml = withSubjects(subject("93", "FYT"), subject("94", "1DNN"), subject("99", "6AA"));
    const w = renderSource(xml, "thema-valid.xml");
    assert(findingsFor(w, xml).findings.length === 0, `codes: ${codes(findingsFor(w, xml))}`);
  });

  test("the generated table holds every code once, each in the scheme its first character names", () => {
    const w = renderSource(valid, "thema-table.xml");
    const thema = w.OnixViewerThema;
    const families = { 93: /^[A-Z]/, 94: /^1/, 95: /^2/, 96: /^3/, 97: /^4/, 98: /^5/, 99: /^6/ };
    let total = 0;
    for (const [scheme, family] of Object.entries(families)) {
      const codesInScheme = [...thema.schemes[scheme].keys()];
      assert(codesInScheme.length > 0, `scheme ${scheme} is empty`);
      assert(codesInScheme.every((code) => family.test(code)), `scheme ${scheme} holds a stranger`);
      total += codesInScheme.length;
    }
    const source = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "data", "thema-codes.json"), "utf8"));
    assert(total === source.CodeList.ThemaCodes.Code.length, `${total} codes generated`);
    assert(thema.version === String(source.CodeList.IssueNumber), `version ${thema.version}`);
  });
});

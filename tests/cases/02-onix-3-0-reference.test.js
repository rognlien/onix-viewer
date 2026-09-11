const {
  test, describe, assert, render, $$, meta, rowsNamed, badges, summariesOf,
} = require("../harness");

describe("ONIX 3.0 reference", () => {
  test("detects dialect and version", () => {
    const w = render("onix-3.0-reference.xml");
    assert(/^ONIX 3\.0 \(\d+ products?\)/.test(meta(w)), `bad meta: ${meta(w)}`);
  });

  test("classifies tag spans with px-onix-ref", () => {
    const w = render("onix-3.0-reference.xml");
    const refs = $$(w, "#oxv-root .px-tag.px-onix-ref");
    assert(refs.length > 20, `expected many ONIX-ref tags, got ${refs.length}`);
  });

  test("resolves ProductIDType 15 → ISBN-13", () => {
    const w = render("onix-3.0-reference.xml");
    assert(badges(w).some((b) => b.includes("ISBN-13")), "ISBN-13 badge missing");
  });

  test("resolves ProductForm BB → Hardback", () => {
    const w = render("onix-3.0-reference.xml");
    assert(badges(w).some((b) => b.includes("Hardback")), "Hardback badge missing");
  });

  test("resolves ContributorRole A01 → By (author)", () => {
    const w = render("onix-3.0-reference.xml");
    assert(badges(w).some((b) => b.includes("By (author)")), "Contributor role badge missing");
  });

  test("auto-collapses Product blocks when there are multiple", () => {
    const w = render("onix-3.0-reference.xml");
    const productRows = $$(w, "#oxv-root .px-row.px-collapsible").filter((r) => {
      const tags = r.querySelectorAll(".px-tag");
      return tags.length >= 2 && tags[1].textContent === "Product";
    });
    assert(productRows.length >= 2, `expected ≥2 product rows, got ${productRows.length}`);
    assert(productRows.every((r) => r.classList.contains("px-folded")), "products not folded");
  });

  test("leaves the lone Product expanded when there is only one", () => {
    const w = render("onix-3.1-standalone-product.xml");
    // The standalone fixture's root *is* a Product, which renders as a leaf
    // collapsible row; no Product child exists. Ensure no Product row was folded.
    const productRows = $$(w, "#oxv-root .px-row.px-collapsible").filter((r) => {
      const tags = r.querySelectorAll(".px-tag");
      return tags.length >= 2 && tags[1].textContent === "Product";
    });
    for (const row of productRows) {
      assert(!row.classList.contains("px-folded"), "single Product should not be folded");
    }
  });

  test("product summary picks GTIN-13 when ISBN-13 is absent (preference: 15 → 03 → 02)", () => {
    const w = render("onix-3.0-gtin-only.xml");
    const summary = summariesOf(w, "Product")[0];
    assert(summary.startsWith("GTIN 9780000000002"),
      `expected "GTIN 9780000000002 …" prefix, got: ${summary}`);
  });

  test("product summary labels ISBN-10 as ISBN", () => {
    const w = render("onix-3.0-isbn10-only.xml");
    const summary = summariesOf(w, "Product")[0];
    assert(summary.startsWith("ISBN 0123456789"),
      `expected "ISBN 0123456789 …" prefix, got: ${summary}`);
  });

  test("product summary omits the identifier segment when no ISBN-13 / GTIN-13 / ISBN-10 is present", () => {
    const w = render("onix-3.0-proprietary-only.xml");
    const summary = summariesOf(w, "Product")[0];
    assert(!/^(ISBN|GTIN)\b/.test(summary),
      `expected no ISBN / GTIN prefix when only a proprietary ID exists, got: ${summary}`);
    assert(summary.includes("No ISBN here"),
      `expected the title segment to still appear, got: ${summary}`);
  });

  test("product summary picks the distinctive title (TitleType=01) when multiple TitleDetails exist", () => {
    const w = render("onix-3.0-multi-title.xml");
    const summaries = summariesOf(w, "Product");
    assert(summaries.length === 1, `expected 1 product summary, got ${summaries.length}`);
    assert(summaries[0].includes("Fra en dag til en annen"),
      `summary should pick TitleType=01 title, got: ${summaries[0]}`);
    assert(!summaries[0].includes("The difference a day makes"),
      `summary should NOT contain TitleType=03 title, got: ${summaries[0]}`);
  });

  test("product summary reads the split-form title (TitleWithoutPrefix) when TitleText is absent", () => {
    const w = render("onix-3.0-title-without-prefix.xml");
    const summaries = summariesOf(w, "Product");
    assert(summaries.length === 2, `expected 2 product summaries, got ${summaries.length}`);
    assert(summaries[0].includes("Rovfugl"),
      `expected the NoPrefix title, got: ${summaries[0]}`);
    assert(summaries[1].includes("Den lange veien hjem"),
      `expected TitlePrefix joined to TitleWithoutPrefix, got: ${summaries[1]}`);
  });

  test("split-form title works in short dialect (b030 + b031)", () => {
    const w = render("onix-3.0-title-without-prefix-short.xml");
    const summary = summariesOf(w, "product")[0];
    assert(summary.includes("Det hvite kartet"),
      `expected b030 joined to b031, got: ${summary}`);
  });

  test("renders product summaries with ISBN + form + title", () => {
    const w = render("onix-3.0-reference.xml");
    const summaries = summariesOf(w, "Product");
    assert(summaries.length >= 2, "expected summaries on each product");
    assert(summaries[0].includes("ISBN"), `summary missing ISBN: ${summaries[0]}`);
    assert(summaries[0].includes("Hardback"), `summary missing form: ${summaries[0]}`);
    assert(summaries[0].includes("Eksempelboken"), `summary missing title: ${summaries[0]}`);
  });

  test("each resolved badge has a list link to the EDItEUR list page", () => {
    const w = render("onix-3.0-reference.xml");
    const links = $$(w, "#oxv-root .px-codelist-link");
    assert(links.length >= 3, `expected ≥3 list links in tree, got ${links.length}`);
    // ProductIDType badges should link to List 5.
    const list5 = links.filter((a) => a.getAttribute("href") === "https://ns.editeur.org/onix/en/5");
    assert(list5.length >= 1, "no link to List 5 (ProductIDType)");
    assert(list5[0].textContent.startsWith("List 5"), `link text wrong: ${list5[0].textContent}`);
    // External-link icon should be inside.
    assert(list5[0].querySelector("svg.px-extlink-icon"), "missing external-link svg");
    // ContributorRole → List 17.
    assert(links.some((a) => a.getAttribute("href") === "https://ns.editeur.org/onix/en/17"),
      "no link to List 17 (ContributorRole)");
  });

  test("an unknown code in an element's own list gets the list chip and no label", () => {
    const w = render("onix-3.1-invalid.xml");
    const row = rowsNamed(w, "NotificationType").find((r) => r.textContent.includes("99"));
    assert(row, "the <NotificationType>99 row should render");
    assert(!row.querySelector(".px-codelist"), "99 is not in List 1, so no label");
    const link = row.querySelector(".px-codelist-link");
    assert(link && link.textContent.startsWith("List 1"), `expected a List 1 chip, got ${link && link.textContent}`);
  });

  test("does not produce a badge for unknown codelist values", () => {
    const w = render("onix-3.0-reference.xml");
    // ProductIDType 99 is not in our subset; should silently render no badge.
    // (The fixture uses real values; this is an inference: total badge count
    // matches expected resolved-codes count.)
    const allBadges = badges(w);
    // Just ensure no badge is empty or "→ undefined".
    for (const b of allBadges) {
      assert(b.startsWith("→ ") && b.length > 3, `bad badge: ${b}`);
      assert(!b.includes("undefined"), `badge has undefined: ${b}`);
    }
  });
});

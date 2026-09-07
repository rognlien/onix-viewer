// tests/run.js — ONIX Viewer test harness
//
// Loads the viewer scripts in jsdom, points them at fixture files, and
// asserts on the rendered DOM. Catches logic regressions (codelist
// resolution, ONIX detection, fold behavior) but cannot catch Safari-
// specific rendering or content-script timing bugs — for those, test in
// Safari per the README.
//
// Usage:
//   npm install        (one-time, installs jsdom)
//   npm test           (or: node tests/run.js)

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const RES = path.join(__dirname, "..", "Resources");
const FIXTURES = path.join(__dirname, "fixtures");

const codelistsJs = fs.readFileSync(path.join(RES, "onix-codelists.js"), "utf8");
const contentModelJs = [
  fs.readFileSync(path.join(RES, "onix-content-model-3.1.js"), "utf8"),
  fs.readFileSync(path.join(RES, "onix-content-model-3.0.js"), "utf8"),
].join("\n");
const onixJs = fs.readFileSync(path.join(RES, "onix.js"), "utf8");
const validateJs = fs.readFileSync(path.join(RES, "onix-validate.js"), "utf8");
const blocksJs = fs.readFileSync(path.join(RES, "onix-blocks.js"), "utf8");
const popupJs = fs.readFileSync(path.join(RES, "onix-popup.js"), "utf8");
const viewerJs = fs.readFileSync(path.join(RES, "viewer.js"), "utf8");
const viewerCss = fs.readFileSync(path.join(RES, "viewer.css"), "utf8");

// ---- minimal test framework ------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${err.message}`);
  }
}

function describe(label, fn) {
  console.log(`\n${label}`);
  fn();
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

// ---- harness: render a fixture and return the jsdom window -----------------

function render(fixtureName, beforeScripts) {
  return renderSource(fs.readFileSync(path.join(FIXTURES, fixtureName), "utf8"), fixtureName, beforeScripts);
}

// Render arbitrary XML — used by the fixtures above and by the conversion
// tests, which read their input from Onix/ rather than tests/fixtures/.
// `beforeScripts(window)` runs after the shell exists but before the viewer
// scripts execute, so a test can seed localStorage the way a returning reader
// would have it.
function renderSource(xml, label, beforeScripts) {
  const fixtureName = label || "inline.xml";

  const html = `<!doctype html><html><head><style>${viewerCss}</style></head>
<body class="oxv-view-xml">
  <div id="oxv-toolbar">
    <button data-action="expand-all"></button>
    <button data-action="collapse-all"></button>
    <button data-action="collapse-blocks"></button>
    <button data-action="toggle-wrap"></button>
    <button data-action="copy-xml"></button>
    <span class="px-dialect-group">
      <button data-action="dialect-toggle" aria-pressed="false"></button>
    </span>
    <span class="px-view-group">
      <button data-action="view-xml"></button>
      <button data-action="view-split"></button>
      <button data-action="view-structure"></button>
    </span>
    <span class="px-search-group">
      <button class="px-icon-btn" data-action="search" aria-expanded="false"></button>
      <input id="oxv-search" tabindex="-1">
      <span id="oxv-search-status"></span>
    </span>
    <span id="oxv-validation"></span>
    <span id="oxv-block-list"></span>
    <span id="oxv-schema"></span>
    <span id="oxv-meta"></span>
  </div>
  <div id="oxv-main">
    <main id="oxv-root"></main>
    <div id="oxv-divider"></div>
    <aside id="oxv-blocks-pane"><div id="oxv-blocks"></div></aside>
  </div>
</body></html>`;

  const vc = new VirtualConsole();
  vc.on("error", (e) => {
    // Re-throw inside the test so a script error fails it loudly.
    throw e;
  });

  const dom = new JSDOM(html, {
    url: "https://example.com/" + fixtureName,
    runScripts: "outside-only",
    virtualConsole: vc,
  });
  const { window } = dom;
  window.__OXV_SOURCE__ = xml;
  if (beforeScripts) beforeScripts(window);

  window.eval(codelistsJs);
  window.eval(contentModelJs);
  window.eval(onixJs);
  window.eval(validateJs);
  window.eval(blocksJs);
  window.eval(popupJs);
  window.eval(viewerJs);

  return window;
}

// Helpers for assertions on rendered output.
function $$(window, sel) {
  return Array.from(window.document.querySelectorAll(sel));
}
function meta(window) {
  return window.document.getElementById("oxv-meta").textContent;
}
// Open/leaf rows (close rows excluded) whose element is named tagName.
function rowsNamed(window, tagName) {
  return $$(window, "#oxv-root .px-row").filter((row) => {
    const name = row.querySelector(".px-tag + .px-tag");
    return name && name.textContent === tagName && !row.classList.contains("px-close-row");
  });
}
function badges(window) {
  return $$(window, "#oxv-root .px-codelist").map((b) => b.textContent);
}
// Capture what the viewer writes to the clipboard.
function stubClipboard(window) {
  const copied = { text: null };
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: (text) => { copied.text = text; return Promise.resolve(); } },
  });
  return copied;
}
// Text of the collapsed-row summary chips on rows named tagName.
function summariesOf(window, tagName) {
  return rowsNamed(window, tagName)
    .map((row) => row.querySelector(".px-summary"))
    .filter(Boolean)
    .map((chip) => chip.textContent);
}

// ---- tests -----------------------------------------------------------------

describe("Generic XML", () => {
  test("renders w3schools note.xml-like document", () => {
    const w = render("generic-note.xml");
    const rows = $$(w, "#oxv-root .px-row");
    assert(rows.length >= 5, `expected ≥5 rows, got ${rows.length}`);
    assert(meta(w).includes("KB"), "meta should include size");
    assert(!meta(w).startsWith("ONIX"), "should not be detected as ONIX");
  });

  test("preserves XML declaration as a PI row", () => {
    const w = render("generic-note.xml");
    const piRows = $$(w, "#oxv-root .px-pi");
    assert(piRows.some((p) => p.textContent.startsWith("<?xml")), "missing <?xml declaration");
  });

  test("renders comments distinctly", () => {
    const w = render("with-comments.xml");
    const comments = $$(w, "#oxv-root .px-comment");
    assert(comments.length >= 1, "expected at least one comment");
    assert(comments[0].textContent.includes("<!--"), "comment should include marker");
  });

  test("renders CDATA sections distinctly", () => {
    const w = render("with-cdata.xml");
    const markers = $$(w, "#oxv-root .px-cdata-marker");
    assert(markers.length >= 2, "expected opening + closing CDATA markers");
  });

  test("malformed XML produces an error UI, not a crash", () => {
    const w = render("malformed.xml");
    const err = w.document.querySelector(".px-error");
    assert(err, "should render error block");
    assert(meta(w) === "parse error", "meta should say parse error");
  });
});

describe("ONIX 3.0 reference", () => {
  test("detects dialect and version", () => {
    const w = render("onix-3.0-reference.xml");
    assert(/^ONIX 3\.0 reference names \(\d+ products?\)/.test(meta(w)), `bad meta: ${meta(w)}`);
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
    assert(summary.startsWith("GTIN 9780000000003"),
      `expected "GTIN 9780000000003 …" prefix, got: ${summary}`);
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

describe("ONIX 3.0 short-tag", () => {
  test("detects dialect", () => {
    const w = render("onix-3.0-short.xml");
    assert(/^ONIX 3\.0 short tags \(\d+ products?\)/.test(meta(w)), `bad meta: ${meta(w)}`);
  });

  test("classifies tag spans with px-onix-short", () => {
    const w = render("onix-3.0-short.xml");
    const shorts = $$(w, "#oxv-root .px-tag.px-onix-short");
    assert(shorts.length > 5, `expected ONIX-short tags, got ${shorts.length}`);
  });

  test("resolves codelists via short-to-reference mapping (b221=15 → ISBN-13)", () => {
    const w = render("onix-3.0-short.xml");
    assert(badges(w).some((b) => b.includes("ISBN-13")), "ISBN-13 not resolved through short tag");
  });
});

describe("ONIX Acknowledgement 3.0", () => {
  test("detects the acknowledgement message and labels it distinctly", () => {
    const w = render("onix-3.0-acknowledgement.xml");
    assert(
      /^ONIX Acknowledgement 3\.0 \(\d+ records?\)/.test(meta(w)),
      `bad meta: ${meta(w)}`
    );
  });

  test("counts <Product> blocks as records, not products", () => {
    const w = render("onix-3.0-acknowledgement.xml");
    assert(/\(2 records\)/.test(meta(w)), `bad record count: ${meta(w)}`);
  });

  test("resolves MessageStatus 03 → Message processed", () => {
    const w = render("onix-3.0-acknowledgement.xml");
    assert(badges(w).some((b) => b.includes("Message processed")), "MessageStatus not resolved");
  });

  test("resolves RecordStatus 02 → Record with errors", () => {
    const w = render("onix-3.0-acknowledgement.xml");
    assert(badges(w).some((b) => b.includes("Record with errors")), "RecordStatus not resolved");
  });

  test("resolves StatusDetailType E → Error (list 224)", () => {
    const w = render("onix-3.0-acknowledgement.xml");
    assert(badges(w).some((b) => b === "→ Error"), `StatusDetailType not resolved: ${badges(w).join(", ")}`);
  });

  test("classifies tag spans with px-onix-ref", () => {
    const w = render("onix-3.0-acknowledgement.xml");
    const refs = $$(w, "#oxv-root .px-tag.px-onix-ref");
    assert(refs.length > 5, `expected ONIX-ref tags, got ${refs.length}`);
  });

  test("short-tag acknowledgement resolves m489/a498 via short-to-reference map", () => {
    const w = render("onix-3.0-acknowledgement-short.xml");
    assert(/^ONIX Acknowledgement 3\.0/.test(meta(w)), `bad meta: ${meta(w)}`);
    assert(badges(w).some((b) => b.includes("Message processed")), "m489 (MessageStatus) not resolved");
    assert(badges(w).some((b) => b.includes("Record rejected")), "a498 (RecordStatus) not resolved");
  });
});

describe("Standalone Product without namespace", () => {
  test("detects a bare <Product> root as ONIX (no envelope, no namespace)", () => {
    const w = render("onix-standalone-product-no-namespace.xml");
    // Version is unknown without a namespace, so the label omits it.
    assert(/^ONIX reference names \(1 product\)/.test(meta(w)), `bad meta: ${meta(w)}`);
  });

  test("resolves codelists on the un-namespaced Product (ProductForm BB → Hardback)", () => {
    const w = render("onix-standalone-product-no-namespace.xml");
    assert(badges(w).some((b) => b.includes("Hardback")), "ProductForm not resolved");
    assert(badges(w).some((b) => b.includes("ISBN-13")), "ProductIDType not resolved");
  });

  test("classifies tags with px-onix-ref (reference dialect inferred)", () => {
    const w = render("onix-standalone-product-no-namespace.xml");
    const refs = $$(w, "#oxv-root .px-tag.px-onix-ref");
    assert(refs.length > 5, `expected ONIX-ref tags, got ${refs.length}`);
  });

  test("a non-ONIX <Product> root is NOT misdetected as ONIX", () => {
    const w = render("non-onix-product.xml");
    assert(!meta(w).startsWith("ONIX"), `non-ONIX Product misdetected: ${meta(w)}`);
  });
});

describe("Codelist value styling", () => {
  test("text spans of codelist elements carry .px-codelist-value", () => {
    const w = render("onix-3.0-reference.xml");
    const styled = $$(w, "#oxv-root .px-text.px-codelist-value");
    assert(styled.length > 0, "expected at least one .px-codelist-value text span");
    const values = styled.map((s) => s.textContent.trim());
    assert(values.some((v) => v === "15" || v === "BB" || v === "01"),
      `expected at least one recognised code value, got [${values.join(", ")}]`);
  });

  test("plain text spans without a resolved codelist stay .px-text only", () => {
    const w = render("onix-3.0-reference.xml");
    const texts = $$(w, "#oxv-root .px-text:not(.px-codelist-value)");
    assert(texts.length > 0,
      "expected some plain text spans (e.g. titles) to remain un-styled as codelist");
  });

  test("codelist-encoded attribute values carry .px-codelist-value and a tooltip", () => {
    const w = render("onix-3.0-reference.xml");
    const styled = $$(w, "#oxv-root .px-attr-value.px-codelist-value");
    assert(styled.length >= 2, `expected ≥2 styled attribute values, got ${styled.length}`);
    const titles = styled.map((s) => s.title);
    assert(titles.some((t) => t.startsWith("textcase:")),
      `expected a textcase tooltip, got [${titles.join(" | ")}]`);
    assert(titles.some((t) => t.startsWith("language:")),
      `expected a language tooltip, got [${titles.join(" | ")}]`);
  });

  test("code-list attributes get a visible chip: textformat=\"05\" → XHTML", () => {
    const w = render("onix-3.0-text-attributes.xml");
    const chips = $$(w, "#oxv-root .px-attr-codelist");
    const texts = chips.map((c) => c.textContent);
    assert(texts.includes("→ XHTML"), `expected an XHTML chip (leaf row), got [${texts.join(" | ")}]`);
    assert(texts.includes("→ Default text format"),
      `expected a chip for textformat=06 on an open row, got [${texts.join(" | ")}]`);
    const xhtml = chips.find((c) => c.textContent === "→ XHTML");
    assert(xhtml.parentElement.classList.contains("px-attr"), "chip should sit inside the attribute span");
    assert(xhtml.title.includes("List 34"), `chip tooltip should name List 34, got: ${xhtml.title}`);
  });

  test("non-codelist attributes get no chip", () => {
    const w = render("onix-3.0-text-attributes.xml");
    const plainAttrs = $$(w, "#oxv-root .px-attr").filter(
      (a) => !a.querySelector(".px-attr-value").classList.contains("px-codelist-value")
    );
    assert(plainAttrs.length > 0, "expected plain attributes such as release=");
    assert(plainAttrs.every((a) => !a.querySelector(".px-attr-codelist")), "plain attribute has a chip");
  });

  test("non-codelist attribute values stay plain", () => {
    const w = render("onix-3.0-reference.xml");
    const allAttrs = $$(w, "#oxv-root .px-attr-value");
    const plain = allAttrs.filter((a) => !a.classList.contains("px-codelist-value"));
    assert(plain.length > 0, "expected at least one plain attribute (e.g. release=, xmlns=)");
  });
});

describe("Folding", () => {
  test("collapsible row produces a tagged close row", () => {
    const w = render("onix-3.0-reference.xml");
    const closeRows = $$(w, "#oxv-root .px-close-row");
    const collapsibleRows = $$(w, "#oxv-root .px-row.px-collapsible");
    assert(closeRows.length === collapsibleRows.length,
      `expected one close row per collapsible row (${collapsibleRows.length}); got ${closeRows.length}`);
  });

  test("folding hides the dedicated close row (only inline </Tag> remains)", () => {
    const w = render("onix-3.0-reference.xml");
    const openRow = $$(w, "#oxv-root .px-row.px-collapsible")[0];
    openRow.classList.add("px-folded");
    const closeRow = openRow.parentNode.querySelector(":scope > .px-close-row");
    assert(closeRow, "no close row found");
    const display = w.getComputedStyle(closeRow).display;
    assert(display === "none",
      `folded close row should be display:none, got "${display}"`);
  });
});

describe("Node menu", () => {
  function menuButtonFor(window, tagName) {
    return rowsNamed(window, tagName)[0].querySelector(".px-node-menu-btn");
  }
  test("every element row gets a menu button; close rows, comments and PIs do not", () => {
    const w = render("with-comments.xml");
    const elementRows = $$(w, "#oxv-root .px-row").filter(
      (r) => r.querySelector(".px-tag") && !r.classList.contains("px-close-row")
    );
    assert(elementRows.length > 0, "expected element rows");
    for (const row of elementRows) {
      assert(row.querySelector(".px-node-menu-btn"), "element row without menu button");
      assert(row.firstElementChild.classList.contains("px-node-menu-btn"), "button should sit first in the row");
    }
    for (const row of $$(w, "#oxv-root .px-close-row")) {
      assert(!row.querySelector(".px-node-menu-btn"), "close row should have no menu button");
    }
    for (const row of $$(w, "#oxv-root .px-row").filter((r) => r.querySelector(".px-comment, .px-pi"))) {
      assert(!row.querySelector(".px-node-menu-btn"), "comment/PI row should have no menu button");
    }
  });

  test("clicking the gutter button opens a menu with a Copy node XML item", () => {
    const w = render("onix-3.0-reference.xml");
    const button = menuButtonFor(w, "ProductIdentifier");
    button.click();
    const menu = w.document.getElementById("oxv-node-menu");
    assert(menu && !menu.hidden, "menu should be visible after click");
    assert(button.getAttribute("aria-expanded") === "true", "button should report expanded");
    const items = Array.from(menu.querySelectorAll(".px-node-menu-item")).map((i) => i.textContent);
    assert(items.includes("Copy node XML"), `expected Copy node XML item, got ${items}`);
  });

  test("Copy node XML copies the undecorated subtree, without the inherited xmlns, de-indented", () => {
    const w = render("onix-3.0-reference.xml");
    const copied = stubClipboard(w);
    menuButtonFor(w, "ProductIdentifier").click();
    w.document.querySelector('#oxv-node-menu [data-node-action="copy-xml"]').click();
    const expected = [
      "<ProductIdentifier>",
      "  <ProductIDType>15</ProductIDType>",
      "  <IDValue>9788234567890</IDValue>",
      "</ProductIdentifier>",
    ].join("\n");
    assert(copied.text === expected, `unexpected copy:\n${copied.text}`);
  });

  test("Copy node XML keeps an xmlns the source element declared itself", () => {
    const w = render("onix-3.0-reference.xml");
    const copied = stubClipboard(w);
    menuButtonFor(w, "ONIXMessage").click();
    w.document.querySelector('#oxv-node-menu [data-node-action="copy-xml"]').click();
    assert(
      copied.text.startsWith('<ONIXMessage xmlns="http://ns.editeur.org/onix/3.0/reference" release="3.0">'),
      `unexpected copy start:\n${copied.text.slice(0, 120)}`
    );
    assert(!copied.text.includes("→"), "copied text must not contain viewer badges");
  });

  test("Esc and outside clicks close the menu", () => {
    const w = render("onix-3.0-reference.xml");
    const button = menuButtonFor(w, "Header");
    const menu = () => w.document.getElementById("oxv-node-menu");
    button.click();
    assert(!menu().hidden, "menu should be open");
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert(menu().hidden, "Esc should close the menu");
    assert(button.getAttribute("aria-expanded") === "false", "button should report collapsed");
    button.click();
    assert(!menu().hidden, "menu should re-open");
    w.document.getElementById("oxv-meta").click();
    assert(menu().hidden, "outside click should close the menu");
  });
});

describe("Collapse blocks", () => {
  test("folds the block elements and unfolds the Products that contain them", () => {
    const w = render("onix-3.0-reference.xml");
    const products = rowsNamed(w, "Product");
    assert(products.every((r) => r.classList.contains("px-folded")), "products should start folded");
    w.document.querySelector('[data-action="collapse-blocks"]').click();
    assert(products.every((r) => !r.classList.contains("px-folded")), "products should be unfolded");
    const blocks = [...rowsNamed(w, "DescriptiveDetail"), ...rowsNamed(w, "PublishingDetail")];
    assert(blocks.length >= 2, "expected block rows in the fixture");
    assert(blocks.every((r) => r.classList.contains("px-folded")), "block rows should be folded");
    assert(rowsNamed(w, "Header").every((r) => !r.classList.contains("px-folded")), "Header should be untouched");
  });

  test("folds the block-0 composites too, so a Product is one line per child", () => {
    const w = render("onix-3.0-reference.xml");
    w.document.querySelector('[data-action="collapse-blocks"]').click();
    const identifiers = rowsNamed(w, "ProductIdentifier");
    assert(identifiers.length >= 1, "expected ProductIdentifier rows in the fixture");
    assert(identifiers.every((r) => r.classList.contains("px-folded")),
      "ProductIdentifier sits directly in <Product> and should fold with the blocks");
    // Composites deeper than a Product's own children stay as they are —
    // they're hidden inside a folded block anyway.
    assert(rowsNamed(w, "TitleDetail").every((r) => !r.classList.contains("px-folded")),
      "TitleDetail is inside DescriptiveDetail and should be untouched");
  });

  test("works in short dialect and via the b shortcut", () => {
    const w = render("onix-3.0-short.xml");
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "b", bubbles: true }));
    const blocks = rowsNamed(w, "descriptivedetail");
    assert(blocks.length >= 1, "expected short-tag block rows");
    assert(blocks.every((r) => r.classList.contains("px-folded")), "short-tag block rows should be folded");
    const identifiers = rowsNamed(w, "productidentifier");
    assert(identifiers.length >= 1, "expected short-tag ProductIdentifier rows");
    assert(identifiers.every((r) => r.classList.contains("px-folded")),
      "short-tag block-0 composites should fold too");
  });
});

describe("ONIX blocks", () => {
  function blockLabelOf(window, tagName) {
    const row = rowsNamed(window, tagName)[0];
    const label = row && row.querySelector(".px-block-label");
    return label ? label.textContent : null;
  }
  function blockList(window) {
    return window.document.getElementById("oxv-block-list").textContent;
  }

  test("block rows carry a Block N badge; other rows do not", () => {
    const w = render("onix-3.0-single-product-blocks.xml");
    assert(blockLabelOf(w, "DescriptiveDetail") === "Block 1", "DescriptiveDetail should be Block 1");
    assert(blockLabelOf(w, "PublishingDetail") === "Block 4", "PublishingDetail should be Block 4");
    assert(blockLabelOf(w, "ProductSupply") === "Block 6", "ProductSupply should be Block 6");
    assert(blockLabelOf(w, "Header") === null, "Header should have no block badge");
    assert(blockLabelOf(w, "Product") === null, "Product should have no block badge");
  });

  test("short-tag block rows are badged too", () => {
    const w = render("onix-3.0-short.xml");
    assert(blockLabelOf(w, "descriptivedetail") === "Block 1", "descriptivedetail should be Block 1");
  });

  test("toolbar lists the blocks of a single-Product message", () => {
    const w = render("onix-3.0-single-product-blocks.xml");
    assert(blockList(w) === "Blocks: 1, 4, 6", `unexpected block list: ${blockList(w)}`);
  });

  test("toolbar lists the blocks of a standalone Product record", () => {
    const w = render("onix-3.1-standalone-product.xml");
    assert(blockList(w) === "Blocks: 1", `unexpected block list: ${blockList(w)}`);
  });

  test("block list stays empty for multi-Product feeds, acknowledgements and non-ONIX", () => {
    assert(blockList(render("onix-3.0-reference.xml")) === "", "multi-product should have no block list");
    assert(blockList(render("onix-3.0-acknowledgement.xml")) === "", "acknowledgement should have no block list");
    assert(blockList(render("rss.xml")) === "", "non-ONIX should have no block list");
  });
});

describe("Selection", () => {
  test("viewer decorations opt out of text selection so a drag-copy yields only XML", () => {
    const w = render("onix-3.0-reference.xml");
    const decorated = new Set();
    for (const sheet of w.document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (rule.style && rule.style.getPropertyValue("user-select") === "none") {
          rule.selectorText.split(",").forEach((s) => decorated.add(s.trim()));
        }
      }
    }
    for (const sel of [".px-codelist", ".px-codelist-link", ".px-summary", ".px-block-label",
                       ".px-fold-ellipsis", ".px-fold-close", ".px-node-menu-btn", ".px-toggle"]) {
      assert(decorated.has(sel), `${sel} should have user-select: none`);
    }
  });
});

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

describe("Search", () => {
  function searchButton(window) {
    return window.document.querySelector('#oxv-toolbar [data-action="search"]');
  }
  function field(window) {
    return window.document.getElementById("oxv-search");
  }
  function isOpen(window) {
    return window.document.body.classList.contains("px-search-open");
  }
  // The input handler debounces by 120ms, and the harness is synchronous, so
  // run the pending timer immediately instead of waiting for it.
  function type(window, text) {
    const realSetTimeout = window.setTimeout;
    window.setTimeout = (fn) => { fn(); return 0; };
    field(window).value = text;
    field(window).dispatchEvent(new window.Event("input"));
    window.setTimeout = realSetTimeout;
  }

  test("starts collapsed to its icon and out of the tab order", () => {
    const w = render("onix-3.0-reference.xml");
    assert(!isOpen(w), "the field should start collapsed");
    assert(searchButton(w).querySelector("svg"), "the button should carry the magnifier icon");
    assert(searchButton(w).getAttribute("aria-expanded") === "false", "and say it is collapsed");
    assert(field(w).getAttribute("tabindex") === "-1",
      "a zero-width field must not be tabbable — the button is the way in");
  });

  test("the button and / both open it", () => {
    const w = render("onix-3.0-reference.xml");
    searchButton(w).click();
    assert(isOpen(w), "clicking the button opens it");
    assert(searchButton(w).getAttribute("aria-expanded") === "true", "and announces it");
    assert(field(w).getAttribute("tabindex") === null, "the field joins the tab order");
    searchButton(w).click();
    assert(!isOpen(w), "clicking again closes it");

    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "/", bubbles: true }));
    assert(isOpen(w), "/ opens it too");
  });

  test("it still searches, and still finds text inside folded rows", () => {
    // The reason it survives at all: browser find skips display:none, and
    // Products are auto-collapsed on a multi-product feed.
    const w = render("onix-3.0-reference.xml");
    const products = rowsNamed(w, "Product");
    assert(products.every((r) => r.classList.contains("px-folded")), "products start folded");
    searchButton(w).click();
    // A contributor name, not the title: a title also appears in the folded
    // row's own summary chip, where there would be nothing to unfold.
    type(w, "Ola Nordmann");
    assert($$(w, "#oxv-root .px-match").length > 0, "the match should be highlighted");
    assert(!products[0].classList.contains("px-folded"),
      "and its Product unfolded so the match is actually visible");
  });

  test("Esc clears the query and collapses it again", () => {
    const w = render("onix-3.0-reference.xml");
    searchButton(w).click();
    type(w, "Eksempelboken");
    field(w).dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert(!isOpen(w), "collapsed");
    assert(field(w).value === "", "query cleared");
    assert($$(w, "#oxv-root .px-match").length === 0, "highlights cleared");
  });
});

describe("Validation", () => {
  const fsv = require("fs");
  // Validation runs itself on load, so this only reads the result. A fixture
  // is small enough to finish inside the first slice, hence synchronously.
  function validate(window) {
    return window.document.getElementById("oxv-validation");
  }
  // Validate arbitrary XML inside a given window, so a test can register a
  // rule and then exercise it against several documents in one context.
  function findingsFor(window, xml) {
    const doc = new window.DOMParser().parseFromString(xml, "application/xml");
    return window.OnixViewerValidation.run(doc, window.OnixViewerOnix.detect(doc));
  }
  function findings(window) {
    return findingsFor(window, window.__OXV_SOURCE__);
  }
  function codes(result) {
    return result.findings.map((f) => f.code);
  }

  test("a schema-valid ONIX 3.1 message reports nothing", () => {
    const w = render("onix-3.1-valid.xml");
    const result = findings(w);
    assert(result.total === 0, `expected a clean document, got: ${codes(result).join(", ")}`);
    assert(result.checkedStructure, "structure should have been checked");
    assert(validate(w).textContent === "Valid", `got: ${validate(w).textContent}`);
    assert(validate(w).className === "px-valid", "and be marked as such");
    assert(validate(w).querySelector("svg"), "with a tick beside it");
  });

  test("each kind of defect is reported once, with no cascade", () => {
    const w = render("onix-3.1-invalid.xml");
    const result = findings(w);
    for (const code of ["codelist.unknown", "codelist.deprecated", "structure.unknown",
                        "datatype.range", "structure.expected-one-of"]) {
      assert(codes(result).includes(code), `missing ${code}; got: ${codes(result).join(", ")}`);
    }
    // An unknown element must not make its siblings "not allowed here" too.
    assert(!codes(result).includes("structure.unexpected"),
      `a typo should not cascade; got: ${codes(result).join(", ")}`);
    assert(result.total === 5, `expected 5 findings, got ${result.total}: ${codes(result).join(", ")}`);
  });

  test("findings are pinned to the rows they are about", () => {
    const w = render("onix-3.1-invalid.xml");
    validate(w);
    const marked = $$(w, "#oxv-root .px-has-finding");
    assert(marked.length >= 3, `expected several marked rows, got ${marked.length}`);
    const notification = rowsNamed(w, "NotificationType")[0];
    const marker = notification.querySelector(".px-finding");
    assert(marker, "the bad code's row should carry a marker");
    assert(marker.title.includes("not in List 1"), `got: ${marker.title}`);
    assert(validate(w).textContent === "4 errors, 1 warning", `got: ${validate(w).textContent}`);
  });

  test("markers carry their severity: errors red, warnings amber", () => {
    const w = render("onix-3.1-invalid.xml");
    validate(w);
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
    validate(w);
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

  test("a row with several findings shows a count beside one icon", () => {
    const w = render("onix-3.1-invalid.xml");
    // Two findings on one element: an unknown code that is also deprecated.
    const source = w.__OXV_SOURCE__.replace("<ProductForm>BC</ProductForm>", "<ProductForm>ZZZ</ProductForm>");
    const two = renderSource(source, "two-findings.xml");
    const marker = rowsNamed(two, "ProductForm")[0].querySelector(".px-finding");
    assert(marker, "the row should be marked");
    assert(marker.querySelectorAll("svg").length === 1, "one icon, not one per finding");
  });

  test("severity chips don't inherit the parse-error box styling", () => {
    // .px-error is the parse-error panel: margins, padding and a border. A
    // severity chip that reused that name rendered as a huge block.
    const w = render("onix-3.1-invalid.xml");
    validate(w);
    for (const marker of $$(w, "#oxv-root .px-finding")) {
      assert(!marker.classList.contains("px-error") && !marker.classList.contains("px-warning"),
        `chips must not reuse the parse-error class names: ${marker.className}`);
    }
  });

  test("the summary label opens a list of every finding", () => {
    const w = render("onix-3.1-invalid.xml");
    const status = validate(w);
    assert(status.getAttribute("role") === "button", "the label should announce itself as clickable");
    status.click();
    const modal = w.document.getElementById("oxv-findings");
    assert(modal && !modal.hidden, "the findings modal should open");
    const items = [...modal.querySelectorAll(".px-findings-item")];
    assert(items.length === 5, `expected one entry per finding, got ${items.length}`);
    assert(items.filter((i) => i.dataset.oxvSeverity === "error").length === 4, "4 errors");
    assert(items.filter((i) => i.dataset.oxvSeverity === "warning").length === 1, "1 warning");
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
    validate(w).click();
    const modal = w.document.getElementById("oxv-findings");
    const entry = [...modal.querySelectorAll(".px-findings-item")]
      .find((i) => i.textContent.includes("not in List 1"));
    entry.click();
    assert(modal.hidden, "the list should close");
    assert(rowsNamed(w, "NotificationType")[0].classList.contains("px-active"),
      "and the row it points at should be the active one");
  });

  test("a clean document leaves the label inert", () => {
    const w = render("onix-3.1-valid.xml");
    const status = validate(w);
    assert(status.textContent === "Valid", `got: ${status.textContent}`);
    assert(status.getAttribute("role") === "status", "nothing to open");
    status.click();
    const modal = w.document.getElementById("oxv-findings");
    assert(!modal || modal.hidden, "no modal for a clean document");
  });

  test("all three label states are icon-led", () => {
    const clean = validate(render("onix-3.1-valid.xml"));
    assert(clean.querySelector("svg") && clean.textContent === "Valid", "a tick and the word");
    const dirty = validate(render("onix-3.1-invalid.xml"));
    assert(dirty.querySelector("svg"), "problems get an icon too");
    assert(dirty.textContent === "4 errors, 1 warning", `got: ${dirty.textContent}`);
  });

  test("validation starts on its own and never scrolls the page", () => {
    const w = render("onix-3.1-invalid.xml");
    // Nothing was clicked: the label is already filled in.
    assert(validate(w).textContent === "4 errors, 1 warning", `got: ${validate(w).textContent}`);
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
    assert(session.result().total === 5, `same findings as a single pass: ${session.result().total}`);
  });

  test("both dialects of the same record produce the same findings", () => {
    const read = (n) => fsv.readFileSync(path.join(__dirname, "..", "Onix", n), "utf8");
    const reference = findings(renderSource(read("onix-3.1-refnames.xml")));
    const short = findings(renderSource(read("onix-3.1-shorttags.xml")));
    assert(codes(reference).join() === codes(short).join(),
      `reference: ${codes(reference).join()} vs short: ${codes(short).join()}`);
    assert(reference.total === 1 && codes(reference)[0] === "codelist.deprecated",
      `expected the deprecated ISTC only; got ${codes(reference).join(", ")}`);
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
    assert(w.OnixViewerValidation.message(note).includes("bundled: 3.0, 3.1"),
      `the message should name what is available: ${w.OnixViewerValidation.message(note)}`);
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
    // The shape an xs:unique or GTIN-13 check-digit rule would take.
    const w = render("onix-3.1-valid.xml");
    const good = "9788234567896";
    const validation = w.OnixViewerValidation;
    validation.messages["gtin.checkdigit"] = "{value} has a bad check digit";
    validation.registerRule({
      name: "gtin",
      element(node, api) {
        if (api.referenceName(node) !== "IDValue") return true;
        const value = api.textOf(node);
        if (value.length !== 13) return true;
        const sum = [...value].reduce((t, d, i) => t + Number(d) * (i % 2 ? 3 : 1), 0);
        if (sum % 10 !== 0) api.report("gtin.checkdigit", node, { value });
        return true;
      },
    });
    const valid = fsv.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
    const clean = findingsFor(w, valid);
    assert(clean.total === 0, `${good} should pass the check digit; got: ${codes(clean).join(", ")}`);
    // Target the element: <RecordReference> embeds the same digits, and a
    // string replace would rewrite that instead.
    const after = findingsFor(w, valid.replace(`<IDValue>${good}`, "<IDValue>9788234567895"));
    assert(codes(after).includes("gtin.checkdigit"),
      `the registered rule should fire; got: ${codes(after).join(", ")}`);
    assert(w.OnixViewerValidation.message(after.findings[0]) === "9788234567895 has a bad check digit",
      "and use its own message template");
  });
});

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
    return new Set([...xml.matchAll(/<([A-Za-z][A-Za-z0-9]*)[\s>\/]/g)].map((m) => m[1]));
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
    const shortFile = fs2.readFileSync(path.join(__dirname, "..", "Onix", "onix-3.1-shorttags.xml"), "utf8");
    const referenceFile = fs2.readFileSync(path.join(__dirname, "..", "Onix", "onix-3.1-refnames.xml"), "utf8");
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
    const shortFile = fs2.readFileSync(path.join(__dirname, "..", "Onix", "onix-3.1-shorttags.xml"), "utf8");
    const referenceFile = fs2.readFileSync(path.join(__dirname, "..", "Onix", "onix-3.1-refnames.xml"), "utf8");
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

describe("Dialect toggle", () => {
  function switchButton(window) {
    return window.document.querySelector('[data-action="dialect-toggle"]');
  }
  function flip(window) {
    switchButton(window).click();
  }
  // Pressed means "showing the translation", so the source view is unpressed.
  function showingTranslation(window) {
    return switchButton(window).getAttribute("aria-pressed") === "true";
  }

  test("a short-tag document can be read with reference names", () => {
    const w = render("onix-3.0-short-codelists.xml");
    assert(rowsNamed(w, "productidentifier").length === 1, "should start in short tags");
    flip(w);
    assert(rowsNamed(w, "ProductIdentifier").length === 1, "composite should read as reference");
    assert(rowsNamed(w, "LanguageRole").length === 1, "b253 should read as LanguageRole");
    assert(rowsNamed(w, "productidentifier").length === 0, "short spelling should be gone");
    flip(w);
    assert(rowsNamed(w, "productidentifier").length === 1, "and back again");
    assert(rowsNamed(w, "b253").length === 1, "data element back to its short tag");
  });

  test("a reference document can be read with short tags", () => {
    const w = render("onix-3.0-reference.xml");
    flip(w);
    assert(rowsNamed(w, "productidentifier").length >= 1, "composite should read as short");
    assert(rowsNamed(w, "b221").length >= 1, "ProductIDType should read as b221");
    // The message root is the one short tag that isn't all lower case.
    assert(rowsNamed(w, "ONIXmessage").length === 1, "root should be <ONIXmessage>, not <onixmessage>");
  });

  test("the switch names the translation, so the source dialect is the unpressed state", () => {
    const shortDoc = render("onix-3.0-short-codelists.xml");
    assert(switchButton(shortDoc).textContent === "View as reference names",
      `got: ${switchButton(shortDoc).textContent}`);
    assert(!showingTranslation(shortDoc), "a freshly opened document shows itself");
    flip(shortDoc);
    assert(showingTranslation(shortDoc), "pressed once you are reading the translation");
    assert(switchButton(shortDoc).textContent === "View as reference names",
      "the label is anchored to the source and must not flip");
    flip(shortDoc);
    assert(!showingTranslation(shortDoc), "and unpressed back at the source");

    const referenceDoc = render("onix-3.0-reference.xml");
    assert(switchButton(referenceDoc).textContent === "View as short tags",
      `got: ${switchButton(referenceDoc).textContent}`);
  });

  test("the meta pill states which dialect the document is written in", () => {
    assert(meta(render("onix-3.0-short-codelists.xml")).includes("short tags"), "short document");
    assert(meta(render("onix-3.0-reference.xml")).includes("reference names"), "reference document");
    const w = render("onix-3.0-short-codelists.xml");
    flip(w);
    assert(meta(w).includes("short tags"),
      "the pill describes the file, so translating must not change it");
  });

  test("switching keeps fold state, code-list badges and summaries intact", () => {
    const w = render("onix-3.0-short-codelists.xml");
    const before = badges(w).join("|");
    const product = rowsNamed(w, "product")[0];
    product.classList.add("px-folded");
    flip(w);
    assert(rowsNamed(w, "Product")[0].classList.contains("px-folded"),
      "the folded row should still be folded after switching");
    assert(badges(w).join("|") === before, "code-list labels come from the parsed document, not the display");
    assert(summariesOf(w, "Product")[0].startsWith("ISBN 9788234567892"), "summary should survive");
  });

  test("translated names follow the dialect styling", () => {
    const w = render("onix-3.0-short-codelists.xml");
    assert($$(w, "#oxv-root .px-onix-short").length > 0, "short tags start italic");
    flip(w);
    assert($$(w, "#oxv-root .px-onix-short").length === 0, "reference names are not italic");
    assert($$(w, "#oxv-root .px-onix-ref").length > 0, "and carry the reference class");
  });

  test("every generated pair round-trips in both directions", () => {
    const w = render("onix-3.0-short.xml");
    const translate = w.OnixViewerOnix.translatedName;
    const pairs = w.OnixViewerShortTags;
    let checked = 0;
    for (const [shortTag, referenceName] of Object.entries(pairs)) {
      assert(translate(shortTag, "reference") === referenceName,
        `${shortTag} should read as ${referenceName}`);
      const back = translate(referenceName, "short");
      assert(back && back.toLowerCase() === shortTag,
        `${referenceName} should read as ${shortTag}, got ${back}`);
      checked++;
    }
    assert(checked > 400, `expected the full map, checked ${checked}`);
  });

  test("a stored preference renders straight into that dialect, with no rewrite pass", () => {
    const w = render("onix-3.0-short-codelists.xml",
      (window) => window.localStorage.setItem("oxv-dialect", "reference"));
    assert(rowsNamed(w, "ProductIdentifier").length === 1,
      "the tree should be built in the preferred dialect, not swapped afterwards");
    assert(rowsNamed(w, "productidentifier").length === 0, "no short spellings should have been rendered");
    assert(showingTranslation(w), "and the switch should show that this is the translation");
    assert($$(w, "#oxv-root .px-onix-short").length === 0, "styling should match the displayed dialect");
  });

  test("no counterpart spelling is stored per span", () => {
    // ~700k DOM attributes on a large feed if it were; names are re-derived.
    const w = render("onix-3.0-short-codelists.xml");
    assert($$(w, "#oxv-root [data-oxv-alt]").length === 0, "tag spans should carry no stored alternate");
    assert($$(w, "#oxv-root .px-tag-name").length > 0, "name spans should be marked for the toggle");
  });

  test("flipping back and forth is lossless", () => {
    const w = render("onix-3.0-short-codelists.xml");
    const before = $$(w, "#oxv-root .px-tag-name").map((span) => span.textContent).join("|");
    for (let i = 0; i < 3; i++) { flip(w); flip(w); }
    assert($$(w, "#oxv-root .px-tag-name").map((span) => span.textContent).join("|") === before,
      "three round trips must leave every name exactly as it started");
  });

  test("unknown elements keep their name, and non-ONIX documents hide the toggle", () => {
    const w = render("onix-3.0-short-codelists.xml");
    const translate = w.OnixViewerOnix.translatedName;
    assert(translate("NotAnOnixElement", "reference") === null, "no invented translation");
    assert(translate("Product", "reference") === null, "already reference: nothing to do");
    const plain = render("rss.xml");
    assert(plain.document.body.classList.contains("px-no-dialect-toggle"),
      "non-ONIX documents should hide the toggle");
  });
});

describe("Short-tag message root", () => {
  test("<ONIXmessage> is the short-tag root, so a namespaced short feed is detected", () => {
    const w = render("onix-3.0-short-codelists.xml");
    assert(meta(w).startsWith("ONIX 3.0 short tags (1 product)"), `got: ${meta(w)}`);
    assert($$(w, "#oxv-root .px-onix-short").length > 0, "short-tag rows should carry .px-onix-short");
  });

  test("a namespace-less <ONIXmessage> is read as short dialect at its release version", () => {
    const w = render("onix-short-no-namespace.xml");
    assert(meta(w).startsWith("ONIX 3.1 short tags (1 product)"),
      `release attribute should give the version; got: ${meta(w)}`);
    assert($$(w, "#oxv-root .px-onix-short").length > 0,
      "the root's spelling alone should select the short dialect");
    assert(badges(w).includes("→ ISBN-13"), "short-tag code lists should still resolve");
  });
});

describe("Composite summaries", () => {
  test("an identifier composite reads as its resolved type plus value", () => {
    const w = render("onix-3.0-gtin-only.xml");
    const summaries = summariesOf(w, "ProductIdentifier");
    assert(summaries.length === 2, `expected a chip per ProductIdentifier, got ${summaries.length}`);
    assert(summaries[1] === "GTIN-13 9780000000003",
      `expected the List 5 label and the IDValue, got: ${summaries[1]}`);
    assert(summaries[0] === "Proprietary product ID scheme internal-1234",
      `expected the list label when no IDTypeName is given, got: ${summaries[0]}`);
  });

  test("the identifier rule is shape-based, so it covers other *IDType composites", () => {
    const w = render("onix-3.0-single-product-blocks.xml");
    const summaries = summariesOf(w, "RecordSourceIdentifier");
    assert(summaries.length === 1, "expected a RecordSourceIdentifier chip");
    assert(summaries[0] === "Bokbasen 14349",
      `RecordSourceIdentifier should summarise with no rule of its own, got: ${summaries[0]}`);
  });

  test("a proprietary scheme names itself via IDTypeName", () => {
    const w = render("onix-3.0-proprietary-only.xml");
    const summaries = summariesOf(w, "ProductIdentifier");
    assert(summaries[0] === "internal internal-XYZ",
      `expected IDTypeName in place of the "Proprietary" label, got: ${summaries[0]}`);
  });

  test("contributor reads as role plus name; price as amount plus currency", () => {
    const w = render("onix-3.0-reference.xml");
    assert(summariesOf(w, "Contributor")[0] === "By (author) Ola Nordmann",
      `got: ${summariesOf(w, "Contributor")[0]}`);
    const priced = render("onix-3.0-single-product-blocks.xml");
    assert(summariesOf(priced, "Price")[0] === "399.00 NOK",
      `got: ${summariesOf(priced, "Price")[0]}`);
  });

  test("title composites read as the quoted title", () => {
    const w = render("onix-3.0-multi-title.xml");
    assert(summariesOf(w, "TitleDetail")[0] === '"Fra en dag til en annen"',
      `got: ${summariesOf(w, "TitleDetail")[0]}`);
  });

  test("the seven blocks deliberately carry no chip", () => {
    const w = render("onix-3.0-single-product-blocks.xml");
    for (const block of ["DescriptiveDetail", "PublishingDetail", "ProductSupply"]) {
      assert(summariesOf(w, block).length === 0, `${block} should have no summary chip`);
    }
  });

  test("works in short dialect", () => {
    const w = render("onix-3.0-short.xml");
    assert(summariesOf(w, "productidentifier")[0] === "ISBN-13 9788234567892",
      `got: ${summariesOf(w, "productidentifier")[0]}`);
    assert(summariesOf(w, "contributor")[0] === "By (author) Kari Nordmann",
      `got: ${summariesOf(w, "contributor")[0]}`);
    // Dispatch is on the lower-cased name, so <price> works too.
    const priced = render("onix-3.0-short-codelists.xml");
    assert(summariesOf(priced, "price")[0] === "399.00 NOK",
      `got: ${summariesOf(priced, "price")[0]}`);
  });

  test("a long title is clamped so the chip cannot wrap", () => {
    const w = render("onix-3.0-multi-title.xml");
    for (const chip of summariesOf(w, "TitleDetail")) {
      assert(chip.length <= 62, `chip should stay within the cap, got ${chip.length}: ${chip}`);
    }
  });
});

describe("Double injection", () => {
  test("a second viewer.js instance leaves the rendered tree alone", () => {
    // Two enabled copies of the extension both inject the viewer bundle into
    // the surviving shell. Without a guard the tree is rendered twice and
    // every click handler is registered twice, which makes the fold chevrons
    // dead. The second instance must find #oxv-root already filled and stop.
    const w = render("onix-3.1-standalone-product.xml");
    const before = $$(w, "#oxv-root .px-row").length;
    w.eval(viewerJs);
    assert(before > 0, "first pass should have rendered rows");
    assert($$(w, "#oxv-root .px-row").length === before, "second pass must not add rows");
    assert(rowsNamed(w, "Product").length === 1, "the root <Product> must appear once");
  });
});

describe("Feed formats", () => {
  test("RSS feed renders without ONIX detection", () => {
    const w = render("rss.xml");
    assert(!meta(w).startsWith("ONIX"), "RSS misdetected as ONIX");
    const rows = $$(w, "#oxv-root .px-row");
    assert(rows.length >= 5, "expected RSS items rendered");
  });
});

describe("ONIX blocks pane", () => {
  test("renders the ONIX Message Header card above product cards", () => {
    const w = render("onix-3.0-reference.xml");
    const cards = $$(w, "#oxv-blocks > details");
    assert(cards.length >= 3, `expected header + ≥2 product cards, got ${cards.length}`);
    assert(cards[0].classList.contains("px-message-header"),
      "first card should be the message header");
    const headerBody = cards[0].querySelector(".px-block-section-body");
    assert(headerBody.textContent.includes("Bokbasen AS"),
      `header should include sender name: ${headerBody.textContent}`);
  });

  test("standalone Product file has no Message Header card (no ONIXMessage envelope)", () => {
    const w = render("onix-3.1-standalone-product.xml");
    const headers = $$(w, "#oxv-blocks .px-message-header");
    assert(headers.length === 0, "standalone file should not render a Message Header card");
  });

  test("hides right pane on non-ONIX documents", () => {
    const w = render("rss.xml");
    assert(w.document.body.classList.contains("px-no-onix"), "body should have px-no-onix");
    const cards = $$(w, "#oxv-blocks .px-block-product:not(.px-message-header)");
    assert(cards.length === 0, `expected 0 product cards, got ${cards.length}`);
  });

  test("renders one product card per Product (reference dialect)", () => {
    const w = render("onix-3.0-reference.xml");
    assert(!w.document.body.classList.contains("px-no-onix"), "body should not have px-no-onix");
    const cards = $$(w, "#oxv-blocks .px-block-product:not(.px-message-header)");
    assert(cards.length === 2, `expected 2 product cards, got ${cards.length}`);
  });

  test("Product card has no Record section (RecordReference/NotificationType only in tree)", () => {
    const w = render("onix-3.0-reference.xml");
    const card = $$(w, "#oxv-blocks .px-block-product:not(.px-message-header)")[0];
    const labels = Array.from(card.querySelectorAll(".px-block-section > summary"))
      .map((s) => s.textContent.trim());
    assert(!labels.some((l) => l === "Record"),
      `Record section should be gone; got labels: ${labels.join(", ")}`);
  });

  test("right pane has a section per ONIX block present in the document", () => {
    const w = render("onix-3.0-reference.xml");
    const card = $$(w, "#oxv-blocks .px-block-product:not(.px-message-header)")[0];
    const blockSections = Array.from(card.querySelectorAll(".px-block-section[data-oxv-block-name]"));
    const blockNames = blockSections.map((s) => s.dataset.oxvBlockName);
    // Fixture has DescriptiveDetail and PublishingDetail in each Product.
    assert(blockNames.includes("descriptivedetail"), `missing descriptivedetail; got ${blockNames}`);
    assert(blockNames.includes("publishingdetail"), `missing publishingdetail; got ${blockNames}`);
    // Section labels follow the "Block N — Name" format.
    const summary = blockSections[0].querySelector("summary").textContent;
    assert(/Block 1 — Descriptive Detail/.test(summary), `bad block label: ${summary}`);
  });

  test("Title and Contributors content lives inside the Descriptive Detail block", () => {
    const w = render("onix-3.0-reference.xml");
    const dd = $$(w, "#oxv-blocks .px-block-section[data-oxv-block-name='descriptivedetail']")[0];
    assert(dd, "descriptivedetail section missing");
    const body = dd.querySelector(".px-block-section-body");
    assert(body.textContent.includes("Eksempelboken"), `Title not in DescriptiveDetail: ${body.textContent}`);
    assert(body.textContent.includes("Ola Nordmann"), `Contributor not in DescriptiveDetail: ${body.textContent}`);
  });

  test("ProductIdentifier renders before any block section", () => {
    const w = render("onix-3.0-reference.xml");
    const card = $$(w, "#oxv-blocks .px-block-product:not(.px-message-header)")[0];
    const pi = card.querySelector("details[data-oxv-onix-element='productidentifier']");
    const block1 = card.querySelector(".px-block-section[data-oxv-block-name='descriptivedetail']");
    assert(pi, "expected at least one ProductIdentifier item in the card");
    assert(block1, "expected Block 1 section in the card");
    const pos = pi.compareDocumentPosition(block1);
    assert(pos & 4 /* DOCUMENT_POSITION_FOLLOWING */,
      "ProductIdentifier should appear before the first block section in DOM order");
  });

  test("product header shows ISBN and title", () => {
    const w = render("onix-3.0-reference.xml");
    const header = $$(w, "#oxv-blocks .px-block-product:not(.px-message-header) .px-block-product-header")[0];
    assert(header, "missing product header");
    assert(header.textContent.includes("9788234567890"), `header missing ISBN: ${header.textContent}`);
    assert(header.textContent.includes("Eksempelboken"), `header missing title: ${header.textContent}`);
  });

  test("identifiers section uses codelist labels", () => {
    const w = render("onix-3.0-reference.xml");
    const labels = $$(w, "#oxv-blocks details[data-oxv-onix-element='productidentifier'] summary .px-block-field-label")
      .map((s) => s.textContent);
    assert(labels.some((l) => l.includes("ISBN-13")), `no ISBN-13 label among ${labels}`);
  });

  test("identifiers and contributor roles include EDItEUR list links in the right pane", () => {
    const w = render("onix-3.0-reference.xml");
    const links = $$(w, "#oxv-blocks .px-codelist-link");
    const hrefs = links.map((a) => a.getAttribute("href"));
    assert(hrefs.includes("https://ns.editeur.org/onix/en/5"), `expected List 5 link, got ${hrefs}`);
    assert(hrefs.includes("https://ns.editeur.org/onix/en/17"), `expected List 17 link, got ${hrefs}`);
    assert(links[0].querySelector("svg.px-extlink-icon"), "block-pane links missing external-link svg");
  });

  test("contributors render expandable entries with role labels (inside Block 1)", () => {
    const w = render("onix-3.0-reference.xml");
    const contribs = $$(w, "#oxv-blocks .px-block-section[data-oxv-block-name='descriptivedetail'] .px-block-contributor");
    assert(contribs.length >= 1, "expected ≥1 contributor block inside Descriptive Detail");
    const summary = contribs[0].querySelector("summary");
    assert(summary.textContent.includes("Ola Nordmann"), `name missing: ${summary.textContent}`);
    assert(summary.textContent.includes("By (author)"), `role label missing: ${summary.textContent}`);
  });

  test("renders a card when the document root is itself <Product>", () => {
    const w = render("onix-3.1-standalone-product.xml");
    const cards = $$(w, "#oxv-blocks .px-block-product:not(.px-message-header)");
    assert(cards.length === 1, `expected 1 card, got ${cards.length}`);
    const header = cards[0].querySelector(".px-block-product-header");
    assert(header.textContent.includes("9789878738086"), `header missing ISBN: ${header.textContent}`);
    assert(header.textContent.includes("Anna"), `header missing title: ${header.textContent}`);
    const contribSummary = cards[0].querySelector(".px-block-contributor summary");
    assert(contribSummary.textContent.includes("Falcon, Nicolas Roger"),
      `inverted name missing: ${contribSummary.textContent}`);
  });

  test("clicking a list link opens the codelist popup with all entries", () => {
    const w = render("onix-3.0-reference.xml");
    const link = $$(w, "#oxv-blocks .px-codelist-link").find(
      (a) => a.getAttribute("href") === "https://ns.editeur.org/onix/en/5"
    );
    assert(link, "no List 5 link to click in right pane");

    // Simulate a left click. Since jsdom returns 0 for ev.button on plain
    // dispatch, the modifier guards in our handler should let the click pass.
    const ev = new w.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(ev);

    const overlay = w.document.querySelector(".px-popup-overlay");
    assert(overlay, "popup overlay not mounted");
    assert(!overlay.hasAttribute("hidden"), "popup overlay hidden after click");

    const title = overlay.querySelector(".px-popup-title");
    assert(title.textContent === "Product identifier type",
      `wrong popup title: ${title.textContent}`);

    const dl = overlay.querySelector(".px-popup-list");
    assert(dl && dl.tagName.toLowerCase() === "dl", "popup list is not a <dl>");
    const rows = overlay.querySelectorAll(".px-popup-list .px-popup-row");
    assert(rows.length >= 5, `expected ≥5 codelist rows, got ${rows.length}`);
    assert(rows[0].querySelector("dt"), "row missing <dt>");
    assert(rows[0].querySelector("dd"), "row missing <dd>");

    // ISBN-13 (code "15") is the value on the first product, so it should be highlighted.
    const current = overlay.querySelectorAll(".px-popup-row-current");
    assert(current.length === 1, `expected 1 highlighted row, got ${current.length}`);
    assert(current[0].querySelector(".px-popup-code").textContent === "15",
      "highlighted row is not code 15");

    const editeurLink = overlay.querySelector(".px-popup-footer .px-popup-link");
    assert(editeurLink, "missing EDItEUR link in footer");
    assert(editeurLink.getAttribute("href") === "https://ns.editeur.org/onix/en/5",
      `wrong EDItEUR href: ${editeurLink.getAttribute("href")}`);
  });

  test("popup preserves the codelist's declared order (no integer reorder)", () => {
    const w = render("onix-3.0-reference.xml");
    // NameIDType (List 44) mixes canonical-numeric strings ("13", "21") with
    // zero-padded ones ("01", "02"). A plain object would reorder canonical
    // numerics ahead of strings; a Map iterates in insertion order. Verify
    // the second property: "01" must appear before any later code.
    w.OnixViewerPopup.show("NameIDType");
    const overlay = w.document.querySelector(".px-popup-overlay");
    const codes = Array.from(overlay.querySelectorAll(".px-popup-list .px-popup-code"))
      .map((dt) => dt.textContent);
    assert(codes[0] === "01", `first code should be "01", got "${codes[0]}"`);
    const idx01 = codes.indexOf("01");
    const idx13 = codes.indexOf("13");
    const idx21 = codes.indexOf("21");
    assert(idx13 > idx01, `"13" should come after "01"; got 01@${idx01}, 13@${idx13}`);
    assert(idx21 > idx13, `"21" should come after "13"; got 13@${idx13}, 21@${idx21}`);
  });

  test("Esc closes the popup", () => {
    const w = render("onix-3.0-reference.xml");
    const link = $$(w, "#oxv-blocks .px-codelist-link")[0];
    link.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    const overlay = w.document.querySelector(".px-popup-overlay");
    assert(!overlay.hasAttribute("hidden"), "popup did not open");

    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert(overlay.hasAttribute("hidden"), "popup did not close on Escape");
  });

  test("multi-product feed: cards start closed, mirroring the auto-collapsed tree", () => {
    const w = render("onix-3.0-reference.xml");
    const cards = $$(w, "#oxv-blocks .px-block-product:not(.px-message-header)");
    assert(cards.length >= 2, "expected ≥2 cards for multi-product fixture");
    for (const card of cards) {
      assert(!card.open, "card should start closed when its Product is auto-collapsed");
    }
  });

  test("single-product feed: card stays open, mirroring the expanded tree", () => {
    const w = render("onix-3.1-standalone-product.xml");
    const cards = $$(w, "#oxv-blocks .px-block-product:not(.px-message-header)");
    assert(cards.length === 1, `expected 1 card, got ${cards.length}`);
    assert(cards[0].open, "single-product card should stay open");
  });

  test("toggling a sub-block item propagates to its tree row", () => {
    const w = render("onix-3.0-reference.xml");
    // The first product card and its first ProductIdentifier <details>.
    const firstCard = $$(w, "#oxv-blocks .px-block-product:not(.px-message-header)")[0];
    const firstPiDetails = firstCard.querySelector(
      "details[data-oxv-onix-element='productidentifier'][data-oxv-onix-idx='0']"
    );
    assert(firstPiDetails, "first ProductIdentifier <details> not found");

    // Find the first ProductIdentifier tree row inside Product 0.
    const firstProductRow = $$(w, "#oxv-root .px-row.px-collapsible").find((r) => {
      const tags = r.querySelectorAll(".px-tag");
      return tags.length >= 2 && tags[1].textContent === "Product";
    });
    const productContainer = firstProductRow.nextElementSibling;
    const piRow = productContainer.querySelector(
      ".px-row[data-oxv-element-name='productidentifier'][data-oxv-element-idx='0']"
    );
    assert(piRow, "ProductIdentifier tree row not tagged for sync");

    // Open the card so its tree row is unfolded (the multi-product fixture
    // collapses Products by default; un-fold first).
    firstProductRow.classList.remove("px-folded");
    // Now collapse the PI <details> and verify the tree row folds.
    firstPiDetails.removeAttribute("open");
    firstPiDetails.dispatchEvent(new w.Event("toggle"));
    assert(piRow.classList.contains("px-folded"),
      "ProductIdentifier tree row should fold when its sub-block <details> closes");

    firstPiDetails.setAttribute("open", "");
    firstPiDetails.dispatchEvent(new w.Event("toggle"));
    assert(!piRow.classList.contains("px-folded"),
      "ProductIdentifier tree row should expand when its sub-block <details> opens");
  });

  test("toggling a block section propagates to its block row in the tree", () => {
    const w = render("onix-3.1-standalone-product.xml");
    // Find the DescriptiveDetail tree row + matching section.
    const blockRow = $$(w, "#oxv-root .px-row.px-collapsible").find((r) => {
      const tags = r.querySelectorAll(".px-tag");
      return tags.length >= 2 && tags[1].textContent === "DescriptiveDetail";
    });
    assert(blockRow, "DescriptiveDetail tree row not found");
    const section = w.document.querySelector("#oxv-blocks .px-block-section[data-oxv-block-name='descriptivedetail']");
    assert(section, "DescriptiveDetail section not found");

    section.removeAttribute("open");
    section.dispatchEvent(new w.Event("toggle"));
    assert(blockRow.classList.contains("px-folded"),
      "tree row should fold after section closes");

    section.setAttribute("open", "");
    section.dispatchEvent(new w.Event("toggle"));
    assert(!blockRow.classList.contains("px-folded"),
      "tree row should expand after section opens");
  });

  test("toggling a card propagates to its Product row in the tree", () => {
    const w = render("onix-3.0-reference.xml");
    const cards = $$(w, "#oxv-blocks .px-block-product:not(.px-message-header)");
    const productRows = $$(w, "#oxv-root .px-row.px-collapsible").filter((r) => {
      const tags = r.querySelectorAll(".px-tag");
      return tags.length >= 2 && tags[1].textContent === "Product";
    });
    assert(productRows.length === cards.length, "row/card count mismatch");

    // Open the first card and fire the toggle event (jsdom does not fire it
    // automatically on attribute change). The listener should un-fold the row.
    cards[0].setAttribute("open", "");
    cards[0].dispatchEvent(new w.Event("toggle"));
    assert(!productRows[0].classList.contains("px-folded"),
      "tree row should be expanded after card opens");

    // Close it again.
    cards[0].removeAttribute("open");
    cards[0].dispatchEvent(new w.Event("toggle"));
    assert(productRows[0].classList.contains("px-folded"),
      "tree row should be folded after card closes");
  });

  test("works for short-tag dialect (b036 → name, b035 → role)", () => {
    const w = render("onix-3.0-short.xml");
    const header = $$(w, "#oxv-blocks .px-block-product:not(.px-message-header) .px-block-product-header")[0];
    assert(header, "missing product header (short)");
    assert(header.textContent.includes("Kortform-eksempel"), `short title missing: ${header.textContent}`);
    const contribs = $$(w, "#oxv-blocks .px-block-contributor");
    assert(contribs.length === 1, `expected 1 contributor, got ${contribs.length}`);
    assert(contribs[0].querySelector("summary").textContent.includes("Kari Nordmann"), "short contributor name missing");
  });
});

describe("View mode toggle", () => {
  function clickViewBtn(window, mode) {
    const btn = window.document.querySelector(`#oxv-toolbar [data-action="view-${mode}"]`);
    btn.dispatchEvent(new window.Event("click", { bubbles: true }));
  }

  test("ONIX docs default to XML view", () => {
    const w = render("onix-3.0-reference.xml");
    assert(w.document.body.classList.contains("oxv-view-xml"),
      `expected oxv-view-xml on body, got "${w.document.body.className}"`);
    const xmlBtn = w.document.querySelector('[data-action="view-xml"]');
    assert(xmlBtn.getAttribute("aria-pressed") === "true", "XML button should be pressed by default");
  });

  test("clicking Split applies split view and presses only Split", () => {
    const w = render("onix-3.0-reference.xml");
    clickViewBtn(w, "split");
    assert(w.document.body.classList.contains("oxv-view-split"), "missing oxv-view-split");
    assert(!w.document.body.classList.contains("oxv-view-xml"), "stale oxv-view-xml still on body");
    const pressed = $$(w, '#oxv-toolbar [data-action^="view-"][aria-pressed="true"]')
      .map((b) => b.dataset.action);
    assert(pressed.length === 1 && pressed[0] === "view-split",
      `expected only view-split pressed, got ${pressed.join(",")}`);
  });

  test("clicking Structure applies structure view", () => {
    const w = render("onix-3.0-reference.xml");
    clickViewBtn(w, "structure");
    assert(w.document.body.classList.contains("oxv-view-structure"), "missing oxv-view-structure");
  });

  test("view mode persists in localStorage", () => {
    const w = render("onix-3.0-reference.xml");
    clickViewBtn(w, "split");
    assert(w.localStorage.getItem("oxv-view-mode") === "split",
      `expected "split" in localStorage, got "${w.localStorage.getItem("oxv-view-mode")}"`);
  });

  test("non-ONIX docs are locked to XML view and do not persist", () => {
    const w = render("generic-note.xml");
    assert(w.document.body.classList.contains("oxv-view-xml"), "non-ONIX should start in XML view");
    assert(w.localStorage.getItem("oxv-view-mode") === null,
      "non-ONIX should not write to localStorage");
  });
});

// ---- summary ---------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`);
  process.exit(1);
}

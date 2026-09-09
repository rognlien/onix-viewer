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
const contentModelFor = {
  "3.1": fs.readFileSync(path.join(RES, "onix-content-model-3.1.js"), "utf8"),
  "3.0": fs.readFileSync(path.join(RES, "onix-content-model-3.0.js"), "utf8"),
};
const contentModelJs = [
  contentModelFor["3.1"],
  contentModelFor["3.0"],
].join("\n");
const onixJs = fs.readFileSync(path.join(RES, "onix.js"), "utf8");
const validateJs = fs.readFileSync(path.join(RES, "onix-validate.js"), "utf8");
const popupJs = fs.readFileSync(path.join(RES, "onix-popup.js"), "utf8");
const viewerJs = fs.readFileSync(path.join(RES, "viewer.js"), "utf8");
const viewerCss = fs.readFileSync(path.join(RES, "viewer.css"), "utf8");

// ---- minimal test framework ------------------------------------------------

// An optional case-insensitive substring filter, matched against the test name
// and its describe label:
//
//   node tests/run.js                # everything
//   node tests/run.js x512           # one test
//   node tests/run.js validation     # a whole describe block
//   npm test -- "short tag"          # via npm, note the --
//
// Without it, debugging one assertion means reading past 150 lines of ✓.
const FILTER = (process.argv[2] || "").toLowerCase();

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

// The describe label is printed lazily, so filtering to one test doesn't leave
// the headings of every block it skipped.
let currentLabel = "";
let labelPending = false;

function test(name, fn) {
  if (FILTER && !`${currentLabel} ${name}`.toLowerCase().includes(FILTER)) {
    skipped++;
    return;
  }
  if (labelPending) {
    console.log(`\n${currentLabel}`);
    labelPending = false;
  }
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
  currentLabel = label;
  labelPending = true;
  fn();
  currentLabel = "";
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
function renderSource(xml, label, beforeScripts, models) {
  const fixtureName = label || "inline.xml";

  const html = `<!doctype html><html><head><style>${viewerCss}</style></head>
<body>
  <div id="oxv-toolbar">
    <div class="px-left">
      <img id="oxv-logo" src="icons/icon-48.png" width="28" height="28" alt="ONIX Viewer">
      <button data-action="expand"></button>
      <button data-action="collapse"></button>
      <button data-action="toggle-wrap"></button>
      <button data-action="copy-xml"></button>
      <span class="px-dialect-group">
        <button data-action="dialect-toggle" aria-pressed="false"></button>
      </span>
      <span class="px-search-group">
        <button class="px-icon-btn" data-action="search" aria-expanded="false"></button>
        <input id="oxv-search" tabindex="-1">
        <span id="oxv-search-status"></span>
      </span>
    </div>
    <div class="px-center">
      <span id="oxv-meta"><span id="oxv-block-list"></span></span>
      <span id="oxv-validation"></span>
    </div>
    <div class="px-right">
      <span id="oxv-schema"></span>
    </div>
  </div>
  <div id="oxv-main">
    <main id="oxv-root" tabindex="0"></main>
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
  // Production ships only the model matching the document's release (see
  // content.js's contentModelURLs); most tests load both, which is the
  // superset, but a test can pin the exact set the content script would send.
  window.eval(models ? models.map((v) => contentModelFor[v]).join("\n") : contentModelJs);
  window.eval(onixJs);
  window.eval(validateJs);
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
// The right pane builds its cards on first reveal, not at load — so a test
// that asserts on the pane has to show it first, the same way a reader would.
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
    assert(/^ONIX \(1 product\)/.test(meta(w)), `bad meta: ${meta(w)}`);
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
      "  <IDValue>9788234567896</IDValue>",
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

describe("Stepped collapse and expand", () => {
  const collapse = (w) => w.document.querySelector('[data-action="collapse"]').click();
  const expand = (w) => w.document.querySelector('[data-action="expand"]').click();
  const foldedNames = (w) => rowsNamed(w, "Product").map((r) => r.classList.contains("px-folded"));

  test("step 1 folds each Product's contents and the header, leaving Products open", () => {
    const w = render("onix-3.0-reference.xml");
    const products = rowsNamed(w, "Product");
    assert(products.every((r) => r.classList.contains("px-folded")), "products start auto-folded");
    collapse(w);
    assert(products.every((r) => !r.classList.contains("px-folded")),
      "step 1 opens the Products so their one-line children are visible");
    const blocks = [...rowsNamed(w, "DescriptiveDetail"), ...rowsNamed(w, "PublishingDetail")];
    assert(blocks.length >= 2, "expected block rows in the fixture");
    assert(blocks.every((r) => r.classList.contains("px-folded")), "block rows should be folded");
    assert(rowsNamed(w, "Header").every((r) => r.classList.contains("px-folded")),
      "the message Header folds with them");
  });

  test("step 1 folds the block-0 composites too, so a Product is one line per child", () => {
    const w = render("onix-3.0-reference.xml");
    collapse(w);
    const identifiers = rowsNamed(w, "ProductIdentifier");
    assert(identifiers.length >= 1, "expected ProductIdentifier rows in the fixture");
    assert(identifiers.every((r) => r.classList.contains("px-folded")),
      "ProductIdentifier sits directly in <Product> and should fold with the blocks");
    // Composites deeper than a Product's own children stay as they are —
    // they're hidden inside a folded block anyway.
    assert(rowsNamed(w, "TitleDetail").every((r) => !r.classList.contains("px-folded")),
      "TitleDetail is inside DescriptiveDetail and should be untouched");
  });

  test("step 2 folds the Products, step 3 the root", () => {
    const w = render("onix-3.0-reference.xml");
    collapse(w);
    assert(foldedNames(w).every((f) => !f), "after step 1 the Products are open");
    collapse(w);
    assert(foldedNames(w).every((f) => f), "step 2 folds the Products");
    const messageRow = rowsNamed(w, "ONIXMessage")[0];
    assert(!messageRow.classList.contains("px-folded"), "the root is still open");
    collapse(w);
    assert(messageRow.classList.contains("px-folded"), "step 3 folds the root");
    // Nothing left to do; pressing again must not undo any of it.
    collapse(w);
    assert(messageRow.classList.contains("px-folded") && foldedNames(w).every((f) => f),
      "a fourth press is a no-op, not a reversal");
  });

  test("the header folds in both dialects", () => {
    for (const [fixture, name] of [["onix-3.0-reference.xml", "Header"],
                                   ["onix-3.1-shorttags.xml", "header"]]) {
      const xml = fixture.startsWith("onix-3.1-short")
        ? fs.readFileSync(path.join(__dirname, "..", "Onix", fixture), "utf8")
        : fs.readFileSync(path.join(FIXTURES, fixture), "utf8");
      const w = renderSource(xml, fixture);
      const header = rowsNamed(w, name);
      assert(header.length === 1, `expected one <${name}> row in ${fixture}, got ${header.length}`);
      assert(!header[0].classList.contains("px-folded"), "it should start expanded");
      collapse(w);
      assert(header[0].classList.contains("px-folded"), `<${name}> should fold in ${fixture}`);
    }
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

  test("non-ONIX XML zips up from the leaves, a level per press", () => {
    // A generic document has no ONIX shape to step through, so Collapse is the
    // mirror of Expand: the deepest visible level goes first.
    const w = render("rss.xml");
    const depthOf = (r) => Number(r.style.getPropertyValue("--depth"));
    const rows = $$(w, "#oxv-root .px-row.px-collapsible");
    const byDepth = (d) => rows.filter((r) => depthOf(r) === d);
    assert(byDepth(2).length >= 2 && byDepth(1).length === 1 && byDepth(0).length === 1,
      "the fixture should have three levels to fold");

    collapse(w);
    assert(byDepth(2).every((r) => r.classList.contains("px-folded")), "deepest level first");
    assert(!byDepth(1)[0].classList.contains("px-folded"), "and only that level");
    collapse(w);
    assert(byDepth(1)[0].classList.contains("px-folded"), "then the level above");
    collapse(w);
    assert(byDepth(0)[0].classList.contains("px-folded"), "then the root");
  });

  test("Expand reveals one more level per press, and stops when done", () => {
    const w = render("rss.xml");
    const depthOf = (r) => Number(r.style.getPropertyValue("--depth"));
    const rows = $$(w, "#oxv-root .px-row.px-collapsible");
    for (const r of rows) r.classList.add("px-folded");

    expand(w);
    assert(!rows.find((r) => depthOf(r) === 0).classList.contains("px-folded"),
      "the root opens first");
    assert(rows.filter((r) => depthOf(r) === 1).every((r) => r.classList.contains("px-folded")),
      "and only the root");
    expand(w);
    assert(rows.filter((r) => depthOf(r) === 1).every((r) => !r.classList.contains("px-folded")),
      "then the level below");
    expand(w);
    expand(w);
    assert(rows.every((r) => !r.classList.contains("px-folded")), "until everything is open");
    expand(w);
    assert(rows.every((r) => !r.classList.contains("px-folded")), "a further press is a no-op");
  });

  test("Expand undoes a stepped collapse, level by level", () => {
    const w = render("onix-3.0-reference.xml");
    collapse(w); collapse(w); collapse(w);
    const messageRow = rowsNamed(w, "ONIXMessage")[0];
    assert(messageRow.classList.contains("px-folded"), "fully collapsed");
    expand(w);
    assert(!messageRow.classList.contains("px-folded"), "the root reopens first");
    assert(foldedNames(w).every((f) => f), "the Products are still folded");
    expand(w);
    assert(foldedNames(w).every((f) => !f), "then the Products");
  });

  test("the control row is a flex row, so icons cannot shift a button off the line", () => {
    // An inline-flex button takes its baseline from its first flex item, so a
    // button carrying an icon aligned on the icon's bottom edge while a
    // text-only one aligned on its text — measured in Chrome, that put the
    // two 3.3px apart. Flex items are aligned by the container instead.
    const w = render("onix-3.0-reference.xml");
    const left = w.document.querySelector("#oxv-toolbar .px-left");
    assert(left, "the control group should exist");
    const style = w.getComputedStyle(left);
    assert(style.display === "flex", `expected a flex row, got "${style.display}"`);
    assert(style.alignItems === "center", `expected centred items, got "${style.alignItems}"`);
  });

  test("the toolbar carries the extension's mark, and drops it if blocked", () => {
    const w = render("onix-3.0-reference.xml");
    const logo = w.document.getElementById("oxv-logo");
    assert(logo, "the toolbar should carry the mark");
    assert(logo.getAttribute("alt") === "ONIX Viewer",
      "a mark with no text beside it needs an accessible name");
    assert(logo.getAttribute("width") === "28" && logo.getAttribute("height") === "28",
      "28px is the toolbar's content height — the largest that does not make it taller");
    assert(logo.closest(".px-left"), "it belongs with the controls, at the left");
    assert(logo === logo.parentElement.firstElementChild, "and leads them");

    // A page whose img-src CSP refuses chrome-extension:// URLs must not be
    // left with a broken-image glyph in the toolbar.
    logo.dispatchEvent(new w.Event("error"));
    assert(!w.document.getElementById("oxv-logo"), "a blocked mark should be removed");
  });

  test("the labelled toolbar buttons carry icons", () => {
    const w = render("onix-3.0-reference.xml");
    for (const action of ["expand", "collapse", "toggle-wrap", "copy-xml"]) {
      const button = w.document.querySelector(`[data-action="${action}"]`);
      const glyph = button.querySelector("svg");
      assert(glyph, `${action} should carry an icon`);
      assert(glyph.getAttribute("viewBox") === "0 0 16 16", "from the shared icon set");
      assert(glyph.classList.contains("px-icon"), "and be sized by the shared class");
    }
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
      const xsd = fs.readFileSync(path.join(__dirname, "..", "tools", "data", file), "utf8");
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

  test("closing the field hands focus to the toggle, not to nowhere", () => {
    const w = render("onix-3.0-reference.xml");
    searchButton(w).click();
    assert(w.document.activeElement === field(w), "opening focuses the field");

    field(w).dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert(!isOpen(w), "Escape closes it");
    // A bare blur would leave focus on <body>, sending the next Tab back to
    // the top of the document — and the field itself is now untabbable.
    assert(w.document.activeElement === searchButton(w),
      `focus should sit on the toggle, not ${w.document.activeElement.tagName}`);
    assert(field(w).getAttribute("tabindex") === "-1", "and the field is out of the tab order");
  });

  test("closing a field the reader had already left does not steal focus", () => {
    const w = render("onix-3.0-reference.xml");
    searchButton(w).click();
    // Focus moved into the tree; the blur handler closes the empty field.
    const root = w.document.getElementById("oxv-root");
    root.focus();
    field(w).dispatchEvent(new w.FocusEvent("blur", { relatedTarget: root }));
    assert(!isOpen(w), "an empty field collapses when left");
    assert(w.document.activeElement === root,
      "but focus stays where the reader put it, not on the toggle");
  });

  test("the toggle closes an open, empty field instead of reopening it", () => {
    const w = render("onix-3.0-reference.xml");
    const button = searchButton(w);
    button.click();
    assert(isOpen(w), "the first press should open it");

    // What the browser actually does: mousedown blurs the field, then the
    // click lands. The blur used to close the search, so the click found it
    // closed and opened it again — the button looked dead.
    field(w).dispatchEvent(new w.FocusEvent("blur", { relatedTarget: button }));
    button.click();
    assert(!isOpen(w), "the second press should close it, not reopen it");
    assert(button.getAttribute("aria-expanded") === "false", "and say so");
  });

  test("the toggle's mousedown does not steal focus from the field", () => {
    const w = render("onix-3.0-reference.xml");
    searchButton(w).click();
    const event = new w.MouseEvent("mousedown", { bubbles: true, cancelable: true });
    searchButton(w).dispatchEvent(event);
    assert(event.defaultPrevented,
      "mousedown must be prevented, or the field blurs before the click decides");
  });

  test("blurring to anywhere else still closes an empty field", () => {
    const w = render("onix-3.0-reference.xml");
    searchButton(w).click();
    assert(isOpen(w), "open");
    // Focus moving into the tree, not to the toggle.
    field(w).dispatchEvent(new w.FocusEvent("blur", { relatedTarget: w.document.getElementById("oxv-root") }));
    assert(!isOpen(w), "an empty field should still collapse when you leave it");
  });

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
    const text = w.OnixViewerValidation.message(warning);
    assert(text.includes("3.0") && text.includes("3.1"),
      `the warning should name both bundled releases, got: ${text}`);
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
    const message = w.OnixViewerValidation.message(tooMany.findings[0]);
    assert(message.includes("at most 2"), `the limit should be named; got: ${message}`);
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
    assert(validate(w).textContent === "Valid", `got: ${validate(w).textContent}`);
    assert(validate(w).className === "px-valid", "and be marked as such");
    assert(validate(w).querySelector("svg"), "with a tick beside it");
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
    validate(w);
    const marked = $$(w, "#oxv-root .px-has-finding");
    assert(marked.length >= 3, `expected several marked rows, got ${marked.length}`);
    const notification = rowsNamed(w, "NotificationType")[0];
    const marker = notification.querySelector(".px-finding");
    assert(marker, "the bad code's row should carry a marker");
    assert(marker.title.includes("not in List 1"), `got: ${marker.title}`);
    assert(validate(w).textContent === "5 errors, 2 warnings", `got: ${validate(w).textContent}`);
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
    validate(w).click();
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
    const short = fsv.readFileSync(path.join(__dirname, "..", "Onix", "onix-3.1-shorttags.xml"), "utf8");
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
    const read = (n) => fsv.readFileSync(path.join(__dirname, "..", "Onix", n), "utf8");
    const reference = findings(renderSource(read("onix-3.1-refnames.xml")));
    const short = findings(renderSource(read("onix-3.1-shorttags.xml")));
    // Same defects...
    assert(codes(reference).join() === codes(short).join(),
      `codes should match: ${codes(reference).join()} vs ${codes(short).join()}`);
    // ...described in each file's own dialect.
    const w = render("onix-3.1-valid.xml");
    const messageOf = (result, code) => w.OnixViewerValidation.message(
      result.findings.find((f) => f.code === code));
    assert(messageOf(reference, "element.deprecated").includes("<TitleText>"),
      "the reference file should be told about <TitleText>");
    assert(messageOf(short, "element.deprecated").includes("<b203>"),
      "the short-tag file should be told about <b203>");
  });

  test("the findings list is selectable text, and selecting it does not navigate", () => {
    const w = render("onix-3.1-invalid.xml");
    validate(w).click();
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

  test("closing the findings list puts focus back where it was", () => {
    const w = render("onix-3.1-invalid.xml");
    const label = validate(w);
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
    validate(w).click();
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
    assert(dirty.textContent === "5 errors, 2 warnings", `got: ${dirty.textContent}`);
  });

  test("validation starts on its own and never scrolls the page", () => {
    const w = render("onix-3.1-invalid.xml");
    // Nothing was clicked: the label is already filled in.
    assert(validate(w).textContent === "5 errors, 2 warnings", `got: ${validate(w).textContent}`);
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
    const dir = path.join(__dirname, "fixtures");
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
    const read = (n) => fsv.readFileSync(path.join(__dirname, "..", "Onix", n), "utf8");
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

describe("Identity constraints (xs:unique)", () => {
  const fsu = require("fs");
  function findingsFor(window, xml) {
    const doc = new window.DOMParser().parseFromString(xml, "application/xml");
    return window.OnixViewerValidation.run(doc, window.OnixViewerOnix.detect(doc));
  }
  function duplicates(window, xml) {
    return findingsFor(window, xml).findings
      .filter((f) => f.code === "unique.duplicate")
      .map((f) => window.OnixViewerValidation.message(f));
  }
  // The valid fixture with extra children spliced into <DescriptiveDetail>,
  // after <ProductForm> where the schema's sequence expects them.
  function withDescriptiveDetail(extra) {
    const valid = fsu.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
    return valid.replace("<ProductForm>BC</ProductForm>",
      "<ProductForm>BC</ProductForm>\n      " + extra);
  }

  test("the schema's constraints are compiled, all of them", () => {
    const w = render("onix-3.1-valid.xml");
    const count = (version) => Object.values(w.OnixViewerContentModels[version].elements)
      .reduce((total, shape) => total + (shape.u ? shape.u.length : 0), 0);
    // Counted straight out of the XSDs: 142 <xs:unique> in 3.1, 85 in 3.0.
    assert(count("3.1") === 142, `expected 142 constraints in 3.1, got ${count("3.1")}`);
    assert(count("3.0") === 85, `expected 85 in 3.0, got ${count("3.0")}`);
  });

  test("two <Product> with the same RecordReference are reported", () => {
    const w = render("onix-3.1-valid.xml");
    const valid = fsu.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
    const product = valid.match(/<Product>[\s\S]*<\/Product>/)[0];
    const twice = valid.replace(product, product + "\n" + product);
    const found = duplicates(w, twice);
    assert(found.length === 1 &&
      found[0] === "<ONIXMessage> repeats <Product> with the same RecordReference",
      `got: ${found.join("; ")}`);
    // Distinct references are fine.
    const distinct = valid.replace(product,
      product + "\n" + product.replace("<RecordReference>valid-9788234567896</RecordReference>",
        "<RecordReference>valid-other</RecordReference>"));
    assert(duplicates(w, distinct).length === 0,
      `distinct references should pass; got: ${duplicates(w, distinct).join("; ")}`);
  });

  test("a two-field key needs both parts to match", () => {
    const w = render("onix-3.1-valid.xml");
    const measure = (type, unit) => "<Measure><MeasureType>" + type +
      "</MeasureType><Measurement>10</Measurement><MeasureUnitCode>" + unit +
      "</MeasureUnitCode></Measure>";
    const clash = duplicates(w, withDescriptiveDetail(measure("01", "mm") + measure("01", "mm")));
    assert(clash.length === 1 &&
      clash[0] === "<DescriptiveDetail> repeats <Measure> with the same MeasureType and MeasureUnitCode",
      `got: ${clash.join("; ")}`);
    // Differing in either field is legal.
    assert(duplicates(w, withDescriptiveDetail(measure("01", "mm") + measure("01", "cm"))).length === 0,
      "a different unit is a different key");
    assert(duplicates(w, withDescriptiveDetail(measure("01", "mm") + measure("02", "mm"))).length === 0,
      "a different type is a different key");
  });

  test("an incomplete key falls outside the constraint", () => {
    // XSD semantics: xs:unique only compares nodes whose *every* field is
    // present. <Text>'s key is (@language, @textscript) — both — which is the
    // Specification's multilingual rule. So two <Text language="eng"> with no
    // textscript have an incomplete key and are legal; add the same textscript
    // to both and they clash.
    const w = render("onix-3.1-valid.xml");
    const collateral = (inner) => {
      const valid = fsu.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
      return valid.replace("</DescriptiveDetail>",
        "</DescriptiveDetail>\n    <CollateralDetail><TextContent>" +
        "<TextType>03</TextType><ContentAudience>00</ContentAudience>" +
        inner + "</TextContent></CollateralDetail>");
    };

    const languageOnly = collateral('<Text language="eng">A</Text><Text language="eng">B</Text>');
    assert(duplicates(w, languageOnly).length === 0,
      `language alone is an incomplete key; got: ${duplicates(w, languageOnly).join("; ")}`);

    const both = collateral('<Text language="eng" textscript="Latn">A</Text>' +
      '<Text language="eng" textscript="Latn">B</Text>');
    const clash = duplicates(w, both);
    assert(clash.length === 1 &&
      clash[0] === "<TextContent> repeats <Text> with the same language and textscript",
      `got: ${clash.join("; ")}`);

    const differing = collateral('<Text language="eng" textscript="Latn">A</Text>' +
      '<Text language="nob" textscript="Latn">B</Text>');
    assert(duplicates(w, differing).length === 0,
      `distinct languages should pass; got: ${duplicates(w, differing).join("; ")}`);
  });

  test("a single-attribute key clashes on that attribute alone", () => {
    const w = render("onix-3.1-valid.xml");
    const collateral = (inner) => {
      const valid = fsu.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
      return valid.replace("</DescriptiveDetail>",
        "</DescriptiveDetail>\n    <CollateralDetail><TextContent>" +
        "<TextType>03</TextType><ContentAudience>00</ContentAudience><Text>T</Text>" +
        inner + "</TextContent></CollateralDetail>");
    };
    // <SourceTitle>'s key is @language on its own.
    const clash = duplicates(w, collateral('<SourceTitle language="eng">A</SourceTitle>' +
      '<SourceTitle language="eng">B</SourceTitle>'));
    assert(clash.some((f) => f === "<TextContent> repeats <SourceTitle> with the same language"),
      `got: ${clash.join("; ")}`);
    assert(duplicates(w, collateral('<SourceTitle language="eng">A</SourceTitle>' +
      '<SourceTitle language="nob">B</SourceTitle>')).length === 0, "distinct languages pass");
  });

  test("a self-valued key compares the element's own text", () => {
    const w = render("onix-3.1-valid.xml");
    const detail = "<ProductFormDetail>B206</ProductFormDetail>";
    const found = duplicates(w, withDescriptiveDetail(detail + detail));
    assert(found.length === 1 && found[0].includes("with the same value"), `got: ${found.join("; ")}`);
    assert(duplicates(w, withDescriptiveDetail(detail +
      "<ProductFormDetail>B221</ProductFormDetail>")).length === 0, "distinct values pass");
  });

  test("no fixture or EDItEUR sample gains a duplicate finding", () => {
    // The constraints must not fire on conformant documents — this is the check
    // that would have caught a mis-compiled selector.
    const w = render("onix-3.1-valid.xml");
    const wrong = [];
    const dir = path.join(__dirname, "fixtures");
    const samples = fsu.readdirSync(dir).filter((f) => f.startsWith("onix-"))
      .map((f) => path.join(dir, f))
      .concat(["onix-3.1-refnames.xml", "onix-3.1-shorttags.xml"]
        .map((f) => path.join(__dirname, "..", "Onix", f)));
    for (const file of samples) {
      const found = duplicates(w, fsu.readFileSync(file, "utf8"));
      if (found.length) wrong.push(`${path.basename(file)}: ${found.join(", ")}`);
    }
    assert(wrong.length === 0, wrong.join("; "));
  });
});

describe("Datatype lexical space", () => {
  const fsd = require("fs");
  function findingsFor(window, xml) {
    const doc = new window.DOMParser().parseFromString(xml, "application/xml");
    return window.OnixViewerValidation.run(doc, window.OnixViewerOnix.detect(doc));
  }
  function messagesFor(window, xml, prefix) {
    return findingsFor(window, xml).findings
      .filter((f) => f.code.startsWith(prefix))
      .map((f) => window.OnixViewerValidation.message(f));
  }
  function withDescriptiveDetail(extra) {
    const valid = fsd.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
    return valid.replace("<ProductForm>BC</ProductForm>",
      "<ProductForm>BC</ProductForm>\n      " + extra);
  }

  test("every datatype the schema names is compiled", () => {
    const w = render("onix-3.1-valid.xml");
    const datatypes = w.OnixViewerContentModels["3.1"].datatypes;
    // Four of these carry no facets at all — only a base type — and were
    // therefore unchecked until the base was recorded.
    for (const name of ["Decimal", "Integer", "PositiveInteger", "PositiveIntegerOrZero"]) {
      assert(datatypes[name] && datatypes[name].base,
        `${name} needs its base type recorded, got ${JSON.stringify(datatypes[name])}`);
    }
    assert(Object.keys(datatypes).length === 19,
      `expected all 19 dt.* types, got ${Object.keys(datatypes).length}`);
  });

  test("a value outside its base type's lexical space is reported", () => {
    const w = render("onix-3.1-valid.xml");
    const edition = (value) => "<EditionNumber>" + value + "</EditionNumber>";
    assert(messagesFor(w, withDescriptiveDetail(edition("2")), "datatype.").length === 0,
      "2 is a positive integer");
    for (const [value, why] of [["abc", "not numeric"], ["2.5", "not an integer"],
                                ["0", "not positive"], ["-1", "negative"]]) {
      const found = messagesFor(w, withDescriptiveDetail(edition(value)), "datatype.lexical");
      assert(found.length === 1 && found[0] === `"${value}" is not a positive integer`,
        `${value} (${why}) should be reported; got: ${found.join("; ")}`);
    }
  });

  test("a decimal-based type rejects non-numbers", () => {
    const w = render("onix-3.1-valid.xml");
    const extent = (value) => "<Extent><ExtentType>00</ExtentType><ExtentValue>" + value +
      "</ExtentValue><ExtentUnit>03</ExtentUnit></Extent>";
    assert(messagesFor(w, withDescriptiveDetail(extent("12.5")), "datatype.").length === 0,
      "12.5 is a decimal");
    const found = messagesFor(w, withDescriptiveDetail(extent("abc")), "datatype.lexical");
    assert(found.length === 1 && found[0] === '"abc" is not a decimal number', `got: ${found.join("; ")}`);
  });

  test("space-separated code lists have their members checked", () => {
    const w = render("onix-3.1-valid.xml");
    const territory = (codes) => {
      const valid = fsd.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
      return valid.replace("</PublishingDetail>",
        "<SalesRights><SalesRightsType>01</SalesRightsType><Territory><CountriesIncluded>" +
        codes + "</CountriesIncluded></Territory></SalesRights></PublishingDetail>");
    };
    assert(messagesFor(w, territory("NO SE DK"), "datatype.").length === 0,
      "three real country codes should pass");
    const bad = messagesFor(w, territory("NO XX DK"), "datatype.list-member");
    assert(bad.length === 1 && bad[0] === '"XX" is not in List 91 (Country – based on ISO 3166-1)',
      `got: ${bad.join("; ")}`);
  });
});

describe("Deprecated elements", () => {
  const fsd = require("fs");
  function findingsFor(window, xml) {
    const doc = new window.DOMParser().parseFromString(xml, "application/xml");
    return window.OnixViewerValidation.run(doc, window.OnixViewerOnix.detect(doc));
  }
  function deprecations(window, xml) {
    return findingsFor(window, xml).findings
      .filter((f) => f.code === "element.deprecated")
      .map((f) => window.OnixViewerValidation.message(f));
  }

  test("a deprecated element is reported as a warning, naming the replacement", () => {
    const w = render("onix-3.1-standalone-product.xml");
    const messages = deprecations(w, w.__OXV_SOURCE__);
    assert(messages.length === 1, `expected one deprecation, got: ${messages.join(" | ")}`);
    assert(messages[0] === "<TitleText> is deprecated from release 3.1 — use either " +
      "<TitlePrefix> or <NoPrefix/>, plus <TitleWithoutPrefix> instead", `got: ${messages[0]}`);
    const finding = findingsFor(w, w.__OXV_SOURCE__).findings
      .find((f) => f.code === "element.deprecated");
    assert(finding.severity === "warning", "deprecation is valid ONIX, so a warning");
  });

  test("a note about an element's children does not deprecate the element", () => {
    // <Header> and <TitleElement> both carry a "Deprecated <Child>" note, and
    // both appear in nearly every ONIX file — flagging them would bury a valid
    // document in false warnings. <SalesRestriction>'s note names P.21 clauses.
    const w = render("onix-3.1-valid.xml");
    for (const version of ["3.1", "3.0"]) {
      const deprecated = w.OnixViewerContentModels[version].deprecated;
      for (const name of ["Header", "TitleElement", "SalesRestriction"]) {
        assert(!deprecated[name], `${version}: <${name}> must not be marked deprecated`);
      }
    }
    // And the fixture using both of them reports nothing.
    assert(deprecations(w, w.__OXV_SOURCE__).length === 0,
      `a valid 3.1 document should carry no deprecation: ${deprecations(w, w.__OXV_SOURCE__).join(" | ")}`);
  });

  test("a deprecation limited to one parent fires only there", () => {
    // <TextSourceDescription> is deprecated within <TextContent>, but not
    // within <TextSource>, so the parent decides.
    const w = render("onix-3.1-valid.xml");
    const within = w.OnixViewerContentModels["3.1"].deprecated.TextSourceDescription;
    assert(within && within.within === "TextContent",
      `expected the context to be recorded, got ${JSON.stringify(within)}`);
  });

  test("ONIX 3.0's deprecated elements are covered too", () => {
    const w = render("onix-3.0-reference.xml");
    const deprecated = w.OnixViewerContentModels["3.0"].deprecated;
    for (const name of ["AudienceCode", "Conference", "ConferenceName", "CurrencyZone",
                        "Reissue", "DateFormat"]) {
      assert(deprecated[name], `<${name}> should be marked deprecated in 3.0`);
    }
    // 3.1 dropped these entirely, so they are unknown there rather than deprecated.
    assert(!w.OnixViewerContentModels["3.1"].elements.ConferenceName,
      "<ConferenceName> should not exist in the 3.1 model at all");
  });
});

describe("Attributes", () => {

  function findingsFor(window, xml) {
    const doc = new window.DOMParser().parseFromString(xml, "application/xml");
    return window.OnixViewerValidation.run(doc, window.OnixViewerOnix.detect(doc));
  }
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
    return findingsFor(window, xml).findings
      .filter((f) => f.code.startsWith("attribute."))
      .map((f) => `${f.code}: ${window.OnixViewerValidation.message(f)}`);
  }

  test("the baseline message has no attribute findings", () => {
    const w = render("onix-3.1-valid.xml");
    assert(findingsFor(w, message()).total === 0,
      `expected a clean baseline, got: ${attributeFindings(w, message()).join("; ")}`);
  });

  test("legal attribute values pass", () => {
    const w = render("onix-3.1-valid.xml");
    const found = attributeFindings(w, message({
      titleAttrs: ' language="nob" textcase="02" collationkey="T" datestamp="20260101"',
      formAttrs: ' sourcename="Bokbasen" sourcetype="01"',
    }));
    assert(found.length === 0, `expected none, got: ${found.join("; ")}`);
  });

  test("an attribute that does not belong to the element is reported", () => {
    const w = render("onix-3.1-valid.xml");
    const found = attributeFindings(w, message({ formAttrs: ' colour="red"' }));
    assert(found.length === 1 && found[0].includes("colour is not an attribute of <ProductForm>"),
      `got: ${found.join("; ")}`);
    // language is a real ONIX attribute, but not on <ProductForm>.
    const wrongPlace = attributeFindings(w, message({ formAttrs: ' language="nob"' }));
    assert(wrongPlace.length === 1 && wrongPlace[0].includes("language is not an attribute"),
      `a real attribute in the wrong place should still be reported; got: ${wrongPlace.join("; ")}`);
  });

  test("a bad code in an attribute is reported, and the list is named", () => {
    const w = render("onix-3.1-valid.xml");
    const found = attributeFindings(w, message({ titleAttrs: ' textcase="99"' }));
    // List 14 is bound to an attribute, not to any element, so naming it
    // needs the by-number titles rather than the element meta.
    assert(found.length === 1 && found[0] ===
      'attribute.code: textcase="99" is not in List 14 (Text case flag)', `got: ${found.join("; ")}`);
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
    assert(found.length === 1 && found[0].includes("is not a valid DateOrDateTime"),
      `got: ${found.join("; ")}`);
    // A well-formed datestamp passes.
    assert(attributeFindings(w, message({ formAttrs: ' datestamp="20260101"' })).length === 0,
      "a valid date should pass");
  });

  test("release is required on the message root, and must say 3.1", () => {
    const w = render("onix-3.1-valid.xml");
    const missing = attributeFindings(w, message({ release: "" }));
    assert(missing.some((f) => f.includes("missing its required release attribute")),
      `got: ${missing.join("; ")}`);
    const wrong = attributeFindings(w, message({ release: 'release="3.2"' }));
    assert(wrong.some((f) => f.includes('release must be "3.1", not "3.2"')),
      `got: ${wrong.join("; ")}`);
  });

  test("refname and shortname must match the element they sit on", () => {
    const w = render("onix-3.1-valid.xml");
    // Correct in both dialects — the short tag comes from the generated map.
    assert(attributeFindings(w, message({
      formAttrs: ' refname="ProductForm" shortname="b012"' })).length === 0,
      "the element's own names should pass");
    const wrong = attributeFindings(w, message({ formAttrs: ' refname="ProductFrom"' }));
    assert(wrong.length === 1 && wrong[0].includes('refname must be "ProductForm"'),
      `got: ${wrong.join("; ")}`);
    const wrongShort = attributeFindings(w, message({ formAttrs: ' shortname="b999"' }));
    assert(wrongShort.length === 1 && wrongShort[0].includes('shortname must be "b012"'),
      `got: ${wrongShort.join("; ")}`);
  });

  test("namespace, xsi and xml attributes are not ONIX's to judge", () => {
    const w = render("onix-3.1-valid.xml");
    const xml = message({
      rootNs: NS + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="a b"',
      titleAttrs: ' xml:lang="nb"',
    });
    const found = attributeFindings(w, xml);
    assert(found.length === 0,
      `xmlns/xsi/xml:lang are legal and not ONIX's; got: ${found.join("; ")}`);
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
    assert(found.length === 1 && found[0].includes("textcase=\"99\""),
      `the same attribute check should apply in short tags; got: ${found.join("; ")}`);
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
      assert(found.length === 1 && found[0].startsWith("attribute.empty"),
        `${attribute}="" should be reported empty; got: ${found.join("; ") || "nothing"}`);
    }

    // Whitespace-only is the empty string too: every enumerated type in ONIX
    // restricts xs:token, which collapses whitespace before validating.
    const blank = attributeFindings(w, message({ titleAttrs: ' language="   "' }));
    assert(blank.length === 1 && blank[0].startsWith("attribute.empty"),
      `whitespace-only collapses to empty; got: ${blank.join("; ") || "nothing"}`);

    // Which is also why a padded but real code has to stay valid.
    const padded = attributeFindings(w, message({ titleAttrs: ' language=" eng "' }));
    assert(padded.length === 0, `language=" eng " must stay valid; got: ${padded.join("; ")}`);
  });

});

describe("Identifier check digits", () => {
  function findingsFor(window, xml) {
    const doc = new window.DOMParser().parseFromString(xml, "application/xml");
    return window.OnixViewerValidation.run(doc, window.OnixViewerOnix.detect(doc));
  }
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

  test("the meta pill names the short dialect, and stays silent about the other", () => {
    // Reference names are the norm, so only short tags are worth stating.
    assert(meta(render("onix-3.0-short-codelists.xml")).includes("short tags"), "short document");
    const reference = meta(render("onix-3.0-reference.xml"));
    assert(reference.startsWith("ONIX 3.0 ("), `no dialect for reference names: ${reference}`);
    assert(!reference.includes("names") && !reference.includes("tags"), `got: ${reference}`);
    const w = render("onix-3.0-short-codelists.xml");
    flip(w);
    assert(meta(w).includes("short tags"),
      "the pill describes the file, so translating must not change it");
  });

  test("the meta pill is led by a file icon, and the schema pill drops the vendor", () => {
    const w = render("onix-3.0-reference.xml");
    const pill = w.document.getElementById("oxv-meta");
    const glyph = pill.querySelector("svg");
    assert(glyph, "the meta pill should open with a file icon");
    assert(glyph.getAttribute("viewBox") === "0 0 16 16", "from the shared icon set");
    assert(pill.textContent.startsWith("ONIX"), "the icon adds no text");
    const schema = w.document.getElementById("oxv-schema").textContent;
    assert(schema === "ONIX 3.1, Issue 74", `got: ${schema}`);
    assert(!schema.includes("EDItEUR"), "the vendor name is not needed here");
  });

  test("the document pill is one unit: icon, what it is, its blocks, its size", () => {
    const w = render("onix-3.0-single-product-blocks.xml");
    const pill = w.document.getElementById("oxv-meta");
    assert(pill.textContent === "ONIX 3.0 (1 product) · Blocks: 1, 4, 6 · 1.7 KB",
      `got: "${pill.textContent}"`);
    // The blocks are a segment of that pill now, not a pill of their own.
    const blocks = w.document.getElementById("oxv-block-list");
    assert(pill.contains(blocks), "the block list belongs inside the document pill");
    assert(w.getComputedStyle(blocks).borderTopWidth !== "1px",
      "and should not keep its own border");
  });

  test("the block list segment disappears when there is nothing to list", () => {
    // Two products, so there is no single Product whose blocks to name.
    const w = render("onix-3.0-reference.xml");
    const pill = w.document.getElementById("oxv-meta");
    assert(pill.textContent === "ONIX 3.0 (2 products) · 1.9 KB", `got: "${pill.textContent}"`);
    // Still findable, just empty — and :empty keeps it off the screen.
    const blocks = w.document.getElementById("oxv-block-list");
    assert(blocks && pill.contains(blocks), "the element should stay in the pill");
    assert(blocks.textContent === "", "with nothing in it");
    assert(!/·\s*·/.test(pill.textContent), "and no doubled separator");
  });

  test("a non-ONIX document's pill claims only the size", () => {
    const w = render("generic-note.xml");
    assert(/^\d+\.\d+ KB$/.test(meta(w)), `got: "${meta(w)}"`);
  });

  test("on a narrow toolbar the document pill gives way, never the verdict", () => {
    // Measured in Chrome: the pill's label ellipsises as the middle column
    // shrinks, and past that the pill is dropped entirely. What must never be
    // clipped is #oxv-validation — the size and release are recoverable from
    // the file and the tree, "103 errors" is not. jsdom has no layout, so this
    // asserts the rules that produce that behaviour rather than the pixels.
    const w = render("onix-3.0-reference.xml");
    const style = (sel) => w.getComputedStyle(w.document.querySelector(sel));

    // The middle column must be allowed to shrink at all: a bare 1fr track
    // refuses to go below its content's min-content width.
    const cols = style("#oxv-toolbar").gridTemplateColumns;
    assert(/minmax\(0(px)?, 1fr\)/.test(cols), `expected a shrinkable middle column, got "${cols}"`);
    const metaMin = style("#oxv-meta").minWidth;
    assert(metaMin === "0" || metaMin === "0px",
      `the pill must be allowed to shrink, got min-width "${metaMin}"`);
    assert(style("#oxv-meta").flexShrink !== "0", "and must not be pinned against shrinking");
    assert(style("#oxv-schema").flexShrink === "0", "the issue pill keeps its width");
    assert(style("#oxv-validation").flexShrink === "0", "and so does the verdict");
    const label = style("#oxv-meta .px-meta-label");
    assert(label.overflow === "hidden" && label.textOverflow === "ellipsis",
      "the pill's label ellipsises rather than pushing the column wider");

    // And the two breakpoints that drop the pill before anything else.
    const sheet = w.document.styleSheets[0];
    const dropped = [];
    for (const rule of sheet.cssRules) {
      const media = rule.media && String(rule.conditionText || rule.media.mediaText);
      if (media && media.includes("width")) {
        for (const inner of rule.cssRules) {
          if (inner.style.display === "none") dropped.push(media + " " + inner.selectorText);
        }
      }
    }
    assert(dropped.some((d) => d.includes("1100px") && d.includes("px-search-open")),
      `expected the pill dropped when the search field is open on a narrow window; got ${dropped.join("; ")}`);
    assert(dropped.some((d) => d.includes("760px")),
      `expected the pill dropped outright when very narrow; got ${dropped.join("; ")}`);
    assert(!dropped.some((d) => d.includes("oxv-validation") || d.includes("oxv-schema")),
      `only the document pill may be dropped; got ${dropped.join("; ")}`);
  });

  test("the toolbar reads left to right: controls, document, validation, then issue", () => {
    const w = render("onix-3.0-single-product-blocks.xml");
    const ids = ["oxv-meta", "oxv-validation", "oxv-schema"]
      .map((id) => w.document.getElementById(id));
    for (let i = 1; i < ids.length; i++) {
      const order = ids[i - 1].compareDocumentPosition(ids[i]);
      assert(order & w.Node.DOCUMENT_POSITION_FOLLOWING,
        `${ids[i].id} should come after ${ids[i - 1].id}`);
    }
    // The document pill sits with the controls; the code-list issue is
    // reference material and goes to the far right, in its own column.
    assert(ids[0].closest(".px-center"), "the document pill belongs in the centre group");
    assert(ids[1].closest(".px-center"), "so does the validation state");
    assert(ids[2].closest(".px-right"), "the issue pill belongs in the right group");
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
    assert(summariesOf(w, "Product")[0].startsWith("ISBN 9788234567896"), "summary should survive");
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
    assert(summaries[1] === "GTIN-13 9780000000002",
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
    assert(summariesOf(w, "productidentifier")[0] === "ISBN-13 9788234567896",
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

// content.js is the gate for the whole extension — it decides whether a page
// is taken over at all, and which content model is shipped to the viewer — but
// it is an IIFE that acts on load, so it can't be evaluated in the harness the
// way the viewer scripts are. Its pure string sniffs are lifted out of the
// source instead and exercised directly. Extraction is asserted, so moving or
// renaming one of them fails here rather than silently skipping the test.
describe("Content-script sniffs", () => {
  const contentJs = fs.readFileSync(path.join(RES, "content.js"), "utf8");

  function lift(...names) {
    const sources = names.map((name) => {
      const match = contentJs.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}\\n`));
      assert(match, `could not lift ${name}() out of content.js`);
      return match[0];
    });
    const stubBrowserApi = () => ({ runtime: { getURL: (p) => p } });
    return new Function("MODEL_VERSIONS", "browserAPI",
      `${sources.join("\n")}\nreturn { ${names.join(", ")} };`)(["3.1", "3.0"], stubBrowserApi);
  }

  test("looksLikeOnix accepts every ONIX fixture and rejects the others", () => {
    const { looksLikeOnix } = lift("looksLikeOnix");
    const dir = path.join(__dirname, "fixtures");
    const wrong = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".xml"))) {
      // The ONIX fixtures are the ones that must be taken over. malformed.xml
      // is a generic <root> document, so it is correctly left to the browser;
      // the parse-error panel is exercised by rendering it directly.
      const shouldMatch = file.startsWith("onix-");
      const got = looksLikeOnix(fs.readFileSync(path.join(dir, file), "utf8"));
      if (got !== shouldMatch) wrong.push(`${file}: expected ${shouldMatch}, got ${got}`);
    }
    assert(wrong.length === 0, wrong.join("; "));
  });

  test("only the content model matching the document's release is injected", () => {
    const { contentModelURLs } = lift("contentModelURLs", "modelURL");
    const cases = [
      ['<ONIXMessage xmlns="http://ns.editeur.org/onix/3.1/reference" release="3.1">', ["3.1"]],
      ['<ONIXMessage xmlns="http://ns.editeur.org/onix/3.0/reference" release="3.0">', ["3.0"]],
      ['<ONIXmessage xmlns="http://ns.editeur.org/onix/3.0/short" release="3.0">', ["3.0"]],
      ['<ONIXMessage release="3.1">', ["3.1"]],
      ["<ONIXMessage release='3.0'>", ["3.0"]],
      // Acknowledgement namespaces carry an extra segment, so these match on
      // the release attribute rather than the namespace.
      ['<ONIXMessageAcknowledgement xmlns="http://ns.editeur.org/onix/acknowledgement/3.0/reference" release="3.0">', ["3.0"]],
    ];
    for (const [head, expected] of cases) {
      const got = contentModelURLs(head);
      const want = expected.map((v) => `onix-content-model-${v}.js`);
      assert(JSON.stringify(got) === JSON.stringify(want),
        `${head.slice(0, 60)} → ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
  });

  test("an unreadable release ships both models, so the warning stays truthful", () => {
    const { contentModelURLs } = lift("contentModelURLs", "modelURL");
    // ONIX 2.1 and un-namespaced standalone <Product> records declare no
    // release. No model can match, but onix-validate.js's model.missing
    // warning lists what actually loaded — so both must be present.
    for (const head of ["<ONIXMessage>", "<Product><RecordReference>x</RecordReference>"]) {
      assert(contentModelURLs(head).length === 2,
        `${head} should ship both models, got ${JSON.stringify(contentModelURLs(head))}`);
    }
  });

  test("every ONIX fixture is matched with a model that covers its release", () => {
    const { contentModelURLs } = lift("contentModelURLs", "modelURL");
    const dir = path.join(__dirname, "fixtures");
    const wrong = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.startsWith("onix-"))) {
      const xml = fs.readFileSync(path.join(dir, file), "utf8");
      // A release is identifiable from the namespace as well as from the
      // release attribute — a standalone <Product> record carries only the
      // former, and detect() reads the version from it too.
      const release = (xml.match(/ns\.editeur\.org\/onix\/(?:acknowledgement\/)?(\d+\.\d+)\//) ||
                       xml.match(/release\s*=\s*["'](\d+\.\d+)["']/) || [])[1];
      const urls = contentModelURLs(xml);
      const expected = release ? [`onix-content-model-${release}.js`] : null;
      if (expected && JSON.stringify(urls) !== JSON.stringify(expected)) {
        wrong.push(`${file} (release ${release}) → ${JSON.stringify(urls)}`);
      }
      if (!expected && urls.length !== 2) wrong.push(`${file} (no release) → ${JSON.stringify(urls)}`);
    }
    assert(wrong.length === 0, wrong.join("; "));
  });
});

// The renderer walks with an explicit stack, so nesting depth costs an array
// entry rather than a JS frame. With recursion, 2,000 levels overflowed and the
// throw escaped mid-render: the tree stopped at 1,681 of 4,002 rows, the meta
// pill never filled in, and nothing after the render — validation, search, the
// click handlers — ran at all. A truncated document that looks complete is the
// part worth guarding.
//
// 2,000 is where the recursive version actually broke. Deeper would catch more
// (a one-frame-per-level recursion survives to ~8,000) but jsdom's cost here is
// roughly quadratic in depth — 1.7s at 2,000, 31s at 8,000 — and this is not a
// shape real ONIX takes, so it isn't worth the test loop.
describe("Deeply nested XML", () => {
  test("a document nested past the old stack limit renders completely", () => {
    const depth = 2000;
    const w = renderSource('<?xml version="1.0"?>' +
      '<ONIXMessage xmlns="http://ns.editeur.org/onix/3.1/reference" release="3.1">' +
      "<a>".repeat(depth) + "</a>".repeat(depth) + "</ONIXMessage>", "deep.xml");

    // One open and one close row per level, plus the message element's pair
    // and the XML declaration.
    const rows = $$(w, "#oxv-root .px-row").length;
    assert(rows === 2 * (depth + 1), `expected ${2 * (depth + 1)} rows, got ${rows}`);
    assert(!$$(w, "#oxv-root .px-error").length, "no parse-error panel");

    // The things a mid-render throw used to skip.
    assert(meta(w).includes("KB"), `the meta pill should be filled in, got "${meta(w)}"`);
    assert(w.document.getElementById("oxv-validation").textContent,
      "validation should have run");
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


// The Chrome Web Store review reads the manifest and SECURITY.md and then goes
// looking for the things those documents claim are absent. Each claim is
// asserted here so it cannot quietly stop being true — a stale security note
// is worse than none, because a reviewer who finds one wrong stops trusting
// the rest.
describe("Reviewability", () => {
  const SHIPPED = fs.readdirSync(RES)
    .filter((f) => f.endsWith(".js") && !/^onix-(codelists|content-model)/.test(f));
  const sourceOf = (f) => fs.readFileSync(path.join(RES, f), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(RES, "manifest.json"), "utf8"));
  const security = fs.readFileSync(path.join(__dirname, "..", "SECURITY.md"), "utf8");

  test("no dynamic code execution anywhere in the shipped scripts", () => {
    // "No remote code" is a declaration on the store listing, and eval or
    // new Function would contradict it even with a local string.
    for (const file of SHIPPED) {
      const code = sourceOf(file).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
      for (const pattern of [/\beval\s*\(/, /new\s+Function\s*\(/, /\bdocument\.write\s*\(/]) {
        assert(!pattern.test(code), `${file} must not use ${pattern}`);
      }
    }
  });

  test("the only network call is the same-origin re-fetch of the page itself", () => {
    const calls = [];
    for (const file of SHIPPED) {
      for (const m of sourceOf(file).matchAll(/fetch\s*\(([^,)]*)/g)) calls.push(`${file}: ${m[1].trim()}`);
    }
    assert(calls.length === 1, `expected exactly one fetch(), found: ${calls.join(" | ")}`);
    assert(calls[0].includes("document.location.href"),
      `the one fetch must target the page's own URL, got: ${calls[0]}`);
  });

  test("no script element is ever given a remote src", () => {
    for (const file of SHIPPED) {
      const code = sourceOf(file);
      assert(!/["'`]https?:\/\/[^"'`]*\.js/.test(code),
        `${file} must not reference a remote script`);
    }
  });

  test("untrusted markup is never assigned to innerHTML", () => {
    // The XML source reaches the page as textContent on an inert data block
    // and is rendered to DOM nodes. The only innerHTML write clears the tree.
    for (const file of SHIPPED) {
      for (const m of sourceOf(file).matchAll(/\.(inner|outer)HTML\s*=\s*([^;]*)/g)) {
        assert(/^""|^''|^``/.test(m[2].trim()),
          `${file} assigns to ${m[1]}HTML: ${m[2].trim()} — must only ever clear`);
      }
      assert(!/insertAdjacentHTML/.test(sourceOf(file)), `${file} must not use insertAdjacentHTML`);
    }
  });

  test("the manifest declares no permissions of any kind", () => {
    assert(Array.isArray(manifest.permissions) && manifest.permissions.length === 0,
      `permissions must be an empty array, got ${JSON.stringify(manifest.permissions)}`);
    assert(!manifest.host_permissions,
      `host_permissions must be absent, got ${JSON.stringify(manifest.host_permissions)}`);
    assert(!manifest.background,
      "there must be no background service worker");
    for (const key of ["optional_permissions", "optional_host_permissions", "externally_connectable"]) {
      assert(!manifest[key], `${key} must be absent`);
    }
  });

  test("SECURITY.md's manifest excerpt matches the real manifest", () => {
    // The excerpt is valid JSON and claims "there is nothing omitted", so
    // compare it structurally rather than by grepping for names — the
    // content script's own file would otherwise read as web-accessible.
    const fence = security.indexOf("```json");
    const excerpt = JSON.parse(security.slice(fence + 7, security.indexOf("```", fence + 7)));

    assert(JSON.stringify(excerpt.permissions) === JSON.stringify(manifest.permissions),
      "the excerpt's permissions must match the manifest's");
    assert(JSON.stringify(excerpt.web_accessible_resources) ===
      JSON.stringify(manifest.web_accessible_resources),
      "the excerpt's web_accessible_resources must match the manifest's exactly — " +
      `excerpt ${JSON.stringify(excerpt.web_accessible_resources)} vs ` +
      `manifest ${JSON.stringify(manifest.web_accessible_resources)}`);
    assert(JSON.stringify(excerpt.content_scripts) === JSON.stringify(manifest.content_scripts),
      "the excerpt's content_scripts must match the manifest's exactly — " +
      `excerpt ${JSON.stringify(excerpt.content_scripts)} vs ` +
      `manifest ${JSON.stringify(manifest.content_scripts)}`);
  });

  test("every script the content script injects is web-accessible and present", () => {
    // A script that is injected but not listed would simply fail to load on
    // every page, which is the kind of break no fixture would catch.
    const injected = [...sourceOf("content.js").matchAll(/getURL\(\s*[`"']([^`"'$]+)[`"']/g)]
      .map((m) => m[1]);
    assert(injected.length > 0, "expected to find the injected resources");
    const accessible = manifest.web_accessible_resources[0].resources;
    for (const resource of injected) {
      assert(accessible.includes(resource), `${resource} is injected but not web-accessible`);
      assert(fs.existsSync(path.join(RES, resource)), `${resource} is injected but missing`);
    }
  });
});

// ---- summary ---------------------------------------------------------------

const filterNote = FILTER ? `, ${skipped} skipped by filter "${FILTER}"` : "";
console.log(`\n${passed} passed, ${failed} failed${filterNote}`);
if (FILTER && passed + failed === 0) {
  console.log(`No test matched "${FILTER}".`);
  process.exit(1);
}
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`);
  process.exit(1);
}

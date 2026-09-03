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
const onixJs = fs.readFileSync(path.join(RES, "onix.js"), "utf8");
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

function render(fixtureName) {
  const xml = fs.readFileSync(path.join(FIXTURES, fixtureName), "utf8");

  const html = `<!doctype html><html><head><style>${viewerCss}</style></head>
<body class="oxv-view-xml">
  <div id="oxv-toolbar">
    <button data-action="expand-all"></button>
    <button data-action="collapse-all"></button>
    <button data-action="collapse-blocks"></button>
    <button data-action="toggle-wrap"></button>
    <button data-action="copy-xml"></button>
    <span class="px-view-group">
      <button data-action="view-xml"></button>
      <button data-action="view-split"></button>
      <button data-action="view-structure"></button>
    </span>
    <input id="oxv-search">
    <span id="oxv-search-status"></span>
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

  window.eval(codelistsJs);
  window.eval(onixJs);
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
function badges(window) {
  return $$(window, "#oxv-root .px-codelist").map((b) => b.textContent);
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
    const summary = $$(w, "#oxv-root .px-summary")[0].textContent;
    assert(summary.startsWith("GTIN 9780000000003"),
      `expected "GTIN 9780000000003 …" prefix, got: ${summary}`);
  });

  test("product summary labels ISBN-10 as ISBN", () => {
    const w = render("onix-3.0-isbn10-only.xml");
    const summary = $$(w, "#oxv-root .px-summary")[0].textContent;
    assert(summary.startsWith("ISBN 0123456789"),
      `expected "ISBN 0123456789 …" prefix, got: ${summary}`);
  });

  test("product summary omits the identifier segment when no ISBN-13 / GTIN-13 / ISBN-10 is present", () => {
    const w = render("onix-3.0-proprietary-only.xml");
    const summary = $$(w, "#oxv-root .px-summary")[0].textContent;
    assert(!/^(ISBN|GTIN)\b/.test(summary),
      `expected no ISBN / GTIN prefix when only a proprietary ID exists, got: ${summary}`);
    assert(summary.includes("No ISBN here"),
      `expected the title segment to still appear, got: ${summary}`);
  });

  test("product summary picks the distinctive title (TitleType=01) when multiple TitleDetails exist", () => {
    const w = render("onix-3.0-multi-title.xml");
    const summaries = $$(w, "#oxv-root .px-summary").map((s) => s.textContent);
    assert(summaries.length === 1, `expected 1 product summary, got ${summaries.length}`);
    assert(summaries[0].includes("Fra en dag til en annen"),
      `summary should pick TitleType=01 title, got: ${summaries[0]}`);
    assert(!summaries[0].includes("The difference a day makes"),
      `summary should NOT contain TitleType=03 title, got: ${summaries[0]}`);
  });

  test("product summary reads the split-form title (TitleWithoutPrefix) when TitleText is absent", () => {
    const w = render("onix-3.0-title-without-prefix.xml");
    const summaries = $$(w, "#oxv-root .px-summary").map((s) => s.textContent);
    assert(summaries.length === 2, `expected 2 product summaries, got ${summaries.length}`);
    assert(summaries[0].includes("Rovfugl"),
      `expected the NoPrefix title, got: ${summaries[0]}`);
    assert(summaries[1].includes("Den lange veien hjem"),
      `expected TitlePrefix joined to TitleWithoutPrefix, got: ${summaries[1]}`);
  });

  test("split-form title works in short dialect (b030 + b031)", () => {
    const w = render("onix-3.0-title-without-prefix-short.xml");
    const summary = $$(w, "#oxv-root .px-summary")[0].textContent;
    assert(summary.includes("Det hvite kartet"),
      `expected b030 joined to b031, got: ${summary}`);
  });

  test("renders product summaries with ISBN + form + title", () => {
    const w = render("onix-3.0-reference.xml");
    const summaries = $$(w, "#oxv-root .px-summary").map((s) => s.textContent);
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
    assert(/^ONIX 3\.0 \(\d+ products?\)/.test(meta(w)), `bad meta: ${meta(w)}`);
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
    return $$(window, "#oxv-root .px-row").find((row) => {
      const name = row.querySelector(".px-tag + .px-tag");
      return name && name.textContent === tagName && !row.classList.contains("px-close-row");
    }).querySelector(".px-node-menu-btn");
  }
  function stubClipboard(window) {
    const copied = { text: null };
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: (text) => { copied.text = text; return Promise.resolve(); } },
    });
    return copied;
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
  function rowsNamed(window, tagName) {
    return $$(window, "#oxv-root .px-row.px-collapsible").filter((row) => {
      const name = row.querySelector(".px-tag + .px-tag");
      return name && name.textContent === tagName;
    });
  }

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

  test("works in short dialect and via the b shortcut", () => {
    const w = render("onix-3.0-short.xml");
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "b", bubbles: true }));
    const blocks = rowsNamed(w, "descriptivedetail");
    assert(blocks.length >= 1, "expected short-tag block rows");
    assert(blocks.every((r) => r.classList.contains("px-folded")), "short-tag block rows should be folded");
  });
});

describe("ONIX blocks", () => {
  function blockLabelOf(window, tagName) {
    const row = $$(window, "#oxv-root .px-row.px-collapsible").find((r) => {
      const name = r.querySelector(".px-tag + .px-tag");
      return name && name.textContent === tagName;
    });
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

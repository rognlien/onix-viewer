const {
  test, describe, assert, render, $$, meta, rowsNamed, badges, summariesOf,
} = require("../harness");

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

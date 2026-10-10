// The standalone page: dist/standalone/onix-viewer-standalone.js loaded into
// an ordinary HTML document. Every test loads the built bundle, not the
// sources, so a defect in the builder fails here.
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const {
  test, describe, assert, renderSource, stubClipboard, $$, rowsNamed, badges, FIXTURES, SAMPLES,
} = require("../harness");
const { bundle } = require("../../tools/build-standalone");

const BUNDLE = bundle();
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const sample = (name) => fs.readFileSync(path.join(SAMPLES, name), "utf8");
const PRODUCT = fixture("onix-3.1-standalone-product.xml");
const PAGE = '<!doctype html><html><head><title>host</title></head><body><pre id="fallback">raw</pre></body></html>';

// A plain HTML page with the bundle loaded and no extension around it.
// `beforeScripts(window)` runs first, to seed localStorage or stub the clipboard.
function page(beforeScripts, html = PAGE) {
  const vc = new VirtualConsole();
  vc.on("error", (e) => { throw e; });
  const { window } = new JSDOM(html, { url: "https://example.com/page.html", runScripts: "outside-only", virtualConsole: vc });
  if (beforeScripts) beforeScripts(window);
  window.eval(BUNDLE);
  return window;
}

function opened(xml, beforeScripts) {
  const w = page(beforeScripts);
  const result = w.OnixViewerStandalone.open(xml, { title: "Feed", fallback: w.document.getElementById("fallback") });
  return { w, result };
}

function press(w, key) {
  w.document.body.dispatchEvent(new w.KeyboardEvent("keydown", { key, bubbles: true }));
}

const dom = (w) => w.document.documentElement.outerHTML;

// The sample product repeated, each with a RecordReference of its own.
function largeFeed(count) {
  const source = sample("onix-3.1-refnames.xml");
  const start = source.indexOf("<Product>");
  const end = source.indexOf("</Product>") + "</Product>".length;
  const product = source.slice(start, end);
  const products = Array.from({ length: count }, (_, i) =>
    product.replace(/<RecordReference>[^<]*<\/RecordReference>/, `<RecordReference>large-${i}</RecordReference>`));
  return source.slice(0, start) + products.join("\n") + source.slice(end);
}

describe("Standalone page", () => {
  test("the bundle publishes open() and nothing is rendered until it is called", () => {
    const w = page();
    assert(typeof w.OnixViewerStandalone.open === "function", "open is a function");
    assert(Object.keys(w.OnixViewerStandalone).join() === "open", "open is the only member");
    assert(!w.document.getElementById("oxv-root"), "nothing in the page before open()");
  });

  test("the shell is pruned of the extension's controls and keeps the rest", () => {
    const { w } = opened(PRODUCT);
    const d = w.document;
    for (const gone of [".px-logo-btn", '[data-action="download-xml"]', ".px-dialect-group",
      "#oxv-release-group", '[data-action="rules"]', "#oxv-validation", "link[rel=stylesheet]"]) {
      assert(!d.querySelector(gone), `${gone} must be absent`);
    }
    for (const kept of ["#oxv-toolbar", "#oxv-meta", "#oxv-search", "#oxv-root"]) {
      assert(d.querySelector(kept), `${kept} must be present`);
    }
    assert(d.head.querySelector("style"), "the stylesheet is a <style> in the head");
    assert(d.getElementById("fallback") === null, "the fallback is gone");
    assert(d.title === "Feed", `the title; got "${d.title}"`);
  });

  test("a well-formed document renders, resolves code lists and removes the fallback", () => {
    const { w, result } = opened(PRODUCT);
    assert(result.rendered === true && result.parsed === true, `result: ${JSON.stringify(result)}`);
    assert(rowsNamed(w, "Product").length === 1, "the Product row is rendered");
    assert(badges(w).length > 0, "at least one code-list badge resolves");
    assert(!w.document.getElementById("fallback"), "the fallback element is removed");
  });

  test("a document without a fallback option still renders", () => {
    const w = page();
    const result = w.OnixViewerStandalone.open(PRODUCT);
    assert(result.parsed === true, "parsed");
    assert(w.document.getElementById("fallback"), "the host's own element is left alone");
  });

  test("a malformed document shows the parse error, hides the toolbar and keeps the fallback", () => {
    const { w, result } = opened(fixture("malformed.xml"));
    assert(result.rendered === true && result.parsed === false, `result: ${JSON.stringify(result)}`);
    assert(w.document.querySelector("#oxv-root .px-error h2").textContent === "Could not parse XML", "the viewer's own panel");
    assert(w.document.getElementById("oxv-toolbar").style.display === "none", "the toolbar is hidden");
    assert(w.document.getElementById("fallback"), "the fallback is kept");
  });

  test("a stored dialect preference is ignored, while the extension still honours it", () => {
    const store = (value) => (win) => win.localStorage.setItem("oxv-dialect", value);
    // A reference-names document with "short" stored.
    const { w } = opened(PRODUCT, store("short"));
    assert(rowsNamed(w, "Product").length === 1 && rowsNamed(w, "product").length === 0,
      "the standalone page shows the names as written");
    const extension = renderSource(PRODUCT, "stored.xml", store("short"));
    assert(rowsNamed(extension, "product").length === 1 && rowsNamed(extension, "Product").length === 0,
      "the extension shows the stored dialect: the guard is conditional, not a removal");
    // A short-tag document with "reference" stored.
    const shortXml = sample("onix-3.1-shorttags.xml");
    const { w: shortPage } = opened(shortXml, store("reference"));
    assert(rowsNamed(shortPage, "product").length === 1 && rowsNamed(shortPage, "Product").length === 0,
      "short tags stay short");
  });

  test("copy returns the supplied text verbatim", () => {
    for (const [xml, stored] of [[PRODUCT, "short"], [sample("onix-3.1-shorttags.xml"), "reference"]]) {
      let copied;
      const w = page((win) => { win.localStorage.setItem("oxv-dialect", stored); copied = stubClipboard(win); });
      w.OnixViewerStandalone.open(xml);
      w.document.querySelector('[data-action="copy-xml"]').click();
      assert(copied.text === xml, "the clipboard holds the input, character for character");
    }
  });

  test("t, v and ? do nothing; w still works", () => {
    const { w } = opened(PRODUCT);
    const before = dom(w);
    for (const key of ["t", "v", "?"]) {
      press(w, key);
      assert(dom(w) === before, `"${key}" must leave the page as it was`);
    }
    press(w, "w");
    assert(w.document.body.classList.contains("px-no-wrap"), "w, the positive control, toggles wrapping");
    // The same keys do act in the extension's shell.
    const extension = renderSource(PRODUCT, "keys.xml");
    const extensionBefore = dom(extension);
    press(extension, "?");
    assert(dom(extension) !== extensionBefore, "? opens About in the extension, so the keystroke reaches the handler");
  });

  test("a non-string argument throws a TypeError", () => {
    const w = page();
    for (const bad of [undefined, null, 42, {}, new w.Uint8Array(2)]) {
      let error;
      try { w.OnixViewerStandalone.open(bad); } catch (e) { error = e; }
      assert(error && error.constructor.name === "TypeError", `open(${String(bad)}) must throw a TypeError`);
    }
    assert(!w.document.getElementById("oxv-root"), "nothing was rendered");
  });

  test("a second call in the same document throws", () => {
    const { w } = opened(PRODUCT);
    let error;
    try { w.OnixViewerStandalone.open(PRODUCT); } catch (e) { error = e; }
    assert(error && /once per document/.test(error.message), "the second call throws");
    assert($$(w, "#oxv-toolbar").length === 1, "and adds nothing");
  });

  test("without a body it throws, and the call can be tried again", () => {
    const w = page();
    const body = w.document.body;
    body.remove();
    let error;
    try { w.OnixViewerStandalone.open(PRODUCT); } catch (e) { error = e; }
    assert(error && /document\.body/.test(error.message), `needs document.body; got ${error && error.message}`);
    w.document.documentElement.appendChild(body);
    assert(w.OnixViewerStandalone.open(PRODUCT).parsed === true, "the retry renders");
  });

  test("a failure mid-render leaves the page as it was, and the call can be tried again", () => {
    const w = page();
    const before = dom(w);
    const detect = w.OnixViewerOnix.detect;
    w.OnixViewerOnix.detect = () => { throw new Error("boom"); };
    let error;
    try { w.OnixViewerStandalone.open(PRODUCT); } catch (e) { error = e; }
    assert(error && error.message === "boom", "the error reaches the caller");
    assert(dom(w) === before, "everything the call added is gone");
    w.OnixViewerOnix.detect = detect;
    assert(w.OnixViewerStandalone.open(PRODUCT).parsed === true, "the retry renders");
    assert($$(w, "#oxv-toolbar").length === 1 && $$(w, "head style").length === 1, "once, not twice");
  });

  test("the code lists run before onix.js: a short-tag file resolves its full badge count", () => {
    // With onix.js ahead of the code lists the same file resolved 15 badges
    // instead of 143. The extension's count is the reference.
    const xml = sample("onix-3.1-shorttags.xml");
    const { w } = opened(xml);
    const expected = badges(renderSource(xml, "shorttags.xml")).length;
    assert(expected > 100, `the reference count is substantial; got ${expected}`);
    assert(badges(w).length === expected, `got ${badges(w).length} badges, the extension resolves ${expected}`);
  });

  test("a 300-product feed opens through the standalone path and renders the Products in view", () => {
    // jsdom has no IntersectionObserver, which would make the viewer render
    // all 300 Products eagerly; this one reports only the first as in view.
    const observed = [];
    let notify;
    const { w, result } = opened(largeFeed(300), (win) => {
      win.IntersectionObserver = class {
        constructor(callback) { notify = callback; }
        observe(el) { observed.push(el); }
        unobserve() {}
        disconnect() {}
      };
    });
    assert(result.parsed === true, "parsed");
    assert(w.document.getElementById("oxv-meta").textContent.includes("300 products"), "the pill counts the feed");
    assert(rowsNamed(w, "Product").length === 300, "every Product has its row");
    assert(observed.length === 300 && rowsNamed(w, "RecordReference").length === 0, "none is filled before it is in view");
    notify([{ target: observed[0], isIntersecting: true }]);
    assert(rowsNamed(w, "RecordReference").length === 1, "the first Product's rows are rendered");
    assert($$(w, "#oxv-root .px-children.px-pending").length === 299, "the other 299 still wait");
  });
});

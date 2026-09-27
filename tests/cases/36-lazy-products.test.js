// Products rendered on demand. Above LAZY_FROM_PRODUCTS products the viewer
// keeps each Product's open and close rows and leaves what sits between them
// to an IntersectionObserver. jsdom has none, so the suite normally takes the
// eager path; these tests hand the window a fake one and drive it by hand.
const fs = require("fs");
const path = require("path");
const { test, describe, assert, renderSource, $$, rowsNamed, validationLabel, SAMPLES } = require("../harness");

const sample = fs.readFileSync(path.join(SAMPLES, "onix-3.1-refnames.xml"), "utf8");

// The sample product repeated, each with a RecordReference of its own.
function feed(count) {
  const start = sample.indexOf("<Product>");
  const end = sample.indexOf("</Product>") + "</Product>".length;
  const product = sample.slice(start, end);
  const products = Array.from({ length: count }, (_, i) =>
    product.replace(/<RecordReference>[^<]*<\/RecordReference>/, `<RecordReference>feed-${i}</RecordReference>`));
  return sample.slice(0, start) + products.join("\n") + sample.slice(end);
}

// A window with a fake IntersectionObserver that records what it watches and
// intersects on request, and a setTimeout that queues instead of firing, so
// the validation slices the viewer schedules can be run to completion.
function lazyWindow(count) {
  const observed = new Set();
  const timers = [];
  let callback = null;
  const w = renderSource(feed(count), `feed-${count}.xml`, (win) => {
    win.IntersectionObserver = class {
      constructor(cb) { callback = cb; }
      observe(el) { observed.add(el); }
      unobserve(el) { observed.delete(el); }
      disconnect() { observed.clear(); }
    };
    win.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  });
  const intersect = (el) => callback([{ target: el, isIntersecting: true }]);
  const flush = () => { while (timers.length) timers.shift()(); };
  const settle = () => {
    let guard = 0;
    while (validationLabel(w).textContent.includes("Validating") && guard++ < 10000) {
      const fn = timers.shift();
      if (!fn) break;
      fn();
    }
  };
  return { w, observed, intersect, settle, flush };
}

const pending = (w) => $$(w, "#oxv-root .px-children.px-pending");

describe("Lazy products", () => {
  test("a feed above the threshold renders each Product's row and nothing inside it", () => {
    const { w, observed } = lazyWindow(25);
    assert(rowsNamed(w, "Product").length === 25, "one open row per Product");
    assert(pending(w).length === 25, `every Product's container is pending; got ${pending(w).length}`);
    assert(observed.size === 25, "and each is watched");
    assert(rowsNamed(w, "RecordReference").length === 0, "no Product's children are rendered");
    assert(rowsNamed(w, "SenderName").length === 1, "the Header is rendered as before");
    assert($$(w, "#oxv-root .px-close-row").length >= 25, "each Product's close row is in place");
    assert(w.document.getElementById("oxv-meta").textContent.includes("25 products"), "the pill counts the feed");
  });

  test("a feed at the threshold renders whole", () => {
    const { w, observed } = lazyWindow(20);
    assert(pending(w).length === 0 && observed.size === 0, "nothing deferred");
    assert(rowsNamed(w, "RecordReference").length === 20, "every Product's children rendered");
  });

  test("a Product renders when it nears the viewport, and is no longer watched", () => {
    const { w, observed, intersect } = lazyWindow(25);
    const container = pending(w)[3];
    intersect(container);
    assert(!container.classList.contains("px-pending"), "the container is no longer pending");
    assert(container.querySelectorAll(".px-row").length > 100, "and holds the Product's rows");
    assert(!observed.has(container), "and is no longer watched");
    assert(pending(w).length === 24, "the others still wait");
    assert(rowsNamed(w, "RecordReference").length === 1, "one Product's children are in the tree");
  });

  test("findings inside a deferred Product are pinned when it renders", () => {
    const { w, intersect, settle } = lazyWindow(25);
    settle();
    const label = validationLabel(w).textContent;
    assert(label === "50 warnings", `the verdict counts every Product's findings; got "${label}"`);
    assert($$(w, "#oxv-root .px-finding").length === 0, "no pill yet: nothing with a finding is rendered");
    intersect(pending(w)[0]);
    assert($$(w, "#oxv-root .px-finding").length === 2, `the Product's two pills appear with its rows; got ${$$(w, "#oxv-root .px-finding").length}`);
  });

  test("a findings-list entry renders the Product it is in and jumps to the row", () => {
    const { w, settle } = lazyWindow(25);
    settle();
    validationLabel(w).click();
    const items = $$(w, "#oxv-findings .px-findings-item");
    assert(items.length === 50, `the list has every finding; got ${items.length}`);
    items[items.length - 1].click();
    assert(pending(w).length === 24, "the last Product rendered, the rest still wait");
    const active = w.document.querySelector("#oxv-root .px-row.px-active");
    assert(active && active.querySelector(".px-finding"), "and the finding's row is active, with its pill");
    assert(w.document.getElementById("oxv-findings").hidden, "the list closed");
  });

  test("a search renders every Product first, so it sees the whole document", () => {
    const { w, flush } = lazyWindow(25);
    const search = w.document.getElementById("oxv-search");
    search.value = "feed-24";
    search.dispatchEvent(new w.Event("input", { bubbles: true }));
    flush(); // the field debounces through setTimeout, which the window queues
    assert(pending(w).length === 0, "nothing is left deferred");
    assert(w.document.getElementById("oxv-search-status").textContent === "1/1", "and the match in the last Product is found");
  });

  test("Collapse's second step folds deferred Products and Expand unfolds them, still deferred", () => {
    const { w } = lazyWindow(25);
    const key = (k) => w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true }));
    key("c");
    key("c");
    const productRows = rowsNamed(w, "Product");
    assert(productRows.every((row) => row.classList.contains("px-folded")), "two presses fold every Product row");
    assert(pending(w).length === 25, "folding renders nothing");
    key("e");
    assert(productRows.every((row) => !row.classList.contains("px-folded")), "Expand unfolds them");
    assert(pending(w).length === 25, "and still renders nothing: that is the observer's job");
  });
});

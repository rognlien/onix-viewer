const {
  test, describe, assert, render, $$, rowsNamed,
} = require("../harness");

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
    // The reason it survives at all: browser find skips display:none, and a
    // reader who has pressed Collapse on a large feed has folded most of it.
    const w = render("onix-3.0-reference.xml");
    const products = rowsNamed(w, "Product");
    // Fold them by hand, the way a reader who pressed Collapse twice would have.
    for (const row of products) row.classList.add("px-folded");
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

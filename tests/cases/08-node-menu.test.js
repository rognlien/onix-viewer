const {
  test, describe, assert, render, $$, rowsNamed, stubClipboard,
} = require("../harness");

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

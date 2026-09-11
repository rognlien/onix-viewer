const {
  test, describe, assert, render, rowsNamed,
} = require("../harness");

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

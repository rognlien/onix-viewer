// What keeps a large feed usable. jsdom lays nothing out, so the rendering
// cost itself is measured by hand (see CLAUDE.md); this holds the rule that
// bought it in place.
const fs = require("fs");
const path = require("path");
const { test, describe, assert, render, RES } = require("../harness");

describe("Large feeds", () => {
  test("each Product's subtree is laid out only near the viewport", () => {
    const css = fs.readFileSync(path.join(RES, "viewer.css"), "utf8");
    const rule = /#oxv-root > \.px-children > \.px-children \{([^}]*)\}/.exec(css);
    assert(rule, "a rule on the second level of children under the root");
    assert(/content-visibility:\s*auto/.test(rule[1]), "content-visibility: auto");
    assert(/contain-intrinsic-size:\s*auto \d+px/.test(rule[1]),
      "an intrinsic size, so unrendered Products still give the scrollbar a shape");
  });

  test("that selector is the Products' containers, and nothing deeper", () => {
    const w = render("onix-3.0-reference.xml");
    const containers = [...w.document.querySelectorAll("#oxv-root > .px-children > .px-children")];
    const openers = containers.map((c) => c.previousElementSibling.querySelector(".px-tag-name").textContent);
    assert(openers.includes("Product") && openers.every((n) => n === "Product" || n === "Header"),
      `the Header and each Product; got ${openers.join(", ")}`);
    const deeper = w.document.querySelectorAll("#oxv-root > .px-children > .px-children .px-children").length;
    assert(deeper > 0 && deeper > containers.length,
      "deeper containers exist and are not among the matches: the selector is a child chain, not a descendant one");
  });
});

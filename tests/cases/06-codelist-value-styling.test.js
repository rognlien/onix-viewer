const {
  test, describe, assert, render, $$,
} = require("../harness");

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

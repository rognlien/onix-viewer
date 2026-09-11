const {
  test, describe, assert, render, $$, meta, badges,
} = require("../harness");

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

// The stores' "What's New" text, made from CHANGELOG.md by
// tools/release-notes.js. App Store Connect refuses angle brackets, which
// the changelog is full of, and neither store renders Markdown.
const fs = require("fs");
const path = require("path");
const { test, describe, assert, ROOT, RES } = require("../harness");
const { releaseNotes, plainText, APP_STORE_LIMIT } = require(path.join(ROOT, "tools", "release-notes.js"));

const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
const version = JSON.parse(fs.readFileSync(path.join(RES, "manifest.json"), "utf8")).version;

describe("Release notes", () => {
  test("the current version's notes carry no markup and fit the App Store", () => {
    const notes = releaseNotes(changelog, version);
    assert(notes.length > 0 && notes.length <= APP_STORE_LIMIT, `length ${notes.length}`);
    assert(!/[<>]/.test(notes), "no angle brackets");
    assert(!/\*\*|`/.test(notes), "no Markdown emphasis or code marks");
  });

  test("element names lose their brackets and the held-back section is left out", () => {
    assert(plainText("A `<ProductFormDetail>` and <NoPrefix/>") === "A ProductFormDetail and NoPrefix", "names kept");
    const sample = "## 1.0.0 — 2026-01-01\n\n### Added\n- **One.** First\n  line.\n\n### Held back\n- **Two.** Not shipped.\n";
    assert(releaseNotes(sample, "1.0.0") === "New\n• One. First line.", releaseNotes(sample, "1.0.0"));
  });

  test("a version with no section is refused", () => {
    let threw = false;
    try { releaseNotes(changelog, "0.0.0"); } catch { threw = true; }
    assert(threw, "no section, no notes");
  });
});

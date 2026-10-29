// What to change in each store listing, made by tools/listing-changes.js
// beside each store build. These hold its parts on small inputs, so they
// do not depend on the repository's tags or history.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test, describe, assert, ROOT } = require("../harness");
const {
  listingFields, renameFields, compareFields, lineDiff, assetStatus, compareImages, previousTag, baselineTag, report,
  refreshListingChanges, STORES,
} = require(path.join(ROOT, "tools", "listing-changes.js"));

const COMMIT = { hash: "abc1234", dirty: false };

const LISTING = [
  "# Store listing",
  "",
  "```bash",
  "tools/package-extension.sh",
  "```",
  "",
  "**Name** (max 30 chars):",
  "",
  "```",
  "ONIX Viewer",
  "```",
  "",
  "**Description**:",
  "",
  "```",
  "One line.",
  "Two line.",
  "```",
  "",
  "**Category**: Developer Tools",
  "",
  "## Review notes (paste into Notes)",
  "",
  "```",
  "Notes.",
  "```",
  "",
  "```",
  "More notes.",
  "```",
].join("\n");

describe("Listing changes", () => {
  test("a field is a plain fenced block, named by the heading or bold label above it", () => {
    const fields = listingFields(LISTING);
    assert(JSON.stringify(fields.map((field) => field.label)) === JSON.stringify(["Name", "Description", "Review notes", "Review notes (2)"]),
      JSON.stringify(fields));
    assert(fields[1].text === "One line.\nTwo line.", fields[1].text);
  });

  test("fields compare by label: unchanged, changed with a diff, added and removed", () => {
    const before = [{ label: "Name", text: "A" }, { label: "Description", text: "one\ntwo\nthree" }, { label: "Old", text: "x" }];
    const after = [{ label: "Name", text: "A" }, { label: "Description", text: "one\n2\nthree" }, { label: "New", text: "y" }];
    const statuses = Object.fromEntries(compareFields(before, after).map((field) => [field.label, field.status]));
    assert(JSON.stringify(statuses) === JSON.stringify({ Name: "unchanged", Description: "changed", New: "added", Old: "removed" }), JSON.stringify(statuses));
    assert(compareFields(before, after)[1].diff === "  one\n- two\n+ 2\n  three", compareFields(before, after)[1].diff);
  });

  test("a field new since the baseline is unchanged when the baseline wrote it inline under its label", () => {
    const old = "**Category**: `Developer Tools` (or `Productivity`)\n\n**Primary**: Books. **Secondary**: Utilities.\nMore.\n\nOther text";
    const after = [
      { label: "Category", text: "Developer Tools" },
      { label: "Secondary", text: "Utilities\nMore." },
      { label: "Primary", text: "Books" },
      { label: "Homepage", text: "Other text" },
      { label: "Empty", text: "" },
    ];
    const statuses = compareFields([], after, old).map((field) => field.status);
    assert(JSON.stringify(statuses) === JSON.stringify(["unchanged", "unchanged", "unchanged", "added", "added"]), JSON.stringify(statuses));
  });

  test("text elsewhere in the baseline, or under another label, does not count", () => {
    const old = "**Category**: `Productivity`\n\n**Primary**: Books. **Secondary**: Utilities.\n\nDeveloper Tools";
    const after = [{ label: "Category", text: "Developer Tools" }, { label: "Primary", text: "Utilities" }];
    const statuses = compareFields([], after, old).map((field) => field.status);
    assert(JSON.stringify(statuses) === JSON.stringify(["added", "added"]), JSON.stringify(statuses));
  });

  test("a renamed field compares with its old label", () => {
    const before = renameFields([{ label: "Screenshots", text: "Captions." }], STORES.firefox.renamedFields);
    const fields = compareFields(before, [{ label: "Screenshot captions", text: "Captions." }]);
    assert(JSON.stringify(fields.map((field) => [field.label, field.status])) === JSON.stringify([["Screenshot captions", "unchanged"]]),
      JSON.stringify(fields));
  });

  test("the diff keeps one line of context and marks the gaps", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g"].join("\n");
    const after = ["A", "b", "c", "d", "e", "f", "G"].join("\n");
    assert(lineDiff(before, after) === "- a\n+ A\n  b\n…\n  f\n- g\n+ G", lineDiff(before, after));
  });

  test("images compare by fingerprint", () => {
    assert(assetStatus("1", "1") === "unchanged", "same bytes");
    assert(assetStatus("1", "2") === "changed", "other bytes");
    assert(assetStatus(null, "2") === "added", "new file");
    assert(assetStatus("1", null) === "removed", "gone");
  });

  test("the baseline is the newest release tag older than the version", () => {
    const tags = ["v0.9.9", "v0.9.21", "v0.9.22", "v0.9.23", "v0.10.0", "not-a-tag"];
    assert(previousTag(tags, "0.9.23") === "v0.9.22", previousTag(tags, "0.9.23"));
    assert(previousTag(tags, "0.10.1") === "v0.10.0", previousTag(tags, "0.10.1"));
    assert(previousTag(tags, "0.9.9") === null, "nothing older");
  });

  test("a listing tag, which marks what the stores hold, wins over a release tag", () => {
    const tags = ["v0.9.22", "v0.9.23", "listing/v0.9.22", "listing/v0.9.23", "listing/v0.9.24"];
    assert(baselineTag(tags, "0.9.24", null) === "listing/v0.9.23", baselineTag(tags, "0.9.24", null));
  });

  test("with no older listing tag, the baseline is the release tag", () => {
    const tags = ["v0.9.22", "v0.9.23", "listing/v0.9.24"];
    assert(baselineTag(tags, "0.9.24", null) === "v0.9.23", baselineTag(tags, "0.9.24", null));
  });

  test("a tag named with --since wins over both", () => {
    const tags = ["v0.9.23", "listing/v0.9.23"];
    assert(baselineTag(tags, "0.9.24", "v0.9.21") === "v0.9.21", baselineTag(tags, "0.9.24", "v0.9.21"));
  });

  test("listing tags order by version number, not by text", () => {
    const tags = ["listing/v0.9.9", "listing/v0.9.10", "listing/v0.10.0", "listing/vX"];
    assert(baselineTag(tags, "0.9.11", null) === "listing/v0.9.10", baselineTag(tags, "0.9.11", null));
    assert(baselineTag(tags, "0.11.0", null) === "listing/v0.10.0", baselineTag(tags, "0.11.0", null));
  });

  const firefoxReport = () => {
    const fields = compareFields([{ label: "Summary", text: "old" }, { label: "Name", text: "A" }, { label: "Old", text: "x" }],
      [{ label: "Summary", text: "new" }, { label: "Name", text: "A" }, { label: "New", text: "y" }]);
    const images = compareImages([
      { label: "Icon", upload: "icon-128.png", before: "1", after: "1" },
      { label: "Screenshot Main.png", upload: "screenshots/Main.png", before: "1", after: "2" },
      { label: "Screenshot Gone.png", upload: "screenshots/Gone.png", before: "1", after: null },
    ]);
    return report({ browser: "firefox", version: "1.0.0", baseline: "v0.9.0", note: null, commit: COMMIT, fields, notesText: "• Fixed it.", images });
  };

  test("the report opens with the versions and a checklist of every action", () => {
    const text = firefoxReport();
    assert(text.startsWith("# addons.mozilla.org listing for 1.0.0\n\n1.0.0 compared with v0.9.0. Built from abc1234.\n\n## Checklist\n\n"), text);
    assert(text.includes([
      "- [ ] Upload new package: `dist/firefox/onix-viewer-1.0.0-firefox.zip`",
      "- [ ] Upload source code: `dist/firefox/onix-viewer-1.0.0-firefox-source.zip`",
      "- [ ] Replace text: Summary (below)",
      "- [ ] Fill in new field: New (below)",
      "- [ ] Clear field: Old (no longer in the listing)",
      "- [ ] Replace screenshot Main.png: `dist/firefox/screenshots/Main.png`",
      "- [ ] Remove screenshot Gone.png from the listing",
      "- [ ] Paste Version notes (below)",
    ].join("\n")), text);
  });

  test("changed text comes ready to paste, with the diff after it for reference", () => {
    const text = firefoxReport();
    assert(text.includes("## Summary\n\n```\nnew\n```\n\nReference only, what changed since v0.9.0:\n\n```diff\n- old\n+ new\n```"), text);
    assert(text.includes("## New (new field)\n\n```\ny\n```"), text);
    assert(text.includes("## Version notes for 1.0.0\n\n```\n• Fixed it.\n```"), text);
  });

  test("unchanged items share one line at the bottom", () => {
    const text = firefoxReport();
    assert(text.endsWith("\n\n**Unchanged** — text: Name; images: Icon.\n"), text);
    assert(!text.includes("## Name"), text);
  });

  test("a release that changes only the package says so", () => {
    const fields = compareFields([{ label: "Name", text: "A" }], [{ label: "Name", text: "A" }]);
    const images = compareImages([{ label: "Store icon", upload: "icon-128.png", before: "1", after: "1" }]);
    const text = report({ browser: "chrome", version: "1.0.0", baseline: "v0.9.0", note: null, commit: COMMIT, fields, notesText: null, images });
    assert(text.includes("## Checklist\n\n- [ ] Upload new package: `dist/chrome/onix-viewer-1.0.0-chrome.zip`\n\nNo listing field or image changed."), text);
  });

  test("a missing baseline is a warning on the first line", () => {
    const fields = compareFields([], [{ label: "Name", text: "A" }]);
    const text = report({ browser: "safari", version: "1.0.0", baseline: null, note: "No release tag older than 1.0.0 was found.", commit: COMMIT, fields, notesText: "• Fixed it.", images: [] });
    assert(text.startsWith("> **Warning:** No release tag older than 1.0.0 was found.\n\n# App Store listing for 1.0.0\n\n1.0.0 compared with nothing. Built from abc1234."), text);
  });

  test("a report from a dirty tree says so beside the commit", () => {
    const fields = compareFields([{ label: "Name", text: "A" }], [{ label: "Name", text: "A" }]);
    const text = report({ browser: "chrome", version: "1.0.0", baseline: "v0.9.0", note: null, commit: { hash: "abc1234", dirty: true }, fields, notesText: null, images: [] });
    assert(text.includes("\n\n1.0.0 compared with v0.9.0. Built from abc1234 with uncommitted changes.\n\n"), text);
  });

  test("a refresh rewrites the report a build left, and makes none where there is no build", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "listing-changes-"));
    try {
      assert(refreshListingChanges("chrome", directory) === false, "nothing to refresh");
      assert(!fs.existsSync(path.join(directory, "listing-changes.md")), "no report made");
      fs.writeFileSync(path.join(directory, "listing-changes.md"), "stale");
      assert(refreshListingChanges("chrome", directory) === true, "refreshed");
      const text = fs.readFileSync(path.join(directory, "listing-changes.md"), "utf8");
      assert(text.includes("# Chrome Web Store listing for ") && text.includes(" Built from "), text);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("every store is described", () => {
    for (const browser of ["chrome", "firefox", "safari"]) assert(STORES[browser], browser);
    assert(STORES.chrome.releaseNotes === null, "the Chrome Web Store has no release notes field");
  });
});

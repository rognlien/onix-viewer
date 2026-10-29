// What to change in each store listing, made by tools/listing-changes.js
// beside each store build. These hold its parts on small inputs, so they
// do not depend on the repository's tags or history.
const path = require("path");
const { test, describe, assert, ROOT } = require("../harness");
const {
  listingFields, compareFields, lineDiff, assetStatus, compareImages, previousTag, report, STORES,
} = require(path.join(ROOT, "tools", "listing-changes.js"));

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

  test("the report opens with a summary and gives changed text in full", () => {
    const fields = compareFields([{ label: "Summary", text: "old" }, { label: "Name", text: "A" }],
      [{ label: "Summary", text: "new" }, { label: "Name", text: "A" }]);
    const images = compareImages([{ label: "Icon", upload: "icon-128.png", before: "1", after: "1" }]);
    const text = report({ browser: "firefox", version: "1.0.0", baseline: "v0.9.0", note: null, fields, notesText: "• Fixed it.", images });
    assert(text.includes("**Change:** Summary, Release notes.  \n**Unchanged:** Name, Icon."), text);
    assert(text.includes("### Summary — CHANGED\n\n```diff\n- old\n+ new\n```\n\nNew text, to paste:\n\n```\nnew\n```"), text);
    assert(text.includes("### Name — unchanged\n"), text);
    assert(text.includes("## Release notes — enter for 1.0.0\n\n```\n• Fixed it.\n```"), text);
    assert(text.includes("| Icon | unchanged | `icon-128.png` |"), text);
  });

  test("every store is described", () => {
    for (const browser of ["chrome", "firefox", "safari"]) assert(STORES[browser], browser);
    assert(STORES.chrome.releaseNotes === null, "the Chrome Web Store has no release notes field");
  });
});

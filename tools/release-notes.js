// tools/release-notes.js — a version's CHANGELOG.md section as plain text,
// for the stores' "What's New" fields.
//
//   node tools/release-notes.js [version]        # defaults to the manifest's
//
// App Store Connect refuses angle brackets and neither store renders
// Markdown, so the notes carry no markup: element names lose their
// brackets, code and emphasis their marks, and wrapped lines are joined.
// The "Held back" section describes what is not in the release, so it is
// left out. tools/package-extension.sh writes the result beside the Firefox
// and Safari uploads.

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const APP_STORE_LIMIT = 4000;
const HEADINGS = { Added: "New", Changed: "Changed", Fixed: "Fixed" };

function changelogSection(changelog, version) {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## ${version} `) || line === `## ${version}`);
  if (start < 0) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const length = lines.slice(start + 1).findIndex((line) => line.startsWith("## "));
  return lines.slice(start + 1, length < 0 ? undefined : start + 1 + length);
}

function plainText(markdown) {
  return markdown
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<\/?([A-Za-z][\w.-]*)\s*\/?>/g, "$1")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function subsections(lines) {
  const result = [];
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^### (.+)$/);
    if (heading) {
      current = { title: heading[1].trim(), items: [] };
      result.push(current);
    } else if (current && line.startsWith("- ")) {
      current.items.push(line.slice(2));
    } else if (current && current.items.length && /^\s+\S/.test(line)) {
      current.items[current.items.length - 1] += " " + line.trim();
    }
  }
  return result;
}

function releaseNotes(changelog, version) {
  const blocks = subsections(changelogSection(changelog, version))
    .filter((section) => HEADINGS[section.title] && section.items.length)
    .map((section) => [HEADINGS[section.title], ...section.items.map((item) => `• ${plainText(item)}`)].join("\n"));
  const notes = blocks.join("\n\n");
  if (notes.length > APP_STORE_LIMIT) {
    throw new Error(`release notes for ${version} are ${notes.length} characters, over the App Store's ${APP_STORE_LIMIT}`);
  }
  return notes;
}

function main() {
  const version = process.argv[2] || require(path.join(ROOT, "Resources", "manifest.json")).version;
  const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  process.stdout.write(releaseNotes(changelog, version) + "\n");
}

if (require.main === module) main();

module.exports = { releaseNotes, plainText, APP_STORE_LIMIT };

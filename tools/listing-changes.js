// tools/listing-changes.js — what to change in a store listing for this
// version, as Markdown, so the store forms are never compared by hand.
//
//   node tools/listing-changes.js <chrome|firefox|safari> [--since=<tag>]
//
// The baseline is the listing as of the previous release: the newest v* tag
// older than the manifest's version, or the tag --since names, for when a
// version never reached a store. tools/package-extension.sh writes the result
// to dist/<browser>/listing-changes.md, passing LISTING_SINCE as --since.
//
// A text field is a fenced block with no language in <browser>/listing.md,
// named by the nearest heading or line-leading **bold** label above it;
// fenced blocks with a language (```bash) are instructions, not fields.
// Images compare by git blob hash, that is by bytes. The promo tiles are not
// committed, so they compare by what they are rendered from.

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { releaseNotes } = require("./release-notes.js");

const ROOT = path.join(__dirname, "..");
const BROWSERS = ["chrome", "firefox", "safari"];

const STORES = {
  chrome: {
    title: "Chrome Web Store",
    releaseNotes: null,
    images: [
      { label: "Store icon", upload: "icon-128.png", sources: ["Resources/icons/icon-128.png"] },
      { label: "Small promo tile", upload: "promo-tile-440x280.png", sources: ["chrome/promo-tile.svg", "icons/icon-original.png"] },
      { label: "Marquee promo tile", upload: "marquee-1400x560.png", sources: ["chrome/marquee.svg", "icons/icon-original.png"] },
    ],
  },
  firefox: {
    title: "addons.mozilla.org",
    releaseNotes: "Release notes",
    images: [
      { label: "Icon", upload: "icon-128.png", sources: ["Resources/icons/icon-128.png"] },
    ],
  },
  safari: {
    title: "App Store",
    releaseNotes: "What's New",
    images: [],
  },
};

const STATUS_WORDS = { unchanged: "unchanged", changed: "CHANGED", added: "ADDED", removed: "REMOVED" };

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const index = leftParts.findIndex((part, position) => part !== rightParts[position]);
  return index < 0 ? 0 : leftParts[index] - rightParts[index];
}

function previousTag(tags, version) {
  const older = tags
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .filter((tag) => compareVersions(tag.slice(1), version) < 0)
    .sort((left, right) => compareVersions(right.slice(1), left.slice(1)));
  return older[0] || null;
}

function fieldLabel(line) {
  const heading = line.match(/^#{1,6}\s+(.+?)\s*(?:\(.*\))?\s*$/);
  const bold = line.match(/^\*\*([^*]+)\*\*/);
  const label = heading ? heading[1] : bold && bold[1];
  return label ? label.trim().replace(/:$/, "") : null;
}

function uniqueLabel(label, seen) {
  const count = (seen.get(label) || 0) + 1;
  seen.set(label, count);
  return count === 1 ? label : `${label} (${count})`;
}

function listingFields(markdown) {
  const fields = [];
  const seen = new Map();
  let label = "Untitled";
  let block = null;
  for (const line of markdown.split("\n")) {
    if (block) {
      if (/^```\s*$/.test(line)) {
        if (block.plain) fields.push({ label: uniqueLabel(label, seen), text: block.lines.join("\n") });
        block = null;
      } else {
        block.lines.push(line);
      }
    } else if (line.startsWith("```")) {
      block = { plain: /^```\s*$/.test(line), lines: [] };
    } else {
      label = fieldLabel(line) || label;
    }
  }
  return fields;
}

function diffOperations(before, after) {
  const lengths = Array.from({ length: before.length + 1 }, () => new Array(after.length + 1).fill(0));
  for (let row = before.length - 1; row >= 0; row--) {
    for (let column = after.length - 1; column >= 0; column--) {
      lengths[row][column] = before[row] === after[column]
        ? lengths[row + 1][column + 1] + 1
        : Math.max(lengths[row + 1][column], lengths[row][column + 1]);
    }
  }
  const operations = [];
  let row = 0;
  let column = 0;
  while (row < before.length || column < after.length) {
    if (row < before.length && column < after.length && before[row] === after[column]) {
      operations.push(`  ${before[row++]}`);
      column++;
    } else if (column >= after.length || (row < before.length && lengths[row + 1][column] >= lengths[row][column + 1])) {
      operations.push(`- ${before[row++]}`);
    } else {
      operations.push(`+ ${after[column++]}`);
    }
  }
  return operations;
}

function lineDiff(before, after, context = 1) {
  const operations = diffOperations(before.split("\n"), after.split("\n"));
  const near = (index) => operations.some((operation, position) => !operation.startsWith("  ") && Math.abs(position - index) <= context);
  const lines = [];
  let previous = -1;
  operations.forEach((operation, index) => {
    if (near(index)) {
      if (previous >= 0 && index > previous + 1) lines.push("…");
      lines.push(operation);
      previous = index;
    }
  });
  return lines.join("\n");
}

function compareFields(before, after) {
  const beforeByLabel = new Map(before.map((field) => [field.label, field.text]));
  const afterLabels = new Set(after.map((field) => field.label));
  const current = after.map((field) => {
    const old = beforeByLabel.get(field.label);
    const status = old === undefined ? "added" : old === field.text ? "unchanged" : "changed";
    const diff = status === "changed" ? lineDiff(old, field.text) : null;
    return { label: field.label, status, text: field.text, diff };
  });
  const removed = before
    .filter((field) => !afterLabels.has(field.label))
    .map((field) => ({ label: field.label, status: "removed", text: field.text, diff: null }));
  return [...current, ...removed];
}

function assetStatus(before, after) {
  let status = "unchanged";
  if (before === null && after !== null) status = "added";
  else if (before !== null && after === null) status = "removed";
  else if (before !== after) status = "changed";
  return status;
}

function compareImages(images) {
  return images.map((image) => ({ ...image, status: assetStatus(image.before, image.after) }));
}

function summaryLine(heading, labels) {
  return labels.length ? `**${heading}:** ${labels.join(", ")}.` : null;
}

function summary(fields, notesLabel, images) {
  const items = [...fields, ...images];
  const named = (statuses) => items.filter((item) => statuses.includes(item.status)).map((item) => item.label);
  const change = [...named(["changed", "added"]), ...(notesLabel ? [notesLabel] : [])];
  return [
    summaryLine("Change", change),
    summaryLine("Remove", named(["removed"])),
    summaryLine("Unchanged", named(["unchanged"])),
  ].filter(Boolean).join("  \n");
}

function fenced(text, language = "") {
  return ["```" + language, text, "```"].join("\n");
}

function fieldSection(field) {
  const parts = [`### ${field.label} — ${STATUS_WORDS[field.status]}`];
  if (field.diff) parts.push(fenced(field.diff, "diff"), "New text, to paste:");
  if (field.status === "changed" || field.status === "added") parts.push(fenced(field.text));
  return parts.join("\n\n");
}

function imagesTable(images, browser) {
  const rows = images.map((image) => `| ${image.label} | ${STATUS_WORDS[image.status]} | ${image.status === "removed" ? "—" : "`" + image.upload + "`"} |`);
  return [`| Image | Status | Upload from \`dist/${browser}/\` |`, "|---|---|---|", ...rows].join("\n");
}

function report({ browser, version, baseline, note, fields, notesText, images }) {
  const store = STORES[browser];
  const notesLabel = store.releaseNotes;
  const parts = [
    `# ${store.title} listing changes for ${version}`,
    baseline ? `Compared with ${baseline}, the listing as of the previous store release.` : null,
    note,
    summary(fields, notesLabel, images),
    "## Text fields",
    ...fields.map(fieldSection),
  ].filter(Boolean);
  if (notesLabel) parts.push(`## ${notesLabel} — enter for ${version}`, fenced(notesText));
  if (images.length) parts.push("## Images", imagesTable(images, browser));
  return parts.join("\n\n") + "\n";
}

function git(args) {
  let output = null;
  try {
    output = execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    output = null;
  }
  return output;
}

function blobAt(tag, file) {
  const hash = tag ? git(["rev-parse", "--verify", "--quiet", `${tag}:${file}`]) : null;
  return hash ? hash.trim() : null;
}

function blobNow(file) {
  const hash = fs.existsSync(path.join(ROOT, file)) ? git(["hash-object", file]) : null;
  return hash ? hash.trim() : null;
}

function fingerprint(sources, hashOf) {
  const hashes = sources.map(hashOf);
  return hashes.every((hash) => hash === null) ? null : hashes.join(" ");
}

function screenshotNames(browser, tag) {
  const directory = `${browser}/screenshots`;
  const listed = tag ? git(["ls-tree", "--name-only", `${tag}:${directory}`]) : null;
  const before = (listed || "").split("\n").filter((name) => name.endsWith(".png"));
  const now = fs.readdirSync(path.join(ROOT, directory)).filter((name) => name.endsWith(".png"));
  return [...new Set([...now, ...before])].sort();
}

function imageAssets(browser, tag) {
  const screenshots = screenshotNames(browser, tag).map((name) => ({
    label: `Screenshot ${name}`, upload: `screenshots/${name}`, sources: [`${browser}/screenshots/${name}`],
  }));
  return [...STORES[browser].images, ...screenshots].map((image) => ({
    label: image.label,
    upload: image.upload,
    before: fingerprint(image.sources, (file) => blobAt(tag, file)),
    after: fingerprint(image.sources, blobNow),
  }));
}

function baselineFor(version, since) {
  const tags = (git(["tag", "--list", "v*"]) || "").split("\n").filter(Boolean);
  const tag = since || previousTag(tags, version);
  let note = null;
  if (!tag) note = `No release tag older than ${version} was found, so there is nothing to compare with: every field and image is listed as added.`;
  else if (!blobAt(tag, "Resources/manifest.json")) note = `${tag} is not a tag in this checkout, so there is nothing to compare with: every field and image is listed as added.`;
  return { tag: note ? null : tag, note };
}

function listingChanges(browser, since) {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "Resources", "manifest.json"), "utf8")).version;
  const { tag, note } = baselineFor(version, since);
  const listing = `${browser}/listing.md`;
  const oldListing = tag ? git(["show", `${tag}:${listing}`]) : null;
  const fields = compareFields(listingFields(oldListing || ""), listingFields(fs.readFileSync(path.join(ROOT, listing), "utf8")));
  const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  const notesText = STORES[browser].releaseNotes ? releaseNotes(changelog, version) : null;
  const missingListing = tag && oldListing === null ? `${listing} did not exist at ${tag}, so every field is listed as added.` : null;
  return report({
    browser, version, baseline: tag, note: missingListing || note,
    fields, notesText, images: compareImages(imageAssets(browser, tag)),
  });
}

function main() {
  const browser = process.argv[2];
  const sinceArgument = process.argv.slice(3).find((argument) => argument.startsWith("--since="));
  if (!BROWSERS.includes(browser)) {
    process.stderr.write("usage: node tools/listing-changes.js <chrome|firefox|safari> [--since=<tag>]\n");
    process.exitCode = 2;
  } else {
    process.stdout.write(listingChanges(browser, sinceArgument ? sinceArgument.slice("--since=".length) : null));
  }
}

if (require.main === module) main();

module.exports = { listingFields, compareFields, lineDiff, assetStatus, compareImages, previousTag, report, STORES };

// tools/screenshot-stamp.js — whether a browser's store screenshots show the
// extension as it is.
//
//   node tools/screenshot-stamp.js check <chrome|firefox|safari>
//
// tools/screenshots.js writes <browser>/screenshots/fingerprint after a run:
// a hash of everything in Resources/ but the manifest, plus the sample the
// screenshots are taken over. tools/package-extension.sh checks it before it
// puts a store's upload folder together, and refuses when the extension has
// changed since, naming the command that re-takes the set. The Safari set
// fell behind twice while the Chrome and Firefox sets moved on, since
// nothing but memory tied the three together.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RESOURCES = path.join(ROOT, "Resources");
const SAMPLE = path.join(ROOT, "Onix", "onix-3.1-whimsical.xml");
const BROWSERS = ["chrome", "firefox", "safari"];

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

function fingerprint() {
  const files = filesUnder(RESOURCES)
    .filter((file) => path.basename(file) !== "manifest.json" && path.basename(file) !== ".DS_Store")
    .concat(SAMPLE)
    .sort();
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(path.relative(ROOT, file)).update("\0").update(fs.readFileSync(file)).update("\0");
  }
  return hash.digest("hex");
}

function stampFile(browser) {
  return path.join(ROOT, browser, "screenshots", "fingerprint");
}

function stamp(browser) {
  fs.writeFileSync(stampFile(browser), fingerprint() + "\n");
}

function isCurrent(browser) {
  const file = stampFile(browser);
  return fs.existsSync(file) && fs.readFileSync(file, "utf8").trim() === fingerprint();
}

function main() {
  const [command, browser] = process.argv.slice(2);
  if (command !== "check" || !BROWSERS.includes(browser)) {
    console.error("usage: node tools/screenshot-stamp.js check <chrome|firefox|safari>");
    process.exit(2);
  }
  if (!isCurrent(browser)) {
    console.error(`${browser}/screenshots/ show an older extension: run npm run screenshots:${browser} and commit the result`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { fingerprint, stamp, isCurrent };

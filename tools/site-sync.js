// tools/site-sync.js — keep site/ in step with the assets it copies, and
// version its asset references.
//
//   npm run site:sync
//
// site/ carries its own copies of the three Chrome screenshots and the 128px
// icon, because the page is copied elsewhere to publish and has to be
// self-contained. This copies them in, then rewrites every local asset
// reference in the page and the privacy policy — src="Main.png",
// href="icon-128.png" — to carry a query with the file's content hash,
// Main.png?v=1a2b3c4d. The host caches images for thirty days and the HTML
// not at all, so without the query a re-taken screenshot stayed the old
// picture for a month after the page around it had changed. A test holds
// both the copies and the queries to the files. render-icons.sh and the
// Chrome screenshot script run this, so neither step needs remembering.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = path.join(ROOT, "site");
const COPIES = {
  "Main.png": "chrome/screenshots/Main.png",
  "CodeList.png": "chrome/screenshots/CodeList.png",
  "Violations.png": "chrome/screenshots/Violations.png",
  "icon-128.png": "Resources/icons/icon-128.png",
};
const PAGES = ["index.html", "privacy.html"];
const REFERENCE = /((?:src|href)=")([A-Za-z0-9._-]+\.(?:png|svg))(?:\?v=[0-9a-f]*)?(")/g;

function hashOf(file) {
  return crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
}

// Every local asset a page refers to, with the query it should carry.
function references(page) {
  const html = fs.readFileSync(path.join(SITE, page), "utf8");
  const refs = [];
  for (const match of html.matchAll(/(?:src|href)="([A-Za-z0-9._-]+\.(?:png|svg))(?:\?v=([0-9a-f]*))?"/g)) {
    refs.push({ asset: match[1], version: match[2] || "", expected: hashOf(path.join(SITE, match[1])) });
  }
  return refs;
}

function sync() {
  const changed = [];
  for (const [copy, source] of Object.entries(COPIES)) {
    const from = path.join(ROOT, source);
    const to = path.join(SITE, copy);
    if (!fs.existsSync(to) || !fs.readFileSync(from).equals(fs.readFileSync(to))) {
      fs.copyFileSync(from, to);
      changed.push(`site/${copy} <- ${source}`);
    }
  }
  for (const page of PAGES) {
    const file = path.join(SITE, page);
    const html = fs.readFileSync(file, "utf8");
    const versioned = html.replace(REFERENCE, (all, open, asset, close) =>
      `${open}${asset}?v=${hashOf(path.join(SITE, asset))}${close}`);
    if (versioned !== html) {
      fs.writeFileSync(file, versioned);
      changed.push(`site/${page}: asset queries`);
    }
  }
  return changed;
}

if (require.main === module) {
  const changed = sync();
  console.log(changed.length ? changed.map((c) => `  ${c}`).join("\n") : "  site/ already in step");
}

module.exports = { sync, references, hashOf, COPIES, PAGES };

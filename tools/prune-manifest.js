// tools/prune-manifest.js — the manifest each store gets.
//
//   node tools/prune-manifest.js <chrome|firefox|safari> <path/to/manifest.json> [--dev]
//
// The committed manifest carries every browser's keys, so one Resources/
// directory loads unpacked in any of them. A store build keeps only its
// own: Chrome's without browser_specific_settings, Firefox's without
// minimum_chrome_version, Safari's with a strict_min_version of its own and
// a description inside Apple's limit. version_name — the "-dev" the checkout
// shows — goes from all three. A --dev build keeps it, so a local install
// says -dev in About and on the extensions page like an unpacked load does,
// and its Safari build is named "ONIX Viewer Dev", since Safari lists
// extensions by the manifest's name and the dev app sits beside the store's.
// tools/package-extension.sh calls this on its staging copy; the suite calls
// pruneManifest() on the real manifest for all three targets, which is what
// keeps the limits from being learnt again from a store's rejection.

"use strict";

const TARGETS = ["chrome", "firefox", "safari"];

// Chrome Web Store: 132. App Store Connect, for a Safari web extension: 112.
const CHROME_DESCRIPTION_LIMIT = 132;
const SAFARI_DESCRIPTION_LIMIT = 112;

// The shared description is 118 characters; Safari's is the same sentence
// a few words shorter.
const SAFARI_DESCRIPTION =
  "Readable ONIX XML: tree view, short tags or reference names, EDItEUR code-list labels and automatic validation.";

// Safari 18 is the floor: content-visibility arrived there (MDN).
const SAFARI_MIN_VERSION = "18.0";

const DEV_NAME_SUFFIX = " Dev";

function pruneManifest(source, target, options = {}) {
  if (!TARGETS.includes(target)) throw new Error(`unknown target ${target}`);
  const manifest = JSON.parse(JSON.stringify(source));
  if (!options.dev) delete manifest.version_name;
  if (options.dev && target === "safari") manifest.name += DEV_NAME_SUFFIX;
  if (target === "chrome") {
    delete manifest.browser_specific_settings;
    if (manifest.description.length > CHROME_DESCRIPTION_LIMIT) {
      throw new Error(`Chrome description over ${CHROME_DESCRIPTION_LIMIT} characters`);
    }
  }
  if (target === "firefox") delete manifest.minimum_chrome_version;
  if (target === "safari") {
    delete manifest.minimum_chrome_version;
    manifest.browser_specific_settings = { safari: { strict_min_version: SAFARI_MIN_VERSION } };
    manifest.description = SAFARI_DESCRIPTION;
    if (manifest.description.length > SAFARI_DESCRIPTION_LIMIT) {
      throw new Error(`Safari description over ${SAFARI_DESCRIPTION_LIMIT} characters`);
    }
  }
  return manifest;
}

function main() {
  const args = process.argv.slice(2);
  const dev = args.includes("--dev");
  const [target, file] = args.filter((arg) => arg !== "--dev");
  if (!target || !file) {
    console.error("usage: node tools/prune-manifest.js <chrome|firefox|safari> <manifest.json> [--dev]");
    process.exit(2);
  }
  const fs = require("fs");
  const pruned = pruneManifest(JSON.parse(fs.readFileSync(file, "utf8")), target, { dev });
  fs.writeFileSync(file, JSON.stringify(pruned, null, 2) + "\n");
}

if (require.main === module) main();

module.exports = {
  pruneManifest, TARGETS, CHROME_DESCRIPTION_LIMIT, SAFARI_DESCRIPTION_LIMIT, SAFARI_MIN_VERSION, DEV_NAME_SUFFIX,
};

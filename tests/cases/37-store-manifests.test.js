// What each store is sent. tools/prune-manifest.js is the one place the
// committed manifest is cut down per browser; these run it on the real
// manifest for all three targets and hold the store limits that were once
// learnt from a rejection — Apple's 112 characters for a Safari extension's
// description among them. And a check that no shipped copy names a browser,
// since the extension is no longer Chrome's alone.
const fs = require("fs");
const path = require("path");
const { test, describe, assert, ROOT, RES } = require("../harness");
const {
  pruneManifest, TARGETS, CHROME_DESCRIPTION_LIMIT, SAFARI_DESCRIPTION_LIMIT, SAFARI_MIN_VERSION,
} = require(path.join(ROOT, "tools", "prune-manifest.js"));

const manifest = JSON.parse(fs.readFileSync(path.join(RES, "manifest.json"), "utf8"));

describe("Store manifests", () => {
  test("the committed manifest carries every browser's keys, and the -dev version name", () => {
    assert(manifest.minimum_chrome_version, "Chrome's minimum version");
    assert(manifest.browser_specific_settings && manifest.browser_specific_settings.gecko, "Firefox's settings");
    assert(manifest.version_name === `${manifest.version}-dev`, "the checkout says -dev");
    assert(!manifest.browser_specific_settings.safari, "Safari's own key is the packager's to add");
  });

  test("every store build drops version_name and keeps the version, name and scripts", () => {
    for (const target of TARGETS) {
      const pruned = pruneManifest(manifest, target);
      assert(!("version_name" in pruned), `${target}: no -dev`);
      assert(pruned.version === manifest.version, `${target}: the version`);
      assert(pruned.name === manifest.name, `${target}: the name`);
      assert(JSON.stringify(pruned.content_scripts) === JSON.stringify(manifest.content_scripts),
        `${target}: the content scripts untouched`);
      assert(JSON.stringify(pruned.web_accessible_resources) === JSON.stringify(manifest.web_accessible_resources),
        `${target}: the web-accessible resources untouched`);
      assert(JSON.stringify(pruned.permissions) === JSON.stringify(manifest.permissions), `${target}: the permissions`);
    }
    assert(manifest.version_name, "and the committed manifest still has its version_name afterwards");
  });

  test("Chrome's keeps Chrome's keys only, inside the Web Store's description limit", () => {
    const pruned = pruneManifest(manifest, "chrome");
    assert(pruned.minimum_chrome_version === manifest.minimum_chrome_version, "the minimum Chrome version");
    assert(!("browser_specific_settings" in pruned), "no Firefox or Safari keys");
    assert(pruned.description.length <= CHROME_DESCRIPTION_LIMIT,
      `description within ${CHROME_DESCRIPTION_LIMIT}; is ${pruned.description.length}`);
  });

  test("Firefox's keeps the gecko settings and drops Chrome's minimum version", () => {
    const pruned = pruneManifest(manifest, "firefox");
    assert(!("minimum_chrome_version" in pruned), "no Chrome key");
    const gecko = pruned.browser_specific_settings.gecko;
    assert(gecko.id === manifest.browser_specific_settings.gecko.id, "the add-on id");
    assert(gecko.data_collection_permissions, "the data-collection declaration AMO requires");
  });

  test("Safari's has its own minimum version and a description within Apple's 112 characters", () => {
    const pruned = pruneManifest(manifest, "safari");
    assert(!("minimum_chrome_version" in pruned), "no Chrome key");
    assert(!pruned.browser_specific_settings.gecko, "no Firefox key");
    assert(pruned.browser_specific_settings.safari.strict_min_version === SAFARI_MIN_VERSION, "Safari 18");
    assert(pruned.description.length <= SAFARI_DESCRIPTION_LIMIT,
      `description within ${SAFARI_DESCRIPTION_LIMIT}; is ${pruned.description.length}`);
    assert(pruned.description.startsWith("Readable ONIX XML:"), "the same sentence, shortened");
  });

  test("an unknown target is refused", () => {
    let threw = false;
    try { pruneManifest(manifest, "opera"); } catch { threw = true; }
    assert(threw, "opera is Chrome's build, not a target");
  });

  test("no shipped copy names a browser", () => {
    // The manifest description shows in every browser's extension settings
    // and the About window in every browser's page; neither may say which.
    assert(!/\bin (Chrome|Firefox|Safari)\b/.test(manifest.description), `the description: ${manifest.description}`);
    for (const file of ["viewer.js", "shell.js", "onix-popup.js"]) {
      const source = fs.readFileSync(path.join(RES, file), "utf8");
      const strings = source.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) || [];
      const naming = strings.filter((s) => /\bin (Chrome|Firefox|Safari)\b/.test(s));
      assert(naming.length === 0, `${file} says: ${naming.join(" | ")}`);
    }
  });
});

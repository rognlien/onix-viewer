const fs = require("fs");
const path = require("path");
const {
  test, describe, assert, ROOT, RES,
} = require("../harness");

describe("Reviewability", () => {
  const SHIPPED = fs.readdirSync(RES)
    .filter((f) => f.endsWith(".js") && !/^onix-(codelists|content-model)/.test(f));
  const sourceOf = (f) => fs.readFileSync(path.join(RES, f), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(RES, "manifest.json"), "utf8"));
  const security = fs.readFileSync(path.join(ROOT, "SECURITY.md"), "utf8");

  test("no dynamic code execution anywhere in the shipped scripts", () => {
    // "No remote code" is a declaration on the store listing, and eval or
    // new Function would contradict it even with a local string.
    for (const file of SHIPPED) {
      const code = sourceOf(file).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
      for (const pattern of [/\beval\s*\(/, /new\s+Function\s*\(/, /\bdocument\.write\s*\(/]) {
        assert(!pattern.test(code), `${file} must not use ${pattern}`);
      }
    }
  });

  test("storage is touched by content.js alone, under one key, for the rules", () => {
    // The viewer runs in the page's world and has no storage; the content
    // script reads and writes one key on its behalf. A second key, or a use
    // from another file, would be a new thing stored that SECURITY.md does
    // not describe.
    for (const file of SHIPPED) {
      const code = sourceOf(file).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
      const uses = [...code.matchAll(/storage\s*\.\s*(local|sync|session|managed)\b/g)];
      if (file === "content.js") {
        assert(uses.length > 0 && uses.every((m) => m[1] === "local"),
          `content.js uses storage.local only, found: ${uses.map((m) => m[1]).join(", ")}`);
        const keys = [...code.matchAll(/RULES_KEY\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
        assert(keys.join() === "rules", `one key, "rules"; got ${keys.join()}`);
        const calls = [...code.matchAll(/storage\.local\.(?:get|set|remove)\(([^)]*)\)/g)];
        assert(calls.length === 3 && calls.every((m) => m[1].includes("RULES_KEY")),
          `every storage call goes through RULES_KEY; found: ${calls.map((m) => m[0]).join(" | ")}`);
      } else {
        assert(uses.length === 0, `${file} must not touch storage`);
      }
    }
  });

  test("the only network call is the same-origin re-fetch of the page itself", () => {
    const calls = [];
    for (const file of SHIPPED) {
      for (const m of sourceOf(file).matchAll(/fetch\s*\(([^,)]*)/g)) calls.push(`${file}: ${m[1].trim()}`);
    }
    assert(calls.length === 1, `expected exactly one fetch(), found: ${calls.join(" | ")}`);
    assert(calls[0].includes("document.location.href"),
      `the one fetch must target the page's own URL, got: ${calls[0]}`);
  });

  test("no script element is ever given a remote src", () => {
    for (const file of SHIPPED) {
      const code = sourceOf(file);
      assert(!/["'`]https?:\/\/[^"'`]*\.js/.test(code),
        `${file} must not reference a remote script`);
    }
  });

  test("nothing is ever assigned to innerHTML", () => {
    // The XML source reaches the page as textContent on an inert data block
    // and is rendered to DOM nodes; the shipped scripts never write markup.
    for (const file of SHIPPED) {
      const code = sourceOf(file).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
      for (const m of code.matchAll(/\.(inner|outer)HTML\s*=/g)) {
        assert(false, `${file} assigns to ${m[1]}HTML`);
      }
      assert(!/insertAdjacentHTML/.test(code), `${file} must not use insertAdjacentHTML`);
    }
  });

  test("the checkout's version_name is the version marked -dev", () => {
    // What chrome://extensions and the About window show for an unpacked
    // load. The packager strips it, so a store copy shows the bare version;
    // release.sh moves both together.
    assert(manifest.version_name === `${manifest.version}-dev`,
      `version_name must be "${manifest.version}-dev", got ${JSON.stringify(manifest.version_name)}`);
  });

  test("the manifest declares one permission, storage, and nothing else", () => {
    // `storage` holds the reader's own rule set and nothing else; it is the
    // one permission, and it shows no install warning. Anything more is a
    // change to the security story that has to be argued in SECURITY.md.
    assert(JSON.stringify(manifest.permissions) === JSON.stringify(["storage"]),
      `permissions must be exactly ["storage"], got ${JSON.stringify(manifest.permissions)}`);
    assert(!manifest.host_permissions,
      `host_permissions must be absent, got ${JSON.stringify(manifest.host_permissions)}`);
    assert(!manifest.background,
      "there must be no background service worker");
    for (const key of ["optional_permissions", "optional_host_permissions", "externally_connectable"]) {
      assert(!manifest[key], `${key} must be absent`);
    }
  });

  test("SECURITY.md's manifest excerpt matches the real manifest", () => {
    // The excerpt is valid JSON and claims "there is nothing omitted", so
    // compare it structurally rather than by grepping for names — the
    // content script's own file would otherwise read as web-accessible.
    const fence = security.indexOf("```json");
    const excerpt = JSON.parse(security.slice(fence + 7, security.indexOf("```", fence + 7)));

    assert(JSON.stringify(excerpt.permissions) === JSON.stringify(manifest.permissions),
      "the excerpt's permissions must match the manifest's");
    assert(JSON.stringify(excerpt.web_accessible_resources) ===
      JSON.stringify(manifest.web_accessible_resources),
      "the excerpt's web_accessible_resources must match the manifest's exactly — " +
      `excerpt ${JSON.stringify(excerpt.web_accessible_resources)} vs ` +
      `manifest ${JSON.stringify(manifest.web_accessible_resources)}`);
    assert(JSON.stringify(excerpt.content_scripts) === JSON.stringify(manifest.content_scripts),
      "the excerpt's content_scripts must match the manifest's exactly — " +
      `excerpt ${JSON.stringify(excerpt.content_scripts)} vs ` +
      `manifest ${JSON.stringify(manifest.content_scripts)}`);
  });

  test("every script the content script injects is web-accessible and present", () => {
    // A script that is injected but not listed would simply fail to load on
    // every page, which is the kind of break no fixture would catch.
    const injected = [...sourceOf("content.js").matchAll(/getURL\(\s*[`"']([^`"'$]+)[`"']/g)]
      .map((m) => m[1]);
    assert(injected.length > 0, "expected to find the injected resources");
    const accessible = manifest.web_accessible_resources[0].resources;
    for (const resource of injected) {
      assert(accessible.includes(resource), `${resource} is injected but not web-accessible`);
      assert(fs.existsSync(path.join(RES, resource)), `${resource} is injected but missing`);
    }
  });
});

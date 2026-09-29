const fs = require("fs");
const path = require("path");
const {
  test, describe, assert, ROOT, FIXTURES,
} = require("../harness");

describe("Documentation", () => {
  // CLAUDE.md's fixture table is kept by hand, and a fixture that is not in it
  // is one nobody will know the purpose of. Both directions are held: every
  // file has a row, every row has a file.
  test("every fixture is in CLAUDE.md's fixture table, and every row has a file", () => {
    const notes = fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");
    const rows = [...notes.matchAll(/^\| `([a-z0-9.-]+\.xml)` \|/gm)].map((m) => m[1]);
    const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".xml"));
    const undocumented = files.filter((f) => !rows.includes(f));
    const missing = rows.filter((f) => !files.includes(f));
    assert(undocumented.length === 0, `fixtures with no row in CLAUDE.md: ${undocumented.join(", ")}`);
    assert(missing.length === 0, `rows in CLAUDE.md with no fixture: ${missing.join(", ")}`);
  });

  // site/ is the extension's web page, copied elsewhere to publish, so it
  // carries its own copies of the screenshots and the icon. Copies drift —
  // two screenshots in dist/chrome/ once fell two UI revisions behind — so
  // each is held byte for byte to the file it was copied from.
  // The store item ID is derived from the signing key and never changes, so
  // the page links it directly. It carried a placeholder once.
  test("site/ links the Chrome Web Store listing by its item ID", () => {
    const page = fs.readFileSync(path.join(ROOT, "site", "index.html"), "utf8");
    const links = [...page.matchAll(/https:\/\/chromewebstore\.google\.com\/detail\/[^"]+/g)].map((m) => m[0]);
    assert(links.length > 0, "the page should link the store");
    for (const link of links) {
      assert(link.endsWith("/afdfkehnjkpgfhkgpacimefkkgfgkife"), `store link with the wrong item ID: ${link}`);
    }
  });

  // The stores ask for a privacy policy URL; the page is site/privacy.html
  // and the front page links it. What it claims is what SECURITY.md claims:
  // one permission, one request. A page that drifted from that would be
  // the wrong kind of wrong to ship to a reviewer.
  test("site/ carries a privacy policy, linked from the page, that says nothing is stored", () => {
    const policy = fs.readFileSync(path.join(ROOT, "site", "privacy.html"), "utf8");
    const page = fs.readFileSync(path.join(ROOT, "site", "index.html"), "utf8");
    assert(page.includes('href="privacy.html"'), "the front page links the policy");
    assert(/stores nothing/.test(policy), "the policy says nothing is stored");
    assert(!/rules you paste/.test(policy), "and no longer describes the held-back rules editor");
    assert(/exactly one kind of network request/.test(policy), "and the one request");
    assert(/declares no permissions/.test(page), "the front page says there are no permissions");
  });

  // One directory per browser holds what is stable and that browser's: the
  // listing copy the store forms are filled from and the three screenshots
  // they take; Firefox and Safari also keep their port notes there. The
  // packager copies the first two into dist/<browser>/ beside the package.
  test("each browser directory holds its listing and three screenshots", () => {
    for (const browser of ["chrome", "firefox", "safari"]) {
      assert(fs.existsSync(path.join(ROOT, browser, "listing.md")), `${browser}/listing.md`);
      for (const shot of ["Main", "CodeList", "Violations"]) {
        assert(fs.existsSync(path.join(ROOT, browser, "screenshots", `${shot}.png`)), `${browser}/screenshots/${shot}.png`);
      }
    }
    for (const browser of ["firefox", "safari"]) {
      assert(fs.existsSync(path.join(ROOT, browser, "README.md")), `${browser}/README.md, the port notes`);
    }
    for (const tile of ["promo-tile.svg", "marquee.svg"]) {
      const svg = fs.readFileSync(path.join(ROOT, "chrome", tile), "utf8");
      assert(svg.includes('href="../icons/icon-original.png"'), `${tile} embeds the master by its path from chrome/`);
    }
  });

  test("site/'s screenshots and icon are the committed ones, byte for byte", () => {
    const pairs = {
      "site/Main.png": "chrome/screenshots/Main.png",
      "site/CodeList.png": "chrome/screenshots/CodeList.png",
      "site/Violations.png": "chrome/screenshots/Violations.png",
      "site/icon-128.png": "Resources/icons/icon-128.png",
    };
    for (const [copy, source] of Object.entries(pairs)) {
      const same = fs.readFileSync(path.join(ROOT, copy)).equals(fs.readFileSync(path.join(ROOT, source)));
      assert(same, `${copy} differs from ${source}; copy it over again`);
    }
  });
});

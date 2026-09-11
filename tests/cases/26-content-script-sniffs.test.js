const fs = require("fs");
const path = require("path");
const {
  test, describe, assert, RES, FIXTURES,
} = require("../harness");

describe("Content-script sniffs", () => {
  const contentJs = fs.readFileSync(path.join(RES, "content.js"), "utf8");

  function lift(...names) {
    const sources = names.map((name) => {
      const match = contentJs.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}\\n`));
      assert(match, `could not lift ${name}() out of content.js`);
      return match[0];
    });
    const stubBrowserApi = () => ({ runtime: { getURL: (p) => p } });
    return new Function("MODEL_VERSIONS", "browserAPI",
      `${sources.join("\n")}\nreturn { ${names.join(", ")} };`)(["3.1", "3.0"], stubBrowserApi);
  }

  test("looksLikeOnix accepts every ONIX fixture and rejects the others", () => {
    const { looksLikeOnix } = lift("looksLikeOnix");
    const dir = FIXTURES;
    const wrong = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".xml"))) {
      // The ONIX fixtures are the ones that must be taken over. malformed.xml
      // is a generic <root> document, so it is correctly left to the browser;
      // the parse-error panel is exercised by rendering it directly.
      const shouldMatch = file.startsWith("onix-");
      const got = looksLikeOnix(fs.readFileSync(path.join(dir, file), "utf8"));
      if (got !== shouldMatch) wrong.push(`${file}: expected ${shouldMatch}, got ${got}`);
    }
    assert(wrong.length === 0, wrong.join("; "));
  });

  test("only the content model matching the document's release is injected", () => {
    const { contentModelURLs } = lift("contentModelURLs", "modelURL");
    const cases = [
      ['<ONIXMessage xmlns="http://ns.editeur.org/onix/3.1/reference" release="3.1">', ["3.1"]],
      ['<ONIXMessage xmlns="http://ns.editeur.org/onix/3.0/reference" release="3.0">', ["3.0"]],
      ['<ONIXmessage xmlns="http://ns.editeur.org/onix/3.0/short" release="3.0">', ["3.0"]],
      ['<ONIXMessage release="3.1">', ["3.1"]],
      ["<ONIXMessage release='3.0'>", ["3.0"]],
      // Acknowledgement namespaces carry an extra segment, so these match on
      // the release attribute rather than the namespace.
      ['<ONIXMessageAcknowledgement xmlns="http://ns.editeur.org/onix/acknowledgement/3.0/reference" release="3.0">', ["3.0"]],
    ];
    for (const [head, expected] of cases) {
      const got = contentModelURLs(head);
      const want = expected.map((v) => `onix-content-model-${v}.js`);
      assert(JSON.stringify(got) === JSON.stringify(want),
        `${head.slice(0, 60)} → ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
  });

  test("an unreadable release ships both models, so the warning stays truthful", () => {
    const { contentModelURLs } = lift("contentModelURLs", "modelURL");
    // ONIX 2.1 and un-namespaced standalone <Product> records declare no
    // release. No model can match, but onix-validate.js's model.missing
    // warning lists what actually loaded — so both must be present.
    for (const head of ["<ONIXMessage>", "<Product><RecordReference>x</RecordReference>"]) {
      assert(contentModelURLs(head).length === 2,
        `${head} should ship both models, got ${JSON.stringify(contentModelURLs(head))}`);
    }
  });

  test("every ONIX fixture is matched with a model that covers its release", () => {
    const { contentModelURLs } = lift("contentModelURLs", "modelURL");
    const dir = FIXTURES;
    const wrong = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.startsWith("onix-"))) {
      const xml = fs.readFileSync(path.join(dir, file), "utf8");
      // A release is identifiable from the namespace as well as from the
      // release attribute — a standalone <Product> record carries only the
      // former, and detect() reads the version from it too.
      const release = (xml.match(/ns\.editeur\.org\/onix\/(?:acknowledgement\/)?(\d+\.\d+)\//) ||
                       xml.match(/release\s*=\s*["'](\d+\.\d+)["']/) || [])[1];
      const urls = contentModelURLs(xml);
      // ONIX 2.1 declares a release but has no model, so it is sent both.
      const bundled = fs.existsSync(path.join(RES, `onix-content-model-${release}.js`));
      const expected = bundled ? [`onix-content-model-${release}.js`] : null;
      if (expected && JSON.stringify(urls) !== JSON.stringify(expected)) {
        wrong.push(`${file} (release ${release}) → ${JSON.stringify(urls)}`);
      }
      if (!expected && urls.length !== 2) wrong.push(`${file} (no release) → ${JSON.stringify(urls)}`);
    }
    assert(wrong.length === 0, wrong.join("; "));
  });
});

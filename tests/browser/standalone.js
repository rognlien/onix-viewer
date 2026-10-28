// tests/browser/standalone.js — the standalone page in a real Chrome.
//
// Called from run.js's main(). The bundle is served to a plain HTML page and
// Chrome is launched without the extension, so nothing but the bundle can be
// at work. The jsdom case (tests/cases/44-standalone.test.js) covers the
// contract; this one settles what only a browser can: that the page really
// is inert to hostile text, that the clipboard gets the exact input, that no
// request leaves the page, and that a large feed opens.

const fs = require("fs");
const path = require("path");
const { bundle } = require("../../tools/build-standalone");

const ROOT = path.join(__dirname, "..", "..");
const PRODUCT = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "onix-3.1-standalone-product.xml"), "utf8");
const MALFORMED = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "malformed.xml"), "utf8");

// What a consumer page looks like: ordinary HTML, a fallback to show until
// the viewer takes over, and the script. The tests call open() themselves.
const CONSUMER = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Consumer</title></head>
<body>
<pre id="fallback">raw XML</pre>
<script src="onix-viewer-standalone.js"></script>
</body>
</html>
`;

// The two files run.js's server adds, by name.
function assets() {
  return {
    "onix-viewer-standalone.js": { type: "text/javascript", body: bundle() },
    "consumer.html": { type: "text/html", body: CONSUMER },
  };
}

async function standalone({ launch, served, test, assert }) {
  console.log("\nThe standalone page");
  const browser = await launch();
  try {
    // writeText needs clipboard-sanitized-write; clipboard-write alone leaves
    // it rejecting with NotAllowedError, and the viewer falls back silently.
    await browser.defaultBrowserContext().overridePermissions(new URL(served.url("")).origin,
      ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);

    // A fresh consumer page. `stored` seeds localStorage before any script
    // runs, the way a returning reader would have it. Ready once the bundle
    // has defined its entry point: there is no #oxv-validation to wait for.
    async function consumer({ stored } = {}) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      page.errors = [];
      page.requests = [];
      page.on("pageerror", (error) => page.errors.push(error.message));
      page.on("request", (request) => page.requests.push(request.url()));
      if (stored) await page.evaluateOnNewDocument((value) => localStorage.setItem("oxv-dialect", value), stored);
      await page.goto(served.url("consumer.html"), { waitUntil: "load" });
      await page.waitForFunction(() => typeof window.OnixViewerStandalone?.open === "function", { timeout: 10000 });
      return page;
    }

    const open = (page, xml) => page.evaluate((text) =>
      window.OnixViewerStandalone.open(text, { title: "Feed", fallback: document.getElementById("fallback") }), xml);

    await test("a document renders, resolves a code-list badge and drops the fallback", async () => {
      const page = await consumer();
      const result = await open(page, PRODUCT);
      const state = await page.evaluate(() => ({
        rows: document.querySelectorAll("#oxv-root .px-row").length,
        badge: document.querySelector("#oxv-root .px-codelist")?.textContent || "",
        fallback: Boolean(document.getElementById("fallback")),
        pruned: ["#oxv-validation", '[data-action="about"]', '[data-action="dialect-toggle"]',
          '[data-action="download-xml"]', "#oxv-release", '[data-action="rules"]', "link[rel=stylesheet]"]
          .filter((selector) => document.querySelector(selector)),
        styles: document.head.querySelectorAll("style").length,
      }));
      assert(result.rendered && result.parsed, `result: ${JSON.stringify(result)}`);
      assert(state.rows > 20, `the tree is rendered; got ${state.rows} rows`);
      assert(state.badge !== "", "a code-list label is resolved");
      assert(!state.fallback, "the fallback is removed");
      assert(state.pruned.length === 0, `controls that should be absent: ${state.pruned.join(", ")}`);
      assert(state.styles === 1, `one injected <style>; got ${state.styles}`);
      assert(page.errors.length === 0, `page errors: ${page.errors.join("; ")}`);
      await page.close();
    });

    await test("t and ? change nothing; w toggles wrapping", async () => {
      const page = await consumer();
      await open(page, PRODUCT);
      const snapshot = () => page.evaluate(() => document.documentElement.outerHTML);
      const before = await snapshot();
      await page.keyboard.press("t");
      await page.keyboard.press("?");
      await page.keyboard.press("v");
      assert(await snapshot() === before, "t, ? and v left the page as it was");
      await page.keyboard.press("w");
      assert(await page.evaluate(() => document.body.classList.contains("px-no-wrap")), "w, the positive control, acts");
      await page.close();
    });

    await test("a stored dialect preference that differs from the document is ignored", async () => {
      const page = await consumer({ stored: "short" });
      await open(page, PRODUCT);
      const state = await page.evaluate(() => ({
        names: [...document.querySelectorAll("#oxv-root .px-tag-name")].map((el) => el.textContent),
        stored: localStorage.getItem("oxv-dialect"),
      }));
      assert(state.names.includes("Product") && !state.names.includes("product"),
        `names as written; got ${state.names.slice(0, 4).join(", ")}`);
      assert(state.stored === "short", "and the preference itself is left alone");
      await page.close();
    });

    await test("malformed input shows the parse error, hides the toolbar and keeps the fallback", async () => {
      const page = await consumer();
      const result = await open(page, MALFORMED);
      const state = await page.evaluate(() => ({
        panel: document.querySelector("#oxv-root .px-error h2")?.textContent,
        toolbar: getComputedStyle(document.getElementById("oxv-toolbar")).display,
        fallback: Boolean(document.getElementById("fallback")),
      }));
      assert(result.rendered === true && result.parsed === false, `result: ${JSON.stringify(result)}`);
      assert(state.panel === "Could not parse XML", `panel: ${state.panel}`);
      assert(state.toolbar === "none", `toolbar display: ${state.toolbar}`);
      assert(state.fallback, "the fallback is kept");
      await page.close();
    });

    await test("markup inside a CDATA text node stays inert and triggers no request", async () => {
      const hostile = PRODUCT.replace(/<RecordReference>[^<]*<\/RecordReference>/,
        "<RecordReference><![CDATA[</script><img src=x onerror=\"window.pwned=1\">]]></RecordReference>");
      const page = await consumer();
      const before = page.requests.length;
      const result = await open(page, hostile);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const state = await page.evaluate(() => ({
        images: document.querySelectorAll("img").length,
        pwned: window.pwned === 1,
        shown: document.getElementById("oxv-root").textContent.includes("<img src=x"),
      }));
      assert(result.parsed === true, "the document is well-formed and renders");
      assert(state.shown, "the text is shown as text");
      assert(state.images === 0 && !state.pwned, `no element was made from it; images ${state.images}, pwned ${state.pwned}`);
      const after = page.requests.slice(before);
      assert(after.length === 0, `no request after open(); got ${after.join(", ")}`);
      assert(!page.requests.some((url) => /\/x(\?|$)/.test(url)), "nothing asked for src=x");
      await page.close();
    });

    // Text that a lossy copy would change: a byte-order mark, CRLF line
    // endings, non-ASCII text, an entity and a CDATA section.
    const HARD = "\uFEFF" + PRODUCT.replace(/<RecordReference>[^<]*<\/RecordReference>/,
      "<RecordReference>Qadir \u2013 caf\u00e9 \u2013 \u65e5\u672c\u8a9e &amp; <![CDATA[a < b]]></RecordReference>")
      .replace(/\r?\n/g, "\r\n");

    // Copy through the Clipboard API: the page records that writeText was
    // called and resolved, so a silent fall back to execCommand would fail.
    await test("copy puts the exact input on the clipboard through the Clipboard API", async () => {
      const page = await consumer({ stored: "short" });
      const origin = new URL(page.url()).origin;
      assert(origin === new URL(served.url("")).origin, `permissions were granted for ${served.url("")}; the page is at ${origin}`);
      const result = await page.evaluate((text) => {
        window.clipLog = [];
        const write = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = (value) => write(value).then(
          (done) => { window.clipLog.push("resolved"); return done; },
          (error) => { window.clipLog.push(`rejected: ${error.name}`); throw error; });
        document.execCommand = () => { window.clipLog.push("execCommand"); return false; };
        return window.OnixViewerStandalone.open(text);
      }, HARD);
      assert(result.parsed === true, `the hard input is well-formed; ${JSON.stringify(result)}`);
      await page.click('#oxv-toolbar [data-action="copy-xml"]');
      await page.waitForFunction(() => document.querySelector('[data-action="copy-xml"]').title === "Copied",
        { timeout: 5000 });
      const state = await page.evaluate(async () => ({ log: window.clipLog, text: await navigator.clipboard.readText() }));
      assert(state.log.join() === "resolved", `writeText resolved and execCommand did not run; log: ${state.log.join(" | ")}`);
      assert(state.text === HARD, "the clipboard holds the input, character for character");
      await page.close();
    });

    // Where the browser refuses the Clipboard API, the viewer copies through
    // a textarea, and a textarea normalises CRLF to LF. That is the fallback's
    // documented behaviour, not a defect to chase here.
    await test("where the Clipboard API refuses, the fallback copies the text with CRLF turned to LF", async () => {
      const page = await consumer();
      await page.evaluate((text) => {
        window.clipLog = [];
        navigator.clipboard.writeText = () => { window.clipLog.push("refused"); return Promise.reject(new Error("refused")); };
        const exec = document.execCommand.bind(document);
        document.execCommand = (command) => { window.clipLog.push(`execCommand ${command}`); return exec(command); };
        return window.OnixViewerStandalone.open(text);
      }, HARD);
      await page.click('#oxv-toolbar [data-action="copy-xml"]');
      await page.waitForFunction(() => document.querySelector('[data-action="copy-xml"]').title === "Copied",
        { timeout: 5000 });
      const state = await page.evaluate(async () => {
        const text = await navigator.clipboard.readText();
        return { log: window.clipLog, text };
      });
      assert(state.log.join() === "refused,execCommand copy", `the fallback ran; log: ${state.log.join(" | ")}`);
      assert(state.text === HARD.replace(/\r\n/g, "\n"), "the clipboard holds the input with CRLF turned to LF");
      assert(state.text !== HARD, "and so differs from the input");
      await page.close();
    });

    await test("a 300-product feed opens and renders the Products in view", async () => {
      const page = await consumer();
      const result = await page.evaluate(async (url) => {
        const xml = await (await fetch(url)).text();
        return window.OnixViewerStandalone.open(xml, { fallback: document.getElementById("fallback") });
      }, served.url("large.xml"));
      const state = await page.evaluate(() => ({
        meta: document.getElementById("oxv-meta").textContent,
        pending: document.querySelectorAll("#oxv-root .px-children.px-pending").length,
        rows: document.querySelectorAll("#oxv-root .px-row").length,
      }));
      assert(result.parsed === true, "parsed");
      assert(state.meta.includes("300 products"), `the pill counts the feed; got "${state.meta}"`);
      assert(state.pending > 250 && state.rows > 100, `most Products wait for the viewport; got ${state.pending} pending, ${state.rows} rows`);

      // The counts above hold even if nothing ever fills a Product, because
      // each keeps its open and close rows. Look at the content itself.
      const products = () => page.evaluate(() => {
        const containers = [...document.querySelectorAll("#oxv-root > .px-children > .px-children")]
          .filter((c) => c.previousElementSibling.querySelector(".px-tag-name")?.textContent === "Product");
        const describe = (c) => ({
          pending: c.classList.contains("px-pending"),
          references: [...c.querySelectorAll(".px-tag-name")].filter((n) => n.textContent === "RecordReference").length,
        });
        return { count: containers.length, first: describe(containers[0]), last: describe(containers[containers.length - 1]),
          pending: containers.filter((c) => c.classList.contains("px-pending")).length };
      });
      await page.waitForFunction(() => {
        const first = [...document.querySelectorAll("#oxv-root > .px-children > .px-children")]
          .find((c) => c.previousElementSibling.querySelector(".px-tag-name")?.textContent === "Product");
        return first && !first.classList.contains("px-pending");
      }, { timeout: 10000 });
      const initial = await products();
      assert(initial.count === 300, `300 Product containers; got ${initial.count}`);
      assert(!initial.first.pending && initial.first.references === 1, `the first Product is rendered; ${JSON.stringify(initial.first)}`);
      assert(initial.last.pending && initial.last.references === 0, `the last Product is empty; ${JSON.stringify(initial.last)}`);

      await page.evaluate(() => {
        const containers = [...document.querySelectorAll("#oxv-root > .px-children > .px-children")];
        containers[containers.length - 1].previousElementSibling.scrollIntoView({ behavior: "instant", block: "start" });
      });
      await page.waitForFunction(() => {
        const containers = [...document.querySelectorAll("#oxv-root > .px-children > .px-children")];
        return !containers[containers.length - 1].classList.contains("px-pending");
      }, { timeout: 10000 });
      const scrolled = await products();
      assert(!scrolled.last.pending && scrolled.last.references === 1, `the last Product is rendered once in view; ${JSON.stringify(scrolled.last)}`);
      assert(scrolled.pending < initial.pending, `fewer Products pending; ${initial.pending} before, ${scrolled.pending} after`);
      await page.close();
    });
  } finally {
    await browser.close();
  }
}

module.exports = { standalone, assets };

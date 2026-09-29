// tests/browser/firefox.js — the extension in a real Firefox.
//
//   npm run test:firefox
//   FIREFOX_BIN=/path/to/firefox npm run test:firefox
//
// tests/browser/run.js for Firefox: the same served fixtures, puppeteer-core
// driving the installed Firefox over WebDriver BiDi, and
// browser.installExtension() in place of Chrome's enableExtensions. Beyond
// pass/fail it prints what it sees, because two things only a run can
// settle are described in firefox/README.md — what Firefox's XML pretty-printer
// does to a root swapped mid-parse, and whether version_name survives
// runtime.getManifest() — and the next change to content.js depends on the
// answers.
//
// On macOS 27 the terminal this runs from needs Full Disk Access, or Firefox
// exits with "Could not find profile folder." before puppeteer hears from
// it: the OS protects ~/Library/Application Support/Firefox, and a Firefox
// spawned from a shell has only the shell's access. firefox/README.md has the rest.

const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..", "..");
const RESOURCES = path.join(ROOT, "Resources");
const FIXTURES = path.join(ROOT, "tests", "fixtures");
const SAMPLES = path.join(ROOT, "Onix");
const FIREFOX = process.env.FIREFOX_BIN || "/Applications/Firefox.app/Contents/MacOS/firefox";

// ---- a server for the fixtures -------------------------------------------

// tests/fixtures/ and Onix/ as application/xml, plus /large.xml: the EDItEUR
// sample product repeated until the file is big enough to arrive in more
// than one network chunk, which is the case the pretty-printer question is
// about.
function serve() {
  const large = largeFeed(300);
  const server = http.createServer((request, response) => {
    const name = path.basename(decodeURIComponent(request.url.split("?")[0]));
    const body = name === "large.xml" ? large : fileFor(name);
    if (body !== null) {
      response.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
      response.end(body);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      server,
      url: (name) => `http://127.0.0.1:${server.address().port}/${name}`,
    }));
  });
}

function fileFor(name) {
  let found = null;
  for (const dir of [FIXTURES, SAMPLES]) {
    const candidate = path.join(dir, name);
    if (found === null && fs.existsSync(candidate)) found = fs.readFileSync(candidate);
  }
  return found;
}

function largeFeed(count) {
  const sample = fs.readFileSync(path.join(SAMPLES, "onix-3.1-refnames.xml"), "utf8");
  const start = sample.indexOf("<Product>");
  const end = sample.indexOf("</Product>") + "</Product>".length;
  const product = sample.slice(start, end);
  const products = Array.from({ length: count }, (_, i) =>
    product.replace(/<RecordReference>[^<]*<\/RecordReference>/,
      `<RecordReference>large-${i}</RecordReference>`)).join("\n");
  return sample.slice(0, start) + products + sample.slice(end);
}

// ---- the browser -----------------------------------------------------------

async function launch() {
  const browser = await puppeteer.launch({
    browser: "firefox",
    executablePath: FIREFOX,
    headless: true,
  });
  await browser.installExtension(RESOURCES);
  return browser;
}

// What the page looks like after the takeover: the viewer's own state, and
// the layout facts that tell whether the pretty-printer's shadow root is
// sitting over the shell (a hidden light DOM has no laid-out height).
function inspect(page) {
  return page.evaluate(() => {
    const toolbar = document.getElementById("oxv-toolbar");
    const logo = document.getElementById("oxv-logo");
    const container = document.querySelector("#oxv-root > .px-children > .px-children");
    return {
      readyState: document.readyState,
      marked: document.documentElement.hasAttribute("data-oxv"),
      version: document.documentElement.getAttribute("data-oxv-version"),
      meta: document.getElementById("oxv-meta")?.textContent || "",
      verdict: document.getElementById("oxv-validation")?.textContent || "",
      rows: document.querySelectorAll("#oxv-root .px-row").length,
      badge: document.querySelector("#oxv-root .px-codelist")?.textContent || "",
      toolbarHeight: toolbar ? toolbar.getBoundingClientRect().height : 0,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      logoLoaded: logo ? `${logo.complete}/${logo.naturalWidth}px` : "none",
      contentVisibility: container ? getComputedStyle(container).contentVisibility : "n/a",
    };
  });
}

async function open(browser, url, timeout = 20000) {
  const page = await browser.newPage();
  const noise = [];
  page.on("pageerror", (error) => noise.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") noise.push(`console.error: ${message.text()}`);
  });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector("#oxv-root .px-row", { timeout });
  await page.waitForFunction(
    () => !document.getElementById("oxv-validation").textContent.includes("Validating"),
    { timeout });
  return { page, noise };
}

function customFindings(page, rules) {
  return page.evaluate((ruleText) => {
    const schematron = window.OnixViewerSchematron;
    const validation = window.OnixViewerValidation;
    schematron.reset();
    const installed = schematron.install(ruleText);
    const text = document.getElementById("__oxv-source__").textContent;
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const result = validation.run(doc, window.OnixViewerOnix.detect(doc));
    return {
      installed,
      findings: result.findings
        .filter((finding) => finding.code.startsWith("schematron."))
        .map((finding) => ({ code: finding.code, message: validation.message(finding) })),
    };
  }, rules);
}

// ---- a tiny async test runner ----------------------------------------------

const results = { passed: 0, failed: 0, failures: [] };

async function test(name, fn) {
  try {
    await fn();
    results.passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (error) {
    results.failed++;
    results.failures.push({ name, error });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "assertion failed");
}

function show(label, value) {
  console.log(`      ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

// ---- the tests ----------------------------------------------------------------

const HOUSE_RULES = fs.readFileSync(path.join(FIXTURES, "house-rules.sch"), "utf8");
const pattern = (body) =>
  `<schema xmlns="http://purl.oclc.org/dsdl/schematron"><pattern>${body}</pattern></schema>`;

async function main() {
  const served = await serve();
  const browser = await launch();
  console.log(`\nIn Firefox ${await browser.version()}`);
  try {
    await takeover(browser, served);
    await largeFeedCase(browser, served);
    await localFile(browser);
    await aboutAndStorage(browser, served);
    await xpathInGecko(browser, served);
  } finally {
    await browser.close();
    served.server.close();
  }
  console.log(`\n${results.passed} passed, ${results.failed} failed`);
  if (results.failed) {
    console.log("\nFailures:");
    for (const { name, error } of results.failures) console.log(`  - ${name}: ${error.message}`);
    process.exit(1);
  }
}

async function takeover(browser, served) {
  console.log("\nThe takeover");

  for (const name of ["onix-3.1-valid.xml", "onix-3.0-short.xml", "onix-2.1-doctype.xml"]) {
    await test(`${name} is taken over, rendered, styled and validated`, async () => {
      const { page, noise } = await open(browser, served.url(name));
      const state = await inspect(page);
      show("state", state);
      if (noise.length) show("noise", noise);
      assert(state.marked, "the replaced <html> carries data-oxv");
      assert(state.rows > 30, `the tree is rendered; got ${state.rows} rows`);
      assert(state.badge !== "", "a code-list label is resolved in the page");
      assert(state.toolbarHeight > 0, "the toolbar is laid out — a hidden light DOM means the pretty-printer's shadow root is over the shell");
      assert(state.bodyBackground !== "rgba(0, 0, 0, 0)", "viewer.css applied");
      assert(noise.length === 0, `no page errors; got ${noise.join(" | ")}`);
      await page.close();
    });
  }

  await test("a non-ONIX XML file is left to Firefox", async () => {
    const page = await browser.newPage();
    await page.goto(served.url("rss.xml"), { waitUntil: "load" });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const untouched = await page.evaluate(() =>
      !document.documentElement.hasAttribute("data-oxv") && !document.getElementById("oxv-root"));
    assert(untouched, "no takeover of an RSS feed");
    await page.close();
  });
}

// The case firefox/README.md is about: a feed that arrives in many chunks, so the
// swap happens while the XML parser is still running and the pretty-printer
// finds our <html> at DidBuildModel. Nothing is asserted about timing — the
// numbers are printed so the next change can be judged.
async function largeFeedCase(browser, served) {
  console.log("\nA large feed, swapped mid-parse");
  await test("300 products render with the toolbar laid out and the verdict in", async () => {
    const started = Date.now();
    const { page, noise } = await open(browser, served.url("large.xml"), 90000);
    const state = await inspect(page);
    show("seconds to the verdict", ((Date.now() - started) / 1000).toFixed(1));
    show("state", state);
    if (noise.length) show("noise", noise);
    assert(state.meta.includes("300 products"), `the count; got "${state.meta}"`);
    assert(state.toolbarHeight > 0, "the toolbar is laid out after the parse ended");
    assert(state.contentVisibility === "auto", `Product containers are content-visibility: auto; got ${state.contentVisibility}`);
    // Idle now: a mutation would unhook a lingering pretty-print. Look first.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const idle = await inspect(page);
    assert(idle.toolbarHeight > 0, "still laid out once idle");
    await page.close();
  });
}

async function localFile(browser) {
  console.log("\nA local file");
  await test("file:// is taken over through the DOM fallback, with no toggle", async () => {
    const url = "file://" + path.join(FIXTURES, "onix-3.1-valid.xml");
    const { page, noise } = await open(browser, url);
    const state = await inspect(page);
    show("state", state);
    if (noise.length) show("noise", noise);
    assert(state.marked && state.rows > 30, "rendered from file://");
    await page.close();
  });
}

async function aboutAndStorage(browser, served) {
  console.log("\nAbout, and the rules editor through browser.storage");

  await test("About shows a version; -dev only if Firefox keeps version_name", async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(RESOURCES, "manifest.json"), "utf8"));
    const { page } = await open(browser, served.url("onix-3.1-valid.xml"));
    await page.click('#oxv-toolbar [data-action="about"]');
    await page.waitForSelector("#oxv-about", { visible: true });
    const eyebrow = await page.evaluate(() => document.getElementById("oxv-about-version").textContent);
    show("About says", eyebrow);
    assert(eyebrow === `Version ${manifest.version}-dev` || eyebrow === `Version ${manifest.version}`,
      `one of the two spellings; got "${eyebrow}"`);
    await page.close();
  });

  const fires = pattern(`<rule context="Header"><report id="header-here" test="true()" role="warning">A header, noted</report></rule>`);

  await test("rules applied in the modal are kept and validate the next load", async () => {
    const { page } = await open(browser, served.url("onix-3.1-valid.xml"));
    await page.click('#oxv-toolbar [data-action="rules"]');
    await page.waitForSelector("#oxv-rules-text", { visible: true });
    await page.evaluate((text) => { document.getElementById("oxv-rules-text").value = text; }, fires);
    await page.click("#oxv-rules .px-rules-apply");
    await page.waitForFunction(() => document.getElementById("oxv-rules-status").textContent.includes("Kept"));
    const status = await page.evaluate(() => document.getElementById("oxv-rules-status").textContent);
    assert(status === "1 pattern, 1 assertion, applied. Kept for the next document.", `got "${status}"`);
    await page.close();

    const again = await open(browser, served.url("onix-3.1-valid.xml"));
    const reloaded = await again.page.evaluate(() => ({
      block: document.getElementById("__oxv-rules__")?.textContent || "",
      verdict: document.getElementById("oxv-validation").textContent,
    }));
    assert(reloaded.block === fires, "content.js wrote the stored rules into the page");
    assert(reloaded.verdict.includes("1 warning"), `the rules ran on load; got "${reloaded.verdict}"`);
    await again.page.click('#oxv-toolbar [data-action="rules"]');
    await again.page.waitForSelector("#oxv-rules-text", { visible: true });
    await again.page.click("#oxv-rules .px-rules-clear");
    await again.page.waitForFunction(() => document.getElementById("oxv-rules-status").textContent.includes("Kept"));
    await again.page.close();
  });
}

async function xpathInGecko(browser, served) {
  console.log("\nCustom rules on Gecko's XPath");
  const { page } = await open(browser, served.url("onix-3.1-valid.xml"));

  await test("the house rules install without problems and pass the valid fixture", async () => {
    const { installed, findings } = await customFindings(page, HOUSE_RULES);
    assert(installed.problems.length === 0, `no problems; got ${installed.problems.join("; ")}`);
    assert(findings.length === 0, `nothing fires; got ${JSON.stringify(findings)}`);
  });

  await test("name() and local-name() work", async () => {
    const { installed, findings } = await customFindings(page, pattern(`
      <rule context="*[name() = 'Contributor']">
        <report id="named" test="local-name() = 'Contributor'"><value-of select="name()"/> by name</report>
      </rule>`));
    assert(installed.problems.length === 0, `compiles; got ${installed.problems.join("; ")}`);
    assert(findings.length === 1 && findings[0].message === "Contributor by name", `got ${JSON.stringify(findings)}`);
  });

  await test("a prefixed name is refused and reported", async () => {
    const { installed, findings } = await customFindings(page, pattern(`
      <rule context="Product"><assert id="p" test="onix:RecordReference">x</assert></rule>`));
    show("problem", installed.problems);
    assert(installed.problems.length === 1 && installed.problems[0].includes("uses a namespace prefix"),
      `got ${installed.problems.join("; ")}`);
    assert(findings.length === 1 && findings[0].code === "schematron.invalid", `got ${JSON.stringify(findings)}`);
  });

  await test("a syntax error is caught at install, not thrown from the pass", async () => {
    const { installed, findings } = await customFindings(page, pattern(`
      <rule context="Product"><assert id="broken" test="RecordReference[">x</assert></rule>
      <rule context="Header"><report id="fine" test="true()">fine</report></rule>`));
    show("problem", installed.problems);
    assert(installed.problems.length === 1 && installed.problems[0].includes("not valid XPath 1.0"),
      `got ${installed.problems.join("; ")}`);
    assert(findings.map((finding) => finding.code).join() === "schematron.invalid,schematron.fine",
      `the sound rule still runs; got ${JSON.stringify(findings)}`);
  });

  await page.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

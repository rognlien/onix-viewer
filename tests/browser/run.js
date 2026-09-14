// tests/browser/run.js — the extension in a real Chrome.
//
//   npm run test:browser
//
// The jsdom suite proves the viewer against jsdom's DOM and jsdom's XPath.
// Two claims only a browser can settle: that the two content scripts take a
// raw XML page over at all, and that Chrome's XPath engine — the one the
// custom Schematron rules actually run on — agrees with the suite. This
// loads Resources/ unpacked into a headless Chrome, serves the fixtures over
// http as application/xml, and asks the page.
//
// It needs a Chrome on the machine (puppeteer-core drives the installed one
// and downloads nothing); GitHub's Ubuntu runners have it. It is not part of
// `npm test`, which stays a nine-second loop.

const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..", "..");
const RESOURCES = path.join(ROOT, "Resources");
const FIXTURES = path.join(ROOT, "tests", "fixtures");
const SAMPLES = path.join(ROOT, "Onix");

// ---- a server for the fixtures -------------------------------------------

// Serves tests/fixtures/ and Onix/ as application/xml — the MIME type the
// content script gates on — so a request looks like an ONIX feed would.
function serve() {
  const server = http.createServer((request, response) => {
    const file = fileFor(request.url);
    if (file) {
      response.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
      response.end(fs.readFileSync(file));
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

function fileFor(url) {
  const name = path.basename(decodeURIComponent(url.split("?")[0]));
  let found = null;
  for (const dir of [FIXTURES, SAMPLES]) {
    const candidate = path.join(dir, name);
    if (!found && fs.existsSync(candidate)) found = candidate;
  }
  return found;
}

// ---- the browser -----------------------------------------------------------

// `enableExtensions` loads the directory over the DevTools protocol. The
// classic `--load-extension` flag is ignored by branded Chrome since 137, and
// silently: the page just shows Chrome's own XML viewer.
function launch() {
  return puppeteer.launch({
    channel: "chrome",
    headless: true,
    enableExtensions: [RESOURCES],
    args: ["--no-sandbox"],
  });
}

// Open a served document and wait for the viewer to have taken it over and
// finished validating; the page's globals are then ready to be asked.
async function open(browser, url) {
  const page = await browser.newPage();
  page.on("pageerror", (error) => { throw error; });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector("#oxv-root .px-row", { timeout: 10000 });
  await page.waitForFunction(
    () => !document.getElementById("oxv-validation").textContent.includes("Validating"),
    { timeout: 10000 });
  return page;
}

// Install a rule set in the page and validate the served document, or `xml`
// in its place, returning the custom findings as { code, severity, message,
// node } — the shape the jsdom cases assert on.
function customFindings(page, rules, xml) {
  return page.evaluate((ruleText, source) => {
    const schematron = window.OnixViewerSchematron;
    const validation = window.OnixViewerValidation;
    schematron.reset();
    const installed = schematron.install(ruleText);
    const text = source || document.getElementById("__oxv-source__").textContent;
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const result = validation.run(doc, window.OnixViewerOnix.detect(doc));
    return {
      installed,
      findings: result.findings
        .filter((finding) => finding.code.startsWith("schematron."))
        .map((finding) => ({
          code: finding.code,
          severity: finding.severity,
          message: validation.message(finding),
          node: finding.node.nodeName,
        })),
    };
  }, rules, xml || null);
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

// ---- the tests ----------------------------------------------------------------

const HOUSE_RULES = fs.readFileSync(path.join(FIXTURES, "house-rules.sch"), "utf8");
const VALID = fs.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
const SAMPLE = fs.readFileSync(path.join(SAMPLES, "onix-3.1-refnames.xml"), "utf8");
const SHORT_SAMPLE = fs.readFileSync(path.join(SAMPLES, "onix-3.1-shorttags.xml"), "utf8");

const schema = (body) =>
  `<schema xmlns="http://purl.oclc.org/dsdl/schematron">${body}</schema>`;
const pattern = (body) => schema(`<pattern>${body}</pattern>`);

async function main() {
  const served = await serve();
  const browser = await launch();
  console.log(`\nIn Chrome ${await browser.version()}`);
  try {
    await takeover(browser, served);
    await schematronInChrome(browser, served);
    await rulesRoundTrip(browser, served);
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

  await test("a served ONIX file is taken over, rendered and validated", async () => {
    const page = await open(browser, served.url("onix-3.1-valid.xml"));
    const state = await page.evaluate(() => ({
      marked: document.documentElement.hasAttribute("data-oxv"),
      meta: document.getElementById("oxv-meta").textContent,
      verdict: document.getElementById("oxv-validation").textContent,
      rows: document.querySelectorAll("#oxv-root .px-row").length,
      badge: document.querySelector("#oxv-root .px-codelist")?.textContent || "",
    }));
    assert(state.marked, "the replaced <html> carries data-oxv");
    assert(state.meta.includes("ONIX 3.1") && state.meta.includes("1 product"),
      `the document pill names the release and count; got "${state.meta}"`);
    assert(state.verdict.includes("Valid"), `the verdict; got "${state.verdict}"`);
    assert(state.rows > 30, `the tree is rendered; got ${state.rows} rows`);
    assert(state.badge !== "", "a code-list label is resolved in the page");
    await page.close();
  });

  await test("the About window shows the manifest version, marked -dev for an unpacked load", async () => {
    // The store stamps update_url into the manifest it serves; this load has
    // none, so content.js appends -dev. A store copy would show the bare
    // version — which is the one thing this test cannot see.
    const manifest = JSON.parse(fs.readFileSync(path.join(RESOURCES, "manifest.json"), "utf8"));
    const page = await open(browser, served.url("onix-3.1-valid.xml"));
    await page.click('#oxv-toolbar [data-action="about"]');
    await page.waitForSelector("#oxv-about", { visible: true });
    const shown = await page.evaluate(() => ({
      stamped: document.documentElement.getAttribute("data-oxv-version"),
      eyebrow: document.getElementById("oxv-about-version").textContent,
    }));
    assert(shown.stamped === `${manifest.version}-dev`, `stamped on the shell; got "${shown.stamped}"`);
    assert(shown.eyebrow === `Version ${manifest.version}-dev`, `shown in About; got "${shown.eyebrow}"`);
    await page.close();
  });

  await test("a non-ONIX XML file is left to the browser", async () => {
    const page = await browser.newPage();
    await page.goto(served.url("rss.xml"), { waitUntil: "load" });
    const untouched = await page.evaluate(() =>
      !document.documentElement.hasAttribute("data-oxv") && !document.getElementById("oxv-root"));
    assert(untouched, "no takeover of an RSS feed");
    await page.close();
  });
}

async function schematronInChrome(browser, served) {
  console.log("\nCustom rules on Chrome's XPath");
  const page = await open(browser, served.url("onix-3.1-valid.xml"));

  await test("the house rules install without problems and pass the valid fixture", async () => {
    const { installed, findings } = await customFindings(page, HOUSE_RULES);
    assert(installed.patterns === 3 && installed.assertions === 5,
      `3 patterns and 5 assertions; got ${JSON.stringify(installed)}`);
    assert(installed.problems.length === 0, `no problems; got ${installed.problems.join("; ")}`);
    assert(findings.length === 0, `nothing fires; got ${JSON.stringify(findings)}`);
  });

  await test("an assert, a report and their value-ofs fire as in the suite", async () => {
    const foreign = VALID
      .replace("<IDValue>9788234567896</IDValue>", "<IDValue>9780306406157</IDValue>")
      .replace("<SequenceNumber>1</SequenceNumber>", "<SequenceNumber>2</SequenceNumber>");
    const { findings } = await customFindings(page, HOUSE_RULES, foreign);
    const messages = findings.map((finding) => `${finding.code} [${finding.severity}] ${finding.message} @${finding.node}`);
    assert(messages.join("\n") === [
      "schematron.isbn-prefix [warning] ISBN 9780306406157 is outside the 978-82 prefix @ProductIdentifier",
      "schematron.sequence-gap [error] Contributor 2 is out of sequence: expected 1 @Contributor",
    ].join("\n"), `got:\n${messages.join("\n")}`);
  });

  await test("the EDItEUR sample gives the same findings in both dialects", async () => {
    const reference = (await customFindings(page, HOUSE_RULES, SAMPLE)).findings;
    const short = (await customFindings(page, HOUSE_RULES, SHORT_SAMPLE)).findings;
    assert(reference.length > 0, "the sample trips a house rule");
    const codes = (list) => list.map((finding) => finding.code).join(",");
    assert(codes(reference) === codes(short),
      `reference: ${codes(reference)}\nshort: ${codes(short)}`);
    assert(short[0].node === short[0].node.toLowerCase(),
      `pinned to the short-tag element; got <${short[0].node}>`);
  });

  await test("name() and local-name() work here, where jsdom's XPath cannot run them", async () => {
    // The reason this file exists: a rule set may lean on XPath the suite
    // can't exercise. These are the forms jsdom throws on.
    const { installed, findings } = await customFindings(page, pattern(`
      <rule context="*[name() = 'Contributor']">
        <report id="named" test="local-name() = 'Contributor'"><value-of select="name()"/> by name</report>
      </rule>`));
    assert(installed.problems.length === 0, `compiles; got ${installed.problems.join("; ")}`);
    assert(findings.length === 1 && findings[0].message === "Contributor by name",
      `got ${JSON.stringify(findings)}`);
  });

  await test("Chrome refuses a prefixed name at compile time, and the problem is reported", async () => {
    const { installed, findings } = await customFindings(page, pattern(`
      <rule context="Product"><assert id="p" test="onix:RecordReference">x</assert></rule>`));
    assert(installed.problems.length === 1 && installed.problems[0].includes("uses a namespace prefix"),
      `got ${installed.problems.join("; ")}`);
    assert(findings.length === 1 && findings[0].code === "schematron.invalid",
      `reported as a finding; got ${JSON.stringify(findings)}`);
  });

  await test("a syntax error is caught at install, not thrown from the pass", async () => {
    const { installed, findings } = await customFindings(page, pattern(`
      <rule context="Product"><assert id="broken" test="RecordReference[">x</assert></rule>
      <rule context="Header"><report id="fine" test="true()">fine</report></rule>`));
    assert(installed.problems.length === 1 && installed.problems[0].includes("not valid XPath 1.0"),
      `got ${installed.problems.join("; ")}`);
    assert(findings.map((finding) => finding.code).join() === "schematron.invalid,schematron.fine",
      `the sound rule still runs; got ${JSON.stringify(findings)}`);
  });

  await page.close();
}

// The rules editor end to end: pasted in the modal, kept in extension
// storage by content.js, and back on the next page load as a pill. This is
// the one path no jsdom test can walk — content.js never loads there.
async function rulesRoundTrip(browser, served) {
  console.log("\nThe rules editor and storage");
  const fires = `<schema xmlns="http://purl.oclc.org/dsdl/schematron"><pattern>
    <rule context="Header"><report id="header-here" test="true()" role="warning">A header, noted</report></rule>
  </pattern></schema>`;

  await test("rules applied in the modal are stored and validate the next load", async () => {
    const page = await open(browser, served.url("onix-3.1-valid.xml"));
    await page.click('#oxv-toolbar [data-action="rules"]');
    await page.waitForSelector("#oxv-rules-text", { visible: true });
    await page.evaluate((text) => { document.getElementById("oxv-rules-text").value = text; }, fires);
    await page.click("#oxv-rules .px-rules-apply");
    await page.waitForFunction(() => document.getElementById("oxv-rules-status").textContent.includes("Kept"));
    const state = await page.evaluate(() => ({
      status: document.getElementById("oxv-rules-status").textContent,
      verdict: document.getElementById("oxv-validation").textContent,
      pressed: document.querySelector('#oxv-toolbar [data-action="rules"]').getAttribute("aria-pressed"),
    }));
    assert(state.status === "1 pattern, 1 assertion, applied. Kept for the next document.",
      `the status, acknowledged by content.js; got "${state.status}"`);
    assert(state.verdict.includes("1 warning"), `re-validated at once; got "${state.verdict}"`);
    assert(state.pressed === "true", "the cog is pressed");
    await page.close();

    const again = await open(browser, served.url("onix-3.1-valid.xml"));
    const reloaded = await again.evaluate(() => ({
      block: document.getElementById("__oxv-rules__")?.textContent || "",
      verdict: document.getElementById("oxv-validation").textContent,
      pill: document.querySelector("#oxv-root .px-finding")?.getAttribute("aria-label") || "",
      pressed: document.querySelector('#oxv-toolbar [data-action="rules"]').getAttribute("aria-pressed"),
    }));
    assert(reloaded.block === fires, "content.js wrote the stored rules into the page");
    assert(reloaded.verdict.includes("1 warning"), `the rules ran on load; got "${reloaded.verdict}"`);
    assert(reloaded.pill.includes("A header, noted"), `the pill on the row; got "${reloaded.pill}"`);
    assert(reloaded.pressed === "true", "the cog shows rules are active");
    await again.close();
  });

  await test("clearing the rules in the modal clears the store", async () => {
    const page = await open(browser, served.url("onix-3.1-valid.xml"));
    await page.click('#oxv-toolbar [data-action="rules"]');
    await page.waitForSelector("#oxv-rules-text", { visible: true });
    await page.click("#oxv-rules .px-rules-clear");
    await page.waitForFunction(() => document.getElementById("oxv-rules-status").textContent.includes("Kept"));
    const cleared = await page.evaluate(() => document.getElementById("oxv-validation").textContent);
    assert(cleared.includes("Valid"), `clean at once; got "${cleared}"`);
    await page.close();

    const again = await open(browser, served.url("onix-3.1-valid.xml"));
    const reloaded = await again.evaluate(() => ({
      block: !!document.getElementById("__oxv-rules__"),
      verdict: document.getElementById("oxv-validation").textContent,
    }));
    assert(!reloaded.block, "no rules block on the next load");
    assert(reloaded.verdict.includes("Valid"), `clean again; got "${reloaded.verdict}"`);
    await again.close();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

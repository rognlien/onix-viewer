// tests/harness.js — ONIX Viewer test harness
//
// Loads the viewer scripts in jsdom, points them at fixture files, and
// asserts on the rendered DOM. Catches logic regressions (codelist
// resolution, ONIX detection, fold behavior) but cannot catch browser
// rendering or content-script timing bugs — for those, load the extension
// unpacked in Chrome per the README.
//
// The cases live in tests/cases/, one file per area, loaded in name order by
// tests/run.js; each pulls what it needs from here.
//
// Usage:
//   npm install        (one-time, installs jsdom)
//   npm test           (or: node tests/run.js)

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const RES = path.join(ROOT, "Resources");
const FIXTURES = path.join(__dirname, "fixtures");
const SAMPLES = path.join(ROOT, "Onix");

const codelistsJs = fs.readFileSync(path.join(RES, "onix-codelists.js"), "utf8");
const contentModelFor = {
  "3.1": fs.readFileSync(path.join(RES, "onix-content-model-3.1.js"), "utf8"),
  "3.0": fs.readFileSync(path.join(RES, "onix-content-model-3.0.js"), "utf8"),
};
const contentModelJs = [
  contentModelFor["3.1"],
  contentModelFor["3.0"],
].join("\n");
const onixJs = fs.readFileSync(path.join(RES, "onix.js"), "utf8");
const validateJs = fs.readFileSync(path.join(RES, "onix-validate.js"), "utf8");
const popupJs = fs.readFileSync(path.join(RES, "onix-popup.js"), "utf8");
const viewerJs = fs.readFileSync(path.join(RES, "viewer.js"), "utf8");
const viewerCss = fs.readFileSync(path.join(RES, "viewer.css"), "utf8");

// ---- minimal test framework ------------------------------------------------

// An optional case-insensitive substring filter, matched against the test name
// and its describe label:
//
//   node tests/run.js                # everything
//   node tests/run.js x512           # one test
//   node tests/run.js validation     # a whole describe block
//   npm test -- "short tag"          # via npm, note the --
//
// Without it, debugging one assertion means reading past 150 lines of ✓.
const FILTER = (process.argv[2] || "").toLowerCase();

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

// The describe label is printed lazily, so filtering to one test doesn't leave
// the headings of every block it skipped.
let currentLabel = "";
let labelPending = false;

function test(name, fn) {
  if (FILTER && !`${currentLabel} ${name}`.toLowerCase().includes(FILTER)) {
    skipped++;
    return;
  }
  if (labelPending) {
    console.log(`\n${currentLabel}`);
    labelPending = false;
  }
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${err.message}`);
  }
}

function describe(label, fn) {
  currentLabel = label;
  labelPending = true;
  fn();
  currentLabel = "";
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

// ---- harness: render a fixture and return the jsdom window -----------------

function render(fixtureName, beforeScripts) {
  return renderSource(fs.readFileSync(path.join(FIXTURES, fixtureName), "utf8"), fixtureName, beforeScripts);
}

// Render arbitrary XML — used by the fixtures above and by the conversion
// tests, which read their input from Onix/ rather than tests/fixtures/.
// `beforeScripts(window)` runs after the shell exists but before the viewer
// scripts execute, so a test can seed localStorage the way a returning reader
// would have it.
function renderSource(xml, label, beforeScripts, models) {
  const fixtureName = label || "inline.xml";

  const html = `<!doctype html><html><head><style>${viewerCss}</style></head>
<body>
  <div id="oxv-toolbar">
    <div class="px-left">
      <img id="oxv-logo" src="icons/icon-48.png" width="28" height="28" alt="ONIX Viewer">
      <button data-action="expand"></button>
      <button data-action="collapse"></button>
      <button data-action="toggle-wrap"></button>
      <button data-action="copy-xml"></button>
      <span class="px-dialect-group">
        <button data-action="dialect-toggle" aria-pressed="false"></button>
      </span>
      <span class="px-search-group">
        <button class="px-icon-btn" data-action="search" aria-expanded="false"></button>
        <input id="oxv-search" tabindex="-1">
        <span id="oxv-search-status"></span>
      </span>
    </div>
    <div class="px-center">
      <span id="oxv-meta"><span id="oxv-block-list"></span></span>
      <span id="oxv-validation"></span>
    </div>
    <div class="px-right">
      <span id="oxv-schema"></span>
    </div>
  </div>
  <div id="oxv-main">
    <main id="oxv-root" tabindex="0"></main>
  </div>
</body></html>`;

  const vc = new VirtualConsole();
  vc.on("error", (e) => {
    // Re-throw inside the test so a script error fails it loudly.
    throw e;
  });

  const dom = new JSDOM(html, {
    url: "https://example.com/" + fixtureName,
    runScripts: "outside-only",
    virtualConsole: vc,
  });
  const { window } = dom;
  window.__OXV_SOURCE__ = xml;
  if (beforeScripts) beforeScripts(window);

  window.eval(codelistsJs);
  // Production ships only the model matching the document's release (see
  // content.js's contentModelURLs); most tests load both, which is the
  // superset, but a test can pin the exact set the content script would send.
  window.eval(models ? models.map((v) => contentModelFor[v]).join("\n") : contentModelJs);
  window.eval(onixJs);
  window.eval(validateJs);
  window.eval(popupJs);
  window.eval(viewerJs);

  return window;
}

// Helpers for assertions on rendered output.
function $$(window, sel) {
  return Array.from(window.document.querySelectorAll(sel));
}
function meta(window) {
  return window.document.getElementById("oxv-meta").textContent;
}
// Open/leaf rows (close rows excluded) whose element is named tagName.
function rowsNamed(window, tagName) {
  return $$(window, "#oxv-root .px-row").filter((row) => {
    const name = row.querySelector(".px-tag + .px-tag");
    return name && name.textContent === tagName && !row.classList.contains("px-close-row");
  });
}
function badges(window) {
  return $$(window, "#oxv-root .px-codelist").map((b) => b.textContent);
}
// Capture what the viewer writes to the clipboard.
function stubClipboard(window) {
  const copied = { text: null };
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: (text) => { copied.text = text; return Promise.resolve(); } },
  });
  return copied;
}
// The right pane builds its cards on first reveal, not at load — so a test
// that asserts on the pane has to show it first, the same way a reader would.
// Text of the collapsed-row summary chips on rows named tagName.
function summariesOf(window, tagName) {
  return rowsNamed(window, tagName)
    .map((row) => row.querySelector(".px-summary"))
    .filter(Boolean)
    .map((chip) => chip.textContent);
}

// ---- validation helpers ----------------------------------------------------

// Validate arbitrary XML inside a given window, so a test can register a
// rule and then exercise it against several documents in one context.
function findingsFor(window, xml) {
  const doc = new window.DOMParser().parseFromString(xml, "application/xml");
  return window.OnixViewerValidation.run(doc, window.OnixViewerOnix.detect(doc));
}
// The findings for the document the window was rendered from.
function findings(window) {
  return findingsFor(window, window.__OXV_SOURCE__);
}
function codes(result) {
  return result.findings.map((f) => f.code);
}
// The toolbar's validation label, which is also the button that opens the list.
function validationLabel(window) {
  return window.document.getElementById("oxv-validation");
}
// The same document in short tags, through the viewer's own converter.
function shortTwin(window, xml) {
  const doc = new window.DOMParser().parseFromString(xml, "application/xml");
  const translated = window.OnixViewerOnix.translateNode(doc, "short");
  return new window.XMLSerializer().serializeToString(translated);
}
// The valid 3.1 fixture with `extra` inserted after <ProductForm>.
function withDescriptiveDetail(extra) {
  const valid = fs.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
  return valid.replace("<ProductForm>BC</ProductForm>",
    "<ProductForm>BC</ProductForm>\n      " + extra);
}

// ---- summary ---------------------------------------------------------------

function summary() {
  const filterNote = FILTER ? `, ${skipped} skipped by filter "${FILTER}"` : "";
  console.log(`\n${passed} passed, ${failed} failed${filterNote}`);
  if (FILTER && passed + failed === 0) {
    console.log(`No test matched "${FILTER}".`);
    process.exit(1);
  }
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`);
    process.exit(1);
  }
}

module.exports = {
  test, describe, assert, render, renderSource, $$,
  meta, rowsNamed, badges, stubClipboard, summariesOf, findingsFor,
  findings, codes, validationLabel, shortTwin, withDescriptiveDetail, ROOT,
  RES, FIXTURES, SAMPLES, contentModelFor, contentModelJs, codelistsJs,
  onixJs, validateJs, popupJs, viewerJs, viewerCss, summary,
};

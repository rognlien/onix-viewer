// The <onix-viewer> element (component/onix-viewer-element.js): the viewer in
// a shadow root of its own, inside an ordinary HTML page. The page is served
// from the repository by a resource loader, so the element loads the
// viewer's scripts and stylesheet the way it does in a browser.
const fs = require("fs");
const path = require("path");
const { JSDOM, ResourceLoader, VirtualConsole } = require("jsdom");
const { test, describe, assert, FIXTURES, ROOT } = require("../harness");

const ORIGIN = "https://example.com/";
const valid = fs.readFileSync(path.join(FIXTURES, "onix-3.1-valid.xml"), "utf8");
const invalid = fs.readFileSync(path.join(FIXTURES, "onix-3.1-invalid.xml"), "utf8");

class RepositoryLoader extends ResourceLoader {
  fetch(url) {
    const file = path.join(ROOT, decodeURIComponent(new URL(url).pathname));
    return file.startsWith(ROOT) && fs.existsSync(file)
      ? Promise.resolve(fs.readFileSync(file))
      : Promise.reject(new Error(`not in the repository: ${url}`));
  }
}

function page(body) {
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on("jsdomError", (error) => {
    if (!/Could not parse CSS stylesheet/.test(error.message)) errors.push(error);
  });
  const dom = new JSDOM(`<!doctype html><html><head>
<script src="component/onix-viewer-element.js"></script>
</head><body>${body}</body></html>`, {
    url: `${ORIGIN}page.html`,
    runScripts: "dangerously",
    resources: new RepositoryLoader(),
    virtualConsole,
  });
  return new Promise((resolve) => {
    dom.window.addEventListener("load", () => resolve({ window: dom.window, errors }));
  });
}

function validated(element) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no onix-validated event")), 5000);
    element.addEventListener("onix-validated", (event) => {
      clearTimeout(timer);
      resolve(event.detail);
    }, { once: true });
  });
}

async function viewers(count, xml) {
  const { window, errors } = await page("<onix-viewer></onix-viewer>".repeat(count));
  const elements = [...window.document.querySelectorAll("onix-viewer")];
  const results = elements.map(validated);
  elements.forEach((element, index) => { element.xml = Array.isArray(xml) ? xml[index] : xml; });
  return { window, errors, elements, results: await Promise.all(results) };
}

function rows(element) {
  return element.shadowRoot.querySelectorAll("#oxv-root .px-row");
}

function key(element, name) {
  const target = element.shadowRoot.getElementById("oxv-root");
  target.dispatchEvent(new element.ownerDocument.defaultView.KeyboardEvent("keydown", { key: name, bubbles: true, composed: true }));
}

describe("The <onix-viewer> element", () => {
  test("renders the document into its shadow root, not the page", async () => {
    const { window, errors, elements: [element] } = await viewers(1, valid);
    assert(rows(element).length > 10, `expected a tree, got ${rows(element).length} rows`);
    assert(!window.document.getElementById("oxv-root"), "the page's own document gains no viewer markup");
    assert(element.shadowRoot.querySelector("#oxv-toolbar"), "the toolbar comes with it");
    assert(errors.length === 0, `no script errors: ${errors.map((e) => e.message).join(" | ")}`);
  });

  test("announces each finished pass with its findings worded", async () => {
    const { results: [detail] } = await viewers(1, invalid);
    assert(detail.version === "3.1", `version: ${detail.version}`);
    assert(detail.errors > 0 && detail.findings.length > 0, "the invalid fixture has errors");
    assert(detail.findings.every((f) => f.code && f.severity && typeof f.message === "string" && f.message),
      "each finding carries its code, severity and message");
  });

  test("viewers on one page keep their own state", async () => {
    const { elements: [first, second] } = await viewers(2, valid);
    key(first, "c");
    const folded = (element) => element.shadowRoot.querySelectorAll(".px-row.px-folded").length;
    assert(folded(first) > 0, "the first viewer folded");
    assert(folded(second) === 0, "the second did not");
    key(second, "w");
    const frame = (element) => element.shadowRoot.querySelector(".px-frame");
    assert(frame(second).classList.contains("px-no-wrap"), "wrap is off in the second");
    assert(!frame(first).classList.contains("px-no-wrap"), "and still on in the first");
  });

  test("a key pressed elsewhere on the page does not reach a viewer", async () => {
    const { window, elements: [element] } = await viewers(1, valid);
    window.document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "c", bubbles: true }));
    assert(element.shadowRoot.querySelectorAll(".px-row.px-folded").length === 0, "nothing folded");
  });

  test("a new document replaces the old one", async () => {
    const { elements: [element] } = await viewers(1, valid);
    const before = element.shadowRoot.querySelector(".px-frame");
    const next = validated(element);
    element.xml = invalid;
    await next;
    assert(!before.isConnected, "the old frame is gone");
    assert(element.shadowRoot.querySelectorAll(".px-frame").length === 1, "one frame");
    key(element, "w");
    assert(element.shadowRoot.querySelector(".px-frame").classList.contains("px-no-wrap"),
      "the keys reach the new viewer");
  });

  test("the code-list popup opens inside the viewer that asked", async () => {
    const { window, elements: [element] } = await viewers(1, valid);
    const link = element.shadowRoot.querySelector(".px-codelist-link");
    assert(link, "the fixture has a code-list link");
    link.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
    const overlay = element.shadowRoot.querySelector(".px-popup-overlay:not([hidden])");
    assert(overlay, "the popup is in the shadow root");
    assert(!window.document.body.querySelector(".px-popup-overlay"), "not in the page");
  });

  test("src fetches the document", async () => {
    const { window } = await page("");
    window.fetch = async (url) => ({ ok: true, status: 200, statusText: "OK", text: async () => (url.endsWith("feed.xml") ? valid : "") });
    const element = window.document.createElement("onix-viewer");
    const done = validated(element);
    element.setAttribute("src", "data/feed.xml");
    window.document.body.appendChild(element);
    const detail = await done;
    assert(detail.version === "3.1", "rendered and validated the fetched document");
  });

  test("a document that will not load says so in the viewer's place", async () => {
    const { window } = await page("");
    window.fetch = async () => ({ ok: false, status: 404, statusText: "Not Found" });
    const element = window.document.createElement("onix-viewer");
    element.setAttribute("src", "missing.xml");
    window.document.body.appendChild(element);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const notice = element.shadowRoot.querySelector(".px-error");
    assert(notice && /404/.test(notice.textContent), `a notice naming the status, got: ${notice && notice.textContent}`);
  });
});

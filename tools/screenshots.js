// tools/screenshots.js — the store screenshots, taken by a headless browser.
//
//   npm run screenshots            # Chrome  → Screenshots/Chrome/
//   npm run screenshots:firefox    # Firefox → Screenshots/Firefox/
//   FIREFOX_BIN=/path/to/firefox node tools/screenshots.js firefox
//
// Three 1280×800 captures of the viewer over Onix/onix-3.1-refnames-defects.xml,
// in the light colour scheme: Main.png is the tree as it loads, CodeList.png
// the code-list popup opened from the <NotificationType> row, Violations.png
// the findings list opened from the verdict pill. The browser is launched as
// tests/browser/run.js and tests/browser/firefox.js launch it — the extension
// loaded from Resources/, the sample served as application/xml — so what is
// captured is what a reader sees. Nothing of the browser itself is in frame,
// which is why the Chrome and Firefox sets differ only in text rendering.
//
// The site copies in site/ are held to Screenshots/Chrome/ by a test, so
// after re-taking the Chrome set copy the three files there too.
//
// On macOS 27 the Firefox side needs the terminal it runs from to have Full
// Disk Access, or Firefox exits with "Could not find profile folder." —
// see FIREFOX.md.

const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const RESOURCES = path.join(ROOT, "Resources");
const SAMPLE = path.join(ROOT, "Onix", "onix-3.1-refnames-defects.xml");
const FIREFOX = process.env.FIREFOX_BIN || "/Applications/Firefox.app/Contents/MacOS/firefox";

const WIDTH = 1280;
const HEIGHT = 800;

const BROWSER = process.argv[2] || "chrome";
if (!["chrome", "firefox"].includes(BROWSER)) {
  console.error("usage: node tools/screenshots.js [chrome|firefox]");
  process.exit(2);
}
const OUT = path.join(ROOT, "Screenshots", BROWSER === "chrome" ? "Chrome" : "Firefox");

// ---- the sample, served as application/xml ---------------------------------

function serve() {
  const body = fs.readFileSync(SAMPLE);
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
    response.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      server,
      url: `http://127.0.0.1:${server.address().port}/${path.basename(SAMPLE)}`,
    }));
  });
}

// ---- the browser, in the light scheme --------------------------------------

// Chrome takes the colour scheme as a media emulation on the page. Firefox
// has no such emulation over WebDriver BiDi, so it is a launch preference:
// content-override 1 is "light" whatever the system theme says.
async function launch() {
  let browser;
  if (BROWSER === "chrome") {
    browser = await puppeteer.launch({
      channel: "chrome",
      headless: true,
      enableExtensions: [RESOURCES],
      args: ["--no-sandbox"],
    });
  } else {
    browser = await puppeteer.launch({
      browser: "firefox",
      executablePath: FIREFOX,
      headless: true,
      extraPrefsFirefox: {
        "ui.systemUsesDarkTheme": 0,
        "layout.css.prefers-color-scheme.content-override": 1,
      },
    });
    await browser.installExtension(RESOURCES);
  }
  return browser;
}

async function open(browser, url) {
  const page = await browser.newPage();
  page.on("pageerror", (error) => { throw error; });
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  if (BROWSER === "chrome") {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  }
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector("#oxv-root .px-row", { timeout: 20000 });
  await page.waitForFunction(
    () => !document.getElementById("oxv-validation").textContent.includes("Validating"),
    { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

// ---- the three states --------------------------------------------------------

// The pointer rests on the scrollbar between shots: anywhere over the tree
// would light a row's hover tint and reveal its gutter button.
function parkPointer(page) {
  return page.mouse.move(WIDTH - 5, HEIGHT / 2);
}

async function capture(page, name) {
  await parkPointer(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, type: "png" });
  console.log(`  wrote ${path.relative(ROOT, file)}`);
}

// A real click rather than element.click(): the popups move focus to their
// close button, and a focus that follows a pointer press draws no ring.
async function click(page, handle) {
  await handle.click();
  await parkPointer(page);
}

async function openCodeList(page) {
  const link = await page.evaluateHandle(() => {
    const rows = [...document.querySelectorAll("#oxv-root .px-row")];
    const row = rows.find((r) => r.querySelector(".px-tag-name")?.textContent === "NotificationType");
    return row.querySelector(".px-codelist-link");
  });
  await click(page, link);
  await page.waitForSelector(".px-popup-overlay:not([hidden]) #px-popup-title");
}

async function closeCodeList(page) {
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".px-popup-overlay:not([hidden])"));
}

async function openFindings(page) {
  await click(page, await page.$("#oxv-validation"));
  await page.waitForSelector("#oxv-findings:not([hidden])");
}

// ---- main ---------------------------------------------------------------------

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const served = await serve();
  const browser = await launch();
  try {
    const page = await open(browser, served.url);
    console.log(`${BROWSER}: ${await page.$eval("#oxv-meta", (el) => el.textContent.trim())}, ` +
      `${await page.$eval("#oxv-validation", (el) => el.textContent.trim())}`);
    await capture(page, "Main");
    await openCodeList(page);
    await capture(page, "CodeList");
    await closeCodeList(page);
    await openFindings(page);
    await capture(page, "Violations");
  } finally {
    await browser.close();
    served.server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

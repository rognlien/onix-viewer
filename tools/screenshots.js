// tools/screenshots.js — the store screenshots, taken by a headless browser.
//
//   npm run screenshots:chrome     # Chrome  → Screenshots/Chrome/
//   npm run screenshots:firefox    # Firefox → Screenshots/Firefox/
//   npm run screenshots:safari     # Safari  → Screenshots/Safari/
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
//
// Safari is the odd one out: puppeteer cannot drive it, and safaridriver's
// automation windows are isolated like private browsing, where the extension
// is not on. So the Safari set is taken from the Safari you use — the
// extension enabled and allowed on 127.0.0.1 in the profile of the front
// window — by AppleScript: a tab is opened on the served sample, the window
// sized until the page's viewport is exactly 1280×800, and that rectangle of
// the screen captured with screencapture. The captures are 2560×1600 on a
// Retina display, which the App Store accepts as it does 1280×800. It needs
// two switches, each once: Safari → Settings → Developer → "Allow JavaScript
// from Apple Events", which is how the script reads the page and opens the
// popups, and Screen Recording for the terminal in System Settings →
// Privacy & Security, without which screencapture returns the wallpaper. If
// the system appearance is dark it is set light for the run and put back.
// Keep the pointer off the Safari window while it runs: a row under it
// would show its hover tint.

const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const RESOURCES = path.join(ROOT, "Resources");
const SAMPLE = path.join(ROOT, "Onix", "onix-3.1-refnames-defects.xml");
const FIREFOX = process.env.FIREFOX_BIN || "/Applications/Firefox.app/Contents/MacOS/firefox";

const WIDTH = 1280;
const HEIGHT = 800;

const BROWSER = process.argv[2] || "chrome";
if (!["chrome", "firefox", "safari"].includes(BROWSER)) {
  console.error("usage: node tools/screenshots.js [chrome|firefox|safari]");
  process.exit(2);
}
const OUT = path.join(ROOT, "Screenshots", BROWSER[0].toUpperCase() + BROWSER.slice(1));

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

// ---- Safari, by AppleScript ------------------------------------------------

function osascript(script) {
  return execFileSync("osascript", ["-e", script], { encoding: "utf8" }).trim();
}

function appleScriptString(text) {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Runs JavaScript in the front window's current tab and returns its result
// as text. This is the call "Allow JavaScript from Apple Events" gates.
function safariEval(code) {
  return osascript(`tell application "Safari" to do JavaScript ${appleScriptString(code)} in current tab of front window`);
}

async function safariWait(code, what, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (safariEval(code) === "true") return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Safari: timed out waiting for ${what}`);
}

function safariBounds() {
  return osascript('tell application "Safari" to get bounds of front window').split(", ").map(Number);
}

// Sizes the front window until the page's viewport is WIDTH × HEIGHT, and
// returns that rectangle in screen points. The window's chrome is measured
// rather than assumed: the tab bar comes and goes.
function safariViewport() {
  let [left, top] = [40, 60];
  let [width, height] = [WIDTH, HEIGHT + 100];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    osascript(`tell application "Safari" to set bounds of front window to {${left}, ${top}, ${left + width}, ${top + height}}`);
    const [inner, outer] = [
      safariEval("window.innerWidth + ',' + window.innerHeight").split(",").map(Number),
      safariBounds(),
    ];
    [left, top] = outer;
    width = outer[2] - outer[0];
    height = outer[3] - outer[1];
    if (inner[0] === WIDTH && inner[1] === HEIGHT) {
      return { x: left, y: outer[3] - HEIGHT, width: WIDTH, height: HEIGHT };
    }
    width += WIDTH - inner[0];
    height += HEIGHT - inner[1];
  }
  throw new Error("Safari: could not size the window to a 1280×800 viewport");
}

function systemDarkMode(value) {
  const script = value === undefined
    ? 'tell application "System Events" to tell appearance preferences to get dark mode'
    : `tell application "System Events" to tell appearance preferences to set dark mode to ${value}`;
  return osascript(script) === "true";
}

async function safariOpen(url) {
  osascript(`tell application "Safari"
    activate
    if (count of windows) is 0 then make new document
    tell front window to set current tab to (make new tab with properties {URL:${appleScriptString(url)}})
  end tell`);
  await safariWait("document.readyState === 'complete' && !!document.querySelector('#oxv-root .px-row')",
    "the viewer to take the page over — is the extension on, and allowed on 127.0.0.1, in this profile?");
  await safariWait("!document.getElementById('oxv-validation').textContent.includes('Validating')", "validation");
  await safariWait("document.fonts.status === 'loaded'", "fonts");
}

function safariCapture(rect, name) {
  const file = path.join(OUT, `${name}.png`);
  execFileSync("screencapture", ["-x", "-R", `${rect.x},${rect.y},${rect.width},${rect.height}`, file]);
  console.log(`  wrote ${path.relative(ROOT, file)}`);
}

async function safariShots(url) {
  const wasDark = systemDarkMode();
  if (wasDark) systemDarkMode(false);
  try {
    await safariOpen(url);
    const rect = safariViewport();
    console.log(`safari: ${safariEval("document.getElementById('oxv-meta').textContent.trim()")}, ` +
      `${safariEval("document.getElementById('oxv-validation').textContent.trim()")}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    safariCapture(rect, "Main");
    safariEval(`[...document.querySelectorAll('#oxv-root .px-row')]
      .find((r) => r.querySelector('.px-tag-name')?.textContent === 'NotificationType')
      .querySelector('.px-codelist-link').click()`);
    await safariWait("!!document.querySelector('.px-popup-overlay:not([hidden]) #px-popup-title')", "the code-list popup");
    safariCapture(rect, "CodeList");
    safariEval("OnixViewerPopup.close()");
    await safariWait("!document.querySelector('.px-popup-overlay:not([hidden])')", "the popup to close");
    safariEval("document.getElementById('oxv-validation').click()");
    await safariWait("!document.getElementById('oxv-findings').hidden", "the findings list");
    safariCapture(rect, "Violations");
  } finally {
    osascript('tell application "Safari" to close current tab of front window');
    if (wasDark) systemDarkMode(true);
  }
}

// ---- main ---------------------------------------------------------------------

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const served = await serve();
  if (BROWSER === "safari") {
    try {
      await safariShots(served.url);
    } finally {
      served.server.close();
    }
    return;
  }
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

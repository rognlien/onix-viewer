// tools/screenshots.js — the store screenshots, taken by a headless browser.
//
//   npm run screenshots:chrome     # Chrome  → chrome/screenshots/
//   npm run screenshots:firefox    # Firefox → firefox/screenshots/
//   npm run screenshots:safari     # Safari  → safari/screenshots/
//   FIREFOX_BIN=/path/to/firefox node tools/screenshots.js firefox
//
// Three 1280×800 captures of the viewer over Onix/onix-3.1-whimsical.xml,
// in the light colour scheme: Main.png is the tree as it loads, CodeList.png
// the code-list popup opened from the <NotificationType> row, Violations.png
// the findings list opened from the verdict pill. The browser is launched as
// tests/browser/run.js and tests/browser/firefox.js launch it — the extension
// loaded from Resources/, the sample served as application/xml — so what is
// captured is what a reader sees. Nothing of the browser itself is in frame,
// which is why the Chrome and Firefox sets differ only in text rendering.
//
// After a run the set's fingerprint is written beside it, which the store
// build checks — see tools/screenshot-stamp.js.
//
// The site copies in site/ are held to chrome/screenshots/ by a test, so
// after the Chrome set tools/site-sync.js copies the three there and
// re-versions the page's references to them.
//
// On macOS 27 the Firefox side needs the terminal it runs from to have Full
// Disk Access, or Firefox exits with "Could not find profile folder." —
// see firefox/README.md.
//
// Safari is the odd one out: puppeteer cannot drive it, and safaridriver's
// automation windows are isolated like private browsing, where the extension
// is not on. So the Safari set is taken from the Safari you use — the
// extension enabled and allowed on 127.0.0.1 in the profile of the front
// window — by AppleScript: a tab is opened on the served sample, the window
// sized until the page's viewport is exactly 1280×800, the window captured
// by its id with screencapture, and the viewport cropped out of the bottom
// of that image. A window capture rather than a screen rectangle because
// the window may hang off the bottom of a 900-row display — 800 rows of
// page plus Safari's own chrome — and screencapture refuses a rectangle
// that leaves the screen, while a window is captured wherever it sits. The
// captures are 2560×1600 on a Retina display, which the App Store accepts
// as it does 1280×800. It needs
// two switches, each once: Safari → Settings → Developer → "Allow JavaScript
// from Apple Events", which is how the script reads the page and opens the
// popups, and Screen Recording for the terminal in System Settings →
// Privacy & Security, without which screencapture returns the wallpaper. If
// the system appearance is dark it is set light for the run and put back.
// Keep the pointer off the Safari window while it runs: a row under it
// would show its hover tint.

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const RESOURCES = path.join(ROOT, "Resources");
const SAMPLE = path.join(ROOT, "Onix", "onix-3.1-whimsical.xml");
const FIREFOX = process.env.FIREFOX_BIN || "/Applications/Firefox.app/Contents/MacOS/firefox";

const WIDTH = 1280;
const HEIGHT = 800;

const BROWSER = process.argv[2] || "chrome";
if (!["chrome", "firefox", "safari"].includes(BROWSER)) {
  console.error("usage: node tools/screenshots.js [chrome|firefox|safari]");
  process.exit(2);
}
const OUT = path.join(ROOT, BROWSER, "screenshots");

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
// returns the window's id and size in points. The window's chrome is
// measured rather than assumed: the tab bar comes and goes.
function safariViewport() {
  let [left, top] = [40, 40];
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
      const id = Number(osascript('tell application "Safari" to get id of front window'));
      return { id, width, height };
    }
    width += WIDTH - inner[0];
    height += HEIGHT - inner[1];
  }
  throw new Error("Safari: could not size the window to a 1280×800 viewport");
}

function pngSize(file) {
  const header = Buffer.alloc(24);
  const fd = fs.openSync(file, "r");
  fs.readSync(fd, header, 0, 24, 0);
  fs.closeSync(fd);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
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

// The crop, through the system's own image API from a JavaScript-for-
// Automation snippet. sips was tried: it ignores a --cropOffset whose x is
// 0, which is exactly this crop, and exits 0 having written the whole
// window. Arguments: input, output, x, y, width, height, in pixels.
const CROP_JXA = `
ObjC.import("AppKit");
function run(argv) {
  const [input, output, x, y, width, height] = argv;
  const image = $.NSImage.alloc.initWithContentsOfFile(input);
  const source = image.CGImageForProposedRectContextHints($(), $(), $());
  const rect = $.CGRectMake(Number(x), Number(y), Number(width), Number(height));
  const cropped = $.CGImageCreateWithImageInRect(source, rect);
  const rep = $.NSBitmapImageRep.alloc.initWithCGImage(cropped);
  const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary);
  return png.writeToFileAtomically(output, true) ? "ok" : "failed";
}`;

function cropPng(input, output, x, y, width, height) {
  const result = execFileSync("osascript", ["-l", "JavaScript", "-e", CROP_JXA, input, output,
    String(x), String(y), String(width), String(height)], { encoding: "utf8" }).trim();
  if (result !== "ok") throw new Error(`could not crop ${input}: ${result}`);
}

// The window without its shadow, then the viewport: the bottom HEIGHT points
// of it, at whatever scale the display captured (the image's width over the
// window's width in points; 2 on a Retina display).
function safariCapture(win, name) {
  const file = path.join(OUT, `${name}.png`);
  // Not a dot-file: screencapture refuses a name that starts with one, says
  // so on stderr, and exits 0 regardless.
  const whole = path.join(os.tmpdir(), `onix-viewer-${name}-window.png`);
  try {
    execFileSync("screencapture", ["-x", "-o", "-l", String(win.id), whole], { stdio: "pipe" });
  } catch (error) {
    // "could not create image from window" is what macOS 15 and later say
    // when the process has no Screen Recording permission: the window
    // server returns nothing at all, not a picture without other apps'
    // windows. The permission is read at launch, so the terminal has to be
    // reopened after granting it.
    throw new Error("screencapture could not read the Safari window. Grant Screen Recording to the app " +
      "you run npm from (System Settings → Privacy & Security → Screen & System Audio Recording), " +
      `quit and reopen it, and run again. (${String(error.stderr || error.message).trim()})`);
  }
  if (!fs.existsSync(whole)) throw new Error(`screencapture exited 0 but wrote nothing to ${whole}`);
  const scale = pngSize(whole).width / win.width;
  cropPng(whole, file, 0, Math.round((win.height - HEIGHT) * scale), Math.round(WIDTH * scale), Math.round(HEIGHT * scale));
  fs.unlinkSync(whole);
  console.log(`  wrote ${path.relative(ROOT, file)} (${scale}x)`);
}

// Chrome and Firefox load Resources/ from this checkout; Safari runs
// whichever ONIX Viewer is installed, and the App Store's copy once took the
// whole set of a release behind. The version the page was given must be the
// checkout's -dev one, which only a build from here carries.
function requireThisCheckout() {
  const expected = JSON.parse(fs.readFileSync(path.join(RESOURCES, "manifest.json"), "utf8")).version_name;
  const running = safariEval("document.documentElement.dataset.oxvVersion || ''");
  if (running !== expected) {
    throw new Error(`Safari is running ONIX Viewer ${running || "(unknown)"}, not this checkout's ${expected}. ` +
      "Build the dev app (npm run build:dev, then Run dist/dev/safari/ONIX Viewer Dev in Xcode), " +
      "turn the App Store copy off in Safari → Settings → Extensions, and run this again.");
  }
}

async function safariShots(url) {
  const wasDark = systemDarkMode();
  if (wasDark) systemDarkMode(false);
  try {
    await safariOpen(url);
    requireThisCheckout();
    const win = safariViewport();
    console.log(`safari: ${safariEval("document.getElementById('oxv-meta').textContent.trim()")}, ` +
      `${safariEval("document.getElementById('oxv-validation').textContent.trim()")}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    safariCapture(win, "Main");
    safariEval(`[...document.querySelectorAll('#oxv-root .px-row')]
      .find((r) => r.querySelector('.px-tag-name')?.textContent === 'NotificationType')
      .querySelector('.px-codelist-link').click()`);
    await safariWait("!!document.querySelector('.px-popup-overlay:not([hidden]) #px-popup-title')", "the code-list popup");
    safariCapture(win, "CodeList");
    safariEval("OnixViewerPopup.close()");
    await safariWait("!document.querySelector('.px-popup-overlay:not([hidden])')", "the popup to close");
    safariEval("document.getElementById('oxv-validation').click()");
    await safariWait("!document.getElementById('oxv-findings').hidden", "the findings list");
    safariCapture(win, "Violations");
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
      require("./screenshot-stamp.js").stamp(BROWSER);
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
    require("./screenshot-stamp.js").stamp(BROWSER);
    if (BROWSER === "chrome") {
      for (const change of require("./site-sync.js").sync()) console.log(`  ${change}`);
    }
  } finally {
    await browser.close();
    served.server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

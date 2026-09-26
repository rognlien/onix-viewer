# Porting ONIX Viewer to Firefox

What was found looking into a Firefox build, what has been changed, and what
still has to be settled by running the extension in Firefox itself. Read this
before the `firefox-port` branch goes any further.

## The short version

The code needs no porting. `content.js` already reaches the extension API
through `browser` when it exists and `chrome` otherwise, wraps every storage
call in a promise, and uses nothing WebKit-only: the CSS and JavaScript
features in the bundle (`content-visibility`, `color-mix()`, `:has()`,
`document.evaluate`, `MessageChannel`, `navigator.clipboard`) are all in
Firefox 128 or earlier. Firefox exempts web-accessible extension resources
from the page's CSP, so the `img-src` fallback in `viewer.js` simply never
fires there.

What Firefox needs is a **manifest** it will accept, a **packager** that
emits a Firefox zip, and one **behavioural question** answered in a real
Firefox: what its XML pretty-printer does to a page whose root element was
swapped while the parser was still running. The first two are done on this
branch. The third is what `tests/browser/firefox.js` exists to find out, and
it could not be run here — see *What could not be verified*.

## Facts established

Each of these comes from Mozilla's own documentation, the compatibility data
behind it, or Gecko's source, not from memory.

| Fact | Source |
|---|---|
| Firefox has supported `browser_specific_settings.gecko.id` as **mandatory for Manifest V3** — `web-ext lint` reports `ADDON_ID_REQUIRED` as an error on the unmodified manifest, so Firefox will not even load it temporarily. | `web-ext lint` on `Resources/` |
| `data_collection_permissions` is **mandatory for new AMO submissions since 3 November 2025**. `{ "required": ["none"] }` is the correct value for an extension that collects nothing. Firefox 140 introduced the key. | MDN `browser_specific_settings`; `web-ext lint` |
| Content-script host access is **granted at install from Firefox 127**. Before that, MV3 host permissions — `content_scripts.matches` included — were optional and the user had to grant each site from the toolbar popover, which would have left the extension inert until clicked. | extensionworkshop.com MV3 migration guide |
| `match_origin_as_fallback` (the blob: URL support) is in **Firefox 128**. `world` arrived at the same time. | MDN compat data, `content_scripts.json` |
| `version_name` is **not supported** in Firefox; `minimum_chrome_version` is a Chrome key. Firefox loads a manifest with unknown keys and warns. | MDN compat data, `version_name.json` |
| `runtime.getManifest()` returns a normalised object "created from browser-internal data structures", which "can differ from a representation produced by running `JSON.parse()` on the file". Whether the unsupported `version_name` survives that normalisation is not documented — it is what decides whether About says `-dev` on a temporary load. | MDN `runtime.getManifest` |
| Firefox MV3 content scripts are **subject to the same CORS policy as the page** (since Firefox 101), so the same-origin re-fetch of the page's own URL behaves as in Chrome. Relative URLs are not resolved against the page in Firefox; `content.js` uses the absolute `document.location.href`. | MDN Chrome incompatibilities |
| Web-accessible resources are served at `moz-extension://<per-install UUID>/…`. `use_dynamic_url` is unsupported; `resources` and `matches` are. Nothing in the bundle depends on a fixed extension ID. | MDN `web_accessible_resources` |
| `<all_urls>` includes `file://` in Firefox and there is no separate "allow access to file URLs" toggle, so local files should work out of the box — via the DOM fallback, since a `file:` fetch fails there as in Chrome. | MDN match patterns |
| Chrome 148 added the `browser` namespace. `typeof browser !== "undefined"` therefore no longer means "this is Firefox"; test `runtime.getURL("").startsWith("moz-extension:")` if a Firefox-only path is ever needed. | MDN Chrome incompatibilities |

## What the branch changes

### The manifest carries both browsers' keys

`Resources/manifest.json` gains:

```json
"browser_specific_settings": {
  "gecko": {
    "id": "onix-viewer@maendeleo.io",
    "strict_min_version": "140.0",
    "data_collection_permissions": { "required": ["none"] }
  }
}
```

and keeps `minimum_chrome_version` and `version_name`. One directory then
loads unpacked in either browser — `chrome://extensions` → *Load unpacked*
→ `Resources/`, or `about:debugging#/runtime/this-firefox` → *Load Temporary
Add-on…* → `Resources/manifest.json` — which is the property the whole
layout is built around (see *Two icon directories, and why* in `CLAUDE.md`).
Each browser prints a warning about the other's keys on its extensions page;
the store builds carry neither, below.

Two choices in there:

- **`strict_min_version` is 140, not 128.** The extension needs nothing
  past 128 (`match_origin_as_fallback`; `content-visibility` is 125). But
  `data_collection_permissions` is a 140 key, and `web-ext lint` warns when
  the minimum predates a key the manifest uses. 140 is the ESR of the day
  and silences the warning at no cost.
- **The id is an email-form string** on the site's domain, which is what
  MDN recommends over a GUID. It is what AMO will bind the listing to on
  first upload and must never change afterwards.

### The packager takes a target

```bash
tools/package-extension.sh                  # dist/onix-viewer-<v>.zip          Chrome Web Store
tools/package-extension.sh --target=firefox # dist/onix-viewer-<v>-firefox.zip  addons.mozilla.org
```

Both drop `version_name`. The Chrome build also drops
`browser_specific_settings`; the Firefox build drops `minimum_chrome_version`.
The post-zip check refuses a zip in which the dropped keys survived, as it
already did for `version_name`. The Firefox-patched manifest passes
`web-ext lint` with no errors.

### A Firefox browser test, written but not yet run

`tests/browser/firefox.js` is `tests/browser/run.js` for Firefox: the same
served fixtures, the same puppeteer-core, the installed Firefox instead of
the installed Chrome, and `browser.installExtension()` (WebDriver BiDi) in
place of Chrome's `enableExtensions`. It runs the takeover checks in both
dialects and on a large synthetic feed, the About window, the rules round
trip through `browser.storage`, the XPath forms jsdom cannot run, and
`file://`. Run it with:

```bash
npm run test:firefox                     # /Applications/Firefox.app on macOS
FIREFOX_BIN=/path/to/firefox npm run test:firefox
```

It prints what it sees rather than only pass/fail for the questions below,
because the answers decide the next change.

## What could not be verified, and the question it hangs on

The test could not be run from this session: the tool sandbox forbids
Firefox from spawning its content processes (`plugin-container.app:
Operation not permitted`), so puppeteer never sees the WebDriver endpoint.
Everything below is from reading Gecko's source and needs one real run.

### The XML pretty-printer and a swapped root

Firefox's native XML view is `nsXMLPrettyPrinter`. It runs from the XML
content sink's `DidBuildModel`, i.e. **when the parser finishes**, and it
works like this (`dom/xml/nsXMLPrettyPrinter.cpp`,
`dom/xml/nsXMLContentSink.cpp`):

1. `CanStillPrettyPrint()` is `mPrettyPrintXML && (!mPrettyPrintHasFactoredElements || mPrettyPrintHasSpecialRoot)`.
   The "factored elements" flag is set by the **sink** when the **parser**
   creates an element in a namespace Gecko renders (XHTML, SVG, MathML).
   Elements our script creates through the DOM do not count.
2. It re-enables the document's CSS loader ("Reenable the CSSLoader so that
   the prettyprinting stylesheets can load") — which implies the loader is
   **disabled while an XML document parses**. A `<link rel="stylesheet">`
   we insert mid-parse may therefore not load until the parse ends.
3. `PrettyPrint()` takes `GetRootElement()` — whatever the root is **at that
   moment** — and, unless `CanAttachShadowDOM()` is true for it (a guard
   with a diagnostic crash behind it, for Nightly and early Beta), attaches a
   **UA shadow root** to it holding an XSLT rendering of the document as
   source. A UA shadow root attaches to any element; `CanAttachShadowDOM()`
   is the author-side rule and is false for `<html>`.
4. Any later mutation outside the shadow tree — a child appended, an
   attribute changed, a node removed — schedules `Unhook()`, which detaches
   the shadow root again.

Put against `content.js`, which swaps the root as soon as the re-fetch
resolves and the root exists:

- **Swap after the parse ends** (small file, parser done before the fetch
  resolves): the printer has already attached its view to the *original*
  root. `replaceChild` removes that element, `ContentWillBeRemoved` schedules
  the unhook, and our shell is untouched. This is the Chrome `file://` path
  today and should just work.
- **Swap during the parse** (any file large enough to arrive in more than
  one chunk): the parser carries on into the detached original root, and at
  `DidBuildModel` the printer finds **our `<html>`** and overlays it with a
  pretty-printed dump of the viewer's own DOM, hiding the toolbar and the
  tree until the next light-DOM mutation. While the viewer is still
  rendering or validating that is milliseconds; on a page that has gone
  idle it is until the reader clicks something. And the XSLT over a viewer
  DOM of half a million rows is itself seconds of main-thread work. The
  stylesheet may also arrive late (point 2).

The test's large-feed case is built to show this: it checks that the toolbar
has a laid-out height after the verdict is in, and prints the readyState the
page reports.

### If the mid-parse case misbehaves: the fix is in `content.js`, Firefox only

Two candidate strategies, both cheap, both gated on
`runtime.getURL("").startsWith("moz-extension:")` so Chrome keeps its
proven path:

- **Detach first, install later.** When the fetch resolves while
  `document.readyState === "loading"`, remove the original root at once
  (`document.documentElement.remove()`) and install the shell on
  `DOMContentLoaded`. With no root at `DidBuildModel`, `PrettyPrint()`
  returns at its `NS_ENSURE_TRUE(rootElement, …)` — a warning, no shadow
  root, no transform, no crash — and the page is blank rather than native
  for the remainder of the parse, which on a large feed is a fraction of
  the render time that follows anyway. Preferred, if it works: no
  pretty-print cost at all.
- **Wait for the parse.** Install the shell only once `readyState` leaves
  `"loading"`. Always safe, but the reader sees the native view flash and
  pays Firefox's XSLT over the whole source first — seconds on a 17 MB
  feed, on exactly the files where it matters.

Neither should be written until the run shows which case the swap lands in
and what it looks like.

### Smaller things the run will settle

- Whether About reads `-dev` on a temporary load (`getManifest()` and
  `version_name`, above). If Firefox drops the key, `extensionVersion()` can
  fall back to `runtime.id` — a temporary add-on gets the declared gecko id,
  so that is not a signal either; `browser.management` would need a
  permission. Living with the bare version on Firefox is acceptable.
- That the toolbar mark loads from `moz-extension://` and the stylesheet
  applies (`getComputedStyle(body).backgroundColor` in the test output).
- That the storage round trip acknowledges with "Kept" — `browser.storage.local`
  returns promises and `keepRules()` wraps the call, so it should.
- That Gecko's XPath agrees with Chrome's on `name()`, `local-name()`, the
  prefixed-name refusal and the syntax-error path. Gecko's engine is the
  older, more complete XPath 1.0 implementation; the one likely difference is
  the text of a compile error, which the Schematron engine only tests for
  presence.

## What comes after a green run

1. Apply whichever `content.js` change the run calls for, with a jsdom test
   for the non-Firefox branch staying put.
2. Promote `tests/browser/firefox.js` to a CI job beside the Chrome one in
   `.github/workflows/test.yml`; GitHub's Ubuntu runners ship Firefox, and
   `FIREFOX_BIN` is there for it.
3. `release.yml`: build both zips and attach both to the release.
4. Listing: AMO is a separate developer account and a separate review. The
   manifest `description` says "in Chrome"; a Firefox listing needs wording
   of its own, and the description itself should probably lose the browser
   name. AMO signs every build, including self-distributed ones, so a
   Firefox install outside the store is `web-ext sign`, not a zip.
5. `SECURITY.md` and `README.md` then say Firefox alongside Chrome. Until
   then they describe what ships.

## What is deliberately not done

- **No `world: "MAIN"`.** Firefox 128 and Chrome 111 both have it, and it
  would let `viewer.js` run as a content script instead of an injected
  `<script>`. But the injection is what keeps the viewer's scripts subject to
  the page's CSP in the same way in both browsers, and the whole
  reviewability story (`SECURITY.md`, `tests/cases/29-reviewability.test.js`)
  is written around it. Not a porting question.
- **No polyfill.** `webextension-polyfill` is for code that wants
  `browser.*` promises in old Chrome; `content.js` already copes with both
  shapes in six lines.
- **No separate Firefox manifest file.** A second `manifest.firefox.json`
  would mean a build step before a temporary load, which the layout avoids
  on purpose. The two-key manifest plus a packager that prunes per target is
  the version of that with no build step.

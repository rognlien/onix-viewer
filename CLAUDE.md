# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# onix-viewer — notes for Claude Code

Read this before making changes. It captures the design decisions that are not obvious from the code alone, and the dev workflow.

## What this is

A Chrome extension (Manifest V3) that takes over raw ONIX XML pages — a richer version of Chrome's built-in XML viewer — with first-class ONIX features: codelist resolution, `<Product>` summaries, dialect detection (reference vs. short-tag), ONIX 2.1 vs. 3.0 vs. 3.1 detection.

The extension is single-purpose: it activates only on documents that look like ONIX. Non-ONIX XML (RSS, generic XML, SOAP, …) is left alone — the browser's native viewer handles it. There's no general-purpose XML viewing mode by design.

The content script activates only on a tight MIME-type whitelist: `application/xml`, `text/xml`, and `application/onix+xml`. ONIX has no IANA-registered MIME type — EDItEUR's best-practice guide tells producers to serve ONIX as `application/xml` — but the `+xml` suffix in `application/onix+xml` is spec-conformant under RFC 3023/7303, so we accept it as future-proofing for any server that adopts it. After the MIME-type gate, the source is sniffed for an EDItEUR namespace (`ns.editeur.org/onix`) or an `<ONIXMessage>` root before the takeover commits. XHTML and SVG appear to be XML but are explicitly skipped (browsers render them natively).

## Layout

```
onix-viewer/
├── CLAUDE.md                       this file
├── README.md                       user-facing install/usage docs
├── SECURITY.md                     threat model & verification guide
├── CHANGELOG.md                    version history
├── CWS_LISTING.md                  paste-ready CWS dashboard copy
├── package.json                    jsdom dev dep + `npm test`
├── Resources/                      the actual web extension (load in chrome://extensions)
│   ├── manifest.json               MV3, ZERO permissions, ZERO host_permissions
│   ├── content.js                  detects raw XML, takes the page over
│   ├── viewer.js                   parses + renders the tree, search, kbd nav
│   ├── viewer.css                  theme tokens (light + dark via prefers-color-scheme)
│   ├── onix.js                     ONIX detector, codelist resolver, summaries
│   ├── onix-codelists.js           ALL EDItEUR ONIX 3.1 code lists (auto-generated, ~190 KB)
│   ├── onix-blocks.js              right-pane "blocks" view — currently DISABLED in UI
│   ├── onix-popup.js               modal popup listing all entries of a code list
│   └── icons/                      icon-{16,32,48,96,128,256,512}.png from icons/image.png
├── icons/                          source-of-truth for the extension icon
│   ├── image.png                   tight 546×546 crop of the artwork (the render source)
│   └── image-original.png          archived 1024×1024 export from the artist
├── tools/
│   ├── package-extension.sh        builds dist/onix-viewer-<version>.zip for CWS upload
│   ├── render-icons.sh             renders icons/image.png into Resources/icons/icon-*.png
│   ├── generate-codelists.js       generates Resources/onix-codelists.js
│   ├── release.sh                  bumps version, commits, tags
│   └── data/
│       ├── onix-codelists.json     EDItEUR Issue 73 codelists (input)
│       └── ONIX_BookProduct_3.1_reference.xsd  (input, element→list bindings only)
├── tests/
│   ├── run.js                      jsdom harness (56 tests, ~1s)
│   └── fixtures/                   XML samples per test category
├── dist/                           build output (gitignored except listing/)
│   └── listing/                    CWS upload assets (icon, promo tile, marquee, screenshots)
└── .github/workflows/release.yml   tag-push → tests → zip → GitHub release
```

## Architecture: why we replace the document

The browser's native XML viewer renders raw `application/xml` pages with an internal DOM that's largely opaque to extension content scripts. Trying to restyle it doesn't reliably work — selectors don't match, CSS injection lands on a Shadow-DOM-like structure, and there's no documented way in.

The pattern is:

1. Content script runs at `document_start`.
2. Check `document.contentType` against the MIME whitelist (`application/xml`, `text/xml`, `application/onix+xml`).
3. Re-fetch the source URL with `fetch(document.location.href, { credentials: "same-origin" })`. Reading `document.body.innerText` from the rendered viewer is unreliable.
3a. **ONIX sniff** the first 2 KB of the source for the EDItEUR namespace URI or an `<ONIXMessage>` root. If it's XML but not ONIX, abort — the user gets the browser's native XML view.
4. Build a fresh HTML shell via `DOMParser`, then `document.replaceChild(newRoot, document.documentElement)` to swap roots.
5. Stash the source in an inert `<script type="application/xml" id="__oxv-source__">` data block (NOT an inline JS script — file:// pages and many sites have a `script-src` CSP that blocks inline execution; a non-JS script type is just a queryable text holder, which CSP leaves alone), then append `onix-codelists.js`, `onix.js`, `onix-blocks.js`, `onix-popup.js`, and `viewer.js` as `<script>` elements with `async = false` to preserve order.
6. Those scripts parse the original XML with `DOMParser` and render to plain DOM.

When the re-fetch fails (file:// URLs are origin "null" and CORS-blocked; one-shot signed URLs reject the second request; bearer-auth endpoints lose their headers), we fall back to `XMLSerializer().serializeToString(document)` — the browser has already parsed the XML for us, so reading the live document is a reliable second path. This means file:// works without any background script, at the cost of waiting for `DOMContentLoaded` before takeover instead of acting at `document_start`.

**blob: URLs** are supported via `manifest.json`'s `content_scripts.match_origin_as_fallback: true` (Chrome 119+). Chrome resolves a blob URL's origin to the page that created it and matches that against `<all_urls>`.

Things that still won't work:
- **Streaming huge XML**: we hold the full source in memory. Anything > ~10 MB causes a noticeable parse hang.

**Do not switch to `document.open()` + `document.write()`.** Per the HTML spec, `document.open()` throws `InvalidStateError` on a non-HTML document, and a raw XML page in WebKit is exactly that. Chromium has been lenient historically and let it through, which makes it a tempting "simpler" alternative — but it's a footgun if the extension is ever ported back to Safari/Firefox, and the current DOM-replacement path costs nothing extra.

**Scripts and DOMParser.** When DOMParser parses HTML, any `<script>` it produces has the spec's "already started" flag set — those scripts will *not* execute when inserted into a live document. That's why we don't embed the script tags in the parsed shell; we create them dynamically afterward.

**XHTML namespace gotcha.** Even after we replace `documentElement`, `document.contentType` remains `application/xml`. In an XML document, plain `document.createElement(tagName)` creates an element in the *null* namespace — not an HTMLElement, so it has no `.style`, no `.dataset`, etc. content.js uses `createElementNS(XHTML, "script")` for the script tags it injects, and `viewer.js` monkey-patches `document.createElement` at the top of its IIFE so every subsequent call (here and in `onix-blocks.js`) produces real HTMLElements with no per-callsite ceremony. The HTML elements that come back from `DOMParser` are already in the XHTML namespace, which is why the toolbar etc. render correctly without special handling.

## ONIX detection logic

Lives in `Resources/onix.js`. The detector returns `{ isOnix, dialect, version }` for the parsed `Document`.

Signals checked, in order:
1. **Namespace URI** on the root element (`http://ns.editeur.org/onix/3.0/reference`, `.../3.1/reference`, `.../short`, etc.). Canonical ONIX 3.x signal.
2. **Root local name** (`ONIXMessage` / `ONIXmessage`) when no namespace is set — typical of ONIX 2.1 docs.
3. The **`release` attribute** on the root if version isn't already known.

Reference vs. short tag matters because:
- Reference dialect uses `<ProductIdentifier>`, `<ProductIDType>`, etc.
- Short dialect uses `<productidentifier>`, `<b221>`, etc.
- The codelist resolver handles both via a `SHORT_TO_REFERENCE` map in `onix.js`. The map is the most common short tags; extending it is mechanical (mirror the EDItEUR aliases table).

## Product summary

`productSummary(productEl, ctx)` in `onix.js` builds the one-line chip shown on collapsed `<Product>` rows. Format:

```
[IDLabel] [IDValue] · [ProductForm label] · "[Distinctive title]"
```

Rules:

- **Identifier preference**: `15` (ISBN-13) → `03` (GTIN-13) → `02` (ISBN-10) → omit. Labels follow the picked type: `ISBN` for 15/02, `GTIN` for 03. Anything else (proprietary `01`, DOI `06`, …) is **not** used — the segment is dropped rather than mislabelling a proprietary ID as "ISBN".
- **Form**: read as a direct child of `<DescriptiveDetail>`, resolved through the bundled `ProductForm` list (e.g. `BB → Hardback`).
- **Title**: prefers the `<TitleDetail>` with `<TitleType>01</TitleType>` (Distinctive title), falling back to the first `<TitleDetail>`. Truncated to 57 chars + ellipsis.

Lookups intentionally restrict to direct children of the right composite. A free DFS would happily pick the title or ISBN of a `<RelatedProduct>` inside `<RelatedMaterial>`, which is exactly the bug the older implementation had.

## Codelists — generated from EDItEUR's published JSON

`Resources/onix-codelists.js` is **auto-generated** by `tools/generate-codelists.js` from two committed inputs:

- `tools/data/onix-codelists.json` — EDItEUR's published codelists JSON (currently **Issue 73**, 2026-01-20). Authoritative source of (list number, code, label).
- `tools/data/ONIX_BookProduct_3.1_reference.xsd` — the official ONIX 3.1 reference schema, used **only** for element-name → list-number bindings (those rarely change between minor issues).

Both inputs are committed so the generator has no external dependencies. Output contains all 165 lists (~4,770 code/label pairs) and 158 element bindings — about 190 KB unminified, ~50 KB gzipped. Multiple element names that share a list reference the same `Map` instance.

```bash
node tools/generate-codelists.js                          # default paths
node tools/generate-codelists.js --json=PATH --xsd=PATH   # override
```

The generator also writes `window.OnixViewerCodeListSchema = { version, issue, releaseDate }` to the output. `viewer.js` reads this constant and shows "EDItEUR ONIX 3.1, Issue 73" as a toolbar pill so users can see at a glance which schema version they're looking at.

**To bump issues**: replace `tools/data/onix-codelists.json` with EDItEUR's next release from `https://www.editeur.org/files/ONIX%20for%20books%20-%20code%20lists/`, re-run the generator, and the new issue number propagates everywhere (toolbar, comments, metadata).

## Currently disabled features

Two features are bundled and tested but hidden from the UI while the simpler tree-only experience is polished:

- **Structure / Split view** — a right pane that renders ONIX Products as cards with sections per P.x block (DescriptiveDetail, CollateralDetail, …), with bidirectional collapse-sync to the tree pane and click-to-highlight. Lives in `Resources/onix-blocks.js`. To re-enable: uncomment the `.px-view-group` block in `content.js` and delete the early-return at the top of `setupViewMode()` in `viewer.js`.

## Identifier conventions

After the rename from "PrettyXML" to "ONIX Viewer":
- `window.OnixViewerOnix` — the ONIX module API (detect, tagClass, resolveCodelist, resolveAttributeCodelist, productSummary, codelistMeta, externalLinkIcon)
- `window.OnixViewerCodeLists` — codelist data keyed by element name (each value is a `Map<code, label>`)
- `window.OnixViewerCodeListsByNumber` — same data keyed by list number (for attribute lookups where there's no parent element)
- `window.OnixViewerCodeListMeta` — element-name → `{ listNumber, title }` for EDItEUR list links
- `window.OnixViewerCodeListSchema` — `{ version, issue, releaseDate }` for the toolbar pill
- `window.OnixViewerBlocks` — right-pane renderer (currently loaded but its render call is gated off)
- `window.OnixViewerPopup` — code-list modal (`show(codelistKey, currentValue?)`, `close()`)
- `[OnixViewer]` — console log prefix (gated behind a `DEBUG = false` flag in `content.js`)
- `oxv-*` — DOM IDs (`oxv-toolbar`, `oxv-root`, `oxv-search`, `oxv-schema`, `oxv-meta`)
- `data-oxv` — data attribute on the replaced `<html>`
- `px-*` — CSS class prefix (kept short; ubiquitous in viewer.js)

The `px-` CSS prefix was retained from the rename because changing it would touch every line of `viewer.js` that builds DOM.

## Security posture

`SECURITY.md` is the canonical doc. Highlights:

- `permissions: []` and `host_permissions: []` — both empty as of 0.9.8. The extension cannot make cross-origin fetches; any rogue `fetch()` to a third-party origin would be CORS-blocked by the browser.
- Only one network call in the whole bundle: a same-origin re-fetch of the page's own URL (`fetch(document.location.href, { credentials: "same-origin" })`).
- No background service worker, no `chrome.storage`, no `chrome.tabs`, no `webRequest`.
- `script-src 'self'` (the MV3 default CSP) is enforced. No `eval`, no `new Function`, no remote `<script src>`.

A focused security audit on the 0.9.7 artefact found no HIGH or MEDIUM findings; the four LOW recommendations were applied in 0.9.8.

## Dev workflow

### Test loop (fast — use this most of the time)

```bash
npm install     # one-time, installs jsdom
npm test        # runs the 56-test jsdom suite (~1s)
```

The harness lives in `tests/run.js`. It loads viewer scripts in jsdom against fixtures in `tests/fixtures/`, then asserts on the rendered DOM. Add a fixture + a `test()` call when introducing new behavior — much faster than reloading the extension in the browser.

The `test()` function is hand-rolled — there is no filter flag or `--grep`. To run a single test, comment out the other `test()` calls in `tests/run.js` (or temporarily `return` early from the surrounding `describe()` blocks) and revert before committing.

### Browser loop

1. `chrome://extensions` → enable **Developer mode** (top right).
2. **Load unpacked** → pick `Resources/`.
3. Edit files → click the **reload** circular arrow on the extension card → refresh the page.

For local-file testing: extension card → **Details** → enable **Allow access to file URLs**.

### Release loop

```bash
# Bump version, run tests, build the zip, commit, tag.
tools/release.sh 0.9.X
git push origin main v0.9.X
```

The tag push triggers `.github/workflows/release.yml` — tests run, version-vs-tag is verified, the zip is built, and a GitHub release is created with `onix-viewer-0.9.X.zip` attached. Then upload the zip to the CWS dashboard manually (the OAuth dance for an automated CWS upload is not worth it for this small extension).

## Test fixtures and what they prove

Each fixture in `tests/fixtures/` is intentionally minimal — just enough to exercise one behavior.

| Fixture | What it tests |
|---|---|
| `generic-note.xml` | Basic rendering, XML declaration as PI, no ONIX false positive |
| `with-comments.xml` | Comments render in `.px-comment` styling |
| `with-cdata.xml` | CDATA wrapped in `.px-cdata-marker` spans |
| `malformed.xml` | Parse error UI shown instead of crash |
| `rss.xml` | Non-ONIX XML doesn't get misidentified as ONIX |
| `onix-3.0-reference.xml` | Reference dialect: codelist resolution, tag classes, Product auto-collapse, summaries |
| `onix-3.0-short.xml` | Short-tag dialect: detection, styling, `SHORT_TO_REFERENCE` map |
| `onix-3.1-standalone-product.xml` | Document root is `<Product>` (no `<ONIXMessage>` envelope) |
| `onix-3.0-multi-title.xml` | Multiple `<TitleDetail>` blocks → summary picks `<TitleType>01</TitleType>` |
| `onix-3.0-gtin-only.xml` | Identifier preference order: GTIN-13 wins when ISBN-13 absent |
| `onix-3.0-isbn10-only.xml` | ISBN-10 labelled as "ISBN" in the summary |
| `onix-3.0-proprietary-only.xml` | Summary omits the identifier segment when no ISBN/GTIN present |

When adding behavior, prefer adding a fixture + assertion rather than a manual browser test. The browser step is for *verification*, not for *iteration*.

## Things explicitly not done (intentionally)

- **No background script.** Nothing currently needs one. Adding one with `webRequest` would be the path to bearer-auth and one-shot-signed-URL support.
- **No options page.** No per-user settings yet. If we add theme override (instead of auto-following system) or feature toggles, that's an options page worth building.
- **No browser_action / toolbar button.** The extension activates automatically based on `Content-Type`. A toolbar button would only make sense if we add a "manual format this page as XML" action.
- **No CWS auto-publish.** The GitHub Action builds the zip and attaches it to the release. CWS upload stays manual — Google's OAuth setup for automated publishes isn't worth the maintenance for this size of extension.
- **No telemetry, no analytics, no third-party libraries at runtime.**

## When making changes

- **Generic XML rendering** (syntax highlighting, fold behavior, search, keyboard nav): live in `viewer.js` and `viewer.css`. Always add a corresponding fixture + test.
- **ONIX detection / codelist resolution / Product summaries**: live in `onix.js`. The viewer calls into the ONIX module via the `window.OnixViewerOnix` API — keep that contract narrow so non-ONIX docs don't pay for ONIX features.
- **Codelist data**: regenerate via `node tools/generate-codelists.js`. Never hand-edit `Resources/onix-codelists.js`.
- **Right-pane block changes** (only relevant if/when the structure view is re-enabled): live in `onix-blocks.js`. Uses native `<details>`/`<summary>` for collapse, no JS needed for that.
- **Manifest changes**: update `Resources/manifest.json`. If the user-facing description changes, also update `CWS_LISTING.md` and the promo / marquee SVGs.
- **Icon changes**: edit `icons/image.png` (the cropped 546×546 source-of-truth), then `tools/render-icons.sh` rebakes all seven PNG sizes.
- **Tests**: never skip the failing-case fixtures. The malformed-XML test guards against a regression where a parse error would blank the page.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# onix-viewer — notes for Claude Code

Read this before making changes. It captures the design decisions that are not obvious from the code alone, and the dev workflow.

## What this is

A Chrome extension (Manifest V3) that takes over raw XML pages — a richer version of Chrome's built-in XML viewer — with extra niceties for ONIX bibliographic data: codelist resolution, `<Product>` summaries, dialect detection (reference vs. short-tag), ONIX 2.1 vs. 3.0 detection.

ONIX is the dominant bibliographic-metadata format in publishing, which is why it gets first-class treatment here. Generic XML works correctly too — ONIX is a layer on top of the generic viewer, not a replacement for it.

The content script activates only on a tight MIME-type whitelist: `application/xml`, `text/xml`, and `application/onix+xml`. ONIX has no IANA-registered MIME type — EDItEUR's best-practice guide tells producers to serve ONIX as `application/xml` — but the `+xml` suffix in `application/onix+xml` is spec-conformant under RFC 3023/7303, so we accept it as future-proofing for any server that adopts it. Anything broader (Atom, RSS, SOAP) would expand the takeover surface without helping the ONIX use case. XHTML and SVG appear to be XML but are explicitly skipped (browsers already render them natively).

## Layout

```
onix-viewer/
├── CLAUDE.md                       this file
├── README.md                       user-facing install/usage docs
├── package.json                    jsdom dev dep + `npm test`
├── Resources/                      the actual web extension (load this in chrome://extensions)
│   ├── manifest.json               MV3, no permissions, host_permissions <all_urls>
│   ├── content.js                  detects raw XML, takes the page over
│   ├── viewer.js                   parses + renders the tree, search, kbd nav
│   ├── viewer.css                  theme tokens (light + dark via prefers-color-scheme)
│   ├── onix.js                     ONIX detector, codelist resolver, summaries
│   ├── onix-codelists.js           ALL EDItEUR ONIX 3.1 code lists + element bindings (auto-generated)
│   ├── onix-blocks.js              right-pane "blocks" view (Title, Identifiers, Contributors)
│   ├── onix-popup.js               modal popup listing all entries of a code list
│   ├── _locales/en/messages.json
│   └── icons/                      placeholder PNGs; replace with real artwork
└── tests/
    ├── run.js                      jsdom harness (17 tests, ~1s)
    └── fixtures/                   XML samples per test category
```

## Architecture: why we replace the document

The browser's native XML viewer renders raw `application/xml` pages with an internal DOM that's largely opaque to extension content scripts. Trying to restyle it doesn't reliably work — selectors don't match, CSS injection lands on a Shadow-DOM-like structure, and there's no documented way in.

The pattern is:

1. Content script runs at `document_start`.
2. Check `document.contentType` against a whitelist of XML MIME types.
3. Re-fetch the source URL (cheap; cache hit). Reading `document.body.innerText` from the rendered viewer is unreliable.
3a. Sniff the source for ONIX markers (`ns.editeur.org/onix` namespace or `<ONIXMessage>` root). If it's XML but not ONIX, abort the takeover — the user gets the browser's native XML view. The extension is named ONIX Viewer; non-ONIX XML is none of our business.
4. Build a fresh HTML shell via `DOMParser`, then `document.replaceChild(newRoot, document.documentElement)` to swap roots.
5. Stash the source in an inert `<script type="application/xml" id="__oxv-source__">` data block (NOT an inline JS script — file:// pages and many sites have a `script-src` CSP that blocks inline execution; a non-JS script type is just a queryable text holder, which CSP leaves alone), then append `onix-codelists.js`, `onix.js`, `onix-blocks.js`, and `viewer.js` as `<script>` elements with `async = false` to preserve order.
6. Those scripts parse the original XML with `DOMParser` and render to plain DOM.

When the re-fetch fails (file:// URLs are origin "null" and CORS-blocked; one-shot signed URLs reject the second request; bearer-auth endpoints lose their headers), we fall back to `XMLSerializer().serializeToString(document)` — the browser has already parsed the XML for us, so reading the live document is a reliable second path. This means file:// works without any background script, at the cost of waiting for `DOMContentLoaded` before takeover instead of acting at `document_start`.

Things that still won't work:
- **Streaming huge XML**: we hold the full source in memory. Anything > ~10 MB causes a noticeable parse hang.

**Do not switch to `document.open()` + `document.write()`.** Per the HTML spec, `document.open()` throws `InvalidStateError` on a non-HTML document, and a raw XML page in WebKit is exactly that. Chromium has been lenient historically and let it through, which makes it a tempting "simpler" alternative — but it's a footgun if the extension is ever ported back to Safari/Firefox, and the current DOM-replacement path costs nothing extra.

**Scripts and DOMParser.** When DOMParser parses HTML, any `<script>` it produces has the spec's "already started" flag set — those scripts will *not* execute when inserted into a live document. That's why we don't embed the script tags in the parsed shell; we create them dynamically afterward.

**XHTML namespace gotcha.** Even after we replace `documentElement`, `document.contentType` remains `application/xml`. In an XML document, plain `document.createElement(tagName)` creates an element in the *null* namespace — not an HTMLElement, so it has no `.style`, no `.dataset`, etc. content.js uses `createElementNS(XHTML, "script")` for the script tags it injects, and `viewer.js` monkey-patches `document.createElement` at the top of its IIFE so every subsequent call (here and in `onix-blocks.js`) produces real HTMLElements with no per-callsite ceremony. The HTML elements that come back from `DOMParser` are already in the XHTML namespace, which is why the toolbar etc. render correctly without special handling.

## ONIX detection logic

Lives in `Resources/onix.js`. The detector returns `{ isOnix, dialect, version }` for the parsed `Document`.

Signals checked, in order:
1. **Namespace URI** on the root element (`http://ns.editeur.org/onix/3.0/reference` or `.../short`). This is the canonical ONIX 3.0 signal.
2. **Root local name** (`ONIXMessage` / `ONIXmessage`) when no namespace is set — typical of ONIX 2.1 docs.
3. The **`release` attribute** on the root if version isn't already known.

Reference vs. short tag matters because:
- Reference dialect uses `<ProductIdentifier>`, `<ProductIDType>`, etc.
- Short dialect uses `<productidentifier>`, `<b221>`, etc.
- The codelist resolver handles both via a `SHORT_TO_REFERENCE` map in `onix.js`. The map is partial — only the ~20 most common short tags. EDItEUR publishes the full alias table; extending it is mechanical.

## Codelists — generated, not curated

`Resources/onix-codelists.js` is **auto-generated** from the EDItEUR ONIX 3.1 schema (issue 72) by `tools/generate-codelists.js`. It contains all 165 lists with full code/label pairs (~4,800 entries), and binds 158 element names to their respective list. Element-name lookup goes through `OnixViewerCodeLists`; multiple element names that share a list reference the same `Map` instance.

To regenerate after a schema update:

```bash
node tools/generate-codelists.js                          # uses default schema path
node tools/generate-codelists.js --source=/path/to/xsd    # override source dir
```

The default `SCHEMA_DIR` points at the bokbasen `onix-tools` Claude Code skill cache. Update that constant (or pass `--source`) when targeting a newer schema. Bundle is ~190 KB unminified, ~50 KB gzipped — large but acceptable for a Chrome extension.

Why generated: the original hand-curated subset diverged from the schema in subtle ways (NameIDType was bound to List 32 — "Complexity scheme identifier" — instead of List 44, "Name identifier type"). A schema-derived bundle eliminates that class of bug.

## Identifier conventions

After the rename from "PrettyXML" to "ONIX Viewer":
- `window.OnixViewerOnix` — the ONIX module API (detect, tagClass, resolveCodelist, productSummary)
- `window.OnixViewerCodeLists` — the codelist data
- `window.OnixViewerBlocks` — right-pane renderer (`render(doc, container, ctx)`)
- `window.OnixViewerPopup` — code-list modal (`show(codelistKey, currentValue?)`, `close()`)
- `window.OnixViewerCodeListMeta` — element-name → `{ listNumber, title }` mapping for EDItEUR list links
- `window.__OXV_SOURCE__` — handoff slot from content.js to viewer.js for the raw XML source
- `[OnixViewer]` — console log prefix
- `oxv-*` — DOM IDs (`oxv-toolbar`, `oxv-root`, `oxv-search`, etc.)
- `data-oxv` — data attribute on the replaced `<html>`
- `px-*` — CSS class prefix (kept short; ubiquitous in viewer.js)

The `px-` CSS prefix was retained from the rename because changing it would touch every line of `viewer.js` that builds DOM. There's no functional reason to change it.

## Dev workflow

### Test loop (fast — use this most of the time)
```bash
npm install     # one-time, installs jsdom
npm test        # runs the 17-test jsdom suite (~1s)
```

The harness lives in `tests/run.js`. It loads viewer scripts in jsdom against fixtures in `tests/fixtures/`, then asserts on the rendered DOM. Add a fixture + a `test()` call when introducing new behavior — much faster than reloading the extension in the browser.

The `test()` function is hand-rolled — there is no filter flag or `--grep`. To run a single test, comment out the other `test()` calls in `tests/run.js` (or temporarily `return` early from the surrounding `describe()` blocks) and revert before committing.

### Browser loop
1. `chrome://extensions` → enable **Developer mode** (top right).
2. **Load unpacked** → pick `Resources/`.
3. Edit files → click the **reload** circular arrow on the extension card → refresh the page.

For local-file testing: extension card → **Details** → enable **Allow access to file URLs**.

## Test fixtures and what they prove

Each fixture in `tests/fixtures/` is intentionally minimal — just enough to exercise one behavior.

| Fixture | What it tests |
|---|---|
| `generic-note.xml` | Basic rendering, XML declaration as PI, no ONIX false positive |
| `with-comments.xml` | Comments render in `.px-comment` styling |
| `with-cdata.xml` | CDATA wrapped in `.px-cdata-marker` spans |
| `malformed.xml` | Parse error UI shown instead of crash |
| `onix-3.0-reference.xml` | Full ONIX 3.0 reference: dialect detect, ONIX tag classes, codelist resolution (ISBN-13, Hardback, By (author), Active, etc.), Product auto-collapse, Product summaries |
| `onix-3.0-short.xml` | Short-tag dialect: detection, short tag styling, codelist resolution via `SHORT_TO_REFERENCE` map |
| `rss.xml` | Non-ONIX XML doesn't get misidentified as ONIX |

When adding behavior, prefer adding a fixture + assertion rather than a manual browser test. The browser step is for *verification*, not for *iteration*.

## Things explicitly not done (intentionally)

- **No background script.** Nothing currently needs one. Adding one for `webRequest` would be the path to bearer-auth and one-shot-signed-URL support.
- **No options page.** No per-user settings yet. If we add theme override (instead of auto-following system), ONIX feature toggle, or codelist tooltips on/off, that's an options page worth building.
- **No browser_action / toolbar button.** The extension activates automatically based on `Content-Type`. A toolbar button would only make sense if we add a "manual format this page as XML" action for HTML pages that contain inline XML.
- **Icon** — `icon.svg` at repo root is the source-of-truth (depicts the actual split-pane UI: tree on left, divider, content panel on right). Chrome doesn't accept SVG in the manifest, so PNGs at 16/32/48/96/128/256/512 are baked out into `Resources/icons/` by `tools/render-icons.sh` (uses `rsvg-convert`, install via `brew install librsvg`). Re-run after editing the SVG, then `tools/package-extension.sh` to refresh the zip.
- **No CI.** `npm test` runs locally; wiring it into GitHub Actions is a 5-minute job.

## When making changes

- **Generic XML changes** (rendering, syntax highlighting, fold behavior, search, keyboard nav): live in `viewer.js` and `viewer.css`. Always add a corresponding fixture + test.
- **ONIX-specific changes** (new code lists, new dialect detection, new summary fields): live in `onix.js` and `onix-codelists.js`. The viewer calls into the ONIX module via the `window.OnixViewerOnix` API — keep that contract narrow so non-ONIX docs don't pay for ONIX features.
- **Right-pane block changes** (new sections, richer formatting): live in `onix-blocks.js`. The pane is hidden via `body.px-no-onix` for non-ONIX documents — `viewer.js` toggles that class. The pane uses native `<details>`/`<summary>` for collapse, no JS needed for that.
- **Split-pane layout**: position is stored in `localStorage` as `oxv-split-pos` (a CSS percentage). Drag handler lives in `setupDivider()` in `viewer.js`. CSS variable `--split-pos` on `#oxv-main` controls the tree pane's flex-basis.
- **Manifest changes**: update `Resources/manifest.json` *and* `_locales/en/messages.json` if the user-facing name/description changes.
- **Tests**: never skip the failing-case fixtures. The malformed-XML test guards against a regression where a parse error would blank the page.

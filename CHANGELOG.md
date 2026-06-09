# Changelog

All notable changes to ONIX Viewer. Versions correspond to tags `vX.Y.Z` on
the main branch.

## 0.9.9 — 2026-06-09

### Added
- **Support for the ONIX Acknowledgement message** (root
  `<ONIXMessageAcknowledgement>`, EDItEUR's optional response format). The
  extension now detects, takes over, and renders these files; they're
  labelled `ONIX Acknowledgement 3.0 (N records)` in the toolbar. Their
  status code-lists — `MessageStatus` (221), `MessageStatusDateRole` (222),
  `StatusDetailCodeType` (223), `StatusDetailType` (224),
  `StatusDetailCode` (225) and `RecordStatus` (226) — resolve to readable
  labels in both reference and short-tag dialects. The code lists were
  already bundled; only the element→list bindings were added (by hand in
  `onix.js`, since these elements aren't in the Book Product schema the
  bindings are generated from).

## 0.9.8 — 2026-05-28

### Security
- **Drop `host_permissions: ["<all_urls>"]`** from the manifest. The only
  `fetch()` in the bundle is a same-origin re-fetch of the page's own URL,
  which CORS allows without any extension privilege. Cross-origin fetches
  from the extension are now CORS-blocked by the browser, not just
  absent from the code.
- Add `SECURITY.md` — threat model, exhaustive list of what the extension
  can and can't do, and how to verify it.
- `SHORT_TO_REFERENCE` and `ATTR_CODELISTS` in `onix.js` now use
  `Object.assign(Object.create(null), { … })` so XML-derived keys can't
  resolve to `Object.prototype` properties (defense-in-depth).
- Gate the three `console.info` / `console.warn` calls in `content.js`
  behind a `DEBUG = false` constant.

### Fixed
- Product summary now picks the **distinctive title** (the `<TitleDetail>`
  with `<TitleType>01</TitleType>`), not whichever `<TitleText>` appeared
  last in a free DFS. Previously, multi-language books surfaced their
  original-language title instead of the marketed title.
- Product summary identifier order is now explicit: `15` (ISBN-13) →
  `03` (GTIN-13) → `02` (ISBN-10) → omit. Previously a fallback would
  label a proprietary ID as "ISBN".
- ProductForm / TitleText lookups now restricted to direct children of
  the appropriate composite — no more leakage of values from
  `<RelatedProduct>` blocks into the parent's summary chip.
- `viewer.js` no longer escapes `"` to `&quot;` in attribute-value text
  (the `textContent` setter already neutralises everything; the replace
  was producing literal `&quot;` on screen).

### Tests
- 52 → 56. New fixtures: `onix-3.0-multi-title.xml`,
  `onix-3.0-gtin-only.xml`, `onix-3.0-isbn10-only.xml`,
  `onix-3.0-proprietary-only.xml`.

## 0.9.7 — 2026-05-25

### Added
- **Copy XML** toolbar button — puts the unannotated XML source in the
  clipboard. Uses `navigator.clipboard.writeText` with a
  `document.execCommand("copy")` fallback for hostile origins.

## 0.9.6 — 2026-05-25

### Added
- Toolbar pill: **"EDItEUR ONIX 3.1, Issue 73"**, driven by a
  `window.OnixViewerCodeListSchema` constant baked into the generated
  `onix-codelists.js`.
- New marquee tile (1400×560) and small promo tile (440×280) using the
  book + crystal artwork.

### Changed
- Codelists upgraded to **EDItEUR Issue 73** (was 72). 12 new codes.
- `tools/generate-codelists.js` now consumes EDItEUR's published JSON
  feed (`tools/data/onix-codelists.json`) rather than regex-parsing the
  XSD enumerations. Both inputs are committed locally, so the generator
  has no external dependencies.
- Drop "parsed in N ms" from the toolbar meta.

### Removed
- Stale `dist/listing/` assets (old marquee, four promo colour tests).
- Unused `Resources/icons/onix-viewer-logo.svg` (faceted-eye sketch from
  an earlier icon round).

## 0.9.5 — 2026-05-26

### Changed
- New icon source: book + crystal artwork (`icons/image.png`). Replaces
  the faceted-eye `icon.svg`, which is removed.
- `tools/render-icons.sh` now renders the source edge-to-edge so the
  icon visually matches other extensions in the Chrome toolbar /
  extensions page (previous output was too small).

## 0.9.4 — 2026-05-25

### Added
- Support `blob:` URLs via `content_scripts.match_origin_as_fallback`
  (Chrome 119+). Chrome resolves a blob URL's origin to the page that
  created it and matches that against `<all_urls>`.

## 0.9.3 — 2026-05-25

### Removed
- The structure / split view is **disabled in the UI**. The code is
  still bundled and tested but hidden behind an early-return in
  `setupViewMode`. To re-enable, restore the `.px-view-group` block in
  `content.js` and delete the early-return — two-line revert.

### Fixed
- Inline `→ Label` codelist chip and `List N ↗` link chip are now the
  same height — both rendered as `inline-flex` at 16 px, regardless of
  whether the chip contains plain text or text + SVG icon.

## 0.9.2 — 2026-05-25

First release through GitHub Actions release-on-tag workflow. Baseline
shipping version of the simplification: tree-only view, codelist
resolution, popup, no split-pane.

## Earlier history (pre-0.9.2)

Major architectural milestones before the changelog started:

- **Cross-pane sync.** The right "blocks" pane introduced a per-Product
  collapsible card, bidirectional collapse-sync with the XML tree,
  click-to-highlight, and a draggable pane divider. All this code
  remains and is exercised in tests, but the UI toggle to expose it
  is currently disabled (see 0.9.3).
- **Codelists generator.** Switched from a hand-curated 8-list subset
  (~150 entries) to a generated 165-list bundle (~4,700 entries) from
  EDItEUR's official feeds, eliminating a class of element-to-list
  mis-bindings the curated version had.
- **Tree takeover correctness.** A long detour through XHTML-namespace
  quirks (createElement returning null-namespace elements when
  `document.contentType === "application/xml"`), CSP-blocked inline
  scripts on file:// pages, and Chrome's wrapping of raw XML in
  `webkit-xml-viewer-source-xml`. The viewer now works for HTTP,
  file://, and blob: URLs.
- **Renamed from PrettyXML to ONIX Viewer**, narrowed scope to ONIX
  detection rather than any-XML viewing, dropped Safari support to
  focus on Chrome / Chromium.

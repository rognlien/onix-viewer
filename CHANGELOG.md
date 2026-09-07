# Changelog

All notable changes to ONIX Viewer. Versions correspond to tags `vX.Y.Z` on
the main branch.

## Unreleased

### Added
- **Validate the document.** Every ONIX file is now checked as it opens,
  without blocking the page, and each finding is marked on the row it concerns — red with a cross for a
  schema error, amber with an exclamation for a warning, message in the
  tooltip: elements that are
  missing, misplaced or unknown; codes that aren't in their EDItEUR list;
  codes EDItEUR has deprecated (the code lists carry a deprecation issue for
  167 of the 4,791 codes, which the viewer now reads); and values that break
  their declared datatype.

  The toolbar shows a spinner and **Validating…** while it works, a green tick
  and **Valid** when the document is clean, or `4 errors, 1 warning` — two
  counts rather than one total, since they are acted on differently. Clicking
  that (or pressing `v`) opens the full list, and clicking an entry there
  jumps to the row it concerns.

  The work is done in slices so nothing freezes: a normal document finishes
  before the page settles, and an 11 MB feed keeps scrolling and folding
  responsive while it is checked. The pass never scrolls the view on its own.

  There's no XML Schema processor involved — the browser has none, and
  libxml2-via-WASM would add roughly 4 MB and needs a CSP privilege the viewer
  can't rely on. Instead the ONIX structure schema is compiled at build time
  into a 49 KB content model that a small interpreter walks in a single pass:
  ~920 ms for an 11.4 MB feed with 319,000 elements, and only when asked.

  ONIX **3.1** is checked in full. Other releases have their code lists
  checked and are told plainly that the structure wasn't, rather than being
  judged against the wrong schema; adding 3.0 is one more generator run.
  Validation is dialect-blind: the two dialects of one record produce
  identical findings.

  Messages live in a template catalogue that can be reworded or translated
  without touching validation logic, and rules live in a registry the runner
  walks once — so ONIX's 125 `xs:unique` identity constraints and GTIN-13
  check digits can be added later without another traversal.
- **Read either dialect.** ONIX comes in two: reference names
  (`<LanguageRole>`) and short tags (`<b253>`). A toolbar switch (shortcut
  `t`) shows the document as the other one, in either direction. It's
  labelled after the translation and never relabels — **View as reference
  names** can only appear over a short-tag file — so the dialect you actually
  opened stays obvious, and the toolbar now names it outright
  (`ONIX 3.1 short tags (1 product)`).

  The translation is exact and lossless, because the map behind it is
  generated from EDItEUR's own schemas and is one-to-one; verified against a
  real record supplied in both dialects, where translating the short-tag file
  reproduces every one of the 160 element names in the reference file.

  Names are rewritten in place rather than re-rendered, so fold state and
  search results survive; the tree is built in the preferred dialect from the
  start, so a remembered preference costs nothing at load. Elements with no
  translation — including the XHTML inside `textformat="05"` content — keep
  their names, and code-list labels, summaries and block numbers are
  unaffected because they are read from the parsed document. The choice is
  remembered between documents.
- **Copying follows the display.** While translated, **Copy XML** hands over
  the converted document and **Copy node XML** the converted subtree — with
  the EDItEUR namespace switched to match, since element names alone would
  leave `<ProductIdentifier>` in a `/short` namespace and that isn't valid
  ONIX. Indentation, comments, CDATA and the XML declaration are preserved.
  At the document's own dialect the copy is the source byte for byte, exactly
  as before.

### Fixed
- **Short-tag documents now resolve every code-list label.** The short-tag →
  reference-name map was a hand-kept subset of about thirty tags, so only 12
  of the 157 code-list-bound elements got a `→ label` badge in a short-tag
  feed — `<b253>` (LanguageRole), `<b333>` (ProductFormDetail), `<b089>`
  (SalesRightsType) and 142 others rendered as bare codes, which is exactly
  where a label helps most, since the tags themselves are opaque. The map is
  now generated from EDItEUR's official short-tag schema (505 pairs), so all
  157 resolve. Five entries in the old map (`b003`, `b005`, `b056`, `b332`,
  `b390`) turned out to be ONIX 2.1-era codes absent from 3.1, and their 3.1
  replacements were missing entirely; both sets are now present.
- **`<ONIXmessage>` is the short-tag message root**, not an ONIX 2.1 quirk —
  the short schema declares that spelling (lower-case "message") for 3.0 and
  3.1 alike, and it's the one short tag that isn't all lower case. The
  detector already handled it via the namespace, but the code comments and
  the short-tag test fixtures had it as `<ONIXMessage>`, which no short-tag
  schema accepts. Fixtures corrected, and a namespace-less `<ONIXmessage>`
  now takes its version from the `release` attribute instead of assuming 2.1
  regardless.
- The `<price>` summary chip did not appear in short-tag documents: the
  summary table is keyed on reference names, and `price` was one of the tags
  missing from the hand-kept map. The generated map fixes it, and summary
  dispatch no longer depends on that map at all — it matches the lower-cased
  name, which a short-tag composite already is.

## 0.9.14 — 2026-09-07

### Added
- **Summaries on collapsed composites.** The one-line chip that collapsed
  `<Product>` rows have always had now appears on other composites too, so a
  folded record still tells you what it holds. Identifier composites —
  `ProductIdentifier`, `RecordSourceIdentifier`, `NameIdentifier`,
  `SupplierIdentifier`, … — read as their resolved type plus value, e.g.
  `GTIN-13 9788284517247`; a proprietary scheme uses its own `<IDTypeName>`
  in place of the list's "Proprietary …" label. `<TitleDetail>` and
  `<TitleElement>` show the quoted title, `<Contributor>` its role and name
  (`By (author) Ola Nordmann`), `<Price>` its amount and currency
  (`399.00 NOK`). Chips are capped at 60 characters so they can't wrap. The
  seven ONIX blocks deliberately get none — their contents are too varied to
  sample in one line, and the `<Product>` row above already carries the
  identifier, form and title; they keep the `Block N` badge instead. Works in
  both reference and short-tag dialect.

### Changed
- **Search is collapsed to a magnifier button**, opened by the button or `/`
  and closed by `Esc`. It kept its place in the toolbar rather than being
  removed: the browser's own find cannot see folded rows, and `<Product>`
  blocks are auto-collapsed on any multi-product feed, so on exactly the files
  where searching matters `Ctrl+F` finds nothing. This search walks every text
  node and unfolds the ancestors of each match.
- The **Validate** button is gone — validation is automatic now, and the
  document never changes, so re-running it could only give the same answer.
- **Collapse blocks now folds every composite inside a `<Product>`**, not
  only the seven ONIX blocks — so `ProductIdentifier`,
  `RecordSourceIdentifier` and `Barcode` fold to one line each and a record
  reads as one row per child rather than a mix of folded blocks and sprawling
  identifiers.
- **Upgraded to ONIX 3.1.3** — EDItEUR's release 3.1 revision 3, revised
  2026-03-10 (was revision 2). EDItEUR asks all ONIX 3.1 users to move to the
  new schema files whether or not they adopt the new features. The bundled
  reference and short-tag schemas were replaced and both generators re-run,
  which brings in four new elements and six revised content models:

  - `<TextSource>` inside `<TextContent>` — a structured source for reviews
    and endorsements, patterned after `<Contributor>`, superseding
    `<TextAuthor>`, `<TextSourceCorporate>` and `<TextSourceDescription>`
    (which are deprecated but still accepted).
  - `<SequenceNumber>` and `<SubjectDescription>` inside `<NameAsSubject>`.
  - `<PublisherNameInverted>` and `<ImprintNameInverted>`, mirroring
    `<CorporateNameInverted>` — for names like *Éditions Albin Michel* that
    sort better inverted. These also appear in `<SalesRights>`.
  - Repeatable `<Affiliation>` and a wider `textscript` attribute, for
    transliterated metadata (Hindi in Devanagari alongside a romanisation).
    `textscript` values already resolved to List 121 labels.

  Nothing changed for existing files: the namespace is still `…/onix/3.1/…`
  and the schema still restricts `release` to `"3.1"`, so detection, the
  content-model registry key and every existing document's findings are
  untouched — verified against both dialects of the reference sample.
- Codelists upgraded to **EDItEUR Issue 74** (was 73). 22 new codes,
  including two AI-disclosure links (List 196), three EUDR raw-material
  location codes plus "Map projection" (List 163), Bookshop.org, Hoopla and
  XigXag (List 253), `SH` "Multiple-component retail product, partly digital"
  (List 2) and `B427` "Belly band" (List 79). List 203 is relabelled
  throughout from "Content warning" to "Content advice" and gains codes for
  death and grief, and for suicide.

### Fixed
- **Two enabled copies of the extension no longer break the page.** With a
  Web Store install alongside an unpacked build, both content scripts took
  the page over: the second replaced the first one's shell, but the first
  one's scripts still ran, so two viewer instances rendered into the
  surviving tree. The result was every element drawn twice with dead fold
  chevrons — two click handlers toggling each row back and forth. The first
  takeover now wins and later ones stand down.

## 0.9.13 — 2026-09-03

### Changed
- Internal cleanups, no user-visible changes: the toolbar block list finds
  the document's Products at the root instead of scanning every element,
  and the ancestor-unfold, clipboard-write and test row-lookup helpers are
  shared instead of duplicated.

## 0.9.12 — 2026-09-03

### Added
- **Collapse blocks.** A toolbar button (shortcut `b`) that folds the ONIX
  block elements inside every `<Product>` — `DescriptiveDetail`,
  `CollateralDetail`, `ContentDetail`, `PublishingDetail`, `RelatedMaterial`,
  `ProductSupply`, `PromotionDetail` — and unfolds the Products so each one
  reads as a short list of blocks. Works in both reference and short-tag
  dialect.
- **Block numbers on block rows.** Each ONIX block element directly inside a
  `<Product>` now carries a `Block N` badge (`<DescriptiveDetail>` → Block 1,
  … `<PromotionDetail>` → Block 7), in both dialects.
- **Block list in the toolbar.** When the document holds exactly one Product
  (a standalone record or a one-product message) the toolbar shows a pill
  such as `Blocks: 1, 4, 6` listing which blocks the record contains. Hidden
  for multi-product feeds and acknowledgements, where it would be meaningless.
- **Visible labels for code-list attributes.** Attribute values drawn from an
  ONIX code list (`textformat`, `textcase`, `language`, `dateformat`,
  `sourcetype`, `textscript`) now get a `→ label` chip right after the value,
  e.g. `<Text textformat="05" → XHTML>`. Previously the label was only
  available as a hover tooltip.
- **Drag-select copies plain XML.** Badges, list chips, product summaries,
  block labels, fold markers and the gutter button are now excluded from text
  selection, so selecting a stretch of the tree and copying yields only the
  tags, attributes and text.

## 0.9.11 — 2026-09-03

### Added
- **Copy a single node's XML.** Every element row now has a small `⋮` button
  in the gutter left of the fold chevron (revealed on hover). It opens a
  dropdown with **Copy node XML**, which puts the element and its whole
  subtree on the clipboard exactly as it appears in the source — no code-list
  badges, `List N` chips, fold markers or other viewer decoration. The text is
  de-indented to the node's own column, and the namespace declaration the
  serialiser would otherwise add to the subtree root is dropped unless the
  source element declared it itself, so a copied `<Product>` pastes cleanly
  back into another ONIX file.

## 0.9.10 — 2026-08-17

### Fixed
- **Recognise standalone `<Product>` records that have no `<ONIXMessage>`
  envelope and no namespace.** Such files (e.g. single-record exports, some
  served as blob URLs) were left to the browser's native view because both
  the `content.js` activation sniff and `onix.js`'s `detect()` only knew the
  EDItEUR namespace and `<ONIXMessage>`/`<ONIXMessageAcknowledgement>` roots.
  A bare `<Product>` root is now treated as ONIX when it carries a
  corroborating ONIX-specific child (`RecordReference`, `NotificationType`,
  `ProductIdentifier`, …, or short tags `a001`/`a002`) — generic non-ONIX
  `<Product>` documents are still left alone. The dialect is inferred from
  element-name casing; the version is unknown without a namespace, so the
  toolbar reads `ONIX (N products)` with no version number.
- **Product summaries no longer drop split-form titles.** `productSummary`
  read only `<TitleText>` (`b203`), so records using the equally conformant
  `<TitlePrefix>` + `<TitleWithoutPrefix>` (`b030` / `b031`) form — common in
  Nordic feeds — showed a summary with no title at all. The prefix and
  remainder are now joined with a space, and `<NoPrefix/>` records yield just
  the remainder.
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

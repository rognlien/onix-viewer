# Changelog

All notable changes to ONIX Viewer. Versions correspond to tags `vX.Y.Z` on
the main branch.

## Unreleased

### Added
- **The findings list filters by severity**: All, Errors or Warnings, each
  with its count. The filter shows when a file has both.
- About names the bundled Thema version and the ONIX 3.0 and 3.1 schema
  revisions (3.0.8 and 3.1.3) beside the code-list issue.

### Changed
- **Up to 10,000 errors and 10,000 warnings are listed**, where the limit
  was 500 findings in all. Each severity has its own limit, so a file with
  many warnings no longer pushes its errors out of the list and the tree.
  Findings past the limit are still counted.
- Thema subject codes upgraded to **Thema 1.7** (was 1.6). 261 new codes,
  none removed, and revised headings for 655 existing codes.

## 0.9.22 — 2026-10-16

### Changed
- **A document that declares no release is validated as ONIX 3.0.** A
  standalone `<Product>` with no namespace used to start on an "Undeclared
  release" choice that checked no structure; ONIX 3.1 is the other option.
- Codelists upgraded to **EDItEUR Issue 75** (was 74). 29 new codes,
  including EPR registration numbers (Lists 44 and 92), packaging contacts
  and documentation for the EU's packaging rules (Lists 184, 198 and 239),
  LLM training (Lists 154 and 158), three manuscript and embargo dates
  (List 163), `D512` JSON (List 178), `101G` EPUB 3.4 (List 220), eight
  languages (List 74) and Äänel, Bookoutlet and Studentapan (List 139).
  List 184 is retitled "EU Product Safety and related regulations".
  Newly deprecated: `17` Softbox (List 80), BDBuzz and Sequencity
  (List 139).

### Fixed
- **About no longer offers "rules of your own"**, a feature that is not in
  the shipped build.
- **No dialect switch on Acknowledgement messages.** Their own elements have
  no short tags the viewer knows, so the conversion mixed the two dialects.
- **Prefixed ONIX converts.** In a document written as `<onix:Product>`, the
  dialect switch, Copy XML and Download left every name in the source
  dialect.
- **The converted document keeps the source's attributes in place.** The
  namespace declaration no longer moves behind `release`, and a foreign
  namespace declared on the root stays there.

## 0.9.21 — 2026-10-05

### Added
- **Thema subject codes.** A `<SubjectCode>` under one of the seven Thema
  schemes, 93 to 99, shows its English heading from Thema 1.6
  (`FYT → Fiction in translation`), with a chip that opens the scheme's
  codes. A code Thema does not have is a warning.
- **Form details are checked against the form.** A `<ProductFormDetail>`
  that EDItEUR ties to other forms is an error: `"B115" (Kartonnage
  (Sweden)) can only be used with <ProductForm> BB, not BC`.
- **Download.** A toolbar button beside Copy XML saves the document as it is
  shown: the file itself, or the converted ONIX while the view is translated
  (`feed-short-tags.xml`, `feed-reference-names.xml`).

### Changed
- **The toolbar's controls are icons with tooltips**, each naming itself and
  its key on hover. The row is about 300px shorter, so the release selector
  now stays down to 800px.
- **The file size reads as the Finder gives it**: `373.3 MB` where the
  toolbar said `363360.2 KB`, in the browser's own number format. The
  product count is grouped the same way (`20,868 products`).
- **The Mac app has an icon of its own**: the owl on a teal square.

### Fixed
- **Search no longer hangs on a large feed.** It searches the document
  itself rather than rendering every Product first; a 10,000-product feed
  takes about four seconds for any query.
- **A file over 500 MB no longer crashes the tab.** It gets a notice saying
  it is too large to open.
- **A large file's page now finishes loading.** Above about 150 MB, Chrome
  left the page loading for good.

## 0.9.20 — 2026-09-29

### Added
- **A release selector.** The code-list issue pill now lets you judge the
  document against ONIX 3.0 or 3.1, starting on the release the file
  declares. A feed about to move between them can be read both ways, and a
  standalone `<Product>` with no namespace can be checked structurally at
  all.
- **An About window.** Click the owl, or press `?`: the version, the
  code-list issue, the keyboard shortcuts, and links to the source, the
  store listing and EDItEUR.
- **Firefox support.**
- **A new owl.** The icon is redrawn, with hand-drawn small sizes.

### Changed
- **Large feeds render in a fraction of the time.** Products off screen are
  not laid out: a 5 MB feed is ready in 1.5 s instead of 5.6 s, a 17 MB one
  in 5 s instead of 41 s. Search and findings jumps are now instant rather
  than smooth.
- **The toolbar mark is drawn at its own size**, crisp on 1x and 2x
  displays.

### Fixed
- **A known element the parent never takes no longer derails the
  composite.** A 3.1 feed judged as 3.0 reported eight findings per
  `<TextContent>` for a single `<SequenceNumber>`; it is now one.
- **The About window no longer says "in Chrome"**, and its install link
  follows the browser.
- **A warnings-only verdict shows the warning glyph**, in amber, instead of
  the error icon.
- **The issue pill no longer covers the verdict on a narrow window.**
- **A share link behind a session is taken over.** When the second request
  for the file returned the app's sign-in page, the viewer gave up; it now
  uses the browser's own copy of the document.

## 0.9.19 — 2026-09-12

### Added
- **Second-order code lists are resolved and validated.** A few elements
  take their code from a list that a sibling selects —
  `<ProductFormFeatureValue>` is a colour from List 98 when
  `<ProductFormFeatureType>` is 01, an accessibility detail from List 196
  when it is 09. They now get the label and the `List N` chip like any other
  code, and a code the selected list lacks is reported. Suggested by Graham
  Bell.
- **A bad code still offers its list**, so the list it should have come from
  is one click away.

### Changed
- **A file opens fully expanded.** Two presses of Collapse give one line per
  product.
- **Finding pills are wider**, enough for a second-order finding to show its
  selector.
- **The 128px icon is hand-drawn.**

## 0.9.18 — 2026-09-09

### Changed
- **Finding markers are pills.** A finding shows as a pill tinted in its
  severity colour, led by a small glyph and carrying the message. A row with
  several findings shows the first and `+n more`. Clicking the pill opens
  the findings list at that row's entries.
- **Row tints are softer.**
- **Standalone text rows are shown trimmed**, rather than three lines tall
  from the file's own indentation.

### Fixed
- **The tree did not fill the window** when the document was narrow.
- **Stray text was flagged on the wrong row**, often the top of the
  document. The pill now sits on the text's own row.

## 0.9.17 — 2026-09-09

### Added
- **Attributes are validated.** ONIX's ten attributes — `datestamp`,
  `sourcename`, `sourcetype`, `language`, `textscript`, `textformat`,
  `textcase`, `dateformat`, `collationkey`, `release` — are checked for
  code-list membership, deprecated codes, datatypes and empty values.
- **All identity constraints are enforced** (142 in 3.1, 85 in 3.0): no two
  `<Product>` with the same `<RecordReference>`, no two `<Measure>` with the
  same type and unit, and so on.
- **The toolbar opens with the extension's mark**, so a raw XML URL shows
  which extension replaced the page.
- **New owl artwork throughout.**

### Changed
- **Soft wrap gains an icon.**
- **Chrome 119 is the minimum version.**

### Removed
- **The hidden structure pane**, which no reader could reach. The packaged
  extension is about 49 KB smaller.

### Fixed
- **Text inside an element-only composite is reported**
  (`structure.stray-text`).
- **Wrong-length ISBNs and GTINs are reported**, such as a hyphenated or
  truncated ISBN-13.
- **Copy XML lost its icon after the first click.**
- **DOCTYPE rows dropped the `SYSTEM` keyword.**
- **The takeover could fail silently** when the page loaded very fast.
- **Tree shortcuts acted behind an open dialog.**
- **Several values went unchecked**: namespace-prefixed ONIX attributes,
  numbers (`<EditionNumber>abc</EditionNumber>` passed), every member of a
  space-separated list such as `<CountriesIncluded>`, and every date.
- **`<EpubLicense>` was unknown in ONIX 3.1**, so valid 3.1 reported it as
  an error and nothing inside it was checked.
- **ONIX 3.0's `sourcetype`, `textcase` and `textformat` went unchecked.**
- **An empty `<CopyrightType/>` was reported as missing a value**, though
  the schema gives it a default.
- **Some findings named a list as "List 14 (List 14)"** instead of by its
  title.
- **Elements named after JavaScript built-ins**, such as `<constructor>`,
  were misjudged.

## 0.9.16 — 2026-09-08

### Added
- **Deprecated elements are reported**, as warnings, naming the release and
  the replacement EDItEUR advises: `<TitleText> is deprecated from release
  3.1 — use either <TitlePrefix> or <NoPrefix/>, plus <TitleWithoutPrefix>
  instead`.
- **ISBN-13, GTIN-13 and ISBN-10 check digits are validated.**

### Changed
- **Expand and Collapse work a level at a time**, replacing the three
  all-or-nothing buttons. Collapse follows the shape of a message: first
  everything inside each `<Product>` and the `<Header>`, then the
  `<Product>` rows. `b` is now a synonym for `c`.
- **The toolbar is reorganised.** The document pill gathers the release,
  product count, blocks and size; the controls share one midline; and on a
  narrow window the pill and search give way before the verdict.
- **Pages load faster**: a 300-product feed goes from 2.0 s to 1.1 s to
  interactive.

### Fixed
- **Findings on a short-tag document name short tags**, including inside
  EDItEUR's deprecation advice.
- **The findings list is selectable text.**
- **A deeply nested document no longer renders truncated.** Past about
  2,000 levels the tree stopped part-way and looked complete.
- **Closing search returns focus to its button.**
- **Search highlights clear faster** on large feeds.
- **The findings list and code-list popup keep keyboard focus inside
  themselves** and return it where it was when closed.
- **`<x512>` (`CopyrightType`) was unknown in short-tag documents.**

## 0.9.15 — 2026-09-07

### Added
- **Validation.** Every ONIX file is checked as it opens, without blocking
  the page: elements that are missing, misplaced or unknown; codes that are
  not in their EDItEUR list or are deprecated; and values that break their
  datatype. Each finding is marked on its row. The toolbar shows **Valid**
  or `4 errors, 1 warning`; clicking it, or pressing `v`, opens the full
  list. ONIX 3.0 and 3.1 are each checked against their own schema; ONIX 2.1
  and Acknowledgement messages have their code lists checked only.
- **Read either dialect.** A toolbar switch (`t`) shows the document in
  reference names or short tags, whichever it is not written in. The
  translation is exact, from EDItEUR's own schemas.
- **Copying follows the display**: while translated, Copy XML hands over the
  converted document, with the namespace to match.

### Changed
- **Upgraded to ONIX 3.1.3** (was 3.1.2), with its four new elements and six
  revised content models.
- **Search is collapsed to a magnifier button**, opened by the button or `/`
  and closed by `Esc`.
- The **Validate** button is gone; validation is automatic.
- The code-list pill drops the vendor name, and the document pill names the
  dialect only for short tags.

### Fixed
- **Short-tag documents resolve every code-list label.** Before, only 12 of
  the 157 code-list elements got one.
- **`<ONIXmessage>` with no namespace** takes its release from the `release`
  attribute instead of assuming 2.1.
- **The `<Price>` chip appears in short-tag documents.**

## 0.9.14 — 2026-09-07

### Added
- **Summaries on collapsed composites.** Identifiers read as their type and
  value (`GTIN-13 9788284517247`), `<TitleDetail>` as the title,
  `<Contributor>` as role and name, `<Price>` as amount and currency. Works
  in both dialects.

### Changed
- **Collapse blocks folds every composite inside a `<Product>`**, not only
  the seven blocks.
- Codelists upgraded to **EDItEUR Issue 74** (was 73). 22 new codes,
  including two AI-disclosure links (List 196), Bookshop.org, Hoopla and
  XigXag (List 253), and "Content warning" relabelled "Content advice"
  (List 203).

### Fixed
- **Two enabled copies of the extension no longer break the page**, such as
  a store install beside a development build.

## 0.9.13 — 2026-09-03

No user-visible changes.

## 0.9.12 — 2026-09-03

### Added
- **Collapse blocks** (`b`) folds the block elements inside every
  `<Product>`, so each reads as a short list of blocks.
- **Block numbers**: each ONIX block carries a `Block N` badge.
- **Block list in the toolbar** for a single-product document:
  `Blocks: 1, 4, 6`.
- **Labels for code-list attributes**: `<Text textformat="05" → XHTML>`.
- **Drag-select copies plain XML**, without badges, chips or summaries.

## 0.9.11 — 2026-09-03

### Added
- **Copy a single node's XML** from the `⋮` button beside each element row.
  The copy is de-indented and pastes cleanly into another ONIX file.

## 0.9.10 — 2026-08-17

### Fixed
- **Standalone `<Product>` records with no envelope and no namespace are
  recognised**, as long as they carry an ONIX-specific child. Other
  `<Product>` documents are left alone.
- **Product summaries show split-form titles** (`<TitlePrefix>` +
  `<TitleWithoutPrefix>`), common in Nordic feeds.

## 0.9.9 — 2026-06-09

### Added
- **ONIX Acknowledgement messages** are detected and rendered, labelled
  `ONIX Acknowledgement 3.0 (N records)`, with their status codes resolved
  in both dialects.

## 0.9.8 — 2026-05-28

### Security
- **The extension asks for no host permissions.** Its only request is the
  page's own URL, fetched again from its own origin.
- Added `SECURITY.md`: what the extension can and cannot do, and how to
  verify it.

### Fixed
- **The product summary shows the distinctive title** (`<TitleType>` 01),
  not whichever title came last.
- **The product summary never labels a proprietary ID as "ISBN".** It
  prefers ISBN-13, then GTIN-13, then ISBN-10, and otherwise omits the
  identifier.
- **Summaries no longer pick up values from `<RelatedProduct>`.**
- **Quotes in attribute values** no longer show as `&quot;`.

## 0.9.7 — 2026-05-25

### Added
- **Copy XML** puts the XML source on the clipboard.

## 0.9.6 — 2026-05-25

### Added
- The toolbar names the code lists: **EDItEUR ONIX 3.1, Issue 73**.

### Changed
- Codelists upgraded to **EDItEUR Issue 73** (was 72).

## 0.9.5 — 2026-05-26

### Changed
- A new icon.

## 0.9.4 — 2026-05-25

### Added
- **`blob:` URLs** are taken over (Chrome 119+).

## 0.9.3 — 2026-05-25

### Removed
- The structure / split view.

### Fixed
- The code-list label and link chips are the same height.

## 0.9.2 — 2026-05-25

The first release: the tree view, code-list resolution and the code-list
popup, for ONIX served as XML over HTTP, from `file://` and from `blob:`
URLs.

# Changelog

All notable changes to ONIX Viewer. Versions correspond to tags `vX.Y.Z` on
the main branch.

## Unreleased

### Added
- **Attributes are validated.** ONIX's ten attributes — `datestamp`,
  `sourcename`, `sourcetype`, `language`, `textscript`, `textformat`,
  `textcase`, `dateformat`, `collationkey`, `release` — were never checked, so
  a `textformat="99"` passed while the same bad code in an element was
  reported. The new `attribute` rule checks code-list membership, deprecated
  codes, datatypes, enumerations, and the one required attribute. `refname`
  and `shortname` are checked against the element they sit on, in whichever
  dialect the document uses. `xmlns`, `xsi:*` and `xml:*` are left alone.

  The models grew ~4 KB, not 25: only ten distinct attribute sets exist across
  510 elements, so the generator pools them and each element stores an index.

### Added
- **All 142 identity constraints are enforced** (85 in 3.0) — the rules no
  content model can state: no two `<Product>` with the same
  `<RecordReference>`, no two `<Measure>` with the same type and unit, each
  repeat of `<Text>` needing a distinct language and script. Compiled from the
  schema's `xs:unique` onto each host element; the generator throws rather than
  skip a shape it cannot compile. `xs:unique`'s own rule is kept: a node whose
  key is incomplete falls outside the constraint.

### Added
- **New owl artwork throughout.** The seven manifest icon sizes, the toolbar
  mark, and the promo tiles all come from `icons/icon-original.png` now.
  `tools/render-icons.sh` prefers a hand-drawn `icons/icon-<size>.png` over a
  downscale of the master where one exists — definition at 16 and 32 px is worth
  more than consistency with a scale — but refuses one without an alpha channel,
  since an opaque icon shows as a pale tile on a dark ground.
- **The toolbar mark is the app icon itself**, not a copy — it loads
  `Resources/icons/icon-48.png` rather than a `logo-48.png` that would need
  keeping in step.
- **The toolbar opens with the extension's mark.** A raw XML URL gives no other
  clue which extension replaced the page. 28px, which is exactly the toolbar's
  content height. It is removed rather than left broken if the page's `img-src`
  CSP refuses extension URLs.

### Changed
- **Soft wrap gains an icon**, so every labelled toolbar button now has one.
  It is the return arrow: two earlier attempts drew the literal wrap — a text
  rule plus a line curving round with an arrowhead — and at 14px both read as a
  bar with a nub, because an arc and an arrowhead do not fit in 10 pixels. The
  dialect switch stays text-only on purpose; its label names the translation and
  changes with the document.

### Fixed
- **Four datatypes were entirely unchecked.** `dt.Decimal`, `dt.Integer`,
  `dt.PositiveInteger` and `dt.PositiveIntegerOrZero` carry no facets at all,
  only a base type, and the generator recorded facets only — so
  `<EditionNumber>abc</EditionNumber>` passed, as did `2.5` and `0`. The base
  type's lexical space is now checked, `xs:int`'s 32-bit range included.
- **Space-separated code lists had their members skipped.**
  `<CountriesIncluded>NO XX DK</CountriesIncluded>` passed unchallenged; `XX` is
  now named. The generator records what the list is *of*, and `minLength`.
- **`dt.DateOrDateTime` was never checked.** The generator saw `xs:union` and
  treated it as opaque, so every `datestamp` and every date element went
  unvalidated. The union has one member type carrying the five date patterns,
  and a union of one is just that member. No fixture or `Onix/` sample gained
  a finding, so this was a missed check rather than a wrong answer.
- **35 code lists had no name to print in a finding.** Titles were only
  reachable through an element that binds the list, and those 35 are bound to
  attributes instead — so a finding read "List 14 (List 14)". The code-list
  generator now emits titles by number as well.
- **`<EpubLicense>` was missing from the ONIX 3.1 model entirely**, so valid
  3.1 reported it as an unknown element and nothing inside it was checked at
  all. It is the one element in either release declared by a *named*
  `complexType` rather than an inline one — five declarations, two types — and
  the generator compiled only inline types. Named types are now compiled,
  `xs:extension` resolved by concatenating the base's particles ahead of the
  extension's own. Its content model is genuinely context-dependent, so the
  variants are keyed by parent: `<EpubLicenseDate>` is legal under
  `<DescriptiveDetail>`, `<ContentItem>`, `<ResourceVersion>` and
  `<TextContent>`, and not under `<Price>`. Every rule now reads an element's
  shape through `api.shapeOf(node)`, which is where the parent is consulted.
- **ONIX 3.0's `sourcetype`, `textcase` and `textformat` went unchecked.** 3.0
  names those attribute types after the code list — `SourceTypeCode` where 3.1
  says `List3` — and the definitions live in the CodeLists XSD we don't commit,
  so all three compiled to an unknown datatype, which the datatype rule skips
  in silence. A `textformat="99"` in a 3.0 document passed: exactly the bug
  0.9.17 fixed for 3.1. They now resolve to Lists 3, 14 and 34.
- **An empty `<CopyrightType/>` was reported as missing a value.** The
  declaration carries `default="C"`, and an XSD default applies precisely when
  the element is left empty, so the element is valid and means `C`. Defaults
  are recorded in the model; three declarations across the two releases have
  one.

### Changed
- **The content-model generator now refuses a schema it does not fully
  understand**, rather than emit a model that is quietly short. Both releases
  use exactly 27 XSD element kinds and all 27 are compiled, so a construct
  absent today — `xs:any`, `xs:all`, `xs:key`, `nillable`, a facet like
  `maxExclusive` — fails the build instead of being ignored. It also asserts
  that every datatype named by an element or attribute is one it compiled,
  which is the check that would have caught the 3.0 attribute gap above, and
  that no facet on a `dt.*` type goes unread. A finite `maxOccurs` is enforced
  too: `<OrderQuantityMinimum maxOccurs="2">` is the one particle in either
  release with an upper bound above one.

## 0.9.16 — 2026-09-08

### Added
- **Deprecated elements are now reported**, as warnings, naming the release it
  happened at and the replacement EDItEUR advises: `<TitleText> is deprecated
  from release 3.1 — use either <TitlePrefix> or <NoPrefix/>, plus
  <TitleWithoutPrefix> instead`. 7 elements in 3.1, 18 in 3.0, compiled from
  the schema's own annotations rather than a hand-kept list. Only deprecated
  *codes* were reported before.

  Three annotations that say "Deprecated" describe an element's **children**,
  not itself — `<Header>`, `<TitleElement>` and `<SalesRestriction>` — and the
  first two appear in nearly every ONIX file, so they are deliberately not
  flagged. `<TextSourceDescription>` is deprecated only within
  `<TextContent>`, so the parent decides.
- **ISBN-13, GTIN-13 and ISBN-10 check digits are validated.** The schema
  can't see these — all three are just strings to it — and a wrong one is a
  common real defect. Schemes without a check digit (proprietary, DOI, …) and
  values of the wrong length are left alone.
- **Tests run on every push and pull request** (`.github/workflows/test.yml`),
  not only on a release tag. The same job re-runs all three generators and
  fails on a diff, so editing an input in `tools/data/` without regenerating
  is caught instead of shipping stale data.
- **The test runner takes a name filter** — `npm test -- x512` runs one test,
  `npm test -- validation` a whole block, matched case-insensitively against
  the test name and its `describe` label. A filter that matches nothing exits
  non-zero. Replaces commenting out every other test, and cuts a single-test
  run from ~7s to ~0.2s.
- First tests for `content.js` — the ONIX sniff that decides whether a page is
  taken over at all, and the release sniff that picks the content model. Both
  are lifted out of the source, since the file is an IIFE that acts on load.

### Changed
- **Expand and Collapse now work a level at a time**, replacing the three
  all-or-nothing buttons. **Expand** reveals one more level per press.
  **Collapse** follows the shape of a message: first the `<Header>` and
  everything inside each `<Product>`, then the `<Product>` rows, then the
  root — and on non-ONIX XML it zips up from the leaves, the mirror of Expand.
  Neither counts clicks: each press reads the tree, so they stay correct after
  rows are folded by hand. `e` and `c` are unchanged, `b` is now a synonym
  for `c`.
- **Toolbar wording and icons:** "Expand all" → **Expand** and
  "Collapse all"/"Collapse blocks" → **Collapse**, each with a stacked
  double-chevron (down opens, up folds); "Wrap" → **Soft wrap**; **Copy XML**
  gains a copy icon. The icons come from the same table as the severity chips
  and the spinner.
- **Fixed the toolbar's vertical alignment.** Adding icons to some buttons but
  not others split the control row across three midlines 4.3px apart: an
  `inline-flex` button takes its baseline from its first flex item, so an icon
  button aligned on the icon's bottom edge and a text-only one on its text.
  The row is a flex container now, so every control shares one midline.
- **The toolbar degrades properly on a narrow window.** The document pill's
  label ellipsises, then the search field shortens, then the pill is dropped —
  the validation state and the code-list issue never give way. Measured from
  1912px down to 700px with every block listed and a 4.8 MB feed: no overflow
  at any width. (A bare `1fr` grid track will not shrink below its content, so
  the middle column used to push into the right one.)
- **The toolbar's right-hand side is reorganised.** The document pill moves in
  beside the controls and becomes one unit — `📄 ONIX 3.1 (1 product) ·
  Blocks: 1, 2, 4, 5, 6 · 17.9 KB` — absorbing what used to be a separate
  `Blocks:` pill, since that describes the document rather than the viewer.
  The validation state follows it. The code-list issue pill (`ONIX 3.1, Issue
  74`) is reference material and now sits alone at the far right.
- **Collapse blocks now folds the message `<Header>` too.** It is a sibling of
  the products rather than a child, so the Product-child rule never reached it
  — leaving it the one composite still sprawling after a collapse. The
  `<Product>` rows themselves still stay open, and the button is still inert on
  non-ONIX XML.
- **The hidden Structure pane is no longer built on load.** Its cards were
  rendered on every ONIX page even though the pane is disabled in the UI,
  purely because the toolbar's product count read the return value — 43k DOM
  nodes built and discarded on a 300-product feed, 144k on a 1000-product one.
  The pane now renders on first reveal, and the count comes from the parsed
  document. A 300-product feed goes from 2.0s to 1.1s to interactive.
- **Only the content model for the document's own release is injected.** A
  message declares exactly one release, so shipping both cost 103 KB of parse
  to use half of it; `content.js` reads the release from the same head it
  already sniffs. Where the release isn't readable there — ONIX 2.1, or a
  standalone `<Product>` with no namespace — both still go in, so the "no
  content model bundled" warning keeps naming everything that ships.

### Fixed
- `tests/fixtures/onix-3.1-standalone-product.xml` was missing a required
  `<ProductComposition>`, so the one fixture with a `<Product>` root reported a
  schema error. It is now a clean baseline for that shape.
- **Findings on a short-tag document now name short tags.** The content model
  is in reference names, so a message could tell the reader their `<TitleText>`
  is deprecated when their file says `<b203>` — and mix the two inside one
  message: `<descriptivedetail> is missing a required <ProductComposition>`.
  Every element name in a finding is now written in the document's own
  dialect, including the ones inside EDItEUR's deprecation advice, which
  becomes "use either `<b030>` or `<x501/>`, plus `<b031>` instead". Reference
  documents are unchanged.
- **The findings list is selectable text.** Its entries are buttons, which
  browsers make unselectable, so the message — the one thing worth copying out
  — could not be. Selecting it no longer triggers the jump to that row either.
- **The renderer no longer depends on the JS stack.** It walks with an
  explicit stack, like the validator. Nesting past ~2,000 levels used to
  overflow, and the throw escaped mid-render, so everything after it — the
  toolbar's document pill, validation, search, the click handlers — never ran,
  leaving a tree truncated at 1,681 of 4,002 rows that looked like a complete
  document. Rendered output is byte-identical for every fixture and both
  `Onix/` samples.
- **Closing the search field hands focus to its toggle** instead of dropping
  it on `<body>`. The field is untabbable while collapsed, so a bare blur sent
  the next Tab back to the top of the document. Focus is left alone when the
  reader had already moved it elsewhere.
- **Search no longer rescans the tree to clear its highlights.** It clears from
  the match list it already holds; the old document-wide query cost 74 ms per
  keystroke on a 17,500-row feed, more than the search itself.
- **The findings list returns focus where it found it** when closed, names its
  dialog for assistive tech, and keeps Tab inside itself — which is what its
  `aria-modal="true"` already claimed. The code-list popup, which had the
  first two, gained the Tab trap.
- Twelve test fixtures carried invalid ISBN check digits, found by the new
  rule on its first run; they now carry valid ones. `onix-3.1-invalid.xml`
  keeps its bad digit deliberately — it is the defect catalogue.
- **`<x512>` (`CopyrightType`) was missing from the short-tag map**, so in a
  short-tag document it resolved no code-list label, the dialect switch could
  not rename it, and the validator reported conformant ONIX as an unknown
  element. The cause was in the generator: `tools/generate-codelists.js`
  scraped the schemas with regexes that required `name="x"` to be a
  declaration's last attribute, and `<xs:element name="x512" default="C">` is
  the one declaration in either short schema that carries another. Both
  schemas are now parsed as XML with the same `DOMParser`
  `generate-content-model.js` already used, which makes the whole class of
  miss impossible; the map goes from 529 to 530 pairs and is otherwise
  byte-identical. The generator now also throws if a declaration yields no
  `refname`, rather than emitting a map that is quietly short a few pairs.

## 0.9.15 — 2026-09-07

### Changed
- Toolbar tidying: the code-list pill drops the vendor name (`ONIX 3.1,
  Issue 74`), the document pill is led by a file icon, and it names the
  dialect only when the file uses **short tags** — reference names are the
  norm, so saying so added nothing.
- **Search is collapsed to a magnifier button**, opened by the button or `/`
  and closed by `Esc`. It kept its place in the toolbar rather than being
  removed: the browser's own find cannot see folded rows, and `<Product>`
  blocks are auto-collapsed on any multi-product feed, so on exactly the files
  where searching matters `Ctrl+F` finds nothing. This search walks every text
  node and unfolds the ancestors of each match.
- The **Validate** button is gone — validation is automatic now, and the
  document never changes, so re-running it could only give the same answer.
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

### Added
- **Validate the document.** Every ONIX file is now checked as it opens,
  without blocking the page. Each finding is marked on the row it concerns —
  red with a cross for a schema error, amber with an exclamation for a
  warning, message in the tooltip: elements that are missing, misplaced or
  unknown; codes that aren't in their EDItEUR list; codes EDItEUR has
  deprecated (the code lists carry a deprecation issue for 167 of the 4,791
  codes, which the viewer now reads); and values that break their declared
  datatype.

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
  can't rely on. Instead each ONIX structure schema is compiled at build time
  into a ~52 KB content model that a small interpreter walks in one pass:
  about 100 ms for a 4.8 MB feed with 135,000 elements, measured in Chrome.

  **Both ONIX releases since 3.0 are checked in full** — 3.0 (revision 8) and
  3.1 (revision 3), each against its own compiled schema, chosen by the
  message's `release`. There is nothing finer to cover: a message can only
  declare `3.0` or `3.1`, and the revisions within a release aren't declarable
  at all, so the newest revision of each is both the only option and a safe
  one — ONIX adds and deprecates but doesn't remove, so the newest schema is a
  superset of every earlier revision.

  Anything older (ONIX 2.1) has its code lists checked and is told plainly
  that the structure wasn't, rather than being judged against the wrong
  schema. **Acknowledgement messages** are exempt for the same reason: their
  elements live in a separate schema, so they'd otherwise report every element
  as unknown.

  The short-tag map now merges both releases' schemas (529 pairs), because 3.0
  keeps about twenty tags 3.1 dropped — `Conference`, `Reissue`, `Gender`,
  `EpubLicense` among them — without which a short-tag 3.0 file resolves
  almost nothing. Validation is dialect-blind either way: the two dialects of
  one record produce identical findings.

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
- **Collapse blocks now folds every composite inside a `<Product>`**, not
  only the seven ONIX blocks — so `ProductIdentifier`,
  `RecordSourceIdentifier` and `Barcode` fold to one line each and a record
  reads as one row per child rather than a mix of folded blocks and sprawling
  identifiers.
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

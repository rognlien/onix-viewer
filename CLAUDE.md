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
├── package.json                    jsdom + eslint dev deps; `npm test`, `npm run lint`
├── eslint.config.js                ESLint flat config: browser globals for Resources/, node for tools/ and tests/
├── Resources/                      the actual web extension (load in chrome://extensions)
│   ├── manifest.json               MV3, ZERO permissions, ZERO host_permissions
│   ├── shell.js                    the HTML shell, one template for content.js and the tests
│   ├── content.js                  detects raw XML, takes the page over
│   ├── viewer.js                   parses + renders the tree, search, kbd nav
│   ├── viewer.css                  theme tokens (light + dark via prefers-color-scheme)
│   ├── onix.js                     ONIX detector, codelist resolver, summaries
│   ├── onix-codelists.js           ALL EDItEUR ONIX 3.1 code lists + short-tag map (auto-generated, ~231 KB)
│   ├── onix-content-model-3.1.js   ONIX 3.1.3 content model for validation (auto-generated, ~66 KB)
│   ├── onix-content-model-3.0.js   ONIX 3.0.8 content model for validation (auto-generated, ~62 KB)
│   ├── onix-validate.js            content-model interpreter, rule registry, messages
│   ├── onix-popup.js               modal popup listing all entries of a code list
│   └── icons/                      icon-{16,32,48,96,128,256,512}.png, built from icons/
├── icons/                          SOURCE artwork — not shipped. The master plus
│                                   any hand-drawn per-size overrides
│   ├── icon-original.png           1254×1254 RGBA master — the render source
│   └── icon-<size>.png             hand-drawn overrides; used verbatim when present.
│                                   Only manifest sizes are consulted, so a file
│                                   at any other size is never read
├── tools/
│   ├── package-extension.sh        builds dist/onix-viewer-<version>.zip for CWS upload
│   ├── render-icons.sh             icons/ -> Resources/icons/, hand-drawn sizes winning
│   ├── check-icons.js              asserts the shipped icons match their sources
│   ├── generate-codelists.js       generates Resources/onix-codelists.js
│   ├── generate-content-model.js   generates Resources/onix-content-model.js
│   ├── release.sh                  bumps version, commits, tags
│   └── data/
│       ├── onix-codelists.json     EDItEUR Issue 74 codelists (input)
│       ├── ONIX_BookProduct_3.1_reference.xsd  (input, bindings + 3.1 content model)
│       ├── ONIX_BookProduct_3.0_reference.xsd  (input, 3.0 content model)
│       ├── ONIX_BookProduct_3.0_short.xsd      (input, 3.0 short tags)
│       ├── ONIX_BookProduct_3.1_short.xsd      (input, short-tag→reference names only)
│       ├── ONIX_BookProduct_3.1_reference_strict.xsd  (input, second-order code lists only)
│       └── ONIX_BookProduct_3.1_short_strict.xsd      (reference; not read by anything)
├── Onix/                           real ONIX samples: one record in both dialects
├── tests/
│   ├── run.js                      loads every case and prints the summary (takes a name filter)
│   ├── harness.js                  jsdom setup, test/describe/assert, render and validation helpers
│   ├── cases/                      one file per area, NN-<area>.test.js, run in name order (246 tests, ~9s)
│   ├── expected/                   the findings on record for every ONIX fixture and sample
│   └── fixtures/                   XML samples per test category
├── Screenshots/                    store screenshots, committed at 1280×800
│   ├── Main.png                    the tree
│   ├── CodeList.png                the code-list popup
│   └── Violations.png              the findings
├── site/                           the extension's web page: index.html plus byte copies of
│                                   the three screenshots and the 128px icon. Published by
│                                   copying its contents to ~/git/maendeleo-site/onix-viewer/
│                                   by hand; nothing here serves it. A test holds the copies
│                                   to their sources
├── dist/                           build output — gitignored in full
│   └── listing/                    upload staging for the GENERATED assets only:
│                                   icon-128 (copied from Resources/icons/) plus the
│                                   promo tile and marquee (rsvg-convert from the
│                                   SVGs at the repo root). No screenshots here.
└── .github/workflows/
    ├── test.yml                    push/PR → tests → generated-file drift check
    └── release.yml                 tag-push → tests → zip → GitHub release
```

## Two icon directories, and why

`icons/` is **source**; `Resources/icons/` is **output**. Nothing in `icons/`
ships — `tools/package-extension.sh` does `cd Resources` before it zips, so the
extension is exactly the contents of `Resources/` and nothing else.

```
icons/icon-original.png     master artwork          }  source, never shipped
icons/icon-48.png           hand-drawn override     }
        │
        │  tools/render-icons.sh
        ▼
Resources/icons/icon-*.png  the seven manifest sizes    shipped
```

The output is **committed**, not built on demand, for the same reason
`onix-codelists.js` and the content models are: *Load unpacked* points Chrome
straight at `Resources/`, so that directory has to be complete and working on a
fresh clone with no build step. Committed build output is the price of that.

The confusing part is not the two directories but that the files share names:
`icons/icon-48.png` (hand-drawn source) and `Resources/icons/icon-48.png`
(output, in this case a verbatim copy of it) are different roles with the same
name. If that bites, rename the overrides — `render-icons.sh` looks for
`icons/icon-<size>.png` in exactly one place.

The toolbar mark deliberately has **no file of its own**: it loads
`Resources/icons/icon-48.png`, the app icon's 48px size, rather than a
`logo-48.png` copy that would need keeping in step.

## Architecture: why we replace the document

The browser's native XML viewer renders raw `application/xml` pages with an internal DOM that's largely opaque to extension content scripts. Trying to restyle it doesn't reliably work — selectors don't match, CSS injection lands on a Shadow-DOM-like structure, and there's no documented way in.

The pattern is:

1. Content script runs at `document_start`.
2. Check `document.contentType` against the MIME whitelist (`application/xml`, `text/xml`, `application/onix+xml`).
3. Re-fetch the source URL with `fetch(document.location.href, { credentials: "same-origin" })`. Reading `document.body.innerText` from the rendered viewer is unreliable.
3a. **ONIX sniff** the first 2 KB of the source for the EDItEUR namespace URI or an `<ONIXMessage>` root. If it's XML but not ONIX, abort — the user gets the browser's native XML view.
4. Build a fresh HTML shell via `DOMParser` — the markup comes from `shell.js`, a second content script loaded ahead of `content.js` so the two share one isolated-world global — then `document.replaceChild(newRoot, document.documentElement)` to swap roots. The test harness builds its jsdom window from the same template, which is the point of it being a module: a renamed id or a new toolbar button fails in the suite, where a hand-written copy used to drift.
5. Stash the source in an inert `<script type="application/xml" id="__oxv-source__">` data block (NOT an inline JS script — file:// pages and many sites have a `script-src` CSP that blocks inline execution; a non-JS script type is just a queryable text holder, which CSP leaves alone), then append `onix-codelists.js`, the validation content model for the document's release (see below), `onix.js`, `onix-validate.js`, `onix-popup.js`, and `viewer.js` as `<script>` elements with `async = false` to preserve order.
6. Those scripts parse the original XML with `DOMParser` and render to plain DOM.

When the re-fetch fails (file:// URLs are origin "null" and CORS-blocked; one-shot signed URLs reject the second request; bearer-auth endpoints lose their headers), we fall back to `XMLSerializer().serializeToString(document)` — the browser has already parsed the XML for us, so reading the live document is a reliable second path. This means file:// works without any background script, at the cost of waiting for `DOMContentLoaded` before takeover instead of acting at `document_start`.

**blob: URLs** are supported via `manifest.json`'s `content_scripts.match_origin_as_fallback: true` (Chrome 119+, which is why the manifest declares `minimum_chrome_version: "119"`). Chrome resolves a blob URL's origin to the page that created it and matches that against `<all_urls>`.

Things that still won't work:
- **Streaming huge XML**: we hold the full source in memory. Anything > ~10 MB causes a noticeable parse hang.

### The renderer walks with an explicit stack

`renderTree()` in `viewer.js` drives a stack of `{node, parent, depth}` tasks
rather than recursing, for the same reason `stepPass` does in the validator:
one JS frame per nesting level put the whole render at the mercy of the
engine's stack limit. When it blew — measured at 2,000 levels of nesting — the
throw escaped mid-render and **everything after it never ran**: the meta pill,
validation, the search and click handlers. What was left was a tree truncated
at 1,681 of 4,002 rows that looked like a complete document. Depth now costs
an array entry.

Tasks pop LIFO, so `pushChildren()` pushes in reverse to come out in document
order, and an element's close row is pushed *before* its children so it lands
after them. The conversion was verified by diffing the rendered
`#oxv-root` HTML for every fixture and both `Onix/` samples: byte-identical.

**Do not switch to `document.open()` + `document.write()`.** Per the HTML spec, `document.open()` throws `InvalidStateError` on a non-HTML document, and a raw XML page in WebKit is exactly that. Chromium has been lenient historically and let it through, which makes it a tempting "simpler" alternative — but it's a footgun if the extension is ever ported back to Safari/Firefox, and the current DOM-replacement path costs nothing extra.

**Scripts and DOMParser.** When DOMParser parses HTML, any `<script>` it produces has the spec's "already started" flag set — those scripts will *not* execute when inserted into a live document. That's why we don't embed the script tags in the parsed shell; we create them dynamically afterward.

**XHTML namespace gotcha.** Even after we replace `documentElement`, `document.contentType` remains `application/xml`. In an XML document, plain `document.createElement(tagName)` creates an element in the *null* namespace — not an HTMLElement, so it has no `.style`, no `.dataset`, etc. content.js uses `createElementNS(XHTML, "script")` for the script tags it injects, and `viewer.js` monkey-patches `document.createElement` at the top of its IIFE so every subsequent call produces real HTMLElements with no per-callsite ceremony. The HTML elements that come back from `DOMParser` are already in the XHTML namespace, which is why the toolbar etc. render correctly without special handling.

## ONIX detection logic

Lives in `Resources/onix.js`. The detector returns `{ isOnix, dialect, version, messageType }` for the parsed `Document`. `messageType` is `"product"` for a normal product-information message, or `"acknowledgement"` for an Acknowledgement message (see below).

Signals checked, in order:
1. **Namespace URI** on the root element (`http://ns.editeur.org/onix/3.0/reference`, `.../3.1/reference`, `.../short`, etc.). Canonical ONIX 3.x signal. The Acknowledgement namespace inserts an extra segment — `http://ns.editeur.org/onix/acknowledgement/3.0/{reference,short}` — which the parser strips before reading version/dialect, setting `messageType` accordingly.
2. **Root local name** (`ONIXMessage` / `ONIXmessage`) when no namespace is set. The two spellings are the two *dialects*, not two versions: the reference schema declares `<ONIXMessage>` and the short-tag schema declares `<ONIXmessage>` (lower-case "message") — the one short tag that isn't all lower case — in 3.0 and 3.1 alike, so the root's spelling gives the dialect exactly. The version has to come from the `release` attribute; absent that we assume 2.1, which is where omitting the namespace was common. `ONIXMessageAcknowledgement` is matched here too for the rare no-namespace Acknowledgement file.
3. **Bare `<Product>` root** when no namespace is set — a standalone Product record exported without an `<ONIXMessage>` envelope. `<Product>` alone is too generic to trust, so it's only accepted when it carries a corroborating ONIX-specific child (`RecordReference`, `NotificationType`, `RecordSourceType`, `ProductIdentifier`, `DescriptiveDetail`, or short tags `a001`/`a002`) — see `hasOnixProductChild`. The dialect is inferred from element-name casing (`inferProductDialect`) since there's no `/short` namespace marker, and the version is left `null` (the meta pill then reads `ONIX (N products)` with no version). `content.js`'s `looksLikeOnix` sniff mirrors this with a `<Product>` + corroborating-element check so the takeover fires in the first place.
4. The **`release` attribute** on the root if version isn't already known.

Reference vs. short tag matters because:
- Reference dialect uses `<ProductIdentifier>`, `<ProductIDType>`, etc.
- Short dialect uses `<ONIXmessage>`, `<productidentifier>`, `<b221>`, etc. Composites are the lower-cased reference name; data elements are opaque codes.
- The codelist resolver handles both via `SHORT_TO_REFERENCE` in `onix.js`, which is **generated** from EDItEUR's short-tag schema (see below) — all 530 pairs, so every code-list-bound element resolves a label in short dialect. It was previously a hand-kept subset of ~30 tags, which left 145 of the 157 bound elements showing bare codes.

## Acknowledgement message support

The ONIX **Acknowledgement** message (EDItEUR's optional response format, root `<ONIXMessageAcknowledgement>`, `release="3.0"`) is detected, taken over, and rendered like any other ONIX document. Its body is almost entirely status codes, so codelist resolution is the point — but its elements (`MessageStatus`, `RecordStatus`, `StatusDetailType`, …) live in a separate schema, not the Book Product schema that `tools/generate-codelists.js` derives element→list bindings from. The needed code lists (221–226) *are* already in the bundled data; only the bindings are missing.

Rather than feed a second schema to the generator, `onix.js` declares those bindings by hand in `ACK_CODELIST_ELEMENTS` (reference name, short tag, list number) and `registerAcknowledgementBindings()` folds them into the global lookup tables (`OnixViewerCodeLists`, `OnixViewerCodeListMeta`, `SHORT_TO_REFERENCE`) at load time — so `resolveCodelist`, `codelistMeta`, and the popup all work for them with no special-casing downstream. This sits alongside the other hand-maintained ONIX maps (`SHORT_TO_REFERENCE`, `ATTR_CODELISTS`) and keeps the generated `onix-codelists.js` untouched. To add more Acknowledgement code-list elements, extend that one array.

The viewer labels these documents `ONIX Acknowledgement 3.0 (N records)` in the toolbar meta pill — "records" rather than "products", since the `<Product>` blocks here are record statuses, not product descriptions.

## The toolbar's right-hand side

`#oxv-toolbar` is a three-column grid (`auto 1fr auto`) over `.px-left`,
`.px-center` and `.px-right`:

```
[ 🦉  ⌄⌄ Expand   ⌃⌃ Collapse   ↵ Soft wrap   View as…   ⧉ Copy XML   🔍 ]
        [📄 ONIX 3.1 (1 product) · Blocks: 1, 2, 4, 5, 6 · 17.9 KB]  [✓ Valid]
                                                    … [ONIX 3.1, Issue 74]
```

- **`.px-center`** holds the **document pill** (`#oxv-meta`) and the
  **validation state** (`#oxv-validation`), `justify-content: flex-start` so
  they hug the controls. The pill describes what you are looking at, so it
  reads as part of that group rather than as something stranded at the far
  edge.
- **`.px-left`** opens with the **brand mark** (`#oxv-logo`), then the
  controls. A raw XML URL gives no other clue which extension took the page
  over. It is the app icon's own 48px size — `Resources/icons/icon-48.png`, listed in
  `web_accessible_resources` because the toolbar lives in the *page's* world,
  and displayed at 28px, which is exactly the toolbar's content height —
  measured, 30px grows the bar from 45.6px to 47px. While the artwork was opaque
  this had to be 24px plus a 2px chip hiding the baked background; a transparent
  asset removed both.

  A page with a restrictive **`img-src` CSP** can refuse a
  `chrome-extension://` image even though the stylesheet loaded — they are
  separate directives — so `setupToolbar()` removes the mark on `error` rather
  than leave a broken-image glyph.

- **`.px-left`** is a **flex row** (`align-items: center`), not a line of
  inline boxes. This matters once a button carries an icon: an `inline-flex`
  button takes its baseline from its first flex item, so `Expand`, `Collapse`
  and `Copy XML` aligned on their icon's bottom edge while `Soft wrap` and the
  dialect switch aligned on their text. Measured in Chrome, that spread the
  row over three midlines 4.3px apart. As flex items they are aligned by the
  container and the baseline never enters into it — every control now shares
  one midline. `align-self: stretch` on the dialect and search groups keeps
  their divider spanning the full button height.
- **`.px-right`** holds the **code-list issue** (`#oxv-schema`) alone. It is
  reference material — which EDItEUR issue the labels came from, not a fact
  about this document — so it sits apart, pushed to the edge by the centre
  column.

**What gives way on a narrow window**, in order: the document pill's label
ellipsises, then the search field shortens, then the pill is dropped
altogether. `#oxv-validation` and `#oxv-schema` are `flex-shrink: 0` and never
give way — the size and release are recoverable from the file and the tree,
`103 errors` is not. Three things are needed to make that happen:

- `grid-template-columns: auto minmax(0, 1fr) auto`. A bare `1fr` track will
  not shrink below its content's min-content width, which let the centre
  column push into the right one.
- `min-width: 0` on `#oxv-meta` and `.px-search-group`. A flex item's default
  `min-width: auto` is its content size, so neither would shrink either.
- Two breakpoints dropping the pill — `max-width: 1100px` while the search
  field is open (it costs 320px of the same row), `max-width: 760px`
  regardless. Without them the verdict, being last in the group, is what gets
  clipped.

Measured in Chrome at 1912→700px with every block listed and a 4.8 MB feed:
no toolbar overflow at any width, and the issue pill never covered.

The document pill is one bordered unit built by `fillMetaPill()`: a file icon,
then `·`-separated segments — what the document is, which blocks it carries,
how big it is. Two details:

- **The block list is a segment, not a pill.** `#oxv-block-list` is still its
  own element (so it keeps its id and its `:empty` rule) but inside
  `#oxv-meta`, styled `display: inline` with no border of its own. It says
  something about this document rather than about the viewer, so it belongs in
  the same sentence. When there is nothing to list — any document without
  exactly one `<Product>` — it stays in the DOM, empty and hidden, and no
  separator is emitted for it.
- **The segments go in an inline wrapper** (`.px-meta-label`), not straight
  into the pill. `#oxv-meta` is a flex row, and flex makes an anonymous item of
  every bare text node, so the `gap` that spaces the icon would have stretched
  every `·` as well.

For a non-ONIX document the pill claims only the size — there is no version,
count or dialect to state.

## Stepped expand and collapse

Two buttons, `Expand` (`e`) and `Collapse` (`c`, or `b`), each working **one
level per press**. They replaced three all-or-nothing buttons (Expand all,
Collapse all, Collapse blocks).

Neither counts clicks. Each press reads the tree and decides from what is
actually folded, so there is no counter to drift out of step with the display
and both still behave sensibly after the reader folds rows by hand.

**`expandStep()`** unfolds every folded row at the *shallowest* depth that
still has one. (The shallowest folded row is always visible — if an ancestor
were folded it would be shallower — so this needs no visibility check.)

**`collapseStep()`** follows the shape of a message for its first two steps,
because that is how the document is read, and falls back to depth after that:

1. `isOutlineRow()` — everything directly inside a `<Product>` (the seven
   blocks plus the block-0 composites `ProductIdentifier`,
   `RecordSourceIdentifier`, `Barcode`) **plus** the message's own children
   other than `<Product>`, i.e. `<Header>`. Each record now reads as one line
   per composite.
2. The `<Product>` rows. The message now reads as one line per top-level
   element.
3. `foldDeepestVisibleLevel()` — the deepest level still on screen, which by
   now is the root.

Non-ONIX XML has no such shape, so it uses step 3 throughout and zips up from
the leaves: the exact mirror of Expand. Both rules in step 1 key on the
**parent**, not on a list of names, so they cover both dialects and need no
upkeep as ONIX gains elements (`BLOCK_NUMBERS` stays behind to drive the
`Block N` badge only).

Two details that took a second pass to get right:

- **Only step 1 reveals as it folds.** `foldRows(rows, { reveal: true })`
  unfolds each row's ancestors first, which is what makes step 1 read as "one
  line per composite" on a feed whose Products are auto-collapsed. Doing it in
  the later steps reopened what the previous press had just folded — press 3
  visibly *expanded* the header and the products again.
- **Step 3 only considers visible rows** (`isRowVisible()`). Without that,
  after step 2 the deepest unfolded rows are ones buried inside a folded
  `<Header>` or `<Product>`, so several presses in a row appear to do nothing
  before the root finally folds.

## Collapsed-row summaries

`nodeSummary(element, ctx)` in `onix.js` builds the one-line chip shown on a collapsed row. `viewer.js` calls it for every open row and renders whatever comes back, so which composites get a chip is decided entirely in `onix.js`.

Three kinds of answer:

1. **Identifier composites** — `ProductIdentifier`, `RecordSourceIdentifier`, `NameIdentifier`, `SupplierIdentifier`, … all share one shape (a `<*IDType>` naming a code list plus an `<IDValue>`), so `identifierSummary` handles the whole family by rule rather than by table: resolve the type through its own list, then append the value. A new identifier composite needs no code. Proprietary schemes (`01`) prefer `<IDTypeName>` over the list label, since "Proprietary product ID scheme 1234" says nothing.
2. **A short table** (`SUMMARIZERS`) for composites whose essence is one value: `Product` (below), `TitleDetail` / `TitleElement` (the quoted title), `Contributor` (role + name), `Price` (amount + currency).
3. **Nothing**, for everything else — including the seven ONIX blocks, deliberately: their contents are too heterogeneous to sample in one line, and the `<Product>` row above already carries the identifier, form and title. They have the `Block N` badge instead.

Rules are written against **reference** names; `referenceName()` maps short tags through `SHORT_TO_REFERENCE` first, so each rule is written once and works in both dialects. `SUMMARIZERS` is additionally keyed on the *lower-cased* reference name, so a short-tag composite (which is just the lower-cased reference name) dispatches without depending on that map at all.

Chips are capped at `SUMMARY_MAX` (60 chars) by `clampSummary`. The `<Product>` chip is the exception — it caps its title instead, because capping that whole chip at 60 would truncate summaries that render fine today.

### The `<Product>` chip

`productSummary(productEl)` builds:

```
[IDLabel] [IDValue] · [ProductForm label] · "[Distinctive title]"
```

Rules:

- **Identifier preference**: `15` (ISBN-13) → `03` (GTIN-13) → `02` (ISBN-10) → omit. Labels follow the picked type: `ISBN` for 15/02, `GTIN` for 03. Anything else (proprietary `01`, DOI `06`, …) is **not** used — the segment is dropped rather than mislabelling a proprietary ID as "ISBN".
- **Form**: read as a direct child of `<DescriptiveDetail>`, resolved through the bundled `ProductForm` list (e.g. `BB → Hardback`).
- **Title**: prefers the `<TitleDetail>` with `<TitleType>01</TitleType>` (Distinctive title), falling back to the first `<TitleDetail>`. Within the chosen `<TitleElement>`, `titleOfElement` reads `<TitleText>` (`b203`) if present, otherwise reassembles the split form `<TitlePrefix>` + `<TitleWithoutPrefix>` (`b030` / `b031`) — both forms are conformant and the split one is common in Nordic feeds. Truncated to 57 chars + ellipsis.

Lookups intentionally restrict to direct children of the right composite. A free DFS would happily pick the title or ISBN of a `<RelatedProduct>` inside `<RelatedMaterial>`, which is exactly the bug the older implementation had.

## Dialect switch (reference names ↔ short tags)

EDItEUR's own terms, from the schema headers ("REFERENCE TAG VERSION" /
"SHORT TAG VERSION") and the `refname` / `shortname` attributes every element
declares: **reference names** and **short tags**.

One toolbar switch, shortcut `t`. Its label is written by `viewer.js` — which
knows the document's dialect — and names the *translation*, never the current
state: **View as reference names** over a short-tag file, **View as short
tags** over a reference file. The label doesn't flip when pressed, so the
document's own dialect is always the unpressed state and the reader can't lose
track of what they opened. `aria-pressed` means "you are looking at the
translation". The toolbar's document pill — led by a file icon — names the source dialect
only when it is the short one (`ONIX 3.1 short tags (1 product)`; reference
names are the norm and go unsaid). It describes the file, so it doesn't change
when the view does. See *The toolbar's right-hand side* below.

`translatedName(nodeName, targetDialect)` in `onix.js` does the lookup, in both
directions. Short → reference reads `SHORT_TO_REFERENCE`; reference → short
reads `REFERENCE_TO_SHORT`, a reverse index built **only** from the generated
map, never from `EXTRA_SHORT_TAGS` — those point several keys at one reference
name (`b005` and `b253` are both `LanguageRole`), which would make the reverse
ambiguous. The generated map is one-to-one, so the reverse is exact. Reverse
lookups go through `SHORT_SPELLINGS` to restore `<ONIXmessage>`, the one short
tag that isn't all lower case (generated keys are lower-cased for lookup).

Switching **rewrites the names in place, never re-renders**, so fold state,
search matches and the active row all survive. Two things keep it cheap on a
large feed, both of which matter at ~700k tag spans:

1. **The tree is built in the displayed dialect.** `preferredDialect()` reads
   the stored preference *before* `renderNode()`, and `displayedTagName()`
   translates as each tag is written. A reader whose preference differs from
   the document pays no rewrite at load — earlier this rendered the source
   dialect and then immediately rewrote every span.
2. **Nothing is stored per span.** `applyDialect()` re-derives each name from
   the one on screen via `translatedName()`, finding them by the
   `px-tag-name` class. There is no counterpart attribute — which would be
   one extra DOM attribute per tag span — and because `translatedName()`
   returns null for a name already in the target dialect, repeating a switch
   is harmless.

Names with no translation (unknown or extension elements — including the XHTML
`<p>`/`<em>` inside `textformat="05"` content) are left as they are. The
`px-onix-short` / `px-onix-ref` classes follow the displayed dialect, so
translated names don't keep the other dialect's italics.

The choice persists in `localStorage` under `oxv-dialect`; the switch is
hidden (`body.px-no-dialect-toggle`) for non-ONIX documents and for ONIX with
no detected dialect, where there is nothing to translate between.

### Copying follows the display

Both copy paths hand over what's on screen, so the viewer is WYSIWYG: while
translated, **Copy XML** yields the converted document and **Copy node XML**
the converted subtree. At the source dialect, `displayedXml()` returns
`SOURCE` byte for byte — the copy is the file itself, unchanged.

Conversion is `translateNode(node, targetDialect)` in `onix.js`, a detached
deep clone in which every element in the document's ONIX namespace is renamed
and moved to the target dialect's namespace. The namespace matters: element
names alone would leave `<ProductIdentifier>` sitting in a `/short`
namespace, which is not valid ONIX. Whitespace, comments, CDATA and PIs are
cloned verbatim, so the converted copy keeps the source's own indentation;
the XML declaration isn't a DOM node, so `displayedXml()` carries it over
from the source text.

Two things deliberately don't move: elements in a foreign namespace, and
elements with no known translation. That's what leaves the inline XHTML in
`textformat="05"` content (`<p>`, `<em>`) alone — it inherits the ONIX
default namespace but isn't ONIX. `xmlns` attributes are never copied from the
source (they would declare the dialect just translated away from); the
serialiser re-emits one from the clone's own namespace, and
`stripSynthesizedNamespace` still removes it unless the *source* element
declared it, so a copied `<Product>` gains no declaration its siblings lack.

The conversion is verified against `Onix/onix-3.1-{refnames,shorttags}.xml` —
the same record supplied in both dialects, so converting either one must
reproduce the other's element names exactly, in both directions.

## Validation

Validation runs **automatically on load**, and checks the document against a
**compiled content model**. There is no XML Schema processor involved: the
browser has none, and libxml2-via-WASM would add ~4 MB and needs
`'wasm-unsafe-eval'`, which the viewer can't count on — its scripts run in the
page's world under the page's CSP. Instead `tools/generate-content-model.js`
compiles the structure XSD into `Resources/onix-content-model.js` (511
elements in 3.1, 512 in 3.0, ~66 KB) and `Resources/onix-validate.js`
interprets it.

That works because the ONIX schema is unusually regular: there is no `xs:any`,
no substitution group, no `xs:all`, no `nillable`, no `abstract`, no
`xsi:type`, no `xs:redefine`, and **no compound particle repeats** — so every
sequence and choice is matched at most once and the matcher needs no
backtracking. Element occurrence is nearly always `minOccurs="0"` /
`maxOccurs="unbounded"`, with exactly one exception in either release —
`<OrderQuantityMinimum maxOccurs="2">` — so the matcher enforces a finite
bound rather than assuming there is none (there is a test for that third
occurrence; it is the only thing keeping the check honest). XSD's Unique Particle Attribution rule makes the alternatives of
a choice disjoint, so one-token lookahead is exact. The generator throws if a
future schema breaks the no-repeating-compounds assumption rather than emit a
model the matcher would quietly mis-match.

### Which releases are covered

There are exactly two ONIX releases since 3.0 — **3.0** and **3.1** — and both
are bundled. There is nothing finer to support: a message declares
`release="3.0"` or `release="3.1"` and nothing else, because each schema
restricts that attribute to its own single value. The revisions (3.0.1 … 3.0.8,
3.1.1 … 3.1.3) are **not declarable in a document**, so a file cannot say which
revision it targets.

That makes validating against the newest revision of each release the only
option, and a safe one, because ONIX evolves additively: the 3.0 schema still
carries all 129 elements introduced across revisions 3.0.1–3.0.8, and elements
that fall out of favour are marked deprecated rather than removed (20 such in
3.0, 11 in 3.1). The newest revision is therefore a superset of every earlier
one — a document written for 3.0.2 validates against revision 8, which merely
permits more than 3.0.2 did.

**A standalone `<Product>` root is validated in full**, both dialects, message
envelope or not — `<Product>` is in the model like any other element, so the
structural rules check its own required children as well as everything below
it. The release comes from the namespace, there being no `release` attribute
outside an `<ONIXMessage>`.

The one document that can't be checked structurally is a `<Product>` root with
**no namespace either** (an export with both markers stripped): nothing says
which release it targets, so there is no model to pick. It reports
`model.missing` and has its code lists checked, which are release-independent.

**Acknowledgement messages are exempt.** `<MessageStatus>`, `<RecordStatus>`
and the rest live in a separate schema that isn't bundled, so a
`messageType === "acknowledgement"` document skips the structural rules and
reports `model.acknowledgement`. Its code lists are still checked, which is the
point of Acknowledgement support. Without this it reported every element as
unknown.

The **short-tag map merges both releases' short schemas** (530 pairs). It has
to: 3.0 keeps nineteen tags 3.1 dropped — `Conference*`, `Reissue*`, `Gender`,
`AudienceCode`, `CurrencyZone`, `DateFormat`, `PromotionContact` — and 3.1 adds
eighteen of its own. (`EpubLicense` was listed here as 3.0-only until 0.9.17,
which was a symptom of the named-complexType gap rather than a fact about the
schemas: it is in both releases.)
No short tag means different things in the two releases, so the union is
unambiguous; where they overlap the newer file wins.

### Which schema, and how to bump it

The structure XSDs come from EDItEUR's per-issue bundles, one per release
(and the strict schema from the *Advanced* bundle, needed only when the
second-order assertions change):
`https://www.editeur.org/files/ONIX%203/ONIX_BookProduct_3.{0,1}_XSDs+codes_Issue_<N>.zip`.
Take `ONIX_BookProduct_3.x_{reference,short}.xsd` from each into
`tools/data/`, then re-run the generators:

```bash
node tools/generate-codelists.js                     # code lists + merged short-tag map
node tools/generate-content-model.js --version=3.1
node tools/generate-content-model.js --version=3.0
```

`--version` picks the input (`ONIX_BookProduct_<version>_reference.xsd`) and
names the output (`onix-content-model-<version>.js`). The bundle's other two files
(`ONIX_BookProduct_CodeLists.xsd`, `ONIX_XHTML_Subset.xsd`) are deliberately
not committed: code lists come from the JSON instead, and XHTML content is
opaque to the validator.

A revision bump does **not** change the model registry key. The namespace stays
`…/onix/3.1/reference` and the schema still restricts `release` to exactly
`"3.1"`, so 3.1.1, 3.1.2 and 3.1.3 are all "3.1" as far as detection and the
registry are concerned — a document cannot declare `release="3.1.3"`.

We compile the **classic** XSD, not the `strict` variant.

That does *not* cost the multilingual rules, which is what an earlier version of
this note claimed. The classic schema carries them as identity constraints — 79
on `@language` alone and 15 on the `(@language, @textscript)` pair — and they are
enforced (see *Identity constraints* below). What it does mean is that
`xs:unique`'s own rule applies: a node whose key is incomplete is outside the
constraint. So two `<Text language="eng">` with no `textscript` are legal,
because `<Text>`'s key is the pair; give both the same `textscript` too and it is
reported. Two `<SourceTitle language="eng">`, whose key is `@language` alone, are
reported immediately.

### The `strict` (Advanced) schema — what it adds, and why we don't compile it

EDItEUR ships a second schema per release alongside the classic one:
`ONIX_BookProduct_3.1_reference_strict.xsd`, distributed as *ONIX for Books
3.1.3 Advanced XSD Schema + Codelists Issue 74*. It is **XSD 1.1**, and it uses
`xs:assert` — plus embedded Schematron for deprecation warnings — to express
**over 500 rules** the 1.0 language simply cannot state. It began as an
experiment in 2018 for 3.0.4 but is now maintained in step with the main
schema.

An earlier version of this note claimed strict "adds nothing we lack". **That
was wrong.** What is true is narrower: strict adds almost no *identity
constraints* we don't already enforce — `<RecordReference>` uniqueness,
`<EditionType>`, `<ProductContentType>`/`<PrimaryContentType>`,
`<PublishingDate>` roles and the multilingual `@language` rules are all in the
classic schema and all enforced here. Nearly everything else strict checks is a
**co-occurrence, arithmetic or cross-field rule**, which is a different kind of
thing entirely:

| Strict rule | Us |
|---|---|
| `<RecordReference>` unique; `<EditionType>`, content-type and date-role uniqueness; multilingual `@language` | enforced, from the classic schema's `xs:unique` |
| ISBN-13, GTIN-13, ISBN-10 check digits | enforced by the `gtin` rule |
| Check digits for UPC, ISNI, GLN, SAN, ORCID, ISMN-13; DOI plausibility; an ISBN-10 requiring the matching ISBN-13 | not checked |
| Proprietary `<*IDType>` requiring `<IDTypeName>` | not checked |
| Second-order code lists — `<ProductFormFeatureValue>` under type 09 is List 196, `<AudienceCodeValue>` under type 01 is List 28, … | enforced, from a table generated out of strict's own assertions — see *Second-order code lists* below |
| Subject-scheme patterns (Thema, BIC, BISAC, CLIL) | not checked |
| Tax arithmetic — `<PriceAmount>` = `<TaxableAmount>` + `<TaxAmount>`, `<Tax>` only on tax-inclusive prices | not checked |
| Contributor `<SequenceNumber>` present for every contributor and consecutive from 1 | not checked |
| `<SalesRightsType>` 00 forbidden; `<ROWSalesRightsType>` required when applicable | not checked |
| Duplicate countries/regions inside one `<CountriesIncluded>` value; WORLD excluding all other regions | not checked (we check each member is a valid code, not that the set is sane) |
| `<BarcodeType>` 'not barcoded' ⟺ `<PositionOnProduct>` omitted | not checked |
| Dates matching their `dateformat`, start ≤ end, no date before 1000 CE | not checked |
| `<Extent>` unique on (`<ExtentType>`, `<ExtentUnit>`) | not checked — one of the few identity constraints strict adds |
| Leading/trailing whitespace in plain-text fields | not checked |

**We don't compile it, and shouldn't.** `xs:assert` bodies are XPath 2.0
expressions; interpreting them needs an XPath 2.0 engine, which is a far bigger
thing than the content-model compiler, and it would land in the page's world
under the page's CSP like everything else. Strict also carries copies of the
second-order code lists inline, so it needs re-bundling per issue.

The right home for these is **`registerRule`** — that seam exists precisely for
rules no schema expresses, and each of the rows above is a few lines of
JavaScript over a DOM we already have. Strict is best read as a *specification
of the rule catalogue to implement*, not as an input to compile. Nothing about
the classic model needs to change to add them.

### Why the XSD and not the RNG (or the DTD)

EDItEUR publishes the same release three ways — *ONIX for Books 3.1.3 XSD /
RNG Schema + Codelists Issue 74*, with a DTD for 3.0 only — and **recommends
XSD or RNG equally**; the DTD is legacy and discontinued for 3.1. So the choice
of input is ours, and it matters, because the three do not carry the same rules.

RELAX NG is *more* expressive than XSD 1.0 about **structure**: it has no
Unique Particle Attribution rule, no Element Declarations Consistent
restriction, and it has `interleave`. An element may have different content in
different contexts, stated directly — which is precisely the `<EpubLicense>`
case that forced EDItEUR's XSD into two named `complexType`s and forced our
`in` variants. Read as a grammar, the RNG is the nicer document.

But it expresses **strictly less of what we validate**, and the gap is not a
detail of EDItEUR's authoring — it is definitional:

| | XSD 1.0 (classic) | RNG |
|---|---|---|
| Content model | yes | yes, and unrestricted |
| Code lists | yes | yes (bundled the same way) |
| Datatypes | built in | delegated to the XSD datatype library |
| **Identity constraints** | **142 in 3.1, 85 in 3.0** | **none — RELAX NG has no `xs:unique` equivalent at all** |
| **Element defaults** | `default="C"` on 3 declarations | **none** — RELAX NG does no infoset augmentation (DTD-compatibility annotations cover *attribute* defaults only) |
| Assertions | none (see `strict`) | none |

RELAX NG's lack of identity constraints is a deliberate design decision, not an
omission: James Clark's *The Design of RELAX NG* argues grammar processing and
identity processing are better separated, tree automata being mature where
identity constraints were then still a research area. ISO DSDL accordingly puts
uniqueness elsewhere — which is why RELAX NG is conventionally paired with
Schematron.

For us that settles it. Generating from the RNG would cost all 227 identity
constraints across the two releases and the three element defaults, to gain
expressiveness for one element we have already handled. **The XSD is a superset
of the RNG in every dimension we check.** There is nothing to gain by reading
both, and the codelist data comes from the JSON regardless.

### Model encoding

```
["e", name, min, max]   element; max 0 means unbounded
["s", min, ...parts]    sequence, matched at most once
["c", min, ...parts]    choice, matched at most once
```

Alongside `elements` and `datatypes`, each model carries **`attributes`**
(name → spec), **`attributeSets`** (the pooled name sets, indexed by each
element's `a`) and a **`deprecated`**
map — reference name → `{ since?, advice?, within? }` — compiled from the
XSD's annotations (see *Deprecated elements* below).

Leaves are `{list: N}` (code-list bound), `{text: "Type"}` (datatype),
`{empty: 1}` or `{flow: 1}`; identity constraints hang off the element as `u`,
and two more optional fields carry the awkward cases: **`d`** is the value XSD
supplies when the element is left empty, and **`in`** holds the content models
that apply only under a named parent (both below).
`flow` is the `mixed="true"` elements that
extend `Flow` from the XHTML subset schema — 28 in 3.1, 29 in 3.0 — `<Text>`,
`<BiographicalNote>`, … — whose content is markup rather than ONIX; the
validator never looks inside them.

### Elements declared by a named complexType

Almost every element carries an inline `xs:complexType`, so the declaration and
its content model are one node. **Five declarations in 3.1 name a type
instead** — and all five are `<EpubLicense>`. Compiling only inline types left
it out of the model altogether, so valid 3.1 reported `<EpubLicense>` as an
unknown element and **nothing inside it was checked at all**. 3.0 has no named
types, which is why the gap was release-specific.

Its content genuinely depends on where it sits, which nothing else in either
release needs:

| Parent | Type | Allows `<EpubLicenseDate>` |
|---|---|---|
| `<Price>` | `EpubLicenseType` | no |
| `<DescriptiveDetail>`, `<ContentItem>`, `<ResourceVersion>`, `<TextContent>` | `EpubLicenseWithDateType` | yes |

The commonest variant becomes the element's own shape and the exceptions hang
off it as **`in`**, keyed by parent reference name. `xs:extension` is resolved
by concatenating the base type's particles ahead of the extension's own, which
is what XSD means by it, and the attributes are the union along that chain.

Every rule therefore reaches an element's shape through **`api.shapeOf(node)`**
rather than indexing `model.elements` directly — that is the one place the
parent is consulted. A rule that indexes the table itself silently gets the
default variant.

### Elements with an XSD default

`<CopyrightType default="C">` means an empty `<CopyrightType/>` carries `"C"`,
so demanding a value there is a false positive. The model records it as `d` and
the structural rule skips its missing-value check when one is present. Three
declarations across the two releases carry a default — `CopyrightType` in both,
`ConferenceRole` in 3.0 — and none carries `fixed`.

Names in the model are **reference names only**. Short-tag documents are
validated by translating each name through the generated short-tag map first,
which halves the model and keeps one source of truth for the aliases. The two
dialects of one record therefore produce identical findings — there's a test
for exactly that, over the `Onix/` sample pair.

**Findings are worded in the document's own dialect.** A short-tag file says
`<b203>`, so a message naming `<TitleText>` would send the reader looking for a
tag their file doesn't contain. Names read straight off a node need no help —
`node.nodeName` is already the document's spelling — but the ones that come out
of the model do, so `api.displayName()` translates them, and
`api.displayPhrase()` does the same for element references embedded in prose
(EDItEUR's deprecation advice, "use either `<TitlePrefix>` or `<NoPrefix/>`
instead", becomes "use either `<b030>` or `<x501/>` instead"). Both are no-ops
in reference dialect.

This follows the source dialect, not the displayed one — like the toolbar's
document pill, a finding describes the file, so switching the view doesn't
reword it.

### The three extension points

1. **`MESSAGES`** — one template per finding code, with `{placeholder}`s
   filled from the finding's `data`. Reword or translate any entry without
   touching validation logic; the codes are the stable contract, not the prose.
2. **`RULES`** — an ordered registry. The runner walks the document **once**
   and offers every element to every rule (`start` / `element` / `finish`), so
   a new rule costs no extra traversal. Seven ship today: `structure`,
   `codelist`, `datatype`, `attribute`, `unique`, `deprecation` and `gtin`.
3. **`OnixViewerContentModels`** — keyed by ONIX release. **Both releases
   since 3.0 ship**: `onix-content-model-3.0.js` and
   `onix-content-model-3.1.js`, one generator run each, each assigning into
   the same registry.

   **Only the matching one is injected.** A message declares exactly one
   release, so `contentModelURLs()` in `content.js` reads it off the same 2 KB
   head that `looksLikeOnix()` sniffed — from the namespace or the `release`
   attribute — and sends that model alone. Loading both meant parsing 103 KB
   to use half of it.

   When the release isn't readable there (ONIX 2.1, or a standalone
   `<Product>` with no namespace) **both** are injected instead. No model can
   match those, but `model.missing` names what *is* bundled by listing the
   registry, so shipping one would make the warning under-report what exists.
   A document with no matching model skips the structural rules rather than
   being judged against the wrong schema — its code lists are still checked,
   since those are release-independent.

   The property this rests on is tested directly: every ONIX fixture must
   produce the same findings from its own model alone as it does from both.

Everything the schema expresses is now checked, so the seam is demonstrated with
a **house rule** instead — something no schema can express. The test registers
one (this publisher's ISBNs must sit in its own 978-82 prefix range), with its
own message template and its own severity, and asserts it fires without the walk
changing.

### Identity constraints (xs:unique)

**All of them are enforced**: 142 constraints in ONIX 3.1, 85 in 3.0 — the
generator throws rather than skip a shape it can't compile, and a test asserts
those exact counts. They are the rules no content model can state: "no two
`<Product>` with the same `<RecordReference>`", "no two `<Measure>` with the same
type and unit", "each repeat of `<Text>` needs a distinct language and script".

Compiled onto the host element as `u`, because the XPath shapes the schema uses
are narrow enough to compile rather than interpret:

```
selector   one or two steps of onix:Name, optionally a "|" union of paths
           (3 unions and 8 two-step paths in 3.1, all of them EpubLicense
           or Contributor-inside-Collection)
field      onix:Name (a child's text), @name (an attribute), or "." (the
           selected element's own text)
```

So `<ONIXMessage>` carries `[{ s: [["Product"]], f: [{ c: "RecordReference" }] }]`.
The rule resolves the selector against the host's own subtree once per
constraint — a DOM luxury a streaming port would have to replace with a
per-composite scratch frame.

**The semantics worth keeping**: a node whose key is incomplete — *any* field
absent — is outside the constraint, not a violation. Keys join their parts with
`\u0000`, which cannot occur in XML character data, so no two field values can
collide by concatenation. There's a test asserting no fixture and neither
`Onix/` sample gains a duplicate finding, which is what would catch a
mis-compiled selector.

### Deprecated elements

`deprecation` warns when a document uses an element EDItEUR has deprecated,
naming the release it happened at and the replacement it advises —
`<TitleText> is deprecated from release 3.1 — use either <TitlePrefix> or
<NoPrefix/>, plus <TitleWithoutPrefix> instead`. **7 elements in 3.1, 18 in
3.0**, compiled into the model's `deprecated` map from the XSD's own
annotations, so the wording tracks the schema rather than a hand-kept list.

Not every note saying "Deprecated" is about the element carrying it. Three
describe their *children* instead — `<Header>` (its `Default*` children),
`<TitleElement>` (`<TitleText>`) and `<SalesRestriction>` (P.21.11–21.18
clauses) — and the first two appear in nearly every ONIX file, so treating
them as deprecated buries a valid document in false warnings. The generator's
discriminator: "Deprecated" followed immediately by an element reference or a
P.x clause number is about something else; anything else is about the element
itself. There's a test asserting those three stay unflagged.

One deprecation is context-sensitive: `<TextSourceDescription>` is deprecated
within `<TextContent>` but not within `<TextSource>`, so the model records
`within` and the rule checks the parent.

### Attributes

ONIX has exactly **ten** attributes — `datestamp`, `sourcename`, `sourcetype`,
`language`, `textscript`, `textformat`, `textcase`, `dateformat`,
`collationkey`, `release` — and they went unchecked until 0.9.17: a
`textformat="99"` sailed through while the same bad code in an element was
reported. The `attribute` rule closes that, checking code-list membership,
deprecated codes, datatypes, enumerations and the one required attribute.

Three things make it cheap:

- **Attribute names are identical in both dialects.** Only element names
  shorten, so nothing needs translating — verified against both short schemas.
- **The specs are global.** `language` is List 74 wherever it appears, so the
  generator emits one spec table and asserts that no name is ever declared two
  ways.
- **Only ten distinct attribute *sets* exist** across all 511 elements, and 401 of
  them share one. `attributeSets` pools the sets and each element stores an
  index. Spelling the names out per element cost 25 KB to say the same thing;
  pooled, the whole feature adds about 4 KB.

`refname` and `shortname` are handled by rule rather than by table. Every
element declares them, and the only legal value is that element's own name in
each dialect — which the short-tag map already knows. Recording 511 pairs of
single-value enumerations would have doubled the model to say nothing.

**Unqualified attributes are ours to judge**, and testing
`namespaceURI === null` excludes `xmlns` declarations, `xsi:schemaLocation` and
`xml:lang` in one go. But a prefix into ONIX's *own* namespace is a third case
that used to be skipped in silence: ONIX declares all ten attributes
unqualified — none is global, neither schema sets `attributeFormDefault` — so
`onix:language="zzz"` is not an ONIX attribute at all, and was neither judged
nor reported. It is now `attribute.qualified`. Any *other* namespace stays
tolerated: strictly the schema rejects those too, but that is where feeds put
their own annotations.

**An empty value is always a violation**, and was the one hole left in this
rule: it bailed on a falsy value before reaching any check, so `language=""`
and `datestamp=""` passed. None of the ten attributes has a legal empty value —
each is code-list bound (no enumeration includes `""`), an enumeration of its
own, or a datatype whose pattern demands a character. Whitespace-only counts as
empty because every enumerated type in ONIX restricts **`xs:token`**, whose
`whiteSpace: collapse` runs *before* validation — which is the same reason
`language=" eng "` has to stay valid, and why the rule trims before comparing.

Two fixes fell out of building this:

- **`dt.DateOrDateTime` was opaque.** The generator saw `xs:union` and gave up,
  so every `datestamp` *and* every date element went unchecked. That union has
  exactly one member type, which carries the five date patterns — a union of
  one is just that member, so `unwrapSingleMemberUnion()` now sees through it.
  Checked against every fixture and both `Onix/` samples: no new findings, so
  it was purely a missed check.
- **35 of the 165 code lists had no name to print.** `OnixViewerCodeListMeta`
  is keyed by element name, and those 35 are bound to attributes instead
  (`textcase`, `textformat`, `dateformat`, …), so a finding about one read
  "List 14 (List 14)". The generator now also emits
  `OnixViewerCodeListTitles`, keyed by number.

### Datatypes: facets *and* the base type

19 `dt.*` types are compiled, and the base type matters as much as the facets.
Four of them — `dt.Decimal`, `dt.Integer`, `dt.PositiveInteger`,
`dt.PositiveIntegerOrZero` — carry **no facets at all**, so recording only facets
left them entirely unchecked and `<EditionNumber>abc</EditionNumber>` passed.
`LEXICAL` in `onix-validate.js` now covers the five XSD built-ins ONIX restricts
(`decimal`, `int`, `integer`, `positiveInteger`, `nonNegativeInteger`), including
`xs:int`'s 32-bit range.

The two `xs:list` types (`dt.CountryCodeList`, `dt.RegionCodeList`) are
whitespace-separated codes that together define a territory. The generator
records what the list is *of* — `{list: 1, listOf: 91, minLength: 1}` — so
`<CountriesIncluded>NO XX DK</CountriesIncluded>` now names `XX` instead of
skipping the whole value.

### Second-order code lists

A handful of ONIX elements take their code from a list that a **sibling**
selects. `<ProductFormFeatureValue>` is a cover colour from List 98 when
`<ProductFormFeatureType>` is 01, an accessibility detail from List 196 when
it is 09, an EPUB version from List 220 when it is 15 — and free text or a
number under most other types. The classic XSD types these value elements as
plain strings, so the generated bindings cannot know them, and until this was
added every such value rendered bare and went unvalidated. Graham Bell of
EDItEUR pointed it out, and named the lists: 28, 66, 76, 77, 90, 91, 98, 99,
139, 143, 176, 178, 184, 196, 203, 204, 220, 227, 238, 242, 243, 256, 257,
258, 262 — all of which were already bundled, just unbound.

The mapping is **`window.OnixViewerDependentCodeLists`**, generated into
`onix-codelists.js` and read by `onix.js` as `DEPENDENT_CODELISTS`: keyed by
the value element's reference name, a list of selectors, each the selecting
sibling and a map from that sibling's code to a list number. Ten value
elements, forty-odd type codes. `tools/generate-codelists.js` **compiles it
from the `xs:assert` rules of the strict 3.1.3 schema**
(`tools/data/ONIX_BookProduct_3.1_reference_strict.xsd`), which spells each
one out — `(ProductFormFeatureType ne '09') or
matches(ProductFormFeatureValue, '^(00|01|…)$')` — and not from the codelist
JSON's prose notes, which cross-reference lists that are not dependencies at
all (seventeen Product content types merely *mention* List 196). The
generator reads three assertion shapes, skips the grade-*ordering* rules by
their `substring-before` alone, and throws on any other shape that names a
list, so a new kind of assertion cannot be dropped in silence. It takes the
list *number* from the assertion's comment and the codes from the bundled
JSON, not from the assertion's inline copy, so an issue bump does not need
the strict schema refreshed. CI regenerates and diffs it like the rest of the
file. Two readings worth recording:

- **Carbon/GHG types 41–46 all take List 262.** Strict carries two asserts
  for them, one over 41–46 and a newer one over 41–45, and both are live, so
  the union is what a document has to satisfy.
- **The EUDR types 47–49 are `leading`**: the value is a List 91 country code
  followed by an optional species and harvest date (`NO Picea abies 2024`),
  so only the first whitespace-separated token is the code — for the badge
  and for the verdict alike. `dependentCode()` does the split.

`<FeatureValue>` is the one value element with **two selectors**, since it
sits under both `<ResourceFeature>` and `<ResourceVersionFeature>`, whose
type elements are named differently. (Every entry is an array; that one has
two members.)

Three consumers share the table through `dependentCodelist(element)`, which
compares names as reference names so both dialects work:

- **The badge.** `codelistFor()` is the list an element is bound to, its own
  or a sibling's choice, whether or not the value is in it; `resolveCodelist()`
  is that plus the label, and null when the code is unknown. The viewer calls
  both: a resolved code gets the label badge and the list chip, an unknown one
  the **list chip alone**, so a row reporting `"NAVY" is not in List 98` also
  offers List 98 to open. That holds for an element's own list too —
  `<NotificationType>99</NotificationType>` gets a `List 1` chip. The result's `codelistKey` is **`list:196`** rather than
  an element name — no element is bound to the list — and `codelistMeta()`
  and `codelistEntries()` both understand that form, taking the title from
  `OnixViewerCodeListTitles`. The result also carries a `context`
  (`ProductFormFeatureValue when ProductFormFeatureType is 09`), built from
  the nodes' own names so a short-tag file reads `b335 when b334 is 09`.
- **The popup.** `show(key, value, context)` prints the context in the
  eyebrow where the element name would go.
- **The validator.** The `codelist` rule asks `codelistFor()` too, so the
  verdict and the chip can never disagree about which list applies; there is
  no second copy of the binding logic. A code outside a second-order list is
  **`codelist.dependent`** —
  `"XX" is not in List 196 (E-publication Accessibility Details), which
  applies when <ProductFormFeatureType> is 09` — a distinct code from
  `codelist.unknown` because the reader's file does not say why that list
  applies. A deprecated code is the ordinary `codelist.deprecated` warning.
  A type code the table does not map (07, system requirements) is judged by
  nothing, since the value is free text.

The table is guarded by a test that walks every row, asserts each element is
in the 3.1 model and has a short tag, each list is bundled, and that the
union of lists selected is exactly Graham's twenty-five. The strict schema is
an input to the codelist generator for this table **and nothing else**: its
500-odd other assertions are not compiled — see *The `strict` (Advanced)
schema* above for why. The short-tag strict schema sits beside it in
`tools/data/` for reference only.

### Identifier check digits

`gtin` checks ISBN-13 and GTIN-13 (`ProductIDType` 15 and 03, alternating
1/3 weights mod 10) and ISBN-10 (type 02, weights 10…2 mod 11, remainder 10
written `X`). The schema cannot see these — all three are just strings to it —
and a wrong check digit is a common real defect.

**It also owns the length**, which an earlier version of this note got wrong: it
claimed a wrong-length value was "left to the datatype rule". That rule cannot
see it. `<IDValue>` is typed `dt.NonEmptyString` — pattern `.*\S.*` — so the
schema constrains neither length nor alphabet, and there is no facet for
anything to catch. The result was that under `ProductIDType` 15 both
`978-82-345-6789-6` (hyphenated, which real feeds do send) and `97882345`
(truncated) passed in silence. `gtin.length` now reports them, and it reports
before the check digit, since a digit cannot be computed for a value of the
wrong shape.

Deliberately silent on two things: schemes with no check digit (proprietary
`01`, DOI `06`, …), and a lower-case `x` in an ISBN-10's check position — the
standard writes it upper case, but the schema constrains neither, and rejecting
it would fail feeds that are otherwise correct.

It found bad digits in 12 of the test fixtures on its first run, which is why
they now carry valid ones. `onix-3.1-invalid.xml` keeps its bad digit
deliberately — it's the defect catalogue.

### Nothing is skipped in silence

The generator refuses a schema it does not fully understand rather than emit a
model that is quietly short. Both releases use **exactly 27 XSD element kinds
and all 27 are compiled**; `KNOWN_CONSTRUCTS` asserts that, so `xs:any`,
`xs:all`, `xs:key`, a new facet — anything absent today — fails the build
instead of being ignored. `REFUSED_ATTRIBUTES` does the same for `fixed`,
`nillable`, `abstract`, `substitutionGroup` and `form`, none of which occurs in
either release. Alongside those, the generator throws on:

- a repeating compound particle (the matcher assumes none)
- an `xs:unique` selector or field shape it cannot compile
- an unresolved group, attributeGroup or complexType reference, or a cyclic extension
- a local element declaration carrying an inline complexType
- an attribute name declared two ways
- a facet on a `dt.*` type that it does not read
- **a datatype named by any element or attribute that it never compiled**

That last one is the check worth having: a shape naming an uncompiled datatype
is skipped by the datatype rule in complete silence — the element or attribute
simply goes unchecked. It is how ONIX 3.0's `sourcetype`, `textcase` and
`textformat` went unvalidated until 0.9.17, and the assertion now makes that
class of gap impossible to ship. A test guards the shipped files the same way.

Four things are genuinely not checked, for reasons no amount of code fixes:

| Not checked | Why |
|---|---|
| XHTML `Flow` content — 28 elements in 3.1, 29 in 3.0 | The XHTML subset schema isn't bundled, and the content is markup rather than ONIX |
| `<ReligiousTextIdentifier>`, bound to List 88 | EDItEUR publishes that list with no codes at all, so there is nothing to check a value against |
| The `strict` (Advanced) schema's 500+ assertions | XSD 1.1 `xs:assert` needs an XPath 2.0 engine to interpret. Its identity constraints we already have; its co-occurrence and arithmetic rules belong in `registerRule` — see *The `strict` (Advanced) schema* above for the rule-by-rule position |
| ONIX Specification prose | Rules no schema expresses — that is what `registerRule` is for |

Code-list *contents* come from the Issue 74 JSON rather than the bundle's
`ONIX_BookProduct_CodeLists.xsd`, which is deliberately not committed; the
element→list *bindings* come from the XSD. The two could in principle drift
apart at a future issue.

### Two subtleties worth keeping

**A choice can be satisfied by nothing.** `gp.authorship` is a *required*
choice whose second branch is `<xs:element minOccurs="0" ref="NoContributor"/>`
— an optional alternative, so supplying neither a contributor nor
`<NoContributor>` is legal. `nullable()` models this. Without it, EDItEUR's own
sample reports a false error.

**Character data in a composite is a violation.** No composite is
`mixed="true"` — that is exactly what `flow` marks, and flow returns before the
check — so text inside one breaks the schema. The matcher works from
`childElements`, so it never saw it and a stray fragment between two composites
passed in silence; `reportStrayText` closes that. Only a run containing a
non-space character counts, because indentation is text too. Each run is
reported on its own, with the text node as the finding's **`at`** — the
optional fourth argument to `api.report` — so the viewer pins the pill to the
row showing the text rather than to the composite's opening row, which for
text at the end of an `<ONIXMessage>` is the top of the document. `rowFor()`
in `viewer.js` prefers `at` and falls back to the element; text and CDATA rows
are registered in `elementRows` for that. The findings list still files the
entry under the element the rule is about.

**Unknown elements are skipped, not matched.** An element the model has never
heard of is reported once as `structure.unknown` and left out of its parent's
match. Without that recovery a single typo makes every following sibling "not
allowed at this position" — nine findings for four defects in the test fixture,
versus five with it.

### Icons

`icon(name)` in `viewer.js` builds a tiny inline SVG from the `ICONS` table,
declared at the top of the IIFE because the toolbar setup uses it before the
sections further down have been reached —
`error`, `warning`, `ok`, `spinner`, `search`, `file`, `close`, `expand`,
`collapse`, `wrap`, `copy` — on a shared `0 0 16 16` grid, stroked in `currentColor`
and sized to 12px by `.px-icon`, so one chip's colour carries its icon.
Toolbar buttons scale theirs to 14px: at 12px, beside a 12px label at a
button's scale, an icon reads as an afterthought.

`wrap` is the return arrow, and it took three attempts to find a form that
survives 14px. The first two drew the literal thing — a text rule plus a line
wrapping round with an arrowhead — which needs an arc *and* a head inside about
10px. Both read as a bar with a nub. The return arrow uses the whole box in two
bold strokes instead, which is the constraint the rest of the set obeys: no icon
here holds more than three strokes with no fine detail.

`expand` and `collapse` are **two chevrons the same way up**, down and up
respectively — not a pair pointing at each other. Inward-facing chevrons read
as a ✕ at 14px however far apart the apexes are pushed (tried, and it did),
and ✕ already means close. Down-opens/up-folds matches the row chevrons (`▾`
open, `▸` closed), and doubling them says "a level at a time".

They are SVG rather than characters for two reasons: `⚠` has an emoji
presentation on several platforms, so it renders as a colour emoji inside a
coloured chip, and glyph metrics vary enough between fonts to shift a 12px
chip around. The two severities are deliberately different *shapes* — the
conventional pair, a cross in a circle and a bang in a triangle — not just
different colours, so they stay distinguishable without colour.

They are small solid glyphs — a filled circle with the cross knocked out, a
filled triangle with a bang — because solid shapes hold at 12px where
outlines go muddy, and because the glyph then carries the severity colour
itself. The pill around it is a tint of that colour, a step stronger than
the row's own tint (22% against the row's 7–9%), with the message in the
ordinary text colour, and it keeps the code-list chips' height and type size
so a row reads as one line of pills. Three earlier designs were rejected on
sight: a neutral grey pill, which the reader wanted coloured; a solid red or amber block with a
white cross or bare exclamation on it, and an outlined icon on a pale
severity tint with a hairline border. A lone finding shows its message in
the pill (`.px-finding-text`, ellipsised past `min(110ch, 70vw)` — wide enough
for a second-order finding to show its selector); a row that
collects several drops the text for a count. The tooltip carries every
message in full either way. Pills are `aria-hidden` on the icon with the
wording on the pill's `aria-label`.

Every labelled toolbar button now carries one — Expand, Collapse, Soft wrap and
Copy XML — with a test asserting all four do. The dialect switch deliberately
does not: its label names the *translation* and changes with the document, so
the words are the load-bearing part and an icon beside them would compete.

Still characters, deliberately: the fold chevrons (`▾`/`▸`, CSS `content`),
the `⋮` gutter button, the `…` fold ellipsis and the `→` code-list arrow.
Those are geometric or typographic, have no emoji variant, and work as text.
`onix-popup.js` still uses a `✕` character for its close button.

### Severity, markers and the findings list

Every finding carries a severity from `SEVERITIES`, a per-code table
overridable like `MESSAGES`. An **error** is a schema violation; a **warning**
is valid ONIX that shouldn't be sent (`codelist.deprecated`) or something the
viewer couldn't check (`model.missing`). Anything unlisted defaults to error,
so a newly registered rule is conservative until it says otherwise.

Findings are pinned to rows through `elementRows` (source element → row) and
shown as a pill: a red circle-cross for errors, an amber triangle-bang for
warnings, the first message in the pill and the row itself tinted to match. A
row that collects several findings takes the worst severity, keeps the first
message and appends `+n more`; the tooltip lists them all. The pill is a
`<button>`: clicking it opens the findings list with that row's entries
highlighted (`.px-findings-item-current`), the first of them scrolled into
view and focused — so the list opens on the thing the reader asked about
rather than at the top. Opened from the toolbar instead, nothing is singled
out. The click stops propagating, so the row underneath doesn't become the
active row.

The severity modifier classes are **`px-sev-error` / `px-sev-warning`**, not
`px-error` / `px-warning` — `.px-error` is the parse-error panel, and chips
that reused the name inherited its margins, padding and border and rendered as
large blocks. There's a test asserting the chips carry neither of the old names.

In the findings list the severity badge is **icon-only**. Each entry is its
own CSS grid, so a wider badge would shift that row's element name out of line
with the others; a constant-width badge over a fixed first track keeps the
whole list aligned. The severity word lives in the badge's `aria-label` and
`title`.

The toolbar label carries all three states, each icon-led: a spinning arc and
**Validating…** while working, a green tick and **Valid** when clean, and
`3 errors, 2 warnings` when not — two counts rather than one total, since they
are acted on differently. Clicking it (or `v`) opens the findings list
(`#oxv-findings`). There is no Validate button: the pass is automatic and the
document never changes, so re-running it could only produce the same answer. That modal reuses the code-list popup's
`.px-popup*` shell styling but is built in `viewer.js`, because its entries
link back into the tree: clicking one closes the list, unfolds the ancestors
of the row it concerns, makes it the active row and scrolls it into view.
`.px-active` carries `!important`, so the row you jump to shows the selection
accent rather than its severity tint — the chip still carries the severity,
which isn't worth an `!important` of its own.

Findings entries are `<button>`s, which browsers make unselectable by
default — and the entry carries the whole message, the one thing a reader wants
to copy out. `.px-findings-item` opts back in with `user-select: text`, and the
click handler bails when `hasSelectionInside()` says the click ended a
selection, so dragging across the message doesn't also close the list and jump
the page. Keyboard activation leaves the selection collapsed, so Enter and
Space still navigate.

Both modals follow the same focus contract: store `document.activeElement` on
open, move focus to the close button, restore it on close, name the dialog with
`aria-labelledby` pointing at its own title element (`oxv-findings-title` for
the findings list, `px-popup-title` for the code-list popup — separate ids,
since both live in one document), and keep Tab inside the dialog, which is what
`aria-modal="true"` promises. The findings list gained all four; the code-list
popup already had the first three.

`options.maxFindings` (default 500) caps the findings array while `total`
keeps counting.

### Scheduling: sliced, never blocking

`start(doc, ctx)` returns a session that works in slices — `step(budgetMs)`
walks until its budget runs out and reports whether it finished — and `run()`
is just `step(Infinity)` in a loop, which is what the tests and any
non-interactive caller use.

`viewer.js` gives the first slice a generous 12 ms. A normal document finishes
inside it, so the reader never sees a spinner flash and the answer is there
before the page settles. A large feed spends its 12 ms, shows **Validating…**
with a spinning arc, and continues in 8 ms slices.

Those slices are pumped through a **MessageChannel**, not a timer or an idle
callback, and that choice is load-bearing: in a hidden tab Chrome clamps
`setTimeout` to about a second and suspends `requestIdleCallback` outright —
its `timeout` argument does not rescue it. Both were tried, and both left a
4.8 MB feed stuck at "Validating…" indefinitely while the tab was in the
background. A channel message is an ordinary task: neither clamped nor
suspended. Measured in a hidden tab afterwards, the same feed finished in a
few hundred milliseconds.

The pass deliberately **never scrolls the page or sets the active row** — it
starts on its own, and yanking the view on load would be hostile. Jumping to a
row happens only when the reader clicks an entry in the findings list.

Cost, measured in Chrome: the walk is ~100 ms for a 4.8 MB feed with 135k
elements, and the finding chips are free by comparison — 380 SVG chips built
and laid out in **2 ms**, about 4 µs each.

## Search, collapsed to its icon

The search field sits behind a magnifier button in the toolbar: zero width
until opened by the button or `/`, restored to `min(320px, 40vw)` when open,
and closed by `Esc` or by blurring while empty. `body.px-search-open` drives
it; the input stays in the DOM throughout because it holds the query and the
match state. While collapsed it carries `tabindex="-1"` — a zero-width field
should not be tabbable — and the button is the way in.

Two things about the toggle that took a bug each to find:

- **Its `mousedown` is prevented.** Otherwise clicking it blurred the field,
  the blur handler closed the search, and the click that followed found it
  closed and reopened it — so the button appeared dead. `blur` also ignores a
  blur whose `relatedTarget` is the toggle, for the keyboard path.
- **`closeSearch()` moves focus to the toggle** when the field had it. A bare
  `blur()` left focus on `<body>`, so the next Tab went back to the top of the
  document — and the field itself is untabbable by then. Focus is left where
  it is when the reader had already moved it elsewhere.

**Why it wasn't simply deleted.** It looks redundant next to the browser's own
find, but `Ctrl+F` cannot see `display: none` content, and `<Product>` blocks
are auto-collapsed on any multi-product feed — so on exactly the large files
where searching matters, browser find reports nothing. `runSearch` walks every
text node in the tree, and `gotoMatch` unfolds the ancestors of the current
match. There's a test for that: a contributor's name inside a folded Product
is found and its Product unfolded. (The test deliberately searches a
contributor rather than a title, because a title also appears in the folded
row's own summary chip, where there would be nothing to unfold.)

Highlights are cleared by `clearMatches()`, from the `matches` array — never by
re-querying the tree. That query used to cost more than the search itself on a
large feed: 74 ms per keystroke on a 17,500-row document for a typical query,
against 0 ms from the array. The dialect switch renames tags in place rather
than re-rendering, so the stored element references stay live.

## Per-node menu ("Copy node XML")

Every element row (open row, leaf row, self-closing row) gets a `⋮` button
prepended by `attachNodeMenu()` in `viewer.js`; close rows, comments, PIs and
text rows don't. The button lives in a `--gutter` column left of the fold
chevron and is revealed on row hover / focus / while its menu is open. A
single shared dropdown (`#oxv-node-menu`) is moved next to whichever button
opened it; it closes on outside click, Esc, or any scroll.

`rowElements` (a `WeakMap`, row → source element) is what makes the copy
undecorated: the action serialises the *original parsed element*, not the
rendered row. `nodeXml()` runs `XMLSerializer` and then applies two
source-fidelity fixes:

- `stripSynthesizedNamespace` removes the `xmlns` (or `xmlns:prefix`)
  declaration the serialiser adds to the subtree root, unless the source
  element carried that attribute itself. A copied `<Product>` should look
  like the one in the file, not gain a namespace its siblings don't have.
- `dedent` strips the element's own leading indentation (taken from the
  whitespace text node before it) from every subsequent line, so the copy
  starts at column 0 instead of keeping the file's absolute indentation.

Adding another action is: append a `.px-node-menu-item` with a
`data-node-action` in `ensureNodeMenu()` and handle it in `runNodeAction()`.

## Codelists — generated from EDItEUR's published JSON

`Resources/onix-codelists.js` is **auto-generated** by `tools/generate-codelists.js` from three committed inputs:

- `tools/data/onix-codelists.json` — EDItEUR's published codelists JSON (currently **Issue 74**, 2026-07-22). Authoritative source of (list number, code, label).
- `tools/data/ONIX_BookProduct_3.1_reference.xsd` — the official ONIX 3.1 reference schema, **release 3.1 revision 3 (ONIX 3.1.3, revised 2026-03-10)**. Used for element-name → list-number bindings, and by `generate-content-model.js` for the validation content model.
- `tools/data/ONIX_BookProduct_3.1_short.xsd` — the official ONIX 3.1 short-tag schema, same revision, used **only** for short-tag → reference-name pairs. Each element there is declared under its short tag and names its reference form as the sole `refname` enumeration, e.g. `<xs:element name="b253">` → `LanguageRole`.

**Both XSDs are parsed as XML**, with the same `DOMParser` that `generate-content-model.js` uses — not scraped with regexes. That mattered: the regex this replaced required `name="x"` to be the declaration's last attribute, so `<xs:element name="x512" default="C">` (the one declaration in either short schema that carries an extra attribute) was skipped, and `CopyrightType` had no short tag at all. In a short-tag document that cost `<x512>` its code-list label, left the dialect switch unable to rename it, and made the validator report conformant ONIX as an unknown element. `parseShortTags()` now also throws if any declaration yields no `refname`, rather than emitting a map that is quietly a few pairs short.

All three inputs are committed so the generator has no external dependencies. Output contains all 165 non-empty lists (4,791 code/label pairs), 158 element bindings and 530 short-tag pairs (both releases merged) — about 231 KB unminified, ~59 KB gzipped. Multiple element names that share a list reference the same `Map` instance. EDItEUR's JSON also carries List 88 (Religious text identifier), which has no codes at all; the generator emits only lists that have entries, so it is skipped.

Short-tag keys are emitted **lower-cased**, because every consumer looks a tag up as `name.toLowerCase()` — the schema's one mixed-case tag, `ONIXmessage`, would otherwise be unreachable. `onix.js` layers two things on top of the generated map: `EXTRA_SHORT_TAGS` (ONIX 2.1-era codes such as `b005`/`b332` that the 3.1 schema doesn't contain, kept because the detector still recognises 2.1 documents, plus tolerance for feeds that lower-case a data element's reference name) and the Acknowledgement tags from `registerAcknowledgementBindings()`.

```bash
node tools/generate-codelists.js                                  # default paths
node tools/generate-codelists.js --json=PATH --xsd=PATH --short-xsd=PATH
```

The generator also writes `window.OnixViewerShortTags` (the short-tag map) and `window.OnixViewerCodeListSchema = { version, issue, releaseDate }` to the output. `viewer.js` reads this constant and shows "ONIX 3.1, Issue 74" as a toolbar pill so users can see at a glance which code lists they're looking at.

**To bump issues**: replace `tools/data/onix-codelists.json` with EDItEUR's next release from `https://www.editeur.org/files/ONIX%20for%20books%20-%20code%20lists/`, re-run the generator, and the new issue number propagates everywhere (toolbar, comments, metadata).

## The structure pane, removed

There used to be a second view — a right pane rendering Products as
cards-and-blocks, with a divider, a three-way XML / Split / Structure toggle and
bidirectional collapse-sync to the tree. It was **bundled and tested but gated
off in the UI**, in two places at once, and stayed that way long enough that it
was shipping ~29 KB of `onix-blocks.js` plus 47 CSS rules and a divider drag
handler to every install, for something no reader could reach. Removed in
0.9.17.

What went with it: `Resources/onix-blocks.js`, `window.OnixViewerBlocks`,
`setupViewMode` / `applyViewMode` / `renderBlocksPane` / `setupBlockSync` /
`setupDivider`, the `pairMap` row↔card WeakMap and the
`highlightInTree`/`highlightInBlocks` pair, the `#oxv-blocks-pane`,
`#oxv-blocks` and `#oxv-divider` elements, the `body.oxv-view-*` classes and the
`oxv-view-mode` localStorage key, and 339 lines of tests. The tree lost nothing:
`setActiveTreeRow` stays, because the findings list uses it to jump to a row.

Three things are deliberately **kept**, having looked like pane code and not
been:

- **`.px-block-label`** — the tree's own `Block N` badge, built in `viewer.js`.
- **`#oxv-block-list`** — the toolbar pill's `Blocks: 1, 2, 4, 5, 6` segment,
  which is a different thing entirely from `#oxv-blocks`.
- **`#oxv-main`** — still the flex row wrapping `#oxv-root`, now with one child.

If the idea ever comes back it is in the history (`git show 53ea342:Resources/onix-blocks.js`, the last commit that carried it),
and it should come back as its own thing rather than as a permanently-disabled
branch of the viewer.

## Identifier conventions

After the rename from "PrettyXML" to "ONIX Viewer":
- `window.OnixViewerOnix` — the ONIX module API (detect, resolveCodelist, codelistFor, resolveAttributeCodelist, dependentCodelist, nodeSummary, translatedName, translateNode, codelistMeta, codelistEntries, externalLinkIcon, blockNumber, isProductElement, productElements, singleProductBlocks)
- `window.OnixViewerCodeLists` — codelist data keyed by element name (each value is a `Map<code, label>`)
- `window.OnixViewerCodeListsByNumber` — same data keyed by list number (for attribute lookups where there's no parent element)
- `window.OnixViewerCodeListTitles` — list number → title, for the 35 lists no element binds
- `window.OnixViewerCodeListMeta` — element-name → `{ listNumber, title }` for EDItEUR list links
- `window.OnixViewerShortTags` — generated short-tag → reference-name pairs (lower-cased keys); `onix.js` builds `SHORT_TO_REFERENCE` from it
- `window.OnixViewerCodeListSchema` — `{ version, issue, releaseDate }` for the toolbar pill
- `window.OnixViewerPopup` — code-list modal (`show(codelistKey, currentValue?, context?)`, `close()`); the key is an element name or `list:N` for a list no element binds
- `window.OnixViewerContentModels` — compiled content models keyed by ONIX release (`"3.0"`, `"3.1"`)
- `window.OnixViewerDeprecatedCodes` — list number → code → the issue it was deprecated at
- `window.OnixViewerValidation` — `run`, `start` (sliced session), `message`, `severity`, `messages`, `severities`, `rules`, `registerRule`, `modelFor`, `availableVersions`
- `[OnixViewer]` — console log prefix (gated behind a `DEBUG = false` flag in `content.js`)
- `oxv-*` — DOM IDs (`oxv-toolbar`, `oxv-root`, `oxv-search`, `oxv-schema`, `oxv-meta`, `oxv-block-list`, `oxv-node-menu`, `oxv-validation`, `oxv-findings`)
- `data-oxv` — data attribute on the replaced `<html>`
- `px-tag-name` — marks a span holding an element name, so the dialect switch can find it
- `px-icon` — a tiny inline SVG from `icon(name)`; `px-sev-error` / `px-sev-warning` are the severity modifiers (not `px-error`, which is the parse-error panel)
- `px-*` — CSS class prefix (kept short; ubiquitous in viewer.js)

The `px-` CSS prefix was retained from the rename because changing it would touch every line of `viewer.js` that builds DOM.

## Security posture

`SECURITY.md` is the canonical doc. Highlights:

- `permissions: []` and `host_permissions: []` — both empty as of 0.9.8. The extension cannot make cross-origin fetches; any rogue `fetch()` to a third-party origin would be CORS-blocked by the browser.
- Only one network call in the whole bundle: a same-origin re-fetch of the page's own URL (`fetch(document.location.href, { credentials: "same-origin" })`).
- No background service worker, no `chrome.storage`, no `chrome.tabs`, no `webRequest`.
- `script-src 'self'` (the MV3 default CSP) is enforced. No `eval`, no `new Function`, no remote `<script src>`.

A focused security audit on the 0.9.7 artefact found no HIGH or MEDIUM findings; the four LOW recommendations were applied in 0.9.8.

## Keeping the extension easy to review

A Chrome Web Store reviewer reads the manifest and `SECURITY.md`, then goes
looking for the things those documents claim are absent. **A stale security
note is worse than none** — a reviewer who finds one claim wrong stops trusting
the rest — so the claims are asserted in the suite rather than maintained by
hand. `tests/cases/29-reviewability.test.js` checks:

| Claim | How it is held |
|---|---|
| "No remote code" | no `eval`, `new Function` or `document.write` in any shipped script, and no string in the code referencing a remote `.js` |
| "One network call" | exactly one `fetch(` across the shipped scripts, and its argument must be `document.location.href` |
| No HTML injection | no `innerHTML`/`outerHTML` assignment at all in the shipped scripts, and `insertAdjacentHTML` is banned |
| "Zero permissions" | `permissions` is `[]`, and `host_permissions`, `background`, `optional_permissions` and `externally_connectable` are all absent |
| `SECURITY.md` is accurate | its fenced manifest excerpt is parsed as JSON and compared field-by-field with the real manifest |
| Injection actually works | every resource `content.js` builds a `getURL()` for is both web-accessible and present on disk |

Each was verified to fail when the claim is broken — a planted `eval`, an added
permission, an extra web-accessible resource, `root.innerHTML = SOURCE`.

Two design choices carry most of the reviewability, and both should survive any
refactor:

- **The untrusted XML never becomes markup.** It reaches the page as
  `textContent` on an inert `<script type="application/xml">` block and is
  rendered to DOM nodes one at a time. The shell HTML is a template string in
  `shell.js`, but its only three interpolations are two `runtime.getURL()`
  values and an `escapeHtml`'d page title — no document content goes near it.
- **Nothing is privileged.** With `permissions: []` and no `host_permissions`,
  a rogue `fetch` to a third party is blocked by CORS in the browser, not
  merely absent from the code. There is no capability for a page to borrow.

`web_accessible_resources` is the one broad-looking entry that isn't a
permission, and *is* asked about: the viewer runs in the page's world, so the
page has to be allowed to load the eight scripts, the stylesheet and the icon
that `content.js` appends. It exposes only static files that are public in this
repository, and grants a page none of the extension's privileges — of which
there are none. `SECURITY.md` and `CWS_LISTING.md` both spell that out.

## Dev workflow

### Test loop (fast — use this most of the time)

```bash
npm install     # one-time, installs jsdom
npm test        # runs the 246-test jsdom suite (~9s)
npm run test:update-expected   # rewrite tests/expected/ after an intended change in findings
npm run lint    # ESLint, recommended rules; CI runs it after the suite
npm test -- x512          # just the tests matching "x512" (~0.2s)
npm test -- validation    # a whole describe block
```

The harness lives in `tests/harness.js`: it loads the viewer scripts in jsdom against fixtures in `tests/fixtures/` and exports `test`, `describe`, `assert`, the render helpers (`render`, `renderSource`, `$$`, `rowsNamed`, …) and the validation helpers (`findingsFor`, `findings`, `codes`, `validationLabel`, `shortTwin`), so no case file defines its own. The cases are `tests/cases/NN-<area>.test.js`, one `describe` block each, loaded in name order by `tests/run.js`. Add a fixture + a `test()` call in the right file when introducing new behavior — much faster than reloading the extension in the browser.

`test()` is hand-rolled but takes an optional case-insensitive substring
filter, matched against the test name *and* its `describe` label — so
`node tests/run.js x512` runs one test and `node tests/run.js validation` runs a
block. Skipped blocks print no heading, the summary says how many were filtered
out, and a filter matching nothing exits non-zero rather than reporting success
over an empty run. Filtering also cuts the run to ~0.2s, since only the matching
tests build a jsdom window.

### The findings on record

`tests/expected/<document>.findings` holds, for every ONIX fixture and every
sample in `Onix/`, one line per finding: severity, code, and the path of the
node it is pinned to. `tests/cases/31-expected-findings.test.js` compares the
live run against it and names what went missing or appeared. This is the one
check that promises *every* rule still fires on *every* document — each rule's
own tests prove only that it fires where they look — and it is what would have
caught the two silent gaps in this file's history, the unchecked
`<EpubLicense>` and the unwrapped date union. The defect samples are its
strongest cases: 122 findings on `onix-errors-and-warnings.xml`.

When a change is meant to alter the findings, `npm run test:update-expected`
rewrites the records; read the diff before committing it, since that diff *is*
the review of what the change did.

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

Every push and pull request runs `.github/workflows/test.yml` — the same suite, plus two staleness checks:

- **Generated data**: all three generators are re-run and any diff fails the build, so editing an XSD without regenerating fails there rather than shipping stale data.
- **Icons** (`npm run check:icons`): the shipped `Resources/icons/icon-<size>.png` must be byte-identical to a hand-drawn `icons/icon-<size>.png` where one exists, every PNG's pixel size must match its name, and each must carry an alpha channel. It deliberately does **not** re-render: `render-icons.sh` needs `rsvg-convert`, whose output is not byte-stable between versions, so a re-render-and-diff check would fail on the renderer's version rather than on a real problem. Byte comparison and a PNG header read need no image tooling at all.

  This exists because a stale icon did ship: `icons/icon-32.png` gained an alpha channel, which makes a hand-drawn size win over a downscale, but `render-icons.sh` was not re-run — so `Resources/icons/icon-32.png` stayed the downscale through a commit. The check also prints which sizes are still rendered from the master, so the hand-drawn set can be completed one size at a time.

The tag push triggers `.github/workflows/release.yml` — tests run, version-vs-tag is verified, the zip is built, and a GitHub release is created with `onix-viewer-0.9.X.zip` attached. Then upload the zip to the CWS dashboard manually (the OAuth dance for an automated CWS upload is not worth it for this small extension).

Two more things belong to a release and are easy to forget:

- **The store link in `site/index.html`** carries the CWS item ID, `afdfkehnjkpgfhkgpacimefkkgfgkife`, which Chrome derives from the signing key and which therefore never changes between versions; the `onix-viewer` slug before it follows the name and is optional. `tests/cases/30-documentation.test.js` holds the page to that ID, so the placeholder it once carried cannot come back. After the page changes, copy the contents of `site/` to `onix-viewer/` in the maendeleo-site repo (`~/git/maendeleo-site/onix-viewer/`, beside `onix/`, which is the sample-files page), which is how the page is published.
- **Rebuilding a release** that has not been uploaded to the store is done by deleting the GitHub release (`gh release delete vX.Y.Z`), moving the tag (`git tag -f`), and force-pushing it; the workflow's `gh release create` refuses an existing release, so the delete has to come first. Once a version has been uploaded to the store it cannot be re-uploaded, so bump instead.

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
| `onix-short-no-namespace.xml` | `<ONIXmessage>` root with no namespace: dialect from the root spelling, version from `release` |
| `onix-3.0-short-codelists.xml` | Short-tag code lists that the old hand-kept map missed (`b253`, `b252`, `x415`, `b394`, `x462`), and the `<price>` chip in short dialect |
| `onix-3.1-standalone-product.xml` | Document root is `<Product>` (no `<ONIXMessage>` envelope); also the clean baseline for validating a `<Product>` root, bar its deprecated `<TitleText>` |
| `onix-3.0-multi-title.xml` | Multiple `<TitleDetail>` blocks → summary picks `<TitleType>01</TitleType>` |
| `onix-3.0-gtin-only.xml` | Identifier preference order: GTIN-13 wins when ISBN-13 absent |
| `onix-3.0-isbn10-only.xml` | ISBN-10 labelled as "ISBN" in the summary |
| `onix-3.0-proprietary-only.xml` | Summary omits the identifier segment when no ISBN/GTIN present |
| `onix-3.0-acknowledgement.xml` | Acknowledgement message: detection, "ONIX Acknowledgement" label, "records" count, ack-specific codelist resolution (MessageStatus, RecordStatus, StatusDetailType) |
| `onix-3.0-acknowledgement-short.xml` | Short-tag acknowledgement: `m489`/`a498` resolve via the registered ack short→reference bindings |
| `onix-standalone-product-no-namespace.xml` | Bare `<Product>` root, no namespace, no XML declaration: detection via corroborating child, version-less meta label, codelist resolution |
| `non-onix-product.xml` | A non-ONIX `<Product>` root (sku/price/…) is **not** misdetected as ONIX — guards the corroboration heuristic |
| `onix-3.0-title-without-prefix.xml` | Summary reads split-form titles: `<NoPrefix/>` + `<TitleWithoutPrefix>`, and `<TitlePrefix>` joined to the remainder |
| `onix-3.0-title-without-prefix-short.xml` | Same in short dialect (`b030` + `b031`) |
| `onix-3.0-single-product-blocks.xml` | One Product with blocks 1, 4, 6: `Block N` badges on block rows, `Blocks: 1, 4, 6` toolbar pill; also `RecordSourceIdentifier` and `Price` chips |
| `onix-3.1-valid.xml` | A schema-valid ONIX 3.1 message: the validator's clean baseline. Uses the split `<NoPrefix/>` + `<TitleWithoutPrefix>` title form, since `<TitleText>` is deprecated in 3.1 and "valid" here means zero findings |
| `onix-3.1-invalid.xml` | One instance of each finding kind: unknown element, bad code, deprecated code, deprecated element, missing required element, out-of-range value, bad ISBN-10 check digit |
| `onix-3.0-text-attributes.xml` | `<Text textformat="05">` (leaf row) and `textformat="06"` (open row with child elements): attribute code-list chips |
| `onix-2.1-doctype.xml` | An ONIX 2.1 message with the standard `<!DOCTYPE … SYSTEM "…dtd">`: the DOCTYPE row keeps its `SYSTEM` keyword |
| `onix-3.1-dependent-codelists.xml` | Second-order code lists: one value element per selector (`ProductFormFeatureType` 01, 09 and 47, `AudienceCodeType`, `AudienceRangeQualifier`, `SalesOutletIDType`, `ReturnsCodeType`) plus a type 07 value that must stay plain. Schema-valid, so also the clean baseline; its short-tag twin is made in the test with `translateNode` |

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
- **Manifest changes**: update `Resources/manifest.json`. If the user-facing description changes, also update `CWS_LISTING.md` and the promo / marquee SVGs.
- **Icon changes**: edit `icons/icon-original.png` (1254×1254 RGBA, artwork edge-to-edge), then `tools/render-icons.sh` rebakes all seven manifest sizes. **Hand-drawn sizes win**: the script uses a custom `icons/icon-<size>.png` verbatim when one exists, since a downscale of a detailed mark loses definition at 16 and 32 px. The one requirement is an alpha channel — an opaque custom shows as a pale tile wherever Chrome puts the icon on a dark ground, so one without alpha is refused with a warning and the master is rendered instead. The toolbar mark is not a separate file: it loads `Resources/icons/icon-48.png`, the app icon's own 48px size, so there is nothing to keep in step. The promo SVGs reference the same master, so `rsvg-convert` re-renders those too (commands in `CWS_LISTING.md`).
- **Store screenshots**: re-take into `Screenshots/` at 1280×800 and commit them. That directory is the record of what the listing shows — do not stage screenshots in `dist/listing/` as well. Two lived there once, and with nothing keeping the copies in sync they fell two UI revisions behind while the committed pair moved on. `dist/listing/` is for the generated assets only (icon, promo tile, marquee); the render commands are in `CWS_LISTING.md`. `site/` carries its own copies of the three screenshots and the 128px icon, because the page is copied elsewhere to publish and has to be self-contained; `tests/cases/30-documentation.test.js` fails when a copy stops matching its source, so re-taking a screenshot means copying it there too.
- **Tests**: never skip the failing-case fixtures. The malformed-XML test guards against a regression where a parse error would blank the page.

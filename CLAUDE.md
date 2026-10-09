# CLAUDE.md

Guidance for Claude Code in this repository: the design decisions that are not
obvious from the code, the traps, and the dev workflow. Detail that the code or
`git log` already carries is left out on purpose.

## What this is

A Manifest V3 extension (Chrome, Firefox, Safari) that takes over raw ONIX XML
pages and renders them with codelist resolution, `<Product>` summaries,
dialect detection (reference names vs. short tags), release detection (2.1,
3.0, 3.1) and validation.

It is single-purpose: it activates only on documents that look like ONIX.
Non-ONIX XML is left to the browser's own viewer; there is no general XML mode.

Activation: the MIME type must be `application/xml`, `text/xml` or
`application/onix+xml` (ONIX has no registered type; the `+xml` form is
accepted as future-proofing). Then the first 2 KB are sniffed for the EDItEUR
namespace (`ns.editeur.org/onix`) or an `<ONIXMessage>` root. XHTML and SVG
are skipped.

## Layout

```
Resources/                  the extension itself — load this unpacked
  manifest.json             zero permissions, zero host_permissions; version_name is the -dev form
  shell.js                  the HTML shell template, shared by content.js and the tests
  content.js                detects ONIX, re-fetches the source, takes the page over
  viewer.js / viewer.css    tree rendering, toolbar, search, findings list, modals
  onix.js                   detection, codelist resolution, summaries, dialect translation
  onix-validate.js          content-model interpreter and rule registry
  onix-schematron.js        custom rules: a Schematron subset over the browser's XPath
  onix-migrate.js           ONIX 3.0 → 3.1 conversion (loaded on demand)
  onix-popup.js             code-list popup
  onix-codelists.js         GENERATED — code lists, bindings, short-tag map
  onix-thema.js             GENERATED — Thema codes (injected only when a Thema scheme is used)
  onix-content-model-3.{0,1}.js  GENERATED — validation content models
  icons/                    GENERATED from icons/ — committed
icons/                      icon source artwork, never shipped
chrome/ firefox/ safari/    per-store listing text and screenshots; firefox/ and safari/ README the ports
tools/                      generators, packager, release, icons, screenshots, site sync, xmllint oracle
tools/data/                 generator inputs: EDItEUR codelist JSON, Thema JSON, the XSDs
Onix/                       real ONIX samples (one record in both dialects, plus whimsical.xml for screenshots)
tests/                      jsdom suite (cases/, fixtures/, expected/), browser tests (browser/)
site/                       the extension's web page; published by tools/publish-site.sh
dist/                       build output, gitignored; one upload folder per store
```

Generated files are **committed**, because *Load unpacked* points straight at
`Resources/` and a fresh clone must work with no build step. Never hand-edit
them; CI re-runs every generator and fails on a diff.

## Architecture: replacing the document

The browser's native XML viewer is opaque to content scripts, so the extension
replaces the document instead of restyling it:

1. `content.js` runs at `document_start` and checks the MIME type.
2. When the parser's root looks like ONIX, it is **detached** at once. The
   parser keeps filling the detached root, but the browser no longer lays out
   or builds its tree viewer for a document about to be replaced. An RSS root
   ends the watch. Do not remove the browser viewer's `<html>` from the
   mutation observer — that crashed Safari (see `safari/README.md`); the shell
   replaces it like any root.
3. The source is **re-fetched** (`fetch(document.location.href, { credentials:
   "same-origin" })`), only after `DOMContentLoaded` — run alongside the page
   load, a response too large for Chrome's HTTP cache left the page loading
   forever.
4. The shell (from `shell.js`) is built with `DOMParser` and appended once the
   parser has produced its root — earlier, it would sit beside it.
5. The source goes into an inert `<script type="application/xml"
   id="__oxv-source__">` block (a page's `script-src` CSP leaves non-JS types
   alone), then the viewer scripts are appended as `<script>` elements with
   `async = false`.

**Fallback.** When the re-fetch fails (file://, one-shot signed URLs, bearer
auth) or returns something that is not the document (non-XML content type, or
non-ONIX body such as an app's login shell), the parser's own tree is
serialised with `XMLSerializer` — never before `DOMContentLoaded`, or it is
truncated.

**Traps:**

- **Never use `document.open()`/`document.write()`.** They throw on a non-HTML
  document per spec; only Chromium's leniency lets them through.
- **Scripts from `DOMParser` never execute** (the "already started" flag), so
  script tags are created dynamically, not embedded in the shell.
- **XHTML namespace.** `document.contentType` stays `application/xml`, so
  `document.createElement` makes null-namespace elements with no `.style`.
  `content.js` uses `createElementNS(XHTML, …)`; `viewer.js` patches
  `document.createElement` at the top of its IIFE.
- **blob: URLs** work through `match_origin_as_fallback` (hence
  `minimum_chrome_version: "119"`); Safari ignores the key.

**Limits.** The source is held in memory. Sources over 500 MB
(`MAX_SOURCE_BYTES`) get a notice instead: `content.js` stops the load and
counts bytes as they arrive (`readLimited()`), since `Content-Length` may be
the compressed size.

### Large feeds

The cost of a large feed is the browser's style and layout, not the JS. Three
things keep it usable:

- **`content-visibility: auto`** on each Product's container
  (`#oxv-root > .px-children > .px-children`, `contain-intrinsic-size: auto
  1200px`). Consequence: jumps use an instant `scrollIntoView`, never smooth —
  a smooth scroll past unrendered Products lands where the target *was*.
- **Lazy Products.** Above `LAZY_FROM_PRODUCTS` (20), each Product gets its
  open and close rows and an empty `px-pending` container that an
  `IntersectionObserver` fills when near. Anything that needs a row inside a
  Product goes through `ensureRendered(node)`. Findings in unrendered Products
  wait in `pendingFindings`; search hits in `hitsByProduct`. jsdom has no
  `IntersectionObserver`, so the suite renders eagerly unless a test supplies
  one (`36-lazy-products.test.js`).
- **Explicit stacks, not recursion**, in the renderer, the validator and the
  Schematron mirror — deep nesting once blew the stack mid-render and left a
  truncated tree that looked complete. `pushChildren()` pushes in reverse; a
  close row is pushed before its children.

## ONIX detection (`onix.js`)

`detect()` returns `{ isOnix, dialect, version, messageType }`. Signals in
order: the root's namespace (including the Acknowledgement form
`…/onix/acknowledgement/3.0/…`); the root name (`ONIXMessage` is reference,
`ONIXmessage` is short — the root spelling gives the dialect; no namespace and
no `release` means 2.1); a bare `<Product>` root, accepted only with a
corroborating ONIX child (`hasOnixProductChild`), dialect inferred from
casing, version `null`; and finally the `release` attribute.
`content.js`'s sniff mirrors these rules.

Short tags map to reference names through `SHORT_TO_REFERENCE`, generated from
both releases' short-tag schemas (530 pairs; keys lower-cased). `onix.js` adds
`EXTRA_SHORT_TAGS` (2.1-era tags) on top.

**Acknowledgement messages** use a schema that is not bundled. Their codelist
bindings are hand-declared in `ACK_CODELIST_ELEMENTS` and folded into the
global tables by `registerAcknowledgementBindings()`. They are not validated
structurally (`model.acknowledgement`), get no dialect switch, and are labelled
"records" rather than "products".

## Summaries

`nodeSummary()` builds the chip on a collapsed row; which composites get one is
decided entirely in `onix.js`. Identifier composites are handled by one rule
(`identifierSummary`); `SUMMARIZERS` covers `Product`, `TitleDetail`,
`TitleElement`, `Contributor` and `Price`; the seven blocks deliberately get a
`Block N` badge instead. Rules are written against reference names.

The `<Product>` chip prefers ISBN-13 → GTIN-13 → ISBN-10 and omits anything
else rather than mislabel it; reads the form from `<DescriptiveDetail>` and the
distinctive title (`TitleType` 01), handling the split
`<TitlePrefix>`/`<TitleWithoutPrefix>` form. Lookups are restricted to direct
children so a `<RelatedProduct>`'s ISBN or title is never picked.

## Dialect switch

Terms are EDItEUR's: **reference names** and **short tags**. The switch (`t`)
names the translation, never the current state, so the document's own dialect
is always the unpressed state.

- Switching **renames spans in place**; it never re-renders, so fold state,
  search and the active row survive. The tree is built in the preferred
  dialect from the start, and nothing is stored per span.
- `REFERENCE_TO_SHORT` is built only from the generated map (one-to-one), never
  from `EXTRA_SHORT_TAGS`.
- Copy and Download follow the display. `translateNode()` renames *and* moves
  elements to the target namespace; foreign-namespace elements and untranslatable
  names (inline XHTML) are left alone. At the source dialect the copy is the
  source byte for byte.
- Findings and the document pill describe the **file**, so they use the source
  dialect and do not change with the view.

`42-dialect-conversion.test.js` holds the conversion to EDItEUR's schemas
rather than to the generated map.

## Toolbar

A three-column grid (`auto minmax(0, 1fr) auto`): controls on the left (brand
mark, icon buttons, dialect switch, search), the document pill and verdict in
the centre, the release selector and cog on the right. Things that matter:

- `.px-left` is a flex row so icon buttons and text buttons share one midline.
- On a narrow window the pill ellipsises, then the search shortens, then the
  pill and (below 800px) the release selector are dropped by breakpoints. The
  verdict (`#oxv-validation`) never gives way.
- The brand mark loads `icons/icon-28.png` with `icon-56.png` as 2x — no file
  of its own. It opens About, and falls back to text on an `img-src` CSP error.
- The version shown comes from `content.js` (`data-oxv-version`), which uses
  the manifest's `version_name` (`-dev` when unpacked) else `version`. The
  browser comes from the scheme of `runtime.getURL("")` (`data-oxv-browser`).
- The document pill gives the size as the Finder does (decimal units, browser
  number format), from bytes counted by `content.js` (`data-oxv-bytes`).
- **Release selector**: one option per bundled release, plus the document's own
  when not bundled. A document that declares no release starts on 3.0. The
  choice is never remembered across documents.

## Expand and collapse

One level per press, decided from what is currently folded — no counters.
`expandStep()` unfolds the shallowest folded level. `collapseStep()` follows
the message: first everything directly inside a `<Product>` plus `<Header>`
(revealing ancestors as it folds), then the `<Product>` rows, then the deepest
visible level. Non-ONIX XML uses the last rule throughout.

## Validation

Runs automatically on load against a **compiled content model**: the browser
has no XSD processor, and libxml2-in-WASM would need `'wasm-unsafe-eval'` under
the page's CSP. `tools/generate-content-model.js` compiles the reference XSD;
`onix-validate.js` interprets it.

This works because ONIX's schema is regular: no `xs:any`, no `xs:all`, no
substitution groups, and no repeating compound particles, so every sequence
and choice matches at most once and one-token lookahead is exact. The only
finite `maxOccurs` above 1 is `<OrderQuantityMinimum maxOccurs="2">`. **The
generator throws on anything it does not understand** — unknown constructs,
refused attributes, a datatype named but not compiled — rather than emit a
model that is quietly short. Keep it that way.

**Releases.** Only 3.0 and 3.1 exist since 3.0; revisions (3.1.3 etc.) cannot be
declared in a document, so the newest revision of each is used (they are
additive). Only the document's own model is injected (`contentModelURLs()`);
both when the release is unreadable. The release selector fetches the other on
demand (`data-oxv-models`, `ensureModel()`), and under an override the
`release` attribute itself is exempt.

**Model encoding**: `["e", name, min, max]` (max 0 = unbounded),
`["s", min, …]`, `["c", min, …]`; leaves `{list}`, `{text}`, `{empty}`,
`{flow}` (XHTML content, never inspected). `u` = identity constraints,
`d` = XSD default value, `in` = per-parent variants. Names are reference names
only; short tags are translated first, so both dialects give identical
findings.

- **Always reach an element's shape through `api.shapeOf(node)`.** `<EpubLicense>`
  is declared by named complexTypes whose content depends on the parent (`in`);
  indexing `model.elements` directly silently gets the default variant.
- **Findings are worded in the document's dialect** via `api.displayName()` /
  `api.displayPhrase()`.

**Extension points**: `MESSAGES` (templates keyed by finding code — the codes
are the contract), `SEVERITIES` (unlisted codes default to error), and `RULES`
(one walk, every element offered to every rule via `start`/`element`/`finish`).
Rules: `structure`, `codelist`, `datatype`, `attribute`, `unique`,
`deprecation`, `gtin`, `form`, `schematron`.

What the rules cover, briefly:

- **Identity constraints**: all `xs:unique` (142 in 3.1, 85 in 3.0). A node with
  an incomplete key is outside the constraint.
- **Deprecation**: from the XSD annotations. A note that says "Deprecated"
  followed by an element reference or a P.x clause is about something else
  (`<Header>`, `<TitleElement>`, `<SalesRestriction>` stay unflagged).
- **Attributes**: the ten ONIX attributes, same names in both dialects. An
  empty or whitespace-only value is always a violation; values are trimmed
  (`xs:token`). An attribute prefixed into the ONIX namespace is
  `attribute.qualified`; other namespaces are tolerated.
- **Datatypes**: facets *and* the XSD base type (four `dt.*` types have no
  facets). `xs:list` types check each member.
- **Second-order code lists** (`OnixViewerDependentCodeLists`): a value whose
  list is selected by a sibling's type code. Compiled from the strict schema's
  `xs:assert` rules — the only thing the strict schema is used for. The badge,
  the popup and the validator all go through `codelistFor()`.
- **Form/detail affinities** (`OnixViewerFormAffinities`, `form.detail`): also
  compiled from strict; judged only in `<DescriptiveDetail>` and `<ProductPart>`.
- **Check digits** (`gtin`): ISBN-13, GTIN-13, ISBN-10, and their length — the
  schema types `<IDValue>` as any non-empty string.
- **Structure recovery**: an unknown element, or a known one the parent never
  takes, is reported once and left out of the match, so one typo does not
  cascade. A choice can be satisfied by nothing (`nullable()`). Non-space text
  in a composite is reported, pinned to the text node (`at`).

**Why the classic XSD**: the RNG has no identity constraints or element
defaults; the strict (XSD 1.1) schema needs an XPath 2.0 engine. Strict's
co-occurrence and arithmetic rules belong in `registerRule`, read as a
specification rather than compiled.

**Not checked**: XHTML flow content, List 88 (no codes), strict's other
assertions, specification prose.

**Scheduling**: `start()` returns a sliced session; the viewer gives a 12 ms
first slice, then 8 ms slices pumped through a **MessageChannel** — `setTimeout`
is clamped and `requestIdleCallback` suspended in hidden tabs. A superseded
pass stops at its next slice. The pass never scrolls or sets the active row.

**Oracle**: `npm run test:oracle` compares our verdict with `xmllint --schema`
against EDItEUR's XSDs for every document as 3.0 and 3.1. Only findings XSD 1.0
can see are counted, and the verdict, not the count, is the contract.

### Custom rules (Schematron) — held back

**Off in the shipped build**: `FEATURES.customRules` in `viewer.js` and
`CUSTOM_RULES` in `content.js` are `false`, and `permissions` is `[]`.
`38-held-back-features.test.js` holds the default; tests turn it on through
`window.OnixViewerFeatures`. Turning it on means the switches, the `storage`
permission, and every doc and listing that says "no permissions".

As built: a rule set in ISO Schematron runs as the `schematron` rule.
Rules are written in **unprefixed reference names** and run against a mirror
of the document in no namespace, so one rule set serves both dialects. A
context is a match pattern (`//` is prepended). XPath 1.0 only — the browser's
`document.evaluate`. Problems never throw; they are reported as
`schematron.invalid`. Storage goes through `content.js` only (the page's world
cannot see `chrome.storage`), one key, `rules`, via `postMessage`.

jsdom's XPath is older than Chrome's (`name()` without an argument crashes it;
prefixed names match nothing rather than throw). The browser test covers what
jsdom cannot.

### Findings UI

Severity classes are **`px-sev-error` / `px-sev-warning`** — not `px-error`,
which is the parse-error panel. Errors and warnings use different icon shapes,
not just colours. Icons are inline SVG from `icon(name)` (`ICONS` table, at the
top of the IIFE), not characters — `⚠` renders as emoji on some platforms.

Findings list entries are buttons with `user-select: text`, and a click that
ended a selection does not navigate. Modals share one focus contract: remember
focus, focus the close button, restore on close, `aria-labelledby`, keep Tab
inside (`keepTabInside()`), and close on the backdrop only for a press that
began there (`closeOnBackdrop()`).

## Version conversion (3.0 → 3.1)

Offered from the release selector on a 3.0 product message; opens
`#oxv-conversion`. `onix-migrate.js` follows the validator's pattern: a rule
registry, one walk, messages keyed by code. `convert()` works on a copy in the
3.1 namespace and remembers each copy's source node; it writes the document's
own dialect.

Each change is graded **automatic** (nothing lost), **review** (applied, but a
judgement) or **manual** (not applied), or **chosen** once the reader picks an
option. Decisions go through `api.decision()`, keyed by rule and the source
element's document-order index; new elements are placed by the 3.1 content
model (`api.insertChild`). After the walk, exact duplicates under 3.1's new
uniqueness rules are removed. Release differences were derived from the two
content models, not prose. The eurozone list for `<CurrencyZone>` is dated and
needs updating when the eurozone grows.

The guarantee the suite holds: **no 3.0 document gains an error from
conversion that it was not told about**. The engine and the 3.1 model load only
when asked for (`data-oxv-migration`).

## Search

Behind a magnifier button (`/`). It exists despite browser find because find
cannot see folded rows or unrendered Products.

It **searches the parsed document, not the screen**: hits are `{ node, kind }`
found by `hitWalk()` in sliced passes; only going to a hit renders its Product.
Highlights are cleared from the `highlighted` array, never by re-querying the
tree. Focus details: the toggle's `mousedown` is prevented (else blur closes
the search before the click reopens it), and `closeSearch()` returns focus to
the toggle.

## Per-node menu

`⋮` on element rows; `rowElements` maps a row to its source element, and
`nodeXml()` serialises that element, strips the namespace declaration the
serialiser synthesises, and dedents. Add an action in `ensureNodeMenu()` and
`runNodeAction()`.

## Generated data

| Output | Generator | Inputs |
|---|---|---|
| `onix-codelists.js` | `tools/generate-codelists.js` | `onix-codelists.json` (Issue 74), the 3.1 reference and both short XSDs, the strict XSD (second-order lists and form affinities only) |
| `onix-content-model-3.{0,1}.js` | `tools/generate-content-model.js --version=3.x` | `ONIX_BookProduct_3.x_reference.xsd` |
| `onix-thema.js` | `tools/generate-thema.js` | `thema-codes.json` (Thema 1.6, English) |

- **Bump a code-list issue**: replace `tools/data/onix-codelists.json` from
  `https://www.editeur.org/files/ONIX%20for%20books%20-%20code%20lists/` and
  re-run the generator.
- **Bump a schema revision**: take `ONIX_BookProduct_3.x_{reference,short}.xsd`
  from `https://www.editeur.org/files/ONIX%203/ONIX_BookProduct_3.{0,1}_XSDs+codes_Issue_<N>.zip`
  into `tools/data/` and re-run all generators. The registry key stays `3.x`.
- **Bump Thema**: replace `tools/data/thema-codes.json` from
  `https://www.editeur.org/151/Thema/` and run the generator.
- XSDs are parsed as XML, never with regexes.

Thema (`SubjectSchemeIdentifier` 93–99) plugs in as keys `thema:93`…; an
unknown code is a **warning** (`codelist.thema`), since Thema grows. A
second-order list is keyed `list:N`.

## Global identifiers

- `window.OnixViewer*` — module APIs and data: `Onix`, `CodeLists`,
  `CodeListsByNumber`, `CodeListTitles`, `CodeListMeta`, `ShortTags`,
  `CodeListSchema`, `DependentCodeLists`, `FormAffinities`, `DeprecatedCodes`,
  `Thema`, `Popup`, `ContentModels`, `Validation`, `Schematron`, `Migration`,
  `Features`.
- `oxv-*` — DOM ids; `data-oxv-*` — attributes stamped on the replaced `<html>`
  by `content.js` (`version`, `browser`, `bytes`, `models`, `migration`).
- `px-*` — CSS classes (kept from the old name; renaming would touch every line
  that builds DOM).
- `[OnixViewer]` — console prefix, behind `DEBUG = false` in `content.js`.

## Security and reviewability

`SECURITY.md` is canonical. The claims are **asserted by the suite**
(`29-reviewability.test.js`), not maintained by hand — a stale claim costs a
reviewer's trust in all the rest:

- no `eval`, `new Function`, `document.write`, remote `.js`;
- exactly one `fetch(`, of `document.location.href`;
- no `innerHTML`/`outerHTML` assignment, no `insertAdjacentHTML`;
- `permissions: []`, no `host_permissions`, `background`,
  `optional_permissions` or `externally_connectable`;
- `SECURITY.md`'s manifest excerpt matches the manifest;
- every `getURL()` target is web-accessible and on disk.

Two design rules carry this: **untrusted XML never becomes markup** (it
arrives as `textContent` and is rendered node by node; the shell template
interpolates only extension URLs, the version, the browser and an escaped
title), and **nothing is privileged**.

## Dev workflow

```bash
npm test                      # jsdom suite, ~8s; each case file in its own worker
npm test -- <filter>          # tests whose name or describe label matches
npm run test:update-expected  # rewrite tests/expected/ — read the diff, it is the review
npm run lint
npm run test:browser          # headless Chrome; run when touching content.js, shell.js, the manifest, Schematron
npm run test:firefox
npm run test:oracle           # needs network once and xmllint
npm run icons                 # after changing icons/
npm run screenshots:{chrome,firefox,safari}
npm run build | build:dev
```

- Add a fixture in `tests/fixtures/` and a test in the matching
  `tests/cases/NN-<area>.test.js`; the harness exports the helpers.
- `tests/expected/<document>.findings` records every finding for every ONIX
  fixture and sample; `31-expected-findings.test.js` compares against it.
- The browser test uses `enableExtensions`, not `--load-extension` (ignored by
  branded Chrome since 137).
- Browser loop: *Load unpacked* `Resources/`, reload the extension card,
  refresh the page; enable file URL access for local files.

### Release

`tools/release.sh 0.9.X` bumps `version` and `version_name` together, commits
and tags; pushing the tag builds the packages and a GitHub release. Store
uploads are manual. The packager deletes `version_name` from a staging copy so
store builds do not say `-dev` (`--dev` builds keep it). A version uploaded to
a store cannot be reused; a tag that never reached one can be withdrawn
(`gh release delete`, move the tag). Safari build numbers derive from the
version; `APPLE_BUILD_NUMBER` overrides.

The site: edit only `site/`, run `npm run site:sync` (copies screenshots and
the icon, content-hashes asset URLs), then `tools/publish-site.sh` (refuses if
the site repo's copy was edited there). The CWS item ID in `site/index.html` is
`afdfkehnjkpgfhkgpacimefkkgfgkife`.

### Icons

`icons/` is source, `Resources/icons/` output (committed). `npm run icons`
renders the manifest sizes from `icon-original.svg`, with a hand-drawn
`icons/icon-<size>.png` winning when present (it must have alpha). The 28 and
56 exist only for the toolbar mark and are hand-drawn, since the master's facets
do not read at that size. `npm run check:icons` compares bytes, not re-renders
(`rsvg-convert` output is not stable across versions).

### Screenshots

Each `npm run screenshots:<browser>` writes the committed set into
`<browser>/screenshots/` and copies it to `dist/`. Do not stage screenshots
anywhere else. Safari's set is taken from the real Safari by AppleScript; see
`safari/README.md`.

## Test fixtures

One behaviour each, kept minimal. `30-documentation.test.js` holds this table
and `tests/fixtures/` to each other in both directions.

| Fixture | Tests |
|---|---|
| `generic-note.xml` | Basic rendering, XML declaration as PI, no ONIX false positive |
| `with-comments.xml` | Comments render in `.px-comment` styling |
| `with-cdata.xml` | CDATA wrapped in `.px-cdata-marker` spans |
| `malformed.xml` | Parse error UI shown instead of crash |
| `rss.xml` | Non-ONIX XML doesn't get misidentified as ONIX |
| `onix-3.0-reference.xml` | Reference dialect: codelists, tag classes, summaries |
| `onix-3.0-short.xml` | Short-tag dialect: detection, styling, `SHORT_TO_REFERENCE` map |
| `onix-short-no-namespace.xml` | `<ONIXmessage>` root with no namespace: dialect from the root spelling, version from `release` |
| `onix-3.0-short-codelists.xml` | Short-tag code lists and the `<price>` chip in short dialect |
| `onix-3.1-standalone-product.xml` | `<Product>` root without an envelope; clean bar its deprecated `<TitleText>` |
| `onix-3.0-multi-title.xml` | Multiple `<TitleDetail>` blocks → summary picks `<TitleType>01</TitleType>` |
| `onix-3.0-gtin-only.xml` | Identifier preference order: GTIN-13 wins when ISBN-13 absent |
| `onix-3.0-isbn10-only.xml` | ISBN-10 labelled as "ISBN" in the summary |
| `onix-3.0-proprietary-only.xml` | Summary omits the identifier segment when no ISBN/GTIN present |
| `onix-3.0-acknowledgement.xml` | Acknowledgement: detection, "records" label, ack code lists |
| `onix-3.0-acknowledgement-short.xml` | Short-tag acknowledgement: `m489`/`a498` resolve via the registered ack short→reference bindings |
| `onix-standalone-product-no-namespace.xml` | Bare `<Product>` root, no namespace: detection via corroborating child, version-less label |
| `non-onix-product.xml` | A non-ONIX `<Product>` root (sku/price/…) is **not** misdetected as ONIX — guards the corroboration heuristic |
| `onix-3.0-title-without-prefix.xml` | Summary reads split-form titles: `<NoPrefix/>` + `<TitleWithoutPrefix>`, and `<TitlePrefix>` joined to the remainder |
| `onix-3.0-title-without-prefix-short.xml` | Same in short dialect (`b030` + `b031`) |
| `onix-3.0-single-product-blocks.xml` | `Block N` badges and the `Blocks: 1, 4, 6` pill; `RecordSourceIdentifier` and `Price` chips |
| `onix-3.1-valid.xml` | Schema-valid 3.1, zero findings: the validator's clean baseline |
| `onix-3.1-invalid.xml` | One instance of each finding kind (the defect catalogue; keeps its bad ISBN-10 on purpose) |
| `onix-3.0-text-attributes.xml` | `textformat` attribute chips on leaf and open rows |
| `onix-2.1-doctype.xml` | An ONIX 2.1 message with the standard `<!DOCTYPE … SYSTEM "…dtd">`: the DOCTYPE row keeps its `SYSTEM` keyword |
| `onix-3.0-conversion.xml` | Version conversion: one instance of each rule and each decision; valid 3.0 bar deprecations |
| `onix-3.1-dependent-codelists.xml` | Second-order code lists, one value element per selector, plus a free-text type 07; schema-valid |

## Not done, on purpose

- No background script, options page, toolbar button, telemetry, analytics or
  runtime libraries.
- No automated store publishing.
- No general-purpose XML viewer.
- The structure pane was removed in 0.9.17; it is in `git show
  53ea342:Resources/onix-blocks.js` if it ever returns — as its own feature.

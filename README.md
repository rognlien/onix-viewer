# ONIX Viewer

A Chrome extension that turns raw ONIX XML into a readable, collapsible tree
with EDItEUR code-list labels inline and automatic validation.

## What it does

The extension activates on pages served as `application/xml`, `text/xml` or
`application/onix+xml` whose source looks like ONIX: the EDItEUR namespace, an
`<ONIXMessage>` or `<ONIXMessageAcknowledgement>` root, or a bare `<Product>`
root with an ONIX child. Everything else, including RSS, generic XML, XHTML and
SVG, is left to the browser's own viewer.

On an ONIX page it replaces the document with a syntax-highlighted, foldable,
searchable tree, and adds:

- **Code-list labels.** Every value the bundled EDItEUR lists know about gets a
  `→ ISBN-13` style badge, plus a `List N` chip that opens a popup listing the
  whole list with a link to EDItEUR's page. Attributes such as `textformat`
  and `language` are resolved the same way, and so are the second-order
  lists a sibling selects: `<ProductFormFeatureValue>` resolves through List
  196 when its `<ProductFormFeatureType>` is 09, List 98 when it is 01.
- **Summaries on folded rows.** A `<Product>` folds to `ISBN · form · title`;
  identifiers, contributors, titles and prices fold to one line too. On a
  multi-product feed the Products start folded, so thousands stay scannable.
- **Block badges.** Each block inside a `<Product>` is labelled `Block N`, and
  a single-Product document lists its blocks in the toolbar.
- **Stepped Expand and Collapse.** Each press works one level. Collapse
  follows the shape of a message: first everything inside each Product and
  the Header, then the Products, then the root.
- **Dialect switch.** One button, or `t`, shows a short-tag file under
  reference names or a reference file under short tags. Copying follows the
  view: at the file's own dialect the copy is the source byte for byte,
  translated it is the converted ONIX with the matching namespace.
- **Validation.** Runs automatically against the bundled ONIX 3.0 or 3.1
  content model: missing, misplaced or unknown elements, codes outside their
  list — including the second-order lists a sibling selects, such as
  `<ProductFormFeatureValue>` under an accessibility, colour or hazard type —
  deprecated codes and elements with EDItEUR's advised replacement,
  datatype and attribute violations, uniqueness constraints, and ISBN-13,
  GTIN-13 and ISBN-10 check digits. Each finding is a pill on its row with the
  message in it; a row with several shows the first and `+n more`. Click a pill
  or the toolbar count, or press `v`, for the full list, and click an entry to
  jump to its row. ONIX 2.1 and Acknowledgement messages have no bundled
  schema, so only their code lists are checked and the toolbar says so.
- **Copy node XML.** The `⋮` button on any element row copies that subtree as
  plain source.

Requires Chrome 119 or later.

## Install

**From a release zip.** Download `onix-viewer-<version>.zip` from the
[releases page](https://github.com/rognlien/onix-viewer/releases), unzip it
somewhere permanent, then in `chrome://extensions` turn on **Developer mode**,
click **Load unpacked** and pick the folder. To open local `.xml` files, enable
**Allow access to file URLs** under the extension's **Details**. Chrome will
show a developer-mode banner on restart, and updates mean replacing the folder
and pressing the reload arrow on the card.

**For development.** Load the repo's `Resources/` folder the same way. After
an edit, press the reload arrow on the card and refresh the page.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `/` | Open search; `Enter` and `Shift+Enter` step through matches, `Esc` closes |
| `e` | Expand one level |
| `c` or `b` | Collapse one level |
| `t` | Switch between reference names and short tags |
| `v` | Open the findings list |
| `w` | Toggle soft wrap |

## Test

```bash
npm install
npm test                  # the jsdom suite, under ten seconds
npm test -- validation    # only tests whose name or block matches
npm run lint              # ESLint over the scripts, tools and tests
```

The suite is one file per area under `tests/cases/`, over fixtures in
`tests/fixtures/`. Every ONIX fixture and sample also has its validation
findings on record in `tests/expected/`, one line each, and a change in what
the validator reports fails until the record is regenerated with
`npm run test:update-expected` and the diff read. CI runs the suite, the lint,
and a check that the generated files still match their inputs.

For a visual check, load the extension unpacked and open one of the samples in
`Onix/`: the same record in both dialects, one with a handful of realistic
defects, and one that trips every finding kind. A generic XML page such as
`https://www.w3schools.com/xml/note.xml` should be left untouched.

## Code lists and schemas

`Resources/onix-codelists.js` and the two content models are generated from
the inputs in `tools/data/`: EDItEUR's code-list JSON (Issue 74), the ONIX
3.0 and 3.1 reference and short-tag schemas, and the 3.1 strict schema, read
for one thing only: its assertions say which list a value such as
`<ProductFormFeatureValue>` draws from under each sibling type code, which the
ordinary schema cannot express. They are committed so a fresh clone works
with no build step, and CI fails if they drift from their inputs.

To move to a new EDItEUR issue, replace the inputs and regenerate:

```bash
node tools/generate-codelists.js
node tools/generate-content-model.js --version=3.1
node tools/generate-content-model.js --version=3.0
```

Code lists come from
https://www.editeur.org/files/ONIX%20for%20books%20-%20code%20lists/ and the
schemas from EDItEUR's per-issue XSD bundles, the strict one from the
*Advanced* bundle.

## Release

```bash
# 1. give CHANGELOG.md's Unreleased section a version and date, commit
tools/release.sh 0.9.19        # bumps the manifest and package.json, commits, tags
git push origin main v0.9.19   # the tag push builds the zip and creates a GitHub release
```

Then upload that zip in the Chrome Web Store dashboard under **Package** and
submit for review. `CWS_LISTING.md` has the listing copy and reviewer notes.

## Known limitations

- **Very large documents.** Rendering is synchronous and the whole source is
  held in memory, so a file over about 10 MB freezes the tab while it renders.
  Validation is sliced and does not block.
- **blob: URLs** work, but **iframes** are not handled: only the top-level
  document is taken over.

Pages whose re-fetch fails, such as `file://` URLs, one-shot signed URLs and
endpoints behind an `Authorization` header, still work: the viewer falls back
to the document the browser already parsed.

## Security and privacy

The extension declares no permissions and no host permissions, has no
background worker, and makes exactly one network request: a same-origin
re-fetch of the page you are viewing. Nothing leaves your machine. See
[SECURITY.md](SECURITY.md) for the threat model and how to verify it.

## See also

- [CHANGELOG.md](CHANGELOG.md), release notes.
- [SECURITY.md](SECURITY.md), threat model and verification.
- [CWS_LISTING.md](CWS_LISTING.md), store listing copy.
- [CLAUDE.md](CLAUDE.md), design notes and rationale.

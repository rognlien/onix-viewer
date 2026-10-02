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
  identifiers, contributors, titles and prices fold to one line too. A file
  opens fully expanded; two presses of Collapse turn a feed of thousands into
  one line per product.
- **Block badges.** Each block inside a `<Product>` is labelled `Block N`, and
  a single-Product document lists its blocks in the toolbar.
- **Stepped Expand and Collapse.** Each press works one level. Collapse
  follows the shape of a message: first everything inside each Product and
  the Header, then the Products, then the root.
- **Dialect switch.** One button, or `t`, shows a short-tag file under
  reference names or a reference file under short tags. Copying follows the
  view: at the file's own dialect the copy is the source byte for byte,
  translated it is the converted ONIX with the matching namespace.
- **Download.** Saves the document as shown, so a translated view downloads
  the converted file, named `feed-short-tags.xml` or
  `feed-reference-names.xml`.
- **Validation.** Runs automatically against the bundled ONIX 3.0 or 3.1
  content model: missing, misplaced or unknown elements, codes outside their
  list — including the second-order lists a sibling selects, such as
  `<ProductFormFeatureValue>` under an accessibility, colour or hazard type —
  deprecated codes and elements with EDItEUR's advised replacement,
  datatype and attribute violations, uniqueness constraints, and ISBN-13,
  GTIN-13 and ISBN-10 check digits. Each finding is a pill on its row with the
  message in it; a row with several shows the first and `+n more`. Click a pill
  or the toolbar count, or press `v`, for the full list, and click an entry to
  jump to its row. The verdict is against the release the file declares; the
  selector at the toolbar's right end judges it against the other bundled
  release instead, for a feed about to move from 3.0 to 3.1, or a standalone
  `<Product>` that declares none. ONIX 2.1 and Acknowledgement messages have no bundled
  schema, so only their code lists are checked and the toolbar says so.
- **Copy node XML.** The `⋮` button on any element row copies that subtree as
  plain source.

Requires Chrome 119 or later.

## Install

**From the Chrome Web Store.** The preferred way:
[ONIX Viewer](https://chromewebstore.google.com/detail/onix-viewer/afdfkehnjkpgfhkgpacimefkkgfgkife).
Updates arrive on their own. To open local `.xml` files, enable **Allow
access to file URLs** under the extension's **Details** in `chrome://extensions`.

**From a release zip.** Download `onix-viewer-<version>.zip` from the
[releases page](https://github.com/rognlien/onix-viewer/releases), unzip it
somewhere permanent, then in `chrome://extensions` turn on **Developer mode**,
click **Load unpacked** and pick the folder. To open local `.xml` files, enable
**Allow access to file URLs** under the extension's **Details**. Chrome will
show a developer-mode banner on restart, and updates mean replacing the folder
and pressing the reload arrow on the card.

**For development.** Load the repo's `Resources/` folder the same way. After
an edit, press the reload arrow on the card and refresh the page.

In Firefox, load the same folder from `about:debugging#/runtime/this-firefox`
with **Load Temporary Add-on…** and pick `Resources/manifest.json`. The
Firefox build is in progress; `firefox/README.md` has the state of it.

In Safari 26 or later, turn on **Show features for web developers** under
Settings → Advanced, then under Settings → Developer allow unsigned
extensions and use **Add Temporary Extension…** on the same folder. A
temporary extension goes when Safari quits; for one that stays, build the
dev app instead: `npm run build:dev`, open
`dist/dev/safari/ONIX Viewer Dev/ONIX Viewer Dev.xcodeproj` in Xcode and
Run. That installs an "ONIX Viewer Dev" app beside any store copy, with
its own bundle identifier, and Safari lists its extension under that name,
saying `-dev` in About. `safari/README.md` has the rest of the Safari story.

`npm run build:dev` builds all three browsers' packages into `dist/dev/`
without bumping the version: the store builds with the `-dev` version name
kept, so a local install is never mistaken for the store's. `npm run clean`
empties `dist/`.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `/` | Open search; `Enter` and `Shift+Enter` step through matches, `Esc` closes |
| `e` | Expand one level |
| `c` or `b` | Collapse one level |
| `t` | Switch between reference names and short tags |
| `v` | Open the findings list |
| `w` | Toggle soft wrap |
| `?` | About ONIX Viewer: version, code-list issue, these shortcuts. Clicking the owl does the same |

## Test

```bash
npm install
npm test                  # the jsdom suite, under ten seconds
npm test -- validation    # only tests whose name or block matches
npm run lint              # ESLint over the scripts, tools and tests
npm run test:browser      # the extension in a headless Chrome, if one is installed
npm run test:oracle       # the content models against libxml2 and EDItEUR's own XSDs
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
git push origin main v0.9.19   # the tag push builds the packages and creates a GitHub release
npm run build                  # the same locally: dist/chrome/, dist/firefox/, dist/safari/
```

Each folder under `dist/` then holds everything one store's upload needs:
the package, the listing text, the screenshots, and the icon and promo
tiles where the store takes them. Upload the Chrome zip in the Chrome Web
Store dashboard under **Package** and submit for review; `chrome/listing.md`
has the listing copy and reviewer notes, and `firefox/listing.md` and
`safari/listing.md` the same for AMO and App Store Connect.

The store listing is https://chromewebstore.google.com/detail/onix-viewer/afdfkehnjkpgfhkgpacimefkkgfgkife;
the item ID is derived from the signing key and does not change between
versions. `site/index.html` links it, and a test holds it to that ID. After
changing the page, commit and run `tools/publish-site.sh`, which syncs `site/`
into the maendeleo-site repo's `onix-viewer/`, commits there and pushes; the
host deploys from that push. It refuses to overwrite an edit made in the site
repo, and `--dry-run` shows what would change.

### Source for addons.mozilla.org

AMO asks for the source whenever the upload contains generated files, and
three of ours are: `Resources/onix-codelists.js` and the two content models,
written by the generators in `tools/` from the committed inputs in
`tools/data/`. The Firefox package build writes the archive beside the zip,
`dist/firefox/onix-viewer-<version>-firefox-source.zip`: the working tree
minus editor and tool config. To reproduce the upload from it, with Node 20
or later, `zip`, and the dev dependencies (the generators parse the schemas
with jsdom):

```bash
npm ci
node tools/generate-codelists.js
node tools/generate-content-model.js --version=3.1
node tools/generate-content-model.js --version=3.0
tools/package-extension.sh --target=firefox   # dist/firefox/onix-viewer-<version>-firefox.zip
```

The generators are byte-stable, so `git status` stays clean, and the zip
matches `Resources/` file for file except for the manifest edits the
packager makes.

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

## Licence

MIT. See [LICENSE](LICENSE).

## See also

- [CHANGELOG.md](CHANGELOG.md), release notes.
- [SECURITY.md](SECURITY.md), threat model and verification.
- [chrome/listing.md](chrome/listing.md), store listing copy.
- [CLAUDE.md](CLAUDE.md), design notes and rationale.

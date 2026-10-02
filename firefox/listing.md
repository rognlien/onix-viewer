# AMO listing — paste-ready copy

The addons.mozilla.org record for the Firefox build, in the shape the
Developer Hub asks for it. `chrome/listing.md` is the Chrome equivalent and the
source of the wording, `safari/listing.md` the App Store's; keep the three
saying the same thing. The build and the source archive are in `firefox/README.md`
and the README.

## Build and upload

```bash
tools/package-extension.sh --target=firefox
# → dist/firefox/: onix-viewer-<version>-firefox.zip, the manifest pruned for
#   Firefox; onix-viewer-<version>-firefox-source.zip, the source archive AMO
#   asks for, since three shipped files are generated; and beside them this
#   file, the screenshots and the 128px icon, for the upload forms
```

Upload the first at https://addons.mozilla.org/developers/ → the add-on →
*Upload New Version*, choose **On this site**, and upload the second at the
*source code* step with the reviewer notes below. Every version goes through
review; the listed fields below are set once and edited from the add-on's
*Edit Product Page*.

## Product page

**Name** (max 50 chars):

```
ONIX Viewer
```

**Add-on URL** (the slug): `onix-viewer`

**Summary** (max 250 chars, shown in search results and at the top of the page):

```
Readable ONIX XML: a collapsible tree, one-line product summaries, EDItEUR code-list labels beside every value, and automatic validation against the ONIX 3.0 and 3.1 schemas. Acts only on ONIX; every other page is left to Firefox.
```

**Description** (Markdown-ish; AMO allows `<b>`, `<i>`, `<ul>`, `<li>`, `<a>`):

```
ONIX Viewer turns raw ONIX XML into a readable, collapsible tree inside
Firefox. Instead of a wall of tags you get syntax highlighting, one-line
product summaries and every EDItEUR code list resolved in place.

<b>Features</b>

<ul>
<li>Collapsible, syntax-highlighted XML tree</li>
<li>Automatic validation against the bundled ONIX 3.0 and 3.1 content
models: missing or misplaced elements, codes that aren't in their EDItEUR
list (including the lists a sibling selects, such as accessibility details,
cover colours and hazard warnings), codes and elements EDItEUR has
deprecated (naming the replacement), ISBN-13 / GTIN-13 / ISBN-10 check
digits, and values that break their datatype — each pinned to the row it
concerns, with a jump-to-row list</li>
<li>Read and copy the other dialect: one switch shows a short-tag file under
reference names, or the reverse, and the copy follows what you see</li>
<li>&lt;Product&gt; blocks fold to a one-line summary (ISBN · form · title),
so two presses of Collapse make a 10,000-product feed scannable</li>
<li>Code-list labels (ProductIDType, ProductForm, ContributorRole,
LanguageCode, CountryCode, …) shown beside every value</li>
<li>One-click popup listing every entry of a code list, linked to the
EDItEUR definition page — all 165 lists bundled</li>
<li>Large feeds open fast: products are rendered as you scroll to them</li>
<li>Search that sees folded rows, keyboard shortcuts, soft wrap, dark mode,
copy of any node's XML</li>
<li>Detects ONIX 2.1, 3.0 and 3.1 in both reference and short-tag dialects,
plus the ONIX Acknowledgement message</li>
</ul>

<b>How it works</b>

The extension acts only on pages served as XML whose content is ONIX: the
EDItEUR namespace or an ONIX root element. Every other page — HTML, JSON,
RSS, generic XML — is left exactly as Firefox shows it. Nothing is stored,
nothing is sent anywhere, and the only
network request is a re-fetch of the page you are already viewing, to read
its source. Local .xml files work too.

ONIX for Books and its code lists are developed and maintained by EDItEUR
(https://www.editeur.org/8/ONIX/), which holds the copyright and makes them
freely available. ONIX Viewer is an independent tool, not affiliated with
or endorsed by EDItEUR. The source is public at
https://github.com/rognlien/onix-viewer.
```

**Categories** (up to two): **Web Development**, **Other**.

**Tags**: whichever of AMO's fixed list fit; `developer tools` if offered.

**Support email**: none. **Support website**:
`https://github.com/rognlien/onix-viewer/issues`

**Homepage**: `https://maendeleo.io/onix-viewer/`

**Licence**: **MIT License** (in AMO's list; the repo's `LICENSE`).

**Privacy policy**: AMO asks whether the add-on has one. Answer yes and
paste this, which is the published policy in one paragraph:

```
ONIX Viewer collects no data, stores nothing and sends nothing anywhere.
Its only network request is a re-fetch of the page you are already
viewing, from the same address, to read the XML source. The full policy is
at https://maendeleo.io/onix-viewer/privacy.html and the source at
https://github.com/rognlien/onix-viewer.
```

**Data collection**: the manifest declares
`data_collection_permissions: { required: ["none"] }`, which AMO reads as
"This add-on doesn't collect data"; there is nothing to fill in.

**Icon**: `Resources/icons/icon-128.png` (AMO wants 128 × 128, and shows it
at 64).

**Screenshots**: `firefox/screenshots/Main.png`, `CodeList.png`,
`Violations.png`, taken by `npm run screenshots:firefox` at 1280 × 800 — the
same three views as the Chrome set, from Firefox. Captions, one per file:

```
The tree: product summaries, code-list labels beside every value, the
verdict in the toolbar.
Every entry of a code list, one click from the value, linked to EDItEUR.
The findings list: each departure from the ONIX schema, and where it is.
```

## Per version

**Release notes**: the release's section of `CHANGELOG.md`.

**Notes to reviewer** (paste into the version's notes and again at the
source step):

```
Firefox build of ONIX Viewer, an MIT-licensed web extension whose source is
https://github.com/rognlien/onix-viewer, tagged v<version> for this upload.

What it does: on a page served as XML whose content is ONIX (EDItEUR's
namespace or an ONIX root element), it replaces the page with a readable
tree of the same document, with EDItEUR code-list labels and validation
findings. On every other page it does nothing.

Permissions: none. No host permissions; the content script's <all_urls> match is gated by
the response Content-Type and a sniff of the source. No background page. No
remote code. One network request in the whole bundle: a same-origin
re-fetch of the page's own URL, to read the XML source.

Generated files: Resources/onix-codelists.js, onix-thema.js,
onix-content-model-3.0.js and onix-content-model-3.1.js are written by the
generators in tools/ from the committed inputs in tools/data/ (EDItEUR's
code-list JSON, Thema JSON and XSDs). The
source archive is the whole repository; to rebuild, with Node 20 or later:

  npm ci
  node tools/generate-codelists.js
  node tools/generate-thema.js
  node tools/generate-content-model.js --version=3.1
  node tools/generate-content-model.js --version=3.0
  tools/package-extension.sh --target=firefox

The generators are byte-stable, and the zip matches Resources/ file for
file except for the manifest edits the packager makes (it removes
version_name and minimum_chrome_version).

To test: open https://maendeleo.io/onix/samples/3.1-message-full.xml, a
valid ONIX 3.1 message, and
https://maendeleo.io/onix/samples/3.1-message-every-fault.xml, which is
built to break the schema. https://www.w3schools.com/xml/simple.xml is
generic XML and is left as Firefox shows it.
```

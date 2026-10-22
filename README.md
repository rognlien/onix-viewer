# ONIX Viewer

[![Tests](https://github.com/rognlien/onix-viewer/actions/workflows/test.yml/badge.svg)](https://github.com/rognlien/onix-viewer/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/rognlien/onix-viewer)](https://github.com/rognlien/onix-viewer/releases/latest)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/afdfkehnjkpgfhkgpacimefkkgfgkife?label=chrome%20web%20store)](https://chromewebstore.google.com/detail/onix-viewer/afdfkehnjkpgfhkgpacimefkkgfgkife)
[![Users](https://img.shields.io/chrome-web-store/users/afdfkehnjkpgfhkgpacimefkkgfgkife)](https://chromewebstore.google.com/detail/onix-viewer/afdfkehnjkpgfhkgpacimefkkgfgkife)
[![Permissions: none](https://img.shields.io/badge/permissions-none-brightgreen)](SECURITY.md)
[![Licence: MIT](https://img.shields.io/github/license/rognlien/onix-viewer)](LICENSE)

A browser extension for Chrome, Firefox and Safari that turns raw ONIX for
Books XML into a readable tree, with EDItEUR code-list labels inline and
validation as the file opens.

It acts only on ONIX served as XML. Everything else (RSS, generic XML, XHTML,
SVG) is left to the browser.

## Features

- **Code lists.** Every code gets its label (`BB → Hardback`) and a chip that
  opens the whole list. Attributes, second-order lists and Thema subject
  codes are resolved too.
- **Validation.** Against the bundled ONIX 3.0 or 3.1 schema: structure, code
  lists, datatypes, uniqueness, deprecations and ISBN/GTIN check digits. Each
  finding sits on its row; the count in the toolbar opens the full list.
- **Reference names ↔ short tags.** View a file in the other dialect, and
  copy or download it converted.
- **Folding.** Rows fold to one-line summaries (`ISBN · form · title`), and
  Expand and Collapse work a level at a time.
- **Search.** Names, values and code-list labels across the whole file,
  including folded rows and Products not yet on screen.
- **Large files.** Products render as they scroll into view, and search and
  validation run without blocking the page. A 10,000-product feed (176 MB)
  opens in about 5 seconds. Files over 500 MB get a notice instead.

## Install

- **Chrome 119+:** [Chrome Web Store](https://chromewebstore.google.com/detail/onix-viewer/afdfkehnjkpgfhkgpacimefkkgfgkife).
  For local files, turn on *Allow access to file URLs* in the extension's
  details.
- **Firefox 140+:** [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/onix-viewer/).
  Local files need no setting.
- **Safari 18+ (macOS 15+):** [Mac App Store](https://apps.apple.com/app/onix-viewer/id6816859194?mt=12).
  Open the app once, turn the extension on in Safari's *Settings →
  Extensions*, then choose *Always Allow on Every Website* from its toolbar
  button.
- **From source:** in `chrome://extensions`, turn on Developer mode, click
  *Load unpacked* and pick `Resources/`. Building the Safari app is described
  in [safari/](safari/README.md).

## Standalone page

The viewer also builds as one script for an ordinary web page, with no
extension. You load and decode the XML; the script renders it.

```html
<pre id="fallback">…</pre>
<script src="onix-viewer-standalone.js"></script>
<script>
  OnixViewerStandalone.open(xmlText, { title: "Feed", fallback: document.getElementById("fallback") });
</script>
```

Build it with `npm run build:standalone`. It writes
`dist/standalone/onix-viewer-standalone.js`, the same bytes every time. The
header carries the MIT notice, the repository and the commit it came from,
marked `+dirty` when an input has changed.

Loading the script defines `window.OnixViewerStandalone` with one function,
`open(xml, { title, fallback } = {})`.

- **`xml`** is XML text, already decoded. There is no size limit on this path;
  the 500 MB guard belongs to the extension's content script.
- **The host** is the current document. It must be an ordinary HTML document
  with nothing in `document.body` you want to keep, and `open()` runs once per
  document.
- **Well-formed XML** gets the tree, toolbar, search, wrap, fold and expand,
  code-list popup and Copy. `open()` returns `{ rendered: true, parsed: true }`
  and removes `fallback` if it is an element.
- **Malformed XML** gets the viewer's parse-error panel and a hidden toolbar.
  `fallback` stays. `open()` returns `{ rendered: true, parsed: false }`.
- **Errors.** A non-string `xml` throws a `TypeError`. A second call, or a
  document without a `body`, throws an `Error`. A call that fails before
  the viewer starts removes what it added and can be tried again. A failure
  inside the viewer is final.
- **Left out.** No dialect switch (`t` does nothing, and a stored `oxv-dialect`
  is ignored), no validation (`v`), no About (`?`), no download, no release
  select and no custom rules.
- **Copy** puts the text you passed in on the clipboard through the Clipboard
  API. Where the browser refuses that, the viewer falls back to copying through
  a textarea, which normalises CRLF line endings to LF.

The script injects an inline `<style>` into the document's `<head>`. A page
with a strict `style-src` must allow it. It also publishes the viewer's usual
`window.OnixViewer*` globals (`OnixViewerOnix`, `OnixViewerCodeLists` and so
on) next to `OnixViewerStandalone`.

The extension is unchanged.

## Keyboard

| Key | Action |
|-----|--------|
| `/` | Search; `Enter` / `Shift+Enter` step through hits, `Esc` closes |
| `e` / `c` | Expand / collapse one level |
| `t` | Switch between reference names and short tags |
| `v` | Open the findings list |
| `w` | Wrap long lines |
| `?` | About, with these shortcuts |

## Development

```bash
npm install
npm test               # the jsdom suite, about 8 s
npm run lint
npm run test:browser   # the extension in a headless Chrome
npm run build          # the store packages, into dist/
```

The code lists, Thema and the content models are generated from EDItEUR's
files in `tools/data/` and committed; CI fails if they drift. Each test
fixture's purpose is in [tests/fixtures/](tests/fixtures/README.md).

## Privacy

No permissions, no background worker, and one network request: the page you
are viewing, fetched again from its own origin. Nothing leaves your machine.
See [SECURITY.md](SECURITY.md).

## Licence

MIT. See [LICENSE](LICENSE).

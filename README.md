# ONIX Viewer

[![Tests](https://github.com/rognlien/onix-viewer/actions/workflows/test.yml/badge.svg)](https://github.com/rognlien/onix-viewer/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/rognlien/onix-viewer)](https://github.com/rognlien/onix-viewer/releases/latest)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/afdfkehnjkpgfhkgpacimefkkgfgkife?label=chrome%20web%20store)](https://chromewebstore.google.com/detail/onix-viewer/afdfkehnjkpgfhkgpacimefkkgfgkife)
[![Users](https://img.shields.io/chrome-web-store/users/afdfkehnjkpgfhkgpacimefkkgfgkife)](https://chromewebstore.google.com/detail/onix-viewer/afdfkehnjkpgfhkgpacimefkkgfgkife)
[![Permissions: none](https://img.shields.io/badge/permissions-none-brightgreen)](SECURITY.md)
[![Licence: MIT](https://img.shields.io/github/license/rognlien/onix-viewer)](LICENSE)

A browser extension that turns raw ONIX for Books XML into a readable tree,
with EDItEUR code-list labels inline and validation as the file opens.

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
- **ONIX 3.0 → 3.1.** See every change a 3.0 file needs to become 3.1, graded
  automatic, for review or manual, with the XML before and after, and copy or
  download the converted file.
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
- **From source:** in `chrome://extensions`, turn on Developer mode, click
  *Load unpacked* and pick `Resources/`.
- **Safari:** in progress; see [safari/](safari/README.md).

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
files in `tools/data/` and committed; CI fails if they drift. Design notes,
the release steps and the reasoning behind both are in [CLAUDE.md](CLAUDE.md).

## Privacy

No permissions, no background worker, and one network request: the page you
are viewing, fetched again from its own origin. Nothing leaves your machine.
See [SECURITY.md](SECURITY.md).

## Licence

MIT. See [LICENSE](LICENSE).

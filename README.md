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
  From Firefox 153, for local files, turn on *Access local files on your
  computer* under the add-on's *Permissions and data* in `about:addons`.
- **Safari 18+ (macOS 15+):** [Mac App Store](https://apps.apple.com/app/onix-viewer/id6816859194?mt=12).
  Open the app once, turn the extension on in Safari's *Settings →
  Extensions*, then choose *Always Allow on Every Website* from its toolbar
  button.
- **From source:** in `chrome://extensions`, turn on Developer mode, click
  *Load unpacked* and pick `Resources/`. Building the Safari app is described
  in [safari/](safari/README.md).

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

Each store's folder in `dist/` also holds what its listing needs: the
listing copy, the screenshots and, per store, the icon, promo tiles and
release notes. `listing-changes.md` beside them opens with a checklist of
what to do in the store since the previous release tag (the package, each
changed field, each changed image with the file in `dist/` to upload), then
the new text of each changed field, ready to paste. `LISTING_SINCE=v0.9.21 npm run build`
compares with another tag, for when a version never reached a store.

The code lists, Thema, the content models and the table of their versions
are generated from EDItEUR's files in `tools/data/` and committed; CI fails if
they drift. Each test
fixture's purpose is in [tests/fixtures/](tests/fixtures/README.md).

## Privacy

No permissions, no background worker, and one network request: the page you
are viewing, fetched again from its own origin. Nothing leaves your machine.
See [SECURITY.md](SECURITY.md).

## Licence

MIT. See [LICENSE](LICENSE).

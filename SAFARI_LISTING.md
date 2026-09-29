# App Store listing — paste-ready copy

The Mac App Store record for the Safari extension, in the shape App Store
Connect asks for it. `CWS_LISTING.md` is the Chrome equivalent and the
source of the wording, `AMO_LISTING.md` the Firefox one; keep the three
saying the same thing. The build itself
is `SAFARI.md` → *Distribution*.

## App information

**Name** (max 30 chars):

```
ONIX Viewer
```

**Subtitle** (max 30 chars):

```
Readable ONIX XML in Safari
```

**Bundle ID**: `io.maendeleo.ONIX-Viewer` — registered by Xcode on the
first archive.

**SKU**: `onix-viewer`

**Primary category**: Developer Tools. **Secondary**: Utilities.

**Privacy policy URL**: `https://maendeleo.io/onix-viewer/privacy.html`
(the page in `site/`, published with the rest of the site).

**Support URL**: `https://github.com/rognlien/onix-viewer/issues`

**Marketing URL**: `https://maendeleo.io/onix-viewer/`

**Copyright**: `2026 Bendik Rognlien Johansen`

**Age rating**: answer every question "None"; the result is 4+.

## Version information

**Promotional text** (max 170 chars, editable without a new build):

```
Open any ONIX feed in Safari and read it: a collapsible tree, EDItEUR code lists resolved in place, and validation against the ONIX 3.0 and 3.1 schemas.
```

**Description** (max 4,000 chars):

```
ONIX Viewer turns raw ONIX XML into a readable, collapsible tree inside
Safari. Instead of a wall of tags you get syntax highlighting, one-line
product summaries and every EDItEUR code list resolved in place.

Features

  • Collapsible, syntax-highlighted XML tree
  • Automatic validation against the bundled ONIX 3.0 and 3.1
    content models: missing or misplaced elements, codes that aren't
    in their EDItEUR list (including the lists a sibling selects, such
    as accessibility details, cover colours and hazard warnings),
    codes and elements EDItEUR has deprecated (naming the
    replacement), ISBN-13 / GTIN-13 / ISBN-10 check digits, and values
    that break their datatype — each pinned to the row it concerns,
    with a jump-to-row list
  • Read and copy the other dialect: one switch shows a short-tag
    file under reference names, or the reverse, and the copy follows
    what you see
  • <Product> blocks fold to a one-line summary (ISBN · form · title),
    so two presses of Collapse make a 10,000-product feed scannable
  • Code-list labels (ProductIDType, ProductForm, ContributorRole,
    LanguageCode, CountryCode, …) shown beside every value
  • One-click popup listing every entry of a code list, linked to
    the EDItEUR definition page — all 165 lists bundled
  • Your own rules: paste a Schematron rule set behind the toolbar's
    cog and it is checked on every document alongside the schema
  • Large feeds open fast: products are rendered as you scroll to them
  • Search that sees folded rows, keyboard shortcuts, soft wrap, dark
    mode, copy of any node's XML

How it works

  The extension acts only on pages served as XML whose content is
  ONIX: the EDItEUR namespace or an ONIX root element. Every other
  page — HTML, JSON, RSS, generic XML — is left exactly as Safari
  shows it. Nothing is stored except the rules you paste in, nothing
  is sent anywhere, and the only network request is a re-fetch of the
  page you are already viewing, to read its source.

  After installing, turn the extension on in Safari → Settings →
  Extensions, and allow it on the sites your ONIX comes from — or on
  every website, since a feed can be served from any URL.

ONIX for Books and its code lists are developed and maintained by
EDItEUR, which holds the copyright and makes them freely available.
ONIX Viewer is an independent tool, not affiliated with or endorsed
by EDItEUR. The source is public at github.com/rognlien/onix-viewer.
```

**Keywords** (max 100 chars, comma-separated):

```
ONIX,XML,EDItEUR,books,metadata,publishing,ISBN,viewer,validation,code list
```

**What's New**: the release's section of `CHANGELOG.md`, first person
plural removed.

## App Privacy

**Data collection**: **Data Not Collected.** The extension stores one
thing on the user's own machine — the validation rules they paste in —
and sends nothing anywhere. The re-fetch of the page's own URL is the
page's own origin. Answer the questionnaire accordingly; there is no
tracking, no third-party SDK, and no identifier.

## Screenshots

The Mac App Store wants screenshots of the **app** at a Mac size — 1280 ×
800 is one it accepts, also 1440 × 900, 2560 × 1600 and 2880 × 1800 — and
takes up to ten. Use:

1. `Screenshots/Safari/Main.png`, `CodeList.png`, `Violations.png` — the
   extension at work, taken by `npm run screenshots:safari`. Safari cannot
   be driven headless (puppeteer has no Safari, and safaridriver's
   automation windows are isolated like private browsing, where the
   extension is off), so the script uses the Safari you have open: it
   opens a tab on the served sample in the front window, sizes the window
   until the viewport is exactly 1280 × 800, captures the window with
   `screencapture` and crops the viewport out of it (a window is captured
   wherever it sits, where a screen rectangle that hangs off a 900-row
   display is refused), opens the two popups by script, and closes the tab.
   Before the first run, once each: the extension on and allowed on
   127.0.0.1 in that window's profile; Safari → Settings → Developer →
   *Allow JavaScript from Apple Events*; and Screen Recording for the
   terminal under System Settings → Privacy & Security, without which the
   captures show the wallpaper. Keep the pointer off the window while it
   runs. On a Retina display the files are 2560 × 1600, which App Store
   Connect accepts alongside 1280 × 800; a dark system appearance is set
   light for the run and put back.
2. One of the host app's window — the converter's template: the owl, the
   extension's state, and the button that opens Safari's Extensions
   settings — taken by hand with ⇧⌘4 at 1280 × 800 or larger.

## Review notes (paste into "Notes")

```
This is a Safari web extension with a stock containing app generated by
Apple's safari-web-extension-converter; the app's one job is to say whether
the extension is enabled and open Safari's Extensions settings.

What the extension does: on a page served as XML whose content is ONIX
(EDItEUR's namespace or an ONIX root element), it replaces the page with a
readable tree of the same document, with EDItEUR code-list labels and
validation findings. On every other page it does nothing.

Permissions: "storage" only, holding the validation rules the user pastes
in. No host permissions. No background page. No remote code. One network
request in the whole bundle: a same-origin re-fetch of the page's own URL,
to read the XML source.

Data: none collected, none sent. See the privacy policy.

To test: enable the extension and allow it on all websites, then open
https://maendeleo.io/onix/samples/3.1-message-full.xml — a valid ONIX 3.1
message — and https://maendeleo.io/onix/samples/3.1-message-every-fault.xml,
which is built to break the schema. https://www.w3schools.com/xml/simple.xml
is generic XML and is left as Safari shows it.

Source: https://github.com/rognlien/onix-viewer, tagged v<version> for this
build; the extension's files in the app bundle are the contents of that
tag's Resources/ with the manifest pruned for Safari, which
tools/package-extension.sh --target=safari reproduces.
```

## Known limitation to state on the listing

Safari does not run extensions on `blob:` URLs, which is how some web apps
open a fetched file in a new tab. Such a file shows as raw XML in Safari;
in Chrome and Firefox it is taken over. `SAFARI.md` has the details and
what an app can do instead.

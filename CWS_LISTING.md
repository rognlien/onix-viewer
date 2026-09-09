# Chrome Web Store listing — copy & checklist

Paste-ready text for the CWS Developer Dashboard fields. Update the version
number when you regenerate the zip via `tools/package-extension.sh`.

## Build

```bash
tools/package-extension.sh
# → dist/onix-viewer-0.9.16.zip
```

Upload that file at https://chrome.google.com/webstore/devconsole.

## Item details

**Item name** (max 45 chars):

```
ONIX Viewer
```

**Summary / short description** (max 132 chars):

```
Readable ONIX XML in Chrome: collapsible tree, product summaries, inline EDItEUR code-list labels and automatic validation.
```

**Description** (longer marketing copy — paste into Detailed description):

```
ONIX Viewer turns raw ONIX XML into a readable, collapsible tree inside
Chrome. Instead of a wall of tags you get syntax highlighting, one-line
product summaries and every EDItEUR code list resolved in place.

Features

  • Collapsible, syntax-highlighted XML tree
  • Automatic validation against the bundled ONIX 3.0 and 3.1
    content models: missing or misplaced elements, codes that aren't
    in their EDItEUR list, codes and elements EDItEUR has deprecated
    (naming the replacement), ISBN-13 / GTIN-13 / ISBN-10 check
    digits, and values that break their datatype — each pinned to
    the row it concerns, with a jump-to-row list
  • Read and copy the other dialect: one switch shows a short-tag
    file under reference names, or the reverse, and the copy follows
    what you see
  • <Product> blocks auto-collapse to a one-line summary
    (ISBN · form · title), so a 10,000-product feed stays scannable
  • Code-list labels (ProductIDType, ProductForm, ContributorRole,
    LanguageCode, CountryCode, …) shown beside every value
  • One-click popup listing every entry of a code list, linked to
    the EDItEUR definition page — all 165 lists bundled
  • Expand and Collapse a level at a time, search, soft-wrap toggle,
    and Copy node XML for any subtree
  • Detects ONIX 2.1, 3.0 and 3.1 in both reference and short-tag
    dialects, plus the ONIX Acknowledgement message
  • Leaves non-ONIX XML (RSS, SOAP, generic XML) to the browser's
    native viewer

Works on remote URLs and on local .xml files (enable "Allow access to
file URLs" under chrome://extensions → Details).

ONIX for Books and its code lists are developed and maintained by
EDItEUR (https://www.editeur.org/8/ONIX/), which holds the copyright
and makes them freely available. ONIX Viewer bundles the published
code lists for offline lookup. It is an independent tool, not
affiliated with or endorsed by EDItEUR.
```

**Category**: `Developer Tools` (or `Productivity` — both are reasonable)

**Language**: English (United Kingdom) or English (United States)

## Privacy practices (required tab in Dashboard)

**Single purpose**:

```
Make a raw ONIX XML page readable in the browser: render it as a collapsible
tree, resolve its EDItEUR code lists inline, and report where it departs from
the ONIX schema. All three describe the same page the user has open; nothing
is stored, sent anywhere, or acted on beyond displaying it.
```

Keep this consistent with the store description. The description now leads
with validation, so a single-purpose statement that mentioned only rendering
would read as two purposes to a reviewer — validation is part of *reading* an
ONIX file, not a second feature, and the wording should say so.

**Permission justifications**:

| Permission | Justification |
|---|---|
| `content_scripts.matches: <all_urls>` | No `permissions` and no `host_permissions` are declared at all; this is the content script's match pattern. Two-layer activation: (1) only on pages whose response Content-Type is `application/xml`, `text/xml`, or `application/onix+xml`; (2) only on documents whose source carries the EDItEUR ONIX namespace (`ns.editeur.org/onix`), an `<ONIXMessage>` root, or a `<Product>` root with a corroborating ONIX child. Any other page — HTML, JSON, RSS, generic XML — is left untouched, and the browser's own viewer handles it. The pattern has to be broad because a server can return ONIX from any URL; the gate is the Content-Type and the sniff, not the pattern. |
| `web_accessible_resources.matches: <all_urls>` | The viewer runs in the **page's** world, not the content script's: `content.js` replaces the document and appends ordinary `<script src="chrome-extension://…">` tags for the eight viewer scripts, the stylesheet and one icon, so the page has to be allowed to load them. The match pattern is `<all_urls>` for the same reason as above — ONIX can be served from any URL. What this exposes is the extension's own static files, which are public in the repository and in the package; it grants the page none of the extension's privileges, and there are no permissions to borrow. |

Worth stating plainly in the same field: **`permissions` and
`host_permissions` are both empty arrays.** Reviewers scanning for sensitive
access find nothing to weigh, and it is easy to miss that the only broad thing
here is a content-script match pattern.

**Remote code use**: **No, I am not using remote code**.
(All scripts are bundled inside the extension. No `eval`, no remote `<script src>`, no fetched/cached code. The only network request is a re-fetch of the page's own URL to obtain the XML source.)

**Data usage**:

- **Personally identifiable information**: not collected
- **Health information**: not collected
- **Financial / payment information**: not collected
- **Authentication information**: not collected
- **Personal communications**: not collected
- **Location**: not collected
- **Web history**: not collected
- **User activity**: not collected
- **Website content**: **read locally**. Tick the box that applies — the
  extension reads the XML body of pages the user visits to render it.
  None of that content leaves the user's machine.

**Certifications**:

- ☑ I do not sell or transfer user data to third parties, outside of the
  approved use cases.
- ☑ I do not use or transfer user data for purposes that are unrelated to
  my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or
  for lending purposes.

**Privacy policy URL**: not required for an extension that doesn't collect
data — but if the dashboard insists, host a one-pager somewhere
(e.g. a GitHub Pages page) saying "ONIX Viewer collects no data and
makes no network requests outside re-fetching the page the user is
viewing."

## Visibility

**Public** — anyone can find and install.
**Unlisted** — only people with the link.
**Private** — only members of a configured Google Workspace group.
For internal Bokbasen use, **Private** is the cleanest fit. Configure the
group in the dashboard under "Distribution" once the org is connected.

## Listing assets to prepare

| Asset | Size | Where it comes from |
|---|---|---|
| Store icon | 128 × 128 PNG | `Resources/icons/icon-128.png`, baked by `tools/render-icons.sh` |
| Small promo tile | 440 × 280 | rendered from `promo-tile.svg` |
| Marquee promo tile | 1400 × 560 | rendered from `marquee.svg` |
| Screenshot(s) | 1280 × 800 | **`Screenshots/`** — committed, upload as-is |

**Screenshots live in `Screenshots/` and are version-controlled**, already at
1280 × 800, so they upload without a resize step. Re-take them there whenever
the UI changes and commit the result; that is the record of what the listing
shows. `Screenshots/Main.png` is the tree, `Screenshots/CodeList.png` the
code-list popup.

The icon and the two promo tiles are **generated**, so they are not committed —
`dist/` is gitignored in full. Rebuild them into `dist/listing/` when you need
to upload:

```bash
cp Resources/icons/icon-128.png dist/listing/icon-128.png
rsvg-convert -w 440  -h 280 promo-tile.svg -o dist/listing/promo-tile-440x280.png
rsvg-convert -w 1400 -h 560 marquee.svg    -o dist/listing/marquee-1400x560.png
```

Do not keep screenshots in `dist/listing/` as well. There were two there from
May, and because nothing kept them in sync with `Screenshots/` they quietly
went two UI revisions out of date while the committed pair moved on.

Further shots worth adding, if you want more than two:

1. The validation findings list over a file with real defects — the feature
   with no equivalent anywhere else, and the reason to install.
2. The same record under both dialects, showing the switch.

## Review notes (paste into "Notes for reviewer")

```
Summary for review:
  - permissions: []  and  host_permissions: []  — both empty.
  - No background service worker, no remote code, no eval, no new Function.
  - One network request in the whole bundle: a same-origin re-fetch of the
    page's own URL to read the XML source.
  - No telemetry, no analytics, no third-party libraries at runtime.
  - The only broad declaration is the content script's match pattern, which
    has to be broad because a server can return ONIX from any URL. The
    activation gate is the Content-Type and the sniff below, not the pattern.

Activation gate (both must pass, or the page is left untouched):
  1. Content-Type is application/xml, text/xml or application/onix+xml.
     On anything else the content script bails at document_start.
  2. The first 2 KB of the source carries the EDItEUR ONIX namespace
     (ns.editeur.org/onix), an <ONIXMessage> root, or a <Product> root with a
     corroborating ONIX child. Generic XML, RSS, SOAP, XHTML and SVG are left
     to the browser's own viewer.

Source and verification:
  The full source is public at https://github.com/rognlien/onix-viewer,
  tagged v0.9.16 for this submission. The uploaded zip is the contents of
  Resources/ at that tag, built by tools/package-extension.sh, so it can be
  diffed against the tag directly. SECURITY.md in the repo documents the
  threat model and lists what to grep for.

Test pages:
  Acts on:        any URL serving ONIX as application/xml — e.g. save
                  Onix/onix-3.1-refnames.xml from the repo and open it as a
                  local file (enable "Allow access to file URLs" first).
  Does nothing:   https://www.w3schools.com/xml/cd_catalog.xml (generic XML)
                  https://www.w3schools.com/xml/simple.xml     (generic XML)
```

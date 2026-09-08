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
Render raw ONIX XML pages as a readable, collapsible tree, with inline
EDItEUR code-list resolution.
```

**Permission justifications**:

| Permission | Justification |
|---|---|
| `host_permissions: <all_urls>` | Two-layer activation: (1) only on pages whose response Content-Type is `application/xml`, `text/xml`, or `application/onix+xml`; (2) only on documents whose source contains the EDItEUR ONIX namespace (`ns.editeur.org/onix`) or an `<ONIXMessage>` root element. Any other page — HTML, JSON, RSS, generic XML — is left untouched. We need `<all_urls>` because we can't predict which URL will return ONIX, but in practice the extension only modifies ONIX feeds. |

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

| Asset | Size | Required? |
|---|---|---|
| Store icon | 128 × 128 PNG | Required (already in `icons/icon-128.png`) |
| Small promo tile | 440 × 280 | Required |
| Marquee promo tile | 1400 × 560 | Optional but recommended |
| Screenshot(s) | 1280 × 800 or 640 × 400 | At least 1 required, up to 5 |

`dist/` is gitignored in full, so these assets are rebuilt locally rather than
committed. The promo tile and marquee come from the SVGs at the repo root:

```bash
rsvg-convert -w 440  -h 280 promo-tile.svg -o dist/listing/promo-tile-440x280.png
rsvg-convert -w 1400 -h 560 marquee.svg    -o dist/listing/marquee-1400x560.png
```

**Screenshots need re-taking.** The two in `dist/listing/` are from May: they
predate the structure pane being hidden, the validation state, the dialect
switch, the search collapsing to an icon, the merged document pill, and the
Expand/Collapse buttons (which were three buttons then, named differently).
Nothing in them matches the shipping toolbar.

Worth grabbing, at 1280 × 800 (or 2× HiDPI then resized):

1. A real ONIX file: the syntax-highlighted tree with auto-collapsed
   `<Product>` summaries and code-list labels.
2. The validation findings list over a file with real defects — the feature
   with no equivalent anywhere else, and the reason to install.
3. The code-list popup, which makes the bundled-lists claim concrete.
4. Optionally the same record under both dialects, showing the switch.

## Review notes (paste into "Notes for reviewer")

```
The extension has a two-stage activation gate:

  1. Content-Type whitelist: application/xml, text/xml, application/onix+xml.
     On every other Content-Type the content script bails at document_start
     without modifying the page.
  2. ONIX sniff: the source must contain the EDItEUR ONIX namespace
     (ns.editeur.org/onix) or an <ONIXMessage> root element. Generic XML
     that doesn't look like ONIX is left for the browser's native viewer.

Test pages:
  https://www.w3schools.com/xml/cd_catalog.xml  (non-ONIX — extension does nothing)
  Any local file:// .xml file (after enabling Allow access to file URLs)
```

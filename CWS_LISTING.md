# Chrome Web Store listing — copy & checklist

Paste-ready text for the CWS Developer Dashboard fields. Update the version
number when you regenerate the zip via `tools/package-extension.sh`.

## Build

```bash
tools/package-extension.sh
# → dist/onix-viewer-0.9.3.zip
```

Upload that file at https://chrome.google.com/webstore/devconsole.

## Item details

**Item name** (max 45 chars):

```
ONIX Viewer
```

**Summary / short description** (max 132 chars):

```
Pretty-print ONIX XML in Chrome, with syntax highlighting, Product summaries and inline EDItEUR code-list resolution.
```

**Description** (longer marketing copy — paste into Detailed description):

```
ONIX Viewer turns raw ONIX XML pages into a readable view inside Chrome.
ONIX (the bibliographic-metadata format used across the publishing
industry) is normally shown as a wall of tags; this extension renders
it as a syntax-highlighted, collapsible tree with the EDItEUR code
lists wired in.

Features

  • Collapsible, syntax-highlighted XML tree
  • Search, expand-all, collapse-all, soft-wrap toggle
  • Auto-collapsed <Product> blocks with a one-line summary
    (ISBN · form · title) so a 10,000-product feed stays scannable
  • Resolved code-list labels (ProductIDType, ProductForm,
    ContributorRole, LanguageCode, CountryCode, …) inline beside
    every value
  • One-click popup showing every entry of any list (all 165
    EDItEUR lists bundled, ~4,750 codes), linked to the canonical
    EDItEUR definition page
  • ONIX 3.0 / 3.1 detection, both reference-name and short-tag
    dialects, plus older 2.1 docs
  • Leaves non-ONIX XML alone — the browser's native viewer
    handles RSS, generic XML and SOAP responses

Works on local .xml files (after enabling the per-extension toggle in
chrome://extensions → Details → Allow access to file URLs) as well as
remote URLs.

Built at Bokbasen — useful for anyone reading ONIX.
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

**Screenshot suggestion (re-take for 0.9.3)**: open a real ONIX file in the
extension and grab a 1280 × 800 (or 2× HiDPI then resize) shot of the
syntax-highlighted tree. A second shot of the code-list popup makes the
feature concrete. The old screenshots in `dist/listing/` were taken when
the structure pane was enabled and no longer match the shipping UI.

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

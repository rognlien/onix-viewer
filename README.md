# ONIX Viewer

A Chrome extension (Manifest V3) that pretty-prints raw ONIX XML pages with syntax highlighting and inline code-list resolution.

## What it does

When the browser loads a page whose `Content-Type` is `application/xml`, `text/xml`, or `application/onix+xml` **and the content looks like ONIX** (EDItEUR namespace, `<ONIXMessage>` root, or an `<ONIXMessageAcknowledgement>` root), the extension:

1. Re-fetches the source (the native viewer's DOM isn't reliable to read from).
2. Replaces the document with an indented, syntax-highlighted, foldable, searchable tree.
3. Detects the ONIX dialect (3.0 / 3.1 reference or short-tag, plus 2.1) and adds:
   - Distinct colour for ONIX element tags.
   - Auto-collapsed `<Product>` blocks with a one-line summary (ISBN · form · title) so you can scan thousands of products without scrolling forever.
   - Resolved code-list labels for every value the bundled EDItEUR lists know about — shown as a small `→ ISBN-13` style badge after the value, with a clickable `List N ↗` chip that opens a popup containing every code in that list (and a link to the canonical EDItEUR page).

It also recognises the ONIX **Acknowledgement** message (root `<ONIXMessageAcknowledgement>`) — the optional response format a recipient sends back to confirm or reject a feed. It's labelled `ONIX Acknowledgement 3.0` in the toolbar, and the status codes it's built from (`MessageStatus`, `RecordStatus`, status-detail severity, …) resolve to readable labels just like product code-lists.

Non-ONIX XML (RSS, generic XML, anything without an EDItEUR namespace) is left alone — the browser's native viewer handles it. XHTML and SVG are also skipped (browsers render them natively).

There's also a more ambitious "Structure" / "Split" pane that renders ONIX content as a higher-level cards-and-blocks view; it's bundled and tested but **disabled in the UI for the time being** while we get the tree-only experience polished. See `setupViewMode` in `viewer.js` for the one-line revert.

## Install (development)

1. `chrome://extensions` → toggle **Developer mode** (top right).
2. Click **Load unpacked** and pick the `Resources/` folder of this repo.
3. (Optional) Click **Details** on the extension card → enable **Allow access to file URLs** if you want to test against local `.xml` files.

Iteration loop: edit a file in `Resources/` → click the **reload** circular arrow on the extension card → refresh the test page.

## Install (for colleagues — before Chrome Web Store approval)

While the Chrome Web Store review is pending you can sideload the extension as an "unpacked" install. Send colleagues the most recent zip from `dist/` (e.g. `dist/onix-viewer-0.9.8.zip`) along with these steps:

1. Download the zip and unzip it somewhere stable — `~/Documents/onix-viewer/` is a good default. The folder must stay there after install; moving or renaming it later breaks the extension.
2. Open Chrome and go to `chrome://extensions`.
3. Toggle **Developer mode** (top-right).
4. Click **Load unpacked** (top-left), navigate to the unzipped folder, and select it.
5. The "ONIX Viewer" card appears. Click **Details** → enable **Allow access to file URLs** to open local `.xml` files.

**Caveats**

- Chrome shows a persistent "Disable developer mode extensions" banner on every restart. Dismissable but recurring. It goes away once the Web Store version is installed.
- **No auto-updates.** When a new version ships, send the new zip; recipients delete-and-reinstall, or replace the folder contents and click the reload arrow on the extension card.

For Workspace-managed Macs, IT can bypass all of the above by force-installing the packed `.crx` via the `ExtensionInstallForcelist` Chrome policy — gold-standard internal distribution, but needs an admin.

## Test it

### Fast loop — jsdom (~1 second)

```bash
npm install
npm test
```

Runs the full jsdom suite (56 tests) covering generic XML, ONIX 3.0/3.1 reference, ONIX short-tag, RSS, parse errors, code-list resolution, the code-list popup, product-summary edge cases (multi-title, GTIN-only, ISBN-10-only, proprietary-only), and the (currently disabled) structure view.

### Visual loop — Chrome

Pages worth opening:

- `https://www.w3schools.com/xml/note.xml` — small generic XML (extension stays out of the way; non-ONIX)
- A local ONIX `.xml` file — drag-drop into Chrome (after enabling **Allow access to file URLs**)
- Any HTTP-served ONIX feed — works without the file-URL toggle

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `Enter` | Next match |
| `Shift+Enter` | Previous match |
| `Esc` | Clear search |
| `e` | Expand all |
| `c` | Collapse all |
| `w` | Toggle line wrap |

## ONIX code lists

`Resources/onix-codelists.js` is **auto-generated** by `tools/generate-codelists.js` from two committed inputs:

- `tools/data/onix-codelists.json` — EDItEUR's published codelists JSON (currently Issue 73). The authoritative source of (list number, code, label).
- `tools/data/ONIX_BookProduct_3.1_reference.xsd` — the official ONIX 3.1 reference schema, used only for the element-name → list-number bindings (those rarely change between minor issues).

Both files are committed so the generator has no external dependencies and re-runs are reproducible offline.

It contains 165 lists with ~4,770 code/label pairs and 158 element bindings — about 190 KB unminified, ~50 KB gzipped. Multiple element names that share a list reference the same `Map` instance.

To regenerate (e.g. after EDItEUR publishes a new Issue):

```bash
# Refresh the JSON cache from EDItEUR
curl -fsSL "https://www.editeur.org/files/ONIX%20for%20books%20-%20code%20lists/ONIX_BookProduct_Codelists_Issue_73.json" \
  -o tools/data/onix-codelists.json

# Regenerate
node tools/generate-codelists.js
# or override inputs:
node tools/generate-codelists.js --json=/path/to/codelists.json --xsd=/path/to/reference.xsd
```

## Release

GitHub Actions (`.github/workflows/release.yml`) handles the boring parts; the actual CWS upload stays manual (Google's OAuth setup is too painful to be worth automating for a small extension).

To ship a new version:

```bash
tools/release.sh 0.9.9          # bumps manifest.json + package.json, commits, tags
git push origin main v0.9.9     # main commit and the tag
```

The tag push triggers the workflow, which runs tests, verifies the tag matches the manifest version, builds the zip, and creates a GitHub release with the zip attached.

Then upload to the store:

1. Open the [CWS developer dashboard](https://chrome.google.com/webstore/devconsole/).
2. Click the ONIX Viewer extension → **Package** → **Upload new package**.
3. Drag in the zip from the new GitHub release (`onix-viewer-X.Y.Z.zip`).
4. Click **Submit for review**.

Review time is up to Google — usually minutes to a few hours, occasionally days if anything trips heuristics.

## Known limitations

- **Authenticated XML endpoints** with `Authorization: Bearer …` headers — the content script's re-fetch can't replay them, so the native viewer is left alone for those.
- **One-shot signed URLs** (e.g. AWS S3 presigned URLs) — the re-fetch hits the URL a second time, which the signature usually rejects.
- **Very large documents** (>10 MB) — rendering is synchronous; you'll see a freeze.
- **Complex namespace prefix usage** — rendering preserves source `nodeName` exactly; namespace-aware lookup against URIs isn't implemented beyond ONIX detection.

## Security & privacy

See [SECURITY.md](SECURITY.md) for the threat model, the exhaustive list of what the extension can and can't do, and the one network call it makes (a same-origin re-fetch of the page you're viewing — no data leaves the origin). The extension declares zero `permissions` and zero `host_permissions`, so cross-origin exfiltration would be CORS-blocked by the browser, not just by absent code.

## See also

- [`CHANGELOG.md`](CHANGELOG.md) — version-by-version release notes.
- [`SECURITY.md`](SECURITY.md) — threat model, what the extension can and can't do, how to verify it.
- [`CLAUDE.md`](CLAUDE.md) — design rationale, the gotchas behind the takeover-pattern choice, and notes for Claude Code sessions iterating on this project.
- [`CWS_LISTING.md`](CWS_LISTING.md) — paste-ready copy for the Chrome Web Store dashboard.

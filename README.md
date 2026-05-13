# ONIX Viewer

A Chrome extension (Manifest V3) that pretty-prints raw XML pages — a richer version of Chrome's built-in XML viewer, with extra features for ONIX bibliographic data.

## What it does

When the browser loads a page whose `Content-Type` is `application/xml`, `text/xml`, or `application/onix+xml` **and the content looks like ONIX** (EDItEUR namespace or `<ONIXMessage>` root), the extension:

1. Re-fetches the source (the native viewer's DOM isn't reliable to read from).
2. Replaces the document with an indented, syntax-highlighted, foldable, searchable tree.
3. Detects the ONIX dialect (3.0 / 3.1 reference, short-tag, or 2.1) and adds:
   - Distinct color for ONIX element tags.
   - Auto-collapsed `<Product>` blocks with a one-line summary (ISBN · form · title) so you can scan thousands of products without scrolling forever.
   - Resolved codelist labels for the most common lists (ProductIDType, ProductForm, ContributorRole, LanguageRole, LanguageCode, CountryCode, PublishingDateRole, PublishingStatus) — shown as a small `→ ISBN-13` style badge after the value.

Non-ONIX XML (RSS, generic XML, anything without an EDItEUR namespace) is left alone — the browser's native viewer handles it. XHTML and SVG are also skipped (browsers render them natively).

## Install (development)

1. `chrome://extensions` → toggle **Developer mode** (top right).
2. Click **Load unpacked** and pick the `Resources/` folder of this repo.
3. (Optional) Click **Details** on the extension card → enable **Allow access to file URLs** if you want to test against local `.xml` files.

Iteration loop: edit a file in `Resources/` → click the **reload** circular arrow on the extension card → refresh the test page.

## Install (for colleagues — before Chrome Web Store approval)

While the Chrome Web Store review is pending you can sideload the extension as an "unpacked" install. Send colleagues the most recent zip from `dist/` (e.g. `dist/onix-viewer-0.9.0.zip`) along with these steps:

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
Runs the full jsdom suite (~40 tests) covering generic XML, ONIX 3.0/3.1 reference, ONIX short-tag, RSS, parse errors, codelist popup, cross-pane collapse-sync, and the Message Header card.

### Visual loop — Chrome
Pages worth opening:
- `https://www.w3schools.com/xml/note.xml` — small generic XML
- `https://www.w3schools.com/xml/cd_catalog.xml` — repeating records, exercises fold/unfold
- `https://hnrss.org/frontpage` — RSS / Atom
- A local ONIX file — drag-drop a `.xml` into Chrome (after enabling **Allow access to file URLs**)

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `Enter` | Next match |
| `Shift+Enter` | Previous match |
| `Esc` | Clear search |
| `e` | Expand all |
| `c` | Collapse all |
| `a` | Toggle attributes |
| `w` | Toggle line wrap |

## ONIX code lists

`Resources/onix-codelists.js` is **auto-generated** from the official EDItEUR ONIX 3.1 schema (issue 72) by `tools/generate-codelists.js`. It contains all 165 lists with full code/label pairs (~4,750 entries) and 158 element bindings — about 190 KB unminified, ~50 KB gzipped. Multiple element names that share a list reference the same `Map` instance.

To regenerate after a schema update:

```bash
node tools/generate-codelists.js                            # uses the bundled bokbasen schema cache
node tools/generate-codelists.js --source=/path/to/xsd      # override source dir
```

## Release

Releases to the Chrome Web Store are automated via GitHub Actions (`.github/workflows/release.yml`). To ship a new version:

```bash
tools/release.sh 0.9.2
git push origin main v0.9.2
```

The script bumps `Resources/manifest.json` and `package.json`, commits, and creates the tag locally. The push triggers the workflow, which runs the test suite, builds the zip, verifies the tag matches the manifest version, uploads to CWS with `--auto-publish`, and creates a GitHub release with the zip attached.

Review time is set by Google, not the workflow — most updates clear in minutes to a few hours, but changes that touch permissions or trigger heuristics can stall for several days. For in-progress iteration, prefer the **Trusted testers** track in the CWS dashboard (private install link, no review, instant).

### One-time OAuth setup

The workflow needs four repository secrets (Settings → Secrets and variables → Actions):

| Secret | What it is |
|--------|------------|
| `CWS_EXTENSION_ID` | Extension ID from the [CWS developer dashboard](https://chrome.google.com/webstore/devconsole/) |
| `CWS_CLIENT_ID` | Google OAuth 2.0 client ID |
| `CWS_CLIENT_SECRET` | Google OAuth 2.0 client secret |
| `CWS_REFRESH_TOKEN` | Long-lived refresh token tied to the developer account |

To generate the OAuth credentials:

1. In the [Google Cloud Console](https://console.cloud.google.com/), create (or reuse) a project.
2. Enable the **Chrome Web Store API** for that project.
3. Configure the OAuth consent screen (External; only your developer account needs to be added as a test user).
4. Create OAuth 2.0 credentials of type **Desktop app** → record the `client_id` and `client_secret`.
5. Exchange the client credentials for a refresh token. The simplest path is the [chrome-webstore-upload generator](https://github.com/fregante/chrome-webstore-upload/blob/main/How%20to%20generate%20Google%20API%20keys.md) — follow steps 8–13 of that guide.

Store all four values as repo secrets with the names above. After that, every `tools/release.sh X.Y.Z && git push --tags` pushes a release.

## Known limitations

- **Authenticated XML endpoints** with `Authorization: Bearer …` headers — the content script's re-fetch can't replay them, so the native viewer is left alone for those.
- **One-shot signed URLs** (e.g. AWS S3 presigned URLs) — the re-fetch hits the URL a second time, which the signature usually rejects.
- **Very large documents** (>10 MB) — rendering is synchronous; you'll see a freeze.
- **Complex namespace prefix usage** — rendering preserves source `nodeName` exactly; namespace-aware lookup against URIs isn't implemented beyond ONIX detection.

## See also

`CLAUDE.md` — design rationale, the gotchas behind the takeover-pattern choice, and notes for Claude Code sessions iterating on this project.

# Security & privacy

This document explains how ONIX Viewer handles page content, what permissions it asks for, and how to verify the claims below for yourself.

## TL;DR

- **No data is sent off your machine.** The only network call the extension makes is a re-fetch of the *same URL you're already viewing*, to grab the raw XML source so the viewer can pretty-print it.
- **No telemetry, no analytics, no third-party scripts.**
- **No remote code execution.** All JavaScript is bundled with the extension and verifiable in the source tree.
- **Minimal permissions.** The extension declares **zero** `permissions` and (as of 0.9.8) **zero** `host_permissions`. It cannot make cross-origin fetches; the browser's CORS rules would block any attempt.

## What permissions does the extension actually have?

`Resources/manifest.json`:

```json
{
  "manifest_version": 3,
  "permissions": [],
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "match_origin_as_fallback": true,
    "run_at": "document_start",
    "js": ["content.js"]
  }],
  "web_accessible_resources": [{
    "resources": ["viewer.css","viewer.js","onix.js","onix-codelists.js","onix-blocks.js","onix-popup.js"],
    "matches": ["<all_urls>"]
  }]
}
```

That's the full surface. Specifically:

- **No `host_permissions`** — the extension cannot fetch arbitrary cross-origin URLs. Any attempt to `fetch("https://attacker.example/...")` from inside the extension would be subject to the page's CORS rules and would be blocked by the browser, not just by absent code.
- **No `permissions`** — no `tabs`, `storage`, `webRequest`, `cookies`, `history`, `bookmarks`, `clipboardWrite`, `downloads`, or any other Chrome API permission. The clipboard "Copy XML" button uses the standard, unprivileged `navigator.clipboard.writeText` (which requires a user gesture and goes to the local clipboard, not the network).
- **No background service worker.** No persistent runtime, no data buffer that outlives a tab.
- **`content_scripts.matches: ["<all_urls>"]`** is needed so the content script *runs* on any page (XML can be served from any URL). It bails immediately on the first 10 lines of `content.js` for any page whose Content-Type isn't `application/xml`, `text/xml`, or `application/onix+xml`. It then bails again unless the XML body contains the EDItEUR ONIX namespace or an `<ONIXMessage>` root. On every other page it does nothing.

## What's the one network call?

`Resources/content.js`:

```js
fetch(document.location.href, {
  cache: "force-cache",
  credentials: "same-origin",
  redirect: "follow",
})
```

That's it. The extension re-fetches the URL of the page you're already viewing — same origin, same credentials — to get the raw XML so it can pretty-print it. No data leaves the origin. No other URL is ever contacted.

For pages where that re-fetch fails (file:// origins, expired one-shot signed URLs), the extension falls back to serializing the XML that the browser has already parsed — also no network traffic.

## What about the codelist popup's "Open on EDItEUR" link?

When you click the **List N** chip and then click the link in the popup footer, the browser opens `https://ns.editeur.org/onix/en/<N>` in a new tab. That's a *user-initiated navigation* by the browser, the same as clicking any link on a page — the extension itself never fetches the page or sends data to EDItEUR. The URL pattern is hardcoded; there's no template substitution from any user-supplied or page-supplied data beyond the integer list number.

## How can I verify all this?

1. **Read the source.** The whole bundle is small — under 200 KB of hand-written code (the bulk of the bundle is the auto-generated EDItEUR codelists JSON, which has no executable parts). Look at `Resources/content.js` for the network call, then grep for `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `eval`, `Function(` in the whole tree. There should be exactly the one fetch above.

2. **Inspect the installed extension.** Open `chrome://extensions`, enable Developer mode, click **Details** on ONIX Viewer, then **Inspect views: service worker** (there isn't one — that's intentional) and the **Source** view. The files there are the same files in this repo.

3. **Compare the published version to the source.** When the extension is installed from the Chrome Web Store, the Web Store guarantees the bytes you ran through review are the bytes users run. The release tags in this repo (e.g. `v0.9.8`) line up with the `version` declared in `Resources/manifest.json` and what's submitted to the store.

4. **Re-run our security audit.** See the original audit report we performed against `dist/onix-viewer-0.9.7.zip`. The audit found no HIGH or MEDIUM security findings. The LOW findings (defense-in-depth nitpicks) are addressed in `0.9.8`. Re-running the audit against the current artifact should be a sub-hour task for anyone with grep and a security-shaped mindset.

5. **Force-install via Google Workspace policy.** If you're an IT admin and want defense in depth, you can pin the extension's ID via Chrome's `ExtensionInstallForcelist` policy so users on your managed machines can only install the version you approve. This prevents anyone from sideloading a tampered copy.

## What we deliberately *don't* do

- No `storage`, `cookies`, `bookmarks`, or other Chrome API access.
- No tab inspection (`tabs` permission absent — we cannot enumerate or read other tabs' URLs).
- No webRequest interception of network traffic.
- No remote-hosted code: `script-src 'self'` (the MV3 default CSP) is enforced; the bundle ships every byte of JavaScript it runs.
- No third-party libraries at runtime. The only dev dependency is `jsdom` for the local test suite (not bundled).

## Reporting a concern

If you spot a security issue, file an issue on the GitHub repository or email the maintainer directly. We'd rather hear about it than ship the fix late.

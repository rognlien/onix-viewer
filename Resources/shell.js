// shell.js — the HTML the viewer renders into.
//
// One template, shared by content.js — which parses it with DOMParser and
// swaps it in for the raw XML page's root — and by the test harness, which
// builds its jsdom window from the same string. Keeping it in one place is
// what makes a renamed id or a new toolbar button fail in the suite rather
// than only in the browser: the tests used to carry a hand-written copy of
// this markup, which drifted.
//
// It runs as a content script ahead of content.js (see manifest.json), so it
// lives in the same isolated world and publishes one global there. In node
// the same assignment lands on the harness's globalThis.
//
// The only interpolations are the two extension URLs the caller resolved,
// the extension's version and the page title, escaped here. No document
// content goes near the markup.

(function () {
  "use strict";

  function html({ title, cssURL, logoURL, version }) {
    return `<!doctype html>
<html lang="en" data-oxv="1" data-oxv-version="${escapeHtml(version || "")}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${cssURL}">
</head>
<body>
<div id="oxv-toolbar" role="toolbar" aria-label="XML viewer controls">
  <div class="px-left">
    <!-- The mark says which extension took the page over — a raw XML URL gives
         no other clue. It is the app icon's own 48px size — no separate copy to
         keep in step — shown at 28px, and it is the door to the About window.
         If the page's own img-src CSP blocks extension URLs, viewer.js swaps
         the image for the name rather than leave a broken-image glyph. -->
    <button type="button" class="px-logo-btn" data-action="about" title="About ONIX Viewer" aria-label="About ONIX Viewer">
      <img id="oxv-logo" src="${logoURL}" width="28" height="28" alt="">
    </button>
    <!-- Expand and Collapse both work a level at a time; viewer.js prepends
         their icons. -->
    <button type="button" data-action="expand" title="Expand one more level (E)">Expand</button>
    <button type="button" data-action="collapse" title="Collapse a level: first each Product's contents, then the Products, then everything (C)">Collapse</button>
    <button type="button" data-action="toggle-wrap" title="Toggle soft wrap (W)">Soft wrap</button>
    <span class="px-dialect-group">
      <!-- Label and title are filled in by viewer.js, which knows which
           dialect the document is written in. -->
      <button type="button" data-action="dialect-toggle" aria-pressed="false"></button>
    </span>
    <button type="button" data-action="copy-xml" title="Copy raw XML to clipboard">Copy XML</button>
    <span class="px-search-group">
      <!-- Collapsed to its icon until used: the field earns its width only
           while you are searching. viewer.js fills in the icon. -->
      <button type="button" class="px-icon-btn" data-action="search" title="Search (/)" aria-label="Search" aria-expanded="false"></button>
      <input type="search" id="oxv-search" placeholder="Search" autocomplete="off" spellcheck="false" tabindex="-1">
      <span id="oxv-search-status" aria-live="polite"></span>
    </span>
  </div>
  <!-- The document pill sits next to the controls, not out at the right edge:
       it describes what you are looking at, so it belongs with the things that
       act on it. viewer.js fills it in, including the nested #oxv-block-list
       segment. The validation state follows it; the code-list issue is
       reference material and goes to the far right. -->
  <div class="px-center">
    <span id="oxv-meta"><span id="oxv-block-list"></span></span>
    <span id="oxv-validation"></span>
  </div>
  <div class="px-right">
    <span id="oxv-schema"></span>
    <!-- The reader's own validation rules. viewer.js fills in the cog and
         marks the button pressed while a rule set is installed. -->
    <button type="button" class="px-icon-btn" data-action="rules" title="Custom rules" aria-label="Custom rules" aria-pressed="false"></button>
  </div>
</div>
<div id="oxv-main">
  <main id="oxv-root" tabindex="0" aria-label="XML tree"></main>
</div>
</body>
</html>`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  globalThis.OnixViewerShell = { html };
})();

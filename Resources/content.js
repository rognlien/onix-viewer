// content.js — ONIX Viewer
// Detects raw XML pages and replaces the document with a pretty-printed tree view.
//
// Why we replace the whole document instead of restyling:
// Browsers render raw XML using a built-in viewer whose internal DOM is largely
// opaque to extension JS. The reliable approach is to detect "this is raw XML",
// re-fetch the source, and rewrite the page entirely with our own viewer.

(function () {
  "use strict";

  // Diagnostic logging flag — flip to true while debugging activation /
  // fallback paths. Off in release so we don't spam the console of every
  // XML page the user opens.
  const DEBUG = false;
  function dlog(...args) { if (DEBUG) console.info(...args); }
  function dwarn(...args) { if (DEBUG) console.warn(...args); }

  // We run at document_start. document.contentType is available immediately,
  // but the body may not be parsed yet. We check the type up front and bail
  // out fast for non-XML pages (the vast majority).
  //
  // Whitelist is intentionally tight: ONIX feeds (the primary target) and
  // generic raw XML are served as application/xml or text/xml. Atom, RSS
  // and SOAP envelopes are deliberately not handled — users want their
  // existing reader/UA behaviour for those, and including them widens the
  // takeover surface without helping the ONIX use case.
  //
  // application/onix+xml is not registered with IANA and almost no server
  // sends it — EDItEUR's best-practice guide says producers should send
  // application/xml — but the +xml suffix convention (RFC 3023/7303) makes
  // it spec-conformant, so we include it as a future-proofing courtesy.
  const XML_CONTENT_TYPES = new Set([
    "application/xml",
    "text/xml",
    "application/onix+xml",
  ]);

  // Types we recognize as XML but explicitly DO NOT take over (browsers
  // already render them natively in a way users expect).
  const SKIP_TYPES = new Set([
    "application/xhtml+xml",
    "image/svg+xml",
  ]);

  const ct = (document.contentType || "").toLowerCase();

  if (!XML_CONTENT_TYPES.has(ct)) return;
  if (SKIP_TYPES.has(ct)) return;

  // Some servers send "application/xml; charset=utf-8" — document.contentType
  // strips parameters, but be defensive in case that changes.
  const baseType = ct.split(";")[0].trim();
  if (!XML_CONTENT_TYPES.has(baseType)) return;
  if (SKIP_TYPES.has(baseType)) return;

  // Try to re-fetch the original source first — fast and clean for normal
  // http(s) navigations. If that fails (file:// URLs are origin "null" and
  // CORS-blocked; one-shot signed URLs reject the second request; bearer-auth
  // endpoints lose their headers), fall back to serializing the document the
  // browser already parsed for us.
  loadSource()
    .then((xmlSource) => {
      // We're called for any XML page that matches the content-type whitelist,
      // but the extension is named ONIX Viewer for a reason: only act on
      // documents that actually look like ONIX. For non-ONIX XML the user
      // gets the browser's native view, undisturbed.
      if (!looksLikeOnix(xmlSource)) {
        dlog("[OnixViewer] XML is not ONIX, leaving native view.");
        return;
      }
      takeOver(xmlSource);
    })
    .catch((err) => {
      dwarn("[OnixViewer] Could not load source, leaving native view:", err);
    });

  function looksLikeOnix(xml) {
    // String-level sniff against the head of the document. Cheaper than
    // parsing — the viewer will parse for real if we proceed. Two signals:
    //   1. The EDItEUR ONIX namespace URI on any element (covers ONIX 3.0,
    //      3.1, both reference and short dialects, and standalone <Product>
    //      records).
    //   2. An <ONIXMessage> / <ONIXmessage> root element with no namespace,
    //      typical of older ONIX 2.1 documents.
    const head = (xml || "").slice(0, 2048);
    if (head.includes("ns.editeur.org/onix")) return true;
    if (/<ONIXMessage[\s>]/i.test(head)) return true;
    return false;
  }

  function loadSource() {
    return fetch(document.location.href, {
      cache: "force-cache",
      credentials: "same-origin",
      redirect: "follow",
    })
      .then((r) => {
        if (!r.ok) throw new Error(`refetch returned ${r.status}`);
        return r.text();
      })
      .catch((err) => {
        dlog("[OnixViewer] re-fetch failed, reading from DOM:", err.message);
        return readSourceFromDom();
      });
  }

  function readSourceFromDom() {
    // Chrome's native XML viewer wraps the original XML inside
    // <div id="webkit-xml-viewer-source-xml"> and replaces documentElement
    // with an HTML shell. We need to find the wrapper and serialize its
    // children. If the wrapper isn't there (older viewers, other browsers,
    // or non-file:// XML), fall back to serializing documentElement directly.
    return new Promise((resolve, reject) => {
      const serializer = new XMLSerializer();

      const grab = () => {
        const wrap = document.getElementById("webkit-xml-viewer-source-xml");
        if (wrap && wrap.childNodes.length) {
          let xml = "";
          for (const child of wrap.childNodes) {
            try { xml += serializer.serializeToString(child); }
            catch (_) { /* skip nodes the serializer can't handle */ }
          }
          if (xml.trim()) return xml;
        }
        if (document.documentElement) {
          try {
            const s = serializer.serializeToString(document.documentElement);
            if (s && s.trim()) return s;
          } catch (_) {}
        }
        return null;
      };

      const ready = grab();
      if (ready) return resolve(ready);

      const onReady = () => {
        // The wrapper sometimes mounts a tick after DOMContentLoaded; retry
        // briefly before giving up.
        let tries = 0;
        const tick = () => {
          const s = grab();
          if (s) return resolve(s);
          if (++tries > 20) return reject(new Error("could not read source from DOM"));
          setTimeout(tick, 50);
        };
        tick();
      };

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", onReady, { once: true });
      } else {
        onReady();
      }
    });
  }

  function takeOver(xmlSource) {
    // We can't use document.open() + document.write() here: per the HTML spec,
    // document.open() throws InvalidStateError on a non-HTML document, and a
    // raw XML page in WebKit is exactly that. (Chromium is lenient and lets
    // it through, which is why this used to "work" in the Chrome dev loop.)
    // Instead, build a fresh <html> via DOMParser and swap document roots.

    const cssURL = browserAPI().runtime.getURL("viewer.css");
    const codelistsURL = browserAPI().runtime.getURL("onix-codelists.js");
    const onixURL = browserAPI().runtime.getURL("onix.js");
    const blocksURL = browserAPI().runtime.getURL("onix-blocks.js");
    const popupURL = browserAPI().runtime.getURL("onix-popup.js");
    const viewerURL = browserAPI().runtime.getURL("viewer.js");

    const shellHtml = `<!doctype html>
<html lang="en" data-oxv="1">
<head>
<meta charset="utf-8">
<title>${escapeHtml(deriveTitle(document.location.href))}</title>
<link rel="stylesheet" href="${cssURL}">
</head>
<body class="oxv-view-xml">
<div id="oxv-toolbar" role="toolbar" aria-label="XML viewer controls">
  <div class="px-left">
    <button type="button" data-action="expand-all" title="Expand all (E)">Expand all</button>
    <button type="button" data-action="collapse-all" title="Collapse all (C)">Collapse all</button>
    <button type="button" data-action="toggle-wrap" title="Toggle line wrap (W)">Wrap</button>
    <button type="button" data-action="copy-xml" title="Copy raw XML to clipboard">Copy XML</button>
    <!--
      View-mode toggle (XML / Split / Structure) is currently DISABLED.
      The blocks-pane code (onix-blocks.js, the right pane, sync logic) is
      still bundled and tested but hidden from the UI. To re-enable, restore
      this <span class="px-view-group"> block and remove the early return in
      viewer.js's setupViewMode.

    <span class="px-view-group" role="group" aria-label="View mode">
      <button type="button" class="px-icon-btn" data-action="view-xml" title="XML only" aria-label="XML only" aria-pressed="false">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
      </button>
      <button type="button" class="px-icon-btn" data-action="view-split" title="Split (XML + Structure)" aria-label="Split view" aria-pressed="false">
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1" stroke="currentColor" stroke-width="1.25" fill="none"/><path d="M8 3.25v9.5" stroke="currentColor" stroke-width="1.25"/></svg>
      </button>
      <button type="button" class="px-icon-btn" data-action="view-structure" title="Structure only" aria-label="Structure only" aria-pressed="false">
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1" stroke="currentColor" stroke-width="1.25" fill="none"/><path d="M5 6.5h6M5 9h6M5 11.5h4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>
      </button>
    </span>
    -->
  </div>
  <div class="px-center">
    <input type="search" id="oxv-search" placeholder="Search (/ to focus)" autocomplete="off" spellcheck="false">
    <span id="oxv-search-status" aria-live="polite"></span>
  </div>
  <div class="px-right">
    <span id="oxv-schema"></span>
    <span id="oxv-meta"></span>
  </div>
</div>
<div id="oxv-main">
  <main id="oxv-root" tabindex="0" aria-label="XML tree"></main>
  <div id="oxv-divider" role="separator" aria-orientation="vertical" aria-label="Resize panes" tabindex="0"></div>
  <aside id="oxv-blocks-pane" aria-label="ONIX blocks">
    <div id="oxv-blocks"></div>
  </aside>
</div>
</body>
</html>`;

    const parsed = new DOMParser().parseFromString(shellHtml, "text/html");
    const newRoot = document.importNode(parsed.documentElement, true);
    document.replaceChild(newRoot, document.documentElement);

    // Important: `document.contentType` is still "application/xml" even after
    // we swapped in an HTML <html> root. In an XML document, plain
    // `document.createElement("script")` produces an element in the *null*
    // namespace, which the browser does not treat as a script element — it
    // renders the textContent verbatim. To get a real, executing <script>
    // we must explicitly create it in the XHTML namespace.
    const HTML_NS = "http://www.w3.org/1999/xhtml";

    // Stash the source so viewer.js can read it. We can't use an inline
    // <script> that sets a window global, because file:// pages and many
    // sites set a script-src CSP that blocks inline JS execution (no
    // 'unsafe-inline'). A <script type="application/xml"> element is inert
    // — it isn't parsed as JS, so CSP leaves it alone — but its textContent
    // is queryable from viewer.js.
    const sourceHolder = document.createElementNS(HTML_NS, "script");
    sourceHolder.setAttribute("type", "application/xml");
    sourceHolder.id = "__oxv-source__";
    sourceHolder.textContent = xmlSource;
    document.body.appendChild(sourceHolder);

    // Inject viewer scripts in order. async=false preserves insertion order
    // across the three files.
    [codelistsURL, onixURL, blocksURL, popupURL, viewerURL].forEach((src) => {
      const s = document.createElementNS(HTML_NS, "script");
      s.setAttribute("src", src);
      s.async = false;
      document.body.appendChild(s);
    });
  }

  function deriveTitle(url) {
    try {
      const u = new URL(url);
      const last = u.pathname.split("/").filter(Boolean).pop();
      return last ? `${last} — ONIX Viewer` : `${u.host} — ONIX Viewer`;
    } catch {
      return "ONIX Viewer";
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function browserAPI() {
    return typeof browser !== "undefined" ? browser : chrome;
  }
})();

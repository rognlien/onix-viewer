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

  // The ONIX releases we bundle a validation content model for, newest first
  // (a 3.1 document is the common case, so it matches on the first test).
  const MODEL_VERSIONS = ["3.1", "3.0"];

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
    //      typical of older ONIX 2.1 documents, or an
    //      <ONIXMessageAcknowledgement> root (the ONIX Acknowledgement
    //      message — usually namespaced, so signal 1 already covers it, but
    //      the root match catches the rare no-namespace case too).
    const head = (xml || "").slice(0, 2048);
    if (head.includes("ns.editeur.org/onix")) return true;
    if (/<ONIXMessage(Acknowledgement)?[\s>]/i.test(head)) return true;
    //   3. A standalone <Product> record exported with no <ONIXMessage>
    //      envelope and no namespace. <Product> on its own is too generic to
    //      trust, so require a corroborating ONIX-specific child element
    //      (RecordReference / NotificationType, or their short tags a001 /
    //      a002) — the same idea as onix.js's detect() corroboration.
    if (/<Product[\s>]/i.test(head) &&
        /<(RecordReference|NotificationType|a001|a002)[\s>]/i.test(head)) {
      return true;
    }
    return false;
  }

  // Which validation content model to inject. There is one file per ONIX
  // release, ~65 KB each, and a message declares exactly one release — the
  // schema restricts `release` to "3.0" or "3.1" and the revisions (3.0.8,
  // 3.1.3, …) aren't declarable — so loading both means parsing 130 KB to use
  // half of it. Read the release off the same head looksLikeOnix() sniffed and
  // send only the matching model.
  //
  // When the release isn't readable there — ONIX 2.1, or a standalone
  // <Product> with no namespace — both go in. No model can match those anyway,
  // but the validator's "no content model bundled for X (bundled: …)" warning
  // lists whatever loaded, so it would otherwise under-report what ships.
  function contentModelURLs(xml) {
    const head = (xml || "").slice(0, 2048);
    for (const version of MODEL_VERSIONS) {
      const namespaced = head.includes(`ns.editeur.org/onix/${version}/`);
      const declared = new RegExp(`release\\s*=\\s*["']${version}["']`).test(head);
      if (namespaced || declared) return [modelURL(version)];
    }
    return MODEL_VERSIONS.map(modelURL);
  }

  function modelURL(version) {
    return browserAPI().runtime.getURL(`onix-content-model-${version}.js`);
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
            catch { /* skip nodes the serializer can't handle */ }
          }
          if (xml.trim()) return xml;
        }
        if (document.documentElement) {
          try {
            const s = serializer.serializeToString(document.documentElement);
            if (s && s.trim()) return s;
          } catch { /* a document the serializer refuses is no source either */ }
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
    // We run at document_start and a cached re-fetch resolves quickly, so the
    // parser may not have created the root element yet. There is nothing to
    // replace until it has — and the swap below throws on a null root, into
    // the catch above, which is silent in release.
    if (!document.documentElement) {
      whenRootExists(() => takeOver(xmlSource));
      return;
    }

    // Another enabled copy of the extension may already have taken this page
    // over (a Web Store install running alongside an unpacked one). Replacing
    // its shell would leave two viewer instances rendering into one tree, so
    // the first takeover wins and later ones stand down.
    if (document.documentElement.hasAttribute("data-oxv")) {
      dlog("[OnixViewer] page already taken over, standing down.");
      return;
    }

    // We can't use document.open() + document.write() here: per the HTML spec,
    // document.open() throws InvalidStateError on a non-HTML document, and a
    // raw XML page in WebKit is exactly that. (Chromium is lenient and lets
    // it through, which is why this used to "work" in the Chrome dev loop.)
    // Instead, build a fresh <html> via DOMParser and swap document roots.
    // The markup itself is shell.js's, loaded ahead of this script.

    const cssURL = browserAPI().runtime.getURL("viewer.css");
    const logoURL = browserAPI().runtime.getURL("icons/icon-48.png");
    const codelistsURL = browserAPI().runtime.getURL("onix-codelists.js");
    const modelURLs = contentModelURLs(xmlSource);
    const onixURL = browserAPI().runtime.getURL("onix.js");
    const validateURL = browserAPI().runtime.getURL("onix-validate.js");
    const popupURL = browserAPI().runtime.getURL("onix-popup.js");
    const viewerURL = browserAPI().runtime.getURL("viewer.js");

    const shellHtml = OnixViewerShell.html({
      title: deriveTitle(document.location.href), cssURL, logoURL,
    });

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

    // Inject viewer scripts in order. async=false preserves insertion order,
    // which matters: the data files must define their globals before onix.js
    // and viewer.js read them.
    [codelistsURL, ...modelURLs, onixURL, validateURL,
     popupURL, viewerURL].forEach((src) => {
      const s = document.createElementNS(HTML_NS, "script");
      s.setAttribute("src", src);
      s.async = false;
      document.body.appendChild(s);
    });
  }

  // Calls back once the parser has given the document a root element. The
  // parser's insertions are observable mutations; DOMContentLoaded is the
  // backstop for a document that reaches the end without one.
  function whenRootExists(callback) {
    let called = false;
    const once = () => {
      if (called) return;
      called = true;
      observer.disconnect();
      callback();
    };
    const observer = new MutationObserver(() => {
      if (document.documentElement) once();
    });
    observer.observe(document, { childList: true });
    document.addEventListener("DOMContentLoaded", once, { once: true });
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

  function browserAPI() {
    return typeof browser !== "undefined" ? browser : chrome;
  }
})();

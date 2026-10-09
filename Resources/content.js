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

  // The browser goes on parsing, styling and laying out the document we are
  // about to replace, and Chrome's and WebKit's XML tree viewers then rebuild
  // it once more when the parse ends — on a 5 MB feed in Safari, seconds of
  // work that nobody sees. So the parser's root is taken out of the document
  // the moment it appears. The parser keeps filling it, detached, which is
  // what the DOM fallback reads if the re-fetch fails; the viewers find an
  // empty document and draw nothing; the shell is appended into that empty
  // document when the source is in. Measured in Chrome: a tenth off the time
  // to the first verdict on a cold load. Only a root that looks like ONIX is
  // taken, so an RSS feed keeps its native view without a flicker.
  // Declared ahead of the entry point that uses them, like RULES_KEY below:
  // a let further down is in its dead zone when this runs.
  let nativeRoot = null;
  let detaching = null;
  detachNativeDocument();

  // Try to re-fetch the original source first — fast and clean for normal
  // http(s) navigations. If that fails (file:// URLs are origin "null" and
  // CORS-blocked; one-shot signed URLs reject the second request; bearer-auth
  // endpoints lose their headers), fall back to serializing the document the
  // browser already parsed for us.
  // The one storage key, declared ahead of the entry point below, which runs
  // before any later const is initialised.
  const RULES_KEY = "rules";
  // The custom-rules editor is held back (viewer.js FEATURES has the switch
  // for the page's world); while it is, nothing is read from or written to
  // storage, and the manifest asks for no permission.
  const CUSTOM_RULES = false;

  // The largest source the viewer opens. It holds the source as one string
  // beside the parsed tree, and in Chrome a 441 MB feed opened where a 618 MB
  // one crashed the tab; a JavaScript string also ends at about 536 million
  // characters. Past this the page gets a notice instead of a crash.
  const MAX_SOURCE_BYTES = 500 * 1000 * 1000;

  // The size of the source as served, counted by readLimited; null when the
  // source came from the DOM instead. The viewer shows it in the toolbar.
  let sourceBytes = null;

  class TooLarge extends Error {
    constructor() {
      super(`the source is larger than ${MAX_SOURCE_BYTES} bytes`);
      this.name = "TooLarge";
    }
  }

  Promise.all([loadSource(), loadRules()])
    .then(([xmlSource, rules]) => {
      // We're called for any XML page that matches the content-type whitelist,
      // but the extension is named ONIX Viewer for a reason: only act on
      // documents that actually look like ONIX. For non-ONIX XML the user
      // gets the browser's native view, undisturbed.
      if (!looksLikeOnix(xmlSource)) {
        dlog("[OnixViewer] XML is not ONIX, leaving native view.");
        restoreNativeDocument();
        return;
      }
      takeOver(xmlSource, rules);
    })
    .catch((err) => {
      if (err instanceof TooLarge) {
        showTooLarge();
      } else {
        dwarn("[OnixViewer] Could not load source, leaving native view:", err);
        restoreNativeDocument();
      }
    });

  // A root is ONIX by its namespace, or by name where there is none: the
  // message envelope in either dialect, or the Acknowledgement. A bare
  // <Product> is decided by its children instead — see the corroboration in
  // looksLikeOnix() — which the parser has to produce first.
  function rootLooksLikeOnix(root) {
    if ((root.namespaceURI || "").includes("ns.editeur.org/onix")) return true;
    return /^(ONIXMessage|ONIXmessage|ONIXMessageAcknowledgement)$/.test(root.localName);
  }

  function isBareProduct(root) {
    return root.localName === "Product" && !root.namespaceURI;
  }

  function hasOnixProductChild(root) {
    return [...root.children].some((child) =>
      /^(RecordReference|NotificationType|a001|a002)$/.test(child.localName));
  }

  // Waits for the parser's root and takes it out of the document, keeping it
  // as nativeRoot; a root that is not ONIX ends the watch instead, and the
  // page stays the browser's. The watch ends with the take as well: the
  // browser's tree viewer may put an <html> of its own into the emptied
  // document when the parse ends, and the shell replaces that as it would
  // any root. Removing it here instead crashed Safari — WebKit's viewer
  // appends its stylesheet from C++ right after its script has built that
  // <html>, and an observer callback runs at the microtask checkpoint in
  // between, so the C++ appended into a detached element (SIGSEGV in
  // XMLTreeViewer::transformDocumentToTreeView, Safari 27).
  function detachNativeDocument() {
    const look = () => {
      const root = document.documentElement;
      if (!root || root.hasAttribute("data-oxv")) return;
      if (rootLooksLikeOnix(root)) take(root);
      else if (isBareProduct(root)) whenCorroborated(root, () => take(root));
      else stopDetaching();
    };
    const take = (root) => {
      stopDetaching();
      nativeRoot = root;
      root.remove();
    };
    detaching = new MutationObserver(look);
    detaching.observe(document, { childList: true });
    look();
  }

  // A bare <Product> is taken once the parser has given it an ONIX child, and
  // left alone if the parse ends without one.
  function whenCorroborated(root, callback) {
    const check = () => {
      if (!hasOnixProductChild(root)) return;
      observer.disconnect();
      if (detaching && root.isConnected) callback();
    };
    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true });
    document.addEventListener("DOMContentLoaded", () => {
      observer.disconnect();
      if (!nativeRoot) stopDetaching();
    }, { once: true });
    check();
  }

  function stopDetaching() {
    if (detaching) detaching.disconnect();
    detaching = null;
  }

  function restoreNativeDocument() {
    stopDetaching();
    if (!nativeRoot || nativeRoot.isConnected) return;
    const root = document.documentElement;
    if (root) document.replaceChild(nativeRoot, root);
    else document.appendChild(nativeRoot);
  }

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
  //
  // The other release stays a choice: the toolbar's release selector lets the
  // reader judge the document against it, and viewer.js fetches that model
  // the first time it is asked for, from the URLs stamped on the shell
  // (modelURLsByVersion).
  function contentModelURLs(xml) {
    const head = (xml || "").slice(0, 2048);
    for (const version of MODEL_VERSIONS) {
      const namespaced = head.includes(`ns.editeur.org/onix/${version}/`);
      const declared = new RegExp(`release\\s*=\\s*["']${version}["']`).test(head);
      if (namespaced || declared) return [modelURL(version)];
    }
    return MODEL_VERSIONS.map(modelURL);
  }

  // Thema is a third of a megabyte of headings, so only a document that
  // names one of its seven subject schemes, 93 to 99, is sent it. The tag
  // may be the reference name or the short tag, prefixed or not.
  const THEMA_SCHEME = /<(?:[\w.-]+:)?(?:SubjectSchemeIdentifier|b067)(?:\s[^>]*)?>\s*9[3-9]\s*</;

  function themaURLs(xml) {
    return THEMA_SCHEME.test(xml || "") ? [browserAPI().runtime.getURL("onix-thema.js")] : [];
  }

  function modelURL(version) {
    return browserAPI().runtime.getURL(`onix-content-model-${version}.js`);
  }

  function modelURLsByVersion() {
    const urls = {};
    for (const version of MODEL_VERSIONS) urls[version] = modelURL(version);
    return urls;
  }

  // The re-fetch is trusted only when it plainly returned the document: an
  // XML content type, and a body that looks like ONIX whenever the parser's
  // own root did. A share link behind a session can answer a second request
  // with a 200 and the app's HTML shell — content negotiation, a one-shot
  // token, a login page — and taking that at face value meant "not ONIX",
  // native view, while the parser held the real thing. Anything else falls
  // back to the parser's tree, like a failed request does.
  function loadSource() {
    return declaredTooLarge()
      .then((tooLarge) => {
        if (tooLarge) throw new TooLarge();
        return parseEnded();
      })
      .then(() => request())
      .then((r) => {
        if (!r.ok) throw new Error(`refetch returned ${r.status}`);
        const type = (r.headers.get("content-type") || "").toLowerCase();
        if (!type.includes("xml")) throw new Error(`refetch returned ${type || "no content type"}`);
        return readLimited(r);
      })
      .then((text) => {
        if (nativeRoot && !looksLikeOnix(text)) throw new Error("refetch returned a different document");
        return text;
      })
      .catch((err) => {
        if (err instanceof TooLarge) throw err;
        dlog("[OnixViewer] re-fetch failed, reading from DOM:", err.message);
        return readSourceFromDom();
      });
  }

  // response.text(), counting the bytes as they arrive and giving up past
  // MAX_SOURCE_BYTES. Content-Length alone would not do: a compressed
  // response states the compressed size, which is a tenth of the XML's.
  async function readLimited(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parts = [];
    let bytes = 0;
    let chunk = await reader.read();
    while (!chunk.done) {
      bytes += chunk.value.byteLength;
      if (bytes > MAX_SOURCE_BYTES) {
        reader.cancel();
        throw new TooLarge();
      }
      parts.push(decoder.decode(chunk.value, { stream: true }));
      chunk = await reader.read();
    }
    parts.push(decoder.decode());
    sourceBytes = bytes;
    return parts.join("");
  }

  // Stops the browser's own parse, which would otherwise go on building a
  // tree of the whole file in the background, and puts a notice where the
  // viewer would have been.
  function showTooLarge() {
    if (!nativeRoot && !document.documentElement) {
      whenRootExists(showTooLarge);
      return;
    }
    stopDetaching();
    window.stop();
    const megabytes = Math.round(MAX_SOURCE_BYTES / 1000 / 1000);
    const page = new DOMParser().parseFromString(OnixViewerShell.notice({
      title: deriveTitle(document.location.href),
      cssURL: browserAPI().runtime.getURL("viewer.css"),
      heading: "Too large for ONIX Viewer",
      text: `This file is larger than ${megabytes} MB, the most ONIX Viewer opens. ` +
        "Beyond that the browser runs out of memory for the tree, so the file is not shown.",
    }), "text/html");
    const root = document.importNode(page.documentElement, true);
    if (document.documentElement) document.replaceChild(root, document.documentElement);
    else document.appendChild(root);
  }

  // The one request the extension makes: the page's own URL again.
  function request(signal) {
    return fetch(document.location.href, {
      cache: "force-cache",
      credentials: "same-origin",
      redirect: "follow",
      signal,
    });
  }

  // While the page loads, only the headers are read, and a declared length
  // over the limit stops the load there; reading on would leave the page
  // loading for good (see parseEnded). A response with no length, or a
  // compressed one, is measured by readLimited once the page has loaded.
  function declaredTooLarge() {
    const abort = new AbortController();
    return request(abort.signal)
      .then((response) => {
        abort.abort();
        return Number(response.headers.get("content-length")) > MAX_SOURCE_BYTES;
      })
      .catch(() => false);
  }

  // The re-fetch waits for the page's own load to end. Started alongside it,
  // a force-cache request for a response too large for Chrome's HTTP cache
  // (176 MB in a fresh profile; 141 MB was cached) left the page loading for
  // good — ERR_CACHE_WRITE_FAILURE, and DOMContentLoaded never came — while
  // the tab went on working. Afterwards the request reads the cached
  // response, or downloads it again when it was too large to cache.
  function parseEnded() {
    return new Promise((resolve) => {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", resolve, { once: true });
      else resolve();
    });
  }

  // The reader's own validation rules, kept in extension storage — the one
  // thing the extension stores, and the reason for its one permission. The
  // viewer runs in the page's world and cannot reach storage, so this script
  // reads the rules for it on the way in and writes them back on its behalf
  // when the editor posts a change (see keepRules). Absent storage, or an
  // empty store, is simply no rules.
  function loadRules() {
    let loaded = Promise.resolve("");
    const storage = CUSTOM_RULES ? browserAPI().storage : null;
    if (storage && storage.local) {
      loaded = Promise.resolve(storage.local.get({ [RULES_KEY]: "" }))
        .then((items) => (typeof items[RULES_KEY] === "string" ? items[RULES_KEY] : ""))
        .catch(() => "");
    }
    return loaded;
  }

  // The editor in viewer.js posts { type: "oxv-rules", rules } to its own
  // window; only a message from this window, after the takeover, is ours.
  // Once the write has landed, "oxv-rules-kept" goes back the same way, so
  // the editor can say so — and so a test knows when to reload.
  function keepRules() {
    if (!CUSTOM_RULES) return;
    window.addEventListener("message", (event) => {
      if (event.source !== window || !event.data || event.data.type !== "oxv-rules") return;
      const storage = browserAPI().storage;
      if (!storage || !storage.local) return;
      const rules = typeof event.data.rules === "string" ? event.data.rules : "";
      const write = rules ? storage.local.set({ [RULES_KEY]: rules }) : storage.local.remove(RULES_KEY);
      Promise.resolve(write)
        .then(() => window.postMessage({ type: "oxv-rules-kept" }, "*"))
        .catch((err) => dwarn("[OnixViewer] could not store the rules:", err));
    });
  }

  function readSourceFromDom() {
    // The parser's own tree is the source: nativeRoot when the root was
    // detached (the parser fills it to the end regardless), else Chrome's
    // native XML viewer's wrapper, <div id="webkit-xml-viewer-source-xml">,
    // else documentElement. Nothing is read before the parse has ended,
    // since a tree still being built serialises to a truncated document.
    return new Promise((resolve, reject) => {
      const serializer = new XMLSerializer();

      const grab = () => {
        if (nativeRoot) {
          try {
            const s = serializer.serializeToString(nativeRoot);
            if (s && s.trim()) return s;
          } catch (err) {
            // A tree too large to serialise is a file too large to open.
            if (err instanceof RangeError) throw new TooLarge();
          }
        }
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

      const onReady = () => {
        // The wrapper sometimes mounts a tick after DOMContentLoaded; retry
        // briefly before giving up.
        let tries = 0;
        const tick = () => {
          let s = null;
          try {
            s = grab();
          } catch (err) {
            return reject(err);
          }
          if (s && s.length > MAX_SOURCE_BYTES) return reject(new TooLarge());
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

  function takeOver(xmlSource, rules) {
    // We run at document_start and a cached re-fetch resolves quickly, so the
    // parser may not have produced its root yet. The shell waits for that:
    // installed earlier, it would sit beside the parser's root rather than in
    // its place, since the parser appends without the one-root check.
    if (!nativeRoot && !document.documentElement) {
      whenRootExists(() => takeOver(xmlSource, rules));
      return;
    }

    // Another enabled copy of the extension may already have taken this page
    // over (a Web Store install running alongside an unpacked one). Replacing
    // its shell would leave two viewer instances rendering into one tree, so
    // the first takeover wins and later ones stand down.
    if (document.documentElement && document.documentElement.hasAttribute("data-oxv")) {
      dlog("[OnixViewer] page already taken over, standing down.");
      return;
    }
    stopDetaching();

    // We can't use document.open() + document.write() here: per the HTML spec,
    // document.open() throws InvalidStateError on a non-HTML document, and a
    // raw XML page in WebKit is exactly that. (Chromium is lenient and lets
    // it through, which is why this used to "work" in the Chrome dev loop.)
    // Instead, build a fresh <html> via DOMParser and swap document roots.
    // The markup itself is shell.js's, loaded ahead of this script.

    const cssURL = browserAPI().runtime.getURL("viewer.css");
    const logoURL = browserAPI().runtime.getURL("icons/icon-28.png");
    const logoURL2x = browserAPI().runtime.getURL("icons/icon-56.png");
    const codelistsURL = browserAPI().runtime.getURL("onix-codelists.js");
    const modelURLs = contentModelURLs(xmlSource);
    const thema = themaURLs(xmlSource);
    const onixURL = browserAPI().runtime.getURL("onix.js");
    const validateURL = browserAPI().runtime.getURL("onix-validate.js");
    const schematronURL = browserAPI().runtime.getURL("onix-schematron.js");
    const popupURL = browserAPI().runtime.getURL("onix-popup.js");
    const viewerURL = browserAPI().runtime.getURL("viewer.js");

    const shellHtml = OnixViewerShell.html({
      title: deriveTitle(document.location.href), cssURL, logoURL, logoURL2x,
      version: extensionVersion(), browser: extensionBrowser(), bytes: sourceBytes,
      modelURLs: modelURLsByVersion(), migrationURL: browserAPI().runtime.getURL("onix-migrate.js"),
    });

    const parsed = new DOMParser().parseFromString(shellHtml, "text/html");
    const newRoot = document.importNode(parsed.documentElement, true);
    if (document.documentElement) document.replaceChild(newRoot, document.documentElement);
    else document.appendChild(newRoot);

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

    // The reader's rule set travels the same way, in a block of its own that
    // exists only when there is one; viewer.js installs it before validating.
    if (rules) {
      const rulesHolder = document.createElementNS(HTML_NS, "script");
      rulesHolder.setAttribute("type", "application/xml");
      rulesHolder.id = "__oxv-rules__";
      rulesHolder.textContent = rules;
      document.body.appendChild(rulesHolder);
    }
    keepRules();

    // Inject viewer scripts in order. async=false preserves insertion order,
    // which matters: the data files must define their globals before onix.js
    // and viewer.js read them.
    [codelistsURL, ...thema, ...modelURLs, onixURL, validateURL, schematronURL,
     popupURL, viewerURL].forEach((src) => {
      const s = document.createElementNS(HTML_NS, "script");
      s.setAttribute("src", src);
      s.async = false;
      document.body.appendChild(s);
    });
  }

  // Calls back once the parser has produced a root element — which the
  // detach observer, registered earlier and so run earlier, may already have
  // taken as nativeRoot. The parser's insertions are observable mutations;
  // DOMContentLoaded is the backstop for a document that reaches the end
  // without one.
  function whenRootExists(callback) {
    let called = false;
    const once = () => {
      if (called) return;
      called = true;
      observer.disconnect();
      callback();
    };
    const observer = new MutationObserver(() => {
      if (nativeRoot || document.documentElement) once();
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

  // The version the About window shows: version_name when the manifest has
  // one, which is what chrome://extensions displays too. The checkout carries
  // "X.Y.Z-dev" there and the packager strips it, so an unpacked load says
  // -dev everywhere and a store copy shows the bare version.
  function extensionVersion() {
    const manifest = browserAPI().runtime.getManifest();
    return manifest.version_name || manifest.version;
  }

  // Which browser this is, from the scheme the extension's own files are
  // served under — the one fact about the host the viewer needs, for the
  // About window's wording and store link. Chrome's scheme is also what
  // every other Chromium browser uses, which is right: they install from
  // the same store.
  function extensionBrowser() {
    const scheme = browserAPI().runtime.getURL("").split(":")[0];
    if (scheme === "moz-extension") return "firefox";
    if (scheme === "safari-web-extension") return "safari";
    return "chrome";
  }

  function browserAPI() {
    return typeof browser !== "undefined" ? browser : chrome;
  }
})();

// viewer.js — ONIX Viewer
// Renders the source XML (left on window by content.js) into a collapsible
// tree with syntax highlighting, search, and ONIX integration.
//
// Design notes:
//  - We render to plain DOM (not innerHTML strings) for safety against XSS
//    when XML contains markup-looking text. Performance is fine up to ~5MB
//    docs; for larger we lazy-render children of folded <Product> blocks.
//  - One row per logical "line": opening tag, text, closing tag are separate
//    rows when the element has children, but combined into one row for
//    leaf elements (more compact, easier to scan).

(function () {
  "use strict";

  const ONIX_BLOCK_NAMES = new Set([
    "descriptivedetail",
    "collateraldetail",
    "contentdetail",
    "publishingdetail",
    "relatedmaterial",
    "productsupply",
  ]);

  // Bidirectional map between a tree row and its right-pane <details>.
  // Populated by setupBlockSync.bindPair(); used by click-to-highlight.
  const pairMap = new WeakMap();
  let activeTreeRow = null;
  let activeBlockEl = null;

  const VIEW_MODES = ["xml", "split", "structure"];
  const VIEW_STORAGE_KEY = "oxv-view-mode";

  // We render into a document whose contentType is still "application/xml"
  // (we only swapped documentElement; the document type is set at navigation
  // time and is read-only). In an XML document, document.createElement
  // returns an element in the null namespace — not an HTMLElement — which
  // means it has no .style, .dataset, .className-as-DOMTokenList, etc.
  // Patch createElement once so every subsequent call (here and in
  // onix-blocks.js) produces real HTMLElements.
  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const _createElementNS = document.createElementNS.bind(document);
  document.createElement = function (tagName) {
    return _createElementNS(HTML_NS, tagName);
  };

  // content.js stashes the source in a non-executing <script type="application/xml">
  // data block; the test harness still sets window.__OXV_SOURCE__ directly.
  const sourceEl = document.getElementById("__oxv-source__");
  const SOURCE = (sourceEl && sourceEl.textContent) || window.__OXV_SOURCE__ || "";
  const root = document.getElementById("oxv-root");
  const meta = document.getElementById("oxv-meta");
  const search = document.getElementById("oxv-search");
  const status = document.getElementById("oxv-search-status");

  // ---- parse ----------------------------------------------------------------

  const t0 = performance.now();
  const parser = new DOMParser();

  // DOMParser silently inserts a <parsererror> element instead of throwing.
  // Probe both XML and (as fallback) text/xml — they're equivalent here.
  const doc = parser.parseFromString(SOURCE, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];

  if (parserError) {
    showParseError(parserError);
    return;
  }

  const onixCtx = window.OnixViewerOnix
    ? window.OnixViewerOnix.detect(doc)
    : { isOnix: false, dialect: null, version: null };

  // ---- render ---------------------------------------------------------------

  // Render is iterative-via-recursion; XML trees are rarely deep enough to
  // overflow the JS stack (the standard browser limit is ~10k frames).
  renderNode(doc, root, 0);

  const t1 = performance.now();
  const sizeKB = (SOURCE.length / 1024).toFixed(1);
  const ms = (t1 - t0).toFixed(0);

  // Right pane: ONIX blocks. Hidden entirely when the document isn't ONIX,
  // so non-ONIX XML keeps a single full-width tree.
  const blocksContainer = document.getElementById("oxv-blocks");
  let productCount = 0;
  if (onixCtx.isOnix && window.OnixViewerBlocks && blocksContainer) {
    productCount = window.OnixViewerBlocks.render(doc, blocksContainer, onixCtx) || 0;
  } else {
    document.body.classList.add("px-no-onix");
  }

  let metaText = `${sizeKB} KB · parsed in ${ms} ms`;
  if (onixCtx.isOnix) {
    const productsLabel = productCount === 1 ? "1 product" : `${productCount} products`;
    metaText = `ONIX ${onixCtx.version || "?"} (${productsLabel}) · ` + metaText;
    // Auto-collapse Product blocks for big ONIX feeds — otherwise scrolling
    // through 50,000 products is hostile.
    autoCollapseProducts();
  }
  meta.textContent = metaText;

  setupToolbar();
  setupViewMode(onixCtx.isOnix);
  setupSearch();
  setupKeyboard();
  setupDivider();
  setupBlockSync();
  setupClickHandlers();

  // ---- rendering helpers ----------------------------------------------------

  function renderNode(node, parent, depth) {
    switch (node.nodeType) {
      case Node.DOCUMENT_NODE:
        // Preserve XML declaration if present in source. The DOM doesn't expose
        // it as a node, so sniff the source string.
        if (/^\s*<\?xml\b/i.test(SOURCE)) {
          const decl = SOURCE.match(/^\s*<\?xml[^?]*\?>/i);
          if (decl) {
            appendRow(parent, depth, false, (row) => {
              const span = document.createElement("span");
              span.className = "px-pi";
              span.textContent = decl[0].trim();
              row.appendChild(span);
            });
          }
        }
        // Doctype, processing instructions, comments before root, then root.
        for (const child of node.childNodes) renderNode(child, parent, depth);
        break;

      case Node.DOCUMENT_TYPE_NODE: {
        appendRow(parent, depth, false, (row) => {
          const span = document.createElement("span");
          span.className = "px-pi";
          let s = `<!DOCTYPE ${node.name}`;
          if (node.publicId) s += ` PUBLIC "${node.publicId}"`;
          if (node.systemId) s += ` "${node.systemId}"`;
          s += ">";
          span.textContent = s;
          row.appendChild(span);
        });
        break;
      }

      case Node.PROCESSING_INSTRUCTION_NODE:
        appendRow(parent, depth, false, (row) => {
          const span = document.createElement("span");
          span.className = "px-pi";
          span.textContent = `<?${node.target} ${node.data}?>`;
          row.appendChild(span);
        });
        break;

      case Node.COMMENT_NODE:
        appendRow(parent, depth, false, (row) => {
          const span = document.createElement("span");
          span.className = "px-comment";
          span.textContent = `<!-- ${node.nodeValue} -->`;
          row.appendChild(span);
        });
        break;

      case Node.ELEMENT_NODE:
        renderElement(node, parent, depth);
        break;

      case Node.TEXT_NODE: {
        const txt = node.nodeValue;
        if (!txt || !txt.trim()) return; // ignore whitespace-only text
        appendRow(parent, depth, false, (row) => {
          const span = document.createElement("span");
          span.className = "px-text";
          span.textContent = txt;
          row.appendChild(span);
        });
        break;
      }

      case Node.CDATA_SECTION_NODE:
        appendRow(parent, depth, false, (row) => {
          const open = document.createElement("span");
          open.className = "px-cdata-marker";
          open.textContent = "<![CDATA[";
          const body = document.createElement("span");
          body.className = "px-text";
          body.textContent = node.nodeValue;
          const close = document.createElement("span");
          close.className = "px-cdata-marker";
          close.textContent = "]]>";
          row.append(open, body, close);
        });
        break;
    }
  }

  function renderElement(el, parent, depth) {
    const elementChildren = Array.from(el.childNodes).filter(
      (n) => n.nodeType !== Node.TEXT_NODE || n.nodeValue.trim().length > 0
    );

    // Classify: leaf-text (single text/cdata child) vs. has-element-children
    // vs. truly empty.
    const onlyText =
      elementChildren.length > 0 &&
      elementChildren.every(
        (n) => n.nodeType === Node.TEXT_NODE || n.nodeType === Node.CDATA_SECTION_NODE
      );
    const empty = elementChildren.length === 0;

    if (empty) {
      // <Tag attr="val"/> — single row, self-closing.
      appendRow(parent, depth, false, (row) => {
        writeOpenTag(row, el, /* selfClose */ true);
      });
      return;
    }

    if (onlyText) {
      // <Tag>text</Tag> — single row, with optional codelist badge.
      const resolved = window.OnixViewerOnix
        ? window.OnixViewerOnix.resolveCodelist(el, onixCtx)
        : null;
      const textClass = resolved ? "px-text px-codelist-value" : "px-text";
      appendRow(parent, depth, false, (row) => {
        writeOpenTag(row, el, false);
        for (const c of elementChildren) {
          if (c.nodeType === Node.CDATA_SECTION_NODE) {
            const open = document.createElement("span");
            open.className = "px-cdata-marker";
            open.textContent = "<![CDATA[";
            const body = document.createElement("span");
            body.className = textClass;
            body.textContent = c.nodeValue;
            const close = document.createElement("span");
            close.className = "px-cdata-marker";
            close.textContent = "]]>";
            row.append(open, body, close);
          } else {
            const t = document.createElement("span");
            t.className = textClass;
            t.textContent = c.nodeValue;
            row.appendChild(t);
          }
        }
        writeCloseTag(row, el);

        if (resolved) {
          const badge = document.createElement("span");
          badge.className = "px-codelist";
          badge.textContent = `→ ${resolved.label}`;
          badge.title = `${el.localName || el.nodeName}: code resolved via ONIX code list`;
          row.appendChild(badge);
          if (resolved.url) row.appendChild(buildListLink(resolved));
        }
      });
      return;
    }

    // Has element children: open row (collapsible) + children container + close row.
    const openRow = appendRow(parent, depth, true, (row) => {
      const toggle = document.createElement("span");
      toggle.className = "px-toggle";
      toggle.setAttribute("aria-hidden", "true");
      row.appendChild(toggle);
      writeOpenTag(row, el, false);

      // When the row is folded, show "...</Tag>" inline so the structure
      // reads as <Tag>...</Tag> at a glance. Hidden by CSS when expanded.
      const ellipsis = document.createElement("span");
      ellipsis.className = "px-fold-ellipsis";
      ellipsis.textContent = "…";
      row.appendChild(ellipsis);

      const closeInline = document.createElement("span");
      closeInline.className = "px-tag px-fold-close";
      if (window.OnixViewerOnix) {
        const extra = window.OnixViewerOnix.tagClass(el, onixCtx);
        if (extra) closeInline.classList.add(extra);
      }
      closeInline.textContent = `</${el.nodeName}>`;
      row.appendChild(closeInline);

      // Inline summary span (visible when folded).
      if (window.OnixViewerOnix) {
        const summary = window.OnixViewerOnix.productSummary(el, onixCtx);
        if (summary) {
          const s = document.createElement("span");
          s.className = "px-summary";
          s.textContent = summary;
          row.appendChild(s);
        }
      }
    });

    const childrenContainer = document.createElement("div");
    childrenContainer.className = "px-children";
    parent.appendChild(childrenContainer);
    for (const c of el.childNodes) renderNode(c, childrenContainer, depth + 1);

    const closeRow = appendRow(parent, depth, false, (row) => {
      writeCloseTag(row, el);
    });
    closeRow.classList.add("px-close-row");

    // Fold/highlight handling is delegated on #oxv-root in setupClickHandlers
    // — clicking the chevron toggles, clicking elsewhere highlights the
    // matching right-pane element.
  }

  function writeOpenTag(row, el, selfClose) {
    const lt = document.createElement("span");
    lt.className = "px-tag";
    lt.textContent = "<";
    row.appendChild(lt);

    const name = document.createElement("span");
    name.className = "px-tag";
    if (window.OnixViewerOnix) {
      const extra = window.OnixViewerOnix.tagClass(el, onixCtx);
      if (extra) name.classList.add(extra);
    }
    name.textContent = el.nodeName; // preserve original case
    row.appendChild(name);

    for (const attr of el.attributes) {
      const sp = document.createTextNode(" ");
      row.appendChild(sp);
      const span = document.createElement("span");
      span.className = "px-attr";
      const an = document.createElement("span");
      an.className = "px-attr-name";
      an.textContent = attr.name;
      const eq = document.createTextNode("=");
      const av = document.createElement("span");
      av.className = "px-attr-value";
      av.textContent = `"${attr.value.replace(/"/g, "&quot;")}"`;
      if (window.OnixViewerOnix && onixCtx.isOnix) {
        const resolvedAttr = window.OnixViewerOnix.resolveAttributeCodelist(attr.name, attr.value);
        if (resolvedAttr) {
          av.classList.add("px-codelist-value");
          av.title = `${attr.name}: ${resolvedAttr.label}`;
        }
      }
      span.append(an, eq, av);
      row.appendChild(span);
    }

    const gt = document.createElement("span");
    gt.className = "px-tag";
    gt.textContent = selfClose ? "/>" : ">";
    row.appendChild(gt);
  }

  function writeCloseTag(row, el) {
    const close = document.createElement("span");
    close.className = "px-tag";
    if (window.OnixViewerOnix) {
      const extra = window.OnixViewerOnix.tagClass(el, onixCtx);
      if (extra) close.classList.add(extra);
    }
    close.textContent = `</${el.nodeName}>`;
    row.appendChild(close);
  }

  function buildListLink(resolved) {
    const a = document.createElement("a");
    a.className = "px-codelist-link";
    a.href = resolved.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = `Open ${resolved.listName}`;
    a.textContent = resolved.listName;
    if (window.OnixViewerOnix && window.OnixViewerOnix.externalLinkIcon) {
      a.appendChild(window.OnixViewerOnix.externalLinkIcon());
    }
    a.addEventListener("click", (ev) => {
      // Plain clicks open the in-page popup. Cmd/Ctrl/Shift-click still hits
      // the href as a normal anchor (open in new tab/window).
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      if (!window.OnixViewerPopup) return;
      ev.preventDefault();
      window.OnixViewerPopup.show(resolved.codelistKey, resolved.value);
    });
    return a;
  }

  function appendRow(parent, depth, collapsible, fill) {
    const row = document.createElement("div");
    row.className = "px-row" + (collapsible ? " px-collapsible" : "");
    row.style.setProperty("--depth", String(depth));
    fill(row);
    parent.appendChild(row);
    return row;
  }

  function autoCollapseProducts() {
    // Find every open-row whose first tag span's text is a Product element
    // (in either dialect). With more than one we collapse them so a long
    // feed is scannable; with a single product we leave it expanded since
    // the user is clearly inspecting that one record.
    const rows = root.querySelectorAll(".px-row.px-collapsible");
    const productRows = [];
    for (const row of rows) {
      const firstTag = row.querySelector(".px-tag + .px-tag"); // skip "<"
      if (!firstTag) continue;
      if ((firstTag.textContent || "").toLowerCase() === "product") {
        productRows.push(row);
      }
    }
    if (productRows.length <= 1) return;
    for (const row of productRows) row.classList.add("px-folded");
  }

  // ---- toolbar --------------------------------------------------------------

  function setupToolbar() {
    document.getElementById("oxv-toolbar").addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-action]");
      if (!btn) return;
      switch (btn.dataset.action) {
        case "expand-all":
          for (const r of root.querySelectorAll(".px-folded")) r.classList.remove("px-folded");
          break;
        case "collapse-all":
          for (const r of root.querySelectorAll(".px-collapsible")) r.classList.add("px-folded");
          break;
        case "toggle-attrs": {
          const on = document.body.classList.toggle("px-no-attrs");
          btn.setAttribute("aria-pressed", on ? "false" : "true");
          break;
        }
        case "toggle-wrap": {
          // Wrap is the default; pressing the button turns it OFF.
          const off = document.body.classList.toggle("px-no-wrap");
          btn.setAttribute("aria-pressed", off ? "false" : "true");
          break;
        }
        case "view-xml":
        case "view-split":
        case "view-structure":
          applyViewMode(btn.dataset.action.slice("view-".length));
          break;
      }
    });
  }

  // ---- view mode (XML / Split / Structure) ---------------------------------

  function setupViewMode(isOnix) {
    // View mode (XML / Split / Structure) is currently DISABLED in the UI:
    // the toggle buttons are commented out of the toolbar in content.js.
    // We force XML view here so any state previously persisted in
    // localStorage (from when the toggle was exposed) doesn't bleed through.
    // To re-enable: restore the .px-view-group block in content.js and
    // delete this early-return.
    applyViewMode("xml", { persist: false });
    return;

    // eslint-disable-next-line no-unreachable
    if (!isOnix) {
      applyViewMode("xml", { persist: false });
      return;
    }
    let stored = null;
    try { stored = window.localStorage && localStorage.getItem(VIEW_STORAGE_KEY); } catch (_) {}
    const initial = VIEW_MODES.includes(stored) ? stored : "xml";
    applyViewMode(initial, { persist: false });
  }

  function applyViewMode(mode, opts) {
    if (!VIEW_MODES.includes(mode)) return;
    const persist = !opts || opts.persist !== false;
    for (const m of VIEW_MODES) document.body.classList.remove(`oxv-view-${m}`);
    document.body.classList.add(`oxv-view-${mode}`);
    for (const btn of document.querySelectorAll('#oxv-toolbar [data-action^="view-"]')) {
      const isActive = btn.dataset.action === `view-${mode}`;
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
    if (persist) {
      try { localStorage.setItem(VIEW_STORAGE_KEY, mode); } catch (_) {}
    }
  }

  // ---- search ---------------------------------------------------------------

  let matches = [];
  let matchIndex = -1;
  let searchTimer = null;

  function setupSearch() {
    search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 120);
    });
    search.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        if (ev.shiftKey) gotoMatch(matchIndex - 1);
        else gotoMatch(matchIndex + 1);
      } else if (ev.key === "Escape") {
        search.value = "";
        runSearch();
        search.blur();
      }
    });
  }

  function runSearch() {
    // Clear previous highlights.
    for (const m of root.querySelectorAll(".px-match, .px-match-current")) {
      m.classList.remove("px-match", "px-match-current");
    }
    matches = [];
    matchIndex = -1;
    const q = search.value.trim();
    if (!q) {
      status.textContent = "";
      return;
    }
    const needle = q.toLowerCase();

    // Walk text nodes. Mark the containing span — full substring highlighting
    // would require splitting text nodes, which is doable but adds complexity
    // for marginal gain in a tree where each node is short.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      const txt = n.nodeValue;
      if (txt && txt.toLowerCase().includes(needle)) {
        const host = n.parentElement;
        if (host && !host.classList.contains("px-match")) {
          host.classList.add("px-match");
          matches.push(host);
        }
      }
    }
    status.textContent = matches.length ? `1/${matches.length}` : "no matches";
    if (matches.length) gotoMatch(0);
  }

  function gotoMatch(i) {
    if (!matches.length) return;
    if (i < 0) i = matches.length - 1;
    if (i >= matches.length) i = 0;
    if (matchIndex >= 0 && matches[matchIndex]) {
      matches[matchIndex].classList.remove("px-match-current");
    }
    matchIndex = i;
    const target = matches[matchIndex];
    target.classList.add("px-match-current");

    // Unfold any ancestor that's folded so the match is visible.
    let p = target.parentElement;
    while (p && p !== root) {
      if (p.classList.contains("px-children")) {
        const opener = p.previousElementSibling;
        if (opener && opener.classList.contains("px-folded")) {
          opener.classList.remove("px-folded");
        }
      }
      p = p.parentElement;
    }
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    status.textContent = `${matchIndex + 1}/${matches.length}`;
  }

  // ---- keyboard -------------------------------------------------------------

  function setupKeyboard() {
    document.addEventListener("keydown", (ev) => {
      // Skip when the user is typing in an input.
      if (ev.target instanceof HTMLInputElement) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

      switch (ev.key) {
        case "/":
          ev.preventDefault();
          search.focus();
          search.select();
          break;
        case "e":
          for (const r of root.querySelectorAll(".px-folded")) r.classList.remove("px-folded");
          break;
        case "c":
          for (const r of root.querySelectorAll(".px-collapsible")) r.classList.add("px-folded");
          break;
        case "w":
          document.body.classList.toggle("px-no-wrap");
          break;
      }
    });
  }

  // ---- pane sync ------------------------------------------------------------

  // Keep tree rows and right-pane elements in collapse-sync. Two pairings:
  //   1. Each <Product> tree row ↔ its product card (a <details>).
  //   2. Each ONIX block tree row (DescriptiveDetail, CollateralDetail, etc.)
  //      ↔ its block section (also a <details>) inside the matching card.
  // Block elements are direct children of <Product>, and there's at most one
  // of each per product, so the pairing is unambiguous.
  function setupBlockSync() {
    if (!onixCtx.isOnix) return;

    const productRows = Array.from(root.querySelectorAll(".px-row.px-collapsible"))
      .filter((r) => {
        const tags = r.querySelectorAll(".px-tag");
        return tags.length >= 2 && tags[1].textContent === "Product";
      });
    const allCards = Array.from(document.querySelectorAll("#oxv-blocks .px-block-product"));
    // The Message Header card (if present) sits before Product cards. Pair
    // it with the <Header> tree row separately, then strip it from the cards
    // list so the Nth Product card pairs with the Nth Product row.
    const headerCard = document.querySelector("#oxv-blocks .px-message-header");
    const cards = allCards.filter((c) => !c.classList.contains("px-message-header"));
    if (!cards.length && !headerCard) return;

    productRows.forEach((row, i) => { row.dataset.oxvProductIndex = String(i); });

    // Pair-bind: keep one tree row class state in step with one <details>
    // open state. Idempotent (no-op when both already match), so we don't
    // need a re-entry guard. Also records the bidirectional partner lookup
    // used by click-to-highlight.
    function bindPair(row, det) {
      if (!row || !det) return;
      pairMap.set(row, det);
      pairMap.set(det, row);
      function sync(folded) {
        row.classList.toggle("px-folded", folded);
        det.open = !folded;
      }
      new MutationObserver(() => {
        sync(row.classList.contains("px-folded"));
      }).observe(row, { attributes: true, attributeFilter: ["class"] });
      det.addEventListener("toggle", () => {
        sync(!det.open);
      });
      // Initial alignment: tree state wins, so the right pane mirrors any
      // auto-collapsed state by the time the user sees the page.
      sync(row.classList.contains("px-folded"));
    }

    // Header-level pairing (only present in ONIXMessage-wrapped feeds).
    if (headerCard) {
      const headerRow = Array.from(root.querySelectorAll(".px-row.px-collapsible"))
        .find((r) => {
          const tags = r.querySelectorAll(".px-tag");
          return tags.length >= 2 && tags[1].textContent.toLowerCase() === "header";
        });
      if (headerRow) bindPair(headerRow, headerCard);
    }

    // Product-level pairing
    productRows.forEach((row, i) => bindPair(row, cards[i]));

    // Block-level pairing
    productRows.forEach((productRow, i) => {
      const card = cards[i];
      if (!card) return;
      const childrenContainer = productRow.nextElementSibling;
      if (!childrenContainer || !childrenContainer.classList.contains("px-children")) return;
      const directRows = childrenContainer.querySelectorAll(":scope > .px-row.px-collapsible");
      for (const blockRow of directRows) {
        const tags = blockRow.querySelectorAll(".px-tag");
        if (tags.length < 2) continue;
        const name = (tags[1].textContent || "").toLowerCase();
        if (!ONIX_BLOCK_NAMES.has(name)) continue;
        blockRow.dataset.oxvBlockName = name;
        const section = card.querySelector(`.px-block-section[data-oxv-block-name="${name}"]`);
        if (section) bindPair(blockRow, section);
      }
    });

    // Sub-block-level pairing. Walk all rows under each Product and tag every
    // collapsible row with its element name and a per-element-type index.
    // Then for each <details data-oxv-onix-element="…" data-oxv-onix-idx="…">
    // in the card, find the row with the matching attrs and bind them.
    productRows.forEach((productRow, i) => {
      const card = cards[i];
      if (!card) return;
      const productContainer = productRow.nextElementSibling;
      if (!productContainer || !productContainer.classList.contains("px-children")) return;

      indexProductRows(productContainer);

      const subDetails = card.querySelectorAll(
        "details[data-oxv-onix-element][data-oxv-onix-idx]"
      );
      for (const det of subDetails) {
        const name = det.dataset.oxvOnixElement;
        const idx = det.dataset.oxvOnixIdx;
        const row = productContainer.querySelector(
          `.px-row.px-collapsible[data-oxv-element-name="${name}"][data-oxv-element-idx="${idx}"]`
        );
        if (row) bindPair(row, det);
      }

      // Leaf-level pairing: connect each .px-block-row leaf field on the
      // right with its matching leaf row in the tree. No collapse-sync —
      // these can't fold — just enough of a link for click-to-highlight.
      const leafRows = card.querySelectorAll(
        ".px-block-row[data-oxv-onix-element][data-oxv-onix-idx]"
      );
      for (const leaf of leafRows) {
        const name = leaf.dataset.oxvOnixElement;
        const idx = leaf.dataset.oxvOnixIdx;
        const row = productContainer.querySelector(
          `.px-row[data-oxv-element-name="${name}"][data-oxv-element-idx="${idx}"]`
        );
        if (row) {
          pairMap.set(row, leaf);
          pairMap.set(leaf, row);
        }
      }
    });
  }

  // Tag every collapsible tree row under a Product with `data-oxv-element-name`
  // and `data-oxv-element-idx` (the Nth occurrence of that name within this
  // Product, in document order). Used to match sub-block <details> in the
  // right pane to their corresponding tree rows.
  function indexProductRows(productContainer) {
    const counts = new Map();
    const stack = [productContainer];
    while (stack.length) {
      const container = stack.pop();
      for (const row of container.children) {
        if (!row.classList || !row.classList.contains("px-row")) continue;
        const tags = row.querySelectorAll(".px-tag");
        // Index ALL rows (not just collapsible) so leaf elements can be
        // paired with their right-pane counterparts for click-to-highlight.
        if (tags.length >= 2) {
          const name = (tags[1].textContent || "").toLowerCase();
          const idx = counts.get(name) || 0;
          row.dataset.oxvElementName = name;
          row.dataset.oxvElementIdx = String(idx);
          counts.set(name, idx + 1);
        }
        const sib = row.nextElementSibling;
        if (sib && sib.classList && sib.classList.contains("px-children")) {
          stack.push(sib);
        }
      }
    }
  }

  // ---- click + highlight ----------------------------------------------------

  // Tree → highlight matching right-pane element. Right pane → highlight
  // matching tree row. Only the chevron click toggles collapse on either
  // side; clicking elsewhere on a row/summary highlights its partner.
  function setupClickHandlers() {
    root.addEventListener("click", (ev) => {
      const row = ev.target.closest(".px-row");
      if (!row) return;
      if (ev.target.closest("input, button, a")) return;

      // Chevron click → toggle (only collapsible rows have a chevron).
      if (ev.target.closest(".px-toggle")) {
        if (row.classList.contains("px-collapsible")) {
          row.classList.toggle("px-folded");
        }
        return;
      }

      // Don't grab focus while the user is selecting text.
      if (window.getSelection().toString()) return;

      const partner = pairMap.get(row);
      if (partner) highlightInBlocks(partner);
      setActiveTreeRow(row);
    });

    const blocksPane = document.getElementById("oxv-blocks-pane");
    if (!blocksPane) return;

    blocksPane.addEventListener("click", (ev) => {
      if (ev.target.closest("a, button, input")) return;

      const summary = ev.target.closest("summary");
      if (summary) {
        // Chevron click → let the default <details> toggle through.
        if (ev.target.closest(".px-chevron")) return;
        ev.preventDefault();
        const det = summary.parentElement;
        const partner = pairMap.get(det);
        if (partner) highlightInTree(partner);
        setActiveBlockEl(det);
        return;
      }

      // Leaf field click: highlight the matching tree row.
      const leaf = ev.target.closest(".px-block-row[data-oxv-onix-element]");
      if (leaf) {
        const partner = pairMap.get(leaf);
        if (partner) highlightInTree(partner);
        setActiveBlockEl(leaf);
      }
    });
  }

  function setActiveTreeRow(row) {
    if (activeTreeRow && activeTreeRow !== row) {
      activeTreeRow.classList.remove("px-active");
    }
    row.classList.add("px-active");
    activeTreeRow = row;
  }

  function setActiveBlockEl(el) {
    if (activeBlockEl && activeBlockEl !== el) {
      activeBlockEl.classList.remove("px-active");
    }
    el.classList.add("px-active");
    activeBlockEl = el;
  }

  function highlightInBlocks(blockEl) {
    if (!blockEl) return;
    setActiveBlockEl(blockEl);
    // Open any ancestor <details> so the target is visible, then scroll.
    let p = blockEl.parentElement;
    while (p) {
      if (p.tagName && p.tagName.toLowerCase() === "details" && !p.open) p.open = true;
      p = p.parentElement;
    }
    if (blockEl.scrollIntoView) blockEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function highlightInTree(row) {
    if (!row) return;
    setActiveTreeRow(row);
    // Unfold any ancestor open-row that's currently collapsed.
    let p = row.parentElement;
    while (p && p !== root) {
      if (p.classList.contains("px-children")) {
        const opener = p.previousElementSibling;
        if (opener && opener.classList.contains("px-folded")) {
          opener.classList.remove("px-folded");
        }
      }
      p = p.parentElement;
    }
    if (row.scrollIntoView) row.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // ---- divider --------------------------------------------------------------

  function setupDivider() {
    const divider = document.getElementById("oxv-divider");
    const main = document.getElementById("oxv-main");
    if (!divider || !main) return;

    const STORAGE_KEY = "oxv-split-pos";
    let stored = null;
    try { stored = window.localStorage && localStorage.getItem(STORAGE_KEY); } catch (_) {}
    if (stored) main.style.setProperty("--split-pos", stored);

    let dragging = false;
    divider.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      dragging = true;
      try { divider.setPointerCapture(ev.pointerId); } catch (_) {}
    });
    divider.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      const rect = main.getBoundingClientRect();
      if (rect.width <= 0) return;
      let pct = ((ev.clientX - rect.left) / rect.width) * 100;
      if (pct < 15) pct = 15;
      if (pct > 85) pct = 85;
      main.style.setProperty("--split-pos", `${pct.toFixed(2)}%`);
    });
    const stopDrag = () => {
      if (!dragging) return;
      dragging = false;
      const value = main.style.getPropertyValue("--split-pos");
      if (value) {
        try { localStorage.setItem(STORAGE_KEY, value); } catch (_) {}
      }
    };
    divider.addEventListener("pointerup", stopDrag);
    divider.addEventListener("pointercancel", stopDrag);
  }

  // ---- error UI -------------------------------------------------------------

  function showParseError(errEl) {
    root.innerHTML = "";
    const box = document.createElement("div");
    box.className = "px-error";
    const h = document.createElement("h2");
    h.textContent = "Could not parse XML";
    const p = document.createElement("p");
    p.textContent = errEl.textContent || "The document is not well-formed.";
    const pre = document.createElement("pre");
    // Show the first 2000 chars of source for context.
    pre.textContent = SOURCE.slice(0, 2000) + (SOURCE.length > 2000 ? "\n…" : "");
    box.append(h, p, pre);
    root.appendChild(box);
    meta.textContent = "parse error";
  }
})();

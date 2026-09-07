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

  // Lower-cased names of the ONIX 3.x block elements (DescriptiveDetail …
  // PromotionDetail). The table lives in onix.js next to the block numbers.
  const ONIX_BLOCK_NAMES = window.OnixViewerOnix
    ? window.OnixViewerOnix.blockNames
    : new Set();

  // Named here so "Collapse blocks" is inert on non-ONIX documents, where the
  // ONIX module isn't consulted at all.
  const isProductElement = window.OnixViewerOnix
    ? window.OnixViewerOnix.isProductElement
    : () => false;

  // Bidirectional map between a tree row and its right-pane <details>.
  // Populated by setupBlockSync.bindPair(); used by click-to-highlight.
  const pairMap = new WeakMap();
  // Tree row → the source DOM element it renders. Used by the per-node
  // menu ("Copy node XML") to serialise the original, undecorated subtree.
  const rowElements = new WeakMap();
  // The reverse, so a validation finding can be pinned to the row that shows
  // the element it is about.
  const elementRows = new WeakMap();
  let activeTreeRow = null;
  let activeBlockEl = null;

  const VIEW_MODES = ["xml", "split", "structure"];
  const VIEW_STORAGE_KEY = "oxv-view-mode";
  const DIALECT_STORAGE_KEY = "oxv-dialect";

  // The dialect the document is written in, and the one currently on screen.
  // They differ once the reader flips the toolbar toggle.
  let sourceDialect = null;
  let displayDialect = null;

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

  // Two enabled copies of the extension (a Web Store install alongside an
  // unpacked one) each inject this file. The second copy's shell replaces the
  // first one's, but the first copy's scripts still execute — removing a
  // dynamically inserted <script> from the document doesn't cancel it — so
  // both instances would render into the surviving #oxv-root and double up
  // every click handler, leaving the tree drawn twice and the fold chevrons
  // dead (two handlers toggling px-folded cancel each other out). The first
  // instance to arrive wins; later ones bail out here.
  if (!root || root.firstElementChild) return;

  const meta = document.getElementById("oxv-meta");
  // EDItEUR schema info label in the toolbar — driven by the constant
  // OnixViewerCodeListSchema baked into onix-codelists.js at generation time.
  const schemaLabel = document.getElementById("oxv-schema");
  if (schemaLabel && window.OnixViewerCodeListSchema) {
    const s = window.OnixViewerCodeListSchema;
    if (s.issue != null) {
      schemaLabel.textContent = `EDItEUR ONIX ${s.version}, Issue ${s.issue}`;
      if (s.releaseDate) schemaLabel.title = `Schema released ${s.releaseDate}`;
    }
  }
  const search = document.getElementById("oxv-search");
  const status = document.getElementById("oxv-search-status");

  // ---- parse ----------------------------------------------------------------

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

  sourceDialect = onixCtx.dialect;
  displayDialect = preferredDialect();

  // Render is iterative-via-recursion; XML trees are rarely deep enough to
  // overflow the JS stack (the standard browser limit is ~10k frames).
  renderNode(doc, root, 0);

  const sizeKB = (SOURCE.length / 1024).toFixed(1);

  // Right pane: ONIX blocks. Hidden entirely when the document isn't ONIX,
  // so non-ONIX XML keeps a single full-width tree.
  const blocksContainer = document.getElementById("oxv-blocks");
  let productCount = 0;
  if (onixCtx.isOnix && window.OnixViewerBlocks && blocksContainer) {
    productCount = window.OnixViewerBlocks.render(doc, blocksContainer, onixCtx) || 0;
  } else {
    document.body.classList.add("px-no-onix");
  }

  let metaText = `${sizeKB} KB`;
  if (onixCtx.isOnix) {
    // Version is unknown for un-namespaced standalone <Product> records (there's
    // no namespace to read it from) — omit it rather than show "ONIX ?".
    const versionPart = onixCtx.version ? ` ${onixCtx.version}` : "";
    if (onixCtx.messageType === "acknowledgement") {
      // Acknowledgement <Product> blocks are record statuses, not product
      // records — label the count "records" to match.
      const recordsLabel = productCount === 1 ? "1 record" : `${productCount} records`;
      metaText = `ONIX Acknowledgement${versionPart} (${recordsLabel}) · ` + metaText;
    } else {
      const productsLabel = productCount === 1 ? "1 product" : `${productCount} products`;
      const dialectPart = onixCtx.dialect ? ` ${dialectLabel(onixCtx.dialect)}` : "";
      metaText = `ONIX${versionPart}${dialectPart} (${productsLabel}) · ` + metaText;
    }
    // Auto-collapse Product blocks for big ONIX feeds — otherwise scrolling
    // through 50,000 products is hostile.
    autoCollapseProducts();
  }
  meta.textContent = metaText;
  showBlockList();

  setupToolbar();
  setupDialectToggle();
  setupViewMode(onixCtx.isOnix);
  setupSearch();
  setupKeyboard();
  setupDivider();
  setupBlockSync();
  setupClickHandlers();
  setupNodeMenu();
  setupFindingsLabel();

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
      const selfClosingRow = appendRow(parent, depth, false, (row) => {
        writeOpenTag(row, el, /* selfClose */ true);
      });
      attachNodeMenu(selfClosingRow, el);
      return;
    }

    if (onlyText) {
      // <Tag>text</Tag> — single row, with optional codelist badge.
      const resolved = window.OnixViewerOnix
        ? window.OnixViewerOnix.resolveCodelist(el, onixCtx)
        : null;
      const textClass = resolved ? "px-text px-codelist-value" : "px-text";
      const leafRow = appendRow(parent, depth, false, (row) => {
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
      attachNodeMenu(leafRow, el);
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
      const foldDialectClass = displayedTagClass();
      if (foldDialectClass) closeInline.classList.add(foldDialectClass);
      closeInline.textContent = `</${displayedTagName(el.nodeName)}>`;
      closeInline.classList.add("px-tag-name");
      row.appendChild(closeInline);

      // "Block N" badge on ONIX 3.x block elements, visible folded or not.
      if (window.OnixViewerOnix) {
        const block = window.OnixViewerOnix.blockNumber(el, onixCtx);
        if (block) {
          const label = document.createElement("span");
          label.className = "px-block-label";
          label.textContent = `Block ${block}`;
          row.appendChild(label);
        }
      }

      // Inline summary span (visible when folded). onix.js decides which
      // composites have a one-line essence worth showing and returns null for
      // the rest.
      if (window.OnixViewerOnix) {
        const summary = window.OnixViewerOnix.nodeSummary(el, onixCtx);
        if (summary) {
          const s = document.createElement("span");
          s.className = "px-summary";
          s.textContent = summary;
          row.appendChild(s);
        }
      }
    });

    attachNodeMenu(openRow, el);

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
    name.className = "px-tag px-tag-name";
    const dialectClass = displayedTagClass();
    if (dialectClass) name.classList.add(dialectClass);
    name.textContent = displayedTagName(el.nodeName);
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
      // textContent neutralises the inner string; no HTML escaping needed.
      av.textContent = `"${attr.value}"`;
      let resolvedAttr = null;
      if (window.OnixViewerOnix && onixCtx.isOnix) {
        resolvedAttr = window.OnixViewerOnix.resolveAttributeCodelist(attr.name, attr.value);
        if (resolvedAttr) {
          av.classList.add("px-codelist-value");
          av.title = `${attr.name}: ${resolvedAttr.label}`;
        }
      }
      span.append(an, eq, av);
      if (resolvedAttr) span.appendChild(buildAttributeBadge(attr.name, resolvedAttr));
      row.appendChild(span);
    }

    const gt = document.createElement("span");
    gt.className = "px-tag";
    gt.textContent = selfClose ? "/>" : ">";
    row.appendChild(gt);
  }

  // "→ XHTML" chip right after a code-list attribute value, e.g.
  // <Text textformat="06" → XHTML>. Lives inside the .px-attr span so the
  // "hide attributes" toggle hides it along with the attribute.
  function buildAttributeBadge(attributeName, resolved) {
    const badge = document.createElement("span");
    badge.className = "px-codelist px-attr-codelist";
    badge.textContent = `→ ${resolved.label}`;
    badge.title = `${attributeName}: code resolved via ONIX List ${resolved.listNumber}`;
    return badge;
  }

  function writeCloseTag(row, el) {
    const close = document.createElement("span");
    close.className = "px-tag px-tag-name";
    const dialectClass = displayedTagClass();
    if (dialectClass) close.classList.add(dialectClass);
    close.textContent = `</${displayedTagName(el.nodeName)}>`;
    row.appendChild(close);
  }

  // ---- dialect toggle (reference names ↔ short tags) ------------------------

  // The tree is built in the dialect currently on display, so a reader whose
  // stored preference differs from the document pays no rewrite at load. Names
  // with no translation render as they are.
  function displayedTagName(nodeName) {
    let name = nodeName;
    if (translating()) {
      name = window.OnixViewerOnix.translatedName(nodeName, displayDialect) || nodeName;
    }
    return name;
  }

  // Short tags render italic, reference names don't, so the class follows the
  // displayed dialect rather than the document's own.
  function displayedTagClass() {
    let className = "";
    if (onixCtx.isOnix) {
      className = displayDialect === "short" ? "px-onix-short" : "px-onix-ref";
    }
    return className;
  }

  function otherDialect(dialect) {
    return dialect === "short" ? "reference" : "short";
  }

  function preferredDialect() {
    let preferred = onixCtx.dialect;
    if (onixCtx.isOnix && onixCtx.dialect) {
      let stored = null;
      try { stored = window.localStorage && localStorage.getItem(DIALECT_STORAGE_KEY); } catch (_) {}
      if (stored === "reference" || stored === "short") preferred = stored;
    }
    return preferred;
  }

  // Hidden unless the document is ONIX in a known dialect — there's nothing
  // to translate between otherwise. The tree is already rendered in the
  // preferred dialect by this point, so there is nothing to rewrite: this
  // only lights up the right button.
  function setupDialectToggle() {
    if (!onixCtx.isOnix || !sourceDialect) {
      document.body.classList.add("px-no-dialect-toggle");
      return;
    }
    // The label names the translation and never changes, so the document's
    // own dialect is always the unpressed state: "View as reference names"
    // can only appear over a short-tag file.
    const button = document.querySelector('#oxv-toolbar [data-action="dialect-toggle"]');
    if (button) {
      const target = dialectLabel(otherDialect(sourceDialect));
      button.textContent = `View as ${target}`;
      button.title = `Show this ${dialectLabel(sourceDialect)} document as ${target} (T). ` +
        "Copying follows the view.";
    }
    markPressedDialect();
  }

  // EDItEUR's own terms: the schemas are the "reference tag version" and the
  // "short tag version", and every element declares a refname and a shortname.
  function dialectLabel(dialect) {
    return dialect === "short" ? "short tags" : "reference names";
  }

  function applyDialect(target) {
    if (target !== "reference" && target !== "short") return;
    if (!onixCtx.isOnix || !sourceDialect) return;

    if (target !== displayDialect) {
      // Each name is re-derived from the one on screen rather than from a
      // counterpart stashed per span — nothing to store, and translatedName
      // returns null for a name already in the target dialect, so repeating a
      // switch is harmless.
      const translate = window.OnixViewerOnix.translatedName;
      for (const span of root.querySelectorAll(".px-tag-name")) {
        const text = span.textContent;
        const closing = text.startsWith("</");
        const current = closing ? text.slice(2, -1) : text;
        const translated = translate(current, target);
        if (translated) span.textContent = closing ? `</${translated}>` : translated;
        // Short tags render italic, reference names don't — follow the names.
        if (span.classList.contains("px-onix-short") || span.classList.contains("px-onix-ref")) {
          span.classList.toggle("px-onix-short", target === "short");
          span.classList.toggle("px-onix-ref", target !== "short");
        }
      }
      displayDialect = target;
      try { localStorage.setItem(DIALECT_STORAGE_KEY, displayDialect); } catch (_) {}
    }

    markPressedDialect();
  }

  // Pressed means "you are looking at the translation", not the source.
  function markPressedDialect() {
    const button = document.querySelector('#oxv-toolbar [data-action="dialect-toggle"]');
    if (button) button.setAttribute("aria-pressed", displayDialect === sourceDialect ? "false" : "true");
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

  // Prepend the small "⋮" gutter button that opens the per-node menu. Only
  // element rows get one (open rows, leaf rows, self-closing rows) — close
  // rows, comments, PIs and text rows have nothing meaningful to copy.
  function attachNodeMenu(row, element) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "px-node-menu-btn";
    button.title = "Node actions";
    button.setAttribute("aria-label", `Actions for ${element.nodeName}`);
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.textContent = "⋮";
    row.prepend(button);
    rowElements.set(row, element);
    if (!elementRows.has(element)) elementRows.set(element, row);
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
        case "collapse-blocks":
          collapseBlocks();
          break;
        case "validate":
          runValidation();
          break;
        case "dialect-toggle":
          applyDialect(otherDialect(displayDialect));
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
        case "copy-xml":
          copyRawXml(btn);
          break;
      }
    });
  }

  // ---- block list pill ------------------------------------------------------

  // "Blocks: 1, 4, 6" in the toolbar — only meaningful for a document with
  // exactly one Product, so it stays empty (and hidden) otherwise.
  function showBlockList() {
    const pill = document.getElementById("oxv-block-list");
    const numbers = window.OnixViewerOnix && pill
      ? window.OnixViewerOnix.singleProductBlocks(doc, onixCtx)
      : null;
    if (numbers && numbers.length) {
      pill.textContent = `Blocks: ${numbers.join(", ")}`;
      pill.title = "ONIX blocks present in this Product";
    }
  }

  // ---- collapse blocks ------------------------------------------------------

  // Fold every composite inside each <Product> and make sure each is visible
  // by unfolding its ancestors, so a feed reads as a list of Products with
  // one row per child.
  function collapseBlocks() {
    for (const row of root.querySelectorAll(".px-row.px-collapsible")) {
      if (isProductChildRow(row)) {
        unfoldAncestors(row);
        row.classList.add("px-folded");
      }
    }
  }

  // Every composite sitting directly inside a <Product>: the seven ONIX
  // blocks plus the block-0 composites (ProductIdentifier,
  // RecordSourceIdentifier, Barcode), so a collapsed record reads as one line
  // per child instead of leaving those three sprawling. Keying on the parent
  // rather than a list of names covers both dialects and needs no upkeep as
  // ONIX gains elements — BLOCK_NUMBERS stays behind to drive the Block N
  // badge only.
  function isProductChildRow(row) {
    const element = rowElements.get(row);
    return !!element && isProductElement(element.parentNode);
  }

  // Unfold every folded open-row above `node` so it becomes visible. Works
  // for any node inside the tree, not just rows.
  function unfoldAncestors(node) {
    let parent = node.parentElement;
    while (parent && parent !== root) {
      if (parent.classList.contains("px-children")) {
        const opener = parent.previousElementSibling;
        if (opener) opener.classList.remove("px-folded");
      }
      parent = parent.parentElement;
    }
  }

  // ---- validation -----------------------------------------------------------

  // On demand only: a 12 MB feed is a couple of seconds' work, which is fine
  // for a button press and not fine on every page load.
  // The last run, so the summary label can open a list of it.
  let lastValidation = null;

  function runValidation() {
    const status = document.getElementById("oxv-validation");
    if (!window.OnixViewerValidation || !onixCtx.isOnix) {
      if (status) status.textContent = "";
      return;
    }
    clearFindings();
    lastValidation = window.OnixViewerValidation.run(doc, onixCtx);
    for (const finding of lastValidation.findings) pinFinding(finding);
    if (status) {
      status.textContent = summariseValidation(lastValidation);
      status.title = lastValidation.total ? "Click for the full list" : validationScopeNote(lastValidation);
      status.className = lastValidation.total ? "px-invalid" : "px-valid";
      status.setAttribute("role", lastValidation.total ? "button" : "status");
      if (lastValidation.total) status.setAttribute("tabindex", "0");
      else status.removeAttribute("tabindex");
    }
    const firstRow = root.querySelector(".px-has-finding");
    if (firstRow) revealRow(firstRow);
  }

  function validationScopeNote(result) {
    return result.checkedStructure
      ? `Checked against the bundled ONIX ${result.version} content model`
      : `No content model bundled for ONIX ${onixCtx.version || "?"} — code lists were still checked`;
  }

  // "3 errors, 2 warnings" says more than "5 problems": the two counts are
  // what a reader acts on differently.
  function summariseValidation(result) {
    if (!result.total) return "No problems found";
    const parts = [];
    if (result.errors) parts.push(countOf(result.errors, "error"));
    if (result.warnings) parts.push(countOf(result.warnings, "warning"));
    return parts.join(", ");
  }

  function countOf(n, noun) {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
  }

  function revealRow(row) {
    unfoldAncestors(row);
    setActiveTreeRow(row);
    if (row.scrollIntoView) row.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function clearFindings() {
    for (const marker of root.querySelectorAll(".px-finding")) marker.remove();
    for (const row of root.querySelectorAll(".px-has-finding, .px-has-error")) {
      row.classList.remove("px-has-finding", "px-has-error");
    }
  }

  // Findings carry the element they are about; the marker lands on that
  // element's row, or on the root row when the element isn't rendered.
  function pinFinding(finding) {
    const row = (finding.node && elementRows.get(finding.node)) || root.querySelector(".px-row");
    if (!row) return;
    const isError = finding.severity === "error";
    row.classList.add("px-has-finding");
    if (isError) row.classList.add("px-has-error");

    const text = window.OnixViewerValidation.message(finding);
    const existing = row.querySelector(".px-finding");
    if (existing) {
      // A row can collect several findings: the marker takes the worst
      // severity and its tooltip lists them all.
      existing.title += `\n${text}`;
      const seen = Number(existing.dataset.oxvCount || 1) + 1;
      existing.dataset.oxvCount = String(seen);
      if (isError) existing.classList.add("px-sev-error");
      existing.classList.toggle("px-sev-warning", !existing.classList.contains("px-sev-error"));
      existing.textContent = `${existing.classList.contains("px-sev-error") ? "✕" : "⚠"} ${seen}`;
      return;
    }
    const marker = document.createElement("span");
    marker.className = `px-finding px-sev-${finding.severity}`;
    marker.textContent = isError ? "✕" : "⚠";
    marker.title = text;
    marker.dataset.oxvCode = finding.code;
    row.appendChild(marker);
  }

  // ---- findings list --------------------------------------------------------

  // Reuses the code-list popup's shell styling; the behaviour is its own,
  // because these entries link back into the tree.
  let findingsModal = null;

  function setupFindingsLabel() {
    const status = document.getElementById("oxv-validation");
    if (!status) return;
    status.addEventListener("click", showFindings);
    status.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showFindings();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && findingsModal && !findingsModal.hidden) closeFindings();
    });
  }

  function showFindings() {
    if (!lastValidation || !lastValidation.total) return;
    const overlay = ensureFindingsModal();
    const list = overlay.querySelector(".px-findings-list");
    list.textContent = "";
    for (const finding of lastValidation.findings) list.appendChild(findingEntry(finding));
    overlay.querySelector(".px-popup-eyebrow").textContent = validationScopeNote(lastValidation);
    overlay.querySelector(".px-popup-title").textContent = summariseValidation(lastValidation);
    overlay.querySelector(".px-popup-footer").textContent = lastValidation.truncated
      ? `Showing the first ${lastValidation.findings.length} of ${lastValidation.total}.`
      : "";
    overlay.hidden = false;
    const closeButton = overlay.querySelector(".px-popup-close");
    if (closeButton) closeButton.focus();
  }

  function findingEntry(finding) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "px-findings-item";
    item.dataset.oxvSeverity = finding.severity;

    const badge = document.createElement("span");
    badge.className = `px-findings-severity px-sev-${finding.severity}`;
    badge.textContent = finding.severity === "error" ? "Error" : "Warning";

    const where = document.createElement("span");
    where.className = "px-findings-where";
    where.textContent = finding.node ? `<${finding.node.nodeName}>` : "";

    const text = document.createElement("span");
    text.className = "px-findings-message";
    text.textContent = window.OnixViewerValidation.message(finding);

    item.append(badge, where, text);
    item.addEventListener("click", () => {
      const row = finding.node && elementRows.get(finding.node);
      closeFindings();
      if (row) revealRow(row);
    });
    return item;
  }

  function ensureFindingsModal() {
    if (findingsModal) return findingsModal;
    const overlay = document.createElement("div");
    overlay.className = "px-popup-overlay";
    overlay.id = "oxv-findings";
    overlay.hidden = true;

    const dialog = document.createElement("div");
    dialog.className = "px-popup";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const header = document.createElement("div");
    header.className = "px-popup-header";
    const titleWrap = document.createElement("div");
    titleWrap.className = "px-popup-title-wrap";
    const eyebrow = document.createElement("div");
    eyebrow.className = "px-popup-eyebrow";
    const title = document.createElement("div");
    title.className = "px-popup-title";
    titleWrap.append(eyebrow, title);
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "px-popup-close";
    closeButton.setAttribute("aria-label", "Close");
    closeButton.textContent = "✕";
    closeButton.addEventListener("click", closeFindings);
    header.append(titleWrap, closeButton);

    const body = document.createElement("div");
    body.className = "px-popup-body";
    const list = document.createElement("div");
    list.className = "px-findings-list";
    body.appendChild(list);

    const footer = document.createElement("div");
    footer.className = "px-popup-footer";

    dialog.append(header, body, footer);
    overlay.appendChild(dialog);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeFindings();
    });
    document.body.appendChild(overlay);
    findingsModal = overlay;
    return overlay;
  }

  function closeFindings() {
    if (findingsModal) findingsModal.hidden = true;
  }

  // ---- copy raw XML ---------------------------------------------------------

  // The "Copy XML" toolbar button hands the user the unannotated source.
  // SOURCE is the full original XML the viewer parsed — no codelist badges,
  // no List-N chips, no folding markers. navigator.clipboard.writeText is
  // the modern API; we keep a document.execCommand fallback for the rare
  // environments where the modern API isn't available (some file:// pages,
  // older browsers).
  function copyRawXml(btn) {
    const text = displayedXml();
    if (!text) {
      flashButton(btn, "Empty");
      return;
    }
    writeClipboard(text, () => flashButton(btn, "Copied"), () => flashButton(btn, "Failed"));
  }

  // What the reader is actually looking at. Untranslated, that's the source
  // byte for byte. Translated, it's rebuilt from the parsed document — which
  // still holds every whitespace node, so the indentation, comments and CDATA
  // of the original survive; only the element names and the EDItEUR namespace
  // change. The XML declaration isn't a DOM node, so it's carried across from
  // the source text.
  function displayedXml() {
    let xml = SOURCE || "";
    if (translating() && xml) {
      const translated = window.OnixViewerOnix.translateNode(doc, displayDialect);
      const serializer = new XMLSerializer();
      let body = "";
      for (const child of translated.childNodes) body += serializer.serializeToString(child);
      const declaration = SOURCE.match(/^\s*<\?xml[^?]*\?>\s*/i);
      xml = (declaration ? declaration[0] : "") + body;
    }
    return xml;
  }

  function translating() {
    return !!(window.OnixViewerOnix && sourceDialect && displayDialect !== sourceDialect);
  }

  // Prefer the async clipboard API; fall back to execCommand. Exactly one of
  // done() / failed() is called.
  function writeClipboard(text, done, failed) {
    const fallback = () => (execCopyFallback(text) ? done() : failed());
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function execCopyFallback(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (_) {}
    document.body.removeChild(ta);
    return ok;
  }

  function flashButton(btn, msg) {
    const original = btn.textContent;
    btn.textContent = msg;
    btn.setAttribute("disabled", "");
    setTimeout(() => {
      btn.textContent = original;
      btn.removeAttribute("disabled");
    }, 1200);
  }

  // ---- per-node menu --------------------------------------------------------

  // One shared dropdown, moved next to whichever gutter button opened it.
  // Menu items act on the source element of the row (via rowElements), so
  // what gets copied is the original XML subtree — no badges, list chips,
  // fold markers or other viewer decoration.
  let nodeMenu = null;
  let nodeMenuButton = null;

  function setupNodeMenu() {
    root.addEventListener("click", (event) => {
      const button = event.target.closest(".px-node-menu-btn");
      if (button) openNodeMenu(button);
    });
    document.addEventListener("click", (event) => {
      const insideMenu = event.target.closest(".px-node-menu, .px-node-menu-btn");
      if (nodeMenuButton && !insideMenu) closeNodeMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && nodeMenuButton) {
        const button = nodeMenuButton;
        closeNodeMenu();
        button.focus();
      }
    });
    // A fixed-position menu would drift away from its row on scroll.
    document.addEventListener("scroll", () => { if (nodeMenuButton) closeNodeMenu(); }, true);
  }

  function ensureNodeMenu() {
    if (!nodeMenu) {
      nodeMenu = document.createElement("div");
      nodeMenu.id = "oxv-node-menu";
      nodeMenu.className = "px-node-menu";
      nodeMenu.setAttribute("role", "menu");
      nodeMenu.hidden = true;

      const copyItem = document.createElement("button");
      copyItem.type = "button";
      copyItem.className = "px-node-menu-item";
      copyItem.setAttribute("role", "menuitem");
      copyItem.dataset.nodeAction = "copy-xml";
      copyItem.textContent = "Copy node XML";
      nodeMenu.appendChild(copyItem);

      nodeMenu.addEventListener("click", (event) => {
        const item = event.target.closest("[data-node-action]");
        if (item) runNodeAction(item.dataset.nodeAction, item);
      });
      document.body.appendChild(nodeMenu);
    }
    return nodeMenu;
  }

  function openNodeMenu(button) {
    const menu = ensureNodeMenu();
    if (nodeMenuButton && nodeMenuButton !== button) closeNodeMenu();
    nodeMenuButton = button;
    button.classList.add("px-open");
    button.setAttribute("aria-expanded", "true");
    menu.hidden = false;
    positionNodeMenu(menu, button);
    const firstItem = menu.querySelector(".px-node-menu-item");
    if (firstItem) firstItem.focus();
  }

  function positionNodeMenu(menu, button) {
    const anchor = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let left = anchor.left;
    let top = anchor.bottom + 2;
    if (top + menuRect.height > window.innerHeight) top = anchor.top - menuRect.height - 2;
    if (left + menuRect.width > window.innerWidth) left = window.innerWidth - menuRect.width - 4;
    menu.style.left = `${Math.max(0, left)}px`;
    menu.style.top = `${Math.max(0, top)}px`;
  }

  function closeNodeMenu() {
    if (nodeMenu) nodeMenu.hidden = true;
    if (nodeMenuButton) {
      nodeMenuButton.classList.remove("px-open");
      nodeMenuButton.setAttribute("aria-expanded", "false");
    }
    nodeMenuButton = null;
  }

  function runNodeAction(action, item) {
    const row = nodeMenuButton && nodeMenuButton.closest(".px-row");
    const element = row && rowElements.get(row);
    if (!element) {
      closeNodeMenu();
    } else if (action === "copy-xml") {
      copyNodeXml(element, item);
    }
  }

  function copyNodeXml(element, item) {
    const finish = (message) => {
      flashButton(item, message);
      setTimeout(closeNodeMenu, 900);
    };
    writeClipboard(nodeXml(element), () => finish("Copied"), () => finish("Failed"));
  }

  // Serialise an element the way it appears in the source: XMLSerializer
  // re-declares the element's namespace on the subtree root (correct for a
  // standalone fragment, but noise when the original element inherited it),
  // and inner lines keep their absolute indentation from the file, so the
  // result is de-indented to the element's own column.
  function nodeXml(element) {
    const copied = translating()
      ? window.OnixViewerOnix.translateNode(element, displayDialect)
      : element;
    let xml = new XMLSerializer().serializeToString(copied);
    // The "did the source declare it?" question is asked of the original; the
    // declaration to strip is the one the serialiser wrote for the copy.
    xml = stripSynthesizedNamespace(xml, element, copied.namespaceURI);
    return dedent(xml, leadingIndent(element));
  }

  function stripSynthesizedNamespace(xml, element, namespaceURI) {
    let result = xml;
    const namespace = namespaceURI || element.namespaceURI;
    const attributeName = element.prefix ? `xmlns:${element.prefix}` : "xmlns";
    if (namespace && !element.hasAttribute(attributeName)) {
      const declaration = ` ${attributeName}="${namespace}"`;
      const openTagEnd = xml.indexOf(">");
      const openTag = xml.slice(0, openTagEnd);
      result = openTag.replace(declaration, "") + xml.slice(openTagEnd);
    }
    return result;
  }

  // Whitespace between the last newline and the element's start tag.
  function leadingIndent(element) {
    let indent = "";
    const previous = element.previousSibling;
    if (previous && previous.nodeType === Node.TEXT_NODE) {
      const text = previous.nodeValue;
      const candidate = text.slice(text.lastIndexOf("\n") + 1);
      if (text.includes("\n") && /^[ \t]*$/.test(candidate)) indent = candidate;
    }
    return indent;
  }

  function dedent(xml, indent) {
    let result = xml;
    if (indent) {
      result = xml
        .split("\n")
        .map((line, i) => (i > 0 && line.startsWith(indent) ? line.slice(indent.length) : line))
        .join("\n");
    }
    return result;
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
    unfoldAncestors(target);
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
        case "b":
          collapseBlocks();
          break;
        case "w":
          document.body.classList.toggle("px-no-wrap");
          break;
        case "t":
          applyDialect(otherDialect(displayDialect));
          break;
        case "v":
          runValidation();
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
    unfoldAncestors(row);
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

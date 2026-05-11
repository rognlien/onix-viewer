// onix-blocks.js
// Builds the right-pane "blocks" view: one card per <Product> with a few
// human-friendly summary sections (Title, Identifiers, Contributors).
//
// Element-name lookups are case-insensitive and accept both reference-name
// and short-tag spellings, so the same code works against either dialect.
// Codelist labels come from window.OnixViewerCodeLists when available.

(function () {
  "use strict";

  function render(doc, container, ctx) {
    while (container.firstChild) container.removeChild(container.firstChild);
    if (!ctx || !ctx.isOnix) return 0;

    const root = doc.documentElement;

    // ONIX <Header> (only for ONIXMessage-wrapped feeds — standalone
    // <Product> documents have no message header). Render once, above the
    // product cards.
    const headerEl = findChildByName(root, ["header"]);
    if (headerEl) container.appendChild(renderMessageHeaderCard(headerEl, ctx));

    // ONIX docs come in two shapes: an <ONIXMessage> envelope wrapping many
    // <Product> records, or a single <Product> as the root (single-record
    // exports). Cover both.
    const products = localName(root) === "product"
      ? [root]
      : deepFind(root, ["product"]);
    // Mirror the tree's auto-collapse policy: a single product stays expanded
    // (the user clearly wants to inspect that record); multi-product feeds
    // collapse so the right pane stays scannable.
    const openByDefault = products.length <= 1;
    products.forEach((product, idx) => {
      const card = renderProduct(product, openByDefault, ctx);
      card.dataset.oxvProductIndex = String(idx);
      container.appendChild(card);
    });
    return products.length;
  }

  function renderMessageHeaderCard(headerEl, ctx) {
    // The Header is structurally similar to a Product card so it gets the
    // same chrome (collapsible, with a styled header bar). Open by default —
    // it's small and useful at a glance.
    const card = document.createElement("details");
    card.className = "px-block-product px-message-header";
    card.setAttribute("open", "");

    const summary = document.createElement("summary");
    summary.className = "px-block-product-header";
    const title = document.createElement("span");
    title.className = "px-block-product-title";
    title.textContent = "Message Header";
    summary.appendChild(title);
    card.appendChild(summary);

    const sec = makeSection("Header", true);
    const body = body_(sec);
    renderEveryChild(headerEl, body, ctx);
    card.appendChild(sec);

    assignSubBlockIndices(card);
    return card;
  }

  // ---- product card ---------------------------------------------------------

  function renderProduct(productEl, openByDefault, ctx) {
    const card = document.createElement("details");
    card.className = "px-block-product";
    if (openByDefault) card.setAttribute("open", "");

    const title = findTitle(productEl);
    const isbn = findPreferredIsbn(productEl);

    card.appendChild(renderHeader(isbn, title.titleText));

    // Render the Product's direct children (RecordReference, NotificationType,
    // RecordSourceType, ProductIdentifier, …) in document order. Skip the
    // six P.x block elements — they're rendered separately as block sections.
    const blockNames = new Set(ONIX_BLOCKS.map((b) => b.id));
    const fields = document.createElement("div");
    fields.className = "px-block-product-fields";
    renderEveryChild(productEl, fields, ctx, blockNames);
    if (fields.firstChild) card.appendChild(fields);

    // The six ONIX blocks (P.1 through P.6). Each is a direct child of Product
    // when present. We render only the blocks that exist, so the right pane
    // mirrors the document.
    for (const blockDef of ONIX_BLOCKS) {
      const blockEl = findChildByName(productEl, [blockDef.id]);
      if (!blockEl) continue;
      card.appendChild(renderBlockSection(blockDef, blockEl, ctx));
    }

    // Assign per-element-type indices on every sub-block <details> in this
    // card (in document order), so the cross-pane sync wiring can match them
    // to their tree rows.
    assignSubBlockIndices(card);

    return card;
  }

  // ---- ONIX P.1 .. P.6 blocks ----------------------------------------------

  const ONIX_BLOCKS = [
    { id: "descriptivedetail", label: "Block 1 — Descriptive Detail",  render: renderDescriptiveDetail },
    { id: "collateraldetail",  label: "Block 2 — Collateral Detail",   render: renderCollateralDetail },
    { id: "contentdetail",     label: "Block 3 — Content Detail",      render: renderEveryChildBlock },
    { id: "publishingdetail",  label: "Block 4 — Publishing Detail",   render: renderPublishingDetail },
    { id: "relatedmaterial",   label: "Block 5 — Related Material",    render: renderEveryChildBlock },
    { id: "productsupply",     label: "Block 6 — Product Supply",      render: renderEveryChildBlock },
  ];

  function renderEveryChildBlock(blockEl, body, ctx) {
    renderEveryChild(blockEl, body, ctx);
  }

  function renderBlockSection(blockDef, blockEl, ctx) {
    const sec = makeSection(blockDef.label, true);
    sec.dataset.oxvBlockName = blockDef.id;
    const body = body_(sec);
    blockDef.render(blockEl, body, ctx);
    if (!body.firstChild) appendEmptyNote(body);
    return sec;
  }

  function renderDescriptiveDetail(blockEl, body, ctx) {
    renderEveryChild(blockEl, body, ctx);
  }

  function renderCollateralDetail(blockEl, body, ctx) {
    renderEveryChild(blockEl, body, ctx);
  }

  function renderPublishingDetail(blockEl, body, ctx) {
    renderEveryChild(blockEl, body, ctx);
  }

  // Generic child renderer — used by every block to fill in elements not
  // handled by a specialised renderer. Composite children become collapsible
  // <details> items; leaf children become field rows.

  function renderEveryChild(parentEl, body, ctx, skipNames) {
    const skip = skipNames || new Set();
    // Group by element name in document order. The order of the groups
    // matches the document order of the FIRST occurrence of each name.
    // When the same element appears multiple times (Contributor, Subject,
    // Language, Price, …), wrap the group in a collapsible section
    // labelled with the plural + count. Singletons render inline.
    const groups = [];
    const groupIdx = new Map();
    for (const child of parentEl.children) {
      const lc = (child.localName || child.nodeName).toLowerCase();
      if (skip.has(lc)) continue;
      const name = child.localName || child.nodeName;
      let idx = groupIdx.get(name);
      if (idx == null) {
        idx = groups.length;
        groupIdx.set(name, idx);
        groups.push({ name, elements: [] });
      }
      groups[idx].elements.push(child);
    }
    for (const g of groups) {
      // Wrap every composite group in a plural section — even count=1 — so
      // a single Contributor / ProductIdentifier / Language reads the same
      // as multiple. Plain leaf singletons (ProductComposition, ProductForm,
      // …) render inline as a field row, since wrapping a scalar value in
      // a section just to call it "ProductForms (1)" would be silly.
      const composite = hasElementChildren(g.elements[0]);
      if (composite) {
        body.appendChild(renderGroupSection(g.name, g.elements, ctx));
      } else if (g.elements.length > 1) {
        body.appendChild(renderGroupSection(g.name, g.elements, ctx));
      } else {
        body.appendChild(renderChildElement(g.elements[0], ctx));
      }
    }
  }

  function renderGroupSection(elementName, elements, ctx) {
    const sec = makeSection(`${pluralize(elementName)} (${elements.length})`, true);
    const sBody = body_(sec);
    for (const el of elements) sBody.appendChild(renderChildElement(el, ctx));
    return sec;
  }

  // Single-element renderers for ONIX shapes we know how to summarise nicely.
  // Anything not in this map falls through to renderCompositeItem (generic).
  const SPECIAL_ITEM_RENDERERS = {
    contributor: (el, ctx) => renderContributor(extractContributor(el)),
    publisher: renderPublisherItem,
    publishingdate: renderPublishingDateItem,
    productidentifier: renderProductIdentifierItem,
    textcontent: renderTextContentItem,
    supportingresource: renderSupportingResourceItem,
    titledetail: renderTitleDetailItem,
  };

  function renderProductIdentifierItem(el, ctx) {
    const lists = window.OnixViewerCodeLists;
    const typeEl = findChildByName(el, ["productidtype", "b221"]);
    const valEl = findChildByName(el, ["idvalue", "b244"]);
    const code = textOf(typeEl);
    const list = lists && lists.ProductIDType;
    const labelText = (list && list.get(code)) || code || "ID";
    const consumed = new Set([typeEl, valEl].filter(Boolean));
    return buildItem("productidentifier", true,
      (sum) => {
        const lbl = document.createElement("span");
        lbl.className = "px-block-field-label";
        lbl.textContent = labelText;
        sum.appendChild(lbl);
        const val = document.createElement("span");
        val.className = "px-block-field-value";
        val.textContent = textOf(valEl);
        sum.appendChild(val);
        if (code) appendListLink(sum, "ProductIDType", code);
      },
      (itemBody) => {
        // Body shows only the children NOT already in the summary (e.g.
        // IDTypeName when IDType is "01" / Proprietary).
        for (const child of el.children) {
          if (consumed.has(child)) continue;
          itemBody.appendChild(renderChildElement(child, ctx));
        }
      });
  }

  function renderPublisherItem(el, ctx) {
    const nameEl = findChildByName(el, ["publishername", "b081"]);
    const consumed = new Set([nameEl].filter(Boolean));
    return buildItem("publisher", true,
      (sum) => {
        const lbl = document.createElement("span");
        lbl.className = "px-block-field-label";
        lbl.textContent = "Publisher";
        sum.appendChild(lbl);
        const val = document.createElement("span");
        val.className = "px-block-field-value";
        val.textContent = textOf(nameEl) || "(unnamed)";
        sum.appendChild(val);
      },
      (itemBody) => {
        for (const child of el.children) {
          if (consumed.has(child)) continue;
          itemBody.appendChild(renderChildElement(child, ctx));
        }
      });
  }

  function renderPublishingDateItem(el, ctx) {
    const lists = window.OnixViewerCodeLists;
    const roleEl = findChildByName(el, ["publishingdaterole", "x448", "j259"]);
    const dateEl = findChildByName(el, ["date", "b306"]);
    const role = textOf(roleEl);
    const list = lists && lists.PublishingDateRole;
    const roleLabel = role && list && list.get(role);
    const consumed = new Set([roleEl, dateEl].filter(Boolean));
    return buildItem("publishingdate", true,
      (sum) => {
        const lbl = document.createElement("span");
        lbl.className = "px-block-field-label";
        lbl.textContent = roleLabel || "Date";
        sum.appendChild(lbl);
        const val = document.createElement("span");
        val.className = "px-block-field-value";
        val.textContent = textOf(dateEl);
        sum.appendChild(val);
        if (role) appendListLink(sum, "PublishingDateRole", role);
      },
      (itemBody) => {
        for (const child of el.children) {
          if (consumed.has(child)) continue;
          itemBody.appendChild(renderChildElement(child, ctx));
        }
      });
  }

  function renderTextContentItem(el, ctx) {
    const typeEl = findChildByName(el, ["texttype", "x426"]);
    const consumed = new Set([typeEl].filter(Boolean));
    const lists = window.OnixViewerCodeLists;
    const code = textOf(typeEl);
    const list = lists && lists.TextType;
    const labelText = (list && list.get(code)) || "TextContent";
    return buildItem("textcontent", true,
      (sum) => {
        const lbl = document.createElement("span");
        lbl.className = "px-block-field-label";
        lbl.textContent = labelText;
        sum.appendChild(lbl);
        if (code) {
          const val = document.createElement("span");
          val.className = "px-block-field-value";
          val.textContent = code;
          sum.appendChild(val);
        }
      },
      (itemBody) => {
        for (const child of el.children) {
          if (consumed.has(child)) continue;
          itemBody.appendChild(renderChildElement(child, ctx));
        }
      });
  }

  function renderSupportingResourceItem(el, ctx) {
    const typeEl = findChildByName(el, ["resourcecontenttype", "x436"]);
    const consumed = new Set([typeEl].filter(Boolean));
    return buildItem("supportingresource", true,
      (sum) => {
        const lbl = document.createElement("span");
        lbl.className = "px-block-field-label";
        lbl.textContent = "Resource";
        sum.appendChild(lbl);
        const val = document.createElement("span");
        val.className = "px-block-field-value";
        val.textContent = textOf(typeEl) || "—";
        sum.appendChild(val);
      },
      (itemBody) => {
        for (const child of el.children) {
          if (consumed.has(child)) continue;
          itemBody.appendChild(renderChildElement(child, ctx));
        }
      });
  }

  function renderTitleDetailItem(el, ctx) {
    return buildItem("titledetail", true,
      (sum) => {
        const lbl = document.createElement("span");
        lbl.className = "px-block-field-label";
        lbl.textContent = "TitleDetail";
        sum.appendChild(lbl);
        // Useful preview: the actual title text, found at any depth.
        const titleText = deepFind(el, ["titletext", "b203"])[0];
        if (titleText) {
          const val = document.createElement("span");
          val.className = "px-block-field-value";
          val.textContent = textOf(titleText);
          sum.appendChild(val);
        }
      },
      (itemBody) => {
        for (const child of el.children) {
          itemBody.appendChild(renderChildElement(child, ctx));
        }
      });
  }

  function extractContributor(el) {
    const lists = window.OnixViewerCodeLists;
    const roles = lists && lists.ContributorRole;
    const roleEl = findChildByName(el, ["contributorrole", "b035"]);
    const personEl = findChildByName(el, ["personname", "b036"]);
    const inverted = findChildByName(el, ["personnameinverted", "b037"]);
    const namesBeforeKey = findChildByName(el, ["namesbeforekey", "b039"]);
    const keyNames = findChildByName(el, ["keynames", "b040"]);
    const corporate = findChildByName(el, ["corporatename", "b047"]);
    const seqEl = findChildByName(el, ["sequencenumber", "b034"]);
    const bioEl = findChildByName(el, ["biographicalnote", "b044"]);

    let displayName = textOf(personEl) || textOf(corporate);
    if (!displayName && keyNames) {
      const before = textOf(namesBeforeKey);
      displayName = before ? `${before} ${textOf(keyNames)}` : textOf(keyNames);
    }
    if (!displayName) displayName = textOf(inverted);

    const roleCode = textOf(roleEl);
    const roleLabel = (roles && roles.get(roleCode)) || null;

    const extraFields = [];
    if (textOf(seqEl)) extraFields.push({ label: "Sequence", value: textOf(seqEl) });
    if (roleCode) {
      extraFields.push({ label: "Role code", value: roleLabel ? `${roleCode} (${roleLabel})` : roleCode });
    }
    if (inverted && textOf(inverted) && textOf(inverted) !== displayName) {
      extraFields.push({ label: "Inverted", value: textOf(inverted) });
    }
    if (textOf(bioEl)) extraFields.push({ label: "Bio", value: textOf(bioEl) });

    return { name: displayName, roleCode, roleLabel, extraFields };
  }

  // Light pluralizer for the element-name labels we surface in section
  // headers ("ContributorPlace" → "ContributorPlaces", "Audience" → "Audiences",
  // "Identity" → "Identities"). ONIX element names are well-behaved so the
  // basic English rules cover everything we'll encounter.
  function pluralize(name) {
    if (/[^aeiou]y$/.test(name)) return name.slice(0, -1) + "ies";
    if (/(s|x|z|ch|sh)$/.test(name)) return name + "es";
    return name + "s";
  }

  function renderChildElement(el, ctx) {
    const lc = (el.localName || el.nodeName).toLowerCase();
    const special = SPECIAL_ITEM_RENDERERS[lc];
    if (special) return special(el, ctx);
    if (hasElementChildren(el)) return renderCompositeItem(el, ctx);
    return renderLeafField(el, ctx);
  }

  function renderLeafField(el, ctx) {
    const wrap = document.createElement("div");
    wrap.className = "px-block-row";
    // Tag the row with its element name so click-to-highlight can pair it
    // with the corresponding tree row. The per-name index is filled in
    // later by assignSubBlockIndices().
    wrap.dataset.oxvOnixElement = (el.localName || el.nodeName).toLowerCase();

    const lbl = document.createElement("span");
    lbl.className = "px-block-field-label";
    lbl.textContent = el.localName || el.nodeName;
    wrap.appendChild(lbl);

    const resolved = window.OnixViewerOnix && window.OnixViewerOnix.resolveCodelist(el, ctx);

    const val = document.createElement("span");
    val.className = "px-block-field-value";
    const txt = textOf(el);
    val.textContent = resolved ? `${resolved.value} — ${resolved.label}` : txt;
    wrap.appendChild(val);

    if (resolved) appendListLink(wrap, resolved.codelistKey, resolved.value);
    return wrap;
  }

  function renderCompositeItem(el, ctx) {
    const lcName = (el.localName || el.nodeName).toLowerCase();
    // Pick a "preview leaf" — the first leaf whose value is informative —
    // and render it in the summary. Then skip it in the body so the same
    // data doesn't appear twice (collapsed = summary; expanded = body).
    const previewLeaf = findPreviewLeaf(el, ctx);
    return buildItem(lcName, false /* closed by default; tree state will sync */,
      (sum) => {
        const lbl = document.createElement("span");
        lbl.className = "px-block-field-label";
        lbl.textContent = el.localName || el.nodeName;
        sum.appendChild(lbl);
        if (previewLeaf) {
          const val = document.createElement("span");
          val.className = "px-block-field-value";
          val.textContent = previewLeaf.text;
          sum.appendChild(val);
          if (previewLeaf.codelistKey) {
            appendListLink(sum, previewLeaf.codelistKey, previewLeaf.code);
          }
        }
      },
      (itemBody) => {
        for (const child of el.children) {
          if (child === (previewLeaf && previewLeaf.el)) continue;
          itemBody.appendChild(renderChildElement(child, ctx));
        }
      });
  }

  function findPreviewLeaf(el, ctx) {
    // Return { el, text, codelistKey?, code? } describing the first leaf
    // whose value can be summarised meaningfully. Prefer leaves that
    // resolve through a known codelist (e.g. ProductFormFeatureType "09"
    // → "E-publication accessibility detail") so the preview is human
    // readable. Return null if no leaf has any text content.
    for (const child of el.children) {
      if (hasElementChildren(child)) continue;
      const resolved = window.OnixViewerOnix && window.OnixViewerOnix.resolveCodelist(child, ctx);
      if (resolved) {
        return {
          el: child,
          text: `${resolved.value} — ${resolved.label}`,
          codelistKey: resolved.codelistKey,
          code: resolved.value,
        };
      }
      const txt = textOf(child);
      if (txt) return { el: child, text: txt };
    }
    return null;
  }

  function hasElementChildren(el) {
    for (const c of el.childNodes) {
      if (c.nodeType === 1 /* ELEMENT_NODE */) return true;
    }
    return false;
  }

  function appendEmptyNote(body) {
    const note = document.createElement("div");
    note.className = "px-block-field-note";
    note.textContent = "(empty block)";
    body.appendChild(note);
  }

  function renderHeader(isbn, titleText) {
    const header = document.createElement("summary");
    header.className = "px-block-product-header";
    header.appendChild(makeChevron());

    const tag = document.createElement("span");
    tag.className = "px-block-product-tag";
    tag.textContent = "Product";
    header.appendChild(tag);

    if (isbn) {
      const isbnSpan = document.createElement("span");
      isbnSpan.className = "px-block-product-isbn";
      isbnSpan.textContent = isbn;
      header.appendChild(isbnSpan);
    }
    if (titleText) {
      const sep = document.createElement("span");
      sep.className = "px-block-product-sep";
      sep.textContent = "—";
      header.appendChild(sep);
      const titleSpan = document.createElement("span");
      titleSpan.className = "px-block-product-title";
      titleSpan.textContent = titleText;
      header.appendChild(titleSpan);
    }
    return header;
  }

  function makeChevron() {
    // Real DOM element so click handlers can distinguish "user clicked the
    // chevron (toggle)" from "user clicked the rest of the summary
    // (highlight match in the other pane)". The actual ▾/▸ glyph is filled
    // in by CSS based on the parent <details>'s open state.
    const chev = document.createElement("span");
    chev.className = "px-chevron";
    chev.setAttribute("aria-hidden", "true");
    return chev;
  }

  // Builds a <details> sub-block item with the metadata that the cross-pane
  // sync machinery needs. The `dataset.oxvOnixIdx` attribute is filled in
  // later by assignSubBlockIndices(), once the whole card is built.
  function buildItem(elementName, openByDefault, summaryFiller, bodyFiller) {
    const det = document.createElement("details");
    det.className = "px-block-item";
    det.dataset.oxvOnixElement = elementName;
    if (openByDefault) det.setAttribute("open", "");
    const summary = document.createElement("summary");
    summary.appendChild(makeChevron());
    const summaryInner = document.createElement("span");
    summaryInner.className = "px-block-item-summary";
    summaryFiller(summaryInner);
    summary.appendChild(summaryInner);
    det.appendChild(summary);
    const itemBody = document.createElement("div");
    itemBody.className = "px-block-item-body";
    bodyFiller(itemBody);
    det.appendChild(itemBody);
    return det;
  }

  // After all sections are rendered, walk every <details> tagged with
  // data-oxv-onix-element and assign a 0-based per-element-type index, in
  // document order. The tree-walker in viewer.js uses the same indexing,
  // so the Nth contributor/identifier/etc on each side pair up.
  function assignSubBlockIndices(card) {
    const counts = new Map();
    // Includes both composite <details> items AND leaf .px-block-row fields,
    // each indexed per element-name in document order. The tree-walker
    // assigns matching indices on tree rows, so click-to-highlight can pair
    // every right-pane element with its tree counterpart.
    const selector = "details[data-oxv-onix-element], .px-block-row[data-oxv-onix-element]";
    for (const det of card.querySelectorAll(selector)) {
      const name = det.dataset.oxvOnixElement;
      const idx = counts.get(name) || 0;
      det.dataset.oxvOnixIdx = String(idx);
      counts.set(name, idx + 1);
    }
  }

  function appendListLink(parent, codelistKey, currentValue) {
    if (!window.OnixViewerOnix || !window.OnixViewerOnix.codelistMeta) return;
    const meta = window.OnixViewerOnix.codelistMeta(codelistKey);
    if (!meta) return;
    const a = document.createElement("a");
    a.className = "px-codelist-link";
    a.href = meta.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = `Open ${meta.listName}`;
    a.textContent = meta.listName;
    if (window.OnixViewerOnix.externalLinkIcon) {
      a.appendChild(window.OnixViewerOnix.externalLinkIcon());
    }
    a.addEventListener("click", (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      if (!window.OnixViewerPopup) return;
      ev.preventDefault();
      window.OnixViewerPopup.show(codelistKey, currentValue || null);
    });
    parent.appendChild(a);
  }

  function renderContributor(c) {
    const det = document.createElement("details");
    det.className = "px-block-contributor px-block-item";
    det.dataset.oxvOnixElement = "contributor";
    det.setAttribute("open", "");

    const summary = document.createElement("summary");
    summary.appendChild(makeChevron());
    const name = document.createElement("span");
    name.className = "px-block-contributor-name";
    name.textContent = c.name || "(unnamed)";
    summary.appendChild(name);
    if (c.roleLabel || c.roleCode) {
      const role = document.createElement("span");
      role.className = "px-block-contributor-role";
      role.textContent = c.roleLabel || c.roleCode;
      summary.appendChild(role);
      appendListLink(summary, "ContributorRole", c.roleCode || null);
    }
    det.appendChild(summary);

    const detBody = document.createElement("div");
    detBody.className = "px-block-contributor-body";
    for (const f of c.extraFields) detBody.appendChild(makeField(f.label, f.value));
    if (c.extraFields.length === 0) {
      const empty = document.createElement("div");
      empty.className = "px-block-field-note";
      empty.textContent = "No additional fields";
      detBody.appendChild(empty);
    }
    det.appendChild(detBody);

    return det;
  }

  // ---- DOM scaffolding ------------------------------------------------------

  function makeSection(label, openByDefault) {
    const det = document.createElement("details");
    det.className = "px-block-section";
    if (openByDefault) det.setAttribute("open", "");
    const summary = document.createElement("summary");
    summary.appendChild(makeChevron());
    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    summary.appendChild(labelSpan);
    det.appendChild(summary);
    const body = document.createElement("div");
    body.className = "px-block-section-body";
    det.appendChild(body);
    return det;
  }

  function body_(sectionEl) {
    return sectionEl.querySelector(".px-block-section-body");
  }

  function makeField(label, value) {
    const wrap = document.createElement("div");
    wrap.className = "px-block-field";
    const l = document.createElement("span");
    l.className = "px-block-field-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "px-block-field-value";
    v.textContent = value;
    wrap.append(l, v);
    return wrap;
  }

  // ---- ONIX traversal -------------------------------------------------------

  function localName(el) {
    return (el.localName || el.nodeName || "").toLowerCase();
  }

  function deepFind(root, names) {
    const set = new Set(names.map((n) => n.toLowerCase()));
    const result = [];
    const stack = [root];
    while (stack.length) {
      const el = stack.pop();
      for (const c of el.children) {
        if (set.has(localName(c))) result.push(c);
        else stack.push(c);
      }
    }
    return result;
  }

  function findChildByName(el, names) {
    const set = new Set(names.map((n) => n.toLowerCase()));
    for (const c of el.children) {
      if (set.has(localName(c))) return c;
    }
    return null;
  }

  function textOf(el) {
    return el ? (el.textContent || "").trim() : "";
  }

  function codelist(name) {
    const lists = window.OnixViewerCodeLists;
    return (lists && lists[name]) || null;
  }

  function findPreferredIsbn(productEl) {
    const ids = deepFind(productEl, ["productidentifier"]);
    let fallback = null;
    for (const id of ids) {
      const typeEl = findChildByName(id, ["productidtype", "b221"]);
      const valEl = findChildByName(id, ["idvalue", "b244"]);
      const val = textOf(valEl);
      if (!val) continue;
      if (textOf(typeEl) === "15") return val;
      if (!fallback) fallback = val;
    }
    return fallback;
  }

  function findTitle(productEl) {
    const titleDetails = deepFind(productEl, ["titledetail"]);
    let chosen = null;
    for (const td of titleDetails) {
      const tt = findChildByName(td, ["titletype", "b202"]);
      if (textOf(tt) === "01") { chosen = td; break; }
    }
    if (!chosen) chosen = titleDetails[0] || null;
    if (!chosen) return { titleText: null, subtitle: null };

    const titleEl = deepFind(chosen, ["titletext", "b203"])[0];
    const subEl = deepFind(chosen, ["subtitle", "b029"])[0];
    return {
      titleText: textOf(titleEl) || null,
      subtitle: textOf(subEl) || null,
    };
  }

  function findIdentifiers(productEl) {
    const ids = deepFind(productEl, ["productidentifier"]);
    const list = codelist("ProductIDType");
    return ids.map((id) => {
      const typeEl = findChildByName(id, ["productidtype", "b221"]);
      const valEl = findChildByName(id, ["idvalue", "b244"]);
      const typeNameEl = findChildByName(id, ["idtypename", "b233"]);
      const code = textOf(typeEl);
      const label = (list && list.get(code)) || code || "ID";
      return {
        type: code,
        label,
        value: textOf(valEl),
        typeName: textOf(typeNameEl) || null,
      };
    });
  }

  window.OnixViewerBlocks = { render };
})();

// onix.js
// ONIX-aware decorations layered on top of the generic XML viewer.
//
// Two things ONIX needs that generic XML doesn't:
//  1. Tag style classification — ONIX comes in either "reference names"
//     (<ProductIdentifier>) or "short tags" (<productidentifier> in the spec,
//     but in practice the short tags are 4-character codes like <b221>).
//     Showing which dialect a doc is in helps a lot.
//  2. Code-list resolution — ProductIDType "15" means more if you can hover
//     and see "ISBN-13".
//
// This module exposes one function on window.OnixViewerOnix that the viewer
// calls during rendering. Keeping the contract narrow means non-ONIX docs
// pay almost nothing for this module being loaded.

(function () {
  "use strict";

  // ONIX namespace varies. The reference DTD/XSDs use:
  //   http://ns.editeur.org/onix/3.0/reference
  //   http://ns.editeur.org/onix/3.0/short
  // Older 2.1 docs may have no namespace at all and rely on doctype.
  const ONIX_NS_PREFIX = "http://ns.editeur.org/onix/";

  // Reference-name root candidates (3.0 + 2.1).
  const REFERENCE_ROOTS = new Set(["ONIXMessage", "ONIXmessage"]);
  // Root of an ONIX Acknowledgement message (EDItEUR's optional response
  // format). Its namespace is the canonical signal; this set only catches
  // the rare no-namespace case so the root name alone still identifies it.
  const ACK_ROOTS = new Set(["ONIXMessageAcknowledgement"]);
  // Short-tag roots. ONIX 3.0 short uses <ONIXMessage> too with a /short
  // namespace; ONIX 2.1 short uses <ONIXmessage> with lowercase children.
  // The reliable signal is the namespace URI, which we check first.

  // Short tag → reference name. Used both for highlighting and for codelist
  // lookups, so <b253> still resolves LanguageRole.
  //
  // The bulk is GENERATED into onix-codelists.js from EDItEUR's short-tag
  // schema — all 505 pairs, keys lower-cased. It used to be a hand-kept
  // subset of ~30 tags, which left 145 of the 157 code-list-bound elements
  // unlabelled in short-tag documents.
  //
  // EXTRA_SHORT_TAGS adds only what that schema can't supply, and
  // registerAcknowledgementBindings() folds in the Acknowledgement tags.
  //
  // Both maps are accessed with keys derived from untrusted XML (element /
  // attribute names). Object.create(null) prevents an XML element named e.g.
  // "constructor" or "__proto__" from accidentally resolving to a prototype
  // property and bypassing the falsy-check guards below.
  const EXTRA_SHORT_TAGS = {
    // ONIX 2.1-era codes, absent from the 3.1 schema. Kept so 2.1 short-tag
    // documents — which the detector still recognises — keep their labels.
    // Their 3.1 replacements (b253, x415, b394, x419) come from the schema.
    "b003": "PublishingStatus",
    "b005": "LanguageRole",
    "b056": "EditionType",
    "b332": "PublishingStatus",
    "b390": "NameIDType",
    // Tolerance for feeds that write a data element's reference name in lower
    // case rather than its short tag. Not conformant, but harmless to accept;
    // short-tag *composites* are lower-cased reference names already, so the
    // generated map covers those.
    "countrycode": "CountryCode",
    "datevalue": "Date",
    "editiontype": "EditionType",
    "extenttype": "ExtentType",
    "extentunit": "ExtentUnit",
    "extentvalue": "ExtentValue",
    "languagecode": "LanguageCode",
    "languagerole": "LanguageRole",
    "nameidtype": "NameIDType",
    "notificationtype": "NotificationType",
    "personname": "PersonName",
    "productcomposition": "ProductComposition",
    "subjectschemeidentifier": "SubjectSchemeIdentifier",
    "titletext": "TitleText",
    "titletype": "TitleType",
  };

  const SHORT_TO_REFERENCE = Object.assign(
    Object.create(null),
    window.OnixViewerShortTags || null,
    EXTRA_SHORT_TAGS
  );

  // ONIX-defined attribute names → EDItEUR code list number. Derived from
  // the codelist-bound attributes in ONIX_BookProduct_3.1_reference.xsd
  // (direct `type="ListN"` and via `*Code` simpleTypes that restrict to
  // List N). Names are lowercase to match how the DOM exposes attribute
  // names. If EDItEUR ever adds another codelist attribute, extend this
  // map alongside a schema regeneration.
  const ATTR_CODELISTS = Object.assign(Object.create(null), {
    "sourcetype":  3,
    "textcase":    14,
    "textformat":  34,
    "dateformat":  55,
    "language":    74,
    "textscript":  121,
  });

  // Acknowledgement-message elements that carry a code-list value. The
  // Acknowledgement format reuses the shared ONIX code lists (221–226), but
  // its elements live in a separate schema, not the Book Product schema the
  // codelist bindings are generated from — so they're declared here, the way
  // SHORT_TO_REFERENCE and ATTR_CODELISTS hold hand-maintained ONIX knowledge.
  // Each entry names the reference element, its short tag, and the EDItEUR
  // list number. registerAcknowledgementBindings() (below) folds these into
  // the lookup tables onix-codelists.js publishes, so resolveCodelist,
  // codelistMeta and the popup all work for them with no special-casing.
  const ACK_CODELIST_ELEMENTS = [
    { ref: "MessageStatus",         short: "m489", list: 221, title: "Message status" },
    { ref: "MessageStatusDateRole", short: "m490", list: 222, title: "Message status date role" },
    { ref: "StatusDetailCodeType",  short: "a492", list: 223, title: "Status detail code type" },
    { ref: "StatusDetailType",      short: "a494", list: 224, title: "Status detail type" },
    { ref: "StatusDetailCode",      short: "a495", list: 225, title: "Message / Record status detail" },
    { ref: "RecordStatus",          short: "a498", list: 226, title: "Record status" },
  ];

  function registerAcknowledgementBindings() {
    const byNumber = window.OnixViewerCodeListsByNumber;
    const byName = window.OnixViewerCodeLists;
    const metaByName = window.OnixViewerCodeListMeta;
    for (const { ref, short, list, title } of ACK_CODELIST_ELEMENTS) {
      SHORT_TO_REFERENCE[short] = ref;
      if (byName && byNumber && byNumber[list] && !byName[ref]) {
        byName[ref] = byNumber[list];
      }
      if (metaByName && !metaByName[ref]) {
        metaByName[ref] = { listNumber: list, title };
      }
    }
  }

  // onix-codelists.js loads before this module, so the global tables exist.
  registerAcknowledgementBindings();

  // Direct-child element names that mark an un-namespaced <Product> root as
  // genuine ONIX. <Product> alone is too generic to trust (plenty of non-ONIX
  // vocabularies use it), so a standalone Product is only treated as ONIX when
  // it carries one of these ONIX-specific children. Reference names and the
  // short tags for the two most diagnostic ones (a001 = RecordReference,
  // a002 = NotificationType) are both listed; keys are compared lower-cased.
  const PRODUCT_CHILD_SIGNALS = new Set([
    "recordreference", "notificationtype", "recordsourcetype",
    "productidentifier", "descriptivedetail",
    "a001", "a002",
  ]);

  function hasOnixProductChild(root) {
    for (const c of root.children) {
      const name = (c.localName || c.nodeName).toLowerCase();
      if (PRODUCT_CHILD_SIGNALS.has(name)) return true;
    }
    return false;
  }

  // For an un-namespaced document there's no /short marker to read, so infer
  // the dialect from the element names: short tags are all-lowercase (4-char
  // codes like a001, or lowercase composite names like productidentifier),
  // whereas reference names are CamelCase (RecordReference). Reference is the
  // safe default.
  function inferProductDialect(root) {
    for (const c of root.children) {
      const name = c.localName || c.nodeName;
      if (name && name === name.toLowerCase() && name !== name.toUpperCase()) {
        return "short";
      }
    }
    return "reference";
  }

  /**
   * Inspect a parsed XML Document and return:
   *   { isOnix, dialect: "reference"|"short"|null, version: "3.0"|"2.1"|null,
   *     messageType: "product"|"acknowledgement"|null }
   */
  function detect(doc) {
    const root = doc && doc.documentElement;
    if (!root) return { isOnix: false, dialect: null, version: null, messageType: null };

    const ns = root.namespaceURI || "";
    const localName = root.localName || root.nodeName;

    let isOnix = false;
    let dialect = null;
    let version = null;
    let messageType = "product";

    if (ns.startsWith(ONIX_NS_PREFIX)) {
      isOnix = true;
      // Product message: "3.0/reference". Acknowledgement message:
      // "acknowledgement/3.0/reference" — strip the leading segment so the
      // version/dialect parsing below is shared between the two.
      let parts = ns.slice(ONIX_NS_PREFIX.length).split("/");
      if (parts[0] === "acknowledgement") {
        messageType = "acknowledgement";
        parts = parts.slice(1);
      }
      version = parts[0] || null;
      dialect = (parts[1] === "short") ? "short" : "reference";
    } else if (ACK_ROOTS.has(localName)) {
      // No namespace — an Acknowledgement message identified by its root.
      isOnix = true;
      messageType = "acknowledgement";
      dialect = "reference";
      version = root.getAttribute("release") || "3.0";
    } else if (REFERENCE_ROOTS.has(localName)) {
      // No namespace — likely ONIX 2.1 reference.
      isOnix = true;
      dialect = (localName === "ONIXmessage") ? "short" : "reference";
      // Best-effort: read release attribute if present.
      version = root.getAttribute("release") || "2.1";
    } else if (localName.toLowerCase() === "onixmessage") {
      // No-namespace short — ONIX 2.1 short.
      isOnix = true;
      dialect = "short";
      version = root.getAttribute("release") || "2.1";
    } else if (localName.toLowerCase() === "product" && hasOnixProductChild(root)) {
      // A standalone <Product> record exported without an <ONIXMessage>
      // envelope and without a namespace (e.g. some single-record feeds).
      // Version can't be read from a namespace here; use the release
      // attribute if present, otherwise leave it null.
      isOnix = true;
      messageType = "product";
      dialect = inferProductDialect(root);
      version = root.getAttribute("release") || null;
    }

    return { isOnix, dialect, version, messageType };
  }

  /**
   * Classify a single element. Returns extra CSS classes to apply to its
   * tag span: "px-onix-ref" or "px-onix-short" (or empty).
   */
  function tagClass(element, ctx) {
    if (!ctx.isOnix) return "";
    return ctx.dialect === "short" ? "px-onix-short" : "px-onix-ref";
  }

  /**
   * For an element with a text-node child whose tag is a known codelist key,
   * resolve the code to a human-readable label. The viewer renders this as a
   * small badge after the value, optionally followed by a link to the
   * canonical EDItEUR list page.
   *
   * Returns `null` when the code (or the list itself) is unknown, or
   * `{ value, label, listName, listNumber, url }` otherwise.
   */
  function resolveCodelist(element, ctx) {
    if (!ctx.isOnix) return null;
    const lists = window.OnixViewerCodeLists;
    if (!lists) return null;

    let name = element.localName || element.nodeName;
    // Map short tags to reference names so the same lookup table works for both.
    if (ctx.dialect === "short") {
      const ref = SHORT_TO_REFERENCE[name.toLowerCase()];
      if (ref) name = ref;
    }

    const list = lists[name];
    if (!list) return null;

    // Read the element's direct text content (trimmed). We only resolve
    // when there's exactly one text-node child — codelist elements never
    // have mixed content in valid ONIX.
    let value = "";
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) value += child.nodeValue;
      else if (child.nodeType === Node.ELEMENT_NODE) return null; // mixed
    }
    value = value.trim();
    if (!value) return null;

    const label = list.get(value);
    if (!label) return null;

    const meta = codelistMeta(name);
    return {
      codelistKey: name,
      value,
      label,
      listName: meta ? meta.listName : null,
      listNumber: meta ? meta.listNumber : null,
      url: meta ? meta.url : null,
    };
  }

  /**
   * For a codelist key (e.g. "ProductIDType"), return its EDItEUR list
   * metadata: `{ listName, listNumber, url }` or null when unknown.
   * Used by the right-pane block view, which already knows the codelist key.
   */
  function codelistMeta(name) {
    const meta = (window.OnixViewerCodeListMeta || {})[name];
    if (!meta) return null;
    return {
      key: name,
      listName: `List ${meta.listNumber}`,
      listNumber: meta.listNumber,
      title: meta.title || null,
      url: `https://ns.editeur.org/onix/en/${meta.listNumber}`,
    };
  }

  /**
   * Build a small inline SVG external-link icon. Shared by both panes so
   * the visual is consistent.
   */
  function externalLinkIcon() {
    const SVG_NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "px-extlink-icon");
    const path = document.createElementNS(SVG_NS, "path");
    // Outline of an arrow leaving a box. Single-color, scaled with currentColor.
    path.setAttribute(
      "d",
      "M14 3h7v7h-2V6.414l-9.293 9.293-1.414-1.414L17.586 5H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z"
    );
    path.setAttribute("fill", "currentColor");
    svg.appendChild(path);
    return svg;
  }

  /**
   * One-line summary for a collapsed composite, shown as a faint chip beside
   * the folded row so a folded tree stays scannable.
   *
   * Identifier composites are covered by a single shape rule; a short table
   * handles the few others whose essence is one value. The seven ONIX blocks
   * deliberately get nothing — their contents are too heterogeneous to sample
   * in one line, and the <Product> row above already carries the identifier,
   * form and title.
   */
  function nodeSummary(element, ctx) {
    let summary = null;
    if (ctx.isOnix) {
      const summarize = SUMMARIZERS[referenceName(element).toLowerCase()] || identifierSummary;
      summary = summarize(element, ctx) || null;
    }
    return summary;
  }

  // Keyed on the lower-cased reference name: short-tag composites are the
  // lower-cased reference name already, so dispatch works in both dialects
  // without going through the short-tag map.
  const SUMMARIZERS = Object.assign(Object.create(null), {
    product: productSummary,
    titledetail: (element) => quoted(titleOfDetail(element)),
    titleelement: (element) => quoted(titleOfElement(element)),
    contributor: contributorSummary,
    price: priceSummary,
  });

  // Reference-dialect name for an element, so a summary rule can be written
  // once and match in both dialects. SHORT_TO_REFERENCE is keyed on the
  // lower-cased tag and holds both short tags (b221) and the lower-cased
  // reference names that short-dialect composites use (productidentifier), so
  // one lookup serves both; an unmapped tag keeps its own name.
  function referenceName(element) {
    const name = element.localName || element.nodeName;
    return SHORT_TO_REFERENCE[name.toLowerCase()] || name;
  }

  // A chip is read at a glance beside a folded row, so it gets a hard cap: one
  // that wraps breaks the one-row-per-line reading the tree depends on. The
  // <Product> chip caps its title instead (see productSummary) — capping that
  // whole chip at this length would start truncating summaries that read fine
  // today.
  const SUMMARY_MAX = 60;

  function clampSummary(text) {
    const summary = (text || "").trim();
    return summary.length > SUMMARY_MAX ? `${summary.slice(0, SUMMARY_MAX - 1)}…` : summary;
  }

  function quoted(text) {
    const clamped = clampSummary(text);
    return clamped ? `"${clamped}"` : "";
  }

  // Every ONIX identifier composite — ProductIdentifier, RecordSourceIdentifier,
  // NameIdentifier, SupplierIdentifier, CollectionIdentifier, … — has the same
  // shape: a <*IDType> naming a code list plus an <IDValue>. One rule
  // summarises them all, so identifier composites we've never heard of need no
  // upkeep here. Proprietary schemes (type 01) name themselves in
  // <IDTypeName>, which beats that list's own label ("Proprietary …").
  function identifierSummary(element, ctx) {
    let summary = "";
    const typeEl = identifierTypeChild(element);
    const value = textOfDirectChild(element, "idvalue", "b244");
    if (typeEl && value) {
      const resolved = resolveCodelist(typeEl, ctx);
      const scheme =
        textOfDirectChild(element, "idtypename", "b233") ||
        (resolved ? resolved.label : "");
      summary = clampSummary(scheme ? `${scheme} ${value}` : value);
    }
    return summary;
  }

  function identifierTypeChild(element) {
    let found = null;
    for (const child of element.children) {
      if (!found && referenceName(child).endsWith("IDType")) found = child;
    }
    return found;
  }

  // Role plus name: "By (author) Ola Nordmann".
  function contributorSummary(element, ctx) {
    const roleEl = directChild(element, "contributorrole", "b035");
    const resolved = roleEl ? resolveCodelist(roleEl, ctx) : null;
    const role = resolved ? resolved.label : "";
    return clampSummary([role, contributorName(element)].filter(Boolean).join(" "));
  }

  // A contributor names itself in one of several conformant ways depending on
  // the feed, so try the personal forms before the corporate one.
  function contributorName(element) {
    return (
      textOfDirectChild(element, "personname", "b036") ||
      textOfDirectChild(element, "personnameinverted", "b037") ||
      textOfDirectChild(element, "corporatename", "b047") ||
      keyName(element)
    );
  }

  function keyName(element) {
    const before = textOfDirectChild(element, "namesbeforekey", "b039");
    const key = textOfDirectChild(element, "keynames", "b040");
    return [before, key].filter(Boolean).join(" ");
  }

  // The amount and its currency: "399.00 NOK". Price type, tax and conditions
  // are what you expand the composite for.
  function priceSummary(element) {
    const amount = textOfDirectChild(element, "priceamount", "j151");
    const currency = textOfDirectChild(element, "currencycode", "j152");
    return clampSummary([amount, currency].filter(Boolean).join(" "));
  }

  /**
   * The <Product> chip:
   *   ISBN 9780123456789 · Hardback · "Title goes here"
   */
  function productSummary(element) {
    const parts = [];

    // Primary identifier — try the EDItEUR ID types in this preference
    // order: 15 (ISBN-13), 03 (GTIN-13), 02 (ISBN-10). If a Product has
    // none of those (e.g. only a proprietary ID), the summary omits the
    // identifier segment entirely rather than guessing.
    const id = pickPrimaryIdentifier(element);
    if (id) parts.push(`${id.label} ${id.value}`);

    // ProductForm + Title both live inside DescriptiveDetail.
    const desc = directChild(element, "descriptivedetail");
    if (desc) {
      const formCode = textOfDirectChild(desc, "productform", "b012");
      if (formCode) {
        const lists = window.OnixViewerCodeLists;
        const label = lists && lists.ProductForm && lists.ProductForm.get(formCode);
        parts.push(label || formCode);
      }

      const title = pickDistinctiveTitle(desc);
      if (title) {
        const t = title.length > 60 ? title.slice(0, 57) + "…" : title;
        parts.push(`"${t}"`);
      }
    }

    return parts.length ? parts.join(" · ") : "";
  }

  /**
   * For an attribute on an ONIX element, resolve a code-list value when the
   * attribute name is one of the ONIX-defined codelist attributes
   * (textcase, language, dateformat, etc.).
   *
   * Returns `{ value, label, listNumber }` or null.
   */
  function resolveAttributeCodelist(attrName, value) {
    if (!attrName || value == null) return null;
    const listNumber = ATTR_CODELISTS[String(attrName).toLowerCase()];
    if (!listNumber) return null;
    const byNumber = window.OnixViewerCodeListsByNumber;
    const list = byNumber && byNumber[listNumber];
    if (!list) return null;
    const label = list.get(String(value).trim());
    if (!label) return null;
    return { value: String(value).trim(), label, listNumber };
  }

  // ---- helpers used by the summaries ---------------------------------------

  function directChild(parentEl, lcName, lcShortAlt) {
    for (const c of parentEl.children) {
      const cn = (c.localName || c.nodeName).toLowerCase();
      if (cn === lcName || (lcShortAlt && cn === lcShortAlt)) return c;
    }
    return null;
  }

  function textOfDirectChild(parentEl, lcName, lcShortAlt) {
    const el = directChild(parentEl, lcName, lcShortAlt);
    return el ? (el.textContent || "").trim() : "";
  }

  function directChildren(parentEl, lcName, lcShortAlt) {
    const out = [];
    for (const c of parentEl.children) {
      const cn = (c.localName || c.nodeName).toLowerCase();
      if (cn === lcName || (lcShortAlt && cn === lcShortAlt)) out.push(c);
    }
    return out;
  }

  // ProductIdentifier is a direct child of <Product> per the ONIX schema.
  // Returns { label, value } for the best identifier the Product carries,
  // walking this preference list:
  //   1. ProductIDType 15 — ISBN-13 (the modern ISBN)
  //   2. ProductIDType 03 — GTIN-13 (used when the producer signals a
  //      generic trade-item barcode rather than an ISBN; for books these
  //      digits are usually the same number as the ISBN-13)
  //   3. ProductIDType 02 — ISBN-10 (legacy form, pre-2007 titles)
  // If none of those is present (e.g. only a proprietary internal ID),
  // returns null so the summary skips the identifier segment.
  const IDENTIFIER_PREFERENCE = [
    { type: "15", label: "ISBN" },
    { type: "03", label: "GTIN" },
    { type: "02", label: "ISBN" },
  ];

  function pickPrimaryIdentifier(productEl) {
    const byType = Object.create(null);
    for (const pid of directChildren(productEl, "productidentifier")) {
      const type = textOfDirectChild(pid, "productidtype", "b221");
      const val = textOfDirectChild(pid, "idvalue", "b244");
      if (!type || !val) continue;
      if (byType[type] == null) byType[type] = val;
    }
    for (const { type, label } of IDENTIFIER_PREFERENCE) {
      if (byType[type]) return { label, value: byType[type] };
    }
    return null;
  }

  // A <TitleElement> carries its title in one of two equally conformant forms:
  // a single <TitleText>, or the split form <TitlePrefix> plus
  // <TitleWithoutPrefix> (where <NoPrefix/> means "this title has no leading
  // article"). Both appear in the wild — the split form is common in Nordic
  // feeds — so read TitleText first and fall back to reassembling the split
  // form, prefix before remainder.
  function titleOfElement(titleElementEl) {
    let title = textOfDirectChild(titleElementEl, "titletext", "b203");
    if (!title) {
      const prefix = textOfDirectChild(titleElementEl, "titleprefix", "b030");
      const rest = textOfDirectChild(titleElementEl, "titlewithoutprefix", "b031");
      title = [prefix, rest].filter(Boolean).join(" ");
    }
    return title;
  }

  // A DescriptiveDetail can contain multiple <TitleDetail> blocks (original-
  // language title, abbreviated, distributor's, …). The "distinctive title"
  // is the one with TitleType=01 — that's the title we want in the summary.
  // Fall back to the first TitleDetail if none is explicitly distinctive.
  function pickDistinctiveTitle(descEl) {
    const titleDetails = directChildren(descEl, "titledetail");
    if (!titleDetails.length) return "";

    let chosen = null;
    for (const td of titleDetails) {
      if (textOfDirectChild(td, "titletype", "b202") === "01") {
        chosen = td;
        break;
      }
    }
    if (!chosen) chosen = titleDetails[0];

    // The title itself lives one level down, inside <TitleElement>.
    return titleOfDetail(chosen);
  }

  // The title carried by a <TitleDetail>: the first <TitleElement> that has
  // one. A TitleDetail can hold several (collection level, then item level).
  function titleOfDetail(titleDetailEl) {
    let title = "";
    for (const te of directChildren(titleDetailEl, "titleelement")) {
      if (!title) title = titleOfElement(te);
    }
    return title;
  }

  // ---- ONIX 3.x blocks ------------------------------------------------------

  // ONIX 3.x groups the children of <Product> into numbered blocks. Block 7
  // (PromotionDetail) was added in ONIX 3.1. Element names are compared in
  // lower case so both dialects match.
  const BLOCK_NUMBERS = new Map([
    ["descriptivedetail", 1],
    ["collateraldetail", 2],
    ["contentdetail", 3],
    ["publishingdetail", 4],
    ["relatedmaterial", 5],
    ["productsupply", 6],
    ["promotiondetail", 7],
  ]);

  function lowerName(node) {
    return (node.localName || node.nodeName || "").toLowerCase();
  }

  function isProductElement(node) {
    return !!node && node.nodeType === Node.ELEMENT_NODE && lowerName(node) === "product";
  }

  /** Block number (1–7) for a block element that sits directly in <Product>, else null. */
  function blockNumber(element, ctx) {
    let number = null;
    if (ctx.isOnix && isProductElement(element.parentNode)) {
      number = BLOCK_NUMBERS.get(lowerName(element)) || null;
    }
    return number;
  }

  // <Product> is either the document root itself or a direct child of the
  // message root, never deeper — so a root-level look suffices and a large
  // feed isn't scanned element by element.
  function productElements(doc) {
    const root = doc.documentElement;
    let products = [];
    if (isProductElement(root)) {
      products = [root];
    } else if (root) {
      products = Array.from(root.children).filter(isProductElement);
    }
    return products;
  }

  /**
   * Sorted block numbers present in the document's Product — only when the
   * document holds exactly one Product (standalone record or a one-product
   * message). Returns null otherwise, or for acknowledgements, whose
   * <Product> elements are record statuses rather than product records.
   */
  function singleProductBlocks(doc, ctx) {
    let numbers = null;
    if (ctx.isOnix && ctx.messageType !== "acknowledgement") {
      const products = productElements(doc);
      if (products.length === 1) {
        const found = new Set();
        for (const child of products[0].children) {
          const number = blockNumber(child, ctx);
          if (number) found.add(number);
        }
        numbers = Array.from(found).sort((a, b) => a - b);
      }
    }
    return numbers;
  }

  window.OnixViewerOnix = {
    detect,
    tagClass,
    resolveCodelist,
    resolveAttributeCodelist,
    codelistMeta,
    externalLinkIcon,
    nodeSummary,
    blockNumber,
    isProductElement,
    singleProductBlocks,
    blockNames: new Set(BLOCK_NUMBERS.keys()),
  };
})();

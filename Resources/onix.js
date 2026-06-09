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

  // Map from short tag → reference-name (subset; the full mapping is in
  // EDItEUR's "Element name aliases" table). Used both for highlighting and
  // for codelist lookups (so b221 still resolves ProductIDType).
  // Both maps are accessed with keys derived from untrusted XML (element /
  // attribute names). Object.create(null) prevents an XML element named e.g.
  // "constructor" or "__proto__" from accidentally resolving to a prototype
  // property and bypassing the falsy-check guards below.
  const SHORT_TO_REFERENCE = Object.assign(Object.create(null), {
    "ONIXmessage": "ONIXMessage",
    "header":      "Header",
    "product":     "Product",
    "a001": "RecordReference",
    "a002": "NotificationType",
    "notificationtype": "NotificationType",
    "productidentifier": "ProductIdentifier",
    "b221": "ProductIDType",
    "b244": "IDValue",
    "b012": "ProductForm",
    "b035": "ContributorRole",
    "descriptivedetail": "DescriptiveDetail",
    "titledetail": "TitleDetail",
    "titleelement": "TitleElement",
    "titletext": "TitleText",
    "titletype": "TitleType",
    "b202": "TitleType",
    "productcomposition": "ProductComposition",
    "x314": "ProductComposition",
    "contributor": "Contributor",
    "personname":  "PersonName",
    "nameidentifier": "NameIdentifier",
    "nameidtype": "NameIDType",
    "b390": "NameIDType",
    "publishingdetail": "PublishingDetail",
    "publishingdate":   "PublishingDate",
    "x448": "PublishingDateRole",
    "b332": "PublishingStatus",
    "language":      "Language",
    "languagerole":  "LanguageRole",
    "languagecode":  "LanguageCode",
    "b005": "LanguageRole",
    "b252": "LanguageCode",
    "countrycode": "CountryCode",
    "b251": "CountryCode",
    "b003": "PublishingStatus",
    "datevalue": "Date",
    "b306": "Date",
    "extent": "Extent",
    "extenttype": "ExtentType",
    "b218": "ExtentType",
    "extentvalue": "ExtentValue",
    "b219": "ExtentValue",
    "extentunit": "ExtentUnit",
    "b220": "ExtentUnit",
    "subjectschemeidentifier": "SubjectSchemeIdentifier",
    "b067": "SubjectSchemeIdentifier",
    "editiontype": "EditionType",
    "b056": "EditionType",
  });

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

  /**
   * Inspect a parsed XML Document and return:
   *   { isOnix, dialect: "reference"|"short"|null, version: "3.0"|"2.1"|null }
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
   * For collapsed <Product> blocks, build a one-line summary like:
   *   ISBN 9780123456789 · Hardback · "Title goes here"
   * shown as a faint badge so you can scan thousands of products quickly.
   */
  function productSummary(element, ctx) {
    if (!ctx.isOnix) return null;
    const name = (element.localName || element.nodeName).toLowerCase();
    if (name !== "product") return null;

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

    return parts.length ? parts.join(" · ") : null;
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

  // ---- helpers used by productSummary -------------------------------------

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

    // TitleText lives one level down, inside <TitleElement>.
    for (const te of directChildren(chosen, "titleelement")) {
      const txt = textOfDirectChild(te, "titletext", "b203");
      if (txt) return txt;
    }
    return "";
  }

  window.OnixViewerOnix = {
    detect,
    tagClass,
    resolveCodelist,
    resolveAttributeCodelist,
    codelistMeta,
    externalLinkIcon,
    productSummary,
  };
})();

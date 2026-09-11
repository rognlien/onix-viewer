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
  const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

  // Message-root candidates. The two spellings are the two dialects, not two
  // versions: the reference schema declares <ONIXMessage>, the short-tag
  // schema declares <ONIXmessage> (lower-case "message"), and that holds for
  // 3.0 and 3.1 alike — it is the one short tag that isn't all lower case.
  const MESSAGE_ROOTS = new Set(["ONIXMessage", "ONIXmessage"]);
  // Root of an ONIX Acknowledgement message (EDItEUR's optional response
  // format). Its namespace is the canonical signal; this set only catches
  // the rare no-namespace case so the root name alone still identifies it.
  const ACK_ROOTS = new Set(["ONIXMessageAcknowledgement"]);
  // The reliable dialect signal is the namespace URI (".../short"), which
  // detect() checks before it ever looks at the root's spelling.

  // Short tag → reference name. Used both for highlighting and for codelist
  // lookups, so <b253> still resolves LanguageRole.
  //
  // The bulk is GENERATED into onix-codelists.js from EDItEUR's short-tag
  // schemas — all 530 pairs across both releases, keys lower-cased. It used to be a hand-kept
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

  // Reverse index for translating a reference-dialect document into short
  // tags. Built from the generated map alone, never from EXTRA_SHORT_TAGS:
  // those deliberately point several keys at one reference name (b005 and
  // b253 are both LanguageRole), which would make the reverse ambiguous. The
  // generated map is one-to-one, so this direction is exact.
  const REFERENCE_TO_SHORT = Object.create(null);
  for (const shortTag of Object.keys(window.OnixViewerShortTags || {})) {
    const referenceForm = window.OnixViewerShortTags[shortTag];
    if (REFERENCE_TO_SHORT[referenceForm] == null) {
      REFERENCE_TO_SHORT[referenceForm] = shortTag;
    }
  }

  // The short schema spells the message root <ONIXmessage> and every other
  // short tag in lower case, so the generated keys are lower-cased for
  // lookup. Translating *to* short has to restore that one spelling.
  const SHORT_SPELLINGS = Object.assign(Object.create(null), {
    onixmessage: "ONIXmessage",
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

  // Second-order code lists. A few elements take their code from a list that
  // a sibling selects: <ProductFormFeatureValue> is a cover colour from List
  // 98 when <ProductFormFeatureType> is 01, an accessibility detail from List
  // 196 when it is 09, and free text under most other types. The classic
  // schema types these value elements as plain strings, so the generated
  // bindings cannot know about them. This table is transcribed from the
  // xs:assert rules of EDItEUR's strict (Advanced) 3.1.3 schema, which spells
  // every one of them out — see CLAUDE.md, "Second-order code lists".
  //
  // Keyed by the value element's reference name: `type` is the sibling whose
  // code picks the list, `lists` maps that code to a list number. `leading`
  // names the type codes whose value is a code followed by more text — the
  // EUDR entries carry a country code, then an optional species and harvest
  // date — so only the first token is looked up.
  const DEPENDENT_CODELISTS = Object.assign(Object.create(null), {
    ProductFormFeatureValue: {
      type: "ProductFormFeatureType",
      lists: {
        "01": 98, "02": 98, "26": 98, "27": 98, "55": 98, "57": 98, "58": 98, "59": 98,
        "04": 99, "05": 76, "06": 176, "09": 196, "12": 143, "13": 184, "15": 220,
        "19": 242, "21": 243,
        "41": 262, "42": 262, "43": 262, "44": 262, "45": 262, "46": 262,
        "47": 91, "48": 91, "49": 91,
      },
      leading: ["47", "48", "49"],
    },
    AudienceCodeValue: {
      type: "AudienceCodeType",
      lists: { "01": 28, "22": 203 },
    },
    AudienceRangeValue: {
      type: "AudienceRangeQualifier",
      lists: { "11": 77, "26": 77, "29": 227, "31": 238 },
    },
    ReturnsCode: {
      type: "ReturnsCodeType",
      lists: { "02": 66, "04": 204 },
    },
    ReligiousTextFeatureCode: {
      type: "ReligiousTextFeatureType",
      lists: { "01": 90 },
    },
    IDValue: {
      type: "SalesOutletIDType",
      lists: { "03": 139 },
    },
    // <FeatureValue> sits under two composites with differently named type
    // elements, so it names both selectors.
    FeatureValue: [
      { type: "ResourceFeatureType", lists: { "09": 256 } },
      { type: "ResourceVersionFeatureType", lists: { "01": 178 } },
    ],
    ResourceFileFeatureValue: {
      type: "ResourceFileFeatureType",
      lists: { "01": 178 },
    },
    SpecificationFeatureValue: {
      type: "SpecificationFeatureType",
      lists: { "43": 257, "45": 258 },
    },
  });

  function dependentEntries(name) {
    const entry = DEPENDENT_CODELISTS[name];
    return entry ? [].concat(entry) : [];
  }

  function siblingNamed(element, siblingReferenceName) {
    let found = null;
    const parent = element.parentNode;
    if (parent && parent.nodeType === Node.ELEMENT_NODE) {
      for (const sibling of parent.children) {
        if (sibling !== element && referenceName(sibling) === siblingReferenceName) {
          found = sibling;
          break;
        }
      }
    }
    return found;
  }

  /**
   * The second-order list an element's value is drawn from, chosen by the
   * code in its type sibling. Returns null when the element is not one of
   * the value elements above, its type sibling is missing, or that sibling's
   * code selects no list (the value is then free text or a number).
   *
   * Otherwise `{ listNumber, typeElement, typeCode, leading }`, where
   * `leading` means only the value's first whitespace-separated token is the
   * code. Both dialects work: names are compared as reference names, and the
   * type element is handed back as-is so a caller can name it the way the
   * document spells it.
   */
  function dependentCodelist(element) {
    let result = null;
    for (const entry of dependentEntries(referenceName(element))) {
      const typeElement = siblingNamed(element, entry.type);
      const typeCode = typeElement ? (typeElement.textContent || "").trim() : "";
      const listNumber = entry.lists[typeCode];
      if (listNumber) {
        const leading = Boolean(entry.leading && entry.leading.includes(typeCode));
        result = { listNumber, typeElement, typeCode, leading };
        break;
      }
    }
    return result;
  }

  // The code within a value, for a list found through dependentCodelist().
  function dependentCode(value, dependent) {
    return dependent && dependent.leading ? value.split(/\s+/)[0] : value;
  }

  // A code-list key that names a list by number rather than by element —
  // what a second-order list resolves to, since no element is bound to it.
  const LIST_KEY = /^list:(\d+)$/;

  function listKey(listNumber) {
    return `list:${listNumber}`;
  }

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
    } else if (MESSAGE_ROOTS.has(localName)) {
      // No namespace. The root's spelling gives the dialect exactly, since
      // each schema declares only its own form. Version has to come from the
      // release attribute; absent that, a namespace-less message is most
      // likely 2.1, which is where omitting the namespace was common.
      isOnix = true;
      dialect = (localName === "ONIXmessage") ? "short" : "reference";
      version = root.getAttribute("release") || "2.1";
    } else if (localName.toLowerCase() === "onixmessage") {
      // Neither schema's spelling, but unmistakably a message root — accept
      // it and let the release attribute speak for the version. Casing this
      // far off tells us nothing about the dialect, so infer it from the
      // children the way a bare <Product> root is handled.
      isOnix = true;
      dialect = inferProductDialect(root);
      version = root.getAttribute("release") || null;
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
   * The same element's name in the other dialect, or null when there's no
   * translation (an unknown or extension element) or the name is already the
   * requested form. Powers the toolbar's Reference / Short toggle: the tree
   * keeps rendering the parsed document, only the displayed names change.
   */
  function translatedName(nodeName, targetDialect) {
    let translated = null;
    const name = String(nodeName || "");
    if (targetDialect === "reference") {
      translated = SHORT_TO_REFERENCE[name.toLowerCase()] || null;
    } else if (targetDialect === "short") {
      const shortTag = REFERENCE_TO_SHORT[name] || null;
      translated = shortTag ? SHORT_SPELLINGS[shortTag] || shortTag : null;
    }
    return translated === name ? null : translated;
  }

  /**
   * The EDItEUR namespace for the other dialect: the URI's last segment is
   * "reference" or "short", so only that changes. Non-ONIX namespaces (and
   * un-namespaced documents) are returned untouched.
   */
  function translatedNamespace(namespaceURI, targetDialect) {
    let translated = namespaceURI;
    if (namespaceURI && namespaceURI.startsWith(ONIX_NS_PREFIX)) {
      const segments = namespaceURI.split("/");
      const last = segments[segments.length - 1];
      if (last === "reference" || last === "short") {
        segments[segments.length - 1] = targetDialect === "short" ? "short" : "reference";
        translated = segments.join("/");
      }
    }
    return translated;
  }

  /**
   * Deep copy of `node` rewritten into the target dialect: every element in
   * the EDItEUR namespace is renamed and moved to that dialect's namespace,
   * so the result is valid ONIX in one dialect rather than a mixture. The
   * copy is detached — callers serialise it, they don't insert it.
   *
   * Elements outside the ONIX namespace keep their name and namespace, as do
   * elements with no known translation. Whitespace, comments, CDATA and
   * processing instructions are carried over verbatim, so a serialised copy
   * keeps the source's own indentation.
   */
  function translateNode(node, targetDialect) {
    const sourceNamespace = documentNamespace(node);
    return cloneTranslated(node, targetDialect, sourceNamespace);
  }

  function documentNamespace(node) {
    const doc = node.ownerDocument || node;
    const root = doc.documentElement;
    return (root && root.namespaceURI) || null;
  }

  function cloneTranslated(node, targetDialect, sourceNamespace) {
    let clone = null;
    if (node.nodeType === Node.ELEMENT_NODE) {
      clone = cloneTranslatedElement(node, targetDialect, sourceNamespace);
    } else if (node.nodeType === Node.DOCUMENT_NODE) {
      clone = node.cloneNode(false);
      for (const child of node.childNodes) {
        clone.appendChild(cloneTranslated(child, targetDialect, sourceNamespace));
      }
    } else {
      clone = node.cloneNode(true);
    }
    return clone;
  }

  function cloneTranslatedElement(element, targetDialect, sourceNamespace) {
    const doc = element.ownerDocument;
    const name = translatedName(element.nodeName, targetDialect) || element.nodeName;
    // Only elements that live in the document's ONIX namespace move; anything
    // in a foreign namespace stays where it is.
    const inOnixNamespace = element.namespaceURI && element.namespaceURI === sourceNamespace;
    const namespace = inOnixNamespace
      ? translatedNamespace(element.namespaceURI, targetDialect)
      : element.namespaceURI;
    const clone = doc.createElementNS(namespace, name);

    for (const attribute of element.attributes) {
      // Namespace declarations are re-emitted by the serialiser from the
      // element's own namespace; copying the source's would declare the
      // dialect we just translated away from.
      if (attribute.name === "xmlns" || attribute.name.startsWith("xmlns:")) continue;
      clone.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
    }
    // A source element that declared the namespace itself should still declare
    // it after translation — with the translated URI.
    if (namespace && element.hasAttribute("xmlns")) {
      clone.setAttributeNS(XMLNS_NS, "xmlns", namespace);
    }

    for (const child of element.childNodes) {
      clone.appendChild(cloneTranslated(child, targetDialect, sourceNamespace));
    }
    return clone;
  }

  /**
   * The code list an element's value must come from, whether or not the value
   * is in it: the list the schema binds to the element, or failing that the
   * one a sibling selects (see DEPENDENT_CODELISTS). This is what lets a row
   * whose code is wrong still offer the list it should have come from.
   *
   * Returns null when the element is bound to no list, or has element
   * children (code-list elements never have mixed content in valid ONIX).
   * Otherwise `{ codelistKey, value, listName, listNumber, title, url,
   * selector, context }`, where `value` is the code as written — possibly
   * empty, possibly unknown. For a second-order list `selector` is the
   * sibling that chose it, `{ name, code }`, in the document's own spelling,
   * and `context` says the same in prose — "b335 when b334 is 09" over a
   * short-tag file — for the popup's eyebrow. Both are null otherwise.
   */
  function codelistFor(element, ctx) {
    let found = null;
    const bound = ctx.isOnix ? boundList(element, ctx) : null;
    const value = bound ? codeOf(element, bound.dependent) : null;
    const meta = bound && value !== null ? codelistMeta(bound.key) : null;
    if (meta) {
      const selector = bound.dependent ? selectorOf(bound.dependent) : null;
      found = {
        codelistKey: meta.key,
        value,
        listName: meta.listName,
        listNumber: meta.listNumber,
        title: meta.title,
        url: meta.url,
        selector,
        context: selector ? `${element.localName || element.nodeName} when ${selector.name} is ${selector.code}` : null,
      };
    }
    return found;
  }

  function selectorOf(dependent) {
    return {
      name: dependent.typeElement.localName || dependent.typeElement.nodeName,
      code: dependent.typeCode,
    };
  }

  /**
   * For an element with a text-node child whose tag is a known codelist key,
   * resolve the code to a human-readable label. The viewer renders this as a
   * small badge after the value, optionally followed by a link to the
   * canonical EDItEUR list page.
   *
   * Returns `null` when the code (or the list itself) is unknown, or
   * codelistFor()'s shape plus `label` otherwise.
   */
  function resolveCodelist(element, ctx) {
    let resolved = null;
    const found = codelistFor(element, ctx);
    const list = found && found.value ? codelistEntries(found.codelistKey) : null;
    const label = list ? list.get(found.value) : null;
    if (label) {
      resolved = Object.assign({ label }, found);
    }
    return resolved;
  }

  // The list bound to an element — its own, or a sibling's choice — as
  // `{ key, dependent }`, where `key` is what codelistMeta() and
  // codelistEntries() take. Null when there is neither.
  function boundList(element, ctx) {
    let bound = null;
    let name = element.localName || element.nodeName;
    // Map short tags to reference names so the same lookup table works for both.
    if (ctx.dialect === "short") {
      name = SHORT_TO_REFERENCE[name.toLowerCase()] || name;
    }
    const lists = window.OnixViewerCodeLists;
    if (lists && lists[name]) {
      bound = { key: name, dependent: null };
    } else {
      const dependent = dependentCodelist(element);
      if (dependent) bound = { key: listKey(dependent.listNumber), dependent };
    }
    return bound;
  }

  // The element's own text, trimmed, reduced to its code for a `leading`
  // list. Null for mixed content.
  function codeOf(element, dependent) {
    const nodes = Array.from(element.childNodes);
    const mixed = nodes.some((node) => node.nodeType === Node.ELEMENT_NODE);
    const text = nodes.filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.nodeValue).join("");
    return mixed ? null : dependentCode(text.trim(), dependent);
  }

  /**
   * For a codelist key (e.g. "ProductIDType"), return its EDItEUR list
   * metadata: `{ listName, listNumber, url }` or null when unknown.
   * Used by the code-list popup, which already knows the codelist key.
   */
  function codelistMeta(name) {
    let result = null;
    const byNumber = LIST_KEY.exec(String(name || ""));
    const meta = byNumber ? metaForListNumber(Number(byNumber[1])) : (window.OnixViewerCodeListMeta || {})[name];
    if (meta) {
      result = {
        key: name,
        listName: `List ${meta.listNumber}`,
        listNumber: meta.listNumber,
        title: meta.title || null,
        url: `https://ns.editeur.org/onix/en/${meta.listNumber}`,
      };
    }
    return result;
  }

  // The 35 lists no element binds — attribute lists and the second-order
  // lists — have their titles by number only.
  function metaForListNumber(listNumber) {
    const byNumber = window.OnixViewerCodeListsByNumber;
    const titles = window.OnixViewerCodeListTitles;
    let meta = null;
    if (byNumber && byNumber[listNumber]) {
      meta = { listNumber, title: (titles && titles[listNumber]) || null };
    }
    return meta;
  }

  /**
   * The `Map<code, label>` behind a codelist key — an element name, or a
   * `list:N` key for a list reached by number. Null when unknown.
   */
  function codelistEntries(name) {
    const byNumber = LIST_KEY.exec(String(name || ""));
    const lists = window.OnixViewerCodeLists || {};
    const numbered = window.OnixViewerCodeListsByNumber || {};
    return (byNumber ? numbered[Number(byNumber[1])] : lists[name]) || null;
  }

  /**
   * Build a small inline SVG external-link icon. Shared by the tree and the
   * code-list popup so the visual is consistent.
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
    resolveCodelist,
    codelistFor,
    resolveAttributeCodelist,
    dependentCodelist,
    codelistMeta,
    codelistEntries,
    externalLinkIcon,
    nodeSummary,
    translatedName,
    translateNode,
    blockNumber,
    isProductElement,
    productElements,
    singleProductBlocks,
  };
})();

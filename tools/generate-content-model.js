#!/usr/bin/env node
// tools/generate-content-model.js
//
// Compiles an ONIX structure XSD into a compact content model that
// Resources/onix-validate.js interprets at runtime.
//
// Why compile rather than ship a schema validator: the browser has no XSD
// support, and libxml2-via-WASM would add ~4 MB (runtime plus the code-list
// and XHTML schema modules) and needs 'wasm-unsafe-eval', which the viewer
// can't rely on — its scripts run in the page's world under the page's CSP.
// The schema itself is regular enough to compile:
//
//   * occurrence is only minOccurs="0" / maxOccurs="unbounded" (plus one
//     maxOccurs="2"), so bounds are two small integers;
//   * no xs:any, no substitution groups, no xs:all;
//   * no compound particle repeats, so every sequence/choice is matched at
//     most once — the runtime matcher needs no backtracking;
//   * XSD's Unique Particle Attribution rule guarantees the alternatives of a
//     choice have disjoint first-sets, so one-token lookahead is exact.
//
// The model holds REFERENCE names only. Short-tag documents are validated by
// translating each name through the generated short-tag map first, which
// halves the model and keeps one source of truth for the aliases.
//
// Usage:
//   node tools/generate-content-model.js                  # ONIX 3.1
//   node tools/generate-content-model.js --version=3.0    # ONIX 3.0
//   node tools/generate-content-model.js --xsd=PATH --version=X --out=PATH
//
// --version picks the input (tools/data/ONIX_BookProduct_<version>_reference.xsd)
// and names the output (Resources/onix-content-model-<version>.js). The runtime
// keeps models in a registry keyed by version and loads one file per release,
// so adding a release is a generator run plus a script tag.

"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const XS = "http://www.w3.org/2001/XMLSchema";

// ONIX 3.0 names three of its attribute types after the code list instead of
// numbering it — SourceTypeCode where 3.1 says List3 — and those definitions
// live in the CodeLists XSD we deliberately don't commit. 3.1 renamed them, so
// the numbers come from there. Left unmapped they compiled to an unknown
// datatype, and the datatype rule skips what it doesn't recognise: sourcetype,
// textcase and textformat went entirely unchecked in every 3.0 document.
const LEGACY_LIST_TYPES = { SourceTypeCode: 3, TextCaseCode: 14, TextFormatCode: 34 };

// Every XSD construct either release uses, and all of them are compiled. The
// point of asserting it is the converse: a construct absent today — xs:any,
// xs:all, xs:key, substitutionGroup, nillable, a facet like maxExclusive —
// would be quietly ignored if EDItEUR started using it, and the validator
// would under-report without anyone noticing. So refuse to compile a schema
// this generator does not fully understand, rather than emit a model that is
// silently short.
const KNOWN_CONSTRUCTS = new Set([
  "schema", "include", "annotation", "documentation",
  "element", "complexType", "simpleType", "simpleContent", "complexContent",
  "extension", "restriction", "sequence", "choice", "group",
  "attribute", "attributeGroup", "unique", "selector", "field",
  "enumeration", "pattern", "minInclusive", "maxInclusive", "minExclusive",
  "minLength", "list", "union",
]);

// Attributes that change what a declaration means. `fixed`, `nillable`,
// `abstract` and `substitutionGroup` appear nowhere in either release; each
// would need real work in the matcher, so they are refused rather than
// ignored.
const REFUSED_ATTRIBUTES = ["fixed", "nillable", "abstract", "substitutionGroup", "form"];

// The facets above are read by name, so one this generator does not read would
// simply not constrain anything — the datatype would be checked more loosely
// than the schema asks. Name the ones that are handled and refuse the rest.
const HANDLED_FACETS = new Set([
  "pattern", "minInclusive", "maxInclusive", "minExclusive", "minLength",
  "simpleType", "annotation",
]);

const VERSION = arg("--version=") || "3.1";
const XSD_PATH = arg("--xsd=") ||
  path.join(__dirname, "data", `ONIX_BookProduct_${VERSION}_reference.xsd`);
// One file per release, so the runtime registry composes them by loading both.
const OUT_FILE = arg("--out=") ||
  path.join(__dirname, "..", "Resources", `onix-content-model-${VERSION}.js`);

main();

function main() {
  const doc = new (new JSDOM().window.DOMParser)()
    .parseFromString(fs.readFileSync(XSD_PATH, "utf8"), "application/xml");
  const schema = doc.documentElement;
  assertKnownConstructs(doc);

  const groups = Object.create(null);
  for (const group of elements(doc, "group")) {
    const name = group.getAttribute("name");
    if (name) groups[name] = group;
  }

  // A complexType with a name is referenced by an element's `type` instead of
  // sitting inline. Only 3.1 has any, and only <EpubLicense> uses them.
  const complexTypes = Object.create(null);
  for (const type of elements(doc, "complexType")) {
    const name = type.getAttribute("name");
    if (name) complexTypes[name] = type;
  }

  const attributeGroups = Object.create(null);
  for (const group of elements(doc, "attributeGroup")) {
    const name = group.getAttribute("name");
    if (name) attributeGroups[name] = group;
  }
  // Attribute declarations are global in effect: `language` is List 74 wherever
  // it appears. So the specs are emitted once and each element carries only the
  // names it allows.
  const attributeSpecs = Object.create(null);
  // Only ten distinct attribute sets exist across all 510 elements — 401 of
  // them share one — so the sets are pooled and each element stores an index.
  // Spelling the names out per element cost 25 KB to say the same thing.
  const attributeSets = [];

  const datatypes = parseDatatypes(doc);
  const model = Object.create(null);
  const deprecated = Object.create(null);
  const counts = { composite: 0, list: 0, text: 0, empty: 0, flow: 0 };

  // Local element declarations that name a complexType are collected as the
  // owning element's model is compiled, which resolves group indirection for
  // free: a group is expanded once per element that references it, so the
  // owner recorded here is always the real parent.
  const typed = [];
  const context = { groups, complexTypes, attributeGroups, attributeSpecs, attributeSets, counts };

  for (const element of elements(doc, "element")) {
    if (element.parentNode !== schema) continue;
    const name = element.getAttribute("name");
    if (!name) continue;
    const compiled = compileElement(element, groups, { owner: name, typed });
    // XSD supplies a default to an element left empty, so an empty
    // <CopyrightType/> means "C" and is valid. Three declarations across the
    // two releases carry one; none carries `fixed`.
    const fallback = element.getAttribute("default");
    if (fallback !== null) compiled.d = fallback;
    const allowed = attributesOf(element, attributeGroups, attributeSpecs);
    if (allowed.length) compiled.a = internSet(attributeSets, allowed);
    const unique = uniqueConstraintsOf(element);
    if (unique.length) compiled.u = unique;
    model[name] = compiled;
    counts[kindOf(compiled)]++;
    const note = deprecationOf(element);
    if (note) deprecated[name] = note;
  }

  addTypedElements(model, typed, context);
  assertDatatypesResolve(model, attributeSpecs, datatypes);

  const output = render(model, datatypes, deprecated, attributeSpecs, attributeSets, counts);
  fs.writeFileSync(OUT_FILE, output);
  console.log(`generated ${OUT_FILE}`);
  console.log(`  ONIX ${VERSION} content model from ${path.basename(XSD_PATH)}`);
  console.log(`  ${Object.keys(model).length} elements ` +
    `(${counts.composite} composite, ${counts.list} code-list, ${counts.text} typed, ` +
    `${counts.empty} empty, ${counts.flow} XHTML flow)`);
  console.log(`  ${Object.keys(datatypes).length} datatypes, ` +
    `${Object.keys(deprecated).length} deprecated elements, ` +
    `${Object.keys(attributeSpecs).length} attributes in ${attributeSets.length} sets, ` +
    `${countConstraints(model)} unique constraints, ${(output.length / 1024).toFixed(1)} KB`);
}

// A shape naming a datatype the generator never compiled is silently skipped
// by the datatype rule — the element or attribute simply goes unchecked. That
// is how ONIX 3.0's sourcetype, textcase and textformat slipped through, so
// assert instead of trusting the type names to stay recognisable.
function assertDatatypesResolve(model, attributeSpecs, datatypes) {
  const unresolved = [];
  const check = (label, named) => {
    if (typeof named === "string" && !datatypes[named]) unresolved.push(`${label} -> ${named}`);
  };
  for (const [name, shape] of Object.entries(model)) {
    check(`<${name}>`, shape.text);
    for (const [parent, variant] of Object.entries(shape.in || {})) {
      check(`<${name}> in <${parent}>`, variant.text);
    }
  }
  for (const [name, spec] of Object.entries(attributeSpecs)) check(`@${name}`, spec.text);
  if (unresolved.length) {
    throw new Error(`datatype not compiled, so it would go unchecked: ${unresolved.join(", ")}`);
  }
}


function assertKnownConstructs(doc) {
  const unknown = new Set();
  const refused = new Set();
  for (const node of doc.getElementsByTagName("*")) {
    if (!KNOWN_CONSTRUCTS.has(node.localName)) unknown.add(node.localName);
    for (const name of REFUSED_ATTRIBUTES) {
      if (node.hasAttribute(name)) refused.add(`${node.localName}@${name}`);
    }
  }
  if (unknown.size) {
    throw new Error(`XSD construct this generator does not compile: ` +
      `${[...unknown].sort().join(", ")}`);
  }
  if (refused.size) {
    throw new Error(`XSD attribute this generator does not honour: ` +
      `${[...refused].sort().join(", ")}`);
  }
}

function kindOf(compiled) {
  if (compiled.c) return "composite";
  if (compiled.list) return "list";
  if (compiled.flow) return "flow";
  if (compiled.empty) return "empty";
  return "text";
}

// ---- element compilation --------------------------------------------------

function compileElement(element, groups, collector) {
  const complexType = child(element, "complexType");
  if (!complexType) return { text: 1 };

  // mixed="true" extending Flow is an XHTML-bearing element (Text,
  // BiographicalNote, …). Flow lives in the XHTML subset schema we don't
  // bundle, and its content is markup rather than ONIX, so it stays opaque:
  // the validator checks nothing inside it.
  const complexContent = child(complexType, "complexContent");
  if (complexType.getAttribute("mixed") === "true" || complexContent) return { flow: 1 };

  const simpleContent = child(complexType, "simpleContent");
  if (simpleContent) {
    const extension = child(simpleContent, "extension") || child(simpleContent, "restriction");
    const base = extension ? extension.getAttribute("base") : null;
    const list = base && /^List(\d+)$/.exec(base);
    if (list) return { list: Number(list[1]) };
    return { text: base ? base.replace(/^dt\./, "") : 1 };
  }

  const content = child(complexType, "sequence") || child(complexType, "choice") ||
    child(complexType, "group");
  if (!content) return { empty: 1 };
  return { c: particle(content, groups, 0, collector) };
}

// Particles are arrays so the emitted model stays small:
//   ["e", name, min, max]   an element; max 0 means unbounded
//   ["s", min, ...parts]    a sequence, matched at most once
//   ["c", min, ...parts]    a choice, matched at most once
function particle(node, groups, depth = 0, collector = null) {
  if (depth > 16) throw new Error("content model nested deeper than expected");
  const min = node.getAttribute("minOccurs") === "0" ? 0 : 1;

  if (node.localName === "element") {
    const name = node.getAttribute("ref") || node.getAttribute("name");
    const rawMax = node.getAttribute("maxOccurs");
    const max = rawMax === "unbounded" ? 0 : Number(rawMax || 1);
    if (node.getAttribute("name")) recordDeclaration(node, name, collector);
    return ["e", name, min, max];
  }

  // A repeating sequence or choice would force the matcher to backtrack. The
  // 3.1 schema has none; fail loudly rather than emit a model the runtime
  // would quietly mis-match.
  if (node.getAttribute("maxOccurs") && node.getAttribute("maxOccurs") !== "1") {
    throw new Error(`repeating compound particle in ${node.localName} — matcher assumes none`);
  }

  if (node.localName === "group") {
    const group = groups[node.getAttribute("ref")];
    if (!group) throw new Error(`unresolved group ref ${node.getAttribute("ref")}`);
    // Always wrap: collapsing a single-particle group would discard the
    // reference's own minOccurs (gp.structured_name is referenced with
    // minOccurs="0"), turning an optional group into a required one.
    return ["s", min, ...childParticles(group, groups, depth, collector)];
  }

  const parts = childParticles(node, groups, depth, collector);
  return [node.localName === "choice" ? "c" : "s", min, ...parts];
}

function childParticles(node, groups, depth, collector) {
  return [...node.children]
    .filter((c) => ["element", "sequence", "choice", "group"].includes(c.localName))
    .map((c) => particle(c, groups, depth + 1, collector));
}

// ---- elements declared by a named complexType -------------------------------
//
// Most elements carry an inline complexType, so the declaration and its
// content model are the same node. Five declarations in 3.1 name a type
// instead, and all five are <EpubLicense>: `EpubLicenseType` inside <Price>,
// `EpubLicenseWithDateType` in the other four, the latter extending the former
// with <EpubLicenseDate>. Compiling only inline types left <EpubLicense> out
// of the model altogether, so valid 3.1 reported it as an unknown element and
// nothing inside it was checked at all.
//
// Its content genuinely depends on where it sits, which no other element in
// either release needs. The commonest variant becomes the element's own shape
// and the exceptions hang off it as `in`, keyed by parent reference name; the
// validator prefers `in[parent]` when one matches.

// Called for every local element declaration — one that carries `name` rather
// than `ref`. A local declaration with an inline complexType would need its
// own compilation path, so say so rather than emit a model missing an element.
function recordDeclaration(node, name, collector) {
  if (child(node, "complexType")) {
    throw new Error(`local declaration of ${name} has an inline complexType`);
  }
  const type = node.getAttribute("type");
  if (!type) throw new Error(`local declaration of ${name} has neither type nor content`);
  if (collector) collector.typed.push({ parent: collector.owner, name, type });
}

function addTypedElements(model, typed, context) {
  for (const [name, declarations] of Object.entries(byName(typed))) {
    if (model[name]) throw new Error(`${name} is declared both at top level and by type`);
    const shapes = new Map();
    for (const { type } of declarations) {
      if (!shapes.has(type)) shapes.set(type, compileTypedElement(type, context));
    }
    const commonest = commonestType(declarations);
    const shape = shapes.get(commonest);
    for (const { parent, type } of declarations) {
      if (type === commonest) continue;
      shape.in = shape.in || {};
      shape.in[parent] = shapes.get(type);
    }
    model[name] = shape;
    context.counts[kindOf(shape)]++;
  }
}

function byName(declarations) {
  const grouped = Object.create(null);
  for (const declaration of declarations) {
    grouped[declaration.name] = grouped[declaration.name] || [];
    grouped[declaration.name].push(declaration);
  }
  return grouped;
}

// The variant used in most places becomes the element's own shape, so `in`
// carries only the exceptions.
function commonestType(declarations) {
  const tally = new Map();
  for (const { type } of declarations) tally.set(type, (tally.get(type) || 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1])[0][0];
}

// A `type` naming a simple type is the same case simpleContent already covers.
function compileTypedElement(typeName, context) {
  if (context.complexTypes[typeName]) return compileNamedType(typeName, context);
  const list = /^List(\d+)$/.exec(typeName);
  return list ? { list: Number(list[1]) } : { text: typeName.replace(/^dt\./, "") };
}

// XSD extension semantics: the effective content is the base type's particles
// followed by the extension's own, and the attributes are the union.
function compileNamedType(typeName, context) {
  const parts = [];
  const allowed = [];
  for (const type of typeChain(typeName, context.complexTypes)) {
    const owner = contentOwner(type);
    parts.push(...childParticles(owner, context.groups, 0, null));
    for (const attribute of attributesOf(owner, context.attributeGroups, context.attributeSpecs)) {
      if (!allowed.includes(attribute)) allowed.push(attribute);
    }
  }
  const shape = parts.length === 0
    ? { empty: 1 }
    : { c: parts.length === 1 ? parts[0] : ["s", 1, ...parts] };
  if (allowed.length) shape.a = internSet(context.attributeSets, allowed.sort());
  return shape;
}

// Base type first, so the particles concatenate in the order XSD gives them.
function typeChain(typeName, complexTypes) {
  const chain = [];
  let name = typeName;
  while (name) {
    const type = complexTypes[name];
    if (!type) throw new Error(`unresolved complexType ${name}`);
    if (chain.includes(type)) throw new Error(`cyclic complexType extension at ${name}`);
    chain.unshift(type);
    name = baseTypeOf(type);
  }
  return chain;
}

// Where a type's own particles and attributes sit: on the type itself, or
// inside the xs:extension when it extends another type.
function contentOwner(type) {
  const extension = extensionOf(type);
  return extension || type;
}

function baseTypeOf(type) {
  const extension = extensionOf(type);
  return extension ? extension.getAttribute("base") : null;
}

function extensionOf(type) {
  const complexContent = child(type, "complexContent");
  return complexContent ? child(complexContent, "extension") : null;
}

// ---- identity constraints --------------------------------------------------

// xs:unique, compiled. 142 of them in 3.1, 85 in 3.0, and the shapes they use
// are narrow enough to compile rather than interpret XPath:
//
//   selector   one or two steps of onix:Name, optionally a "|" union of paths
//   field      onix:Name (a child's text), @name (an attribute), or "." (the
//              selected element's own text)
//
// Emitted per host element as `u`, e.g. for <ONIXMessage>:
//   [{ s: [["Product"]], f: [{ c: "RecordReference" }] }]
function uniqueConstraintsOf(element) {
  const constraints = [];
  for (const unique of descendantsOf(element, "unique")) {
    const selector = child(unique, "selector");
    if (!selector) continue;
    const paths = parseSelector(selector.getAttribute("xpath"));
    const fields = [...unique.getElementsByTagNameNS(XS, "field")]
      .map((f) => parseField(f.getAttribute("xpath")));
    // Throw rather than silently drop a constraint shape we don't compile: a
    // missing check is invisible, a failed build is not.
    if (!paths.length || !fields.length || fields.some((f) => f === null)) {
      throw new Error(`unsupported xs:unique on <${element.getAttribute("name")}>: ` +
        `${unique.getAttribute("name")}`);
    }
    constraints.push({ s: paths, f: fields });
  }
  return constraints;
}

// "onix:Product" -> [["Product"]]
// "onix:EpubLicense/onix:EpubLicenseDate" -> [["EpubLicense", "EpubLicenseDate"]]
// "onix:Contributor|onix:Collection/onix:Contributor" -> both of the above
function parseSelector(xpath) {
  if (!xpath) return [];
  const paths = [];
  for (const alternative of xpath.split("|")) {
    const steps = alternative.trim().split("/").map((step) => {
      const match = /^onix:([A-Za-z][A-Za-z0-9]*)$/.exec(step.trim());
      return match ? match[1] : null;
    });
    if (!steps.length || steps.some((step) => step === null)) return [];
    paths.push(steps);
  }
  return paths;
}

function parseField(xpath) {
  if (xpath === ".") return { self: 1 };
  const attribute = /^@([A-Za-z][A-Za-z0-9]*)$/.exec(xpath || "");
  if (attribute) return { a: attribute[1] };
  const child_ = /^onix:([A-Za-z][A-Za-z0-9]*)$/.exec(xpath || "");
  if (child_) return { c: child_[1] };
  return null;
}

function countConstraints(model) {
  return Object.values(model).reduce((total, shape) => total + (shape.u ? shape.u.length : 0), 0);
}

// ---- attributes ------------------------------------------------------------

// Every attribute an element accepts, by name, recording each one's spec in the
// shared table as it goes. Declarations sit directly in the complexType, or
// inside a simpleContent/complexContent extension, or come in through an
// attributeGroup — so the element's whole subtree is scanned. Element
// declarations don't nest here, so nothing from a child can leak in.
//
// `refname` and `shortname` are deliberately skipped: every element declares
// them, and their only legal value is that element's own name in each dialect,
// which the validator already knows from the short-tag map. Recording 511 pairs
// of single-value enumerations would double the model to say nothing.
function attributesOf(element, attributeGroups, specs) {
  const allowed = [];
  const seen = new Set();

  const collect = (node) => {
    for (const attribute of descendantsOf(node, "attribute")) {
      const name = attribute.getAttribute("name");
      if (!name || name === "refname" || name === "shortname" || seen.has(name)) continue;
      seen.add(name);
      allowed.push(name);
      const spec = attributeSpec(attribute);
      // The same name always resolves the same way; assert rather than assume.
      const existing = specs[name];
      if (existing && JSON.stringify(existing) !== JSON.stringify(spec)) {
        throw new Error(`attribute ${name} declared two ways: ` +
          `${JSON.stringify(existing)} vs ${JSON.stringify(spec)}`);
      }
      specs[name] = spec;
    }
  };

  collect(element);
  for (const reference of descendantsOf(element, "attributeGroup")) {
    const ref = reference.getAttribute("ref");
    if (!ref) continue;
    const group = attributeGroups[ref];
    if (!group) throw new Error(`unresolved attributeGroup ref ${ref}`);
    collect(group);
  }
  return allowed.sort();
}

function internSet(pool, names) {
  const key = names.join(",");
  const index = pool.findIndex((set) => set.join(",") === key);
  if (index >= 0) return index;
  pool.push(names);
  return pool.length - 1;
}

// { list: N } code-list bound, { text: "Type" } datatype, { values: [...] } an
// inline enumeration (only `release`), { text: 1 } anything else. `required` is
// carried through — exactly one attribute in the schema uses it.
function attributeSpec(attribute) {
  const spec = {};
  const type = attribute.getAttribute("type");
  const list = type && /^List(\d+)$/.exec(type);
  if (list) {
    spec.list = Number(list[1]);
  } else if (type && LEGACY_LIST_TYPES[type]) {
    spec.list = LEGACY_LIST_TYPES[type];
  } else if (type) {
    spec.text = type.replace(/^dt\./, "");
  } else {
    const values = descendantsOf(attribute, "enumeration")
      .map((e) => e.getAttribute("value"))
      .filter(Boolean);
    if (values.length) spec.values = values;
    else spec.text = 1;
  }
  if (attribute.getAttribute("use") === "required") spec.required = 1;
  return spec;
}

// ---- deprecation -----------------------------------------------------------

// EDItEUR marks a deprecated element in its annotation, and usually names the
// replacement. Four spellings appear across the two releases:
//
//   ● Deprecated from release 3.1 – use explicit <CurrencyCode> instead
//   ● Deprecated from revision 3.1.3
//   ● Deprecated within <TextContent> (but not within <TextSource>) at revision 3.1.3
//   ● Deprecated – use <Audience> instead                              (3.0 style)
//
// Not every note that says "Deprecated" is about the element carrying it —
// three describe their *children* instead:
//
//   <Header>           ● Deprecated <DefaultLanguageOfText>, <DefaultPriceType> …
//   <TitleElement>     ● Deprecated <TitleText> at release 3.1
//   <SalesRestriction> ● Deprecated P.21.11–21.18 at revision 3.0.2 …
//
// Those must not be flagged: <Header> and <TitleElement> are in nearly every
// ONIX file, so treating them as deprecated would bury a valid document in
// false warnings. "Deprecated" followed straight away by an element reference
// or a P.x clause number is about something else; anything else is about the
// element itself.
function deprecationOf(element) {
  for (const documentation of descendantsOf(element, "documentation")) {
    const note = (documentation.textContent || "").replace(/^[●\s]+/, "").trim();
    if (!/^Deprecated\b/.test(note)) continue;
    if (/^Deprecated\s+(?:<|P\.)/.test(note)) continue;   // about a child, not this element

    const parsed = {};
    const since = note.match(/^Deprecated\s+(?:from|at|in)\s+((?:release|revision)\s+[\d.]+)/);
    const within = note.match(/^Deprecated\s+within\s+<([A-Za-z0-9]+)>/);
    const at = note.match(/\bat\s+((?:release|revision)\s+[\d.]+)/);
    const advice = note.match(/[–-]\s*(use\s.+?)\.?$/);

    if (since) parsed.since = since[1];
    else if (at) parsed.since = at[1];
    if (within) parsed.within = within[1];
    if (advice) parsed.advice = advice[1].replace(/\s+/g, " ");
    return parsed;
  }
  return null;
}

// An element's own annotation, not a nested one — declarations don't nest here,
// but scoping to the subtree keeps that true if the schema ever changes.
function descendantsOf(node, localName) {
  return [...node.getElementsByTagNameNS(XS, localName)];
}

// ---- datatypes -------------------------------------------------------------

// Only the facets the runtime can act on. Everything else is a string.
// A union with a single member type is just that member — the ONIX schema uses
// that shape for dt.DateOrDateTime, whose one member carries the five date
// patterns. Treating it as an opaque union threw those away, so every
// datestamp and every date element went unchecked.

function assertFacetsConsumed(name, restriction) {
  const ignored = [...restriction.children]
    .map((facet) => facet.localName)
    .filter((facet) => !HANDLED_FACETS.has(facet));
  if (ignored.length) {
    throw new Error(`${name} carries facets this generator ignores: ${ignored.join(", ")}`);
  }
}

function unwrapSingleMemberUnion(simpleType) {
  const union = child(simpleType, "union");
  if (!union) return simpleType;
  const members = [...union.children].filter((c) => c.localName === "simpleType");
  return members.length === 1 && !union.getAttribute("memberTypes")
    ? members[0]
    : simpleType;
}

function parseDatatypes(doc) {
  const datatypes = Object.create(null);
  for (const simpleType of elements(doc, "simpleType")) {
    const name = simpleType.getAttribute("name");
    if (!name || !name.startsWith("dt.")) continue;
    const key = name.replace(/^dt\./, "");
    const resolved = unwrapSingleMemberUnion(simpleType);
    const restriction = child(resolved, "restriction");
    const facets = {};
    if (child(resolved, "list")) facets.list = 1;
    if (child(resolved, "union")) facets.union = 1;
    if (restriction) {
      // The base type constrains the lexical space even with no facets at all.
      // dt.Integer, dt.PositiveInteger, dt.PositiveIntegerOrZero and dt.Decimal
      // have none, so recording only facets left them entirely unchecked — a
      // <NumberOfPages>abc</NumberOfPages> passed.
      const base = restriction.getAttribute("base");
      if (base && base.startsWith("xs:")) facets.base = base.slice(3);
      const patterns = [...restriction.children]
        .filter((c) => c.localName === "pattern")
        .map((c) => c.getAttribute("value"));
      if (patterns.length) facets.re = patterns.length === 1 ? patterns[0] : patterns.join("|");
      for (const [facet, field] of [["minInclusive", "min"], ["maxInclusive", "max"]]) {
        const found = child(restriction, facet);
        if (found) facets[field] = Number(found.getAttribute("value"));
      }
      const exclusive = child(restriction, "minExclusive");
      if (exclusive) facets.gt = Number(exclusive.getAttribute("value"));
      // dt.CountryCodeList restricts an inline simpleType that holds the list,
      // so the list sits a level below the restriction. Record what it is a
      // list *of* — a code list number — so the members can be checked rather
      // than the whole value skipped.
      const inner = child(restriction, "simpleType");
      const listOf = inner && child(inner, "list");
      if (listOf) {
        facets.list = 1;
        const itemType = listOf.getAttribute("itemType");
        const itemList = itemType && /^List(\d+)$/.exec(itemType);
        if (itemList) facets.listOf = Number(itemList[1]);
      }
      const minLength = child(restriction, "minLength");
      if (minLength) facets.minLength = Number(minLength.getAttribute("value"));
      assertFacetsConsumed(name, restriction);
    }
    if (Object.keys(facets).length) datatypes[key] = facets;
  }
  return datatypes;
}

// ---- output ----------------------------------------------------------------

function render(model, datatypes, deprecated, attributeSpecs, attributeSets, counts) {
  const out = [];
  out.push("// onix-content-model.js — AUTO-GENERATED. Do not edit by hand.");
  out.push("//");
  out.push(`// ONIX ${VERSION} content model, compiled by`);
  out.push(`// tools/generate-content-model.js from ${path.basename(XSD_PATH)}.`);
  out.push("//");
  out.push("// Element names are REFERENCE names; onix-validate.js translates short tags");
  out.push("// before looking them up. Particle encoding:");
  out.push("//   [\"e\", name, min, max]  element, max 0 = unbounded");
  out.push("//   [\"s\", min, ...parts]   sequence, matched at most once");
  out.push("//   [\"c\", min, ...parts]   choice, matched at most once");
  out.push("// Leaves are { list: N } (code list), { text: \"Type\" } (datatype),");
  out.push("// { empty: 1 } (no content) or { flow: 1 } (XHTML — never inspected). `d` is");
  out.push("// the value XSD supplies when the element is left empty, and `in` holds the");
  out.push("// content models that apply only under a named parent.");
  out.push("//");
  out.push("// `attributes` is the shared spec per attribute name — they are global in");
  out.push("// effect. `attributeSets` pools the ten distinct name sets, and each element's");
  out.push("// `a` is an index into it.");
  out.push("// `refname`/`shortname` are omitted: allowed everywhere, and their only legal");
  out.push("// value is the element's own name in that dialect.");
  out.push("//");
  out.push("// `deprecated` names the elements EDItEUR has deprecated, with the release or");
  out.push("// revision it happened at, the replacement it advises, and — for the one");
  out.push("// context-sensitive case — the parent the deprecation is limited to.");
  out.push(`// ${Object.keys(model).length} elements: ${counts.composite} composite, ` +
    `${counts.list} code-list, ${counts.text} typed, ${counts.empty} empty, ${counts.flow} flow.`);
  out.push("");
  out.push("(function () {");
  out.push("  window.OnixViewerContentModels = window.OnixViewerContentModels || Object.create(null);");
  out.push(`  window.OnixViewerContentModels[${JSON.stringify(VERSION)}] = {`);
  out.push(`    version: ${JSON.stringify(VERSION)},`);
  out.push(`    datatypes: ${JSON.stringify(datatypes)},`);
  out.push(`    attributes: ${JSON.stringify(attributeSpecs)},`);
  out.push(`    attributeSets: ${JSON.stringify(attributeSets)},`);
  out.push("    deprecated: {");
  for (const name of Object.keys(deprecated).sort()) {
    out.push(`      ${JSON.stringify(name)}: ${JSON.stringify(deprecated[name])},`);
  }
  out.push("    },");
  out.push("    elements: {");
  for (const name of Object.keys(model).sort()) {
    out.push(`      ${JSON.stringify(name)}: ${JSON.stringify(model[name])},`);
  }
  out.push("    },");
  out.push("  };");
  out.push("})();");
  out.push("");
  return out.join("\n");
}

// ---- utilities -------------------------------------------------------------

function elements(doc, localName) {
  return [...doc.getElementsByTagNameNS(XS, localName)];
}

function child(node, localName) {
  return [...node.children].find((c) => c.localName === localName) || null;
}

function arg(prefix) {
  for (const value of process.argv.slice(2)) {
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return null;
}

#!/usr/bin/env node
// tools/generate-codelists.js
//
// Reads the EDItEUR ONIX code-lists JSON (issue N) and the reference XSD
// (for element-to-list bindings only), then emits
// Resources/onix-codelists.js — every list, full code/label, in
// EDItEUR-defined order.
//
// EDItEUR publishes the JSON at
//   https://www.editeur.org/files/ONIX%20for%20books%20-%20code%20lists/
//   ONIX_BookProduct_Codelists_Issue_<N>.json
// and we keep the latest committed at tools/data/onix-codelists.json.
//
// The 3.1 reference and short XSDs are bundled at
// tools/data/ONIX_BookProduct_3.1_{reference,short}.xsd — copied from
// EDItEUR (originally from the bokbasen onix-tools skill cache) so the
// generator has zero external dependencies once cloned.
//
// Usage:
//   node tools/generate-codelists.js
//   node tools/generate-codelists.js --json=<path>       # override JSON source
//   node tools/generate-codelists.js --xsd=<path>        # override reference XSD
//   node tools/generate-codelists.js --short-xsd=<a>,<b>  # override short XSDs
//
// The short XSD supplies the short-tag → reference-name map. Short tags are
// opaque codes (b253, x415), so without that map a short-tag document
// resolves almost no code-list labels. Deriving it beats hand-maintaining it:
// the schemas carry all 530 pairs and never drift.
//
// Why JSON for codelist data: EDItEUR publishes it as a clean structured
// feed, and it's the authoritative source. The XSD only encodes codes as
// xs:enumeration values, with the short label hidden in an annotation —
// noisier to parse than JSON's CodeValue / CodeDescription. We still use
// the XSD for the element → list-number map, since the JSON only covers
// the lists themselves, not the elements that bind to them.

"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const XS = "http://www.w3.org/2001/XMLSchema";

const JSON_PATH = parseArg("--json=") ||
  path.join(__dirname, "data", "onix-codelists.json");
const XSD_PATH = parseArg("--xsd=") ||
  path.join(__dirname, "data", "ONIX_BookProduct_3.1_reference.xsd");
// Both releases' short-tag schemas, merged. Their maps agree wherever they
// overlap (checked: no short tag means different things in 3.0 and 3.1), and
// each carries about twenty tags the other doesn't — 3.0 still has Conference,
// Reissue and Gender; 3.1 adds TextSource and the rest. A short-tag 3.0
// document needs its own tags to resolve anything at all.
const SHORT_XSD_PATHS = (parseArg("--short-xsd=") || [
  path.join(__dirname, "data", "ONIX_BookProduct_3.1_short.xsd"),
  path.join(__dirname, "data", "ONIX_BookProduct_3.0_short.xsd"),
].join(",")).split(",");
const OUT_FILE = path.join(__dirname, "..", "Resources", "onix-codelists.js");

main();

function main() {
  const codelistsJson = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  const referenceXsd = parseXsd(XSD_PATH);
  const shortXsds = SHORT_XSD_PATHS.map((file) => parseXsd(file.trim()));

  const { lists, schemaInfo } = parseLists(codelistsJson);
  const elementToList = parseElementMappings(referenceXsd);
  // Earlier files win, so the newer release's spelling is authoritative.
  const shortToReference = Object.create(null);
  for (const doc of shortXsds) {
    const pairs = parseShortTags(doc);
    for (const tag of Object.keys(pairs)) {
      if (shortToReference[tag] == null) shortToReference[tag] = pairs[tag];
    }
  }

  const output = render(lists, elementToList, shortToReference, schemaInfo);
  fs.writeFileSync(OUT_FILE, output);

  const numLists = Object.keys(lists).length;
  const numEntries = Object.values(lists).reduce((s, l) => s + l.entries.length, 0);
  const numElements = Object.keys(elementToList).filter((k) => lists[elementToList[k]]).length;
  const numShortTags = Object.keys(shortToReference).length;
  const sizeKB = (output.length / 1024).toFixed(1);
  console.log(`generated ${OUT_FILE}`);
  console.log(`  EDItEUR ONIX ${schemaInfo.version}, Issue ${schemaInfo.issue}`);
  console.log(`  ${numLists} lists, ${numEntries} entries, ${numElements} element bindings, ${sizeKB} KB`);
  console.log(`  ${numShortTags} short-tag → reference-name pairs`);
}

// --------------------------------------------------------------------------
// JSON: { ONIXCodeTable: { IssueNumber, CodeList: [{ CodeListNumber,
//        CodeListDescription, Code: [{ CodeValue, CodeDescription, ... }] }] }}
// --------------------------------------------------------------------------

function parseLists(doc) {
  const table = doc && doc.ONIXCodeTable;
  if (!table) throw new Error("expected top-level ONIXCodeTable");
  const lists = Object.create(null);
  for (const list of table.CodeList || []) {
    const listNumber = Number(list.CodeListNumber);
    if (!Number.isFinite(listNumber)) continue;
    const title = (list.CodeListDescription || "").trim();
    const entries = [];
    // EDItEUR marks a withdrawn code with the issue it was deprecated at, so
    // the viewer can warn about codes that are still valid XML but shouldn't
    // be sent any more.
    const deprecated = [];
    for (const c of list.Code || []) {
      const code = c.CodeValue;
      const label = (c.CodeDescription || "").trim();
      if (code == null || code === "" || !label) continue;
      entries.push([String(code), label]);
      if (Number(c.DeprecatedNumber)) deprecated.push([String(code), Number(c.DeprecatedNumber)]);
    }
    if (entries.length) lists[listNumber] = { title, entries, deprecated };
  }
  return {
    lists,
    schemaInfo: {
      version: "3.1",
      issue: Number(table.IssueNumber) || null,
      releaseDate: null, // EDItEUR's JSON doesn't include a release date
    },
  };
}

// --------------------------------------------------------------------------
// Reference XSD: element name → list number (binding stable across issues)
// --------------------------------------------------------------------------

// A binding is spelled either way round: on the declaration itself
// (`<xs:element name="x" type="List5"/>`) or on a restriction/extension
// inside it (`<xs:extension base="List5">`). Elements with no List type are
// composites or free text and simply don't appear in the map.
function parseElementMappings(doc) {
  const mapping = Object.create(null);
  for (const element of topLevelElements(doc)) {
    const name = element.getAttribute("name");
    const listNumber = listNumberOf(element);
    if (listNumber != null && mapping[name] == null) mapping[name] = listNumber;
  }
  return mapping;
}

function listNumberOf(element) {
  const own = listNumber(element.getAttribute("type"));
  if (own != null) return own;
  for (const node of descendants(element, "extension", "restriction")) {
    const base = listNumber(node.getAttribute("base"));
    if (base != null) return base;
  }
  return null;
}

function listNumber(value) {
  const m = value && value.match(/^List(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

// --------------------------------------------------------------------------
// Short XSD: short tag → reference name
// --------------------------------------------------------------------------

// Each element in the short-tag schema is declared under its short tag and
// carries the reference name as the sole enumeration of its `refname`
// attribute:
//
//   <xs:element name="b253"> … <xs:attribute name="refname">
//     … <xs:enumeration value="LanguageRole" /> …
//
// Keys are lower-cased because every consumer looks the tag up as
// `name.toLowerCase()` — the schema's one mixed-case tag (ONIXmessage) would
// otherwise be unreachable.
// Every element in the short-tag schema declares a refname, so a tag without
// one means we misread the schema rather than that the schema omitted it.
// Throw instead of emitting a map that's quietly short a few tags: a missing
// pair costs the reader a code-list label, leaves the dialect switch unable to
// rename the tag, and makes the validator call conformant ONIX unknown.
function parseShortTags(doc) {
  const mapping = Object.create(null);
  const missing = [];
  for (const element of topLevelElements(doc)) {
    const shortTag = element.getAttribute("name").toLowerCase();
    const refname = refnameOf(element);
    if (!refname) {
      missing.push(shortTag);
    } else if (mapping[shortTag] == null) {
      mapping[shortTag] = refname;
    }
  }
  if (missing.length) {
    throw new Error(
      `${missing.length} short tag(s) declare no refname enumeration: ` +
      `${missing.join(", ")} — the short-tag schema changed shape.`);
  }
  return mapping;
}

function refnameOf(element) {
  for (const attribute of descendants(element, "attribute")) {
    if (attribute.getAttribute("name") !== "refname") continue;
    const enumeration = descendants(attribute, "enumeration")[0];
    if (enumeration) return enumeration.getAttribute("value");
  }
  return null;
}

// --------------------------------------------------------------------------
// Output renderer
// --------------------------------------------------------------------------

function render(lists, elementToList, shortToReference, schemaInfo) {
  const issueStr = schemaInfo.issue != null ? `issue ${schemaInfo.issue}` : "(unknown issue)";
  const out = [];
  out.push("// onix-codelists.js — AUTO-GENERATED. Do not edit by hand.");
  out.push("//");
  out.push(`// Generated by tools/generate-codelists.js from the EDItEUR ONIX ${schemaInfo.version}`);
  out.push(`// code-lists JSON (${issueStr}). Each list is a Map<code, label> in`);
  out.push("// EDItEUR-defined order; iteration order is preserved across all consumers.");
  out.push("//");
  out.push("// Several elements share a list (e.g. multiple text-type or scheme-id");
  out.push("// elements). They reference the same Map instance via _lists below.");
  out.push("");
  out.push("(function () {");
  out.push("  const _lists = Object.create(null);");
  out.push("");

  const listNumbers = Object.keys(lists).map(Number).sort((a, b) => a - b);
  for (const n of listNumbers) {
    const list = lists[n];
    out.push(`  // List ${n} — ${list.title || "(untitled)"}`);
    out.push(`  _lists[${n}] = new Map([`);
    for (const [code, label] of list.entries) {
      out.push(`    [${jsString(code)}, ${jsString(label)}],`);
    }
    out.push(`  ]);`);
    out.push("");
  }

  out.push("  window.OnixViewerCodeLists = Object.create(null);");
  out.push("  window.OnixViewerCodeListMeta = Object.create(null);");
  out.push("");

  const elementNames = Object.keys(elementToList).sort();
  for (const name of elementNames) {
    const listNumber = elementToList[name];
    const list = lists[listNumber];
    if (!list) continue;
    out.push(`  window.OnixViewerCodeLists[${jsString(name)}] = _lists[${listNumber}];`);
    out.push(`  window.OnixViewerCodeListMeta[${jsString(name)}] = { listNumber: ${listNumber}, title: ${jsString(list.title || "")} };`);
  }

  out.push("");
  out.push("  // Expose every list by its EDItEUR number too, so consumers can look up");
  out.push("  // lists that are bound to attributes (textcase, dateformat) rather than");
  out.push("  // element names.");
  out.push("  window.OnixViewerCodeListsByNumber = _lists;");

  out.push("");
  out.push("  // Titles by list number. OnixViewerCodeListMeta reaches a title only");
  out.push("  // through an element that binds the list, and 35 of the 165 lists are");
  out.push("  // bound to attributes instead (textcase, textformat, dateformat, …) —");
  out.push("  // so a finding about one of those had no name to print.");
  out.push("  window.OnixViewerCodeListTitles = {");
  for (const n of listNumbers) {
    out.push(`    ${n}: ${jsString(lists[n].title)},`);
  }
  out.push("  };");

  out.push("");
  out.push("  // Codes EDItEUR has withdrawn, by list number → code → the issue at");
  out.push("  // which each was deprecated. Still valid XML, but not to be sent.");
  out.push("  window.OnixViewerDeprecatedCodes = Object.create(null);");
  for (const n of listNumbers) {
    const deprecated = lists[n].deprecated || [];
    if (!deprecated.length) continue;
    const pairs = deprecated.map(([code, issue]) => `${jsString(code)}: ${issue}`).join(", ");
    out.push(`  window.OnixViewerDeprecatedCodes[${n}] = { ${pairs} };`);
  }

  out.push("");
  out.push("  // Short tag → reference name, from the short-tag schema. onix.js layers");
  out.push("  // its own additions (Acknowledgement tags, ONIX 2.1 legacy tags) on top.");
  out.push("  window.OnixViewerShortTags = Object.create(null);");
  for (const shortTag of Object.keys(shortToReference).sort()) {
    out.push(`  window.OnixViewerShortTags[${jsString(shortTag)}] = ${jsString(shortToReference[shortTag])};`);
  }

  out.push("");
  out.push("  window.OnixViewerCodeListSchema = " + JSON.stringify({
    version: schemaInfo.version,
    issue: schemaInfo.issue,
    releaseDate: schemaInfo.releaseDate,
  }) + ";");

  out.push("})();");
  out.push("");
  return out.join("\n");
}

// --------------------------------------------------------------------------
// Utilities
// --------------------------------------------------------------------------

function jsString(s) {
  return JSON.stringify(s);
}

function parseXsd(file) {
  return new (new JSDOM().window.DOMParser)()
    .parseFromString(fs.readFileSync(file, "utf8"), "application/xml");
}

// Only declarations that are children of <xs:schema>. Elements nested inside a
// content model are references or local declarations, not the definitions the
// maps are keyed on.
function topLevelElements(doc) {
  const schema = doc.documentElement;
  return descendants(doc, "element")
    .filter((element) => element.parentNode === schema && element.getAttribute("name"));
}

// getElementsByTagNameNS is on both Document and Element, so this reads a
// whole schema or one declaration's subtree with the same call.
function descendants(node, ...localNames) {
  return localNames.flatMap((localName) =>
    [...node.getElementsByTagNameNS(XS, localName)]);
}

function parseArg(prefix) {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}

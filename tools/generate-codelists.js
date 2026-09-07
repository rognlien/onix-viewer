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
//   node tools/generate-codelists.js --short-xsd=<path>  # override short XSD
//
// The short XSD supplies the short-tag → reference-name map. Short tags are
// opaque codes (b253, x415), so without that map a short-tag document
// resolves almost no code-list labels. Deriving it beats hand-maintaining it:
// the schema carries all 505 pairs and never drifts.
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

const JSON_PATH = parseArg("--json=") ||
  path.join(__dirname, "data", "onix-codelists.json");
const XSD_PATH = parseArg("--xsd=") ||
  path.join(__dirname, "data", "ONIX_BookProduct_3.1_reference.xsd");
const SHORT_XSD_PATH = parseArg("--short-xsd=") ||
  path.join(__dirname, "data", "ONIX_BookProduct_3.1_short.xsd");
const OUT_FILE = path.join(__dirname, "..", "Resources", "onix-codelists.js");

main();

function main() {
  const codelistsJson = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  const referenceXsd = fs.readFileSync(XSD_PATH, "utf8");
  const shortXsd = fs.readFileSync(SHORT_XSD_PATH, "utf8");

  const { lists, schemaInfo } = parseLists(codelistsJson);
  const elementToList = parseElementMappings(referenceXsd);
  const shortToReference = parseShortTags(shortXsd);

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
    for (const c of list.Code || []) {
      const code = c.CodeValue;
      const label = (c.CodeDescription || "").trim();
      if (code == null || code === "" || !label) continue;
      entries.push([String(code), label]);
    }
    if (entries.length) lists[listNumber] = { title, entries };
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

function parseElementMappings(xml) {
  const mapping = Object.create(null);
  const elementRegex = /<xs:element\s+name="([A-Za-z][A-Za-z0-9]*)"([\s\S]*?)<\/xs:element>/g;
  let m;
  while ((m = elementRegex.exec(xml))) {
    const elementName = m[1];
    if (mapping[elementName] != null) continue;
    const body = m[2];
    const baseMatch = body.match(/(?:base|type)="List(\d+)"/);
    if (baseMatch) mapping[elementName] = parseInt(baseMatch[1], 10);
  }
  const selfClosingRegex = /<xs:element\s+name="([A-Za-z][A-Za-z0-9]*)"\s+type="List(\d+)"\s*\/>/g;
  while ((m = selfClosingRegex.exec(xml))) {
    if (mapping[m[1]] == null) mapping[m[1]] = parseInt(m[2], 10);
  }
  return mapping;
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
function parseShortTags(xml) {
  const mapping = Object.create(null);
  const elementRegex = /<xs:element\s+name="([A-Za-z][A-Za-z0-9]*)">([\s\S]*?)(?=<xs:element\s+name="|$)/g;
  let m;
  while ((m = elementRegex.exec(xml))) {
    const shortTag = m[1].toLowerCase();
    if (mapping[shortTag] != null) continue;
    const refname = m[2].match(/name="refname"[\s\S]*?<xs:enumeration\s+value="([A-Za-z]+)"/);
    if (refname) mapping[shortTag] = refname[1];
  }
  return mapping;
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

function parseArg(prefix) {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}

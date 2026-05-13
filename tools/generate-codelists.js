#!/usr/bin/env node
// tools/generate-codelists.js
//
// Reads the EDItEUR ONIX 3.1 code-lists XSD and the reference XSD, then
// emits Resources/onix-codelists.js — every list, full code-and-label, in
// EDItEUR-defined order.
//
// Usage:
//   node tools/generate-codelists.js [--source=<schema-dir>]
//
// If --source is omitted, the script falls back to the path the bokbasen
// onix-tools Claude Code skill installs to. To regenerate after a schema
// update, point --source at the new directory.
//
// Why parse XSDs with regex instead of a DOM parser: the EDItEUR XSDs are
// machine-formatted and very regular, the patterns we care about all sit at
// known nesting depths, and we avoid pulling in another dev dependency.
// jsdom can parse XML, but its XML mode is best-effort and historically
// flaky on schemas this large.

"use strict";

const fs = require("fs");
const path = require("path");

const SCHEMA_DIR = parseSourceArg() ||
  "/Users/bendik/.claude/plugins/cache/bokbasen/onix-tools/0.1.0/skills/onix/schemas/3.1/xsd";
const OUT_FILE = path.join(__dirname, "..", "Resources", "onix-codelists.js");

main();

function main() {
  const codelistsXsd = fs.readFileSync(path.join(SCHEMA_DIR, "ONIX_BookProduct_CodeLists.xsd"), "utf8");
  const referenceXsd = fs.readFileSync(path.join(SCHEMA_DIR, "ONIX_BookProduct_3.1_reference.xsd"), "utf8");

  const lists = parseLists(codelistsXsd);
  const elementToList = parseElementMappings(referenceXsd);

  const output = render(lists, elementToList);
  fs.writeFileSync(OUT_FILE, output);

  const numLists = Object.keys(lists).length;
  const numEntries = Object.values(lists).reduce((s, l) => s + l.entries.length, 0);
  const numElements = Object.keys(elementToList).filter((k) => lists[elementToList[k]]).length;
  const sizeKB = (output.length / 1024).toFixed(1);
  console.log(`generated ${OUT_FILE}`);
  console.log(`  ${numLists} lists, ${numEntries} entries, ${numElements} element bindings, ${sizeKB} KB`);
}

// --------------------------------------------------------------------------
// Code lists XSD: pull title + (code, short label) pairs out of every List N
// --------------------------------------------------------------------------

function parseLists(xml) {
  const lists = Object.create(null);
  const listRegex = /<xs:simpleType\s+name="List(\d+)">([\s\S]*?)<\/xs:simpleType>/g;
  let m;
  while ((m = listRegex.exec(xml))) {
    const listNumber = parseInt(m[1], 10);
    const body = m[2];

    const titleMatch = body.match(/<xs:documentation\s+source="ONIX Code List \d+">([^<]+)<\/xs:documentation>/);
    const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : null;

    const entries = [];
    const enumRegex = /<xs:enumeration\s+value="([^"]+)">([\s\S]*?)<\/xs:enumeration>/g;
    let em;
    while ((em = enumRegex.exec(body))) {
      const code = em[1];
      const enumBody = em[2];
      // The first <xs:documentation> inside an enumeration's annotation is
      // the short human-readable label. The second (if present) is a longer
      // description — we drop that to keep the bundle lean.
      const labelMatch = enumBody.match(/<xs:documentation>([\s\S]*?)<\/xs:documentation>/);
      if (!labelMatch) continue;
      const label = decodeEntities(collapseWhitespace(labelMatch[1].trim()));
      if (!label) continue;
      entries.push([code, label]);
    }

    if (entries.length) {
      lists[listNumber] = { title, entries };
    }
  }
  return lists;
}

// --------------------------------------------------------------------------
// Reference XSD: figure out which element name uses which list
// --------------------------------------------------------------------------

function parseElementMappings(xml) {
  const mapping = Object.create(null);

  // The reference XSD is structured. <xs:element name="X"> blocks may
  // contain a <xs:simpleContent><xs:extension base="ListN"> chain (the
  // common pattern), or a <xs:complexType><xs:complexContent>... or various
  // other shapes. For our purpose we just need the first List N reference
  // inside the element's body, since elements bind to at most one list.

  // Walk top-level element declarations. The XSD is flat at the top
  // (elements are direct children of xs:schema), so a non-greedy scan works.
  const elementRegex = /<xs:element\s+name="([A-Za-z][A-Za-z0-9]*)"([\s\S]*?)<\/xs:element>/g;
  let m;
  while ((m = elementRegex.exec(xml))) {
    const elementName = m[1];
    if (mapping[elementName] != null) continue;
    const body = m[2];
    const baseMatch = body.match(/(?:base|type)="List(\d+)"/);
    if (baseMatch) {
      mapping[elementName] = parseInt(baseMatch[1], 10);
    }
  }

  // Also catch self-closing simple-type elements:
  //   <xs:element name="X" type="ListN"/>
  const selfClosingRegex = /<xs:element\s+name="([A-Za-z][A-Za-z0-9]*)"\s+type="List(\d+)"\s*\/>/g;
  while ((m = selfClosingRegex.exec(xml))) {
    if (mapping[m[1]] == null) mapping[m[1]] = parseInt(m[2], 10);
  }

  return mapping;
}

// --------------------------------------------------------------------------
// Output renderer
// --------------------------------------------------------------------------

function render(lists, elementToList) {
  const out = [];
  out.push("// onix-codelists.js — AUTO-GENERATED. Do not edit by hand.");
  out.push("//");
  out.push("// Generated by tools/generate-codelists.js from the EDItEUR ONIX 3.1 schema");
  out.push("// (issue 72, 2026-01). Each list is a Map<code, label> in EDItEUR-defined");
  out.push("// order; iteration order is preserved across all consumers.");
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

  // Bind by element name. Sort alphabetically so diffs stay tidy across
  // schema regenerations.
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

  out.push("})();");
  out.push("");
  return out.join("\n");
}

// --------------------------------------------------------------------------
// Utilities
// --------------------------------------------------------------------------

function decodeEntities(s) {
  // Apply named entity decodes BEFORE numeric, then &amp; last so doubly-
  // encoded sequences resolve correctly.
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&amp;/g, "&");
}

function collapseWhitespace(s) {
  return s.replace(/\s+/g, " ");
}

function jsString(s) {
  // Standard JSON serialisation of a string is a valid JS string literal.
  return JSON.stringify(s);
}

function parseSourceArg() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--source=")) return arg.slice("--source=".length);
  }
  return null;
}

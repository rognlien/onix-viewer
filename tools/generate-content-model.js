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
//   node tools/generate-content-model.js
//   node tools/generate-content-model.js --xsd=PATH --version=3.0 --out=PATH
//
// Emitting a second ONIX release is a matter of pointing --xsd/--version at
// it; the runtime keeps models in a registry keyed by version.

"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const XS = "http://www.w3.org/2001/XMLSchema";
const XSD_PATH = arg("--xsd=") || path.join(__dirname, "data", "ONIX_BookProduct_3.1_reference.xsd");
const VERSION = arg("--version=") || "3.1";
const OUT_FILE = arg("--out=") || path.join(__dirname, "..", "Resources", "onix-content-model.js");

main();

function main() {
  const doc = new (new JSDOM().window.DOMParser)()
    .parseFromString(fs.readFileSync(XSD_PATH, "utf8"), "application/xml");
  const schema = doc.documentElement;

  const groups = Object.create(null);
  for (const group of elements(doc, "group")) {
    const name = group.getAttribute("name");
    if (name) groups[name] = group;
  }

  const datatypes = parseDatatypes(doc);
  const model = Object.create(null);
  const counts = { composite: 0, list: 0, text: 0, empty: 0, flow: 0 };

  for (const element of elements(doc, "element")) {
    if (element.parentNode !== schema) continue;
    const name = element.getAttribute("name");
    if (!name) continue;
    const compiled = compileElement(element, groups);
    model[name] = compiled;
    counts[kindOf(compiled)]++;
  }

  const output = render(model, datatypes, counts);
  fs.writeFileSync(OUT_FILE, output);
  console.log(`generated ${OUT_FILE}`);
  console.log(`  ONIX ${VERSION} content model from ${path.basename(XSD_PATH)}`);
  console.log(`  ${Object.keys(model).length} elements ` +
    `(${counts.composite} composite, ${counts.list} code-list, ${counts.text} typed, ` +
    `${counts.empty} empty, ${counts.flow} XHTML flow)`);
  console.log(`  ${Object.keys(datatypes).length} datatypes, ${(output.length / 1024).toFixed(1)} KB`);
}

function kindOf(compiled) {
  if (compiled.c) return "composite";
  if (compiled.list) return "list";
  if (compiled.flow) return "flow";
  if (compiled.empty) return "empty";
  return "text";
}

// ---- element compilation --------------------------------------------------

function compileElement(element, groups) {
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
  return { c: particle(content, groups) };
}

// Particles are arrays so the emitted model stays small:
//   ["e", name, min, max]   an element; max 0 means unbounded
//   ["s", min, ...parts]    a sequence, matched at most once
//   ["c", min, ...parts]    a choice, matched at most once
function particle(node, groups, depth = 0) {
  if (depth > 16) throw new Error("content model nested deeper than expected");
  const min = node.getAttribute("minOccurs") === "0" ? 0 : 1;

  if (node.localName === "element") {
    const name = node.getAttribute("ref") || node.getAttribute("name");
    const rawMax = node.getAttribute("maxOccurs");
    const max = rawMax === "unbounded" ? 0 : Number(rawMax || 1);
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
    return ["s", min, ...childParticles(group, groups, depth)];
  }

  const parts = childParticles(node, groups, depth);
  return [node.localName === "choice" ? "c" : "s", min, ...parts];
}

function childParticles(node, groups, depth) {
  return [...node.children]
    .filter((c) => ["element", "sequence", "choice", "group"].includes(c.localName))
    .map((c) => particle(c, groups, depth + 1));
}

// ---- datatypes -------------------------------------------------------------

// Only the facets the runtime can act on. Everything else is a string.
function parseDatatypes(doc) {
  const datatypes = Object.create(null);
  for (const simpleType of elements(doc, "simpleType")) {
    const name = simpleType.getAttribute("name");
    if (!name || !name.startsWith("dt.")) continue;
    const key = name.replace(/^dt\./, "");
    const restriction = child(simpleType, "restriction");
    const facets = {};
    if (child(simpleType, "list")) facets.list = 1;
    if (child(simpleType, "union")) facets.union = 1;
    if (restriction) {
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
    }
    if (Object.keys(facets).length) datatypes[key] = facets;
  }
  return datatypes;
}

// ---- output ----------------------------------------------------------------

function render(model, datatypes, counts) {
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
  out.push("// { empty: 1 } (no content) or { flow: 1 } (XHTML — never inspected).");
  out.push(`// ${Object.keys(model).length} elements: ${counts.composite} composite, ` +
    `${counts.list} code-list, ${counts.text} typed, ${counts.empty} empty, ${counts.flow} flow.`);
  out.push("");
  out.push("(function () {");
  out.push("  window.OnixViewerContentModels = window.OnixViewerContentModels || Object.create(null);");
  out.push(`  window.OnixViewerContentModels[${JSON.stringify(VERSION)}] = {`);
  out.push(`    version: ${JSON.stringify(VERSION)},`);
  out.push(`    datatypes: ${JSON.stringify(datatypes)},`);
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

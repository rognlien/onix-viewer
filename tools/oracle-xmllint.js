#!/usr/bin/env node
// The content models against an independent XSD processor.
//
// Every ONIX document in tests/fixtures/ and Onix/, plus EDItEUR's own sample
// from the 3.1 bundle, is rewritten to declare 3.0 and then 3.1 and judged
// twice: by libxml2 (xmllint --schema) against EDItEUR's Issue 74 schemas,
// and by Resources/onix-validate.js against the compiled model. The verdicts
// must agree. Counts differ where libxml2 stops at the first fault inside an
// element and skips the rest, so the verdict is the contract; both sides are
// printed for any document where they part.
//
// Only findings an XSD 1.0 processor can see count on our side: not the
// check digits (gtin.*), not the second-order code lists (codelist.dependent)
// or the form/detail affinities (form.detail), both from the strict schema,
// not the reader's rules (schematron.*), and not
// warnings (a deprecated code is still in the enumeration).
//
// The bundles are downloaded into dist/oracle/ on first use — they carry the
// two files the generator deliberately leaves out, ONIX_BookProduct_CodeLists
// .xsd and ONIX_XHTML_Subset.xsd — and their structure XSDs are checked to be
// byte-identical to the committed inputs in tools/data/, so the oracle and
// the generator read the same schema.
//
//   npm run test:oracle
//   node tools/oracle-xmllint.js --bundles=/path/with/the/two/zips

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ISSUE = 74;
const RELEASES = ["3.0", "3.1"];
const CACHE = argument("bundles") || path.join(ROOT, "dist", "oracle");

function argument(name) {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
}

function bundleURL(release) {
  return `https://www.editeur.org/files/ONIX%203/ONIX_BookProduct_${release}_XSDs+codes_Issue_${ISSUE}.zip`;
}

function schemaDir(release) {
  return path.join(CACHE, release, `ONIX_BookProduct_${release}_XSDs+codes_Issue_${ISSUE}`);
}

function fetchBundles() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const release of RELEASES) {
    const zip = path.join(CACHE, `onix-${release}.zip`);
    if (!fs.existsSync(zip)) {
      console.log(`downloading ${bundleURL(release)}`);
      execFileSync("curl", ["-sSL", "--max-time", "120", "-o", zip, bundleURL(release)], { stdio: "inherit" });
    }
    if (!fs.existsSync(schemaDir(release))) {
      execFileSync("unzip", ["-qo", zip, "-d", path.join(CACHE, release)]);
    }
    for (const kind of ["reference", "short"]) {
      const name = `ONIX_BookProduct_${release}_${kind}.xsd`;
      const bundled = fs.readFileSync(path.join(schemaDir(release), name));
      const committed = fs.readFileSync(path.join(ROOT, "tools", "data", name));
      if (!bundled.equals(committed)) {
        throw new Error(`${name} in the bundle differs from tools/data/${name}; regenerate or refresh`);
      }
    }
  }
}

function documents() {
  const fixtures = path.join(ROOT, "tests", "fixtures");
  const samples = path.join(ROOT, "Onix");
  return [
    ...fs.readdirSync(fixtures).filter((f) => f.startsWith("onix-")).map((f) => path.join(fixtures, f)),
    ...fs.readdirSync(samples).filter((f) => f.endsWith(".xml")).map((f) => path.join(samples, f)),
    ...fs.readdirSync(schemaDir("3.1")).filter((f) => f.endsWith(".xml")).map((f) => path.join(schemaDir("3.1"), f)),
  ];
}

// The document as it would be if it declared `release`: the namespace and
// the release attribute moved together, which is what "validate as" means.
function declaring(source, release) {
  return source
    .replace(/ns\.editeur\.org\/onix\/\d\.\d\//g, `ns.editeur.org/onix/${release}/`)
    .replace(/release\s*=\s*(["'])\d\.\d\1/g, `release="${release}"`);
}

function lint(xml, release, dialect) {
  const file = path.join(CACHE, "oracle-tmp.xml");
  fs.writeFileSync(file, xml);
  const schema = path.join(schemaDir(release), `ONIX_BookProduct_${release}_${dialect}.xsd`);
  let errors = [];
  try {
    execFileSync("xmllint", ["--noout", "--schema", schema, file], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (failure) {
    errors = String(failure.stderr).split("\n")
      .filter((line) => /Schemas validity error/.test(line))
      .map((line) => line.replace(/^.*\.xml:(\d+): element (\S+): Schemas validity error : /, "line $1 <$2> "));
  }
  return errors;
}

function schemaClass(finding) {
  return finding.severity === "error" &&
    !/^(gtin|schematron)\./.test(finding.code) &&
    finding.code !== "codelist.dependent" &&
    finding.code !== "form.detail";
}

function main() {
  fetchBundles();
  const harness = require(path.join(ROOT, "tests", "harness"));
  const seed = '<ONIXMessage release="3.1" xmlns="http://ns.editeur.org/onix/3.1/reference">' +
    "<Header><Sender><SenderName>x</SenderName></Sender><SentDateTime>20260101</SentDateTime></Header></ONIXMessage>";
  const w = harness.renderSource(seed, "seed.xml");
  const validation = w.OnixViewerValidation;

  let compared = 0;
  const disagreements = [];
  for (const file of documents()) {
    const source = fs.readFileSync(file, "utf8");
    const namespace = source.match(/ns\.editeur\.org\/onix\/(acknowledgement\/)?\d\.\d\/(reference|short)/);
    if (!namespace || namespace[1]) continue; // no release to rewrite, or the Acknowledgement schema
    const dialect = namespace[2];
    for (const release of RELEASES) {
      const xml = declaring(source, release);
      const lintErrors = lint(xml, release, dialect);
      const ours = harness.findingsFor(w, xml).findings.filter(schemaClass);
      const agree = (lintErrors.length === 0) === (ours.length === 0);
      compared++;
      const verdict = `xmllint ${lintErrors.length ? `${lintErrors.length} errors` : "valid"}, ours ${ours.length ? `${ours.length} errors` : "valid"}`;
      console.log(`${agree ? "  " : "!!"} ${path.basename(file)} as ${release}: ${verdict}`);
      if (!agree) {
        disagreements.push(`${path.basename(file)} as ${release}: ${verdict}`);
        for (const line of lintErrors) console.log(`       lint  ${line.slice(0, 160)}`);
        for (const f of ours) console.log(`       ours  ${f.code} <${f.node.nodeName}> ${validation.message(f)}`);
      }
    }
  }
  console.log(`\n${compared} verdicts compared, ${disagreements.length} disagreements`);
  if (disagreements.length) {
    for (const d of disagreements) console.log(`  - ${d}`);
    process.exit(1);
  }
}

main();

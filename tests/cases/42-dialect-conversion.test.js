const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const {
  test, describe, assert, render, renderSource, findings, FIXTURES, SAMPLES, ROOT,
} = require("../harness");

describe("Dialect conversion", () => {
  // The conversion is checked against EDItEUR's schemas rather than against
  // the generated map, so a generator bug cannot pass its own test.
  const XS = "http://www.w3.org/2001/XMLSchema";
  const RELEASES = ["3.0", "3.1"];
  const schemaParser = new (new JSDOM().window.DOMParser)();

  function schema(file) {
    const xsd = fs.readFileSync(path.join(ROOT, "tools", "data", file), "utf8");
    return schemaParser.parseFromString(xsd, "application/xml");
  }

  function globalDeclarations(doc) {
    return [...doc.getElementsByTagNameNS(XS, "element")]
      .filter((el) => el.parentNode === doc.documentElement && el.getAttribute("name"));
  }

  function referenceNames(release) {
    return globalDeclarations(schema(`ONIX_BookProduct_${release}_reference.xsd`))
      .map((el) => el.getAttribute("name"));
  }

  // Short tag → reference name, from each short declaration's refname enumeration.
  function schemaPairs(release) {
    const pairs = new Map();
    for (const declaration of globalDeclarations(schema(`ONIX_BookProduct_${release}_short.xsd`))) {
      const refname = [...declaration.getElementsByTagNameNS(XS, "attribute")]
        .find((attribute) => attribute.getAttribute("name") === "refname");
      const enumeration = refname && refname.getElementsByTagNameNS(XS, "enumeration")[0];
      pairs.set(declaration.getAttribute("name"), enumeration && enumeration.getAttribute("value"));
    }
    return pairs;
  }

  function namespace(release, dialect) {
    return `http://ns.editeur.org/onix/${release}/${dialect}`;
  }

  function serialize(window, node) {
    return new window.XMLSerializer().serializeToString(node);
  }

  function parse(window, xml) {
    return new window.DOMParser().parseFromString(xml, "application/xml");
  }

  // Every element as a position, its depth, namespace and name, so a swap or
  // a misplaced element fails where a comparison of name sets would not.
  function outline(doc) {
    const rows = [];
    const stack = [[doc.documentElement, 0]];
    while (stack.length) {
      const [element, depth] = stack.pop();
      rows.push(`${depth} ${element.namespaceURI} ${element.nodeName}`);
      for (const child of [...element.children].reverse()) stack.push([child, depth + 1]);
    }
    return rows;
  }

  function firstDifference(produced, expected) {
    const length = Math.max(produced.length, expected.length);
    let difference = null;
    for (let i = 0; i < length && !difference; i++) {
      if (produced[i] !== expected[i]) difference = `element ${i}: got ${produced[i]}, want ${expected[i]}`;
    }
    return difference;
  }

  // A document in one dialect holding every element of a release once, under
  // its root. Not valid ONIX — the conversion does not care, and validity
  // could not hold every element in one document anyway.
  function everyElement(window, release, dialect, names) {
    const root = dialect === "short" ? "ONIXmessage" : "ONIXMessage";
    const children = names.filter((name) => name !== root).map((name) => `<${name}>x</${name}>`).join("\n  ");
    const xml = `<${root} release="${release}" xmlns="${namespace(release, dialect)}">\n  ${children}\n</${root}>`;
    return parse(window, xml);
  }

  for (const release of RELEASES) {
    test(`every short tag in the ${release} schema converts to its refname and back`, () => {
      const translate = render("onix-3.0-short.xml").OnixViewerOnix.translatedName;
      const wrong = [];
      for (const [shortTag, referenceName] of schemaPairs(release)) {
        const toReference = translate(shortTag, "reference");
        const toShort = translate(referenceName, "short");
        if (toReference !== referenceName) wrong.push(`${shortTag} → ${toReference}, want ${referenceName}`);
        if (toShort !== shortTag) wrong.push(`${referenceName} → ${toShort}, want ${shortTag}`);
      }
      assert(wrong.length === 0, `wrong translations: ${wrong.join("; ")}`);
    });

    test(`the ${release} schemas name the same elements in both dialects`, () => {
      const fromShort = new Set(schemaPairs(release).values());
      const fromReference = new Set(referenceNames(release));
      const noShortTag = [...fromReference].filter((name) => !fromShort.has(name));
      const noReference = [...fromShort].filter((name) => !fromReference.has(name));
      assert(noShortTag.length === 0, `reference elements with no short tag: ${noShortTag.join(", ")}`);
      assert(noReference.length === 0, `short tags naming no reference element: ${noReference.join(", ")}`);
    });

    test(`a document holding every ${release} element converts each one, in place, both ways`, () => {
      const w = render("onix-3.0-short.xml");
      const pairs = [...schemaPairs(release)];
      const reference = everyElement(w, release, "reference", pairs.map(([, referenceName]) => referenceName));
      const short = everyElement(w, release, "short", pairs.map(([shortTag]) => shortTag));
      assert(reference.documentElement.children.length === pairs.length - 1, "every element should be in the document");

      const toShort = w.OnixViewerOnix.translateNode(reference, "short");
      const toReference = w.OnixViewerOnix.translateNode(short, "reference");
      const shortDifference = firstDifference(outline(toShort), outline(short));
      const referenceDifference = firstDifference(outline(toReference), outline(reference));
      assert(!shortDifference, `reference → short: ${shortDifference}`);
      assert(!referenceDifference, `short → reference: ${referenceDifference}`);
      assert(serialize(w, toShort) === serialize(w, short), "reference → short should serialise to the short document");
      assert(serialize(w, toReference) === serialize(w, reference),
        "short → reference should serialise to the reference document");
    });
  }

  test("the sample record converts element for element into its other-dialect twin", () => {
    // Onix/ holds one record supplied in both dialects — an exact oracle.
    const w = render("onix-3.0-short.xml");
    const shortDoc = parse(w, fs.readFileSync(path.join(SAMPLES, "onix-3.1-shorttags.xml"), "utf8"));
    const referenceDoc = parse(w, fs.readFileSync(path.join(SAMPLES, "onix-3.1-refnames.xml"), "utf8"));
    const toReference = firstDifference(outline(w.OnixViewerOnix.translateNode(shortDoc, "reference")), outline(referenceDoc));
    const toShort = firstDifference(outline(w.OnixViewerOnix.translateNode(referenceDoc, "short")), outline(shortDoc));
    assert(!toReference, `short → reference: ${toReference}`);
    assert(!toShort, `reference → short: ${toShort}`);
  });

  test("a document that writes ONIX with a prefix converts and displays under that prefix", () => {
    const xml = '<onix:ONIXMessage release="3.1" xmlns:onix="http://ns.editeur.org/onix/3.1/reference">' +
      "<onix:Header><onix:SentDateTime>20260101</onix:SentDateTime></onix:Header></onix:ONIXMessage>";
    const w = renderSource(xml, "prefixed.xml");
    const converted = serialize(w, w.OnixViewerOnix.translateNode(parse(w, xml), "short"));
    assert(converted === '<onix:ONIXmessage release="3.1" xmlns:onix="http://ns.editeur.org/onix/3.1/short">' +
      "<onix:header><onix:x307>20260101</onix:x307></onix:header></onix:ONIXmessage>", `got: ${converted}`);
    w.document.querySelector('[data-action="dialect-toggle"]').click();
    const names = [...w.document.querySelectorAll("#oxv-root .px-tag-name")].map((span) => span.textContent);
    assert(names.includes("onix:x307") && !names.includes("onix:SentDateTime"), `on screen: ${names.join(" ")}`);
  });

  // Every ONIX document the suite holds, bar the Acknowledgements, which the
  // viewer does not convert (see 04-onix-acknowledgement-3-0).
  const documents = fs.readdirSync(FIXTURES).filter((f) => f.startsWith("onix-") && !f.includes("acknowledgement"))
    .map((f) => path.join(FIXTURES, f))
    .concat(fs.readdirSync(SAMPLES).filter((f) => f.endsWith(".xml")).map((f) => path.join(SAMPLES, f)));

  // A finding's place as child indexes, which mean the same in both dialects.
  function positionOf(node) {
    const steps = [];
    for (let n = node; n && n.nodeType !== 9; n = n.parentNode) {
      steps.unshift([...n.parentNode.childNodes].indexOf(n));
    }
    return steps.join("/");
  }

  function findingLines(result) {
    return result.findings.map((f) => `${f.severity} ${f.code} ${positionOf(f.at || f.node)}`);
  }

  for (const file of documents) {
    const name = path.basename(file);

    test(`${name} survives a round trip through the other dialect byte for byte`, () => {
      const source = fs.readFileSync(file, "utf8");
      const w = renderSource(source, name);
      const dialect = w.OnixViewerOnix.detect(parse(w, source)).dialect;
      const other = dialect === "short" ? "reference" : "short";
      const original = parse(w, source);
      const there = w.OnixViewerOnix.translateNode(original, other);
      const back = w.OnixViewerOnix.translateNode(parse(w, serialize(w, there)), dialect);
      assert(serialize(w, back) === serialize(w, original), "the round trip should change nothing");
    });

    test(`${name} gives the same findings in the other dialect`, () => {
      const source = fs.readFileSync(file, "utf8");
      const w = renderSource(source, name);
      const dialect = w.OnixViewerOnix.detect(parse(w, source)).dialect;
      const other = dialect === "short" ? "reference" : "short";
      const converted = serialize(w, w.OnixViewerOnix.translateNode(parse(w, source), other));
      const twin = renderSource(converted, name);
      const before = findingLines(findings(w));
      const after = findingLines(findings(twin));
      const gone = before.filter((line) => !after.includes(line));
      const added = after.filter((line) => !before.includes(line));
      assert(gone.length === 0 && added.length === 0,
        `findings differ in the other dialect — gone: ${gone.join("; ") || "none"}; added: ${added.join("; ") || "none"}`);
    });
  }
});

const fs = require("fs");
const path = require("path");
const {
  test, describe, assert, renderSource, findings, FIXTURES, SAMPLES,
} = require("../harness");

describe("Expected findings", () => {
  // Every ONIX fixture and sample has its findings written down, one line
  // each — severity, code, and the path of the node the finding is pinned
  // to — in tests/expected/. A finding that goes missing, moves, or appears
  // where none was before fails here, which is what the rule tests above
  // cannot promise: each proves its own rule fires, none that every other
  // rule still does. The two defect samples are the strongest of these —
  // 104 numbered violations and 32 second-order faults between them.
  //
  // When a change is meant to alter the findings, regenerate and read the
  // diff:   UPDATE_EXPECTED=1 npm test -- expected
  const EXPECTED = path.join(__dirname, "..", "expected");
  const documents = fs.readdirSync(FIXTURES).filter((f) => f.startsWith("onix-")).map((f) => path.join(FIXTURES, f))
    .concat(fs.readdirSync(SAMPLES).filter((f) => f.endsWith(".xml")).map((f) => path.join(SAMPLES, f)));

  function pathOf(node) {
    const steps = [];
    for (let n = node; n && n.nodeType !== 9; n = n.parentNode) {
      if (n.nodeType === 1) {
        const siblings = [...n.parentNode.childNodes].filter((s) => s.nodeType === 1 && s.nodeName === n.nodeName);
        steps.unshift(siblings.length > 1 ? `${n.nodeName}[${siblings.indexOf(n) + 1}]` : n.nodeName);
      } else {
        steps.unshift("text()");
      }
    }
    return "/" + steps.join("/");
  }

  function lines(result) {
    return result.findings.map((f) => `${f.severity} ${f.code} ${pathOf(f.at || f.node)}`);
  }

  for (const file of documents) {
    const name = path.basename(file, ".xml");
    test(`${name} reports exactly the findings on record`, () => {
      const expectedFile = path.join(EXPECTED, `${name}.findings`);
      const result = findings(renderSource(fs.readFileSync(file, "utf8"), path.basename(file)));
      assert(result.total === result.findings.length, "no document here should hit the findings cap");
      const actual = lines(result).map((l) => l + "\n").join("");
      if (process.env.UPDATE_EXPECTED) {
        fs.writeFileSync(expectedFile, actual);
        return;
      }
      assert(fs.existsSync(expectedFile), `no record for ${name}; run UPDATE_EXPECTED=1 npm test -- expected`);
      const expected = fs.readFileSync(expectedFile, "utf8");
      if (actual !== expected) {
        const was = expected.split("\n").filter(Boolean);
        const now = actual.split("\n").filter(Boolean);
        const gone = was.filter((l) => !now.includes(l));
        const added = now.filter((l) => !was.includes(l));
        assert(false, `findings changed for ${name} — ${was.length} on record, ${now.length} now` +
          (gone.length ? `\n    gone:  ${gone.join("\n           ")}` : "") +
          (added.length ? `\n    added: ${added.join("\n           ")}` : "") +
          "\n    if intended: UPDATE_EXPECTED=1 npm test -- expected, and read the diff");
      }
    });
  }
});

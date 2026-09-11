const fs = require("fs");
const path = require("path");
const {
  test, describe, assert, ROOT, FIXTURES,
} = require("../harness");

describe("Documentation", () => {
  // CLAUDE.md's fixture table is kept by hand, and a fixture that is not in it
  // is one nobody will know the purpose of. Both directions are held: every
  // file has a row, every row has a file.
  test("every fixture is in CLAUDE.md's fixture table, and every row has a file", () => {
    const notes = fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");
    const rows = [...notes.matchAll(/^\| `([a-z0-9.-]+\.xml)` \|/gm)].map((m) => m[1]);
    const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".xml"));
    const undocumented = files.filter((f) => !rows.includes(f));
    const missing = rows.filter((f) => !files.includes(f));
    assert(undocumented.length === 0, `fixtures with no row in CLAUDE.md: ${undocumented.join(", ")}`);
    assert(missing.length === 0, `rows in CLAUDE.md with no fixture: ${missing.join(", ")}`);
  });
});

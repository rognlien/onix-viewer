// tests/run.js — runs every case in tests/cases/ and prints the summary.
//
//   npm test                 # everything
//   npm test -- x512         # only tests whose name or block matches
//
// The harness (jsdom setup, the test/describe/assert trio, the render helpers)
// is tests/harness.js; the cases are one file per area, run in name order.

const fs = require("fs");
const path = require("path");
const harness = require("./harness");

const CASES = path.join(__dirname, "cases");
for (const file of fs.readdirSync(CASES).filter((f) => f.endsWith(".test.js")).sort()) {
  require(path.join(CASES, file));
}

harness.summary();

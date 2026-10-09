// tests/run.js — runs every case in tests/cases/ and prints the summary.
//
//   npm test                 # everything
//   npm test -- x512         # only tests whose name or block matches
//
// The harness (jsdom setup, the test/describe/assert trio, the render helpers)
// is tests/harness.js; the cases are one file per area, printed in name order.
//
// Each file runs in a worker thread of its own. jsdom gives every window a vm
// context, and Node keeps a context alive after its window is closed, so one
// process running the whole suite grew to node's 4 GB heap limit and died.
// A worker's contexts end with the worker. The workers run side by side, a
// few at a time, and each hands back its output whole, printed in file order.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");

const CASES = path.join(__dirname, "cases");
const FILTER = process.argv[2] || "";
const WORKERS = Math.max(1, Math.min(os.availableParallelism ? os.availableParallelism() : os.cpus().length, 8));

function runFile(file) {
  return new Promise((resolve) => {
    let results = null;
    const worker = new Worker(path.join(__dirname, "run-case.js"), { workerData: { file, filter: FILTER } });
    worker.on("message", (message) => { results = message; });
    worker.on("error", (err) => {
      results = { passed: 0, failed: 1, skipped: 0, output: [], failures: [{ name: path.basename(file), message: err.stack || err.message }] };
    });
    worker.on("exit", () => resolve(results));
  });
}

async function runAll(files) {
  const results = new Array(files.length);
  let next = 0;
  let printed = 0;
  async function lane() {
    while (next < files.length) {
      const index = next++;
      results[index] = await runFile(files[index]);
      while (printed < files.length && results[printed]) {
        for (const line of results[printed].output) console.log(line);
        printed++;
      }
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, lane));
  return results;
}

function summary(results) {
  const total = (key) => results.reduce((sum, result) => sum + result[key], 0);
  const passed = total("passed");
  const failed = total("failed");
  const filterNote = FILTER ? `, ${total("skipped")} skipped by filter "${FILTER.toLowerCase()}"` : "";
  console.log(`\n${passed} passed, ${failed} failed${filterNote}`);
  let code = 0;
  if (FILTER && passed + failed === 0) {
    console.log(`No test matched "${FILTER.toLowerCase()}".`);
    code = 1;
  }
  if (failed > 0) {
    console.log("\nFailures:");
    for (const result of results) for (const f of result.failures) console.log(`  - ${f.name}: ${f.message}`);
    code = 1;
  }
  process.exitCode = code;
}

const files = fs.readdirSync(CASES).filter((f) => f.endsWith(".test.js")).sort().map((f) => path.join(CASES, f));
runAll(files).then(summary);

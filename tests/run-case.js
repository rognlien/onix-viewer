// tests/run-case.js — the worker tests/run.js starts for one case file: it
// runs the file's tests and posts what they did back.

const { parentPort, workerData } = require("worker_threads");
const harness = require("./harness");

require(workerData.file);
harness.settled().then(() => parentPort.postMessage(harness.results()));

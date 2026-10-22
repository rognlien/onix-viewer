#!/usr/bin/env node
// tools/build-standalone.js
//
// Builds dist/standalone/onix-viewer-standalone.js: the viewer as one script
// a plain web page can load. It defines window.OnixViewerStandalone, whose
// open(xml) renders ONIX text into the page (see README.md).
//
// The sources are embedded verbatim, each in a function the bundle calls in a
// fixed order. The order is load-bearing: onix.js reads the code lists when
// it runs, so the data files come first. viewer.js is wrapped but called only
// when open() runs. standalone/runtime.js is a factory; the bundle calls it
// with { start, css }, the wrapped viewer and its stylesheet, so the runtime
// names what it depends on instead of reading names declared around it.
//
// Same inputs, same bytes: no timestamps, no machine paths. The header names
// the checkout the bundle came from, with +dirty when an input has changed.
//
// Usage:
//   node tools/build-standalone.js
//
// The tests require this file and call bundle(), which returns the script as
// a string and writes nothing.

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "dist", "standalone", "onix-viewer-standalone.js");

const RUN_NOW = [
  "Resources/shell.js", "Resources/onix-codelists.js", "Resources/onix-thema.js",
  "Resources/onix.js", "Resources/onix-popup.js",
];
const DEFERRED = "Resources/viewer.js";
const CSS = "Resources/viewer.css";
const RUNTIME = "standalone/runtime.js";
const INPUTS = [...RUN_NOW, DEFERRED, CSS, RUNTIME, "LICENSE"];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

// git@host:owner/repo.git and https://host/owner/repo.git name the same
// repository; the header gives the second form, without credentials.
function repositoryURL(remote) {
  const scp = remote.match(/^[^/@:\s]+@([^/:\s]+):(\S+)$/);
  const url = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : remote);
  return `https://${url.host}${url.pathname.replace(/\.git$/, "")}`;
}

function source() {
  const dirty = git("status", "--porcelain", "--", ...INPUTS) !== "";
  return `${repositoryURL(git("remote", "get-url", "origin"))}@${git("rev-parse", "HEAD")}${dirty ? "+dirty" : ""}`;
}

function header() {
  const license = read("LICENSE").trimEnd();
  if (license.includes("*/")) throw new Error("LICENSE cannot sit in a block comment");
  const notice = license.split("\n").map((line) => ` * ${line}`.trimEnd()).join("\n");
  return `/*\n * ONIX Viewer, standalone build. Upstream notice:\n *\n${notice}\n *\n * Source: ${source()}\n */`;
}

function bundle() {
  const wrap = (file) => `/* ${file} */\nfunction () {\n${read(file)}\n}`;
  return [
    header(),
    "(function () {",
    "var runNow = [",
    RUN_NOW.map(wrap).join(",\n"),
    "];",
    `var start = ${wrap(DEFERRED)};`,
    `var css = ${JSON.stringify(read(CSS))};`,
    "runNow.forEach(function (run) { run(); });",
    read(RUNTIME),
    "window.OnixViewerStandalone = createStandalone({ start: start, css: css });",
    "})();",
    "",
  ].join("\n");
}

if (require.main === module) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, bundle());
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}

module.exports = { bundle };

// tools/build-standalone.js: that the bundle is the same bytes every time,
// that it builds from anywhere, and what its header says. The checks that
// need a git history of their own run in a copy of the inputs in a temp
// directory, so the real tree is never dirtied.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { test, describe, assert, ROOT } = require("../harness");
const { bundle } = require("../../tools/build-standalone");

const COPIED = ["Resources", "standalone", "tools/build-standalone.js", "LICENSE"];

// A git repository holding a copy of the builder and its inputs, committed,
// with `remote` as origin.
function copyOfTheInputs(remote) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oxv-build-"));
  for (const entry of COPIED) {
    fs.mkdirSync(path.dirname(path.join(dir, entry)), { recursive: true });
    fs.cpSync(path.join(ROOT, entry), path.join(dir, entry), { recursive: true });
  }
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
    { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("remote", "add", "origin", remote);
  git("add", "-A");
  git("commit", "-q", "-m", "inputs");
  return dir;
}

const headerOf = (text) => text.slice(0, text.indexOf("*/"));
const sourceLine = (text) => /^ \* Source: (.*)$/m.exec(headerOf(text))[1];

describe("Standalone build", () => {
  test("two builds are byte-identical", () => {
    assert(bundle() === bundle(), "same inputs, same bytes");
  });

  test("the bundle passes node --check", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oxv-check-"));
    try {
      const file = path.join(dir, "bundle.js");
      fs.writeFileSync(file, bundle());
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the header carries the MIT notice, the repository and the commit", () => {
    const text = bundle();
    const header = headerOf(text);
    assert(text.startsWith("/*"), "the bundle opens with its header");
    assert(header.includes("Permission is hereby granted, free of charge"), "the MIT notice");
    assert(header.includes("Copyright (c) 2026 Bendik Rognlien Johansen"), "the copyright line");
    assert(/^https:\/\/\S+\/\S+@[0-9a-f]{40}(\+dirty)?$/.test(sourceLine(text)),
      `Source: <https url>@<40-hex sha>; got "${sourceLine(text)}"`);
    assert(!text.includes(ROOT), "no machine path anywhere in the bundle");
  });

  test("an ssh remote is named by its https address", () => {
    const dir = copyOfTheInputs("git@github.com:owner/repo.git");
    try {
      const built = execFileSync(process.execPath, [path.join(dir, "tools/build-standalone.js")],
        { cwd: os.tmpdir(), encoding: "utf8" });
      assert(built.includes("onix-viewer-standalone.js"), "it reports the file it wrote");
      const text = fs.readFileSync(path.join(dir, "dist/standalone/onix-viewer-standalone.js"), "utf8");
      assert(/^https:\/\/github\.com\/owner\/repo@[0-9a-f]{40}$/.test(sourceLine(text)),
        `got "${sourceLine(text)}"`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("building from another working directory writes the same bundle", () => {
    const dir = copyOfTheInputs("https://example.com/owner/repo.git");
    try {
      const [first, second] = [os.tmpdir(), dir].map((cwd) => {
        execFileSync(process.execPath, [path.join(dir, "tools/build-standalone.js")], { cwd, stdio: "pipe" });
        return fs.readFileSync(path.join(dir, "dist/standalone/onix-viewer-standalone.js"), "utf8");
      });
      assert(first === second, "the cwd does not change the bytes");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an input that differs from HEAD marks the header +dirty", () => {
    const dir = copyOfTheInputs("https://example.com/owner/repo.git");
    const build = () => execFileSync(process.execPath, ["-e",
      `process.stdout.write(require(${JSON.stringify(path.join(dir, "tools/build-standalone.js"))}).bundle())`],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    try {
      assert(!sourceLine(build()).endsWith("+dirty"), "a clean copy is not dirty");
      fs.writeFileSync(path.join(dir, "notes.txt"), "not an input");
      assert(!sourceLine(build()).endsWith("+dirty"), "a file the bundle does not read does not count");
      fs.appendFileSync(path.join(dir, "Resources/viewer.css"), "\n/* changed */\n");
      assert(sourceLine(build()).endsWith("+dirty"), "a modified input does");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

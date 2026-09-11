#!/usr/bin/env node
// tools/check-icons.js — Verify the shipped icons match their sources.
//
// This deliberately does NOT re-render. render-icons.sh needs rsvg-convert,
// whose output is not guaranteed byte-stable between versions, so a
// "re-render and diff" check would fail on the renderer's version rather than
// on a real problem. Every check here is a byte comparison or a PNG header
// read, so it is deterministic and needs no image tooling.
//
// What it catches:
//   * a hand-drawn icons/icon-<size>.png that was updated without re-running
//     render-icons.sh, so Resources/icons/ still holds the old render — this
//     shipped a stale 32px icon once
//   * a shipped icon whose pixel size doesn't match its name
//   * an icon the manifest declares but that isn't there
//
// It also reports which manifest sizes are still downscales of the master, so
// the hand-drawn set can be completed one size at a time.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, "icons");
const MANIFEST = path.join(ROOT, "Resources", "manifest.json");

function pngHeader(file) {
  const data = fs.readFileSync(file);
  if (data.length < 24 || data.toString("latin1", 1, 4) !== "PNG") return null;
  let pos = 8;
  let header = null;
  let transparency = false;
  while (pos + 8 <= data.length) {
    const length = data.readUInt32BE(pos);
    const type = data.toString("latin1", pos + 4, pos + 8);
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(pos + 8),
        height: data.readUInt32BE(pos + 12),
        colourType: data[pos + 8 + 9],
      };
    }
    if (type === "tRNS") transparency = true;
    pos += 12 + length;
  }
  if (header) header.alpha = header.colourType === 4 || header.colourType === 6 || transparency;
  return header;
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const sizes = Object.keys(manifest.icons).map(Number).sort((a, b) => a - b);
  const problems = [];
  const handDrawn = [];
  const fromMaster = [];

  for (const size of sizes) {
    const declared = manifest.icons[String(size)];
    const shipped = path.join(ROOT, "Resources", declared);
    if (!fs.existsSync(shipped)) {
      problems.push(`Resources/${declared} is declared in the manifest but missing`);
      continue;
    }

    const header = pngHeader(shipped);
    if (!header) {
      problems.push(`Resources/${declared} is not a readable PNG`);
      continue;
    }
    if (header.width !== size || header.height !== size) {
      problems.push(`Resources/${declared} is ${header.width}x${header.height}, ` +
        `expected ${size}x${size}`);
    }
    if (!header.alpha) {
      problems.push(`Resources/${declared} has no alpha channel — it will show as ` +
        `a pale tile on a dark ground`);
    }

    const source = path.join(SOURCE_DIR, `icon-${size}.png`);
    if (!fs.existsSync(source)) {
      fromMaster.push(size);
      continue;
    }
    const sourceHeader = pngHeader(source);
    if (!sourceHeader || !sourceHeader.alpha) {
      // render-icons.sh refuses an opaque custom and renders the master, so
      // this is a source problem to report rather than a drift failure.
      problems.push(`icons/icon-${size}.png has no alpha channel, so it is being ignored ` +
        `— re-export it as RGBA`);
      fromMaster.push(size);
      continue;
    }
    handDrawn.push(size);
    if (!fs.readFileSync(source).equals(fs.readFileSync(shipped))) {
      problems.push(`icons/icon-${size}.png differs from the shipped ` +
        `Resources/${declared} — run tools/render-icons.sh and commit the result`);
    }
  }

  const master = path.join(SOURCE_DIR, "icon-original.png");
  if (!fs.existsSync(master)) problems.push("icons/icon-original.png (the master) is missing");

  console.log(`hand-drawn sizes in use: ${handDrawn.length ? handDrawn.join(", ") : "none"}`);
  console.log(`rendered from the master: ${fromMaster.length ? fromMaster.join(", ") : "none"}`);
  if (problems.length) {
    console.error("\nProblems:");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("\nAll shipped icons match their sources.");
  }
}

main();

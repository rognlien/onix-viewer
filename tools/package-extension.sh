#!/usr/bin/env bash
# tools/package-extension.sh — Build the Chrome Web Store upload zip.
#
# CWS expects the manifest at the zip ROOT (not nested in a folder), so we
# `cd Resources/` and zip from there. The output goes to dist/onix-viewer-<version>.zip.

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(grep -oE '"version"\s*:\s*"[^"]+"' Resources/manifest.json | grep -oE '[0-9]+(\.[0-9]+)*')
OUT_DIR="dist"
OUT="$OUT_DIR/onix-viewer-${VERSION}.zip"

mkdir -p "$OUT_DIR"
rm -f "$OUT"

cd Resources
# Exclude .DS_Store and any editor cruft. Include hidden files explicitly so
# we know what's bundled.
zip -r "../$OUT" . -x ".DS_Store" -x "**/.DS_Store"

cd ..
echo
echo "Wrote $OUT"
ls -lh "$OUT" | awk '{print "  size: " $5}'
echo "  contents:"
unzip -l "$OUT" | awk 'NR>3 && $4 != "" {print "    " $4}' | sort | head -20
total=$(unzip -l "$OUT" | tail -1 | awk '{print $2}')
echo "  total uncompressed: $total bytes"

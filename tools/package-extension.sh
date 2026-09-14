#!/usr/bin/env bash
# tools/package-extension.sh — Build the Chrome Web Store upload zip.
#
# CWS expects the manifest at the zip ROOT (not nested in a folder), so we
# zip from inside a copy of Resources/. The output goes to
# dist/onix-viewer-<version>.zip.
#
# The copy exists for one edit: the committed manifest carries
# "version_name": "X.Y.Z-dev", which is what chrome://extensions and the
# About window show for an unpacked load. The store build must not say -dev,
# so the field is dropped here — and nowhere else, so the checkout keeps it.

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./Resources/manifest.json').version")
OUT_DIR="dist"
OUT="$OUT_DIR/onix-viewer-${VERSION}.zip"
STAGE="$OUT_DIR/package"

mkdir -p "$OUT_DIR"
rm -f "$OUT"
rm -rf "$STAGE"
mkdir -p "$STAGE"

# Everything shipped, minus .DS_Store and editor cruft.
cp -R Resources/. "$STAGE"
find "$STAGE" -name .DS_Store -delete

node -e "
  const fs = require('fs');
  const path = '$STAGE/manifest.json';
  const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));
  delete manifest.version_name;
  fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
"

(cd "$STAGE" && zip -r "../../$OUT" . -x ".DS_Store" -x "**/.DS_Store")
rm -rf "$STAGE"

if unzip -p "$OUT" manifest.json | grep -q version_name; then
  echo "version_name survived into $OUT — the store build must not say -dev" >&2
  exit 1
fi

echo
echo "Wrote $OUT"
ls -lh "$OUT" | awk '{print "  size: " $5}'
echo "  contents:"
unzip -l "$OUT" | awk 'NR>3 && $4 != "" {print "    " $4}' | sort | head -20
total=$(unzip -l "$OUT" | tail -1 | awk '{print $1}')
echo "  total uncompressed: $total bytes"

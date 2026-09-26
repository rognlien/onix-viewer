#!/usr/bin/env bash
# tools/package-extension.sh — Build the store upload zip.
#
#   tools/package-extension.sh                  # Chrome Web Store
#   tools/package-extension.sh --target=firefox # addons.mozilla.org
#
# Both stores expect the manifest at the zip ROOT (not nested in a folder),
# so we zip from inside a copy of Resources/. The output goes to
# dist/onix-viewer-<version>.zip for Chrome and
# dist/onix-viewer-<version>-firefox.zip for Firefox.
#
# The copy exists for the manifest edits. The committed manifest carries
# "version_name": "X.Y.Z-dev", which is what chrome://extensions and the
# About window show for an unpacked load; a store build must not say -dev,
# so the field is dropped here — and nowhere else, so the checkout keeps it.
# It also carries both browsers' own keys, so that one directory loads
# unpacked in either; each store build keeps only its own, so neither
# browser warns about the other's.

set -euo pipefail

cd "$(dirname "$0")/.."

TARGET="chrome"
for arg in "$@"; do
  case "$arg" in
    --target=chrome|--target=firefox) TARGET="${arg#--target=}" ;;
    *) echo "usage: $0 [--target=chrome|--target=firefox]" >&2; exit 2 ;;
  esac
done

VERSION=$(node -p "require('./Resources/manifest.json').version")
OUT_DIR="dist"
SUFFIX=""
[ "$TARGET" = "firefox" ] && SUFFIX="-firefox"
OUT="$OUT_DIR/onix-viewer-${VERSION}${SUFFIX}.zip"
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
  if ('$TARGET' === 'chrome') delete manifest.browser_specific_settings;
  if ('$TARGET' === 'firefox') delete manifest.minimum_chrome_version;
  fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
"

(cd "$STAGE" && zip -r "../../$OUT" . -x ".DS_Store" -x "**/.DS_Store")
rm -rf "$STAGE"

OTHER="browser_specific_settings"
[ "$TARGET" = "firefox" ] && OTHER="minimum_chrome_version"
for key in version_name "$OTHER"; do
  if unzip -p "$OUT" manifest.json | grep -q "\"$key\""; then
    echo "$key survived into $OUT — the $TARGET build must not carry it" >&2
    exit 1
  fi
done

echo
echo "Wrote $OUT"
ls -lh "$OUT" | awk '{print "  size: " $5}'
echo "  contents:"
unzip -l "$OUT" | awk 'NR>3 && $4 != "" {print "    " $4}' | sort | head -20
total=$(unzip -l "$OUT" | tail -1 | awk '{print $1}')
echo "  total uncompressed: $total bytes"

#!/usr/bin/env bash
# tools/render-icons.sh — Render icon.svg into the PNG sizes Chrome expects.
#
# Source-of-truth is icon.svg at repo root. Chrome doesn't accept SVG icons
# in the manifest, so we bake out PNGs for each size the manifest references.
#
# Requires: rsvg-convert (`brew install librsvg`).

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v rsvg-convert >/dev/null; then
  echo "rsvg-convert not found. Install with: brew install librsvg" >&2
  exit 1
fi

SRC="icon.svg"
OUT_DIR="Resources/icons"

if [ ! -f "$SRC" ]; then
  echo "Missing $SRC at repo root." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

for size in 16 32 48 96 128 256 512; do
  rsvg-convert -w "$size" -h "$size" "$SRC" -o "$OUT_DIR/icon-${size}.png"
  echo "  wrote $OUT_DIR/icon-${size}.png"
done

echo
echo "Don't forget to repackage: tools/package-extension.sh"

#!/usr/bin/env bash
# tools/render-icons.sh — Render the extension's icon PNGs at every size
# Chrome may need, from a single source image.
#
# Source-of-truth is icons/image.png (a 1024×1024 RGBA source).
# The source image already has visual padding baked into the canvas
# (transparent space around the artwork), so we render it edge-to-edge
# here instead of adding more padding on top. Adding the Google-spec
# 16-px padding made the icon visibly smaller than other extensions
# in chrome://extensions, because their full canvas IS the artwork.
#
# Requires: rsvg-convert (`brew install librsvg`).

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v rsvg-convert >/dev/null; then
  echo "rsvg-convert not found. Install with: brew install librsvg" >&2
  exit 1
fi

SRC="icons/image.png"
OUT_DIR="Resources/icons"

if [ ! -f "$SRC" ]; then
  echo "Missing $SRC." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# Per-size SVG wrapper lives next to image.png so rsvg-convert resolves
# the relative href (it looks in the SVG's directory by default).
TMP_SVG="icons/.icon-render.svg"
trap 'rm -f "$TMP_SVG"' EXIT

# image.png is pre-cropped (720×720) so the artwork sits edge-to-edge in
# the source canvas — render straight without padding so it fills the
# target size completely. The 1024×1024 original is kept as
# image-original.png in case we ever want a looser version.
for size in 16 32 48 96 128 256 512; do
  cat > "$TMP_SVG" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" width="$size" height="$size" viewBox="0 0 $size $size">
  <image href="image.png" x="0" y="0" width="$size" height="$size"/>
</svg>
EOF
  rsvg-convert -w "$size" -h "$size" "$TMP_SVG" -o "$OUT_DIR/icon-${size}.png"
  echo "  wrote $OUT_DIR/icon-${size}.png"
done

echo
echo "Don't forget to repackage: tools/package-extension.sh"

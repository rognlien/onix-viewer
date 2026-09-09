#!/usr/bin/env bash
# tools/render-icons.sh — Render the extension's icon PNGs at every size
# Chrome may need.
#
# Source-of-truth is icons/icon-original.png (1254×1254 RGBA).
# The source has the artwork edge-to-edge with transparent corners, so it is
# rendered without padding. Adding the Google-spec 16-px margin made the icon
# visibly smaller than other extensions in chrome://extensions, because their
# full canvas IS the artwork.
#
# HAND-DRAWN SIZES WIN. A downscale of a detailed mark loses definition at 16
# and 32 px, so a custom icons/icon-<size>.png is used verbatim when one exists
# rather than re-rendered from the master. The one requirement is an alpha
# channel: an opaque custom shows as a pale tile wherever Chrome puts the icon
# on a dark ground, so one without alpha is refused and the master is rendered
# instead — loudly, not silently.
#
# Requires: rsvg-convert (`brew install librsvg`) and node.

set -euo pipefail

cd "$(dirname "$0")/.."

for tool in rsvg-convert node; do
  if ! command -v "$tool" >/dev/null; then
    echo "$tool not found." >&2
    exit 1
  fi
done

SRC="icons/icon-original.png"
OUT_DIR="Resources/icons"
SIZES="16 32 48 96 128 256 512"

if [ ! -f "$SRC" ]; then
  echo "Missing $SRC." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# True when the PNG carries transparency: colour type 4 or 6, or a tRNS chunk.
has_alpha() {
  node -e '
    const fs = require("fs");
    const d = fs.readFileSync(process.argv[1]);
    let pos = 8, colour = null, trns = false;
    while (pos < d.length) {
      const len = d.readUInt32BE(pos);
      const type = d.toString("latin1", pos + 4, pos + 8);
      if (type === "IHDR") colour = d[pos + 8 + 9];
      if (type === "tRNS") trns = true;
      pos += 12 + len;
    }
    process.exit(colour === 4 || colour === 6 || trns ? 0 : 1);
  ' "$1"
}

TMP_SVG="icons/.icon-render.svg"
trap 'rm -f "$TMP_SVG"' EXIT

render_from_master() {
  local size="$1"
  cat > "$TMP_SVG" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" width="$size" height="$size" viewBox="0 0 $size $size">
  <image href="$(basename "$SRC")" x="0" y="0" width="$size" height="$size"/>
</svg>
EOF
  rsvg-convert -w "$size" -h "$size" "$TMP_SVG" -o "$OUT_DIR/icon-${size}.png"
}

refused=0
for size in $SIZES; do
  custom="icons/icon-${size}.png"
  if [ -f "$custom" ]; then
    if has_alpha "$custom"; then
      cp "$custom" "$OUT_DIR/icon-${size}.png"
      echo "  icon-${size}.png   <- custom (hand-drawn)"
      continue
    fi
    echo "  icon-${size}.png   <- master  (custom REFUSED: $custom has no alpha channel)" >&2
    refused=$((refused + 1))
  else
    echo "  icon-${size}.png   <- master"
  fi
  render_from_master "$size"
done

if [ "$refused" -gt 0 ]; then
  echo
  echo "$refused custom size(s) were skipped for having no transparency." >&2
  echo "Re-export them as RGBA and re-run to use them." >&2
fi

echo
echo "Don't forget to repackage: tools/package-extension.sh"

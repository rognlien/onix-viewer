#!/usr/bin/env bash
# tools/render-tiles.sh — the Chrome Web Store's promo tiles, from the SVGs in
# chrome/ into dist/chrome/. Both embed the icon master, so they are stale the
# moment it changes: npm run icons calls this, and so does the Chrome package.
# Needs rsvg-convert (brew install librsvg); without it the tiles are skipped
# with a note, since CI's runners have no librsvg and the zip does not need
# them.

set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-dist/chrome}"
mkdir -p "$OUT"
if ! command -v rsvg-convert >/dev/null; then
  echo "  (promo tiles skipped: rsvg-convert not installed)"
  exit 0
fi
rsvg-convert -w 440  -h 280 chrome/promo-tile.svg -o "$OUT/promo-tile-440x280.png"
rsvg-convert -w 1400 -h 560 chrome/marquee.svg    -o "$OUT/marquee-1400x560.png"
echo "  $OUT/  <- promo-tile-440x280.png, marquee-1400x560.png"

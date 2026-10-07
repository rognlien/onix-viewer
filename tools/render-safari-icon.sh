#!/usr/bin/env bash
# tools/render-safari-icon.sh — Rebuild icons/safari-app-icon.png, the Mac app's
# icon: the owl on an opaque teal square. The transparent owl that the
# extension uses everywhere else gets a gray plate from macOS when it is an
# app icon, so the app gets artwork that fills its own square. macOS rounds
# the corners itself; do not pre-round them. Requires ImageMagick.
set -euo pipefail
cd "$(dirname "$0")/.."
convert -size 1024x1024 radial-gradient:'#4fa3aa-#1b4a52' \
  \( icons/icon-original.png -resize 760x760 \) \
  -gravity center -geometry +0+10 -composite \
  -alpha off -depth 8 icons/safari-app-icon.png

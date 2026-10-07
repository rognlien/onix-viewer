#!/usr/bin/env bash
# tools/render-safari-icon.sh — Render icons/safari-app-icon.png, the Mac app's
# icon, from icons/safari-app-icon.svg: the owl on an opaque teal square. The
# transparent owl the extension uses elsewhere gets a gray plate from macOS
# when it is an app icon. macOS rounds the corners itself; do not pre-round
# them. Requires rsvg-convert.
set -euo pipefail
cd "$(dirname "$0")/.."
rsvg-convert -w 1024 -h 1024 icons/safari-app-icon.svg -o icons/safari-app-icon.png

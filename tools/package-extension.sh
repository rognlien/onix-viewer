#!/usr/bin/env bash
# tools/package-extension.sh — Build the store upload zip.
#
#   tools/package-extension.sh                  # Chrome Web Store
#   tools/package-extension.sh --target=firefox # addons.mozilla.org
#   tools/package-extension.sh --target=safari  # an Xcode project, for the App Store
#
# Both stores expect the manifest at the zip ROOT (not nested in a folder),
# so we zip from inside a copy of Resources/. The output goes to
# dist/onix-viewer-<version>.zip for Chrome and
# dist/onix-viewer-<version>-firefox.zip for Firefox. Safari takes no zip:
# the copy is kept as dist/onix-viewer-<version>-safari/ (Safari's
# Settings → Developer → "Add Temporary Extension…" loads that folder) and
# Apple's converter wraps it in the Xcode project at dist/safari/, which is
# what gets built, signed and submitted — see SAFARI.md.
#
# The copy exists for the manifest edits. The committed manifest carries
# "version_name": "X.Y.Z-dev", which is what chrome://extensions and the
# About window show for an unpacked load; a store build must not say -dev,
# so the field is dropped here — and nowhere else, so the checkout keeps it.
# It also carries the browsers' own keys, so that one directory loads
# unpacked in any of them; each store build keeps only its own, so no
# browser warns about another's.

set -euo pipefail

cd "$(dirname "$0")/.."

TARGET="chrome"
for arg in "$@"; do
  case "$arg" in
    --target=chrome|--target=firefox|--target=safari) TARGET="${arg#--target=}" ;;
    *) echo "usage: $0 [--target=chrome|--target=firefox|--target=safari]" >&2; exit 2 ;;
  esac
done

VERSION=$(node -p "require('./Resources/manifest.json').version")
OUT_DIR="dist"
SUFFIX=""
[ "$TARGET" = "chrome" ] || SUFFIX="-$TARGET"
OUT="$OUT_DIR/onix-viewer-${VERSION}${SUFFIX}.zip"
STAGE="$OUT_DIR/package"
[ "$TARGET" = "safari" ] && STAGE="$OUT_DIR/onix-viewer-${VERSION}-safari"

mkdir -p "$OUT_DIR"
rm -f "$OUT"
rm -rf "$STAGE"
mkdir -p "$STAGE"

# Everything shipped, minus .DS_Store and editor cruft.
cp -R Resources/. "$STAGE"
find "$STAGE" -name .DS_Store -delete

# The manifest each store gets — one module, so the suite can run it for
# every target against the real manifest (tests/cases/37-store-manifests).
node tools/prune-manifest.js "$TARGET" "$STAGE/manifest.json"

if [ "$TARGET" = "safari" ]; then
  # Apple's converter wraps the folder in an app + extension Xcode project.
  # --copy-resources makes the project self-contained (it otherwise
  # references the files by absolute path, which is no good to commit or
  # to move). The generated project is build output, like the zips.
  PROJECT="$OUT_DIR/safari"
  rm -rf "$PROJECT"
  xcrun safari-web-extension-converter "$STAGE" \
    --project-location "$PROJECT" \
    --app-name "ONIX Viewer" \
    --bundle-identifier io.maendeleo.ONIX-Viewer \
    --macos-only --swift --copy-resources --no-open --no-prompt --force
  # The converter pins the deployment target to the SDK it ran on; the
  # manifest's floor is Safari 18, which shipped with macOS 15. It also
  # starts the app at version 1.0; the app's version follows the manifest's.
  # The signing team is yours, not the repo's: APPLE_TEAM_ID in the
  # environment writes it into every target, so a regenerated project is
  # ready to archive without a visit to Xcode's Signing pane.
  # App Store Connect also refuses an app without LSApplicationCategoryType,
  # which the converter does not write; the app target's generated
  # Info.plist gets it, a copyright line, and the export-compliance answer
  # (no encryption of its own) that TestFlight otherwise asks for on every
  # build.
  PBXPROJ="$PROJECT/ONIX Viewer/ONIX Viewer.xcodeproj/project.pbxproj"
  sed -i '' -E "s/MACOSX_DEPLOYMENT_TARGET = [0-9.]+;/MACOSX_DEPLOYMENT_TARGET = 15.0;/; s/MARKETING_VERSION = [0-9.]+;/MARKETING_VERSION = $VERSION;/" "$PBXPROJ"
  sed -i '' -E "s/INFOPLIST_KEY_NSMainStoryboardFile = Main;/INFOPLIST_KEY_NSMainStoryboardFile = Main;\\
				INFOPLIST_KEY_LSApplicationCategoryType = \"public.app-category.developer-tools\";\\
				INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO;/; s/INFOPLIST_KEY_NSHumanReadableCopyright = \"\";/INFOPLIST_KEY_NSHumanReadableCopyright = \"© 2026 Bendik Rognlien Johansen\";/" "$PBXPROJ"
  if [ -n "${APPLE_TEAM_ID:-}" ]; then
    sed -i '' -E "s/CODE_SIGN_STYLE = Automatic;/CODE_SIGN_STYLE = Automatic;\\
				DEVELOPMENT_TEAM = $APPLE_TEAM_ID;/" "$PBXPROJ"
  fi
  for key in version_name minimum_chrome_version gecko; do
    if grep -q "\"$key\"" "$STAGE/manifest.json"; then
      echo "$key survived into $STAGE/manifest.json — the safari build must not carry it" >&2
      exit 1
    fi
  done
  echo
  echo "Wrote $STAGE (load it with Safari → Settings → Developer → Add Temporary Extension…)"
  echo "Wrote $PROJECT/ONIX Viewer/ONIX Viewer.xcodeproj (open in Xcode to build, sign and archive)"
  exit 0
fi

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

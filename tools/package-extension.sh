#!/usr/bin/env bash
# tools/package-extension.sh — Build the store upload zip, or a dev build.
#
#   tools/package-extension.sh                  # Chrome Web Store
#   tools/package-extension.sh --target=firefox # addons.mozilla.org
#   tools/package-extension.sh --target=safari  # an Xcode project, for the App Store
#   tools/package-extension.sh --dev [--target=…]   # the same, for a local install
#
# A --dev build is the store build with the manifest's version_name kept, so
# About and the extensions page say "X.Y.Z-dev" as an unpacked load does,
# and it never passes for the store's; the version itself is not bumped.
# It lands in dist/dev/ under names with no version in them, since it is
# overwritten and never uploaded: onix-viewer-chrome.zip,
# onix-viewer-firefox.zip, onix-viewer-safari/ and the Xcode project in
# dist/dev/safari/. Chrome and Firefox are better served by loading
# Resources/ unpacked; the one that matters is Safari's, where running the
# project from Xcode installs an "ONIX Viewer Dev" app whose extension
# stays in Safari across quits, unlike a temporary extension. It has a
# bundle identifier of its own (io.maendeleo.ONIX-Viewer.dev) so it sits
# beside the App Store app rather than replacing it. `npm run build:dev`
# builds all three.
#
# A store build sweeps dist/ of other versions' artefacts first: the
# store's copy of every version is on the GitHub release, and stale zips
# beside the current one have been uploaded by mistake before.
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
DEV=0
for arg in "$@"; do
  case "$arg" in
    --target=chrome|--target=firefox|--target=safari) TARGET="${arg#--target=}" ;;
    --dev) DEV=1 ;;
    *) echo "usage: $0 [--dev] [--target=chrome|--target=firefox|--target=safari]" >&2; exit 2 ;;
  esac
done

VERSION=$(node -p "require('./Resources/manifest.json').version")
if [ "$DEV" = 1 ]; then
  OUT_DIR="dist/dev"
  STEM="onix-viewer-$TARGET"
  PRUNE_FLAGS="--dev"
  APP_NAME="ONIX Viewer Dev"
  BUNDLE_ID="io.maendeleo.ONIX-Viewer.dev"
else
  OUT_DIR="dist"
  STEM="onix-viewer-${VERSION}"
  [ "$TARGET" = "chrome" ] || STEM="$STEM-$TARGET"
  PRUNE_FLAGS=""
  APP_NAME="ONIX Viewer"
  BUNDLE_ID="io.maendeleo.ONIX-Viewer"
fi
OUT="$OUT_DIR/$STEM.zip"
STAGE="$OUT_DIR/package"
[ "$TARGET" = "safari" ] && STAGE="$OUT_DIR/$STEM"

mkdir -p "$OUT_DIR"
if [ "$DEV" = 0 ]; then
  for stale in "$OUT_DIR"/onix-viewer-*; do
    [ -e "$stale" ] || continue
    case "$(basename "$stale")" in
      "onix-viewer-${VERSION}.zip"|"onix-viewer-${VERSION}-"*) ;;
      *) rm -rf "$stale"; echo "  removed stale $stale" ;;
    esac
  done
fi
rm -f "$OUT"
rm -rf "$STAGE"
mkdir -p "$STAGE"

# A store build must not say -dev; a dev build must. Takes the manifest's
# text and the name to blame.
check_version_name() {
  if [ "$DEV" = 1 ]; then
    if ! printf '%s' "$1" | grep -q '"version_name"'; then
      echo "version_name is missing from $2 — a dev build must say -dev" >&2
      exit 1
    fi
  elif printf '%s' "$1" | grep -q '"version_name"'; then
    echo "version_name survived into $2 — the $TARGET build must not carry it" >&2
    exit 1
  fi
}

# Everything shipped, minus .DS_Store and editor cruft.
cp -R Resources/. "$STAGE"
find "$STAGE" -name .DS_Store -delete

# The manifest each store gets — one module, so the suite can run it for
# every target against the real manifest (tests/cases/37-store-manifests).
# shellcheck disable=SC2086
node tools/prune-manifest.js "$TARGET" "$STAGE/manifest.json" $PRUNE_FLAGS

if [ "$TARGET" = "safari" ]; then
  # Apple's converter wraps the folder in an app + extension Xcode project.
  # --copy-resources makes the project self-contained (it otherwise
  # references the files by absolute path, which is no good to commit or
  # to move). The generated project is build output, like the zips.
  PROJECT="$OUT_DIR/safari"
  rm -rf "$PROJECT"
  xcrun safari-web-extension-converter "$STAGE" \
    --project-location "$PROJECT" \
    --app-name "$APP_NAME" \
    --bundle-identifier "$BUNDLE_ID" \
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
  PBXPROJ="$PROJECT/$APP_NAME/$APP_NAME.xcodeproj/project.pbxproj"
  # App Store Connect refuses a build whose version and build number it has
  # seen, and 0.9.20 (1) was on TestFlight before that tag was taken back,
  # so the build number can be set: APPLE_BUILD_NUMBER=2 for that upload.
  sed -i '' -E "s/MACOSX_DEPLOYMENT_TARGET = [0-9.]+;/MACOSX_DEPLOYMENT_TARGET = 15.0;/; s/MARKETING_VERSION = [0-9.]+;/MARKETING_VERSION = $VERSION;/; s/CURRENT_PROJECT_VERSION = [0-9]+;/CURRENT_PROJECT_VERSION = ${APPLE_BUILD_NUMBER:-1};/" "$PBXPROJ"
  sed -i '' -E "s/INFOPLIST_KEY_NSMainStoryboardFile = Main;/INFOPLIST_KEY_NSMainStoryboardFile = Main;\\
				INFOPLIST_KEY_LSApplicationCategoryType = \"public.app-category.developer-tools\";\\
				INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO;/; s/INFOPLIST_KEY_NSHumanReadableCopyright = \"\";/INFOPLIST_KEY_NSHumanReadableCopyright = \"© 2026 Bendik Rognlien Johansen\";/" "$PBXPROJ"
  # The converter builds the dev app's identifier out of the dev bundle id
  # and the app name; pin the app target to the id asked for, and leave the
  # extension's, which the converter derives correctly.
  if [ "$DEV" = 1 ]; then
    sed -i '' -E "/PRODUCT_BUNDLE_IDENTIFIER = \"[^\"]*\";/{/\.Extension\"/!s/PRODUCT_BUNDLE_IDENTIFIER = \"[^\"]*\";/PRODUCT_BUNDLE_IDENTIFIER = \"$BUNDLE_ID\";/;}" "$PBXPROJ"
  fi
  if [ -n "${APPLE_TEAM_ID:-}" ]; then
    sed -i '' -E "s/CODE_SIGN_STYLE = Automatic;/CODE_SIGN_STYLE = Automatic;\\
				DEVELOPMENT_TEAM = $APPLE_TEAM_ID;/" "$PBXPROJ"
  fi
  for key in minimum_chrome_version gecko; do
    if grep -q "\"$key\"" "$STAGE/manifest.json"; then
      echo "$key survived into $STAGE/manifest.json — the safari build must not carry it" >&2
      exit 1
    fi
  done
  check_version_name "$(cat "$STAGE/manifest.json")" "$STAGE/manifest.json"
  echo
  echo "Wrote $STAGE (load it with Safari → Settings → Developer → Add Temporary Extension…)"
  if [ "$DEV" = 1 ]; then
    echo "Wrote $PROJECT/$APP_NAME/$APP_NAME.xcodeproj (open in Xcode and Run: installs the dev app, and its extension in Safari)"
  else
    echo "Wrote $PROJECT/$APP_NAME/$APP_NAME.xcodeproj (open in Xcode to build, sign and archive)"
  fi
  exit 0
fi

(cd "$STAGE" && zip -r "$OLDPWD/$OUT" . -x ".DS_Store" -x "**/.DS_Store")
rm -rf "$STAGE"

OTHER="browser_specific_settings"
[ "$TARGET" = "firefox" ] && OTHER="minimum_chrome_version"
if unzip -p "$OUT" manifest.json | grep -q "\"$OTHER\""; then
  echo "$OTHER survived into $OUT — the $TARGET build must not carry it" >&2
  exit 1
fi
check_version_name "$(unzip -p "$OUT" manifest.json)" "$OUT"

echo
echo "Wrote $OUT"
ls -lh "$OUT" | awk '{print "  size: " $5}'
echo "  contents:"
unzip -l "$OUT" | awk 'NR>3 && $4 != "" {print "    " $4}' | sort | head -20
total=$(unzip -l "$OUT" | tail -1 | awk '{print $1}')
echo "  total uncompressed: $total bytes"

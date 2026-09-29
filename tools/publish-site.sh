#!/usr/bin/env bash
# tools/publish-site.sh — publish site/ to maendeleo.io.
#
#   tools/publish-site.sh             # sync, commit, push
#   tools/publish-site.sh --dry-run   # show what would change and stop
#   tools/publish-site.sh --ported    # the site's own edits are in site/ now: publish over them
#
# The page lives in this repo as site/ and is served from the maendeleo-site
# repo, which the host deploys from on every push to main. Publishing is
# therefore a copy into that repo's onix-viewer/ and a push. The copy is a
# full sync, so a file removed here disappears from the site too.
#
# An edit made in the site repo instead of here would be overwritten by that
# sync in silence — which is how the page drifted once — so the script first
# checks that the site's copy is some committed state of site/: the commit
# named in the last publish commit, or failing that any commit in site/'s
# history. If it is none of them, the site has edits of its own, and the
# script refuses and lists them. Once those edits have been ported into
# site/ here, --ported publishes over them; the list is still printed, as
# the record of what was overwritten.

set -euo pipefail

cd "$(dirname "$0")/.."

SITE_REPO="${MAENDELEO_SITE:-$HOME/git/maendeleo-site}"
TARGET_DIR="onix-viewer"
MARKER="onix-viewer@"

DRY_RUN=0
PORTED=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --ported) PORTED=1 ;;
    *) echo "usage: $0 [--dry-run] [--ported]" >&2; exit 2 ;;
  esac
done

fail() { echo "$1" >&2; exit 1; }

# ---- both checkouts must be in a state worth publishing from ---------------

[ -z "$(git status --porcelain)" ] \
  || fail "this checkout has uncommitted changes; commit them first, so the site comes from a commit"
[ -d "$SITE_REPO/.git" ] \
  || fail "no site repo at $SITE_REPO (set MAENDELEO_SITE to point at it)"
[ "$(git -C "$SITE_REPO" branch --show-current)" = "main" ] \
  || fail "$SITE_REPO is not on main"
[ -z "$(git -C "$SITE_REPO" status --porcelain)" ] \
  || fail "$SITE_REPO has uncommitted changes; commit or discard them first"

git -C "$SITE_REPO" pull --ff-only --quiet

SITE_REPO=$(cd "$SITE_REPO" && pwd)
TARGET="$SITE_REPO/$TARGET_DIR"
SOURCE_COMMIT=$(git rev-parse --short HEAD)
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT

# ---- refuse to overwrite an edit made in the site repo ---------------------

# Lists how the site's copy differs from a directory, one file per line;
# empty when they match.
drift() {
  local base="$1" f
  {
    (cd "$base" && find . -type f ! -name .DS_Store)
    (cd "$TARGET" && find . -type f ! -name .DS_Store)
  } | sed 's#^\./##' | sort -u | while read -r f; do
    if [ ! -e "$base/$f" ]; then echo "  $f  (only on the site)"
    elif [ ! -e "$TARGET/$f" ]; then echo "  $f  (missing on the site)"
    elif ! cmp -s "$base/$f" "$TARGET/$f"; then echo "  $f  (differs)"
    fi
  done
}

# site/ as of a commit, extracted under $SCRATCH; echoes the directory.
site_at() {
  local dir="$SCRATCH/$1"
  mkdir -p "$dir" && git archive "$1" site | tar -x -C "$dir"
  echo "$dir/site"
}

last_published() {
  git -C "$SITE_REPO" log -1 --format=%B -- "$TARGET_DIR" \
    | grep -o -E "$MARKER[0-9a-f]{7,40}" | head -1 | sed "s/^$MARKER//" || true
}

if [ -d "$TARGET" ]; then
  BASELINE=""
  for sha in $(last_published) $(git log --format=%h -- site); do
    git cat-file -e "$sha^{commit}" 2>/dev/null || continue
    if [ -z "$(drift "$(site_at "$sha")")" ]; then BASELINE="$sha"; break; fi
  done
  if [ -z "$BASELINE" ] && [ "$PORTED" = 1 ]; then
    echo "the site repo's $TARGET_DIR/ has edits of its own; --ported says they are in site/ now. Overwriting:"
    drift site
  elif [ -z "$BASELINE" ]; then
    echo "the site repo's $TARGET_DIR/ matches no committed state of site/, so it has edits of its own." >&2
    echo "Against site/ at $SOURCE_COMMIT:" >&2
    drift site >&2
    fail "port those edits into site/ here (or discard them there) before publishing"
  fi
fi

# ---- sync ------------------------------------------------------------------

mkdir -p "$TARGET"
rsync -a --delete --exclude .DS_Store site/ "$TARGET/"

CHANGED=$(git -C "$SITE_REPO" status --porcelain -- "$TARGET_DIR")
if [ -z "$CHANGED" ]; then
  echo "Nothing to publish: the site already matches site/ at $SOURCE_COMMIT."
  exit 0
fi

echo "Changes to publish:"
echo "$CHANGED" | sed 's/^/  /'

if [ "$DRY_RUN" = 1 ]; then
  git -C "$SITE_REPO" checkout --quiet -- "$TARGET_DIR"
  git -C "$SITE_REPO" clean --quiet -fd -- "$TARGET_DIR"
  echo "Dry run: the site repo is unchanged."
  exit 0
fi

git -C "$SITE_REPO" add -A -- "$TARGET_DIR"
git -C "$SITE_REPO" commit --quiet -m "Update the onix-viewer page from $MARKER$SOURCE_COMMIT"
git -C "$SITE_REPO" push --quiet origin main
echo "Published site/ at $SOURCE_COMMIT to $SITE_REPO and pushed."

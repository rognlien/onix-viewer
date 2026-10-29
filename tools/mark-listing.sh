#!/usr/bin/env bash
# tools/mark-listing.sh — Tag HEAD as the listing uploaded to the stores.
#
# Usage: npm run listing:mark
#
# Run on the commit the uploaded build was made from, after the uploads.
# Creates listing/v<manifest version> locally; tools/listing-changes.js
# compares the next version with it. Prints the push command, does not push.

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./Resources/manifest.json').version")"
TAG="listing/v$VERSION"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree has uncommitted changes, so HEAD is not what was built." >&2
  exit 1
fi

if git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null; then
  echo "Tag $TAG already exists." >&2
  exit 1
fi

git tag "$TAG"

echo "Tagged $(git rev-parse --short HEAD) as $TAG locally. To publish it:"
echo "  git push origin $TAG"

#!/usr/bin/env bash
# tools/release.sh — Bump version, commit, tag, push.
#
# Usage:   tools/release.sh <X.Y.Z>
# Example: tools/release.sh 0.9.2
#
# Updates the version in Resources/manifest.json and package.json, commits
# the change, creates a vX.Y.Z tag, and (if confirmed) pushes both. The
# .github/workflows/release.yml workflow takes over from there.

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <X.Y.Z>" >&2
  exit 1
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must be semver X.Y.Z (got '$VERSION')" >&2
  exit 1
fi

TAG="v$VERSION"

if git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null; then
  echo "Tag $TAG already exists." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree has uncommitted changes — commit or stash first." >&2
  exit 1
fi

# Replace just the "version" line in each manifest. Single-occurrence
# replace preserves formatting and avoids touching dependency versions.
node -e "
  const fs = require('fs');
  const v = '$VERSION';
  for (const f of ['Resources/manifest.json', 'package.json']) {
    const s = fs.readFileSync(f, 'utf8');
    const u = s.replace(/(\"version\":\s*\")[^\"]+(\")/, '\$1' + v + '\$2');
    if (u === s) {
      console.error('Could not find version field in ' + f);
      process.exit(1);
    }
    fs.writeFileSync(f, u);
  }
"

git add Resources/manifest.json package.json
git commit -m "Release $TAG"
git tag "$TAG"

echo
echo "Bumped to $VERSION and tagged $TAG locally."
echo "To trigger the Chrome Web Store release workflow, push both:"
echo "  git push origin main \"$TAG\""

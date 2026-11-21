#!/bin/sh
# rebrand: keep-file (Figolu's releases follow Yogurt's versions)
# A Figolu release of what is in main, between two Yogurt versions: sh app/scripts/figolu-release.sh
# Takes the next Figolu number for the Yogurt version in main (Yogurt 0.3.62 → 0.3.6200, then 0.3.6201…,
# app/scripts/version.mjs), tags main with it and pushes the tag: release.yml builds Mac, Windows and Linux and
# publishes, and installed copies update from there. A new Yogurt version is released by .github/workflows/sync-yogurt.yml.
set -e
cd "$(dirname "$0")/../.."
[ "$(git branch --show-current)" = main ] || { echo "release from main" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "commit or stash your changes first" >&2; exit 1; }
git pull -q --ff-only
git fetch -q --tags
VERSION=$(node app/scripts/version.mjs)
git tag -a "v$VERSION" -m "Figolu $VERSION (Yogurt $(node -p "require('./app/package.json').version"))"
git push origin "v$VERSION"
echo "Tagged v$VERSION: GitHub Actions builds and publishes it (Actions → Release)."

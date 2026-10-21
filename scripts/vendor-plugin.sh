#!/usr/bin/env bash
# Fetches the fire-service Claude plugin (the source of the ЕПТЗ methodology) into vendor/fire-service
# at the commit pinned in plugin.lock. The agent loads it with the Agent SDK's `plugins` option.
#
#   bash scripts/vendor-plugin.sh            # the pinned commit
#   bash scripts/vendor-plugin.sh <ref>      # another commit or branch (then update plugin.lock)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source <(grep -E '^(repo|ref)=' "$ROOT/plugin.lock")
REF="${1:-$ref}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet "$repo" "$TMP/repo"
git -C "$TMP/repo" checkout --quiet "$REF"

DEST="$ROOT/vendor/fire-service"
rm -rf "$DEST"
mkdir -p "$ROOT/vendor"
cp -R "$TMP/repo/plugins/fire-service" "$DEST"
find "$DEST" \( -name tests -o -name __pycache__ \) -type d -prune -exec rm -rf {} +

VERSION="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$DEST/.claude-plugin/plugin.json")"
echo "fire-service $VERSION @ $(git -C "$TMP/repo" rev-parse --short HEAD) → vendor/fire-service"

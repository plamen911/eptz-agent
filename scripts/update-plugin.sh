#!/usr/bin/env bash
# Moves plugin.lock to the newest commit of the fire-service plugin's main branch and vendors it.
# Prints "unchanged" or "updated <old> -> <new> (<version>)". Used by the sync-plugin workflow;
# safe to run by hand.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source <(grep -E '^(repo|ref|version)=' "$ROOT/plugin.lock")
latest="$(git ls-remote "$repo" refs/heads/main | cut -f1)"
[ -n "$latest" ] || { echo "cannot read $repo" >&2; exit 1; }

if [ "$latest" = "$ref" ] && [ -d "$ROOT/vendor/fire-service" ]; then
  echo "unchanged"
  exit 0
fi

bash "$ROOT/scripts/vendor-plugin.sh" "$latest" >/dev/null
new_version="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$ROOT/vendor/fire-service/.claude-plugin/plugin.json")"
printf 'repo=%s\nref=%s\nversion=%s\n' "$repo" "$latest" "$new_version" > "$ROOT/plugin.lock"
if [ "$latest" = "$ref" ]; then
  echo "unchanged"
else
  echo "updated ${ref:0:7} -> ${latest:0:7} ($version -> $new_version)"
fi

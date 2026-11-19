#!/usr/bin/env bash
set -euo pipefail

# The runner now installs Coder's standalone ARM64 release, not LinuxServer.
tag=$(curl -fsSL --retry 3 \
  -H 'Accept: application/vnd.github+json' \
  'https://api.github.com/repos/coder/code-server/releases/latest' |
  jq -er '.tag_name')
full="${tag#v}"
[[ "$full" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "Unexpected code-server release tag: $tag" >&2
  exit 1
}
echo "Upstream code-server release: $full"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "latest_upstream_tag=$full" >> "$GITHUB_OUTPUT"
  echo "short_upstream_tag=$full" >> "$GITHUB_OUTPUT"
fi

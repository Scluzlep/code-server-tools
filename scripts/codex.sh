#!/usr/bin/env bash
set -euo pipefail

export CODEX_HOME="${CODEX_HOME:-/config/.codex}"
mkdir -p "$CODEX_HOME"
chmod 0700 "$CODEX_HOME" 2>/dev/null || true

arch="$(uname -m)"
case "$arch" in
  aarch64|arm64) codex_arch="linux-aarch64" ;;
  x86_64|amd64)  codex_arch="linux-x86_64" ;;
  *)
    printf 'codex: unsupported architecture: %s\n' "$arch" >&2
    exit 1
    ;;
esac

ext_root="${CODEX_EXTENSIONS_DIR:-/config/extensions}"
codex_bin=""
if [ -d "$ext_root" ]; then
  while IFS= read -r candidate; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      codex_bin="$candidate"
    fi
  done < <(find "$ext_root" -maxdepth 4 -path "*/openai.chatgpt-*/bin/${codex_arch}/codex" 2>/dev/null | sort -V || true)
fi

if [ -z "$codex_bin" ]; then
  printf 'codex: OpenAI Codex (openai.chatgpt) binary not found for %s under %s\n' "$codex_arch" "$ext_root" >&2
  printf 'codex: please install the OpenAI Codex (openai.chatgpt) VS Code extension first.\n' >&2
  exit 127
fi

exec "$codex_bin" "$@"

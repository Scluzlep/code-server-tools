#!/usr/bin/env bash
set -euo pipefail
export HOME=/config
export XDG_CONFIG_HOME=/config/.config
export XDG_DATA_HOME=/config/.local/share
export XDG_STATE_HOME=/config/.local/state
export SHELL=/usr/bin/zsh
export PATH="/config/.gemini/bin:${PATH}"
export AGY_HUB_PORT="${AGY_HUB_PORT:-34500}"
export AGY_TTYD_PORT="${AGY_TTYD_PORT:-7681}"
if [ "${AGY_SHARED_HUB:-1}" = "1" ] && [ -z "${ANTIGRAVITY_SERVER_URL:-}" ]; then
  export ANTIGRAVITY_SERVER_URL="http://127.0.0.1:${AGY_HUB_PORT}"
fi

# Persistent Secret Service backing store: /config/.local/share/keyrings.
# Reuse KEYRING_PASSWORD (or the 1Panel SUDO_PASSWORD) to unlock at restart.
if command -v gnome-keyring-daemon >/dev/null 2>&1; then
  keyring_pass="${KEYRING_PASSWORD:-${SUDO_PASSWORD:-}}"
  if [ -n "$keyring_pass" ]; then
    printf '%s' "$keyring_pass" | gnome-keyring-daemon --unlock --components=secrets >/dev/null || \
      echo "WARNING: keyring could not be unlocked" >&2
  else
    gnome-keyring-daemon --start --components=secrets >/dev/null || \
      echo "WARNING: Secret Service unavailable" >&2
  fi
  unset keyring_pass KEYRING_PASSWORD SUDO_PASSWORD
fi

# Existing LSIO paths, including the server-side key-half, remain under /config.
if [ "$#" -gt 0 ]; then exec /usr/local/bin/code-server "$@"; fi
exec /usr/local/bin/code-server \
  --bind-addr 0.0.0.0:8443 \
  --auth password \
  --enable-remote-storage \
  --user-data-dir /config/data \
  --extensions-dir /config/extensions \
  "${DEFAULT_WORKSPACE:-/config/workspace}"

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

normalize_proxy_env() {
  local raw_proxy="${HTTPS_PROXY:-${https_proxy:-${HTTP_PROXY:-${http_proxy:-${ALL_PROXY:-${all_proxy:-}}}}}}"
  [ -n "$raw_proxy" ] || return 0
  export HTTP_PROXY="${HTTP_PROXY:-$raw_proxy}"
  export http_proxy="${http_proxy:-$HTTP_PROXY}"
  export HTTPS_PROXY="${HTTPS_PROXY:-$raw_proxy}"
  export https_proxy="${https_proxy:-$HTTPS_PROXY}"

  local combined="${NO_PROXY:-${no_proxy:-}}"
  local -a merged=()
  local -A seen=()
  local item lower has_star=0
  IFS=',' read -ra existing_parts <<< "$combined"
  for item in "${existing_parts[@]}"; do
    item="${item#"${item%%[![:space:]]*}"}"
    item="${item%"${item##*[![:space:]]}"}"
    [ -n "$item" ] || continue
    lower="${item,,}"
    [ "$lower" = "*" ] && has_star=1
    if [ -z "${seen[$lower]+x}" ]; then
      seen["$lower"]=1
      merged+=("$item")
    fi
  done
  if [ "$has_star" -eq 0 ]; then
    for item in localhost 127.0.0.1 ::1; do
      lower="${item,,}"
      if [ -z "${seen[$lower]+x}" ]; then
        seen["$lower"]=1
        merged+=("$item")
      fi
    done
  fi
  local IFS=','
  export NO_PROXY="${merged[*]}"
  export no_proxy="$NO_PROXY"
}
normalize_proxy_env

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

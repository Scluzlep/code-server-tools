#!/usr/bin/env bash
set -euo pipefail
export HOME=/config
export XDG_CONFIG_HOME=/config/.config
export XDG_DATA_HOME=/config/.local/share
export XDG_STATE_HOME=/config/.local/state
export SHELL=/usr/bin/zsh
export PATH="/opt/agy-cli/.local/bin:$PATH"

# Persistent Secret Service stays in /config for IDE and CLI sign-in.
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

# Web terminal authentication defaults to the existing code-server PASSWORD.
# Keep browser shell disabled rather than accidentally serving it anonymously.
web_password="${AGY_WEB_PASSWORD:-${PASSWORD:-}}"
if [ -z "$web_password" ]; then
  echo 'Set PASSWORD or AGY_WEB_PASSWORD to protect /agy/.' >&2
  exit 1
fi
umask 077
mkdir -p /config/.config/agy /config/.cache/agy/body /config/.cache/agy/proxy
printf 'agy:%s\n' "$(printf '%s\n' "$web_password" | openssl passwd -6 -stdin)" > /config/.config/agy/.htpasswd
unset web_password AGY_WEB_PASSWORD

nginx -t -c /etc/nginx/nginx-agy.conf

if [ "$#" -gt 0 ]; then
  code_server_cmd=(/usr/local/bin/code-server --bind-addr 127.0.0.1:8444 "$@")
else
  code_server_cmd=(/usr/local/bin/code-server
    --bind-addr 127.0.0.1:8444
    --auth password
    --enable-remote-storage
    --user-data-dir /config/data
    --extensions-dir /config/extensions
    "${DEFAULT_WORKSPACE:-/config/workspace}")
fi

# The original public port 8443 is now nginx. Both upstream services
# are strictly loopback-only; the existing 1Panel reverse proxy is unchanged.
"${code_server_cmd[@]}" &
code_pid=$!
ttyd --interface 127.0.0.1 --port 7681 --writable --check-origin \
  --base-path /agy/terminal --cwd "${DEFAULT_WORKSPACE:-/config/workspace}" \
  /usr/local/bin/agyshell &
ttyd_pid=$!
nginx -c /etc/nginx/nginx-agy.conf -g 'daemon off;' &
nginx_pid=$!

stop_children() {
  trap - EXIT TERM INT
  kill "$nginx_pid" "$ttyd_pid" "$code_pid" 2>/dev/null || true
  wait "$nginx_pid" "$ttyd_pid" "$code_pid" 2>/dev/null || true
}
trap stop_children EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
wait -n "$code_pid" "$ttyd_pid" "$nginx_pid" || exit $?

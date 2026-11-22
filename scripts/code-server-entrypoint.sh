#!/usr/bin/env bash
set -euo pipefail

# Keep the 1Panel/LinuxServer environment contract without depending on s6.
uid="${PUID:-1000}"
gid="${PGID:-1000}"
if [ "$(id -u)" -eq 0 ]; then
  if [ "$(id -g abc)" != "$gid" ]; then groupmod -o -g "$gid" abc; fi
  if [ "$(id -u abc)" != "$uid" ]; then usermod -o -u "$uid" abc; fi
  usermod -d /config -s /usr/bin/zsh abc
  if [ -n "${SUDO_PASSWORD:-}" ]; then
    printf 'abc:%s\n' "$SUDO_PASSWORD" | chpasswd
  fi
  install -d -o abc -g abc -m 0755 /config
  for dir in /config/data /config/extensions /config/workspace \
             /config/.config /config/.local /config/.local/share \
             /config/.local/share/keyrings /config/.local/state /config/go \
             /config/.gemini /config/.gemini/bin /config/.gemini/antigravity \
             /config/.gemini/antigravity-cli /config/.gemini/config; do
    install -d -o abc -g abc -m 0755 "$dir"
  done
  if [ -x /opt/antigravity/agy ] && [ ! -e /config/.gemini/bin/agy ]; then
    install -o abc -g abc -m 0755 /opt/antigravity/agy /config/.gemini/bin/agy
  fi
  for file in .zshrc .p10k.zsh; do
    if [ ! -e "/config/$file" ]; then
      install -o abc -g abc -m 0644 "/etc/skel/$file" "/config/$file"
    fi
  done
  exec gosu abc dbus-run-session -- /usr/local/bin/launch-code-server "$@"
fi
for dir in /config/.gemini /config/.gemini/bin /config/.gemini/antigravity \
           /config/.gemini/antigravity-cli /config/.gemini/config; do
  mkdir -p "$dir"
done
if [ -x /opt/antigravity/agy ] && [ ! -e /config/.gemini/bin/agy ]; then
  cp /opt/antigravity/agy /config/.gemini/bin/agy
  chmod 0755 /config/.gemini/bin/agy
fi
exec dbus-run-session -- /usr/local/bin/launch-code-server "$@"

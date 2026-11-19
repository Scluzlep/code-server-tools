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
             /config/.local/share/keyrings /config/.local/state /config/go; do
    install -d -o abc -g abc -m 0755 "$dir"
  done
  for file in .zshrc .p10k.zsh; do
    if [ ! -e "/config/$file" ]; then
      install -o abc -g abc -m 0644 "/etc/skel/$file" "/config/$file"
    fi
  done
  exec gosu abc dbus-run-session -- /usr/local/bin/launch-code-server "$@"
fi
exec dbus-run-session -- /usr/local/bin/launch-code-server "$@"

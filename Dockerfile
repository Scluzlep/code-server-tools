# syntax=docker/dockerfile:1.4
# Heavy tools and shell live in the immutable parent image. code-server is last.
ARG TOOLCHAIN_IMAGE
FROM ${TOOLCHAIN_IMAGE}

ARG CODE_SERVER_VERSION=4.145.2
ARG TARGETARCH=arm64
ARG TTYD_VERSION=1.7.7
ARG AGY_RELEASE_BASE_URL=https://antigravity-cli-auto-updater-974169037036.us-central1.run.app

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/config \
    SHELL=/usr/bin/zsh \
    XDG_CONFIG_HOME=/config/.config \
    XDG_DATA_HOME=/config/.local/share \
    XDG_STATE_HOME=/config/.local/state \
    EXTENSIONS_GALLERY='{"serviceUrl":"https://marketplace.visualstudio.com/_apis/public/gallery","cacheUrl":"https://vscode.blob.core.windows.net/gallery/index","itemUrl":"https://marketplace.visualstudio.com/items","resourceUrlTemplate":"https://{publisher}.vscode-unpkg.net/{publisher}/{name}/{version}/{path}"}'

# Keep runtime PTY/CLI packages in the small Runner layer without invalidating the 15GB toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends tmux \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install verified upstream ttyd (absent from Debian 13 APT) and official Antigravity CLI (agy).
RUN set -eux; \
    case "${TARGETARCH}" in \
      arm64) ttyd_arch="aarch64"; agy_arch="arm64" ;; \
      amd64) ttyd_arch="x86_64"; agy_arch="amd64" ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    mkdir -p /tmp/agy-install /opt/antigravity; \
    curl -fsSL --retry 5 --retry-delay 3 \
      "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${ttyd_arch}" \
      -o "/tmp/agy-install/ttyd.${ttyd_arch}"; \
    curl -fsSL --retry 5 --retry-delay 3 \
      "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/SHA256SUMS" \
      -o /tmp/agy-install/ttyd.SHA256SUMS; \
    (cd /tmp/agy-install && grep -E "^[0-9a-f]{64}  ttyd\.${ttyd_arch}\$" ttyd.SHA256SUMS | sha256sum -c -); \
    install -m 0755 "/tmp/agy-install/ttyd.${ttyd_arch}" /usr/local/bin/ttyd; \
    ttyd --version; \
    manifest_json="$(curl -fsSL --retry 5 --retry-delay 3 "${AGY_RELEASE_BASE_URL}/manifests/linux_${agy_arch}.json")"; \
    agy_url="$(printf '%s' "$manifest_json" | jq -er '.url')"; \
    agy_sha512="$(printf '%s' "$manifest_json" | jq -er '.sha512')"; \
    curl -fsSL --retry 5 --retry-delay 3 "$agy_url" -o /tmp/agy-install/agy.tar.gz; \
    printf '%s  %s\n' "$agy_sha512" /tmp/agy-install/agy.tar.gz | sha512sum -c -; \
    tar -xzf /tmp/agy-install/agy.tar.gz -C /tmp/agy-install antigravity; \
    install -m 0755 /tmp/agy-install/antigravity /opt/antigravity/agy; \
    rm -rf /tmp/agy-install; \
    printf '%s\n' \
      '#!/usr/bin/env bash' \
      'set -euo pipefail' \
      'if [ -x /config/.gemini/bin/agy ]; then exec /config/.gemini/bin/agy "$@"; fi' \
      'exec /opt/antigravity/agy "$@"' \
      > /usr/local/bin/agy; \
    chmod 0755 /usr/local/bin/agy; \
    HOME=/tmp /usr/local/bin/agy --version

COPY scripts/code-server-entrypoint.sh /usr/local/bin/code-server-entrypoint
COPY scripts/launch-code-server.sh /usr/local/bin/launch-code-server
COPY scripts/agyshell.sh /usr/local/bin/agyshell
COPY scripts/agyshell.tmux.conf /etc/agyshell.tmux.conf
# Use the corrected default without rebuilding the 15GB toolchain image.
# The entrypoint still copies this file only when /config/.p10k.zsh is absent.
COPY scripts/p10k.zsh /etc/skel/.p10k.zsh
RUN chmod 0755 /usr/local/bin/code-server-entrypoint /usr/local/bin/launch-code-server /usr/local/bin/agyshell && \
    chmod 0644 /etc/agyshell.tmux.conf

# This is deliberately the FINAL filesystem layer. Upstream IDE updates cannot
# invalidate the Debian + 15GB toolchain + shell layers underneath.
RUN set -eux; \
    curl -fL --retry 5 --retry-delay 3 \
      "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-${TARGETARCH}.tar.gz" \
      -o /tmp/code-server.tar.gz; \
    mkdir -p /opt/code-server; \
    tar -xzf /tmp/code-server.tar.gz -C /opt/code-server --strip-components=1; \
    rm -f /tmp/code-server.tar.gz; \
    ln -sf /opt/code-server/bin/code-server /usr/local/bin/code-server

# Keep Hub host-header compatibility and /agy graphical console in the small runner layer only.
# Dynamic agy port, no extra public port or 1Panel compose changes.
COPY scripts/agy-webui /usr/local/share/agy-webui
COPY scripts/agy-console.cjs /usr/local/lib/agy-console.cjs
COPY scripts/patch-antigravity-proxy.cjs /usr/local/lib/patch-antigravity-proxy.cjs
COPY scripts/patch-agy-routes.cjs /usr/local/lib/patch-agy-routes.cjs
RUN node /usr/local/lib/patch-antigravity-proxy.cjs && \
    node /usr/local/lib/patch-agy-routes.cjs && \
    HOME=/tmp /usr/local/bin/agyshell --check

EXPOSE 8443
ENTRYPOINT ["/usr/local/bin/code-server-entrypoint"]

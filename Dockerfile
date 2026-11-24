# syntax=docker/dockerfile:1.4
# Tier 2 + Tier 3 runner image built atop immutable Tier 1 toolchain base.
ARG TOOLCHAIN_IMAGE
FROM ${TOOLCHAIN_IMAGE}

ARG TARGETARCH
ARG TTYD_VERSION=1.7.7
ARG GH_VERSION=2.105.0
ARG YQ_VERSION=4.54.3
ARG AGY_RELEASE_BASE_URL=https://antigravity-cli-auto-updater-974169037036.us-central1.run.app
ARG CODE_SERVER_VERSION=4.146.0

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/config \
    CODEX_HOME=/config/.codex \
    SHELL=/usr/bin/zsh \
    XDG_CONFIG_HOME=/config/.config \
    XDG_DATA_HOME=/config/.local/share \
    XDG_STATE_HOME=/config/.local/state \
    EXTENSIONS_GALLERY='{"serviceUrl":"https://marketplace.visualstudio.com/_apis/public/gallery","cacheUrl":"https://vscode.blob.core.windows.net/gallery/index","itemUrl":"https://marketplace.visualstudio.com/items","resourceUrlTemplate":"https://{publisher}.vscode-unpkg.net/{publisher}/{name}/{version}/{path}"}'

# Tier 2a: ttyd (absent from Debian 13 APT)
RUN set -eux; \
    target_arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "${target_arch}" in \
      arm64) ttyd_arch="aarch64" ;; \
      amd64) ttyd_arch="x86_64" ;; \
      *) echo "Unsupported TARGETARCH: ${target_arch}" >&2; exit 1 ;; \
    esac; \
    mkdir -p /tmp/ttyd-install; \
    curl -fsSL --retry 5 --retry-delay 3 --connect-timeout 30 --max-time 300 \
      "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${ttyd_arch}" \
      -o "/tmp/ttyd-install/ttyd.${ttyd_arch}"; \
    curl -fsSL --retry 5 --retry-delay 3 --connect-timeout 30 --max-time 300 \
      "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/SHA256SUMS" \
      -o /tmp/ttyd-install/SHA256SUMS; \
    (cd /tmp/ttyd-install && tr -d '\r' < SHA256SUMS | grep -E "^[0-9a-f]{64}  ttyd\.${ttyd_arch}\$" > ttyd.sha256 && test -s ttyd.sha256 && sha256sum -c ttyd.sha256); \
    install -m 0755 "/tmp/ttyd-install/ttyd.${ttyd_arch}" /usr/local/bin/ttyd; \
    ttyd --version; \
    rm -rf /tmp/ttyd-install

# Tier 2b: GitHub CLI (gh)
RUN set -eux; \
    target_arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "${target_arch}" in \
      arm64|amd64) ;; \
      *) echo "Unsupported TARGETARCH: ${target_arch}" >&2; exit 1 ;; \
    esac; \
    mkdir -p /tmp/gh-install/extract; \
    gh_tar="gh_${GH_VERSION}_linux_${target_arch}.tar.gz"; \
    curl -fsSL --retry 5 --retry-delay 3 --connect-timeout 30 --max-time 300 \
      "https://github.com/cli/cli/releases/download/v${GH_VERSION}/${gh_tar}" \
      -o "/tmp/gh-install/${gh_tar}"; \
    curl -fsSL --retry 5 --retry-delay 3 --connect-timeout 30 --max-time 300 \
      "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_checksums.txt" \
      -o /tmp/gh-install/checksums.txt; \
    (cd /tmp/gh-install && tr -d '\r' < checksums.txt | grep -E "^[0-9a-f]{64}  ${gh_tar}\$" > gh.sha256 && test -s gh.sha256 && sha256sum -c gh.sha256); \
    tar -xzf "/tmp/gh-install/${gh_tar}" -C /tmp/gh-install/extract --strip-components=1; \
    install -m 0755 /tmp/gh-install/extract/bin/gh /usr/local/bin/gh; \
    gh --version; \
    rm -rf /tmp/gh-install

# Tier 2c: yq
RUN set -eux; \
    target_arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "${target_arch}" in \
      arm64|amd64) ;; \
      *) echo "Unsupported TARGETARCH: ${target_arch}" >&2; exit 1 ;; \
    esac; \
    mkdir -p /tmp/yq-install; \
    curl -fsSL --retry 5 --retry-delay 3 --connect-timeout 30 --max-time 300 \
      "https://github.com/mikefarah/yq/releases/download/v${YQ_VERSION}/yq_linux_${target_arch}" \
      -o "/tmp/yq-install/yq_linux_${target_arch}"; \
    curl -fsSL --retry 5 --retry-delay 3 --connect-timeout 30 --max-time 300 \
      "https://github.com/mikefarah/yq/releases/download/v${YQ_VERSION}/checksums" \
      -o /tmp/yq-install/checksums; \
    curl -fsSL --retry 5 --retry-delay 3 --connect-timeout 30 --max-time 300 \
      "https://github.com/mikefarah/yq/releases/download/v${YQ_VERSION}/checksums_hashes_order" \
      -o /tmp/yq-install/checksums_hashes_order; \
    sha_col="$(tr -d '\r' < /tmp/yq-install/checksums_hashes_order | awk 'BEGIN{col=0} $0=="SHA-256"{col=NR+1; exit} END{print col}')"; \
    test -n "$sha_col" && test "$sha_col" -gt 1; \
    yq_sha256="$(tr -d '\r' < /tmp/yq-install/checksums | awk -v f="yq_linux_${target_arch}" -v c="${sha_col}" '$1==f {print $c; exit}')"; \
    test -n "$yq_sha256"; \
    printf '%s  %s\n' "$yq_sha256" "/tmp/yq-install/yq_linux_${target_arch}" | sha256sum -c -; \
    install -m 0755 "/tmp/yq-install/yq_linux_${target_arch}" /usr/local/bin/yq; \
    yq --version; \
    rm -rf /tmp/yq-install

# Tier 2d: Antigravity CLI (agy)
RUN set -eux; \
    target_arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "${target_arch}" in \
      arm64|amd64) ;; \
      *) echo "Unsupported TARGETARCH: ${target_arch}" >&2; exit 1 ;; \
    esac; \
    mkdir -p /tmp/agy-install /opt/antigravity; \
    manifest_json="$(curl -fsSL --retry 5 --retry-delay 3 --connect-timeout 30 --max-time 300 "${AGY_RELEASE_BASE_URL}/manifests/linux_${target_arch}.json")"; \
    agy_url="$(printf '%s' "$manifest_json" | jq -er '.url')"; \
    agy_sha512="$(printf '%s' "$manifest_json" | jq -er '.sha512')"; \
    curl -fsSL --retry 5 --retry-delay 3 --connect-timeout 30 --max-time 300 "$agy_url" -o /tmp/agy-install/agy.tar.gz; \
    printf '%s  %s\n' "$agy_sha512" /tmp/agy-install/agy.tar.gz | sha512sum -c -; \
    tar -xzf /tmp/agy-install/agy.tar.gz -C /tmp/agy-install antigravity; \
    install -m 0755 /tmp/agy-install/antigravity /opt/antigravity/agy; \
    printf '%s\n' \
      '#!/usr/bin/env bash' \
      'set -euo pipefail' \
      'if [ -x /config/.gemini/bin/agy ]; then exec /config/.gemini/bin/agy "$@"; fi' \
      'exec /opt/antigravity/agy "$@"' \
      > /usr/local/bin/agy; \
    chmod 0755 /usr/local/bin/agy; \
    HOME=/tmp /usr/local/bin/agy --version; \
    rm -rf /tmp/agy-install

# Tier 2e: standalone code-server
RUN set -eux; \
    target_arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "${target_arch}" in \
      arm64|amd64) ;; \
      *) echo "Unsupported TARGETARCH: ${target_arch}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL --retry 5 --retry-delay 3 --connect-timeout 30 --max-time 600 \
      "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-${target_arch}.tar.gz" \
      -o /tmp/code-server.tar.gz; \
    mkdir -p /opt/code-server; \
    tar -xzf /tmp/code-server.tar.gz -C /opt/code-server --strip-components=1; \
    rm -f /tmp/code-server.tar.gz; \
    ln -sf /opt/code-server/bin/code-server /usr/local/bin/code-server

# Tier 3: scripts, shell profile, /agy patches (final bottom layer)
COPY scripts/dev-env.sh /etc/profile.d/dev-env.sh
COPY scripts/zshrc /etc/skel/.zshrc
COPY scripts/p10k.zsh /etc/skel/.p10k.zsh
COPY scripts/code-server-entrypoint.sh /usr/local/bin/code-server-entrypoint
COPY scripts/launch-code-server.sh /usr/local/bin/launch-code-server
COPY scripts/agyshell.sh /usr/local/bin/agyshell
COPY scripts/agyshell.tmux.conf /etc/agyshell.tmux.conf
COPY scripts/codex.sh /usr/local/bin/codex
COPY scripts/agy-webui /usr/local/share/agy-webui
COPY scripts/agy-console.cjs /usr/local/lib/agy-console.cjs
COPY scripts/patch-antigravity-proxy.cjs /usr/local/lib/patch-antigravity-proxy.cjs
COPY scripts/patch-agy-routes.cjs /usr/local/lib/patch-agy-routes.cjs
RUN chmod 0644 /etc/profile.d/dev-env.sh /etc/skel/.zshrc /etc/skel/.p10k.zsh /etc/agyshell.tmux.conf && \
    chmod 0755 /usr/local/bin/code-server-entrypoint /usr/local/bin/launch-code-server /usr/local/bin/agyshell /usr/local/bin/codex && \
    node /usr/local/lib/patch-antigravity-proxy.cjs && \
    node /usr/local/lib/patch-agy-routes.cjs && \
    HOME=/tmp /usr/local/bin/agyshell --check

EXPOSE 8443
ENTRYPOINT ["/usr/local/bin/code-server-entrypoint"]

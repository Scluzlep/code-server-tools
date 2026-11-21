# syntax=docker/dockerfile:1.4
# Heavy tools and shell live in the immutable parent image. code-server is last.
ARG TOOLCHAIN_IMAGE
FROM ${TOOLCHAIN_IMAGE}

ARG CODE_SERVER_VERSION=4.145.2
ARG TARGETARCH=arm64

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/config \
    SHELL=/usr/bin/zsh \
    XDG_CONFIG_HOME=/config/.config \
    XDG_DATA_HOME=/config/.local/share \
    XDG_STATE_HOME=/config/.local/state \
    EXTENSIONS_GALLERY='{"serviceUrl":"https://marketplace.visualstudio.com/_apis/public/gallery","cacheUrl":"https://vscode.blob.core.windows.net/gallery/index","itemUrl":"https://marketplace.visualstudio.com/items","resourceUrlTemplate":"https://{publisher}.vscode-unpkg.net/{publisher}/{name}/{version}/{path}"}'

COPY scripts/code-server-entrypoint.sh /usr/local/bin/code-server-entrypoint
COPY scripts/launch-code-server.sh /usr/local/bin/launch-code-server
# Use the corrected default without rebuilding the 15GB toolchain image.
# The entrypoint still copies this file only when /config/.p10k.zsh is absent.
COPY scripts/p10k.zsh /etc/skel/.p10k.zsh
RUN chmod 0755 /usr/local/bin/code-server-entrypoint /usr/local/bin/launch-code-server

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

# Keep Hub host-header compatibility in the small runner layer only.
# Dynamic agy port, no extra public port or 1Panel compose changes.
COPY scripts/patch-antigravity-proxy.cjs /usr/local/lib/patch-antigravity-proxy.cjs
RUN node /usr/local/lib/patch-antigravity-proxy.cjs

EXPOSE 8443
ENTRYPOINT ["/usr/local/bin/code-server-entrypoint"]

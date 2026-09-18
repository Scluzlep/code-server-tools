# syntax=docker/dockerfile:1.4
ARG TOOLCHAIN_VERSION=1.0.0
ARG CODE_SERVER_VERSION=4.137.0
ARG TOOLCHAIN_IMAGE=ghcr.io/scluzlep/dev-toolchain-base:${TOOLCHAIN_VERSION}

FROM ${TOOLCHAIN_IMAGE} AS toolchain

FROM linuxserver/code-server:${CODE_SERVER_VERSION}

ARG TARGETARCH=arm64
ENV DEBIAN_FRONTEND=noninteractive \
    SHELL=/bin/bash \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# ------------------------------------------------------------------------------
# 1. 安装基础运行时动态链接库 & 编译基础依赖
# ------------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc g++ clang llvm lld cmake ninja-build \
    curl wget git p7zip-full unzip zip ca-certificates jq \
    libssl-dev zlib1g-dev libreadline-dev libsqlite3-dev \
    libxml2 libxslt1.1 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------------------------
# 2. 从已打包好的工具层极速拷入 /opt 与共享资源 (毫秒级组装)
# ------------------------------------------------------------------------------
COPY --from=toolchain /opt /opt
COPY --from=toolchain /usr/local/share/jupyter /usr/local/share/jupyter
COPY --from=toolchain /bin/uv /bin/uvx /bin/

# 软链接 JADX & Apktool，放行 Git safe.directory 并赋予 Flutter 运行权限
RUN ln -sf /opt/jadx/bin/jadx /usr/local/bin/jadx && \
    ln -sf /opt/jadx/bin/jadx-gui /usr/local/bin/jadx-gui && \
    ln -sf /opt/apktool/apktool /usr/local/bin/apktool && \
    ln -sf /opt/apktool/apktool.jar /usr/local/bin/apktool.jar && \
    git config --system --add safe.directory "*" && \
    chmod -R a+rwX /opt/flutter

# ------------------------------------------------------------------------------
# 3. 注入系统环境变量与全局 PATH
# ------------------------------------------------------------------------------
ENV JAVA_HOME=/opt/java/jdk-21 \
    GRADLE_HOME=/opt/gradle \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    KOTLIN_HOME=/opt/kotlinc \
    GOROOT=/opt/go/go1.26.8 \
    GOPATH=/config/go \
    NODE_HOME=/opt/node \
    FLUTTER_ROOT=/opt/flutter \
    PYENV_ROOT=/opt/pyenvs

ENV PATH=/opt/pyenvs/py312/bin:${JAVA_HOME}/bin:${GRADLE_HOME}/bin:${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools:${KOTLIN_HOME}/bin:${GOROOT}/bin:${GOPATH}/bin:${NODE_HOME}/bin:${FLUTTER_ROOT}/bin:${PATH}

# ------------------------------------------------------------------------------
# 4. 配置多版本切换函数、别名及 TAB 自动补全
# ------------------------------------------------------------------------------
COPY scripts/dev-env.sh /etc/profile.d/dev-env.sh
RUN chmod +x /etc/profile.d/dev-env.sh && \
    echo "source /etc/profile.d/dev-env.sh" >> /etc/bash.bashrc

# s6-overlay 初始化脚本：确保持久化挂载的 /config/.bashrc 自动加载 dev-env.sh
RUN mkdir -p /etc/cont-init.d && \
    cat <<'EOF' > /etc/cont-init.d/99-dev-env-init
#!/usr/bin/with-contenv bash
if [ -d "/config" ]; then
    touch /config/.bashrc
    if ! grep -q "/etc/profile.d/dev-env.sh" /config/.bashrc; then
        echo "source /etc/profile.d/dev-env.sh" >> /config/.bashrc
    fi
    mkdir -p /config/data/User
    if [ ! -f "/config/data/User/settings.json" ] && [ -f "/defaults/data/User/settings.json" ]; then
        cp /defaults/data/User/settings.json /config/data/User/settings.json
    fi
fi
EOF
RUN chmod +x /etc/cont-init.d/99-dev-env-init

# ------------------------------------------------------------------------------
# 5. VS Code 预置配置 (代理与默认终端配置)
# ------------------------------------------------------------------------------
RUN mkdir -p /defaults/data/User && \
    cat <<'EOF' > /defaults/data/User/settings.json
{
  "http.proxy": "http://host.docker.internal:7897",
  "http.proxyStrictSSL": false,
  "terminal.integrated.defaultProfile.linux": "bash"
}
EOF

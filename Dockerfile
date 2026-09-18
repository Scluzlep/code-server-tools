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
# 2. 从已打包好的工具层极速拷入 /opt、Python 运行时库与共享资源
# ------------------------------------------------------------------------------
COPY --from=toolchain /opt /opt
COPY --from=toolchain /root/.local /root/.local
COPY --from=toolchain /usr/local/share/jupyter /usr/local/share/jupyter
COPY --from=toolchain /bin/uv /bin/uvx /bin/

# 权限放行：使非 root 用户 (abc) 可遍历执行 /root 下的 Python 解释器，放行 Git 与目录权限
RUN chmod 755 /root && \
    chmod -R a+rX /root/.local && \
    chmod -R a+rwX /opt/flutter && \
    chmod -R a+rwX /opt/pyenvs && \
    chmod 777 /usr/local/bin && \
    git config --system --add safe.directory "*"

# ------------------------------------------------------------------------------
# 3. 创建系统全局标准软链接 (/usr/local/bin 保障任何用户、终端、脚本均可直接执行)
# ------------------------------------------------------------------------------
RUN <<'EOF'
set -e
# Python 默认 (3.12) 与多版本别名
ln -sf /opt/pyenvs/py312/bin/python /usr/local/bin/python
ln -sf /opt/pyenvs/py312/bin/python3 /usr/local/bin/python3
ln -sf /opt/pyenvs/py312/bin/pip /usr/local/bin/pip
ln -sf /opt/pyenvs/py312/bin/pip3 /usr/local/bin/pip3
ln -sf /opt/pyenvs/py312/bin/ipython /usr/local/bin/ipython
for ver in 310 312 313 314; do
    ln -sf /opt/pyenvs/py${ver}/bin/python /usr/local/bin/python${ver}
    ln -sf /opt/pyenvs/py${ver}/bin/python /usr/local/bin/py${ver}
    ln -sf /opt/pyenvs/py${ver}/bin/pip /usr/local/bin/pip${ver}
done

# Java 默认 (JDK 21) 与多版本别名
ln -sf /opt/java/jdk-21/bin/java /usr/local/bin/java
ln -sf /opt/java/jdk-21/bin/javac /usr/local/bin/javac
ln -sf /opt/java/jdk-21/bin/jar /usr/local/bin/jar
for ver in 8 17 21 25; do
    ln -sf /opt/java/jdk-${ver}/bin/java /usr/local/bin/java${ver}
done

# Go 默认 (1.26.8) 与多版本别名
ln -sf /opt/go/go1.26.8/bin/go /usr/local/bin/go
ln -sf /opt/go/go1.26.8/bin/gofmt /usr/local/bin/gofmt
ln -sf /opt/go/go1.26.8/bin/go /usr/local/bin/go1.26.8
ln -sf /opt/go/go1.27.1/bin/go /usr/local/bin/go1.27.1

# Node.js & 前端全家桶
ln -sf /opt/node/bin/node /usr/local/bin/node
ln -sf /opt/node/bin/npm /usr/local/bin/npm
ln -sf /opt/node/bin/npx /usr/local/bin/npx
ln -sf /opt/node/bin/pnpm /usr/local/bin/pnpm
ln -sf /opt/node/bin/yarn /usr/local/bin/yarn
ln -sf /opt/node/bin/tsc /usr/local/bin/tsc
ln -sf /opt/node/bin/vite /usr/local/bin/vite
ln -sf /opt/node/bin/create-vue /usr/local/bin/create-vue

# Kotlin & Gradle
ln -sf /opt/kotlinc/bin/kotlinc /usr/local/bin/kotlinc
ln -sf /opt/kotlinc/bin/kotlin /usr/local/bin/kotlin
ln -sf /opt/gradle/bin/gradle /usr/local/bin/gradle

# Android SDK
ln -sf /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager /usr/local/bin/sdkmanager
ln -sf /opt/android-sdk/cmdline-tools/latest/bin/avdmanager /usr/local/bin/avdmanager
ln -sf /opt/android-sdk/platform-tools/adb /usr/local/bin/adb

# Flutter & Dart
ln -sf /opt/flutter/bin/flutter /usr/local/bin/flutter
ln -sf /opt/flutter/bin/dart /usr/local/bin/dart

# 逆向工具 JADX & Apktool
ln -sf /opt/jadx/bin/jadx /usr/local/bin/jadx
ln -sf /opt/jadx/bin/jadx-gui /usr/local/bin/jadx-gui
ln -sf /opt/apktool/apktool /usr/local/bin/apktool
ln -sf /opt/apktool/apktool.jar /usr/local/bin/apktool.jar
EOF

# ------------------------------------------------------------------------------
# 4. 注入系统环境变量与全局 PATH
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

# 同步写入 /etc/environment 保证 PAM/cron/sudo/su 具有完整 PATH
RUN echo 'PATH="/opt/pyenvs/py312/bin:/opt/java/jdk-21/bin:/opt/gradle/bin:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:/opt/kotlinc/bin:/opt/go/go1.26.8/bin:/config/go/bin:/opt/node/bin:/opt/flutter/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"' > /etc/environment

# ------------------------------------------------------------------------------
# 5. 配置多版本切换函数、别名及 TAB 自动补全
# ------------------------------------------------------------------------------
COPY scripts/dev-env.sh /etc/profile.d/dev-env.sh
RUN chmod +x /etc/profile.d/dev-env.sh && \
    sed -i '1s|^|[ -f /etc/profile.d/dev-env.sh ] \&\& . /etc/profile.d/dev-env.sh\n|' /etc/bash.bashrc && \
    echo '[ -f /etc/profile.d/dev-env.sh ] && . /etc/profile.d/dev-env.sh' >> /etc/profile

# s6-overlay 初始化脚本：确保持久化挂载的 /config/.bashrc 自动加载 dev-env.sh 并修正目录权限
RUN mkdir -p /etc/cont-init.d /custom-cont-init.d && \
    cat <<'EOF' > /etc/cont-init.d/99-dev-env-init
#!/usr/bin/with-contenv bash
if [ -d "/config" ]; then
    touch /config/.bashrc
    if ! grep -q "/etc/profile.d/dev-env.sh" /config/.bashrc; then
        echo "[ -f /etc/profile.d/dev-env.sh ] && source /etc/profile.d/dev-env.sh" >> /config/.bashrc
    fi
    mkdir -p /config/go
    chown -R abc:abc /config/go 2>/dev/null || true
    mkdir -p /config/data/User
    if [ ! -f "/config/data/User/settings.json" ] && [ -f "/defaults/data/User/settings.json" ]; then
        cp /defaults/data/User/settings.json /config/data/User/settings.json
        chown -R abc:abc /config/data/User 2>/dev/null || true
    fi
fi
EOF
RUN cp /etc/cont-init.d/99-dev-env-init /custom-cont-init.d/99-dev-env-init && \
    chmod +x /etc/cont-init.d/99-dev-env-init /custom-cont-init.d/99-dev-env-init

# ------------------------------------------------------------------------------
# 6. VS Code 预置配置 (代理与默认终端配置)
# ------------------------------------------------------------------------------
RUN mkdir -p /defaults/data/User && \
    cat <<'EOF' > /defaults/data/User/settings.json
{
  "http.proxy": "http://host.docker.internal:7897",
  "http.proxyStrictSSL": false,
  "terminal.integrated.defaultProfile.linux": "bash"
}
EOF

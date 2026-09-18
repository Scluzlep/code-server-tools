#!/bin/bash
# ==============================================================================
# 全局多版本工具链切换脚本与自动补全配置 (/etc/profile.d/dev-env.sh)
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. Java 环境切换与别名
# ------------------------------------------------------------------------------
set-java() {
    local v="$1"
    case "$v" in
        8)  export JAVA_HOME=/opt/java/jdk-8 ;;
        17) export JAVA_HOME=/opt/java/jdk-17 ;;
        21) export JAVA_HOME=/opt/java/jdk-21 ;;
        25) export JAVA_HOME=/opt/java/jdk-25 ;;
        *)
            echo "Usage: set-java [8|17|21|25]"
            return 1
            ;;
    esac

    # 移除旧的 Java bin 路径并前置新路径
    local clean_path
    clean_path=$(echo "$PATH" | sed -E -e 's|/opt/java/[^/]+/bin:?||g')
    export PATH="${JAVA_HOME}/bin:${clean_path}"

    if [ -w /usr/local/bin ]; then
        ln -sf "${JAVA_HOME}/bin/java" /usr/local/bin/java 2>/dev/null || true
        ln -sf "${JAVA_HOME}/bin/javac" /usr/local/bin/javac 2>/dev/null || true
        ln -sf "${JAVA_HOME}/bin/jar" /usr/local/bin/jar 2>/dev/null || true
    fi
    echo "Switched to Java $v ($JAVA_HOME)"
}

alias java8="/opt/java/jdk-8/bin/java"
alias java17="/opt/java/jdk-17/bin/java"
alias java21="/opt/java/jdk-21/bin/java"
alias java25="/opt/java/jdk-25/bin/java"

# Java Tab 补全
_set_java_completion() {
    local cur="${COMP_WORDS[COMP_CWORD]}"
    COMPREPLY=($(compgen -W "8 17 21 25" -- "$cur"))
}
complete -F _set_java_completion set-java

# ------------------------------------------------------------------------------
# 2. Python 环境切换与别名
# ------------------------------------------------------------------------------
set-py() {
    local v="$1"
    case "$v" in
        310|3.10) export CURRENT_PY=/opt/pyenvs/py310 ;;
        312|3.12) export CURRENT_PY=/opt/pyenvs/py312 ;;
        313|3.13) export CURRENT_PY=/opt/pyenvs/py313 ;;
        314|3.14) export CURRENT_PY=/opt/pyenvs/py314 ;;
        *)
            echo "Usage: set-py [310|312|313|314|3.10|3.12|3.13|3.14]"
            return 1
            ;;
    esac

    # 移除旧的 Python venv bin 路径并前置新路径
    local clean_path
    clean_path=$(echo "$PATH" | sed -E -e 's|/opt/pyenvs/[^/]+/bin:?||g')
    export PATH="${CURRENT_PY}/bin:${clean_path}"

    if [ -w /usr/local/bin ]; then
        ln -sf "${CURRENT_PY}/bin/python" /usr/local/bin/python 2>/dev/null || true
        ln -sf "${CURRENT_PY}/bin/python3" /usr/local/bin/python3 2>/dev/null || true
        ln -sf "${CURRENT_PY}/bin/pip" /usr/local/bin/pip 2>/dev/null || true
        ln -sf "${CURRENT_PY}/bin/pip3" /usr/local/bin/pip3 2>/dev/null || true
        ln -sf "${CURRENT_PY}/bin/ipython" /usr/local/bin/ipython 2>/dev/null || true
    fi
    echo "Switched to Python $v (${CURRENT_PY})"
}
alias set-python="set-py"

alias python310="/opt/pyenvs/py310/bin/python"
alias py310="/opt/pyenvs/py310/bin/python"
alias pip310="/opt/pyenvs/py310/bin/pip"

alias python312="/opt/pyenvs/py312/bin/python"
alias py312="/opt/pyenvs/py312/bin/python"
alias pip312="/opt/pyenvs/py312/bin/pip"

alias python313="/opt/pyenvs/py313/bin/python"
alias py313="/opt/pyenvs/py313/bin/python"
alias pip313="/opt/pyenvs/py313/bin/pip"

alias python314="/opt/pyenvs/py314/bin/python"
alias py314="/opt/pyenvs/py314/bin/python"
alias pip314="/opt/pyenvs/py314/bin/pip"

# Python Tab 补全
_set_py_completion() {
    local cur="${COMP_WORDS[COMP_CWORD]}"
    COMPREPLY=($(compgen -W "310 312 313 314 3.10 3.12 3.13 3.14" -- "$cur"))
}
complete -F _set_py_completion set-py
complete -F _set_py_completion set-python

# ------------------------------------------------------------------------------
# 3. Golang 环境切换与别名
# ------------------------------------------------------------------------------
set-go() {
    local v="$1"
    case "$v" in
        1.26|1.26.8) export GOROOT=/opt/go/go1.26.8 ;;
        1.27|1.27.1) export GOROOT=/opt/go/go1.27.1 ;;
        *)
            echo "Usage: set-go [1.26.8|1.27.1]"
            return 1
            ;;
    esac

    # 移除旧的 Go bin 路径（包括 current 软链）并前置新 GOROOT/bin
    local clean_path
    clean_path=$(echo "$PATH" | sed -E -e 's|/opt/go/[^/]+/bin:?||g')
    export PATH="${GOROOT}/bin:${clean_path}"

    if [ -w /usr/local/bin ]; then
        ln -sf "${GOROOT}/bin/go" /usr/local/bin/go 2>/dev/null || true
        ln -sf "${GOROOT}/bin/gofmt" /usr/local/bin/gofmt 2>/dev/null || true
    fi
    echo "Switched to Go $v (${GOROOT})"
}

alias go1.26.8="/opt/go/go1.26.8/bin/go"
alias go1.27.1="/opt/go/go1.27.1/bin/go"

# Go Tab 补全
_set_go_completion() {
    local cur="${COMP_WORDS[COMP_CWORD]}"
    COMPREPLY=($(compgen -W "1.26.8 1.27.1" -- "$cur"))
}
complete -F _set_go_completion set-go

# ------------------------------------------------------------------------------
# 4. 初始化默认版本与全局 PATH 注入
# ------------------------------------------------------------------------------
export JAVA_HOME=${JAVA_HOME:-/opt/java/jdk-21}
export GRADLE_HOME=${GRADLE_HOME:-/opt/gradle}
export ANDROID_SDK_ROOT=${ANDROID_SDK_ROOT:-/opt/android-sdk}
export KOTLIN_HOME=${KOTLIN_HOME:-/opt/kotlinc}
export GOROOT=${GOROOT:-/opt/go/go1.26.8}
export GOPATH=${GOPATH:-/config/go}
export NODE_HOME=${NODE_HOME:-/opt/node}
export FLUTTER_ROOT=${FLUTTER_ROOT:-/opt/flutter}
export PYENV_ROOT=${PYENV_ROOT:-/opt/pyenvs}
export CURRENT_PY=${CURRENT_PY:-/opt/pyenvs/py312}

DEV_BIN_PATHS="/opt/pyenvs/py312/bin:${JAVA_HOME}/bin:${GRADLE_HOME}/bin:${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools:${KOTLIN_HOME}/bin:${GOROOT}/bin:${GOPATH}/bin:${NODE_HOME}/bin:${FLUTTER_ROOT}/bin"

case ":$PATH:" in
    *":/opt/pyenvs/py312/bin:"*) ;;
    *) export PATH="${DEV_BIN_PATHS}:${PATH}" ;;
esac

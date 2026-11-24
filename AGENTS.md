# AGENTS.md — code-server-withtools 工程规范与约束

本文档定义本仓库的架构边界、多架构（`linux/amd64` + `linux/arm64`）不变量、版本治理、CI 防超时护栏与运行时安全规范。所有人工与 Agent 修改必须严格遵守以下规则。

---

## 1. 三层解耦镜像架构（3-Tier Decoupled Architecture）

本项目通过 `Dockerfile.toolchain` 与 `Dockerfile` 将镜像构建拆分为三个缓存隔离的层级：

| 层级 | 文件 | 职责与内容 | 缓存失效频率 |
| :--- | :--- | :--- | :--- |
| **Tier 1（重型工具底座）** | `Dockerfile.toolchain` | `debian:13-slim`、全部稳定的系统级 APT 编译/CLI/调试工具（含 `tmux`、`bubblewrap`、`ripgrep`、`fd-find`、`zsh` 等）、Adoptium JDK 8/17/21/25 + Gradle、Astral `uv` Python 3.10–3.15 + 5 个 Jupyter 内核、双版本 Go、Android SDK + Kotlin + JADX + Apktool、Node.js LTS + Corepack、Flutter stable、Oh My Zsh / Powerlevel10k、`abc` 用户（UID/GID 1000）及 `.env` 快照固化 | 极低（仅当工具链版本升级并递增 `TOOLCHAIN_VERSION` 时重建） |
| **Tier 2（独立运行层二进制）** | `Dockerfile`（上中段） | 基于 `FROM ${TOOLCHAIN_IMAGE}`，按 **5 个相互独立的 `RUN` 层**依次安装并校验独立二进制：<br>1. `ttyd`（`SHA256SUMS` 校验）<br>2. `gh`（`checksums.txt` 校验）<br>3. `yq`（`checksums` + `checksums_hashes_order` 动态定位 `SHA-256` 列校验）<br>4. `agy`（`manifests/linux_${TARGETARCH}.json` `.sha512` 校验 + `/usr/local/bin/agy` 包装器）<br>5. 独立版 `code-server`（`/opt/code-server`，位于 Tier 2 最末层） | 低〜中（单个工具升级仅重跑对应层与下游） |
| **Tier 3（脚本与路由补丁层）** | `Dockerfile`（末尾） | 在 `code-server` 层**之后**通过 `COPY scripts/...` 注入全部启动脚本、Shell 配置（`dev-env.sh`、`zshrc`、`p10k.zsh`、`codex.sh`、`agyshell.sh`）及 `/agy/` WebUI 与节点补丁，随后以单个 `RUN` 设置 `0644`/`0755` 权限、执行 `patch-antigravity-proxy.cjs` 与 `patch-agy-routes.cjs` 并运行 `agyshell --check` | 高（修改任意脚本仅重建数 MB 的最底层，秒级完成） |

### 严禁违反的反模式（Forbidden Anti-Patterns）

- **严禁在 `Dockerfile.toolchain` 中 `COPY scripts/*`**：脚本调整绝不能使 15GB+ 的 Tier 1 工具链缓存失效。
- **严禁在 `Dockerfile` 中执行 `apt-get update` / `apt-get install`**：所有稳定的 APT 包必须沉淀在 `Dockerfile.toolchain`。
- **严禁在 `code-server` 安装层之前 `COPY scripts/*`**：脚本改动不得触发 ~200MB 的 `code-server` 重新下载与解压。
- **严禁将多个第三方二进制安装合并到同一 `RUN` 层**：`ttyd`、`gh`、`yq`、`agy`、`code-server` 必须各自独占一个 `RUN` 层，并自行清理 `/tmp/*` 临时目录。

---

## 2. 多架构（`amd64` + `arm64`）工程不变量

### 2.1 架构命名映射表

所有跨架构下载脚本与 Dockerfile 必须严格按下列映射转换 `TARGETARCH` / `uname -m`：

| 组件 / 来源 | `linux/amd64` (`x86_64`) | `linux/arm64` (`aarch64`) | 所在位置 |
| :--- | :--- | :--- | :--- |
| Adoptium Temurin JDK（含 `JDK25_URL` `{ARCH}`） | `x64` | `aarch64` | `Dockerfile.toolchain` |
| Node.js 官方二进制 | `x64` | `arm64` | `Dockerfile.toolchain` |
| Golang (`go.dev/dl`) | `amd64` | `arm64` | `Dockerfile.toolchain` |
| GitHub CLI (`gh`) | `amd64` | `arm64` | `Dockerfile` |
| `yq` (`mikefarah/yq`) | `amd64` | `arm64` | `Dockerfile` |
| Antigravity CLI (`agy` manifest) | `amd64` | `arm64` | `Dockerfile` |
| `code-server` (`coder/code-server`) | `amd64` | `arm64` | `Dockerfile` |
| `ttyd` (`tsl0922/ttyd`) | `x86_64` | `aarch64` | `Dockerfile` |
| OpenAI Codex 扩展二进制 (`uname -m`) | `linux-x86_64` | `linux-aarch64` | `scripts/codex.sh` |

### 2.2 架构兼容性硬性规则

1. **禁止为 `ARG TARGETARCH` 设置默认值**：`Dockerfile` 与 `Dockerfile.toolchain` 在 `FROM` 之后声明全局平台参数时**必须写作 `ARG TARGETARCH`（严禁写 `ARG TARGETARCH=arm64` 等默认值）**。在 BuildKit（`dockerfile2llb`）中，只要 `ARG TARGETARCH` 带默认值且构建命令行未显式传入 `--build-arg TARGETARCH=...`，BuildKit 会跳过 `--platform` 的自动注入而始终采用默认值，从而把错误架构的二进制装进目标镜像；如需在 `RUN` 内兜底，使用 POSIX 回退表达式 `"${TARGETARCH:-$(dpkg --print-architecture)}"`。
2. **`adb` 在 `arm64` 下的执行限制**：Google Android SDK `platform-tools` 仅分发 `x86_64` ELF 二进制。在 `arm64` 容器构建或 CI 验证中**严禁执行 `adb` 命令**（禁止 `adb --version` / `adb version`），仅检查 `test -x /usr/local/bin/adb`；容器运行时通过 `ADB_SERVER_SOCKET=tcp:host.docker.internal:5037` 网络透传至宿主机执行。
3. **`ANDROID_CMDLINE_TOOLS_VERSION` 必须保持纯 JVM 版本**：`ANDROID_CMDLINE_TOOLS_VERSION` 必须锁定在纯 JVM 实现的发行版（当前为 `21.0` / `15641748`，直接运行 Java `SdkManagerCli`）；**严禁升级至 `22.0+`（如 `15859902` / `16111833`）**，因为这些版本已将 `sdkmanager` 委托给仅提供 `x86_64` 原生二进制的 `bin/android` ELF，会在 `linux/arm64` 上直接触发 `Exec format error`（退出码 `126`）。
4. **Dockerfile POSIX `/bin/sh` 安全**：`Dockerfile` 与 `Dockerfile.toolchain` 默认通过 Debian 的 `/bin/sh`（`dash`）执行 `RUN`。`RUN` 指令内严禁使用 `[[ ... ]]`、bash 数组、进程替换 `<(...)` 或 `source` 等 bashism；参数校验使用 `case ... esac` 与 `[ ... ]` / `test`。
5. **`scripts/dev-env.sh` 双 Shell 兼容**：`/etc/profile.d/dev-env.sh` 会同时被 `bash` 和 `zsh` 读取，**必须同时通过 `bash -n` 与 `zsh -n` 语法检查**，并可在两类 Shell 中执行 `set-java`、`set-py`、`set-go`：
   - **严禁在 `dev-env.sh` 中使用 `zsh` 专有参数标志**（如 `${(f)...}`，会导致 `bash` 解析期直接报错）。
   - `set-go` 必须通过 `_dev_env_go_versions`（`find /opt/go -mindepth 1 -maxdepth 1 -type d -name 'go[0-9]*' | sort -V`）动态发现已安装版本，同时支持精确匹配与前缀匹配；`zsh` 补全使用 POSIX 命令替换 `compdef "_values go-version \$(_dev_env_go_versions | tr '\n' ' ')" set-go`。

---

## 3. 版本单一事实来源与文件格式规范

- **单一事实来源（`.env`）**：镜像名称、工具链版本号及默认 CLI/SDK 版本集中维护在根目录 `.env`；CI 通过 `grep` + `tr -d '\r'` 动态读取并注入 `build-args` 与环境变量，禁止在其他文件制造脱离 `.env` 的版本漂移。
- **版本归档快照**：每次调整 Tier 1 工具链并递增 `TOOLCHAIN_VERSION`（如 `1.3.0`）时，**必须同步保存完整快照文件 `versions/toolchain-v<TOOLCHAIN_VERSION>.env`**（内容与 `.env` 对齐）。`merge-toolchain` 作业会将其作为 GitHub Release `toolchain-v<VER>` 资产发布。
- **LF 行尾强制要求**：`.env`、全部 `*.sh`（含 `scripts/dev-env.sh`、`scripts/codex.sh`、`scripts/check-upstream.sh` 等）以及 `*.conf` 必须严格使用 LF（`\n`）行尾，绝不允许提交 CRLF（`\r\n`）。

---

## 4. CI 流水线与防超时护栏（`.github/workflows/build-and-push.yml`）

1. **原生双架构拆分构建（禁止 QEMU）**：
   - `amd64` 固定在 `ubuntu-latest` 构建，`arm64` 固定在 `ubuntu-24.04-arm` 构建；`matrix.fail-fast: false`。
   - 推送阶段采用 `outputs: type=image,...,push-by-digest=true,name-canonical=true,push=true` 上传无 Tag 的平台 digest artifact，再由 `merge-toolchain` / `merge-runner` 作业在 `ubuntu-latest` 上使用 `docker buildx imagetools create` 合并为统一多架构 Manifest。
2. **`amd64` 运行器磁盘空间清理**：`ubuntu-latest` 构建前必须先执行清理，移除 `/usr/share/dotnet`、`/opt/ghc`、`/usr/local/lib/android`、`/usr/local/share/boost`、`/opt/hostedtoolcache/CodeQL`、`/usr/share/swift` 并运行 `docker system prune -af || true`。
3. **Buildx GHA 缓存分层策略**：`build-toolchain` 使用 `cache-to: type=gha,mode=min,scope=toolchain-${{ matrix.arch }}` 控制大镜像缓存体积与导入导出耗时；`build-runner` 使用 `mode=max,scope=runner-${{ matrix.arch }}`。
4. **下载超时与克隆可靠性**：
   - 所有 Dockerfile 中的 `curl` 必须显式携带 `--retry 5 --retry-delay 3 --connect-timeout 30 --max-time <300|600>`。
   - Python `uv` 安装层必须设置 `UV_HTTP_TIMEOUT=300`。
   - Flutter SDK 必须使用 `git clone --single-branch -b stable`（保留完整 tag 供 `flutter --version` 读取，**禁止使用 `--depth=1`**）。
5. **作业超时与并发控制**：
   - 5 个作业全部显式设置 `timeout-minutes`：`check-update` (`10`)、`build-toolchain` (`90`)、`merge-toolchain` (`15`)、`build-runner` (`90`)、`merge-runner` (`15`)。
   - 顶层 `concurrency` 按 `${{ github.workflow }}-${{ github.ref }}` 分组，仅在 `pull_request` 时启用 `cancel-in-progress: true`。
   - `check-update` 使用 `docker buildx imagetools inspect --raw` 配合 `jq -e` 验证目标 Tag 是否同时包含 `linux/amd64` 与 `linux/arm64` 清单；仅有单架构时也视为缺失并触发重建。
6. **PR 双架构实机校验与人工合入**：
   - PR 触发时在 `amd64` 与 `arm64` 上分别执行完整验证（架构断言、多版本语言/内核、全部 CLI 工具、`dev-env.sh` bash+zsh 切换、`codex` 缺失退出码 `127` 与 mock 执行、`code-server` 补丁、`flutter --version`、容器 `/healthz`、`CODEX_HOME` 权限 `0700`、`/agy/` 登录鉴权/CSRF/API/Hub 代理以及 `agyshell` 4 路真实 PTY 探测）。
   - 验证脚本在 `set -euo pipefail` 下避免对长输出命令直接管道 `grep -q`（防止 SIGPIPE 141 误报）。
   - 任何自动化脚本或 Agent **禁止自动向 `main` 提交或推送**；所有变更经 PR 双架构 CI 门禁通过后由维护者人工评审合并。

---

## 5. 运行时约束与仓库边界

- **`CODEX_HOME` 安全权限**：容器内固定设置 `CODEX_HOME=/config/.codex`；入口脚本（`code-server-entrypoint.sh`、`launch-code-server.sh`）与 `scripts/codex.sh` 包装器在创建目录时均强制执行 `chmod 0700`。`codex` 包装器在未检测到 `openai.chatgpt-*/bin/<linux-arch>/codex` 时必须返回退出码 `127`。
- **严禁提交敏感与本地临时文件**：禁止向仓库提交任何密钥、访问令牌、个人认证文件、`Google.google-antigravity-latest.vsix`、`swarmagy/`、`agent.md` 等本地产物。
- **范围边界**：除非用户明确提出需求，否则**严禁引入 Rust 工具链、Docker CLI/Engine 或 `kubectl`**。

# code-server-withtools: 生产级全功能 Web IDE 容器体系 (v1.3.0 · Multi-Arch amd64 / arm64)

面向 **`linux/amd64` 与 `linux/arm64` 双架构原生运行**的高可用、全工具生产级 Web IDE 交付方案。基于 `debian:13-slim` 与官方独立版 **Coder `code-server`（`4.146.0`）**，采用**三层解耦（Tier 1 底座 + Tier 2 独立二进制 + Tier 3 脚本与补丁）**工业级架构，搭载原生分体构建（Split-Runner）GitHub Actions 流水线，专为 1Panel 面板与个人服务器环境定制。

> 开发与维护本仓库的架构规则、多架构映射表及 CI 护栏，请参阅工程规范文档 [`AGENTS.md`](AGENTS.md)。

---

## 🌟 核心特性与三层解耦架构

### 1. 三层解耦体系（缓存隔离，极速增量交付）

传统单一 Dockerfile 在底层软件或脚本变动时极易引发十数 GB 工具链缓存失效。本项目在 [`Dockerfile.toolchain`](Dockerfile.toolchain) 与 [`Dockerfile`](Dockerfile) 中严格实施三层解耦（详见 [`AGENTS.md`](AGENTS.md)）：

* **Tier 1 — 重型工具底座 (`ghcr.io/scluzlep/dev-toolchain-base:1.3.0`)**
  基于 `debian:13-slim`，封装所有稳定的系统级 APT 工具、多版本语言/SDK 编译器、5 套 Python 隔离环境与 Jupyter 内核、Oh My Zsh / Powerlevel10k 以及 `abc` 运行用户（UID/GID 1000）。仅在变更工具链并递增 `TOOLCHAIN_VERSION` 时重建；全量配置同步固化至镜像内 `/opt/dev-toolchain.env`、`/etc/dev-toolchain.env`、仓库 [`versions/toolchain-v1.3.0.env`](versions/toolchain-v1.3.0.env) 与 GitHub Release。
* **Tier 2 — 独立运行层二进制（`Dockerfile` 上中段，5 个独立 `RUN` 层）**
  在不可变的 Tier 1 底座之上，按独立单层依次下载、校验（SHA256 / SHA512）并安装 `ttyd` (`1.7.7`)、`gh` (`2.105.0`)、`yq` (`4.54.3`)、`agy` (Antigravity CLI) 以及独立版 `code-server` (`4.146.0`)。单个工具版本升级互不牵连，`code-server` 始终位于 Tier 2 最末层。
* **Tier 3 — 轻量脚本与 `/agy/` 路由补丁层（`Dockerfile` 最底层，`ghcr.io/scluzlep/code-server-withtools:<上游版本号>`）**
  全部 `scripts/*`（环境切换、入口脚本、`codex` 包装器、`agyshell` tmux 会话守护、`/agy/` 图形控制台前端与代理补丁）统一置于 `code-server` 之后注入。修改任意运行脚本或控制台功能仅重建数 MB 的最末层，秒级交付。

### 2. 原生双架构无转译构建（Native Split-Runner）

* 全面放弃低效且易超时的 QEMU 跨架构仿真：`linux/amd64` 在 `ubuntu-latest` 原生构建，`linux/arm64` 在 `ubuntu-24.04-arm` 原生构建，分别以 `push-by-digest` 推送摘要后合并为统一多架构 OCI Manifest List。

### 3. 版本单一事实来源

* 全部组件版本与仓库配置集中在根目录 [`.env`](.env) 文件维护；工具链升级时同步归档至 [`versions/`](versions/)，杜绝在 Dockerfile 或 CI 中出现版本漂移。

---

## 🛠️ 预装开发工具链全景 (v1.3.0)

| 领域 | 工具链与版本 | 默认版本 | 快捷别名与切换指令 |
| :--- | :--- | :--- | :--- |
| **基础编译** | GCC, G++, Clang, LLVM, LLD, CMake, Ninja, Make | 系统原生 | `gcc`, `clang`, `cmake`, `ninja` 等 |
| **Java / JVM** | Adoptium Temurin JDK 8, 17, 21, 25 GA, Gradle `9.9.2` | **JDK 21** | 别名：`java8`, `java17`, `java21`, `java25`<br>切换：`set-java <8\|17\|21\|25>` (Bash/Zsh Tab 补全) |
| **Python** | `3.10.22`, `3.12.16`, `3.13.18`, `3.14.10`, `3.15.2` (Astral `uv` 隔离环境) | **Python 3.12** | 别名：`python310`..`python315`, `py310`..`py315`, `pip310`..`pip315`<br>切换：`set-py` / `set-python <310\|312\|313\|314\|315>` |
| **Golang** | 官方双版本：`1.26.11`, `1.27.4` | **Go 1.26.11** | 别名：`go1.26.11`, `go1.27.4`<br>切换：`set-go <版本或前缀>`（支持 `set-go 1.27`） |
| **Android 开发** | Android 17 (`platforms;android-37.2`, `build-tools;37.0.0`, `cmdline-tools` `16111833`, `platform-tools`), Kotlin `2.4.21` | Android 17 | `sdkmanager`, `kotlinc`, `adb`（`arm64` 下建议用 `ADB_SERVER_SOCKET` 透传） |
| **逆向工程** | JADX `1.5.7`, Apktool `3.0.3`, Frida & `frida-tools` | 稳定版 | `jadx`, `apktool`, `frida` |
| **前端生态** | Node.js `26.13.1` (Lithium LTS), Corepack, `pnpm`, `yarn`, TypeScript, Vite, `create-vue` | Node 26 LTS | `node`, `npm`, `pnpm`, `yarn`, `tsc`, `vite`, `create-vue` |
| **移动端跨平台**| Flutter SDK (`stable` 分支完整 tag, 已预缓存 Android 构建) | Stable | `flutter`, `dart` |
| **交互式计算** | Jupyter 系统级内核（全部 5 个 Python 隔离环境均已注册） | 5 内核齐备 | `.ipynb` 可直接选择 Python `3.10` / `3.12` / `3.13` / `3.14` / `3.15` |

### Python 预置类库

每个隔离环境（`py310`, `py312`, `py313`, `py314`, `py315`）均原生预装：
* **数据科学全家桶**：`numpy`, `pandas`, `scipy`, `matplotlib`
* **网页分析与爬虫**：`requests`, `beautifulsoup4`, `lxml`, `httpx`
* **逆向工程与 Hook**：`frida`, `frida-tools`
* **交互计算与内核**：`ipykernel`, `ipython`, `ipywidgets`, `nbformat`, `nbconvert`, `notebook`

### 增强 CLI 与运行时工具集

* **检索、编辑与结构化处理**：`ripgrep` (`rg`), `fd-find` (`fd`), `fzf`, `jq`, `yq` (`4.54.3`), `bat`, `eza`, `tree`, `less`, `patch`, `file`, `shellcheck`
* **AI 控制台、终端与沙箱**：`zsh`（Oh My Zsh + Powerlevel10k）, `tmux`, `ttyd` (`1.7.7`), `bubblewrap` (`bwrap`), `gh` (`2.105.0`), `agy` / `agyshell`（内置 `/agy/` 图形控制台、Web 终端与持久化 tmux 会话）, `codex`（自动匹配架构定位 `openai.chatgpt` 扩展内二进制，强制 `CODEX_HOME=/config/.codex` 权限 `0700`）
* **版本控制、传输与数据库**：`openssh-client` (`ssh`), `git-lfs`, `rsync`, `sqlite3`
* **网络与底层调试**：`iproute2` (`ip`), `dnsutils` (`dig`), `iputils-ping` (`ping`), `netcat-openbsd` (`nc`), `strace`, `gdb`, `patchelf`, `xxd`, `htop`
* **边界说明**：为保持镜像职责精简，**不包含 Rust、Docker CLI/Engine 与 `kubectl`**。

---

## ⚡ 快捷指令与 Tab 自动补全

容器通过 `/etc/profile.d/dev-env.sh` 同时支持 **Bash 与 Zsh** 交互切换与 Tab 自动补全：

```bash
# 1. 切换 Java 版本（支持 8 / 17 / 21 / 25）
set-java 17

# 2. 切换 Python 版本（支持 310 / 312 / 313 / 314 / 315 及带点号格式）
set-py 315

# 3. 切换 Golang 版本（支持完整版本号或前缀自动匹配，动态发现 /opt/go）
set-go 1.27

# 4. 精确版本直接调用（无需切换全局 PATH）
java8 -version
python315 -c "import frida; print(frida.__version__)"
go1.27.4 version
```

---

## 🚀 1Panel 部署指南

### 1. 编排配置

在 1Panel 的「容器」->「编排」中新建编排，参考 [`docker-compose.yml`](docker-compose.yml)（支持 `amd64` 与 `arm64` 自动拉取对应原生架构镜像）：

```yaml
version: '3.8'

services:
  code-server:
    # 推荐锁定特定上游版本（如 4.146.0），也可使用 latest
    image: ghcr.io/scluzlep/code-server-withtools:4.146.0
    container_name: code-server-withtools
    restart: unless-stopped
    ports:
      - "8443:8443"
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Asia/Shanghai
      - PASSWORD=YourSecurePassword123 # Web 访问密码
      - DEFAULT_WORKSPACE=/config/workspace
      # ADB 宿主机网络穿透
      - ADB_SERVER_SOCKET=tcp:host.docker.internal:5037
      # 全套终端代理注入 (根据宿主机代理端口调整，默认 7897)
      - HTTP_PROXY=http://host.docker.internal:7897
      - HTTPS_PROXY=http://host.docker.internal:7897
      - ALL_PROXY=socks5://host.docker.internal:7897
      - http_proxy=http://host.docker.internal:7897
      - https_proxy=http://host.docker.internal:7897
      - all_proxy=socks5://host.docker.internal:7897
      - NO_PROXY=localhost,127.0.0.1,host.docker.internal,.local
      - no_proxy=localhost,127.0.0.1,host.docker.internal,.local
    volumes:
      - /opt/1panel/apps/code-server/data:/config
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

### 2. 持久化数据结构说明

当挂载宿主机的 `/opt/1panel/apps/code-server/data` 到容器 `/config` 后：
* `/config/workspace`：代码工程文件，容器重启/升级不丢失。
* `/config/extensions`：VS Code 应用商店安装的扩展插件（含 `openai.chatgpt` 等）。
* `/config/data`：IDE 用户数据与状态（`--user-data-dir /config/data`）。
* `/config/.codex`：Codex CLI 状态与凭证目录（自动维持 `0700` 权限）。
* `/config/.gemini`：Antigravity CLI 配置、凭证与自更新目录。
* `/config/go`：Go 依赖包（`GOPATH` 已指向此处）。
* `/config/.cache`：`pip`、`npm`、`yarn` 缓存。

### 3. 内置 `/agy/` 控制台与 `agyshell`

* 访问 `http://<宿主机>:8443/agy/`（复用 code-server 登录鉴权与同源 CSRF 防护）可使用 Antigravity 图形工作台、任务/会话管理以及 `ttyd` Web 终端。
* 在终端中使用 `agyshell` 可创建或恢复后台持久化 `tmux` 会话（`Ctrl+B` 后按 `d` 后台分离，任务不中断）。

### 4. ADB 网络穿透设置

容器采用 Client-Server 网络透传机制，无需特权模式或挂载物理 USB：
1. 在宿主机启动监听局域网的 ADB Server：
   ```bash
   adb kill-server
   adb -a nodaemon server start
   ```
2. 在 `amd64` 容器内直接执行 `adb devices` 即可无缝连接宿主机设备（注：Google Android SDK `platform-tools` 仅分发 `x86_64` ELF 二进制，若宿主机为 `arm64`，建议直接从宿主机或带 x86 转译的环境通过端口 5037 联调）。

---

## 🔄 GitHub Actions 多架构拆分构建流水线

工作流文件位于 [`.github/workflows/build-and-push.yml`](.github/workflows/build-and-push.yml)，共包含 5 个阶段：

1. **`check-update` (`ubuntu-latest`)**：
   * 每天 UTC 02:00（北京时间 10:00）及 `push` / `pull_request` / `workflow_dispatch` 触发，自动获取 `coder/code-server` 最新 Release。
   * 通过 `docker buildx imagetools inspect --raw` + `jq` 检查 `dev-toolchain-base:${TOOLCHAIN_VERSION}` 与 `code-server-withtools:${UPSTREAM_TAG}` 是否**同时具备 `linux/amd64` 与 `linux/arm64` 清单**。
2. **`build-toolchain`（原生双机矩阵）**：
   * 在 `ubuntu-latest` (`amd64`) 与 `ubuntu-24.04-arm` (`arm64`) 上并行构建 Tier 1 底座（构建前自动清理 `amd64` runner 冗余空间，GHA 缓存采用 `mode=min`），通过 `push-by-digest` 推送各平台摘要并上传 digest artifact。
3. **`merge-toolchain` (`ubuntu-latest`)**：
   * 汇集双架构 digest，执行 `docker buildx imagetools create` 生成多架构 `dev-toolchain-base:<TOOLCHAIN_VERSION>` 与 `:latest`，并在缺失时创建 `toolchain-v<TOOLCHAIN_VERSION>` GitHub Release（附带 `versions/toolchain-v<TOOLCHAIN_VERSION>.env`）。
4. **`build-runner`（原生双机矩阵 + PR 全量实机验收）**：
   * **正式发布路径**：并行构建 Tier 2/3 并以 `push-by-digest` 推送双平台摘要（GHA 缓存 `mode=max`）。
   * **PR 验证路径**：若本次变更需重建底座，则在原生主机通过 `DOCKER_BUILDKIT=1 docker build` 本地串联构建 Tier 1 + Tier 2/3；否则直接基于已发布的底座拉取构建。随后在 `amd64` 与 `arm64` 两侧分别启动真实容器，执行全量工具链、全部新 CLI、`dev-env.sh`（Bash + Zsh）、`codex` 包装器、`flutter --version`、`/agy/` 登录与 CSRF 防护以及 `agyshell` 4 路 PTY 冒烟测试。
5. **`merge-runner` (`ubuntu-latest`)**：
   * 合并双架构 Runner digest，对外统一发布 `code-server-withtools:<UPSTREAM_TAG>`、`:latest` 与 `:<GITHUB_SHA>` 多架构镜像。

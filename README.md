# code-server-withtools: 生产级全功能 Web IDE 容器体系 (ARM64 原生)

面向 ARM64 架构的高可用、全工具生产级 Web IDE 交付方案。基于 `linuxserver/code-server:latest`，采用**双镜像分层（Toolchain Base + Runner）**工业级架构，搭载原生 GitHub Actions 构建流水线，专为 1Panel 面板与个人服务器环境定制。

---

## 🌟 核心特性与架构设计

### 1. 颠倒层级架构（Toolchain Base 模式）
传统单一 Dockerfile 在 Base 镜像更新时会导致十数 GB 的工具链缓存全量失效。本项目采用双镜像解耦体系：
* **底层底座 (`ghcr.io/scluzlep/dev-toolchain-base:<版本号>`)**：包含所有重型工具链、多版本 SDK、编译器与 Python 依赖库（约 15GB+）。**仅在手动勾选更新时构建，构建时带具体语义化版本号（如 `1.0.0`），并将当前 `.env` 全量配置记录沉淀在镜像内部 `/opt/dev-toolchain.env`、代码库 `versions/` 以及 GitHub Release 记录中**。
* **顶层运行器 (`ghcr.io/scluzlep/code-server-withtools:<上游版本号>`)**：延续上游 Release 的确切版本（如 `4.137.0` 与 `4.137.0-ls364`），基于对应上游底模，通过多阶段构建从底座直接复制 `/opt`。**拒绝全量无脑 latest，精准追溯版本；日常构建仅耗时 1~2 分钟，1Panel 升级时只需拉取几十 MB 的增量图层**。

### 2. 原生 ARM64 无转译构建
* 告别缓慢低效的 QEMU x86 转译模拟，流水线全面采用 GitHub-hosted 原生 ARM64 运行环境（`runs-on: ubuntu-24.04-arm`），以原生 CPU 性能极速编译打包。

### 3. 全局版本集中化管理
* 所有工具链组件及 SDK 版本全部抽离维护至根目录 [`.env`](file:///.env) 文件中，版本升级一目了然，杜绝在 CI 流程中硬编码。

---

## 🛠️ 预装开发工具链全景

| 领域 | 工具链与版本 | 默认版本 | 快捷别名与切换指令 |
| :--- | :--- | :--- | :--- |
| **基础编译** | GCC, G++, Clang, LLVM, LLD, CMake, Ninja, Make | 系统原生 | `gcc`, `clang`, `cmake`, `ninja` 等 |
| **Java / JVM** | Temurin JDK 8, 17, 21, OpenJDK 25 EA, Gradle 9.7.1 | **JDK 21** | 别名：`java8`, `java17`, `java21`, `java25`<br>切换：`set-java <8\|17\|21\|25>` (支持 Tab 补全) |
| **Python** | 3.10.21, 3.12.14, 3.13.15, 3.14.7 (Astral uv 隔离环境) | **Python 3.12** | 别名：`python310`, `py312`, `pip314` 等<br>切换：`set-py` / `set-python <版本>` (支持 Tab 补全) |
| **Golang** | 官方稳定双版本：1.26.8, 1.27.1 | **Go 1.26.8** | 别名：`go1.26.8`, `go1.27.1`<br>切换：`set-go <1.26.8\|1.27.1>` (支持 Tab 补全) |
| **Android 开发** | Android 16 (API 36), cmdline-tools, platform-tools (adb), build-tools:36.0.0, Kotlin 2.4.20 | Android 16 | `adb`, `sdkmanager`, `kotlinc` |
| **逆向工程** | JADX 1.5.6 (含 GUI), Apktool 3.0.3, Frida, Frida-tools | 最新稳定版 | `jadx`, `jadx-gui`, `apktool`, `frida` |
| **前端生态** | Node.js 24 LTS, Corepack, pnpm, yarn, TypeScript, Vite, create-vue | Node 24 | `node`, `npm`, `pnpm`, `yarn`, `tsc`, `vite`, `create-vue` |
| **移动端跨平台**| Flutter SDK (Linux ARM64 stable, 已预缓存 Android 构建) | Stable | `flutter`, `dart` |
| **交互式计算** | Jupyter 系统级内核（每个 Python 隔离环境均已注册对应 Kernel） | 4 内核齐备 | 打开 `.ipynb` 直接可选 Python 3.10/3.12/3.13/3.14 |

### Python 预置类库
每个隔离环境（`py310`, `py312`, `py313`, `py314`）均原生预装：
* **数据科学全家桶**：`numpy`, `pandas`, `scipy`, `matplotlib`
* **网页分析与爬虫**：`requests`, `beautifulsoup4`, `lxml`, `httpx`
* **逆向工程与 Hook**：`frida`, `frida-tools`
* **交互计算与内核**：`ipykernel`, `ipython`

---

## ⚡ 快捷指令与 Tab 自动补全

容器全局注入了自动化切换脚本，在任何 bash 终端中均可直接使用：

```bash
# 1. 切换 Java 版本（输入 set-java 后按两次 Tab 自动提示 8 17 21 25）
set-java 17

# 2. 切换 Python 版本（输入 set-py 后按两次 Tab 自动提示 310 312 313 314 3.10 3.12 3.13 3.14）
set-py 314

# 3. 切换 Golang 版本（输入 set-go 后按两次 Tab 自动提示 1.26.8 1.27.1）
set-go 1.27.1

# 4. 精确版本直接调用（无需切换全局环境）
java8 -version
python310 -c "import frida; print(frida.__version__)"
go1.27.1 version
```

---

## 🚀 1Panel 部署指南

### 1. 编排配置
在 1Panel 的「容器」->「编排」中新建编排，粘贴 [`docker-compose.yml`](file:///docker-compose.yml)：

```yaml
version: '3.8'

services:
  code-server:
    # 推荐锁定特定上游版本（如 4.137.0），也可使用 latest
    image: ghcr.io/scluzlep/code-server-withtools:4.137.0
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
* `/config/extensions`：VS Code 应用商店安装的扩展插件。
* `/config/data/User/settings.json`：IDE 设置（已预置代理与默认 bash）。
* `/config/go`：Go 依赖包（`GOPATH` 已指向此处）。
* `/config/.cache`：`pip`、`npm`、`yarn` 缓存。

### 3. ADB 网络穿透设置
容器采用 Client-Server 穿透机制，无需特权模式或挂载物理 USB：
1. 宿主机确保 ADB Server 允许局域网监听：
   ```bash
   adb kill-server
   adb -a nodaemon server start
   ```
2. 在容器内部直接执行 `adb devices` 即可无缝识别物理设备。

---

## 🔄 GitHub Actions 持续构建机制

工作流文件位于 [`.github/workflows/build-and-push.yml`](file:///.github/workflows/build-and-push.yml)：

1. **自动定时巡检**：
   * 每天 UTC 02:00（北京时间 10:00）自动检查上游 `linuxserver/code-server` 的最新 Release 与 Docker Hub digest。
   * 发现更新时仅触发 Runner 秒级构建，工具层从 GHCR 缓存直接挂载。
2. **手动维护触发 (`workflow_dispatch`)**：
   * **日常调试/强制构建**：直接点击 **Run workflow**，1~2 分钟内极速构建 Runner。
   * **更新底层工具链**：勾选 `rebuild_toolchain: true`，流水线将执行全量重构并将新工具链推至 `ghcr.io/scluzlep/dev-toolchain-base:latest`。

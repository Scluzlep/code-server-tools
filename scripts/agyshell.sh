#!/usr/bin/env bash
set -euo pipefail

SELF="${AGYSHELL_SELF:-$0}"
TMUX_CONF="${AGYSHELL_TMUX_CONF:-/etc/agyshell.tmux.conf}"
TMUX_SOCK="${AGYSHELL_TMUX_SOCKET:-agy}"
AGY_BIN="${AGY_BIN:-agy}"

usage() {
  cat <<'EOF'
agyshell - Antigravity CLI 持久化 tmux 会话包装器

用法:
  agyshell [选项] [-- <agy 参数...>]
  agyshell list | ls
  agyshell kill <会话名>
  agyshell --check | --version
  agyshell --help

选项:
  -s, --session <名称>   指定或创建会话名称 (仅限字母/数字/._-，最多 64 字符)
  -c, --cwd <目录>       指定新会话的工作目录 (默认当前目录)
  -d, --detach           后台创建/确保会话存在，不立即 attach
  --check, --version     检查 agy 与 tmux 版本及可用性

常用 TUI 操作:
  /swarm <任务>          启动多 Agent 协作任务
  /swarm board (Alt+S)   打开全屏实时 Swarm 看板
  /agents                打开 Agent 管理与审批面板
  Ctrl+B 再按 d          分离当前终端 (后台任务持续运行，不中断)
EOF
}

validate_session_name() {
  local name="$1"
  if [[ ! "$name" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
    echo "错误: 无效的会话名 '$name' (仅允许 1-64 个字母、数字、点、下划线或连字符)" >&2
    exit 1
  fi
}

tmux_cmd() {
  if [ -r "$TMUX_CONF" ]; then
    tmux -L "$TMUX_SOCK" -f "$TMUX_CONF" "$@"
  else
    tmux -L "$TMUX_SOCK" "$@"
  fi
}

require_deps() {
  if ! command -v "$AGY_BIN" >/dev/null 2>&1; then
    echo "错误: 未找到 Antigravity CLI ('$AGY_BIN')，请确认已正确安装到 PATH 或 /usr/local/bin/agy" >&2
    exit 1
  fi
  if ! command -v tmux >/dev/null 2>&1; then
    echo "错误: 未找到 tmux，请确认容器已安装 tmux" >&2
    exit 1
  fi
}

resolve_dir() {
  local target="$1"
  if [ ! -d "$target" ]; then
    echo "错误: 工作目录不存在: $target" >&2
    exit 1
  fi
  (cd "$target" && pwd -P)
}

derive_session_name() {
  local cwd="$1"
  local default_ws="${DEFAULT_WORKSPACE:-/config/workspace}"
  local default_real=""
  if [ -d "$default_ws" ]; then
    default_real="$(cd "$default_ws" && pwd -P)"
  fi
  if [ -n "$default_real" ] && [ "$cwd" = "$default_real" ]; then
    printf '%s\n' "workspace"
    return
  fi
  local base hash
  base="$(basename "$cwd" | tr -cs 'A-Za-z0-9._-' '-' | sed 's/^-//;s/-$//')"
  [ -n "$base" ] || base="dir"
  hash="$(printf '%s' "$cwd" | sha1sum | cut -c1-6)"
  printf '%s-%s\n' "${base:0:40}" "$hash"
}

run_runner() {
  local cwd="${1:-}"
  if [ -z "$cwd" ]; then
    echo "错误: --runner 需要工作目录参数" >&2
    exit 1
  fi
  shift
  if [ "${1:-}" = "--" ]; then
    shift
  fi
  local -a agy_args=("$@")
  cd "$cwd"
  require_deps
  while true; do
    local rc=0
    set +e
    if [ "${#agy_args[@]}" -gt 0 ]; then
      "$AGY_BIN" "${agy_args[@]}"
      rc=$?
    else
      "$AGY_BIN"
      rc=$?
    fi
    set -e
    # Pass initial CLI flags (e.g. -i prompt) only on the first launch.
    agy_args=()
    if [ ! -t 0 ]; then
      exit "$rc"
    fi
    printf '\n[agyshell] agy 已退出 (code=%s)。按 Enter 重新启动 agy，或输入 q 关闭此会话: ' "$rc"
    local reply=""
    if ! IFS= read -r reply; then
      exit "$rc"
    fi
    if [ "$reply" = "q" ] || [ "$reply" = "Q" ]; then
      exit 0
    fi
  done
}

run_web() {
  if [ "$#" -gt 1 ]; then
    echo "错误: --web 最多只接受一个会话名参数" >&2
    exit 1
  fi
  local name="${1:-workspace}"
  if [[ "$name" == -* ]]; then
    echo "错误: 无效的会话名 '$name'" >&2
    exit 1
  fi
  validate_session_name "$name"
  require_deps
  if tmux_cmd has-session -t "=$name" 2>/dev/null; then
    exec tmux_cmd attach-session -t "=$name"
  fi
  local default_cwd="${DEFAULT_WORKSPACE:-/config/workspace}"
  if [ ! -d "$default_cwd" ]; then
    default_cwd="${HOME:-/config}"
  fi
  default_cwd="$(resolve_dir "$default_cwd")"
  exec tmux_cmd new-session -s "$name" -c "$default_cwd" "$SELF" --runner "$default_cwd"
}

cmd_list() {
  local out=""
  out="$(tmux_cmd list-sessions -F '#{session_name}	#{session_path}	#{session_attached}	#{session_created}' 2>/dev/null || true)"
  if [ -z "$out" ]; then
    echo "当前没有活跃的 agyshell 会话。"
    return 0
  fi
  printf '%-28s %-36s %-8s %s\n' "SESSION" "CWD" "ATTACHED" "CREATED_EPOCH"
  while IFS=$'\t' read -r sname spath sattached screated; do
    printf '%-28s %-36s %-8s %s\n' "$sname" "$spath" "$sattached" "$screated"
  done <<< "$out"
}

cmd_kill() {
  local name="${1:-}"
  if [ -z "$name" ]; then
    echo "错误: kill 需要指定会话名" >&2
    exit 1
  fi
  validate_session_name "$name"
  if ! tmux_cmd has-session -t "=$name" 2>/dev/null; then
    echo "错误: 会话 '$name' 不存在" >&2
    exit 1
  fi
  tmux_cmd kill-session -t "=$name"
  echo "已关闭会话: $name"
}

main() {
  case "${1:-}" in
    -h|--help)
      usage
      exit 0
      ;;
    --version|--check)
      require_deps
      echo "agy: $("$AGY_BIN" --version 2>&1 | head -n 1)"
      echo "tmux: $(tmux -V)"
      exit 0
      ;;
    list|ls)
      cmd_list
      exit 0
      ;;
    kill)
      shift
      cmd_kill "${1:-}"
      exit 0
      ;;
    --runner)
      shift
      run_runner "$@"
      exit 0
      ;;
    --web)
      shift
      run_web "$@"
      exit 0
      ;;
  esac

  local session_name=""
  local cwd_arg=""
  local detach=0
  local -a agy_args=()

  while [ "$#" -gt 0 ]; do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      -s|--session)
        if [ -z "${2:-}" ]; then
          echo "错误: $1 需要提供会话名" >&2
          exit 1
        fi
        session_name="$2"
        shift 2
        ;;
      -c|--cwd)
        if [ -z "${2:-}" ]; then
          echo "错误: $1 需要提供目录路径" >&2
          exit 1
        fi
        cwd_arg="$2"
        shift 2
        ;;
      -d|--detach)
        detach=1
        shift
        ;;
      --)
        shift
        agy_args=("$@")
        break
        ;;
      *)
        echo "错误: 未知参数 '$1' (如需向 agy 传参请放在 '--' 之后)" >&2
        exit 1
        ;;
    esac
  done

  require_deps

  local target_dir="${cwd_arg:-$(pwd)}"
  if [ ! -d "$target_dir" ]; then
    target_dir="${DEFAULT_WORKSPACE:-/config/workspace}"
  fi
  local resolved_cwd
  resolved_cwd="$(resolve_dir "$target_dir")"

  if [ -z "$session_name" ]; then
    session_name="$(derive_session_name "$resolved_cwd")"
  else
    validate_session_name "$session_name"
  fi

  if tmux_cmd has-session -t "=$session_name" 2>/dev/null; then
    if [ "$detach" -eq 1 ]; then
      echo "$session_name"
      exit 0
    fi
    exec tmux_cmd attach-session -t "=$session_name"
  fi

  if [ "${#agy_args[@]}" -gt 0 ]; then
    tmux_cmd new-session -d -s "$session_name" -c "$resolved_cwd" "$SELF" --runner "$resolved_cwd" -- "${agy_args[@]}"
  else
    tmux_cmd new-session -d -s "$session_name" -c "$resolved_cwd" "$SELF" --runner "$resolved_cwd"
  fi

  if [ "$detach" -eq 1 ]; then
    echo "$session_name"
    exit 0
  fi
  exec tmux_cmd attach-session -t "=$session_name"
}

main "$@"

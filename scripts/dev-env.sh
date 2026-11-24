#!/usr/bin/env bash
# Source from bash or zsh. Version switching only affects this shell's PATH.
set-java() {
  local v="${1:-}"
  case "$v" in 8|17|21|25) ;; *) echo "Usage: set-java 8|17|21|25" >&2; return 1;; esac
  export JAVA_HOME="/opt/java/jdk-$v"
  export PATH="$JAVA_HOME/bin:$(printf '%s' "$PATH" | sed -E 's#(^|:)/opt/java/[^:]+/bin(:|$)#\1#g' | sed 's/^://;s/:$//')"
}
set-py() {
  local v="${1:-}"
  case "$v" in 3.10|310) v=310;;3.12|312) v=312;;3.13|313) v=313;;3.14|314) v=314;;3.15|315) v=315;;
    *) echo "Usage: set-py 310|312|313|314|315" >&2; return 1;; esac
  export CURRENT_PY="/opt/pyenvs/py$v"
  export PATH="$CURRENT_PY/bin:$(printf '%s' "$PATH" | sed -E 's#(^|:)/opt/pyenvs/[^:]+/bin(:|$)#\1#g' | sed 's/^://;s/:$//')"
}
set-python() { set-py "$@"; }
_dev_env_go_versions() {
  [ -d /opt/go ] || return 0
  find /opt/go -mindepth 1 -maxdepth 1 -type d -name 'go[0-9]*' 2>/dev/null | sed 's#.*/go##' | sort -V
}
set-go() {
  local v="${1:-}"
  local ver="" exact="" matched="" available=""
  if [ -n "$v" ]; then
    while IFS= read -r ver; do
      [ -n "$ver" ] || continue
      case "$ver" in
        "$v") exact="$ver" ;;
        "$v".*) matched="$ver" ;;
      esac
    done <<EOF
$(_dev_env_go_versions)
EOF
  fi
  if [ -n "$exact" ]; then
    v="$exact"
  elif [ -n "$matched" ]; then
    v="$matched"
  else
    available="$(_dev_env_go_versions | tr '\n' '|' | sed 's/|$//')"
    echo "Usage: set-go ${available:-<version>}" >&2
    return 1
  fi
  export GOROOT="/opt/go/go$v"
  export PATH="$GOROOT/bin:$(printf '%s' "$PATH" | sed -E 's#(^|:)/opt/go/[^:]+/bin(:|$)#\1#g' | sed 's/^://;s/:$//')"
}
if [ -n "${BASH_VERSION:-}" ]; then
  _versions_java() { COMPREPLY=($(compgen -W "8 17 21 25" -- "${COMP_WORDS[COMP_CWORD]}")); }
  _versions_py() { COMPREPLY=($(compgen -W "310 312 313 314 315 3.10 3.12 3.13 3.14 3.15" -- "${COMP_WORDS[COMP_CWORD]}")); }
  _versions_go() { COMPREPLY=($(compgen -W "$(_dev_env_go_versions | tr '\n' ' ')" -- "${COMP_WORDS[COMP_CWORD]}")); }
  complete -F _versions_java set-java
  complete -F _versions_py set-py set-python
  complete -F _versions_go set-go
elif [ -n "${ZSH_VERSION:-}" ] && (( $+functions[compdef] )); then
  compdef '_values java-version 8 17 21 25' set-java
  compdef '_values python-version 310 312 313 314 315 3.10 3.12 3.13 3.14 3.15' set-py set-python
  compdef "_values go-version \$(_dev_env_go_versions | tr '\n' ' ')" set-go
fi

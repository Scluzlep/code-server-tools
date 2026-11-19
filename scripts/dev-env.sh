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
  case "$v" in 3.10|310) v=310;;3.12|312) v=312;;3.13|313) v=313;;3.14|314) v=314;;
    *) echo "Usage: set-py 310|312|313|314" >&2; return 1;; esac
  export CURRENT_PY="/opt/pyenvs/py$v"
  export PATH="$CURRENT_PY/bin:$(printf '%s' "$PATH" | sed -E 's#(^|:)/opt/pyenvs/[^:]+/bin(:|$)#\1#g' | sed 's/^://;s/:$//')"
}
set-python() { set-py "$@"; }
set-go() {
  local v="${1:-}"
  case "$v" in 1.26|1.26.11) v=1.26.11;;1.27|1.27.4) v=1.27.4;;
    *) echo "Usage: set-go 1.26.11|1.27.4" >&2; return 1;; esac
  export GOROOT="/opt/go/go$v"
  export PATH="$GOROOT/bin:$(printf '%s' "$PATH" | sed -E 's#(^|:)/opt/go/[^:]+/bin(:|$)#\1#g' | sed 's/^://;s/:$//')"
}
if [ -n "${BASH_VERSION:-}" ]; then
  _versions_java() { COMPREPLY=($(compgen -W "8 17 21 25" -- "${COMP_WORDS[COMP_CWORD]}")); }
  _versions_py() { COMPREPLY=($(compgen -W "310 312 313 314 3.10 3.12 3.13 3.14" -- "${COMP_WORDS[COMP_CWORD]}")); }
  _versions_go() { COMPREPLY=($(compgen -W "1.26.11 1.27.4" -- "${COMP_WORDS[COMP_CWORD]}")); }
  complete -F _versions_java set-java
  complete -F _versions_py set-py set-python
  complete -F _versions_go set-go
elif [ -n "${ZSH_VERSION:-}" ] && (( $+functions[compdef] )); then
  compdef '_values java-version 8 17 21 25' set-java
  compdef '_values python-version 310 312 313 314 3.10 3.12 3.13 3.14' set-py set-python
  compdef '_values go-version 1.26.11 1.27.4' set-go
fi

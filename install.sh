#!/bin/sh
# Link this repo's skill and agents into ~/.claude so every project on this machine sees them.
# Re-run after cloning on another machine. Replaces only links into this repo and dangling links; skips anything else.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
target=${CLAUDE_HOME:-$HOME/.claude}
mkdir -p "$target/skills" "$target/agents"

link() {
  src=$1; dst=$2
  if [ -L "$dst" ]; then
    case $(readlink "$dst") in
      "$here"/*) ;;
      *)
        if [ -e "$dst" ]; then
          echo "skip: $dst links to $(readlink "$dst"), not this repo" >&2
          return 0
        fi
        ;;
    esac
    rm "$dst"
  elif [ -e "$dst" ]; then
    echo "skip: $dst exists and is not a link (move it away to use this repo's version)" >&2
    return 0
  fi
  ln -s "$src" "$dst"
  echo "linked $dst"
}

link "$here/skills/lean-delegation" "$target/skills/lean-delegation"
for f in "$here"/agents/*.md; do
  link "$f" "$target/agents/$(basename "$f")"
done
echo "Done. Agent definitions load when a Claude Code session starts: open a new session."

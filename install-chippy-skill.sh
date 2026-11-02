#!/bin/sh
set -eu

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/.agents/skills/chippy"
TARGET_DIR="${1:-$HOME/.agents/skills/chippy}"

if [ "$#" -gt 1 ]; then
  echo "Usage: $0 [destination-directory]" >&2
  exit 2
fi
case "$TARGET_DIR" in
  ''|/|.|..|"$HOME") echo "Choose a dedicated skill destination directory" >&2; exit 2 ;;
esac
if [ ! -d "$SOURCE_DIR" ]; then
  echo "Source skill not found at $SOURCE_DIR" >&2
  exit 1
fi
mkdir -p "$(dirname -- "$TARGET_DIR")"
rm -rf -- "$TARGET_DIR"
cp -R -- "$SOURCE_DIR" "$TARGET_DIR"
cp -- "$SCRIPT_DIR/LICENSE" "$TARGET_DIR/LICENSE"
echo "Installed Chippy skill to $TARGET_DIR"

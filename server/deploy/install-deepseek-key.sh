#!/bin/sh
set -eu

source_env=${1:?source env path is required}
target_env=${2:?target env path is required}
backup_env=${3:?backup env path is required}
temporary_env="${target_env}.thinkpad-tmp.$$"

cleanup() {
  rm -f -- "$temporary_env"
}
trap cleanup EXIT HUP INT TERM

umask 077
key_line=$(tr -d '\r' < "$source_env" | grep '^DEEPSEEK_API_KEY=' | tail -n 1)
if [ -z "$key_line" ]; then
  echo 'DEEPSEEK_API_KEY is missing.' >&2
  exit 1
fi

cp -p -- "$target_env" "$backup_env"
grep -v '^DEEPSEEK_API_KEY=' "$target_env" > "$temporary_env"
printf '%s\n' "$key_line" >> "$temporary_env"
chmod 600 "$temporary_env"
mv -f -- "$temporary_env" "$target_env"
rm -f -- "$source_env"
trap - EXIT HUP INT TERM

echo 'DeepSeek key installed.'

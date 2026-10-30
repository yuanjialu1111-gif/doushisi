#!/bin/sh
set -eu
# Export happens after the backup container has validated and committed its archive.
repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository"
if [ "$#" -gt 1 ]; then echo 'Usage: sh tools/backup.sh [/absolute/path/new-backup-directory]' >&2; exit 2; fi
if [ "$#" -eq 1 ]; then
  case "$1" in /*) ;; *) echo 'Export directory must be absolute.' >&2; exit 2;; esac
  if [ -e "$1" ]; then echo 'Export directory already exists; refusing to overwrite.' >&2; exit 2; fi
fi
docker compose exec -T backup node /operations/backup-cli.mjs once
if [ "$#" -eq 1 ]; then
  umask 077
  mkdir "$1"
  archive=$(docker compose exec -T backup node /operations/backup-cli.mjs latest)
  case "$archive" in dss-*.dump) ;; *) echo 'Invalid archive name from backup service.' >&2; exit 1;; esac
  for suffix in '' .sha256 .json; do
    docker compose cp "backup:/backups/$archive$suffix" "$1/$archive$suffix"
  done
  printf 'Exported validated backup to %s\n' "$1"
fi

#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_FORMAT="${BACKUP_FORMAT:-custom}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

if [ "$BACKUP_FORMAT" = "plain" ]; then
  OUT="$BACKUP_DIR/kiranaos-$STAMP.sql"
  pg_dump --no-owner --no-privileges --file "$OUT" "$DATABASE_URL"
else
  OUT="$BACKUP_DIR/kiranaos-$STAMP.dump"
  pg_dump --format=custom --no-owner --no-privileges --file "$OUT" "$DATABASE_URL"
fi

if [ ! -s "$OUT" ]; then
  echo "Backup failed or empty: $OUT" >&2
  exit 1
fi

echo "Backup written to $OUT"

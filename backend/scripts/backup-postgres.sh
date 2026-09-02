#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
# Keep pg_dump --format=custom --no-owner --no-privileges, URL normalization,
# exclusive output ownership, streaming checksums and off-site uploads in one
# implementation so this entry point cannot bypass the tested safety behavior.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$SCRIPT_DIR/postgres-backup-create.js"

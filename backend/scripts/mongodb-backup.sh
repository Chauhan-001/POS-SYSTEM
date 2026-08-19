#!/usr/bin/env bash
# MongoDB backup with rotation for the Freebuff POS platform.
#
# Creates a timestamped, gzip-compressed mongodump archive of the application
# database, writes a sha256 sidecar, then prunes old archives so storage stays
# bounded. Rotation only runs AFTER a successful dump — a failed backup never
# deletes older good backups.
#
# Usage:
#   ./scripts/mongodb-backup.sh                 # defaults below
#   MONGODB_URI=... BACKUP_DIR=/backups/pos KEEP=7 ./scripts/mongodb-backup.sh
#
# Env:
#   MONGODB_URI  connection string, should include the database name
#                (default: mongodb://localhost:27017/pos)
#   BACKUP_DIR   where archives are stored (default: ./backups)
#   KEEP         number of archives to retain (default: 7)
#   DB_NAME      overrides the database name auto-extracted from MONGODB_URI
#
# Requires: mongodump (mongodb-database-tools). Exit codes:
#   0 success, 1 tool missing / bad config, 2 dump failed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."  # backend/

URI="${MONGODB_URI:-mongodb://localhost:27017/pos}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP="${KEEP:-7}"

# --- Validate ---------------------------------------------------------------
if ! command -v mongodump >/dev/null 2>&1; then
  echo "[backup] ERROR: mongodump not found. Install mongodb-database-tools" >&2
  echo "[backup]   Debian/Ubuntu: apt-get install -y mongodb-database-tools" >&2
  echo "[backup]   or download from https://www.mongodb.com/try/download/database-tools" >&2
  exit 1
fi

if ! [[ "$KEEP" =~ ^[1-9][0-9]*$ ]]; then
  echo "[backup] ERROR: KEEP must be a positive integer, got '$KEEP'" >&2
  exit 1
fi

# Extract the database name from the URI (strip userinfo, path, query).
DB_NAME="${DB_NAME:-$(printf '%s' "$URI" | sed -E 's#^[^/]*//[^/]*/##; s#\?.*$##; s#/$##')}"
DB_NAME="${DB_NAME:-pos}"

# Redact credentials for any output (never echo the password).
REDACTED_URI="$(printf '%s' "$URI" | sed -E 's#(//[^:/@]+):[^@/]+@#\1:****@#')"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$BACKUP_DIR/pos-$STAMP.gz"

echo "[backup] db:      $DB_NAME"
echo "[backup] uri:     $REDACTED_URI"
echo "[backup] archive: $ARCHIVE"

# --- Dump -------------------------------------------------------------------
# shellcheck disable=SC2086
if ! mongodump --uri="$URI" --db="$DB_NAME" --archive="$ARCHIVE" --gzip; then
  echo "[backup] ERROR: mongodump failed; keeping existing archives untouched" >&2
  exit 2
fi

# --- Integrity sidecar ------------------------------------------------------
sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"
SIZE="$(du -h "$ARCHIVE" | cut -f1)"
echo "[backup] ok ($SIZE, sha256 written)"

# --- Rotation (only after a successful dump) --------------------------------
mapfile -t OLD < <(ls "$BACKUP_DIR"/pos-*.gz 2>/dev/null | sort | head -n "-$KEEP" || true)
if [[ ${#OLD[@]} -gt 0 ]]; then
  echo "[backup] rotating: removing ${#OLD[@]} archive(s) older than the newest $KEEP"
  for f in "${OLD[@]}"; do
    rm -f -- "$f" "$f.sha256"
  done
else
  echo "[backup] rotation: nothing to prune ($KEEP kept)"
fi

echo "[backup] current archives:"
ls -lh "$BACKUP_DIR"/pos-*.gz 2>/dev/null | sed 's/^/  /' || true
echo "[backup] done"

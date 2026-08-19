#!/usr/bin/env bash
# Restore-verification drill for the Freebuff POS platform.
#
# Restores the latest backup archive into a throwaway scratch database,
# verifies the business-critical collections and their counts, then drops the
# scratch database. Production data is NEVER touched: the drill only reads the
# archive and writes to a uniquely named scratch DB on the same server.
#
# A backup that has never been restored is not trusted — run this after every
# backup (cron) and after any significant schema change.
#
# Usage:
#   ./scripts/mongodb-restore-drill.sh                    # latest archive
#   ./scripts/mongodb-restore-drill.sh --archive /path/to/pos-<stamp>.gz
#
# Env: MONGODB_URI (default mongodb://localhost:27017/pos),
#      BACKUP_DIR (default ./backups)
#
# Requires: mongorestore (mongodb-database-tools). Exit codes:
#   0 drill PASSED, 1 tool missing / config bad, 2 restore failed, 3 verify failed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."  # backend/

URI="${MONGODB_URI:-mongodb://localhost:27017/pos}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
ARCHIVE="${ARCHIVE:-}"

if [[ $# -gt 0 ]]; then
  if [[ "$1" == "--archive" && $# -eq 2 ]]; then
    ARCHIVE="$2"
  else
    echo "Usage: $0 [--archive /path/to/pos-<stamp>.gz]" >&2
    exit 1
  fi
fi

# --- Validate ---------------------------------------------------------------
if ! command -v mongorestore >/dev/null 2>&1; then
  echo "[drill] ERROR: mongorestore not found. Install mongodb-database-tools" >&2
  exit 1
fi

if [[ -z "$ARCHIVE" ]]; then
  ARCHIVE="$(ls "$BACKUP_DIR"/pos-*.gz 2>/dev/null | sort | tail -1 || true)"
  if [[ -z "$ARCHIVE" ]]; then
    echo "[drill] ERROR: no backup archives found in $BACKUP_DIR (run mongodb-backup.sh first)" >&2
    exit 1
  fi
fi

if [[ ! -f "$ARCHIVE" ]]; then
  echo "[drill] ERROR: archive not found: $ARCHIVE" >&2
  exit 1
fi

# Extract the database name from the URI (see mongodb-backup.sh).
DB_NAME="${DB_NAME:-$(printf '%s' "$URI" | sed -E 's#^[^/]*//[^/]*/##; s#\?.*$##; s#/$##')}"
DB_NAME="${DB_NAME:-pos}"

SCRATCH="${DB_NAME}_restore_drill_$(date +%s)"
REDACTED_URI="$(printf '%s' "$URI" | sed -E 's#(//[^:/@]+):[^@/]+@#\1:****@#')"

echo "[drill] archive: $ARCHIVE"
echo "[drill] uri:     $REDACTED_URI"
echo "[drill] scratch: $SCRATCH (dropped after verification)"

# Best-effort cleanup of the scratch DB on any exit path.
cleanup() {
  node -e "
    const { MongoClient } = require('mongodb');
    const uri = process.argv[1], db = process.argv[2];
    (async () => {
      const c = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
      try { await c.connect(); await c.db(db).dropDatabase(); console.log('[drill] scratch dropped (' + db + ')'); }
      catch { console.error('[drill] WARN: could not drop scratch ' + db); }
      finally { await c.close().catch(() => {}); }
    })();
  " "$URI" "$SCRATCH" || true
}
trap cleanup EXIT

# --- Integrity check --------------------------------------------------------
echo "[drill] checking archive integrity (gzip -t)..."
if ! gzip -t "$ARCHIVE"; then
  echo "[drill] ERROR: archive is corrupt (gzip -t failed): $ARCHIVE" >&2
  exit 2
fi

# --- Restore into scratch ---------------------------------------------------
echo "[drill] restoring into scratch database..."
if ! mongorestore --uri="$URI" --archive="$ARCHIVE" --gzip \
     --nsInclude="${DB_NAME}.*" --nsFrom="${DB_NAME}.*" --nsTo="${SCRATCH}.*"; then
  echo "[drill] ERROR: mongorestore failed" >&2
  exit 2
fi

# --- Verify counts, then drop ----------------------------------------------
echo "[drill] verifying restored data..."
if ! node scripts/verify-restore-counts.mjs "$URI" "$SCRATCH" --drop; then
  echo "[drill] FAIL: restore verification did not pass" >&2
  exit 3
fi

echo "[drill] PASS — backup restored, verified, and scratch database removed"

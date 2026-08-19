# Production Runbook

Operational procedures for the POS platform. This runbook documents what exists
today and marks procedures that must be **established** (no fictional commands).
All paths are relative to the repository root.

Version identification: the backend reports its build version at
`GET /api/health` (`version` field, read from `backend/package.json`).

---

## 1. Start / stop / restart the backend

The backend is a single Node process (`backend/dist/server.cjs`).

```bash
# Start (after a build — see Deploy)
cd backend
NODE_ENV=production node dist/server.cjs

# Start with a process manager (recommended: auto-restart + log capture)
# Example with PM2 (not currently configured in the repo — establish it):
#   npx pm2 start dist/server.cjs --name pos-api --cwd backend --env production
```

Stop: send SIGTERM/SIGINT to the process (Ctrl-C, `pm2 stop pos-api`, etc.).
The server performs a graceful shutdown on SIGINT/SIGTERM (disconnects Mongo).

Restart = stop + start. There is no in-place reload.

> **Gap — process supervision:** no PM2/systemd/Docker config exists in the
> repo. The backend logs to stdout only (no log files, no rotation). A process
> manager is required for production so the server restarts after crashes and
> logs are captured/rotated. Establish this before go-live.

## 2. Health check

```bash
curl -s http://<host>:3002/api/health
# {"status":"ok","timestamp":"...","dbConnected":true,"version":"1.0.0"}
```

- `status: ok` — the HTTP server is up.
- `dbConnected: true` — the API can reach MongoDB.
- `version` — the running backend build.
- The server starts even when MongoDB is down (`dbConnected: false`) — DB
  operations fail until the connection returns. Treat `dbConnected: false`
  as an incident (see section 10).

## 3. Check the database

```bash
# Direct connectivity from the API host (assumes mongosh is installed):
mongosh "mongodb://<user>:<pass>@<host>:27017/pos" --eval "db.runCommand({ ping: 1 })"
```

Watch: `dbConnected` in `/api/health`, backend logs for `[DB]` lines,
connection failures, and E11000/Mongo errors in the error logs.

> **Backups:** the repo now ships backup + restore-drill scripts
> (`backend/scripts/mongodb-backup.sh`, `backend/scripts/mongodb-restore-drill.sh`;
> `npm run backup` / `npm run backup:drill` in `backend/`). The remaining
> operator-side step is **scheduling** them (cron) and storing archives
> off-site — see section 5. A database with no tested restore is not a backup.

## 4. Check backend logs

The backend writes structured JSON request lines to stdout:

```
[req] {"ts":"...","method":"GET","path":"/api/health","status":200,"durationMs":9,"userId":null,...,"ip":"..."}
```

With a process manager, logs land in its capture file. Without one, they go to
the terminal/stdout of the process.

- Sensitive fields (password, pin, tokens, keys) are redacted before logging.
- Every 5xx is logged with the stack via the global error handler.
- Fatal process errors are logged as `[FATAL] ...` before exit(1).

> **Gap — log rotation:** no rotation is configured anywhere. Establish
> rotation (e.g. PM2 logrotate or a logrotate config) so logs cannot grow
> without bound.

## 5. Backup & restore

The repo ships two scripts (`backend/scripts/`). They require
`mongodb-database-tools` (mongodump/mongorestore) on the host — install with
`apt-get install -y mongodb-database-tools` or the MongoDB download page.
Set `MONGODB_URI` (include the database name), `BACKUP_DIR`, and `KEEP` as
environment variables or in `backend/.env`.

### Create a backup (rotated)

```bash
cd backend
MONGODB_URI="mongodb://<user>:<pass>@<host>:27017/pos" \
BACKUP_DIR=/backups/pos \
KEEP=7 \
npm run backup
```

Writes `pos-<timestamp>.gz` (+ `.sha256` sidecar) into `BACKUP_DIR` and prunes
archives older than the newest `KEEP`. Rotation runs **only** after a
successful dump — a failed backup never deletes older archives.

Schedule it (example cron, daily 02:00):

```cron
0 2 * * * cd /srv/pos/backend && MONGODB_URI="..." BACKUP_DIR=/backups/pos KEEP=7 npm run backup >> /var/log/pos-backup.log 2>&1
```

Store archives off-site (e.g. rclone/restic to object storage) and alert on
backup failure — both are operator-side and must be configured before go-live.

### Verify a backup (restore drill)

```bash
cd backend
MONGODB_URI="mongodb://<user>:<pass>@<host>:27017/pos" \
BACKUP_DIR=/backups/pos \
npm run backup:drill
```

Restores the latest archive into a throwaway `pos_restore_drill_<ts>`
database on the same server, verifies the business-critical collections
(restaurants, branches, users, products, customers, bills, payments, orders,
inventory events, offers) and their counts, then **drops the scratch
database**. Production data is never written — the drill only reads the
archive. A specific archive: `npm run backup:drill -- --archive /backups/pos/pos-20260817-020000.gz`.

Run the drill after every backup (schedule it) and after any significant
schema change. A backup that has never been restored is not trusted.

### Real restore (disaster recovery)

Only after the drill passes on a staging/non-production target:
1. Restore the archive into the real database
   (`mongorestore --uri "..." --archive=... --gzip --nsInclude="pos.*"
   --nsFrom="pos.*" --nsTo="pos.*"`), following the provider's
   maintenance-window practice.
2. Start the backend against the restored DB; verify `/api/health` reports
   `dbConnected: true`, then log in and open one historical bill.

## 6. Deploy

There is **no automated deployment** (no CD pipeline). Manual deploy:

```bash
# 1. Build all artifacts (must pass CI-equivalent checks first)
npm run build        # backend (esbuild → backend/dist/server.cjs)
                     # admin dashboard (admin-dashboard/dist)
                     # POS frontend (restaurant-pos/Frontend/dist)

# 2. Copy to the server (rsync/scp) and install production env vars:
#    NODE_ENV=production, MONGODB_URI, JWT_SECRET, REFRESH_SECRET,
#    CORS_ORIGIN, ADMIN_CORS_ORIGINS, RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET,
#    AI_API_KEY, UPLOADS_DIR (see below), QR_BASE_URL

# 3. Restart the backend process (section 1), serve static builds behind
#    your web server / reverse proxy.

# 4. Verify (section 2) + login + create a test bill in a sandbox.
```

Critical config notes:

- `JWT_SECRET` and `REFRESH_SECRET` **must** be set — the backend refuses to
  start in production without them.
- `UPLOADS_DIR` **must** be set to a stable path **outside** the deploy
  directory. The default is `<backend>/dist/uploads`, which a fresh deploy
  wipes. Restaurant-uploaded media is lost otherwise.
- `CORS_ORIGIN` / `ADMIN_CORS_ORIGINS` must list the real frontend origins;
  production CORS rejects unknown origins (the dev `allow-all` only applies
  when `NODE_ENV !== production`).
- The backend can serve the built POS SPA itself (`FRONTEND_DIST` default:
  `restaurant-pos/Frontend/dist`) at the same origin as `/api`; the admin
  dashboard and customer site are separate static builds.
- The customer QR site URL is baked into printed QR stickers via
  `QR_BASE_URL` — set the public HTTPS URL, not a LAN IP.

## 7. Rollback

There is no automated rollback. Because deploys are copy-based:

1. Keep the previous `backend/dist`, `restaurant-pos/Frontend/dist`, and
   `admin-dashboard/dist` on the server (e.g. timestamped directories).
2. Roll back = point the process/static server at the previous artifacts and
   restart.
3. The database is **not** rolled back — schema changes are additive
   (Mongoose model fields), so an older app version remains compatible with
   the same database. If a deploy ever included destructive data changes,
   restore from a backup (section 5) instead.

## 8. Check the payment webhook

Razorpay webhook endpoint: `POST /api/razorpay/webhook` (raw-body signed).

- Signature verification is enforced server-side (HMAC-SHA256 with
  `RAZORPAY_WEBHOOK_SECRET`). A failed signature returns 401 and logs.
- Webhook handling is idempotent: payments are only activated when the
  matching server-created payment exists.
- To verify in production: check the backend logs for webhook 200s, and
  confirm a sandbox payment activated the expected `Payment` document.

> **Gap — secret validation:** if `RAZORPAY_WEBHOOK_SECRET` is unset, the
> webhook cannot verify signatures. Set it in production.

## 9. Check POS sync / offline

- Terminals keep an offline queue in `localStorage`
  (`pos_sync_queue`, durable) and replay on reconnect; bill creation is
  idempotent server-side via `clientRef` (unique partial index).
- The POS Sync panel (menu → Sync) shows pending/stalled operations with
  per-op Retry/Discard. A stalled operation needs attention: it failed
  repeatedly and will NOT be replayed automatically.
- Server-side check: count bills per terminal via the API/reports and
  compare with the terminal's `pos_bills` local list.

## 10. Incident procedures

| Situation | Immediate action |
|---|---|
| Backend down | Restart the process (section 1); check logs for `[FATAL]`; health-check after boot. |
| Database down | Backend stays up with `dbConnected:false`; do not restart MongoDB blindly — check disk/memory/network; once up, verify health. |
| Payment gateway down | Terminals should continue with offline/cash; check Razorpay status; monitor webhook queue; do not manually mark payments paid. |
| Internet down at a restaurant | POS operates offline; bills queue locally. When connectivity returns they sync. A terminal must NOT be wiped/reinstalled before its queue has synced. |
| POS device crash | Restart the app; local bills/queue survive (localStorage). If the disk is replaced, the queue is lost — export/sync before hardware change. |
| Printer stops working | Billing is unaffected (printing is output-only after persistence); reprint from the bill history. |
| Sync fails persistently | Open the Sync panel, note the error on the stalled op, retry; if it keeps failing, capture the error and the op payload for the developer. |
| Deployment fails | Roll back (section 7); the old build + database remain compatible. |
| Suspected data corruption | Stop writes to the affected DB, take a dump (section 5), restore to a scratch DB and verify, then investigate before any in-place fix. |
| `dbConnected:false` | Treat as an incident; MongoDB down or unreachable — do not ignore a green HTTP status alone. |

## 11. Alerting

> **Gap — no monitoring/alerting exists** (no uptime checks, error-rate
> tracking, or payment-failure alerts; health checks must be polled
> externally). Establish at minimum:
> - external uptime polling of `/api/health` (`status` + `dbConnected`),
> - log-based alerting on `[FATAL]` / repeated 5xx,
> - disk/storage monitoring (database and backup volumes),
> - payment-webhook failure alerts.

## 12. Production env reference

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | yes | `production` |
| `MONGODB_URI` | yes | MongoDB connection string |
| `PORT` | no | default 3002 |
| `JWT_SECRET` | yes | access-token signing (startup fails if unset in prod) |
| `REFRESH_SECRET` | yes | refresh-token signing (startup fails if unset in prod) |
| `CORS_ORIGIN`, `ADMIN_CORS_ORIGINS` | yes | allowed frontend origins (comma-separated) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | yes | payment gateway |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` | as used | LLM provider config |
| `UPLOADS_DIR` | yes | stable media directory outside the deploy dir |
| `FRONTEND_DIST` | no | POS SPA dist dir (default resolves to the repo layout) |
| `QR_BASE_URL` | yes | public HTTPS URL of the customer QR site |
| `TRIAL_DAYS` | no | trial length (default 7) |

Full list: `backend/.env.example` (all documented; never commit real secrets).

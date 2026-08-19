# Deployment

How the POS platform is built and deployed. This reflects the current
repository — no deployment automation exists yet; see the
[Runbook](./RUNBOOK.md) for operational procedures (start/stop, health,
backup, restore, rollback, incident handling).

## Topology

```
Restaurant POS (Electron app / browser)
        │  HTTPS
        ▼
Backend (Node + Express, backend/dist/server.cjs, port 3002)
        │
        ├── MongoDB (primary datastore)
        ├── Razorpay (payments, webhook: POST /api/razorpay/webhook)
        ├── LLM provider (AI features; keys server-side)
        └── serves statically (production):
              POS SPA          → restaurant-pos/Frontend/dist   (default FRONTEND_DIST)
              uploaded media   → /uploads  (UPLOADS_DIR)
              customer QR page → /public/:token
```

Admin dashboard and the customer website are separate static builds served by
your web server; only the POS SPA is served by the backend by default.

## Build

```bash
npm run build          # backend (esbuild → backend/dist/server.cjs)
                       # admin dashboard (admin-dashboard/dist)
                       # POS frontend (restaurant-pos/Frontend/dist, Vite)
```

Electron POS installer (Windows):

```bash
npm --prefix restaurant-pos run build:electron        # NSIS installer
npm --prefix restaurant-pos run build:electron:dir    # unpacked dir (smoke test)
```

The installer is **unsigned** (`electron-builder` `sign: false` in
`restaurant-pos/electron/electron-builder.json`) and there is **no automatic
update mechanism** — both must be addressed for a public Windows release
(see "Production requirements" below).

## Environment

Production requires, at minimum (all secrets stay server-side; never commit
real `.env` files — see `backend/.env.example`):

- `NODE_ENV=production`
- `MONGODB_URI`, `JWT_SECRET`, `REFRESH_SECRET` (the two secrets are enforced
  — startup aborts without them)
- `CORS_ORIGIN`, `ADMIN_CORS_ORIGINS` (production CORS is an allow-list;
  unknown origins are rejected)
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- `UPLOADS_DIR` — **must** point outside the deploy directory; the default
  (`<backend>/dist/uploads`) is wiped by a fresh deploy
- `QR_BASE_URL` — public HTTPS URL baked into printed QR stickers
- AI keys if AI features are used (`AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`)

## Deploy & verify

Manual, copy-based (no CD):

1. `npm run build` (and CI must pass first — the pipeline gates typecheck,
   tests, security audit, and builds, and smoke-tests the compiled backend
   artifact by launching it and checking `/api/health`).
2. Copy `backend/dist`, `admin-dashboard/dist`, `restaurant-pos/Frontend/dist`
   to the server; keep the previous copies for rollback.
3. Restart the backend process (see Runbook).
4. Verify `GET /api/health` → `{status:"ok", dbConnected:true, version:"…"}`,
   then a sandbox login + bill.

Rollback: point the process/static server at the previous artifacts and
restart; schema changes are additive, so the previous app version stays
compatible with the database (see Runbook §7).

## Production requirements (not yet implemented)

- Process supervision + log capture/rotation (PM2 or equivalent).
- Scheduling + monitoring of the bundled backup tooling: the scripts exist and
  are drill-tested (`npm run backup`, `npm run backup:drill` in `backend/` —
  see `scripts/mongodb-backup.sh` + `scripts/mongodb-restore-drill.sh`), but
  the cron schedule, off-site copy, and alerting on backup failure are
  operator-side and must be configured before go-live.
- Monitoring/alerting on `/api/health`, `[FATAL]` logs, 5xx rate, payment
  webhook failures, disk usage.
- Windows code signing and an update channel for the Electron POS.
- A staging environment running the production build (currently none).

Deployment must not bypass the CI gates (tests, builds, security checks)
except via a documented emergency procedure.

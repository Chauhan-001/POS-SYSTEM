# PHASE 2.15 — BACKUP & DISASTER RECOVERY AUDIT (READ-ONLY)

**Date:** 06 Aug 2026
**Repo root:** `C:\Loyalty_POS system` (git `master`)
**Audit mode:** READ-ONLY. No files modified. All findings verified against source/config/docs.

---

## 1. Executive Summary

The platform ships a **robust *offline-orientation* layer** (per-terminal sync queue, tamper-evident audit chain, nightly in-database report snapshots, AES/GCM-encrypted export artifacts) that superficially resembles resilience. **But it has no actual backup or disaster-recovery capability.** There is:

- **No database backup** — zero `mongodump`/`mongorestore`/snapshot/restore code in `src/` or `scripts/`. The only `database.backup`/`database.restore` strings are unused audit-category labels (`actionRegistry.ts:212-213`).
- **No replication** — `mongoose.connect(mongoUri)` runs with **no options** (`db.ts:129`); `MONGODB_URI` is not even in `backend/.env`, so the app falls back to a standalone `mongodb://localhost:27017/pos`. No `replicaSet`, `readPreference`, or `w=majority` anywhere.
- **No off-site/object storage** — uploaded media (`backend/uploads`) and all export artifacts live only on the single backend host's local disk. No S3/Cloudinary/etc.
- **Nothing encrypted at rest** — neither the database nor any stored file; only optional password-based AES-256-GCM on export artifacts.
- **No backup scheduling, monitoring, alerts, restore validation, RPO, or RTO** — the DR portion of `DEPLOYMENT-CHECKLIST.md:432-435` is unchecked TODOs.
- **No multi-region, no failover, no cluster deployment**, and a single-node topology throughout.

A single failure of the MongoDB host (or the backend instance hosting both DB and media) is an **unrecoverable event with no defined recovery path**. The offline queue and audit archive protect against *short outages*, not *total loss*.

### Bottom line
| | Score |
|---|---|
| **Backup readiness** | **5/100** |
| **Recovery readiness** | **5/100** |
| **Disaster readiness** | **3/100** |
| **OVERALL** | **4/100 — NOT DR-ready** |

This directly contradicts `PRODUCTION-CERTIFICATION.md`'s "✅ PRODUCTION READY" claim.

---

## 2. Recovery Readiness Score

| Recovery concern | Score | Verdict |
|---|---|---|
| Automated DB backup exists | 0/10 | None |
| Restore procedure exists | 0/10 | None (only soft-delete restore of business rows) |
| Point-in-time recovery | 0/10 | None |
| Backup form (schema vs logical vs file) | 0/10 | N/A — no backup |
| Restore-validation test | 0/10 | Never documented/tested |
| Off-site / object storage | 0/10 | None |
| Media backup | 0/10 | None (single disk) |
| Audit backup | 3/10 | In-DB archive + export only; same disk |
| Encryption of backups | 2/10 | Optional AES-GCM on export artifacts only |
| On-off RPO recovery objective | 0/10 | Undefined |
| **Recovery readiness** | **5/100** | Not recoverable from total loss |

---

## 2. Disaster Readiness Score

| Concern | Score | Verdict |
|---|---|---|
| Replication | 1/10 | Single-node; no replica set configured |
| Failover | 0/10 | No secondary, no automatic failover |
| Multi-region / AZ redundancy | 0/10 | None |
| Backup scheduling | 0/10 | No scheduler/cron/mongodump |
| Backup monitoring | 0/10 | No last-backup timestamp, no backup health |
| Backup alerts | 0/10 | Alerts are security-only, not data |
| Graceful lifecycle | 1/10 | `disconnectDB` exists but never wired; no SIGTERM handler |
| Cluster / multi-node deployment | 0/10 | Single PM2-style process only |
| **Disaster readiness** | **3/100** | Single point of failure for all state |

## 3. Backup Score (consolidated)

| Domain | Weight | Score | Weighted |
|---|---|---|---|
| Database backups | 30% | **0/100** | 0 |
| Media/object backup | 15% | **0/100** | 0 |
| Encryption at rest | 10% | **10/100** | 1 |
| Retention/archival | 15% | **30/100** | 4.5 |
| Scheduling | 10% | **0/100** | 0 |
| Monitoring & alerts | 10% | **0/100** | 0 |
| Restore validation | 10% | **0/100** | 0 |
| **Backup score** | | | **≈ 5/100** |

---

## 4. MongoDB Backups — ABSENT

| # | Check | Status | Evidence |
|---|---|---|---|
| 1 | `mongodump` / logical dump | 🔴 Absent | no `mongodump`/`dump` grep hit in `src/` or `scripts/` |
| 2 | `mongorestore` / restore | 🔴 Absent | no restore code |
| 3 | Snapshot/backup orchestration service | 🔴 Absent | `scripts/` = migrations/seeds/cleanup only |
| 4 | Backup from within backend | 🔴 Absent | `actionRegistry.ts:212-213` labels only, no code path |
| 5 | Off-machine copy | 🔴 Absent | no cron/Task Scheduler/`.ps1`/`.bat` backup scripts |

**Verdict:** `MONGODB_URI` is not set in `backend/.env`; the default `mongodb://localhost:27017/pos` (config.ts:42) is assumed. Losing the local Mongo = losing bills, orders, customers, inventory, loyalty, subscriptions, settings. **Unrecoverable by any code in the repo.**

## 5. Restore — soft-delete vs real restore

The word "restore" appears only for **soft-delete recovery** (restore a deleted Restaurant/Owner/Plan row) and **audit-log archive restore** (`restoreArchived`, `retentionService.ts:132-147`). Neither is a backup restore. There is no restore endpoint that reconstructs data from a dump.

## 6. Point-in-Time Recovery (PITR)

**Absent.** No oplog retention, no continuous archiving, no `prit` target. Because there is no replication, there is no alternate-write target to rewind to. PITR would require an Atlas/cloud service layer that is **not configured or even referenced in env**.

## 7. Backup Retention & Archival

| Surface | Retention | Location | Off-site? |
|---|---|---|---|
| `AuditLog` → `AuditLogArchive` | 365d default (`AUDIT_RETENTION_DAYS`), module overrides; legal-hold aware | **Same MongoDB DB** (separate collection) | ❌ |
| Audit export files | **None — never deleted** relay | `{uploads}/audit-exports` local disk | ❌ |
| Report export files | **None** | `{uploads}/reports-exports` local disk | ❌ |
| ReportSnapshot / InactiveRestaurantSnapshot | None (upsert daily) | Same DB | ❌ |
| Terminal offline queue | 7-day TTL, max 5 retries, quota → 20 | browser localStorage | ❌ |

**Key gap:** archival/export artifacts share the same disk + same DB they protect → a disk/DB failure destroys the "backup" alongside the source.

## 8. Snapshots (in-DB aggregation buckets, NOT backups)

`reportJobs.ts:20-55` writes `ReportSnapshot` documents for growth/revenue/subscription/ai_revenue/usage/feature each day, plus `InactiveRestaurantSnapshot`. These are **materialized analytic views stored in the same Mongo DB** — useful for report history, **useless as DR** because if the DB dies, the snapshots die too. `runInactiveSnapshotJob`'s `deleteOne({snapshotDate})` guard prevents duplicates, not backups.

## 9. Object Storage — ABSENT

Searched whole backend for `S3`, `aws-sdk`, `@aws-sdk`, `cloudinary`, `gcs`, `azure`, `minio`, `presigned`, `bucket`. All hits are false positives (`buckets` aggregation windows, an "azure" STT enum, `@aws-sdk/credential-providers` as a **transitive dep of the MongoDB driver TSDL stack** in package-lock). `package.json:13-28` lists **no** storage SDK.
**Verdict:** No S3/Cloudinary/GCS bucket anywhere. `config.publicBaseUrl` exists (`config.ts:157`) as a *read* URL builder, but no code writes to a remote target.

## 10. Media Backup — single disk, single copy

- Uploads go to `config.uploads.dir` (default `backend/uploads`) via `fs.writeFile` (`mediaService.ts:133-138, 324-329`), served by `express.static` on the same disk (`server.ts:261`).
- Restaurant logos, covers, support-ticket attachments → if the host disk is lost, the DB only holds dead paths (`logoUrl`, `media.logo.key`).
- `uploads/` is not git-ignored and not committed — invisible to VCS, exists only on the live server.
- **Verdict:** media has **zero redundancy**; survive only on one disk.

## 11. Audit Backup

- The **audit chain** is tamper-evident (hash-chained, `auditService.ts`) and archivable to `AuditLogArchive` (cold), but the archive lives **in the same DB**. A DB loss loses the archive.
- Audit **export artifacts** (CSV/JSON/XLSX/PDF, SHA-256-signed, optional AES-256-GCM) are written to local disk (`exportService.ts:217-285`) with **no retention/cleanup** → unbounded disk growth and stale-PII exposure on the same disk.
- **Verdict:** audit has exports that *could* be an off-site log copy if shipped, but nothing ships them; they remain on-box.

## 12. Encryption — nothing at rest

| Surface | Encrypted? | Mechanism / key mgmt |
|---|---|---|
| MongoDB DB | **No** (passwords bcrypt-hashed only) | Relies on host security; no KMS/field encryption |
| Uploaded media | **No** | raw bytes on disk |
| Audit/report exports | Optional (AES-256-GCM + scrypt, per-file) | request-supplied password, stripped from persisted job; lost PWD = unrecoverable |
| Secrets in `Restaurant` | random hex, not encrypted | `crypto.randomBytes` |
| JWT | No (signed) | env secret |

**Verdict:** any disk/cold-storage compromise exposes all data plaintext. Backup-at-rest requires host-level (Atlas/disk) encryption, which is out of scope of this repo and **not provisioned**.

## 13. Backup Scheduling — ABSENT

No `cron`, `node-cron`, Windows Task Scheduler `.bat`, or `mongodump` schedule. The only recurring jobs:
- Audit retention (6h) — `retentionService.ts:201`
- Nightly report snapshots (24h) — `reportJobs.ts:81-84`
- Subscription transitions (60s) — `subscriptionScheduler.ts:10`
- Cache/rate-limit sweeps — not backups.

None writes an off-site backup. `start-all.bat/.ps1` and `start-electron-all.bat` are local dev launchers, not backup tooling.

## 14. Backup Monitoring & Alerts — **none**

- `GET /api/health` reports only `{ status, dbConnected }` (`server.ts:185-191`); no last-backup timestamp, no backup-uptime, no backlog bytes.
- `deviceService.heartbeat()` tracks terminal uptime (not data).
- `auditService.maybeAlert()` → `AuditAlert` is security (tamper, brute-force, critical actions) — **no backup-failure alert**.
- No PagerDuty/Slack/email (Phase 2.12 confirmed ~29% observability; no data/DR metric).

**Verdict:** if a backup job ran and failed, nothing would notice.

## 15. Restore Validation / Restore-Test — **none**

No backup → no restore → no restore-validation procedure or documented run. `DEPLOYMENT-CHECKLIST.md:433-434` lists "Test backup restoration in staging" as an **unchecked TODO** (✔ unchecked). Nothing automates or verifies a restore.

## 16. Replication & Failover — **not configured**

- `mongoose.connect(mongoUri)` called with **no options** (`db.ts:129`) → no `replicaSet`, `readPreference`, `w=majority`, `retryWrites`.
- No `replicaSet` string anywhere in repo or `.env`.
- No secondary; no automatic failover; no write-acknowledgment guarantee.

**Impact:** if the primary blows up, no failover, no read-from-secondary, and unacknowledged writes may be lost even on a "successful" response.

## 17. Multi-Region / Geo-Redundancy — **none**

No multi-DB, multi-region, cross-AZ, or geographic distribution anywhere in code or docs. `ARCHITECTURE.md` shows a single Express → single Mongo topology. No global DR site, no geo-replication.

## 18. RPO / RTO

| Objective | Documented? | Audit estimate if a backup were added |
|---|---|---|
| **RPO** (recovery-point) | **Undefined.** No `RPO`/`RTO`/retention-policy text in docs | Currently = **total loss** (no recovery point at all); with daily dump ≈ up to 24h |
| **RTO** (recovery-time) | **Undefined** | Currently = unrecoverable; with dump + restore ≈ hours → likely failures |

Only "retention" text refers to audit-log retention and the 7-day terminal queue — not data backup retention.

## 19. DR Plan / Runbook — **none**

No DR document, runbook, or recovery sequence exists. The single reference is an unchecked checklist item. No designation of who restores, from what, or how.

## 20. Multi-node Deployment / Cluster Topology — **single node**

- No Docker/k8s/helm/nginx/systemd/`ecosystem.config.js`. Only a manual `node dist/server.cjs` / "`pm2 start`" reference in the checklist.
- Single Express process, single event loop, single Mongo, single host disk. No extent of scalability or failover.

## 21. Offline Terminal Data — a short-outage mitigation, NOT a backup

`restaurant-pos/Frontend` uses **localStorage only** (no IndexedDB):
- `data.ts` caches API reads with short TTLs (products/employees 24h; customers/expenses 5m; orders/tables 30s).
- `syncEngine.ts` keeps a **write-only** `pos_sync_queue` (POST/PUT/PATCH/DELETE), max 5 retries, dropped after 7 days or quota → 20 entries.
- `replayQueue()` exists but **isn't auto-triggered on reconnect** (manual + React-subscriber dependent) — a known dangling gap.

**Verdict:** terminals cannot reconstruct backend state after total loss; the queue is isolated, expiring, and write-only. Replays otherwise.

## 22. Frontend DR assessment — per-browser, disposable

- Data is siloed per terminal browser, per-origin, ~5-10 MB quota, silently truncated on quota overflow.
- Local data is explicitly **"not the source of truth"** (`data.ts:9-41`).
- Clearing browser storage/loss of the device removes everything local.

**Verdict:** no terminal-side recovery contribution.

---

## 23. What Is Actually Lost (blast radius)

| Event | What is lost | Recoverable? |
|---|---|---|
| Backend host disk lost | All uploaded media (logos, covers, ticket attachments), all export artifacts | ❌ No, metadata points to dead paths |
| MongoDB host lost | All transactional data + audit archive + report snapshots + loyalty + inventory + subscriptions | ❌ No code path to restore |
| Both (same host) lost | *Everything* | ❌ Total loss |
| DC / region lost | Everything (single-region) | ❌ No geo-redundancy |
| One terminal cleared/lost | That terminal's offline queue | ❌ Lost (max 7-day window anyway) |

**What survives:** only the git codebase, and (while the DB lives) audit/exports that share its disk.

---

## 24. Implementation Matrix (priority)

> Read-only audit — recommendations only.

| P0 | Action | Layer | Effort | Impact |
|---|---|---|---|---|
| **P0** | **Automated daily `mongodump`** off-box (cron + copy to object storage / another host); gzip it | Backup | S-M | **Critical** — enables *any* recovery |
| **P0** | **Configure `MONGODB_URI` to a managed replica set (Atlas/own)** with `replicaSet`, `w=majority`, `retryWrites`, `readPreference=secondaryPreferred`; set in `.env` | DR | S | Critical — failover + ack writes |
| **P0** | **Move media to object storage (S3/Cloudinary)** with presigned writes & CDN; keep only URLs in Mongo | Media | M | Critical — media survivability |
| **P0** | **Enable Atlas PITR** (or oplog backups) + snapshots with a defined retention window | DR | S | Point-in-time recovery |
| **P0** | **Define & document RPO/RTO + a recovery runbook** (owners, steps, staging restore test) | Ops | S | Critical governance |
| P1 | **Ship audit/report exports off-box nightly** (background job) so the tamper-evident log has a real off-site copy | Audit | M | Audit durability |
| P1 | **Encrypt the saved backup/export at rest** using a KMS/cloud-managed key instead of optional request PWD | Security | M | Cold-storage protection |
| P1 | **Add backup-health telemetry**: last-backup timestamp, backup-size, restore-test-in-batch, alert (Slack/email) on failure | Observability | M | Backup trust |
| P1 | Wire **graceful shutdown** (capture `server`, SIGTERM/SIGINT → `server.close()` + `disconnectDB()`) to avoid partial-write loss on restart | Ops | S | Data integrity |
| P1 | Add **retention/purge** for audit/report export files (age-based cleanup) | Storage | S | Disk & PII hygiene |
| P1 | Scope **auto-trigger of `replayQueue()` on reconnect** so terminals stop accumulating a dead-ended queue | Frontend | S | Offline reliability |
| P2 | Consider **deployment to multi-node** (PM2 cluster or containerized) + reverse proxy | Infra | M | HA scaling |
| P2 | Enable **DB-level / disk-level encryption** (Atlas or LUKS) | Security | M | At-rest compliance |

---

## 24. Overall Assessment / Verdict

| Question | Verdict |
|---|---|
| **Backup readiness** | **🔴 5/100 — ZERO automated database backup; single-host, single-disk storage. No way to recover from a DB/server loss.** |
| **Recovery readiness** | **🔴 5/100 — No restore path, no PITR, no restore-validation test, no runbook.** |
| **Disaster readiness** | **🔴 3/100 — No replication, no failover, no multi-region, no scheduling/monitoring/alerts, single point of failure.** |
| **Blast radius** | **One disk loss = total data + media loss.** |

## ⚠️ Bottom line
The system is certified "PRODUCTION READY" (`PRODUCTION-CERTIFICATION.md`) for *feature/offline/Security* resilience, but **is NOT backup/disaster-ready** — it has no backup retention, no replication, no encryption-at-rest, and no way to restore from a total loss. The single most important remediation is standing up an **automated `mongodump`-or-Atlas-backup to off-site object storage**, followed by configuring replication + a documented recovery runbook. Until then the database exists as a single point of failure with a blast radius of "everything."
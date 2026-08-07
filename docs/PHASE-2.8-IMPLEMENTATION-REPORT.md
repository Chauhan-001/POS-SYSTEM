# PHASE 2.8 — SUPPORT CENTER: IMPLEMENTATION REPORT

Scope: Build a complete Support / Help-Desk ticket management system on the
existing platform (backend + admin dashboard) while preserving the existing
unified account search. Reuses platform auth, RBAC, validation, audit, activity
and media infrastructure — no isolated/duplicate subsystems.

Status: Implemented. Backend test suite passes (32 files, 484 tests = 456
pre-existing + 28 new).

---

## Files added

Backend:
- `backend/src/models/SupportTicket.ts` — ticket model (number, restaurant,
  category, priority, status, subject, description, source, reporter, assignee,
  attachments, embedded `timeline`, resolution/close metadata, satisfaction,
  soft delete). Enums exported: TICKET_CATEGORIES / TICKET_PRIORITIES /
  TICKET_STATUSES / TICKET_SOURCES.
- `backend/src/models/TicketReply.ts` — public/internal replies per ticket.
- `backend/src/models/TicketCounter.ts` — gapless sequential number allocation.
- `backend/src/services/supportTicketService.ts` — create / get / list /
  update / status state-machine / assign / replies / attachments / soft
  delete / restore / satisfaction / stats / activity. Reuses `queryParser`,
  `auditLogRepo`, `mediaService`, `AppError`, Kakao-style timeline entries.
- `backend/src/validation/support.ts` — strict Zod schemas (body/params/query).
- `backend/src/modules/media/documentTypes.ts` — magic-byte validation for
  PDF / DOCX / XLSX / PPTX / DOC / XLS / CSV / TXT.
- `backend/src/modules/media/attachmentMulterConfig.ts` — multer config for
  images + documents.
- `backend/src/services/__tests__/supportTicketService.test.ts` — 22 tests.
- `PHASE-2.8-IMPLEMENTATION-REPORT.md` — this report.

## Files modified

Backend:
- `backend/src/models/index.ts` — barrel exports for the 3 new models + types.
- `backend/src/modules/media/mediaService.ts` — added `saveAttachment`
  (validated image/document persistence under `attachments/` namespace),
  `deleteAttachment` (path-bounds-checked), `writeAttachment`.
- `backend/src/modules/media/index.ts` — export new document validators +
  `attachmentUpload`.
- `backend/src/modules/media/__tests__/restaurantMedia.test.ts` — document
  attachment tests (PDF persist, ZIP/docx-vs-xlsx disambiguation, spoof reject,
  unsupported MIME reject, delete, path-traversal reject).
- `backend/src/validation/index.ts` — export `./support`.
- `backend/src/controllers/adminSupportController.ts` — added all ticket
  handlers (kept `searchSupport` unchanged).
- `backend/src/routes/admin.ts` — registered `/admin/support/tickets*` routes
  with `requireCollectionAccess('SupportTicket', ...)`, validation, multer,
  `cached`/`invalidateCache('support')`.
- `backend/src/db.ts` — added `SupportTicket` to the seeded admin
  authorization collections (full CRUD+admin for the bootstrap super_admin).

Frontend (admin-dashboard):
- `admin-dashboard/src/api/support.ts` — added ticket types + endpoint clients.
- `admin-dashboard/src/pages/Support.tsx` — rebuilt into a Support console
  (ticket list + create + detail with replies/activity/timeline/assign/status/
  attachments/satisfaction/delete-restore) preserving the unified search.

---

## Workflows

Ticket lifecycle (status state machine, enforced server-side):
- `new → open → in_progress → resolved → closed`
- `pending ↔ open | in_progress`, `resolved → reopened`, `closed → reopened`
- `cancelled` is terminal. Invalid transitions return 400 `AppError`.

Routes (all behind `requireAuth` + `requireCollectionAccess('SupportTicket')`):
- `GET /admin/support/tickets` — search / status / priority / category /
  restaurant / assignee / source / deleted filters, sort (incl. semantic
  priority rank), pagination.
- `GET /admin/support/tickets/stats` — per-status + per-priority counts.
- `POST /admin/support/tickets` — create (validates restaurant).
- `GET|PUT /admin/support/tickets/:id`
- `POST /admin/support/tickets/:id/status|assign|satisfaction|restore`
- `GET|POST /admin/support/tickets/:id/replies`
- `POST|DELETE /admin/support/tickets/:id/attachments[/:attachmentId]`
- `GET /admin/support/tickets/:id/activity` — audit entries.
- `DELETE /admin/support/tickets/:id` — soft delete.
- `GET /admin/support/search` — unchanged.

Consistency guarantees:
- Every mutation appends to the ticket `timeline` **and** writes an append-only
  `AuditLog` entry (action, actor, IP, details).
- Attachments go through `mediaService` (magic-byte validation, client filename
  never used on disk, tenant namespacing, path-traversal guard, unlink on
  delete) — mirrors the hardened restaurant-media path.
- Ticket numbers are sequential/gapless via atomic `TicketCounter` upsert.
- Soft delete only; deleted tickets excluded by default, requestable via
  `deleted=true`.

---

## Limitations / notes

- **No external notification delivery** exists on the platform (confirmed during
  exploration: only campaign message templates and audit logging). All support
  activity is therefore surfaced through the per-ticket timeline + the global
  audit log — the shared in-app channel — rather than creating an isolated
  notification provider. A future notification abstraction can hook into the
  same lifecycle points without API changes.
- **Assignee scope**: assignment validates the target is an active `User` but
  does not restrict to dashboard admins at the service layer (RBAC enforcement
  is route-level). The provided seed grants the bootstrap admin full
  `SupportTicket` access.
- **Search index**: an opportunistic `text` index is declared on the schema; list
  search uses case-insensitive regex over whitelisted fields (safe/escaped), so
  behavior is consistent regardless of whether the text index is materialized.
- **Attachment size**: bounded by the shared `config.uploads.maxFileSizeMB`
  (default 5 MB) — not a separate limit.
- Pre-existing TypeScript errors in the `aiAnalytics` / `analyticsExport` modules
  remain untouched (the suite runs on esbuild/Vitest and passes; they predate
  this phase and are unrelated to Support).

## Verification

- Backend: `npx vitest run` → 32 files passed, 484 tests passed.
- Backend: `npx tsc --noEmit` → no type errors in any Support / media / route /
  validation / model file (remaining errors are the pre-existing ai/analytics ones).
- Frontend: `npx tsc --noEmit` → no type errors in `support.ts` / `Support.tsx`.
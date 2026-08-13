# Production Legal & Compliance Layer — Audit & Implementation Report

> **Important disclaimer:** This report and the accompanying implementation are a *technical* foundation.
> They do **not** make the product legally compliant, do **not** guarantee immunity from lawsuits or
> regulatory action, and do **not** create certifications. Every legal document shipped here is a **draft**
> that must be reviewed and finalised by a qualified lawyer before commercial use. No legal requirements
> have been asserted as binding; items requiring lawyer/business confirmation are explicitly flagged below.

Date: 2026-08-13

---

## A. What was implemented

### A.1 Legal document management system (backend)
- **`LegalDocument` model** — `documentType`, `version`, `title`, `content`, `effectiveAt`, `publishedAt`,
  `status` (draft | published | archived), `jurisdiction`, `language`, `requireAcceptance`,
  `reAcceptanceRequired`, `adminNotes`, `updatedBy`, timestamps. One published version per
  (type, jurisdiction, language). Published/archived docs are **immutable**; only drafts are editable.
- **Lifecycle service** — create draft, edit draft, publish (auto-archives the previous published version),
  archive, version history, current-document lookup.
- **8 draft documents seeded** (never overwritten on restart): Terms of Service, Privacy Policy,
  Restaurant Merchant Agreement, Customer Terms & Conditions, Refund & Cancellation Policy,
  AI & Voice Data Disclosure, Acceptable Use Policy, Data Processing Addendum. All are `v0.1`, `draft`,
  jurisdiction `IN`, language `en`, each with an explicit `[DRAFT FOR REVIEW]` marker and a
  "areas requiring legal review" section.

### A.2 Acceptance / consent recording (backend)
- **`LegalAcceptance` model** — immutable per (user, restaurant, documentType, version); records `userId`,
  `restaurantId`, `documentType`, `documentVersion`, `documentTitle`, `effectiveAt`, `acceptedAt`,
  `context` (onboarding/settings/re_acceptance/pos/admin), `platform`, minimal metadata.
- **`ConsentRecord` model** — **separate** from contractual acceptance; only `marketing_consent` and
  `communications_consent`, never auto-granted, withdrawal recorded (`withdrawnAt`) rather than deleted.
- **Re-acceptance** — `GET /api/legal/my-required` returns published docs the user hasn't accepted
  (including the case where they accepted an older version and the change requires re-acceptance);
  `POST /api/legal/accept` resolves the **current published version server-side** and rejects
  non-current versions; old acceptance rows are never modified/deleted.
- **Server-side enforcement** — acceptance requires an authenticated user; the version under acceptance
  is always validated against the published document set. Frontend never names an arbitrary version.

### A.3 Data-rights / privacy controls (backend)
- **`DataSubjectRequest` model** — auditable log of `export`, `close`, `rectify`, `withdraw` requests
  with status lifecycle (received → processing/completed/rejected/needs_review). Requests are **recorded**,
  not destructive — there is deliberately **no** `DELETE /customer/:id`-style blind deletion.
- Endpoints: `POST /api/legal/export-request`, `POST /api/legal/close-request`,
  `GET /api/legal/my-requests`, `GET /api/legal/my-acceptances`, `GET /api/legal/consents`,
  `POST /api/legal/consents`.
- Owner/manager: `GET /api/legal/acceptance-stats` (per-document acceptance + consent counts for the
  owner's own restaurant only).

### A.4 Admin lifecycle (backend)
- Admin endpoints gated by `requireAdminAuth` (super_admin surface) + collection access:
  `GET/POST /api/legal/admin/documents`, `PATCH /api/legal/admin/documents/:id`,
  `POST .../publish`, `POST .../archive`, `GET /api/legal/admin/documents/:id`,
  `GET /api/legal/admin/versions/:type`, `GET /api/legal/admin/stats`.
- RESTORED: the POS-side legal tab is read-only for staff; only the admin dashboard can publish/archive.

### A.5 Audit events
Registered in the canonical `actionRegistry` (module `legal`, category `compliance`):
`legal.document_created/updated/published/archived`, `legal.accepted`, `consent.granted/withdrawn`,
`privacy.export_requested/account_close_requested/request_received`. Verified live in the audit log.

### A.6 Frontend (POS)
- **Settings → HELP & FAQ** — exactly **35 FAQs** across 8 sections (Ordering 6, Billing & Payments 5,
  Kitchen & KOT 5, Tables & QR Ordering 4, Loyalty & Offers 4, Account & Settings 4, Devices &
  Technical 4, Data & Privacy 3), with live search, plus a **Contact Us** card with
  **email `rajputvansh144@gmail.com`** and **phone `8755783645`** (mailto:/tel: links).
- **Settings → LEGAL & COMPLIANCE** — published documents (accordion, backend-served content),
  required acceptances with Accept buttons, "My acceptances" history with timestamps, optional
  consent toggles (never pre-checked), Data Rights actions (export request, closure request),
  owner-only acceptance statistics.
- **Re-acceptance gate** — `LegalAcceptanceGate` blocks the POS with a modal listing documents that
  require acceptance (server-verified via `GET /api/legal/my-required`); each Accept records
  server-side and the gate clears. Non-blocking if the backend is unreachable.
- New API client functions in `src/api/client.ts` for all legal endpoints.

### A.7 Frontend (customer site)
- **Privacy / Terms / Refunds** links in the storefront footer; content fetched from the backend
  (`/api/legal/current/:type`) and rendered in a modal. Graceful "not available yet" when a document
  is unpublished. Legal text is never hardcoded in the customer site.

### A.8 Tests
`backend/src/modules/legal/__tests__/legal.test.ts` — **15 tests, all passing**:
document lifecycle (publish auto-archives, immutability, draft edits, version history),
acceptance (server-resolved version, idempotency, non-current version rejected, re-acceptance appends),
tenant isolation (acceptances/consents/stats scoped per restaurant), consent separation
(withdrawal recorded, unknown type rejected), data-subject requests, error handling.

---

## B. Existing security/privacy issues discovered and fixed

| Severity | Issue | Fix |
|---|---|---|
| **High (cross-tenant IDOR)** | `subscriptionController` derived `restaurantId` from **client-supplied** body/query (`req.body.restaurantId || req.user.restaurantId`), so any authenticated POS user could read/mutate **another restaurant's** subscription status, plan, payment history, trial, renewal. | All subscription endpoints now derive tenant identity **exclusively from the JWT** (`tenantRestaurantId(req)`). Verified live: passing a foreign `restaurantId` is ignored. |
| **Medium** | `branchesController.createBranch` fell back to a client-supplied `restaurantId` when the JWT value was absent. | Tenant id now comes only from `req.user`. |

Verified safe (no change needed): offers/segments/campaigns derive tenant from JWT; AI analytics
endpoints are admin-surface-gated (client `restaurantId` there is the admin's legitimate filter);
AI prompts are sanitized at the controller boundary (`sanitizer.ts` + `promptSanitizer.ts`); voice
audio is streamed to the STT provider and **not persisted** to disk/DB.

---

## C. Remaining technical risks (engineering)

1. **Admin legal UI** — the admin-dashboard legal management screens (create/publish/archive/versions/
   stats) are implemented as **API endpoints only**. A UI in the Electron admin dashboard is the next
   engineering step; publishing currently requires direct API/admin calls.
2. **Data export artifact** — export/close requests are *recorded*; generating the actual export file
   (reusing `modules/audit/exportService.ts` patterns) and the closure *processing* workflow are next
   steps requiring a policy decision (see D).
3. **Acceptance migration for existing users** — there is no backdated "fake" acceptance. Existing users
   will see the gate once documents are published; a bulk "on-behalf acceptance by admin" flow (if the
   business wants it) is a policy decision.
4. **Pre-existing backend typecheck errors** (unrelated to this work): `AIUsageLog.ts`,
   `consumptionService.ts`, `media.ts`, and some test files fail `tsc`. One pre-existing subscription
   service test (`does NOT transition when dates are in the future`) fails. These predate this task.
5. **Demo data**: the dev DB has 4 documents published (ToS, Privacy, Customer Terms, Refund) purely to
   verify the flow. In production, publish only after lawyer sign-off.

---

## D. Legal review required (lawyer/business-owner questions)

The following **must** be answered by a qualified lawyer/business owner before production:

1. Exact legal entity name + registered address + contact details for every document.
2. Applicable jurisdictions and governing law / dispute venue.
3. Data-controller/data-processor roles between platform, restaurants, and customers (esp. online
   ordering where both platform and restaurant touch customer data).
4. Data retention periods for each category (orders, invoices, audit logs, voice transcripts, uploads).
5. Cross-border data transfer position (AI/STT/payment/hosting providers).
6. Specific privacy rights to honour under applicable law (India: DPDP Act 2023 analysis; any other
   jurisdictions) — including consent lawfulness, grievance officer, and children's-data considerations.
7. Consumer-protection law requirements (refund windows, unfair-trade-practice disclosures, e-commerce
   rules) for restaurant online ordering.
8. Tax/GST treatment of subscription fees and online orders; invoicing obligations.
9. Electronic-contract requirements (e-signature validity for acceptance records).
10. AI/voice disclosure wording and provider retention/training settings.
11. Payment: provider terms, refund handling, and any RBI/payment aggregator obligations.
12. Whether marketing campaigns via SMS/WhatsApp require additional consent or DLT registration.
13. Retention of business records after account closure vs deletion/anonymization of PII — the exact
    schedule to encode in the closure workflow.
14. Third-party processor agreements with every sub-processor.

---

## E. Third-party data-flow inventory (verified in code)

| Provider | Purpose | Data sent | Personal data? | Required? |
|---|---|---|---|---|
| MongoDB (self-hosted localhost) | Primary database | All business data at rest | Yes | Mandatory |
| Hosting/server | Runtime | — | — | Mandatory |
| LLM providers (configurable; Groq/Groq-style API, model llama-3.3-70b, etc. — `AI_*` env) | AI summaries/assistant/inventory | Sanitized sales/inventory summaries | No PII after sanitization | Feature (AI optional) |
| Deepgram (STT, `DEEPGRAM_*` env) | Voice inventory transcription | Audio stream → transcript | Audio (transient) | Feature (voice optional) |
| Razorpay (RAZORPAY_* env) | Subscription payments | Order/payment IDs, amounts; webhook signatures | No card data (never stored) | Mandatory for paid plans |
| Weather API (`WEATHER_API_KEY`) | Weather widget | Location-ish query | No | Feature |
| Google Fonts (CDN) | Fonts on frontends | IP/user-agent (standard) | Minimal | Cosmetic |

*Exact provider names/links to be confirmed from env values at deploy time; none invented here.*

---

## F. Legal-document inventory (current state)

| Document | Version | Status | Where used | Re-acceptance required? |
|---|---|---|---|---|
| Terms of Service | 0.1 | draft (published in dev demo DB) | POS gate + legal tab | Yes |
| Privacy Policy | 0.1 | draft (published in dev demo DB) | POS gate + legal tab + customer footer | Yes |
| Restaurant Merchant Agreement | 0.1 | draft | POS legal tab | Yes |
| Customer Terms & Conditions | 0.1 | draft (published in dev demo DB) | Customer site footer | No |
| Refund & Cancellation Policy | 0.1 | draft (published in dev demo DB) | Customer site footer | No |
| AI & Voice Data Disclosure | 0.1 | draft | POS legal tab | Yes |
| Acceptable Use Policy | 0.1 | draft | POS legal tab | Yes |
| Data Processing Addendum | 0.1 | draft | POS legal tab | No |

---

## G. Data inventory (summary)

| Data | Source | Storage | Purpose | Tenant-scoped | Deletion |
|---|---|---|---|---|---|
| User/employee accounts (name, phone, username, role, hashed PIN/password) | Registration/admin | `users`, `employees` | Auth & RBAC | Yes | Soft-delete exists; closure request recorded |
| Restaurant profile (GSTIN, PAN, addresses, contact) | Onboarding/admin | `restaurants` | Billing & operations | n/a (own) | Closure request recorded |
| Customers (name, phone, loyalty) | POS entry / QR orders | `customers` | Loyalty & service | Yes | Not blindly deleted — see D.13 |
| Orders/bills/invoices/payments | POS + customer site | `orders`, `bills`, `invoices`, `payments` | Business records | Yes | Retained per legal/tax obligations |
| KOT/kitchen records | POS | `kots`, `kotrecords` | Kitchen ops | Yes | Retained |
| QR tokens / requests | QR studio / customer | `qrtokens`, `customerrequests` | QR ordering & calls | Yes | Soft-delete |
| Audit logs (IP, device, actor, hashed chain) | Request pipeline | `auditlogs` | Security/compliance | Yes (restaurantId) | Retention/archive scheduler exists |
| AI usage logs & quotas | AI service | `aiusagelogs`, quota snapshots | Metering/limits | Yes | Retained |
| Voice transcripts | Voice module | business records | Inventory commands | Yes | Transcripts retained; raw audio not stored |
| Uploads (logos, covers) | Admin/POS | `uploads/` on disk | Branding | Per-restaurant paths | Manual |
| Legal acceptances/consents/requests | This module | `legalacceptances`, `consentrecords`, `datasubjectrequests` | Compliance | Yes | Immutable by design |

---

## H. Security findings classification

- **Critical**: none known post-fix.
- **High**: subscription IDOR — **fixed** (tenant now JWT-only). Re-audit after any future route additions.
- **Medium**: admin legal UI missing (API-only); data-export/closure processing not yet automated.
- **Low**: pre-existing tsc errors in unrelated files; pre-existing failing subscription service test.

---

## Files changed / created

**Created (backend)** — `src/modules/legal/models/{LegalDocument,LegalAcceptance,ConsentRecord,DataSubjectRequest}.ts`,
`src/modules/legal/services/legalService.ts`, `src/modules/legal/controllers/legalController.ts`,
`src/modules/legal/routes/legal.ts`, `src/modules/legal/seed.ts`,
`src/modules/legal/__tests__/legal.test.ts`.

**Modified (backend)** — `src/server.ts` (mount `/api/legal` + seed on boot),
`src/modules/audit/actionRegistry.ts` (legal/privacy action metadata),
`src/modules/subscription/subscriptionController.ts` (IDOR fix),
`src/controllers/branchesController.ts` (tenant from JWT only).

**Created (POS frontend)** — `components/HelpFaqTab.tsx`, `components/LegalComplianceTab.tsx`,
`components/LegalAcceptanceGate.tsx`.

**Modified (POS frontend)** — `src/api/client.ts` (legal API functions),
`components/SettingsManager.tsx` (two new tabs),
`src/App.tsx` (acceptance gate + `isOwner` prop).

**Modified (customer site)** — `src/pages/MenuPage.jsx` (legal footer + modal), `src/index.css` (styles).

**Docs** — `docs/legal-compliance-report.md` (this file).

## Database/schema changes
New collections: `legaldocuments`, `legalacceptances`, `consentrecords`, `datasubjectrequests`
(auto-created by Mongoose; indexes in models). Seeded 8 draft documents (idempotent).

## API changes
See section A.4/A.3/A.2 route list. All new routes are under `/api/legal`; admin routes are
super_admin-gated; nothing existing was removed.

## Electron changes
None required for this layer — the Electron admin app calls the same API; the admin legal-management UI
is the flagged next step (C.1).

## Tests executed
- `vitest run src/modules/legal` → **15/15 pass**.
- `vitest run src/modules/subscription/__tests__/subscription.test.ts` → 37/38 (1 pre-existing failure).
- Frontend `tsc --noEmit` → clean. Backend `tsc --noEmit` → no new errors.
- Live E2E (preview): consent grant/withdraw, export/close requests, admin 403 for POS tokens,
  subscription IDOR blocked, publish → gate → accept → gate clears, customer-site legal modal,
  35-FAQ tab, contact us, acceptance stats.

## Production deployment steps
1. Review and finalise all legal documents with a lawyer; edit drafts via the admin API, then publish.
2. Set the legal entity/contact details in the documents (seeded placeholders).
3. Decide the closure/export processing workflow (C.2, D.13) and implement before promising rights.
4. Confirm `AI_*`, `DEEPGRAM_*`, `RAZORPAY_*`, weather keys in the environment; ensure provider terms
   match the AI/Voice disclosure.
5. Deploy backend (new collections auto-index), then frontends (POS + customer site).
6. For existing users: publish documents → the acceptance gate will request re-acceptance; decide with
   counsel whether an admin bulk-acceptance flow is needed.
7. Do **not** claim compliance until the lawyer-reviewed documents are published and the flagged
   decisions are made.

## Note on the dev database
To verify end-to-end, the demo owner's PIN was reset to `demo1234` (`owner_mega_feast_h_8gy4`), and the
Terms/Privacy/Customer-Terms/Refund drafts were published in the dev DB. Change the owner PIN back after
testing, and treat all documents as review drafts.

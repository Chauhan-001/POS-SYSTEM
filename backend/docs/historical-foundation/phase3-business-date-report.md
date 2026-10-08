# Phase 3 — Timezone / Business-Date Foundation Report (READ-ONLY)

**Date:** 2026-10-08 · **Mode:** report only — **no production code changed**
**Contract:** `backend/src/modules/historical-foundation/businessDay.ts` (+ tests)

Phase 3 freezes the business-date contract and reports the D5 impact. It deliberately does
**not** rewire production. Any adoption that changes derived daily facts is a production
behaviour change and requires explicit approval (prompt §48/§51/§55).

---

## 1. Existing infrastructure (reuse before building — prompt §28 "do not duplicate")

The repo **already has** timezone-aware helpers; Phase 3 must prefer them:

| Helper | Location | Behaviour |
|---|---|---|
| `normalizeBusinessDate(input?, now)` | `src/ai/agents/zReportContext.ts:65` | strict `YYYY-MM-DD`; defaults to **yesterday in the process-local** calendar; rejects malformed |
| `toRestaurantLocalTime(gmt, tz)` | `src/context/sports/cricket/cricketRelevance.ts:83` | `Intl` in restaurant tz, **explicit UTC fallback, never silent**, with `fallbackUsed` flag |
| `resolveTimezone` (cricket) | `cricketRelevance.ts:103` | validates IANA via `Intl` |
| marketing window note | `marketingScheduler.ts:45` | window boundary already reasoned about in non-UTC zones |

The Phase 1 contract (`businessDayForTimezone`) is consistent with these; it does **not** replace
them.

## 2. D5 — the actual problem (verified)

`analyticsService.ts:190` (and its peers) derive the day key with a **UTC slice**:

```ts
function getDaysArray(days: number): string[] {
  const today = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today.getTime() - (days - 1 - i) * 86400000);
    return d.toISOString().substring(0, 10);   // ← UTC, ignores Restaurant.timezone
  });
}
```

`Restaurant.timezone` exists (`restaurantService.ts:90,136,404`, default `'UTC'`) but is **not**
consulted here. For an `Asia/Kolkata` tenant, transactions between 00:00–05:30 IST fall on the
**previous** UTC day, so a business day can be split across two keys.

## 3. Blast radius — the UTC-slice idiom is pervasive

`toISOString().slice(0,10)` / `.substring(0,10)` day-keys appear in **~40 backend modules**, e.g.:

```text
analyticsService.ts:190        financeService.ts:45,129,137     expenseService.ts:125
purchaseService.ts:87,198      cashLedgerService.ts:52,88,180   inventoryEventService.ts:76
marketingScheduler.ts:164      marketingCore.ts:91              loyaltyService.ts:44
stockMovementService.ts:322    customerService.ts:744           offerAnalyticsService.ts:40
predictionService.ts:199       mlSyncScheduler.ts:57            segmentSyncService.ts:98
reports/salesReportService.ts:29  reports/closingReportService.ts:66,96  ...
```

**Consequence:** converting every call site to restaurant-timezone is a large, cross-cutting
change that would alter stored/reported daily figures for non-UTC tenants. It is **out of scope
for this historical-data task unless approved** (prompt §51 — do not change existing business
rules to simplify backfill). Instead, the foundation:

- stores a **timezone-correct `businessDate`** on every canonical fact it creates (new data),
- leaves existing derived collections untouched,
- and records the discrepancy for a future, separately-approved migration.

## 4. Scope boundary (what Phase 3 did / did not do)

```text
DID   freeze the contract + pure reference impl (businessDateForTimezone, addBusinessDays, range)
DID   enumerate existing helpers and the UTC-slice blast radius
DID   add unit tests incl. IST 00:30 boundary + invalid-tz throw
DID NOT modify analyticsService or any of the ~40 call sites
DID NOT change Restaurant.timezone semantics or defaults
DID NOT migrate or rewrite any stored daily facts
```

## 5. Recommendation for a future approved phase

1. Adopt a single `businessDateForTimezone(instant, tz)` everywhere day-keys are derived.
2. Resolve `tz` once per run from `Restaurant.timezone` (never from a client/LLM field).
3. Backfill/repair existing `dailysummaries` day-keys **only** for tenants whose tz ≠ UTC, with a
   before/after reconciliation report and explicit approval.

## 6. Safety

```text
Writes: 0.  Existing files changed: 0.  Production behaviour changed: 0.
Additive: contract module (Phase 1) + this report.
```

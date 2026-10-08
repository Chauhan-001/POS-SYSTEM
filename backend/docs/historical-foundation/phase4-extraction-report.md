# Phase 4 — Historical Extraction Report (READ-ONLY)

**Generated:** 2026-10-08 · tool: `backend/scripts/historical/extract.ts`
**Mode:** read-only (`find()`/`distinct()` only — **0 writes**) · DB `pos`
**Dataset version:** `hist-v1` · **Run id:** `extract-<timestamp>`
**Derivation:** `deriveDailySalesFacts@v1` (`src/modules/historical-foundation/derive.ts`)

Reproduce: `npx tsx scripts/historical/extract.ts [--tenant <id>] [--sample N] [--out <file>]`.
Business dates are resolved via the Phase-3 contract (restaurant timezone, never UTC slice).

---

## 1. What was extracted

Canonical `HistoricalFact`s for the sales spine from `bills`, per
`(restaurantId, branchId, businessDate)`:

```text
sales.grossRevenue   sales.subtotal   sales.discount   sales.gst
sales.bills          sales.billsVoided
```

No writes. No new collection. Extracted facts live only in the run report (Phase 5 will add
the durable `historicaldailyfacts` collection under explicit approval).

## 2. Tenant coverage (live result)

| Tenant | tz | Bills | Business dates | Range | Internal missing days | Revenue |
|---|---|---:|---:|---|---|---:|
| `6ac03190…` Urban Tadka | Asia/Kolkata | 19,722 | 180 | 2025-10-01 → 2026-03-29 | 0 | 8,603,712.30 |
| `6aa7b065…` Royal Bistro | Asia/Kolkata | 2,695 | 91 | 2026-06-16 → 2026-09-14 | 0 | 2,644,889.95 |
| `6aa8df88…` Spice Garden | Asia/Kolkata | 764 | 90 | 2026-06-18 → 2026-09-15 | 0 | 597,696.00 |
| `6ab56d53…` | UTC | 12 | 3 | 2026-09-29 → 2026-10-03 | 2 | 1,857.90 |
| `6a8a819c…` | UTC | 5 | 1 | 2026-08-23 | 0 | 517.50 |
| `6a95455a…` | UTC | 1 | 1 | 2026-08-31 | 0 | 50.00 |
| `6a89fc67…` | UTC | 1 | 1 | 2026-08-23 | 0 | 0.00 |

```text
totalFacts      = 5,970
tenants         = 7
writes          = 0
```

## 3. Cross-check (strong validation signal)

The urban-tadka gross revenue derived here — **8,603,712.30** — is **identical** to
`sales.revenue` in the pre-existing `scripts/sim-6m-report.json` (8,603,712.30). The extraction
therefore reproduces the existing report's metric for that tenant, i.e. it reuses the same
arithmetic rather than inventing a second engine (prompt §44). ✅

## 4. Coverage conclusions (report, not repair)

- **Per-tenant windows are disjoint (D7).** No tenant has a full year. The urban-tadka tenant
  covers 180 days; the two newer tenants cover 90–91 days in Jun–Sep 2026.
- **Internal day-gaps are rare** — only the tiny `6ab56d53` tenant has 2 missing days inside its
  own range. The 78-day **global blackout (D9)** is between tenants, not inside one, so it shows up
  as *no tenant owning those dates*, not as a hole inside a tenant's series.
- Voided bills are counted (`sales.billsVoided`) and excluded from revenue.

## 5. Not yet extracted (Phase 4.2)

The sales spine is extracted. Still pending (same read-only tool, additional domains):
customers / loyalty / marketing / inventory / feedback / context. Those add:
`customer.new`, `customer.rfm` (reconstructed), `loyalty.*`, `marketing.redemptions`,
`inventory.*` — each with its classification from `classification.ts` (some RECONSTRUCT /
UNAVAILABLE, never fabricated).

## 6. Safety

```text
Writes: 0.  Collection created: none.  Schema/model changed: 0.  UI changed: 0.
Additive artifacts: derive.ts (+tests), scripts/historical/extract.ts, this report.
```

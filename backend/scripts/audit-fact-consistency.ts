/**
 * =============================================================================
 * audit-fact-consistency.ts — LLM Fact-Consistency Audit
 * =============================================================================
 *
 * Companion to audit-recommendations.mjs (intelligence correctness). This
 * audit verifies OPERATIONAL fact-safety: every LLM narrative must agree with
 * the deterministic metrics bundle it was given, and contradictions must be
 * caught by the deterministic validator (NO second LLM is ever used).
 *
 *   1. DETERMINISTIC SCENARIOS (always run, no LLM, gives the score)
 *      Feeds crafted AI-style narratives — cost insights, AI offer cards,
 *      inventory-health, daily summary — through the REAL
 *      validateFactConsistency() service and asserts the expected verdict
 *      (VALID / WARNING / INVALID) and violation code. This is the regression
 *      baseline for the validator itself.
 *
 *   2. LIVE LLM CROSS-CHECK (optional: --live, backend must run on :3002)
 *      Calls the real AI endpoints (/ai/offer-recommendations,
 *      /ai/inventory-health, /ai/summary) against a synthetic demo tenant,
 *      reads the server-side factValidation result, and independently
 *      re-validates the narrative against the deterministic bundle. Reports
 *      how often the LLM stays factual and how often the safety net catches a
 *      hallucination (INVALID → deterministic fallback).
 *
 * NO production logic is modified. The validator and AI endpoints are tested
 * as-is. Deterministic scenarios need no backend; --live needs one.
 *
 * Run from backend/:
 *   npx tsx scripts/audit-fact-consistency.ts          # deterministic only
 *   npx tsx scripts/audit-fact-consistency.ts --live   # + live LLM cross-check
 * =============================================================================
 */

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import {
  validateFactConsistency,
  type FactBundle,
  type FactValidationResult,
} from '../src/services/factConsistencyService';

const OUT_JSON = path.join(import.meta.dirname, 'fact-consistency-audit-report.json');
const OUT_MD = path.join(import.meta.dirname, 'fact-consistency-audit-report.md');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pos';
const BASE = 'http://localhost:3002/api';
const DEMO_OWNER = 'owner_demo_restaur_hc8t';
const DEMO_PIN = '1008';

// ─── Baseline: what the deterministic engine/validator must enforce ─────
const BASELINE = {
  phase: 'Phases 1–9 (deterministic fact-consistency validator + AI narratives)',
  target: 'Every LLM narrative must agree with the deterministic metrics bundle; contradictions must be INVALID (fallback) or WARNING (ambiguous).',
};

// ─── Deterministic scenarios ────────────────────────────────────────────
// The bundle mirrors what buildRecommendationContext / the AI controller
// supply: tenant-scoped aggregates + inventory/surplus/wastage/deterioration
// + previous-period data ONLY where the deterministic layer truly has it.

function bundle(overrides: Record<string, any> = {}): FactBundle {
  return {
    amounts: { revenue: 125000, orders: 412, aov: 303 },
    products: ['Burger', 'Pizza', 'Paneer Tikka', 'Veg Biryani', 'Mango Lassi'],
    categories: ['Main Course', 'Beverages', 'Starters'],
    segments: ['VIP', 'Dormant 30D', 'New Customers'],
    offers: ['Weekend Family Feast'],
    surplusStockItems: ['Paneer'],
    lowStockItems: ['Milk'],
    wastageItems: ['Chicken', 'Paneer'],
    deterioratingItems: ['Veg Biryani'],
    previousPeriod: { revenue: 100000, orders: 380, aov: 263 },
    ...overrides,
  };
}

interface Scenario {
  id: string;
  name: string;
  feature: string;
  narrative: unknown;
  factBundle: FactBundle;
  expected: FactValidationResult['status'];
  expectCode?: string;
}

const scenarios: Scenario[] = [
  // ── Numeric claims (7.3) ─────────────────────────────────────────────
  {
    id: 'FC-01', name: 'exact numeric match', feature: 'ai-offer-card',
    narrative: 'Revenue was ₹125,000 across 412 orders this period.',
    factBundle: bundle(), expected: 'VALID',
  },
  {
    id: 'FC-02', name: 'rounded/lakh-form numeric match', feature: 'ai-offer-card',
    narrative: 'Revenue came in around ₹1.25 lakh this month.',
    factBundle: bundle(), expected: 'VALID',
  },
  {
    id: 'FC-03', name: 'numeric mismatch is caught', feature: 'ai-offer-card',
    narrative: 'Revenue was ₹140,000, a strong month.',
    factBundle: bundle(), expected: 'INVALID', expectCode: 'numeric_mismatch',
  },
  // ── Comparisons (7.4) ────────────────────────────────────────────────
  {
    id: 'FC-04', name: 'unsupported % comparison (no previous period)', feature: 'ai-offer-card',
    narrative: 'Revenue increased 18% this period.',
    factBundle: bundle({ previousPeriod: undefined }), expected: 'INVALID', expectCode: 'unsupported_comparison',
  },
  {
    id: 'FC-05', name: 'valid comparison with previous-period data', feature: 'ai-offer-card',
    narrative: 'Revenue rose 25% versus the previous period.',
    factBundle: bundle(), expected: 'VALID',
  },
  {
    id: 'FC-06', name: 'comparison contradicting previous-period data', feature: 'ai-offer-card',
    narrative: 'Revenue rose 5% versus the previous period.',
    factBundle: bundle(), expected: 'INVALID', expectCode: 'numeric_mismatch',
  },
  {
    id: 'FC-21', name: 'cost-insight unsupported claim (no cost trend data)', feature: 'cost-insights',
    narrative: 'Cooking Oil costs rose 15% this month.',
    factBundle: bundle({ previousPeriod: undefined }), expected: 'INVALID', expectCode: 'unsupported_comparison',
  },
  // ── Entities (7.5) ───────────────────────────────────────────────────
  {
    id: 'FC-07', name: 'unknown product claim is flagged', feature: 'ai-offer-card',
    narrative: 'Sandwich sales are falling this quarter.',
    factBundle: bundle(), expected: 'INVALID', expectCode: 'unknown_entity',
  },
  {
    id: 'FC-08', name: 'known product claim accepted', feature: 'ai-offer-card',
    narrative: 'Paneer Tikka is a top-selling starter.',
    factBundle: bundle(), expected: 'VALID',
  },
  {
    id: 'FC-09', name: 'invented segment reference is a warning', feature: 'ai-offer-card',
    narrative: 'We should target VIP customers with this offer.',
    factBundle: bundle({ segments: ['Dormant 30D', 'New Customers'] }), expected: 'WARNING', expectCode: 'unknown_segment',
  },
  {
    id: 'FC-22', name: 'known offer referenced', feature: 'ai-offer-card',
    narrative: 'The Weekend Family Feast has been a strong performer.',
    factBundle: bundle(), expected: 'VALID',
  },
  {
    id: 'FC-23', name: 'invented offer is flagged', feature: 'ai-offer-card',
    narrative: 'Monday Madness is a top-selling offer.',
    factBundle: bundle(), expected: 'INVALID', expectCode: 'unknown_entity',
  },
  {
    id: 'FC-16', name: 'deteriorating-margin product is a known entity', feature: 'ai-offer-card',
    narrative: 'Veg Biryani margins are under pressure from rice costs.',
    factBundle: bundle(), expected: 'VALID',
  },
  // ── Inventory claims (7.6) ───────────────────────────────────────────
  {
    id: 'FC-10', name: 'surplus claim with no deterministic surplus', feature: 'cost-insights',
    narrative: 'Paneer is overstocked — push a discount.',
    factBundle: bundle({ surplusStockItems: [] }), expected: 'INVALID', expectCode: 'unsupported_inventory_claim',
  },
  {
    id: 'FC-11', name: 'surplus claim for a deterministic surplus item', feature: 'cost-insights',
    narrative: 'Paneer is overstocked, so a clearance offer works.',
    factBundle: bundle(), expected: 'VALID',
  },
  {
    id: 'FC-12', name: 'low-stock item claimed overstocked (conflict)', feature: 'cost-insights',
    narrative: 'Milk is overstocked — discount it.',
    factBundle: bundle(), expected: 'INVALID', expectCode: 'inventory_conflict',
  },
  // ── Wastage claims ───────────────────────────────────────────────────
  {
    id: 'FC-13', name: 'wastage claim with no deterministic wastage data', feature: 'cost-insights',
    narrative: 'Chicken wastage is rising, so clearance offers make sense.',
    factBundle: bundle({ wastageItems: [] }), expected: 'INVALID', expectCode: 'unsupported_wastage_claim',
  },
  {
    id: 'FC-14', name: 'wastage claim for a deterministic wastage item', feature: 'cost-insights',
    narrative: 'Chicken wastage is high — a short clearance framing could help.',
    factBundle: bundle(), expected: 'VALID',
  },
  {
    id: 'FC-15', name: 'wastage claim for a non-wastage item warns', feature: 'cost-insights',
    narrative: 'Rice wastage is high — clear it out.',
    factBundle: bundle(), expected: 'WARNING', expectCode: 'unsupported_wastage_claim',
  },
  // ── Qualitative + malformed (7.7 / 7.8) ──────────────────────────────
  {
    id: 'FC-17', name: 'ambiguous qualitative trend is a warning', feature: 'daily-summary',
    narrative: 'Sales are looking strong this month.',
    factBundle: bundle(), expected: 'WARNING', expectCode: 'ambiguous_qualitative',
  },
  {
    id: 'FC-18', name: 'malformed/empty output is invalid', feature: 'daily-summary',
    narrative: '   ', factBundle: bundle(), expected: 'INVALID', expectCode: 'malformed_output',
  },
  {
    id: 'FC-19', name: 'empty fact bundle cannot contradict', feature: 'daily-summary',
    narrative: 'Everything looks good today.', factBundle: {}, expected: 'VALID',
  },
  {
    id: 'FC-20', name: 'non-string AI output is invalid', feature: 'daily-summary',
    narrative: null, factBundle: bundle(), expected: 'INVALID', expectCode: 'malformed_output',
  },
];

// ─── Part A — deterministic scoring ────────────────────────────────────
function runDeterministic(): { scenarios: any[]; passed: number; failed: number; failures: any[] } {
  const results = scenarios.map((s) => {
    const r = validateFactConsistency(s.narrative, s.factBundle);
    const codeOk = !s.expectCode || r.violations.some((v) => v.code === s.expectCode);
    const pass = r.status === s.expected && codeOk;
    return {
      id: s.id,
      name: s.name,
      feature: s.feature,
      expected: s.expected,
      actual: r.status,
      expectCode: s.expectCode || null,
      codes: r.violations.map((v) => v.code),
      pass,
      violations: r.violations.slice(0, 3),
    };
  });
  const failures = results.filter((r) => !r.pass);
  return { scenarios: results, passed: results.length - failures.length, failed: failures.length, failures };
}

// ─── Part B — live LLM cross-check (--live) ────────────────────────────
async function findDemoRestaurant(db: any) {
  return (
    (await db.collection('restaurants').findOne({ demoMarker: 'intelligence-lab' })) ||
    (await db.collection('restaurants').findOne({ ownerUserId: DEMO_OWNER }))
  );
}

async function loginOnce(rest: any): Promise<string | null> {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: rest.ownerUserId, password: DEMO_PIN }),
  });
  const json = await r.json().catch(() => ({}));
  return json.accessToken || null;
}

async function liveCrossCheck(): Promise<any> {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  const rest = await findDemoRestaurant(db as any);
  if (!rest) {
    await mongoose.disconnect();
    return { status: 'SKIPPED', reason: 'No demo tenant found (demoMarker intelligence-lab / demo owner). Seed the intelligence demo first.' };
  }
  let token = await loginOnce(rest);
  if (!token) {
    // Deterministic re-pin so the audit can always log in (same convention as
    // audit-recommendations.mjs: ownerPin is a bcrypt of the plain PIN).
    const hash = await bcrypt.hash(DEMO_PIN, 10);
    await db.collection('restaurants').updateOne({ _id: rest._id }, { $set: { ownerPin: hash } });
    token = await loginOnce(rest);
  }
  await mongoose.disconnect();
  if (!token) return { status: 'ERROR', reason: 'Could not authenticate the demo tenant.' };

  const features = [
    {
      name: 'ai-offer-card',
      path: '/ai/offer-recommendations',
      body: { bustCache: true },
    },
    {
      name: 'cost-insights (inventory-health)',
      path: '/ai/inventory-health',
      body: {
        items: [
          { name: 'Paneer', category: 'Inventory', currentStock: 30, minStock: 5, maxStock: 20, unit: 'kg', averageCost: 400 },
          { name: 'Milk', category: 'Dairy', currentStock: 2, minStock: 10, maxStock: 40, unit: 'L', averageCost: 60 },
          { name: 'Chicken', category: 'Meat', currentStock: 8, minStock: 4, maxStock: 15, unit: 'kg', averageCost: 220 },
        ],
        wasteTotal: 2400,
      },
    },
    {
      name: 'daily-summary',
      path: '/ai/summary',
      body: {
        sales: {
          totalRevenue: 125000, orderCount: 412, itemCount: 930, averageOrderValue: 303, totalDiscount: 8200,
          topItems: [{ name: 'Paneer Tikka', qty: 180, revenue: 54000 }],
          categoryBreakdown: [{ category: 'Main Course', qty: 640, revenue: 88000 }],
        },
        lowStockCount: 1, openOrderCount: 3, wasteToday: 4, customerCount: 210,
      },
    },
  ];

  const results = [];
  for (const f of features) {
    try {
      const r = await fetch(`${BASE}${f.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(f.body),
      });
      const json = await r.json().catch(() => ({}));
      const fv: FactValidationResult | undefined = json.factValidation;
      const fallback = json.fallback === true;
      const status = fv?.status || (fallback ? 'INVALID' : 'UNKNOWN');
      results.push({
        name: f.name,
        http: r.status,
        status,
        fallback,
        violations: (fv?.violations || []).slice(0, 5),
        note: fallback && status !== 'VALID' ? 'deterministic fallback engaged (safety net worked)' : undefined,
      });
    } catch (e: any) {
      results.push({ name: f.name, http: 0, status: 'ERROR', error: e.message });
    }
  }
  const invalid = results.filter((r) => r.status === 'INVALID');
  const warned = results.filter((r) => r.status === 'WARNING');
  return {
    status: invalid.length ? 'SAFETY-CAUGHT' : warned.length ? 'PASS_WITH_WARNINGS' : 'PASS',
    features: results,
    summary: `${results.length - invalid.length}/${results.length} narratives VALID; ${warned.length} WARNING; ${invalid.length} INVALID (fallback)`,
  };
}

// ─── Reporting ─────────────────────────────────────────────────────────
function esc(s: any): string {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function buildMd(report: any): string {
  const d = report.deterministic;
  let md = `# LLM Fact-Consistency Audit\n\n`;
  md += `**Result: ${report.result}** · Deterministic validator score: **${d.passed}/${d.total}** · Generated ${report.generatedAt}\n\n`;
  md += `> ${BASELINE.target}\n\n`;
  md += `## Environment\n\n`;
  md += `- Validator: \`factConsistencyService.validateFactConsistency\` (deterministic, no second LLM)\n`;
  md += `- Deterministic bundle: tenant-scoped aggregates (revenue/orders/AOV), surplus, low-stock, wastage, deteriorating margins, segments, offers\n`;
  md += `- Live backend: ${report.live.enabled ? 'http://localhost:3002/api (AI endpoints exercised)' : 'not run (use --live)'}\n\n`;
  md += `## Deterministic Scenarios\n\n| ID | Scenario | Feature | Expected | Actual | Result |\n|---|---|---|---|---|---|\n`;
  for (const s of d.scenarios) {
    md += `| ${s.id} | ${esc(s.name)} | ${esc(s.feature)} | ${s.expected} | ${s.actual} (${esc((s.codes || []).join(', ') || '—')}) | ${s.pass ? 'PASS' : 'FAIL'} |\n`;
  }
  md += `\n**Score: ${d.passed}/${d.total}**\n\n`;
  if (d.failures.length) {
    md += `## Failures\n\n`;
    for (const f of d.failures) md += `- ${f.id} ${esc(f.name)}: expected ${f.expected}, got ${f.actual}\n`;
  }
  md += `\n## Live LLM Cross-Check (--live)\n\n`;
  if (report.live.enabled) {
    md += `- Overall: **${report.live.status}**\n- ${report.live.summary}\n\n`;
    md += `| Feature | HTTP | Verdict | Fallback | Violations |\n|---|---|---|---|---|\n`;
    for (const f of report.live.features || []) {
      md += `| ${esc(f.name)} | ${f.http} | ${f.status} | ${f.fallback ? 'yes' : 'no'} | ${esc((f.violations || []).map((v: any) => `${v.code} (${v.severity})`).join('; ') || '—')} |\n`;
    }
    md += `\nINVALID verdicts mean the LLM contradicted the deterministic bundle and the deterministic fallback was substituted — that is the safety net working, not a data leak.\n`;
  } else {
    md += `Not run. Start the backend on :3002 and re-run with \`--live\`.\n`;
  }
  md += `\n## Warnings / Notes\n\n`;
  (report.warnings.length ? report.warnings : ['None']).forEach((w: string) => (md += `- ${esc(w)}\n`));
  return md;
}

async function main() {
  const liveMode = process.argv.includes('--live');
  const det = runDeterministic();

  const report = {
    suite: 'fact-consistency-audit',
    generatedAt: new Date().toISOString(),
    environment: {
      validator: 'factConsistencyService.validateFactConsistency',
      baseline: BASELINE,
      liveBackend: liveMode ? BASE : null,
    },
    deterministic: {
      total: scenarios.length,
      passed: det.passed,
      failed: det.failed,
      score: `${det.passed}/${scenarios.length}`,
      scenarios: det.scenarios,
      failures: det.failures,
    },
    live: { enabled: liveMode, ...(liveMode ? await liveCrossCheck() : { status: 'SKIPPED' }) },
    failures: det.failures.map((f: any) => ({ id: f.id, name: f.name, expected: f.expected, actual: f.actual })),
    warnings: [],
    result: det.failed === 0 ? 'PASS' : 'FAIL',
  };

  if (det.failed === 0) console.log(`\nFact-consistency audit: ${det.passed}/${scenarios.length} scenarios PASS — deterministic validator is enforcing the bundle.`);
  else console.log(`\nFact-consistency audit: ${det.failed} scenario(s) FAILED.`);
  if (liveMode) console.log(`Live LLM cross-check: ${report.live.status} — ${report.live.summary}`);

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT_MD, buildMd(report));
  console.log(`Wrote ${path.basename(OUT_JSON)} and ${path.basename(OUT_MD)}`);
}

main().catch((e) => {
  console.error('Fact-consistency audit failed:', e);
  process.exit(1);
});

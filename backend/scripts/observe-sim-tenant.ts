/**
 * =============================================================================
 * observe-sim-tenant.ts — run the EXISTING AI tools + Marketing Agent
 * against SIM_RESTAURANT_6M_001 and record what the system actually produces.
 * =============================================================================
 *
 * NO mocks, NO parallel intelligence: every result comes from the real tool
 * definitions through the real registry executor with the simulation tenant's
 * verified ObjectId. ML endpoints (demand/combo/segment) are external services
 * (ML_DEMAND_BASE_URL etc.) — where they are not configured, the tools'
 * honesty fallbacks are expected and recorded as-is.
 *
 *   npx tsx scripts/observe-sim-tenant.ts
 *
 * Writes scripts/sim-6m-observe.json + sim-6m-observe.md
 * =============================================================================
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';

import Restaurant from '../src/models/core/Restaurant';
import { ai } from '../src/ai/index';
import { toolRegistry } from '../src/ai/tools/registry/toolRegistry';
import { executeTool } from '../src/ai/tools/registry/toolExecutor';
import type { ToolContext } from '../src/ai/tools/registry/toolTypes';
import {
  getSalesTrendsToolDefinition,
  getInventoryStatusToolDefinition,
  getExpiryRiskToolDefinition,
  getWastageToolDefinition,
  getStockoutRiskToolDefinition,
  getCustomerSegmentsToolDefinition,
  getRetentionSignalsToolDefinition,
  getMenuPerformanceToolDefinition,
  getProductMarginsToolDefinition,
  getProductCombinationsToolDefinition,
  getActiveOffersToolDefinition,
  getOfferPerformanceToolDefinition,
  getCampaignPerformanceToolDefinition,
} from '../src/ai/tools/marketing/marketingTools';
import {
  getRestaurantProfileToolDefinition,
  getBranchesToolDefinition,
} from '../src/ai/tools/restaurant/restaurantTools';
import {
  getFestivalContextToolDefinition,
  getWeatherContextToolDefinition,
} from '../src/ai/tools/context/contextTools';
import { getSportsContextToolDefinition } from '../src/ai/tools/context/getSportsContextTool';
import { getNearbyCompetitionToolDefinition } from '../src/ai/tools/context/getNearbyCompetitionTool';
import { getDemandForecastToolDefinition } from '../src/ai/tools/ml/getDemandForecastTool';
import { getMarketBasketSignalsToolDefinition } from '../src/ai/tools/ml/getMarketBasketSignalsTool';
import { getMLCustomerSegmentsToolDefinition } from '../src/ai/tools/ml/getMLCustomerSegmentsTool';
import { getUpliftSignalsToolDefinition } from '../src/ai/tools/ml/getUpliftSignalsTool';
import { getOfferResponsePredictionToolDefinition } from '../src/ai/tools/ml/getOfferResponsePredictionTool';
import { runMarketingAgent } from '../src/ai/agents/marketingAgent';

const RESTAURANT_KEY = 'SIM_RESTAURANT_6M_001';
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pos';

// ─── Collect every registered tool definition from the registry ─────────────

async function loadRegistry(): Promise<Map<string, any>> {
  ai.bootstrap(); // idempotent — registers every existing tool
  const map = new Map<string, any>();
  for (const name of [
    'getSalesTrends', 'getInventoryStatus', 'getExpiryRisk', 'getWastage', 'getStockoutRisk',
    'getCustomerSegments', 'getRetentionSignals', 'getMenuPerformance', 'getProductMargins',
    'getProductCombinations', 'getActiveOffers', 'getOfferPerformance', 'getCampaignPerformance',
    'getRestaurantProfile', 'getBranches', 'getFestivalContext', 'getWeatherContext', 'getSportsContext',
    'getNearbyCompetition', 'getDemandForecast', 'getMarketBasketSignals', 'getMLCustomerSegments',
    'getUpliftSignals', 'getOfferResponsePrediction',
  ]) {
    const def = toolRegistry.get(name);
    if (def) map.set(name, def);
  }
  return map;
}

async function main() {
  await mongoose.connect(MONGO_URI);
  const rest = await Restaurant.findOne({ restaurantId: RESTAURANT_KEY }).lean();
  if (!rest) throw new Error(`Simulation tenant ${RESTAURANT_KEY} not found — run simulate-six-month-tenant.ts --execute first.`);
  const rid = String(rest._id);
  const ctx: ToolContext = { tenant: { restaurantId: rid, actorId: 'observe-script', actorName: 'Simulation Observer' } };

  console.log(`Observing ${RESTAURANT_KEY} (${rid})\n`);

  const registry = await loadRegistry();
  console.log(`Registry holds ${registry.size} tool definitions\n`);

  const SPEC_TOOLS = [
    'getSalesTrends', 'getInventoryStatus', 'getExpiryRisk', 'getWastage', 'getStockoutRisk',
    'getCustomerSegments', 'getRetentionSignals', 'getMenuPerformance', 'getProductMargins',
    'getProductCombinations', 'getActiveOffers', 'getOfferPerformance', 'getCampaignPerformance',
    'getRestaurantProfile', 'getBranches', 'getFestivalContext', 'getWeatherContext', 'getSportsContext',
    'getNearbyCompetition', 'getDemandForecast', 'getMarketBasketSignals', 'getMLCustomerSegments',
    'getUpliftSignals', 'getOfferResponsePrediction',
  ];

  const results: Array<Record<string, any>> = [];
  for (const name of SPEC_TOOLS) {
    const def = registry.get(name);
    const row: Record<string, any> = { tool: name, registered: Boolean(def) };
    if (!def) {
      row.works = false;
      row.limitation = 'NOT REGISTERED in the tool registry';
      results.push(row);
      console.log(`  ✗ ${name} — not registered`);
      continue;
    }
    const t0 = Date.now();
    try {
      // getOfferResponsePrediction requires pre-treatment customer features
      // (response-model scoring input) — a bare {} fails input validation.
      const input =
        name === 'getOfferResponsePrediction'
          ? { features: { visitCountDays90: 4, avgBasketValue: 520, lastVisitDaysAgo: 12, preferredMeal: 'dinner' } }
          : {};
      const res = await executeTool(def, input, ctx);
      const ms = Date.now() - t0;
      row.ms = ms;
      if (res.ok) {
        const data: any = (res as any).data;
        row.works = true;
        row.dataAvailable = (data && (data.available === undefined || data.available === true)) ? 'yes' : 'reported-unavailable';
        // Meaningful = produced a non-empty array / non-empty object.
        const probe = JSON.stringify(data ?? {});
        row.meaningful = probe !== '{}' && probe !== '[]' && probe.length > 40;
        row.sample = summarize(name, data);
        console.log(`  ✓ ${name} (${ms}ms) — ${row.dataAvailable}`);
      } else {
        row.works = false;
        row.error = String((res as any).error).slice(0, 220);
        console.log(`  ✗ ${name} — ${row.error}`);
      }
    } catch (err: any) {
      row.works = false;
      row.error = String(err?.message ?? err).slice(0, 220);
      console.log(`  ✗ ${name} — ${row.error}`);
    }
    results.push(row);
  }

  // ── The Marketing Agent (read-only recommendation over the same tools) ──
  console.log('\n── Marketing Agent ──');
  let agent: Record<string, any> = { ran: false };
  try {
    const agentResult = await runMarketingAgent({ tenant: ctx.tenant } as any);
    agent = {
      ran: true,
      targetingSource: agentResult.targetingSource,
      targetingReason: agentResult.targetingReason,
      targetingScope: agentResult.targetingScope,
      targetCount: agentResult.targets.length,
      offerDraft: agentResult.offerDraft,
      evidence: {
        festivalContext: agentResult.festivalContext,
        sportsContext: agentResult.sportsContext,
        competitionContext: agentResult.competitionContext,
        basketContext: agentResult.basketContext,
      },
      nextActions: agentResult.nextActions,
      generatedAt: agentResult.generatedAt,
    };
    console.log(`  source=${agentResult.targetingSource} targets=${agentResult.targets.length}`);
    console.log(`  reason: ${agentResult.targetingReason}`);
    console.log(`  basket: ${agentResult.basketContext ?? '—'}`);
    for (const a of agentResult.nextActions) console.log(`  → ${a}`);
  } catch (err: any) {
    agent.error = String(err?.message ?? err).slice(0, 300);
    console.log(`  ✗ agent failed: ${agent.error}`);
  }

  const ok = results.filter((r) => r.works).length;
  const out = {
    generatedAt: new Date().toISOString(),
    restaurant: RESTAURANT_KEY,
    restaurantId: rid,
    registrySize: registry.size,
    tools: results,
    toolSummary: { total: results.length, works: ok, unavailable: results.filter((r) => r.works && r.dataAvailable === 'reported-unavailable').length, failed: results.filter((r) => !r.works).length },
    marketingAgent: agent,
  };
  const dir = import.meta.dirname;
  fs.writeFileSync(path.join(dir, 'sim-6m-observe.json'), JSON.stringify(out, null, 2));

  let md = `# AI Tools + Marketing Agent — SIM_RESTAURANT_6M_001\n\nGenerated ${out.generatedAt}\n\n`;
  md += `| Tool | Registered | Works | Data | Meaningful | Notes |\n|---|---|---|---|---|---|\n`;
  for (const r of results) {
    md += `| ${r.tool} | ${r.registered ? 'yes' : 'NO'} | ${r.works ? '✓' : '✗'} | ${r.dataAvailable ?? '—'} | ${r.meaningful === true ? 'yes' : r.meaningful === false ? 'thin' : '—'} | ${(r.error ?? '').slice(0, 120)} |\n`;
  }
  md += `\n## Marketing Agent\n\n- targetingSource: **${agent.targetingSource ?? '—'}**\n- reason: ${agent.targetingReason ?? '—'}\n- scope: ${agent.targetingScope ?? '—'}\n- targets: ${agent.targetCount ?? 0}\n- offer draft: ${agent.offerDraft ? agent.offerDraft.title : '—'}\n- evidence: festival=${agent.evidence?.festivalContext ?? '—'} · sports=${agent.evidence?.sportsContext ?? '—'} · competition=${agent.evidence?.competitionContext ?? '—'} · basket=${agent.evidence?.basketContext ?? '—'}\n\nNext actions:\n${(agent.nextActions ?? []).map((a: string) => `- ${a}`).join('\n')}\n`;
  fs.writeFileSync(path.join(dir, 'sim-6m-observe.md'), md);
  console.log(`\nTool summary: ${ok}/${results.length} executed; wrote sim-6m-observe.json + .md`);
  await mongoose.disconnect();
}

function summarize(name: string, data: any): string {
  try {
    switch (name) {
      case 'getSalesTrends': return `trendPoints=${data?.trends?.length ?? data?.summary?.length ?? '?'}`;
      case 'getInventoryStatus': return `items=${Array.isArray(data?.items) ? data.items.length : '?'}`;
      case 'getExpiryRisk': return `atRisk=${Array.isArray(data?.atRisk) ? data.atRisk.length : '?'}`;
      case 'getWastage': return `records=${Array.isArray(data?.wastage) ? data.wastage.length : '?'}`;
      case 'getStockoutRisk': return `risks=${Array.isArray(data?.risks) ? data.risks.length : '?'}`;
      case 'getCustomerSegments': return `segments=${Array.isArray(data?.segments) ? data.segments.length : '?'}`;
      case 'getRetentionSignals': return `signals=${Array.isArray(data?.signals) ? data.signals.length : '?'}`;
      case 'getMenuPerformance': return `products=${Array.isArray(data?.products) ? data.products.length : '?'}`;
      case 'getProductMargins': return `products=${Array.isArray(data?.products) ? data.products.length : '?'}`;
      case 'getProductCombinations': return `pairs=${Array.isArray(data?.combinations) ? data.combinations.length : '?'}`;
      case 'getActiveOffers': return `offers=${Array.isArray(data?.offers) ? data.offers.length : '?'}`;
      case 'getOfferPerformance': return `rows=${Array.isArray(data?.performance) ? data.performance.length : '?'}`;
      case 'getCampaignPerformance': return `campaigns=${Array.isArray(data?.campaigns) ? data.campaigns.length : '?'}`;
      case 'getFestivalContext': return `upcoming=${data?.upcoming?.length ?? 0} calendar=${data?.calendarEvents?.length ?? 0} signals=${data?.signals?.length ?? 0}`;
      case 'getSportsContext': return `matches=${data?.relevantMatches?.length ?? 0}`;
      case 'getNearbyCompetition': return `competitors=${data?.summary?.totalCompetitors ?? 0}`;
      case 'getDemandForecast': return `available=${data?.available}`;
      case 'getMarketBasketSignals': return `available=${data?.available} signals=${data?.signals?.length ?? 0}`;
      case 'getMLCustomerSegments': return `available=${data?.available} segments=${data?.segments?.length ?? 0}`;
      case 'getUpliftSignals': return `available=${data?.available}`;
      case 'getOfferResponsePrediction': return `available=${data?.available}`;
      default: return 'ok';
    }
  } catch {
    return 'ok';
  }
}

main().catch((err) => {
  console.error('Observe failed:', err);
  process.exit(1);
});

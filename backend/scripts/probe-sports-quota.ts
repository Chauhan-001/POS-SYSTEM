/**
 * Probe: call the getSportsContext tool the same way the marketing agent does
 * and print availability + quota state (never key material).
 * Run with: cd backend && npx tsx scripts/probe-sports-quota.ts
 */
import { ai } from '../src/ai';
import { executeGetSportsContext } from '../src/ai/tools/context/getSportsContextTool';

async function main(): Promise<void> {
  ai.bootstrap();
  const out = await executeGetSportsContext({ daysAhead: 14 }, { tenant: { restaurantId: '6ac031900f636f7cc8ab6f8f' } });
  console.log(JSON.stringify({
    available: out.available,
    reason: out.reason,
    dataStatus: out.dataStatus,
    providerAvailable: out.providerAvailable,
    quotaState: out.quotaState,
    events: out.events.length,
    relevantMatches: out.relevantMatches?.length ?? 0,
    fetchedAt: out.fetchedAt,
  }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});

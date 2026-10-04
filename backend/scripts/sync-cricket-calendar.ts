/**
 * One-off: run the cricket → Context Calendar sync on demand (same code the
 * interval scheduler runs) and print the result + current quota state.
 * Run with: cd backend && npx tsx scripts/sync-cricket-calendar.ts
 */
import { syncCricketEventsToCalendar } from '../src/context/sports/cricket/cricketCalendarSync';
import { getCricketKeyQuotaState } from '../src/context/sports/cricket/cricketProvider';

async function main(): Promise<void> {
  console.log('quota before:', JSON.stringify(getCricketKeyQuotaState()));
  const result = await syncCricketEventsToCalendar({ daysAhead: 14 });
  console.log('sync result:', JSON.stringify(result, null, 2));
  console.log('quota after:', JSON.stringify(getCricketKeyQuotaState()));
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});

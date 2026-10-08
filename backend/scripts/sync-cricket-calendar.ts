/**
 * One-off: run the cricket → Context Calendar sync on demand (same code the
 * interval scheduler runs) and print the result + current quota state.
 * Run with: cd backend && npx tsx scripts/sync-cricket-calendar.ts
 *
 * Connects to the app's own database (config.mongoUri) because the sync writes
 * CalendarEvents — without a connection every query just buffers and times out.
 */
import mongoose from 'mongoose';
import { config } from '../src/config';
import { syncCricketEventsToCalendar } from '../src/context/sports/cricket/cricketCalendarSync';
import { getCricketKeyQuotaState } from '../src/context/sports/cricket/cricketProvider';

async function main(): Promise<void> {
  console.log('mongo:', config.mongoUri);
  console.log('quota before:', JSON.stringify(getCricketKeyQuotaState()));
  await mongoose.connect(config.mongoUri);
  try {
    const result = await syncCricketEventsToCalendar({ daysAhead: 14 });
    console.log('sync result:', JSON.stringify(result, null, 2));
    if (result.teamIndia) {
      console.log(
        `team-india: available=${result.teamIndia.available} reason=${result.teamIndia.reason} ` +
          `dataStatus=${result.teamIndia.dataStatus} fixtures=${result.teamIndia.fixtures}`,
      );
    }
    const CalendarEvent = (await import('../src/modules/calendar/models/CalendarEvent')).default;
    const events = await CalendarEvent.find({ type: 'sports', status: 'active' })
      .sort({ startDate: 1 })
      .lean();
    console.log(`active sports events (${events.length}):`);
    for (const ev of events) {
      console.log(`  ${ev.startDate.toISOString()} | ${ev.name.slice(0, 80)} | relevance=${ev.marketingRelevance} | tags=${ev.tags.join(',')}`);
    }
  } finally {
    console.log('quota after:', JSON.stringify(getCricketKeyQuotaState()));
    await mongoose.disconnect();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});

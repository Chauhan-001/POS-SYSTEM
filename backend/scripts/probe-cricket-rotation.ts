/**
 * probe-cricket-rotation.ts — one process: run getUpcomingCricketContext
 * (refresh → cache), print the observability line + result summary, then dump
 * the cache contents with dates.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });

  const { getUpcomingCricketContext } = await import('../src/context/sports/cricket/cricketService');
  const out = await getUpcomingCricketContext({ restaurantId: '6ac031900f636f7cc8ab6f8f' });
  console.log('RESULT available:', out.available, '| reason:', out.reason, '| dataStatus:', out.dataStatus);
  console.log('RESULT events in window:', out.events?.length ?? 0, '| relevant:', out.relevantMatches?.length ?? 0);

  const { readCricketCache } = await import('../src/context/sports/cricket/cricketCache');
  const payload = await readCricketCache();
  if (!payload) {
    console.log('CACHE: empty');
  } else {
    console.log('CACHE matches:', payload.matches.length, '| fetchedAt:', payload.fetchedAt);
    const withDates = payload.matches.filter((m) => m.date && !Number.isNaN(Date.parse(m.date)));
    const future = withDates.filter((m) => Date.parse(m.date) > Date.now() - 86_400_000);
    console.log('CACHE parseable dates:', withDates.length, '| near/future:', future.length);
    for (const m of future.slice(0, 8)) console.log('  NEAR:', m.name, '|', m.date, '| ended:', (m as any).matchEnded ?? '?');
    for (const m of payload.matches.slice(0, 5)) console.log('  RAW :', m.name, '|', m.date, '| ended:', (m as any).matchEnded ?? '?');
  }

  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

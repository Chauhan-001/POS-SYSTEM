#!/usr/bin/env node
// E2E cleanup: delete same-day agent-created CampaignProposals for a tenant so
// the marketing-agent loop test always starts from a clean inbox.
//
// Why a DELETE and not reject: the duplicate-name gate at submit time blocks
// when a same-name proposal exists in ANY status other than pending/rejected —
// including 'approved' from a previous full test run (reject is only allowed
// from pending/ready_for_approval). Removing the stale same-day agent
// artifacts is the only rerun-safe cleanup; owner-authored proposals and
// other days' proposals are never touched.
//
// Usage:
//   node scripts/reset-agent-proposals.mjs [date] [restaurantId]
//     date           — name suffix to match (default: today's UTC date, which
//                      matches how the agent builds proposal names)
//     restaurantId   — optional tenant (default: all tenants)

import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos';

const dateArg = process.argv[2] || new Date().toISOString().slice(0, 10);
const restaurantArg = process.argv[3] || null;

async function main() {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });

  // Proposal names end with the UTC date the agent generated them on
  // (see marketingAgentProposal.ts: `${objective} • ${source} • ${date}`).
  const filter = {
    source: 'agent',
    name: new RegExp(`${dateArg.replace(/-/g, '-')}$`),
  };
  if (restaurantArg) filter.restaurantId = new mongoose.Types.ObjectId(restaurantArg);

  const res = await mongoose.connection.db.collection('campaignproposals').deleteMany(filter);
  console.log(`reset-agent-proposals: deleted ${res.deletedCount} same-day agent proposal(s) for ${dateArg}`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('reset-agent-proposals FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});

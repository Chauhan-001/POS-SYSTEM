/**
 * probe-phase2-memory.ts — Phase 2 MEMORY FOUNDATION runtime verification (live `pos` DB).
 *
 * Verifies against real MongoDB:
 *   1. create memory for tenant A → retrieve from A
 *   2. attempt retrieval from tenant B → tenant A's memory is invisible
 *   3. expired memory is excluded (and includeExpired can surface it)
 *   4. long-term upsert is idempotent per (tenant, branch, type, entityRef)
 *   5. audit rows were written
 *
 * Leaves ONE live episode for the Marketing Agent runtime probe, unless
 * `--cleanup` is passed (then it deletes all probe rows).
 *
 * Usage: npx tsx scripts/probe-phase2-memory.ts [--cleanup]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { memoryManager, loadMemoryContext } from '../src/ai/memory/memoryManager';
import MemoryEpisodeModel from '../src/models/memory/MemoryEpisode';
import RestaurantMemoryModel from '../src/models/memory/RestaurantMemory';
import AuditLog from '../src/models/admin/AuditLog';

dotenv.config();

const A = '6ac031900f636f7cc8ab6f8f'; // sim tenant (SIM_RESTAURANT_6M_001)
const B = '6ac031900f636f7cc8ab6f90'; // deliberately different ObjectId (isolation probe)
const tenantA = { restaurantId: A, actorId: 'probe-phase2' };
const tenantB = { restaurantId: B, actorId: 'probe-phase2' };
const PROBE_TAG = 'phase2-probe';

async function main() {
  const cleanupOnly = process.argv.includes('--cleanup');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db!;
  console.log('connected:', db.databaseName);

  // Always clear previous probe rows first (probe-owned only, scoped by metadata tag).
  await MemoryEpisodeModel.deleteMany({ 'metadata.probe': PROBE_TAG });
  await RestaurantMemoryModel.deleteMany({ 'metadata.probe': PROBE_TAG });

  if (cleanupOnly) {
    console.log('cleanup: probe rows deleted');
    await mongoose.disconnect();
    return;
  }

  // ── 1. create for tenant A ────────────────────────────────────────────────
  const ep = await memoryManager.recordEpisode(tenantA, {
    episodeType: 'manual_note',
    objective: 'phase-2 probe: prior festive campaign lifted covers 12%',
    source: 'human',
    confidence: 0.9,
    metadata: { probe: PROBE_TAG },
    evidence: [{ kind: 'metric', ref: 'metric:probe:festiveLift', value: 12, observedAt: new Date().toISOString() }],
  });
  console.log('[1] created episode', {
    id: ep.id,
    restaurantId: ep.restaurantId,
    branchId: ep.branchId,
    priority: ep.priority,
    expiresAt: ep.expiresAt,
  });

  const lt = await memoryManager.upsertLongTermMemory(tenantA, {
    memoryType: 'seasonality_pattern',
    value: { festiveLiftPct: 12 },
    confidence: 0.75,
    source: 'service',
    sampleSize: 14,
    tags: ['festive', PROBE_TAG],
    evidence: [{ kind: 'metric', ref: 'metric:probe:festiveLift', value: 12 }],
    metadata: { probe: PROBE_TAG },
  });
  console.log('[1] upserted long-term memory', { id: lt.id, memoryType: lt.memoryType, confidence: lt.confidence });

  // ── 2. retrieve from A, then from B ───────────────────────────────────────
  const aEp = await memoryManager.getRecentEpisodes(tenantA, { limit: 10 });
  const bEp = await memoryManager.getRecentEpisodes(tenantB, { limit: 10 });
  const aLt = await memoryManager.getRelevantMemories(tenantA);
  const bLt = await memoryManager.getRelevantMemories(tenantB);
  console.log('[2] tenant A sees', { episodes: aEp.length, longTerm: aLt.length });
  console.log('[2] tenant B sees', { episodes: bEp.length, longTerm: bLt.length });
  if (bEp.length !== 0 || bLt.length !== 0) throw new Error('TENANT ISOLATION FAILED');

  const ctxA = await loadMemoryContext(tenantA, { episodeLimit: 5, memoryLimit: 5 });
  const ctxB = await loadMemoryContext(tenantB, { episodeLimit: 5, memoryLimit: 5 });
  console.log('[2] loadMemoryContext A', { episodes: ctxA.episodes.length, longTerm: ctxA.longTerm.length, degraded: !!ctxA.degraded });
  console.log('[2] loadMemoryContext B', { episodes: ctxB.episodes.length, longTerm: ctxB.longTerm.length, degraded: !!ctxB.degraded });

  // ── 3. expired memory excluded ────────────────────────────────────────────
  const expired = await memoryManager.recordEpisode(tenantA, {
    episodeType: 'manual_note',
    objective: 'phase-2 probe: EXPIRED row (must not surface)',
    source: 'human',
    confidence: 0.9,
    metadata: { probe: PROBE_TAG },
  });
  await MemoryEpisodeModel.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(expired.id) },
    { $set: { expiresAt: new Date(Date.now() - 60_000) } },
  );
  const visible = await memoryManager.getRecentEpisodes(tenantA, { limit: 20 });
  const withExpired = await memoryManager.getRecentEpisodes(tenantA, { limit: 20, includeExpired: true });
  const expiredVisible = visible.some((e) => e.id === expired.id);
  const expiredIncluded = withExpired.some((e) => e.id === expired.id);
  console.log('[3] expired excluded from default retrieval:', !expiredVisible, '| surfaced with includeExpired:', expiredIncluded);
  if (expiredVisible || !expiredIncluded) throw new Error('EXPIRY FILTER FAILED');

  // ── 4. long-term upsert idempotency ───────────────────────────────────────
  const lt2 = await memoryManager.upsertLongTermMemory(tenantA, {
    memoryType: 'seasonality_pattern',
    value: { festiveLiftPct: 12 },
    confidence: 0.8,
    source: 'service',
    metadata: { probe: PROBE_TAG },
  });
  const ltCount = await RestaurantMemoryModel.countDocuments({ 'metadata.probe': PROBE_TAG });
  console.log('[4] upsert reused row:', lt2.id === lt.id, '| probe long-term rows:', ltCount);
  if (lt2.id !== lt.id || ltCount !== 1) throw new Error('UPSERT IDEMPOTENCY FAILED');

  // ── 5. audit rows ─────────────────────────────────────────────────────────
  const audits = await AuditLog.find({
    action: { $in: ['agent_memory_episode_recorded', 'agent_memory_longterm_upserted'] },
    restaurantId: new mongoose.Types.ObjectId(A),
  })
    .sort({ createdAt: -1 })
    .limit(4)
    .lean();
  console.log('[5] recent memory audits:', audits.map((a) => ({ action: a.action, entityId: String(a.entityId) })));
  if (!audits.length) throw new Error('AUDIT WRITE FAILED');

  // ── 6. indexes synced ─────────────────────────────────────────────────────
  const epIdx = (await MemoryEpisodeModel.collection.indexes()).map((i) => i.name);
  const ltIdx = (await RestaurantMemoryModel.collection.indexes()).map((i) => i.name);
  console.log('[6] memoryepisodes indexes:', epIdx);
  console.log('[6] restaurantmemories indexes:', ltIdx);

  // Leave one live, non-expired episode + one long-term memory for the agent probe.
  console.log('PROBE OK — left 1 live episode + 1 long-term memory for tenant A (Marketing Agent probe next)');
  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('PROBE FAILED:', err);
    process.exit(1);
  });
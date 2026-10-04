/**
 * READ-ONLY audit probe (Phase 3–10 post-implementation audit).
 * No writes. Only counts + samples documents.
 */
import mongoose from 'mongoose';
import RestaurantMemory from './src/models/memory/RestaurantMemory';
import MemoryEpisode from './src/models/memory/MemoryEpisode';
import AIUsageLog from './src/models/core/AIUsageLog';
import PromotionCandidate from './src/models/marketing/PromotionCandidate';
import CampaignHistory from './src/models/marketing/CampaignHistory';
import AdvisorRecommendation from './src/models/intelligence/AdvisorRecommendation';

const RID = process.env.AUDIT_RID ?? '6ac031900f636f7cc8ab6f8f';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pos');
  const oid = new mongoose.Types.ObjectId(RID);

  const mem = await RestaurantMemory.find({ restaurantId: oid }).lean();
  console.log('RestaurantMemory rows for tenant:', mem.length);
  for (const m of mem) {
    console.log('  ', {
      type: m.memoryType,
      entityRef: m.entityRef,
      status: m.status,
      confidence: m.confidence,
      sampleSize: m.sampleSize,
      evidenceCount: (m.evidence as unknown[] | undefined)?.length ?? 0,
      source: m.source,
      lastValidatedAt: m.lastValidatedAt,
      createdAt: m.createdAt,
      consolidator: (m.metadata as Record<string, unknown> | undefined)?.consolidator,
      branchId: m.branchId,
    });
  }
  const memAll = await RestaurantMemory.countDocuments({});
  console.log('RestaurantMemory rows (all tenants):', memAll);

  const eps = await MemoryEpisode.find({ restaurantId: oid }).lean();
  console.log('MemoryEpisode rows for tenant:', eps.length);
  for (const e of eps) {
    console.log('  ', {
      episodeType: e.episodeType,
      objective: e.objective,
      recommendationRef: e.recommendationRef,
      campaignRef: e.campaignRef,
      source: e.source,
      confidence: e.confidence,
      evidenceCount: (e.evidence as unknown[] | undefined)?.length ?? 0,
      createdAt: e.createdAt,
      expiresAt: e.expiresAt,
    });
  }
  console.log('MemoryEpisode rows (all tenants):', await MemoryEpisode.countDocuments({}));

  console.log('AIUsageLog total:', await AIUsageLog.countDocuments({}));
  const usage = await AIUsageLog.find({}).sort({ createdAt: -1 }).limit(8).lean();
  for (const u of usage) {
    console.log('  usage', {
      feature: u.feature, provider: u.provider, model: u.model,
      promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens,
      costUsd: u.costUsd, latencyMs: u.latencyMs, status: u.status, error: u.error,
      restaurantId: u.restaurantId, createdAt: u.createdAt,
    });
  }

  console.log('PromotionCandidate total:', await PromotionCandidate.countDocuments({}));
  console.log('PromotionCandidate tenant statuses:', JSON.stringify(
    await PromotionCandidate.aggregate([
      { $match: { restaurantId: oid } },
      { $group: { _id: { status: '$status', type: '$type' }, n: { $sum: 1 } } },
    ])));
  console.log('CampaignHistory total:', await CampaignHistory.countDocuments({}));
  console.log('AdvisorRecommendation tenant statuses:', JSON.stringify(
    await AdvisorRecommendation.aggregate([
      { $match: { restaurantId: oid } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ])));

  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SelfLearningService — The voice system improves over time.
 *
 * When a merchant corrects the system (chooses a different product than the
 * one auto-selected, or picks from a product picker), we LEARN:
 *
 *   spokenName → chosenProductId
 *
 * This mapping is stored per-restaurant in the product's `learnedAliases`
 * array so different restaurants can use different names for the same product.
 *
 * Learning flow:
 *   1. Merchant confirms a correction via the confirmation flow.
 *   2. Controller calls learnFromCorrection().
 *   3. The spoken name is added to the chosen product's learnedAliases
 *      (source='correction').
 *   4. On future voice matches, the resolution engine checks learnedAliases
 *      first (stage order: exact → voice → search → LEARNED → sku → ...).
 *
 * Usage tracking:
 *   - Each successful resolution increments the product's aliasUsageCount
 *     and sets lastUsedAlias / lastUsed timestamp.
 *   - Low-usage learned aliases can be pruned periodically.
 */

import mongoose from 'mongoose';
import Product from '../../../models/Product';
import type { LearnRequest } from '../types';

// ====================================================================
// LEARN FROM CORRECTION
// ====================================================================

/**
 * Record a manual correction: "when the merchant said X, they actually meant
 * product Y". Stored per-restaurant in product Y's learnedAliases.
 */
export async function learnFromCorrection(req: LearnRequest): Promise<boolean> {
  const { restaurantId, spokenName, productId, source } = req;

  const cleanSpoken = (spokenName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!cleanSpoken || cleanSpoken.length > 200) return false;
  if (!mongoose.Types.ObjectId.isValid(productId)) return false;

  try {
    const product = await Product.findById(productId);
    if (!product) return false;

    const existing = (product.learnedAliases || []).find(
      (a) =>
        a.alias.toLowerCase() === cleanSpoken &&
        (!a.restaurantId || a.restaurantId.toString() === restaurantId)
    );

    if (existing) {
      // Already learned — just bump usage.
      await Product.updateOne(
        {
          _id: product._id,
          'learnedAliases.alias': existing.alias,
        },
        {
          $inc: { 'learnedAliases.$.usageCount': 1 },
          $set: { 'learnedAliases.$.lastUsed': new Date() },
        }
      );
      return true;
    }

    // Add new learned alias.
    await Product.updateOne(
      { _id: product._id },
      {
        $push: {
          learnedAliases: {
            alias: cleanSpoken,
            source: source === 'admin_edit' ? 'correction' : source,
            usageCount: 1,
            lastUsed: new Date(),
            restaurantId: restaurantId
              ? new mongoose.Types.ObjectId(restaurantId)
              : null,
          },
        },
        $inc: { aliasUsageCount: 1 },
        $set: { lastUsedAlias: cleanSpoken },
      }
    );

    return true;
  } catch (error: any) {
    console.error('[SelfLearningService] learnFromCorrection failed:', error.message);
    return false;
  }
}

// ====================================================================
// USAGE TRACKING
// ====================================================================

/**
 * Record a successful alias-based resolution (used to improve ranking and
 * calibration). Call this whenever the resolution engine resolves via an
 * alias/learned alias with high confidence.
 */
export async function recordSuccessfulResolution(
  productId: string,
  matchedAlias: string
): Promise<void> {
  const clean = (matchedAlias || '').trim().toLowerCase();
  try {
    if (!mongoose.Types.ObjectId.isValid(productId)) return;

    const product = await Product.findById(productId).select(
      'learnedAliases lastUsedAlias aliasUsageCount'
    );
    if (!product) return;

    // If the matched alias was a learned alias, bump its usage count.
    const learnedMatch = (product.learnedAliases || []).find(
      (a) => a.alias.toLowerCase() === clean
    );

    const update: any = {
      $inc: { aliasUsageCount: 1 },
      $set: { lastUsedAlias: clean },
    };

    if (learnedMatch) {
      update.$inc['learnedAliases.$.usageCount'] = 1;
      update.$set['learnedAliases.$.lastUsed'] = new Date();
      await Product.updateOne(
        { _id: product._id, 'learnedAliases.alias': learnedMatch.alias },
        update
      );
      return;
    }

    await Product.updateOne({ _id: product._id }, update);
  } catch (error: any) {
    console.warn('[SelfLearningService] recordSuccessfulResolution failed:', error.message);
  }
}

// ====================================================================
// CALIBRATION & PRUNING
// ====================================================================

/**
 * Compute a per-restaurant calibration factor (0.8–1.2) based on how often
 * the system's auto-selections were confirmed vs overridden. Used by the
 * ConfidenceEngine to nudge scores for that restaurant.
 *
 * Higher confirmation rate → calibration slightly above 1 (more confident).
 * More overrides → calibration below 1 (more conservative).
 */
export async function computeRestaurantCalibration(
  restaurantId: string
): Promise<number> {
  try {
    const VoiceAuditLog = (await import('../models/VoiceAuditLog')).default;
    const rId = new mongoose.Types.ObjectId(restaurantId);

    const [confirmed, rejected, clarified] = await Promise.all([
      VoiceAuditLog.countDocuments({
        restaurantId: rId,
        source: 'voice',
        confirmationStatus: 'confirmed',
      }),
      VoiceAuditLog.countDocuments({
        restaurantId: rId,
        source: 'voice',
        confirmationStatus: 'rejected',
      }),
      VoiceAuditLog.countDocuments({
        restaurantId: rId,
        source: 'voice',
        confirmationStatus: 'clarified',
      }),
    ]);

    const total = confirmed + rejected + clarified;
    if (total < 10) return 1.0; // Not enough data yet.

    const overrideRate = (rejected + clarified) / total;
    // 0% overrides → calibration 1.05; 50%+ overrides → calibration 0.85.
    return Math.max(0.85, Math.min(1.05, 1.05 - overrideRate * 0.4));
  } catch {
    return 1.0;
  }
}

/**
 * Prune stale / low-usage learned aliases (called periodically or on-demand).
 * Removes learned aliases with usageCount below the threshold and last used
 * longer than the TTL ago.
 */
export async function pruneStaleLearnedAliases(
  minUsageCount = 2,
  maxAgeDays = 90
): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const result = await Product.updateMany(
      {
        learnedAliases: {
          $elemMatch: {
            usageCount: { $lt: minUsageCount },
            lastUsed: { $lt: cutoff },
          },
        },
      },
      {
        $pull: {
          learnedAliases: {
            usageCount: { $lt: minUsageCount },
            lastUsed: { $lt: cutoff },
          },
        },
      }
    );
    return result.modifiedCount || 0;
  } catch (error: any) {
    console.warn('[SelfLearningService] pruneStaleLearnedAliases failed:', error.message);
    return 0;
  }
}

// ====================================================================
// MERGE DUPLICATE ALIASES
// ====================================================================

/**
 * Merge duplicate learned/voice aliases across products.
 * If two products share the same alias string, keep the one with higher
 * usage count and remove the duplicate from the other (admin-approved merge).
 */
export async function mergeDuplicateAlias(
  alias: string,
  keepProductId: string,
  removeProductId: string
): Promise<boolean> {
  const clean = alias.trim().toLowerCase();
  try {
    if (!mongoose.Types.ObjectId.isValid(keepProductId) || !mongoose.Types.ObjectId.isValid(removeProductId)) {
      return false;
    }

    // Pull the alias from the losing product's arrays.
    await Product.updateOne(
      { _id: removeProductId },
      {
        $pull: {
          voiceAliases: clean,
          searchAliases: clean,
          learnedAliases: { alias: { $regex: new RegExp(`^${escapeRegex(clean)}$`, 'i') } },
        },
      }
    );

    // Ensure it exists on the winning product.
    await Product.updateOne(
      { _id: keepProductId },
      {
        $addToSet: { voiceAliases: clean },
        $inc: { aliasUsageCount: 1 },
      }
    );

    return true;
  } catch (error: any) {
    console.warn('[SelfLearningService] mergeDuplicateAlias failed:', error.message);
    return false;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


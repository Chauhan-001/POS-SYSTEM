import Subscription from '../../models/Subscription';
import SubscriptionPlan from '../../models/SubscriptionPlan';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Warning window after a subscription expires — then fall back to the free tier. */
const EXPIRY_WARNING_DAYS = 2;

export function startSubscriptionScheduler(): void {
  console.log('[SubscriptionScheduler] Starting background state transition job...');

  runTransitionCheck();

  setInterval(runTransitionCheck, CHECK_INTERVAL_MS);
}

async function runTransitionCheck(): Promise<void> {
  const now = new Date();

  try {
    // Expired trials / paid subscriptions start a 2-day warning (grace) window.
    const warningEnd = new Date(now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000);

    const toGraceTrial = await Subscription.updateMany(
      { status: 'trial', trialEnd: { $lte: now } },
      { $set: { status: 'grace', graceEnd: warningEnd } }
    ).exec();

    if (toGraceTrial.modifiedCount > 0) {
      console.log(`[SubscriptionScheduler] Transitioned ${toGraceTrial.modifiedCount} subscriptions: trial → grace (${EXPIRY_WARNING_DAYS}-day warning)`);
    }

    const toGraceActive = await Subscription.updateMany(
      { status: 'active', expiryDate: { $lte: now } },
      { $set: { status: 'grace', graceEnd: warningEnd } }
    ).exec();

    if (toGraceActive.modifiedCount > 0) {
      console.log(`[SubscriptionScheduler] Transitioned ${toGraceActive.modifiedCount} subscriptions: active → grace (${EXPIRY_WARNING_DAYS}-day warning)`);
    }

    // After the warning window elapses, fall back to the Free tier (core POS
    // only) instead of suspending — the restaurant keeps billing/orders, just
    // loses premium features (gated server-side by requireFeature).
    const freePlan = await SubscriptionPlan.findOne({ planId: 'free' }).lean().exec();
    const freeFeatures = freePlan?.features?.length ? freePlan.features : ['core_pos'];
    const freeLimits = freePlan?.limits || {
      maxRestaurants: 1, maxBranches: 1, maxDevicesPerBranch: 1,
      maxProducts: 0, maxCustomers: 0, maxMonthlyOrders: 0, maxStorageMB: 100,
      maxAIRequests: 0, maxVoiceRequests: 0, maxImages: 0, maxExports: 0,
    };
    const freeMaxUsers = freePlan?.maxUsers ?? 3;
    const freeMaxDevices = freePlan?.maxDevices ?? 1;

    const toFreeTier = await Subscription.updateMany(
      { status: 'grace', graceEnd: { $lte: now } },
      {
        $set: {
          plan: 'free',
          status: 'active',
          billingPeriod: 'monthly',
          expiryDate: null,
          renewalDate: null,
          graceEnd: null,
          trialEnd: null,
          pendingPlan: null,
          pendingEffectiveDate: null,
          features: freeFeatures,
          maxUsers: freeMaxUsers,
          maxDevices: freeMaxDevices,
          limits: freeLimits,
        },
      }
    ).exec();

    if (toFreeTier.modifiedCount > 0) {
      console.log(`[SubscriptionScheduler] Transitioned ${toFreeTier.modifiedCount} subscriptions: grace → Free tier (core POS only)`);
    }
  } catch (error) {
    console.error('[SubscriptionScheduler] Error during transition check:', error);
  }
}

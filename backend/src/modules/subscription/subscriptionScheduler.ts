import Subscription from '../../models/Subscription';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function startSubscriptionScheduler(): void {
  console.log('[SubscriptionScheduler] Starting background state transition job...');

  runTransitionCheck();

  setInterval(runTransitionCheck, CHECK_INTERVAL_MS);
}

async function runTransitionCheck(): Promise<void> {
  const now = new Date();

  try {
    const updated = await Subscription.updateMany(
      { status: 'trial', trialEnd: { $lte: now } },
      { $set: { status: 'grace', graceEnd: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000) } }
    ).exec();

    if (updated.modifiedCount > 0) {
      console.log(`[SubscriptionScheduler] Transitioned ${updated.modifiedCount} subscriptions: trial → grace`);
    }

    const toSuspended = await Subscription.updateMany(
      { status: 'grace', graceEnd: { $lte: now } },
      { $set: { status: 'suspended' } }
    ).exec();

    if (toSuspended.modifiedCount > 0) {
      console.log(`[SubscriptionScheduler] Transitioned ${toSuspended.modifiedCount} subscriptions: grace → suspended`);
    }

    const toGrace = await Subscription.updateMany(
      { status: 'active', expiryDate: { $lte: now } },
      { $set: { status: 'grace', graceEnd: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000) } }
    ).exec();

    if (toGrace.modifiedCount > 0) {
      console.log(`[SubscriptionScheduler] Transitioned ${toGrace.modifiedCount} subscriptions: active → grace`);
    }
  } catch (error) {
    console.error('[SubscriptionScheduler] Error during transition check:', error);
  }
}

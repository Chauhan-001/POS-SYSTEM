import { Request, Response } from 'express';
import { subscriptionService } from './subscriptionService';
import { entitlementService } from '../../services/entitlementService';

/**
 * Resolve the tenant identity for subscription routes.
 *
 * SECURITY (tenant isolation): the restaurant id is derived EXCLUSIVELY from
 * the authenticated user's JWT (req.user.restaurantId). Client-supplied
 * restaurantId in body/query is NEVER trusted — otherwise any authenticated
 * POS user could read or mutate another restaurant's subscription (IDOR).
 * Platform admins manage subscriptions through the admin API, which has its
 * own surface-gated routes.
 */
function tenantRestaurantId(req: Request): string | undefined {
  const rid = (req as any).user?.restaurantId;
  return rid ? String(rid) : undefined;
}

export async function getPlans(_req: Request, res: Response): Promise<void> {
  try {
    const plans = await subscriptionService.getPlans();
    res.json(plans);
  } catch (error) {
    console.error('[SubscriptionController] Get plans error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getStatus(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = tenantRestaurantId(req);
    if (!restaurantId) {
      res.status(400).json({ error: 'Restaurant ID required' });
      return;
    }
    const status = await subscriptionService.getSubscriptionStatus(restaurantId.toString());
    res.json(status);
  } catch (error) {
    console.error('[SubscriptionController] Get status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createOrder(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = tenantRestaurantId(req);
    const { planId, billingPeriod } = req.body;
    if (!restaurantId) {
      res.status(400).json({ error: 'Restaurant ID required' });
      return;
    }
    const order = await subscriptionService.createOrder(restaurantId.toString(), planId || 'professional', billingPeriod);
    res.json(order);
  } catch (error) {
    console.error('[SubscriptionController] Create order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function verifyPayment(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = tenantRestaurantId(req);
    const { orderId, paymentId, signature } = req.body;
    if (!restaurantId || !orderId || !paymentId || !signature) {
      res.status(400).json({ error: 'Missing payment verification parameters' });
      return;
    }
    const result = await subscriptionService.verifyPayment(restaurantId.toString(), orderId, paymentId, signature);
    res.json(result);
  } catch (error: any) {
    console.error('[SubscriptionController] Verify payment error:', error);
    res.status(400).json({ error: error.message || 'Payment verification failed' });
  }
}

export async function handleWebhook(req: Request, res: Response): Promise<void> {
  try {
    const signature = req.headers['x-razorpay-signature'] as string;
    // Use the exact raw body (captured before express.json parsed it) so the
    // signature matches Razorpay's HMAC; never re-serialize req.body.
    const rawBody = (req as any).razorpayRawBody ?? JSON.stringify(req.body);
    const result = await subscriptionService.handleWebhook(rawBody, signature);
    res.json(result);
  } catch (error) {
    console.error('[SubscriptionController] Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

export async function getHistory(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = tenantRestaurantId(req);
    if (!restaurantId) {
      res.status(400).json({ error: 'Restaurant ID required' });
      return;
    }
    const history = await subscriptionService.getSubscriptionHistory(restaurantId.toString());
    res.json(history);
  } catch (error) {
    console.error('[SubscriptionController] Get history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getPaymentHistory(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = tenantRestaurantId(req);
    if (!restaurantId) {
      res.status(400).json({ error: 'Restaurant ID required' });
      return;
    }
    const payments = await subscriptionService.getPaymentHistory(restaurantId.toString());
    res.json(payments);
  } catch (error) {
    console.error('[SubscriptionController] Get payment history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function manualRenew(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = tenantRestaurantId(req);
    if (!restaurantId) {
      res.status(400).json({ error: 'Restaurant ID required' });
      return;
    }
    const { amount, notes, paymentMethod, billingPeriod } = req.body;
    const result = await subscriptionService.manualRenew(restaurantId.toString(), { amount, notes, paymentMethod, billingPeriod });
    res.json(result);
  } catch (error) {
    console.error('[SubscriptionController] Manual renew error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function calculateProration(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = tenantRestaurantId(req);
    const { targetPlan } = req.query;
    if (!restaurantId || !targetPlan) {
      res.status(400).json({ error: 'Restaurant ID and targetPlan query params required' });
      return;
    }
    const result = await subscriptionService.calculateProration(
      restaurantId.toString(),
      targetPlan as string
    );
    res.json(result);
  } catch (error: any) {
    console.error('[SubscriptionController] Proration error:', error);
    res.status(500).json({ error: error.message || 'Failed to calculate proration' });
  }
}

export async function changePlan(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = tenantRestaurantId(req);
    const { planId, billingPeriod } = req.body;
    if (!restaurantId || !planId) {
      res.status(400).json({ error: 'Restaurant ID and plan ID required' });
      return;
    }
    const sub = await subscriptionService.changePlan(restaurantId.toString(), planId, billingPeriod);
    res.json(sub);
  } catch (error: any) {
    console.error('[SubscriptionController] Change plan error:', error);
    res.status(400).json({ error: error.message || 'Failed to change plan' });
  }
}

export async function extendTrial(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = tenantRestaurantId(req);
    const days = parseInt(req.body.days || '7', 10);
    if (!restaurantId) {
      res.status(400).json({ error: 'Restaurant ID required' });
      return;
    }
    const sub = await subscriptionService.extendTrial(restaurantId.toString(), days);
    res.json({ success: true, message: `Trial extended by ${days} days`, subscription: sub });
  } catch (error: any) {
    console.error('[SubscriptionController] Extend trial error:', error);
    res.status(400).json({ error: error.message || 'Failed to extend trial' });
  }
}

export async function getBranchUsage(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = tenantRestaurantId(req);
    if (!restaurantId) {
      res.status(400).json({ error: 'Restaurant ID required' });
      return;
    }
    const usage = await entitlementService.getBranchUsage(restaurantId.toString());
    res.json(usage);
  } catch (error: any) {
    console.error('[SubscriptionController] Branch usage error:', error);
    res.status(500).json({ error: 'Failed to get branch usage' });
  }
}

import { Router } from 'express';
import {
  getPlans, getStatus, createOrder, verifyPayment,
  handleWebhook, getHistory, getPaymentHistory,
  manualRenew, changePlan, extendTrial, getBranchUsage,
  calculateProration,
} from './subscriptionController';
import { requireAuth } from '../../middleware/authMiddleware';
import { publicLimiter } from '../../middleware/rateLimiter';

const router = Router();

router.get('/plans', publicLimiter, getPlans);
router.get('/subscription/status', requireAuth, getStatus);
router.get('/subscription/history', requireAuth, getHistory);
router.get('/payment/history', requireAuth, getPaymentHistory);

router.post('/subscription/create-order', requireAuth, createOrder);
router.post('/payment/verify', requireAuth, verifyPayment);
router.post('/payment/webhook', handleWebhook);

router.get('/subscription/proration', requireAuth, calculateProration);
router.patch('/subscription/change-plan', requireAuth, changePlan);
router.post('/subscription/manual-renew', requireAuth, manualRenew);
router.post('/subscription/extend-trial', requireAuth, extendTrial);

// Branch usage & subscription limits
router.get('/subscription/branch-usage', requireAuth, getBranchUsage);

export default router;

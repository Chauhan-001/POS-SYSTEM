/**
 * =============================================================================
 *  cashLedger.ts — Cash Ledger API Routes (Phase 1.7)
 * =============================================================================
 *
 * Routes: opening cash, entries, shift closing, balance, history.
 * Access: All staff (view), Owner/Manager (record/adjust/close).
 * Path:   /api/cash-ledger
 */

import { Router } from 'express';
import {
  getLedger, getBalance, openCash, addEntry, closeShift,
} from '../controllers/cashLedgerController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import {
  openCashSchema, ledgerEntrySchema, closeShiftSchema, cashLedgerQuerySchema,
} from '../validation';

const router = Router();

router.get('/', requireAuth, requireFeature('expense_tracking'), validate({ query: cashLedgerQuerySchema }), getLedger);
router.get('/balance', requireAuth, requireFeature('expense_tracking'), getBalance);
router.post('/opening', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ body: openCashSchema }), openCash);
router.post('/entries', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ body: ledgerEntrySchema }), addEntry);
router.post('/shift-close', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ body: closeShiftSchema }), closeShift);

export default router;

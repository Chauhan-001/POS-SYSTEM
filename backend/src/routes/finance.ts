/**
 * =============================================================================
 *  finance.ts — Finance API Routes (Phase 1.7)
 * =============================================================================
 *
 * Routes: Backend-generated financial summary + reports (P&L, cash flow, GST,
 * expense register, monthly statement, branch comparison, exports).
 * Access: All staff (view), Owner/Manager (settings).
 * Path:   /api/finance
 */

import { Router } from 'express';
import {
  getFinanceSettings, updateFinanceSettings, getFinanceSummary, getPnl,
  getCashFlow, getGstReport, getExpenseRegister, getMonthlyStatement,
  getBranchComparison, getVendorDues, exportFinanceReport,
} from '../controllers/financeController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import { updateFinanceSettingsSchema } from '../validation';

const router = Router();

router.get('/settings', requireAuth, requireFeature('expense_tracking'), getFinanceSettings);
router.put('/settings', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ body: updateFinanceSettingsSchema }), updateFinanceSettings);

router.get('/summary', requireAuth, requireFeature('expense_tracking'), getFinanceSummary);
router.get('/pnl', requireAuth, requireFeature('expense_tracking'), getPnl);
router.get('/cashflow', requireAuth, requireFeature('expense_tracking'), getCashFlow);
router.get('/gst', requireAuth, requireFeature('expense_tracking'), getGstReport);
router.get('/register', requireAuth, requireFeature('expense_tracking'), getExpenseRegister);
router.get('/monthly', requireAuth, requireFeature('expense_tracking'), getMonthlyStatement);
router.get('/branches', requireAuth, requireFeature('expense_tracking'), getBranchComparison);
router.get('/vendor-dues', requireAuth, requireFeature('expense_tracking'), getVendorDues);
router.get('/export/:report', requireAuth, requireFeature('expense_tracking'), exportFinanceReport);

export default router;

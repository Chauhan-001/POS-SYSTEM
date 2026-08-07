/**
 * =============================================================================
 *  recurringExpenses.ts — Recurring Expense API Routes (Phase 1.7)
 * =============================================================================
 *
 * Routes: CRUD + pause/resume + on-demand scheduler run.
 * Access: All staff (view), Owner/Manager (manage + run).
 * Path:   /api/recurring-expenses
 */

import { Router } from 'express';
import {
  listRecurring, getRecurring, createRecurring, updateRecurring,
  pauseRecurring, resumeRecurring, deleteRecurring, runRecurring,
} from '../controllers/recurringExpenseController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import {
  createRecurringExpenseSchema, updateRecurringExpenseSchema,
  recurringExpenseQuerySchema, recurringExpenseParamsSchema,
} from '../validation';

const router = Router();

router.get('/', requireAuth, requireFeature('expense_tracking'), validate({ query: recurringExpenseQuerySchema }), listRecurring);
router.get('/:id', requireAuth, requireFeature('expense_tracking'), validate({ params: recurringExpenseParamsSchema }), getRecurring);
router.post('/', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ body: createRecurringExpenseSchema }), createRecurring);
router.put('/:id', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ body: updateRecurringExpenseSchema, params: recurringExpenseParamsSchema }), updateRecurring);
router.post('/:id/pause', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ params: recurringExpenseParamsSchema }), pauseRecurring);
router.post('/:id/resume', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ params: recurringExpenseParamsSchema }), resumeRecurring);
router.delete('/:id', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ params: recurringExpenseParamsSchema }), deleteRecurring);
// Run-now must be mounted AFTER /:id routes to avoid shadowing (POST method differs, safe).
router.post('/run', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), runRecurring);

export default router;

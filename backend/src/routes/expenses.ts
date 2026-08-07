/**
 * =============================================================================
 *  expenses.ts — Expenses API Routes (Phase 1.7)
 * =============================================================================
 *
 * Routes: Full CRUD + restore + CSV export for operational expenses.
 * Access: All staff (view), Owner/Manager (create/update/delete/restore).
 * Delete supports optional manager PIN verification.
 * Path:   /api/expenses
 */

import { Router } from 'express';
import {
  listExpenses, getExpense, createExpense, updateExpense,
  deleteExpense, restoreExpense, exportExpenses,
} from '../controllers/expensesController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import {
  createExpenseSchema, updateExpenseSchema, expenseQuerySchema,
  expenseParamsSchema, deleteExpenseSchema,
} from '../validation';

const router = Router();

// All staff can view expenses (only if plan includes expense_tracking)
router.get('/', requireAuth, requireFeature('expense_tracking'), validate({ query: expenseQuerySchema }), listExpenses);
router.get('/export', requireAuth, requireFeature('expense_tracking'), exportExpenses);
router.get('/:id', requireAuth, requireFeature('expense_tracking'), validate({ params: expenseParamsSchema }), getExpense);

// Only Owner and Manager can record, edit, delete or restore expenses
router.post('/', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ body: createExpenseSchema }), createExpense);
router.patch('/:id', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ body: updateExpenseSchema, params: expenseParamsSchema }), updateExpense);
router.delete('/:id', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ body: deleteExpenseSchema, params: expenseParamsSchema }), deleteExpense);
router.post('/:id/restore', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ params: expenseParamsSchema }), restoreExpense);

export default router;

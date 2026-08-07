/**
 * =============================================================================
 *  expenseCategories.ts — Expense Category API Routes (Phase 1.7)
 * =============================================================================
 *
 * Routes: CRUD for configurable expense categories.
 * Access: All staff (view), Owner/Manager (manage).
 * Path:   /api/expense-categories
 */

import { Router } from 'express';
import {
  listCategories, createCategory, updateCategory, deleteCategory,
} from '../controllers/expenseCategoryController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import {
  createExpenseCategorySchema, updateExpenseCategorySchema,
  expenseCategoryQuerySchema, expenseCategoryParamsSchema,
} from '../validation';

const router = Router();

router.get('/', requireAuth, requireFeature('expense_tracking'), validate({ query: expenseCategoryQuerySchema }), listCategories);
router.post('/', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ body: createExpenseCategorySchema }), createCategory);
router.put('/:id', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ body: updateExpenseCategorySchema, params: expenseCategoryParamsSchema }), updateCategory);
router.delete('/:id', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ params: expenseCategoryParamsSchema }), deleteCategory);

export default router;

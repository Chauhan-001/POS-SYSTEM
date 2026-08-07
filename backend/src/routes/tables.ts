/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tables API routes — delegates to tablesController.
 * Route order matters: static sub-routes (/stats, /merge) must precede /:id.
 */

import { Router } from 'express';
import {
  listTables,
  getTable,
  getTableStats,
  createTable,
  updateTable,
  deleteTable,
  releaseTable,
  startCleaning,
  completeCleaning,
  disableTable,
  enableTable,
  assignWaiter,
  moveOrder,
  mergeTables,
  bulkReplaceTables,
} from '../controllers/tablesController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import {
  createTableSchema, updateTableSchema, tableQuerySchema, tableParamsSchema,
  bulkReplaceTablesSchema, bulkReplaceParamsSchema, assignWaiterSchema,
  moveOrderSchema, mergeTablesSchema, cleanTableSchema, disableTableSchema,
} from '../validation';

const router = Router();

// All staff can view tables + stats
router.get('/', requireAuth, validate({ query: tableQuerySchema }), listTables);
router.get('/stats', requireAuth, getTableStats);
router.get('/:id', requireAuth, validate({ params: tableParamsSchema }), getTable);

// Table operations — Manager+ (status transitions are server-decided)
router.post('/merge', requireRole('Owner', 'Manager'), validate({ body: mergeTablesSchema }), mergeTables);
router.post('/:id/release', requireRole('Owner', 'Manager'), validate({ params: tableParamsSchema }), releaseTable);
router.post('/:id/clean', requireRole('Owner', 'Manager'), validate({ body: cleanTableSchema, params: tableParamsSchema }), startCleaning);
router.post('/:id/clean-complete', requireRole('Owner', 'Manager'), validate({ params: tableParamsSchema }), completeCleaning);
router.post('/:id/disable', requireRole('Owner', 'Manager'), validate({ body: disableTableSchema, params: tableParamsSchema }), disableTable);
router.post('/:id/enable', requireRole('Owner', 'Manager'), validate({ params: tableParamsSchema }), enableTable);
router.post('/:id/assign-waiter', requireRole('Owner', 'Manager'), validate({ body: assignWaiterSchema, params: tableParamsSchema }), assignWaiter);
router.post('/:id/move-order', requireRole('Owner', 'Manager'), validate({ body: moveOrderSchema, params: tableParamsSchema }), moveOrder);

// Table CRUD — only Owner and Manager can modify table layouts
router.post('/', requireRole('Owner', 'Manager'), validate({ body: createTableSchema }), createTable);
router.put('/:id', requireRole('Owner', 'Manager'), validate({ body: updateTableSchema, params: tableParamsSchema }), updateTable);
router.delete('/:id', requireRole('Owner', 'Manager'), validate({ params: tableParamsSchema }), deleteTable);

// Bulk replace for branch floor plan sync (Owner only)
router.post('/bulk-replace/:branchId', requireRole('Owner'), validate({ body: bulkReplaceTablesSchema, params: bulkReplaceParamsSchema }), bulkReplaceTables);

export default router;

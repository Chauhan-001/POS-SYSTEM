/**
 * =============================================================================
 *  employees.ts — Employees API Routes
 * =============================================================================
 *
 * Routes: CRUD for staff members
 * Access: Owner/Manager (view), Owner only (create/update/delete)
 * Path:   /api/employees
 */

import { Router } from 'express';
import {
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  deleteEmployee,
} from '../controllers/employeesController';
import { requireRole } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { createEmployeeSchema, updateEmployeeSchema, employeeQuerySchema, employeeParamsSchema } from '../validation';

const router = Router();

// Only Owner and Manager can view staff list (Cashiers see only themselves via frontend)
router.get('/', requireRole('Owner', 'Manager'), validate({ query: employeeQuerySchema }), listEmployees);
router.get('/:id', requireRole('Owner', 'Manager'), validate({ params: employeeParamsSchema }), getEmployee);

// Only Owner can create, update, or delete employees (hiring / role changes / termination)
router.post('/', requireRole('Owner'), validate({ body: createEmployeeSchema }), createEmployee);
router.put('/:id', requireRole('Owner'), validate({ body: updateEmployeeSchema, params: employeeParamsSchema }), updateEmployee);
router.delete('/:id', requireRole('Owner'), validate({ params: employeeParamsSchema }), deleteEmployee);

export default router;

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Employees Controller — CRUD for staff management.
 * Delegates business logic to employeeService.
 * CRITICAL: PIN fields are NEVER returned in API responses.
 * Supports filtering by branch and role for multi-branch setups.
 */

import { Request, Response } from 'express';
import { employeeService } from '../services';

/** GET /api/employees — List employees with optional branch/role filter */
export async function listEmployees(req: Request, res: Response): Promise<void> {
  try {
    const { branchId, role } = req.query;
    const result = await employeeService.list({
      branchId: branchId as string,
      role: role as string,
    });
    res.json({ data: result.data, total: result.total });
  } catch (error) {
    console.error('[EmployeesController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/employees/:id — Get single employee (without PIN) */
export async function getEmployee(req: Request, res: Response): Promise<void> {
  try {
    const employee = await employeeService.getById(req.params.id);
    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }
    res.json({ data: employee });
  } catch (error) {
    console.error('[EmployeesController] get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/employees — Create a new employee (PIN required) */
export async function createEmployee(req: Request, res: Response): Promise<void> {
  try {
    if (!req.body.pin) {
      res.status(400).json({ error: 'PIN is required' });
      return;
    }
    // Inject restaurantId from the authenticated token. The create schema is
    // .strict() (no restaurantId field) and the service has no knowledge of the
    // requester, so without this every API-created employee gets a NULL
    // restaurantId and can never log in (authService requires it).
    const employee = await employeeService.create({
      ...req.body,
      restaurantId: (req as any).user?.restaurantId,
    });
    res.status(201).json({ data: employee });
  } catch (error) {
    console.error('[EmployeesController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /api/employees/:id — Update employee details */
export async function updateEmployee(req: Request, res: Response): Promise<void> {
  try {
    const employee = await employeeService.update(req.params.id, req.body);
    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }
    res.json({ data: employee });
  } catch (error) {
    console.error('[EmployeesController] update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /api/employees/:id — Soft-delete an employee */
export async function deleteEmployee(req: Request, res: Response): Promise<void> {
  try {
    const deleted = await employeeService.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[EmployeesController] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

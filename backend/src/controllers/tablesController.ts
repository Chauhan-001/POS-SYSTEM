/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tables Controller — CRUD + operations for restaurant floor plan tables.
 * Delegates business logic to tableService. Table status is decided by the
 * server-side state machine (tableStateService), never by the client.
 */

import { Request, Response } from 'express';
import { tableService } from '../services';
import { AuthenticatedRequest } from '../middleware/authMiddleware';

function authCtx(req: Request) {
  const user = (req as AuthenticatedRequest).user;
  return {
    restaurantId: user?.restaurantId,
    branchId: (req.body as any)?.branchId || undefined,
    operator: user?.name || 'System',
    operatorId: user?.employeeId || user?.userId,
  };
}

/** GET /api/tables — List tables with optional branch/section/status/floor filter. */
export async function listTables(req: Request, res: Response): Promise<void> {
  try {
    const { branchId, section, status, floorId } = req.query;
    // Tenant isolation: scope to the authenticated restaurant so a tenant
    // never sees another restaurant's (or orphaned seed) tables.
    const result = await tableService.list({
      branchId: branchId as string,
      section: section as string,
      status: status as string,
      floorId: floorId as string,
      restaurantId: authCtx(req).restaurantId,
    });
    res.json({ data: result.data, total: result.total });
  } catch (error) {
    console.error('[TablesController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/tables/stats — Occupancy & operations report (must precede /:id). */
export async function getTableStats(req: Request, res: Response): Promise<void> {
  try {
    const { branchId, date } = req.query;
    const stats = await tableService.occupancyStats(
      { branchId: branchId as string, date: date as string },
      authCtx(req)
    );
    res.json({ data: stats });
  } catch (error) {
    console.error('[TablesController] stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/tables/:id — Get a single table. */
export async function getTable(req: Request, res: Response): Promise<void> {
  try {
    const table = await tableService.getById(req.params.id);
    if (!table) {
      res.status(404).json({ error: 'Table not found' });
      return;
    }
    res.json({ data: table });
  } catch (error) {
    console.error('[TablesController] get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/tables — Create a new table. */
export async function createTable(req: Request, res: Response): Promise<void> {
  try {
    const table = await tableService.create(req.body, authCtx(req));
    res.status(201).json({ data: table });
  } catch (error: any) {
    if (error?.code === 11000) {
      res.status(409).json({ error: 'A table with this number already exists for the branch.' });
      return;
    }
    console.error('[TablesController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /api/tables/:id — Update a table. */
export async function updateTable(req: Request, res: Response): Promise<void> {
  try {
    const table = await tableService.update(req.params.id, req.body, authCtx(req));
    if (!table) {
      res.status(404).json({ error: 'Table not found' });
      return;
    }
    res.json({ data: table });
  } catch (error) {
    console.error('[TablesController] update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /api/tables/:id — Soft-delete a table. */
export async function deleteTable(req: Request, res: Response): Promise<void> {
  try {
    const deleted = await tableService.delete(req.params.id, authCtx(req));
    if (!deleted) {
      res.status(404).json({ error: 'Table not found' });
      return;
    }
    res.json({ success: true });
  } catch (error: any) {
    if (error.statusCode === 409) {
      res.status(409).json({ error: error.message });
      return;
    }
    console.error('[TablesController] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/tables/:id/release — Release a table. */
export async function releaseTable(req: Request, res: Response): Promise<void> {
  try {
    const table = await tableService.release(req.params.id, authCtx(req));
    if (!table) { res.status(404).json({ error: 'Table not found' }); return; }
    res.json({ data: table });
  } catch (error: any) {
    if (error.statusCode === 409) { res.status(409).json({ error: error.message }); return; }
    console.error('[TablesController] release error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/tables/:id/clean — Start cleaning. */
export async function startCleaning(req: Request, res: Response): Promise<void> {
  try {
    const table = await tableService.startCleaning(req.params.id, authCtx(req));
    if (!table) { res.status(404).json({ error: 'Table not found' }); return; }
    res.json({ data: table });
  } catch (error: any) {
    if (error.statusCode === 409) { res.status(409).json({ error: error.message }); return; }
    console.error('[TablesController] clean error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/tables/:id/clean-complete — Finish cleaning. */
export async function completeCleaning(req: Request, res: Response): Promise<void> {
  try {
    const table = await tableService.completeCleaning(req.params.id, authCtx(req));
    if (!table) { res.status(404).json({ error: 'Table not found' }); return; }
    res.json({ data: table });
  } catch (error) {
    console.error('[TablesController] clean-complete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/tables/:id/disable — Disable a table. */
export async function disableTable(req: Request, res: Response): Promise<void> {
  try {
    const table = await tableService.disable(req.params.id, req.body?.reason || 'No reason provided', authCtx(req));
    if (!table) { res.status(404).json({ error: 'Table not found' }); return; }
    res.json({ data: table });
  } catch (error: any) {
    if (error.statusCode === 409) { res.status(409).json({ error: error.message }); return; }
    console.error('[TablesController] disable error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/tables/:id/enable — Re-enable a disabled table. */
export async function enableTable(req: Request, res: Response): Promise<void> {
  try {
    const table = await tableService.enable(req.params.id, authCtx(req));
    if (!table) { res.status(404).json({ error: 'Table not found' }); return; }
    res.json({ data: table });
  } catch (error) {
    console.error('[TablesController] enable error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/tables/:id/assign-waiter — Assign/transfer a waiter. */
export async function assignWaiter(req: Request, res: Response): Promise<void> {
  try {
    const table = await tableService.assignWaiter(req.params.id, req.body, authCtx(req));
    if (!table) { res.status(404).json({ error: 'Table not found' }); return; }
    res.json({ data: table });
  } catch (error) {
    console.error('[TablesController] assignWaiter error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/tables/:id/move-order — Move a live order to another table. */
export async function moveOrder(req: Request, res: Response): Promise<void> {
  try {
    const result = await tableService.moveOrder(req.params.id, req.body.toTableId, req.body.reason, authCtx(req));
    res.json({ data: result });
  } catch (error: any) {
    if (error.statusCode === 404 || error.statusCode === 409) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[TablesController] moveOrder error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/tables/merge — Merge two tables' live orders. */
export async function mergeTables(req: Request, res: Response): Promise<void> {
  try {
    const result = await tableService.mergeTables(req.body.fromTableId, req.body.toTableId, req.body.reason, authCtx(req));
    res.json({ data: result });
  } catch (error: any) {
    if (error.statusCode === 404 || error.statusCode === 409) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[TablesController] mergeTables error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/tables/bulk-replace/:branchId — Safe transactional floor sync. */
export async function bulkReplaceTables(req: Request, res: Response): Promise<void> {
  try {
    const { branchId } = req.params;
    const result = await tableService.bulkReplaceForBranch(branchId, req.body.tables || [], authCtx(req));
    res.json({ data: result, success: true });
  } catch (error) {
    console.error('[TablesController] bulkReplace error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CustomerReport Controller — CRM reports endpoints (Phase 1.6).
 */

import { Request, Response } from 'express';
import { customerReportService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';

function userOf(req: Request): AuthenticatedRequest['user'] {
  return (req as AuthenticatedRequest).user;
}

/** GET /api/customer-reports — Full CRM report bundle (JSON or CSV). */
export async function getReport(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { startDate, endDate, limit, tier, format } = req.query;
    const params = {
      startDate: startDate as string,
      endDate: endDate as string,
      limit: limit ? Number(limit) : undefined,
      tier: tier as string,
    };

    if ((format || 'json') === 'csv') {
      const csv = await customerReportService.exportCsv(auth?.restaurantId || '', params);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="customer-report-${Date.now()}.csv"`);
      res.send(csv);
      return;
    }

    const report = await customerReportService.getReport(auth?.restaurantId || '', params);
    res.json({ data: report });
  } catch (error) {
    console.error('[CustomerReportController] getReport error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/customer-reports/segments — Segment distribution summary. */
export async function getSegmentReport(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const report = await customerReportService.getReport(auth?.restaurantId || '', { limit: 50 });
    res.json({ data: report.segmentDistribution });
  } catch (error) {
    console.error('[CustomerReportController] segment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/customer-reports/birthdays — Customers with birthday today. */
export async function getBirthdayReport(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const report = await customerReportService.getReport(auth?.restaurantId || '', { limit: 200 });
    res.json({ data: report.birthdaysToday });
  } catch (error) {
    console.error('[CustomerReportController] birthdays error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

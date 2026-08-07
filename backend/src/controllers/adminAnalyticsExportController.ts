/**
 * adminAnalyticsExportController.ts — Phase 2.6 Analytics Export Endpoints
 *
 * Thin controller that delegates to analyticsExportService.
 * Supports CSV, Excel (xlsx), and PDF exports.
 * All aggregation data comes from analyticsService (backend only).
 */

import { Request, Response } from 'express';
import * as analyticsExportService from '../services/analyticsExportService';

export async function exportDashboardCSV(_req: Request, res: Response): Promise<void> {
  try {
    await analyticsExportService.exportDashboardCSV(res);
  } catch (error) {
    console.error('[AdminExport] Dashboard CSV export error:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to export CSV' });
    }
  }
}

export async function exportDashboardExcel(_req: Request, res: Response): Promise<void> {
  try {
    await analyticsExportService.exportDashboardExcel(res);
  } catch (error) {
    console.error('[AdminExport] Dashboard Excel export error:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to export Excel' });
    }
  }
}

export async function exportDashboardPDF(_req: Request, res: Response): Promise<void> {
  try {
    await analyticsExportService.exportDashboardPDF(res);
  } catch (error) {
    console.error('[AdminExport] Dashboard PDF export error:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to export PDF' });
    }
  }
}
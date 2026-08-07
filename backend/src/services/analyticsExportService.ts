/**
 * =============================================================================
 *  analyticsExportService.ts — Phase 2.6 Analytics Export Service
 * =============================================================================
 *
 * Purpose:
 *   Generates CSV, Excel (xlsx), and PDF exports of all analytics dashboards.
 *   Reuses the analyticsService aggregation functions as data sources.
 *   Backend-generated exports only - no frontend rendering calculation.
 *
 * Dependencies:
 *   - exceljs ^4.4.0 (already in package.json)
 *   - pdfkit ^0.19.1 (already in package.json)
 */

import type { Response } from 'express';
import * as analyticsService from './analyticsService';

// ─── CSV Export ───────────────────────────────────────────────

export function exportToCSV(headers: string[], rows: string[][], res: Response, filename: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);

  let csv = '\uFEFF'; // BOM for Excel UTF-8 compatibility
  csv += headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(',') + '\r\n';

  for (const row of rows) {
    csv += row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',') + '\r\n';
  }

  res.send(csv);
}

// ─── Excel Export ─────────────────────────────────────────────

export async function exportToExcel(sheets: Array<{ name: string; headers: string[]; rows: string[][] }>, res: Response, filename: string): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name, { properties: { tabColor: { argb: 'FF2B579A' } } });

    // Header row
    const headerRow = ws.addRow(sheet.headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B579A' } };
    headerRow.alignment = { horizontal: 'center' };

    // Data rows
    for (const row of sheet.rows) {
      ws.addRow(row);
    }

    // Auto-fit columns
    ws.columns.forEach((col: any) => {
      if (col && col.eachCell) {
        let maxLength = 0;
        col.eachCell({ includeEmpty: true }, (cell: any) => {
          const val = cell.value ? String(cell.value).length : 0;
          if (val > maxLength) maxLength = val;
        });
        col.width = Math.min(Math.max(maxLength + 2, 10), 50);
      }
    });
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ─── PDF Export ───────────────────────────────────────────────

export async function exportToPDF(
  title: string,
  sections: Array<{ heading: string; data: Array<{ label: string; value: string }> }>,
  res: Response,
  filename: string
): Promise<void> {
  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);

  // Header
  doc.fontSize(20).font('Helvetica-Bold').text(title, { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(10).font('Helvetica').text(`Generated: ${new Date().toISOString()}`, { align: 'center' });
  doc.moveDown(1);

  // Horizontal rule
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#2B579A').stroke();
  doc.moveDown(0.5);

  for (const section of sections) {
    // Section heading
    if (doc.y > 700) doc.addPage();
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#2B579A').text(section.heading);
    doc.moveDown(0.3);

    for (const item of section.data) {
      if (doc.y > 720) doc.addPage();
      doc.fontSize(10).font('Helvetica').fillColor('#333333');
      doc.text(`${item.label}: `, { continued: true });
      doc.font('Helvetica-Bold').text(item.value);
    }

    doc.moveDown(0.5);
  }

  // Footer
  doc.fontSize(8).font('Helvetica').fillColor('#999999');
  doc.text(`POS System - Platform Analytics Export`, 50, doc.page.height - 50, { align: 'center' });

  doc.end();
}

// ─── Dashboard Export (all metrics) ───────────────────────────

export async function exportDashboardCSV(res: Response): Promise<void> {
  const stats = await analyticsService.getDashboardStats();

  const headers = ['Metric', 'Value'];
  const rows: string[][] = [
    ['Total Restaurants', String(stats.totalRestaurants)],
    ['Active Restaurants', String(stats.activeRestaurants)],
    ['Inactive Restaurants', String(stats.inactiveRestaurants)],
    ['Suspended Restaurants', String(stats.suspendedRestaurants)],
    ['Total Owners', String(stats.totalOwners)],
    ['Active Owners', String(stats.activeOwners)],
    ['Total Devices', String(stats.totalDevices)],
    ['Active Devices', String(stats.activeDevices)],
    ['Offline Devices', String(stats.offlineDevices)],
    ['Pending Devices', String(stats.pendingDevices)],
    ['Blocked Devices', String(stats.blockedDevices)],
    ['Subscriptions Expiring', String(stats.subscriptionsExpiring)],
    ['Today Logins', String(stats.todayLogins)],
    ['AI Requests', String(stats.aiRequests)],
    ['AI Success Rate', `${stats.aiSuccessRate}%`],
    ['Total Orders (30d)', String(stats.totalOrders)],
    ['Total Bills (30d)', String(stats.totalBills)],
    ['Total API Requests (30d)', String(stats.totalApiRequests)],
    ['Subscriptions Total', String(stats.subscriptionCounts.total)],
    ['Subscriptions Active', String(stats.subscriptionCounts.active)],
    ['Subscriptions Trial', String(stats.subscriptionCounts.trial)],
    ['Subscriptions Paused', String(stats.subscriptionCounts.paused)],
    ['Subscriptions Expired', String(stats.subscriptionCounts.expired)],
    ['Subscriptions Cancelled', String(stats.subscriptionCounts.cancelled)],
    ['Subscriptions Suspended', String(stats.subscriptionCounts.suspended)],
  ];

  exportToCSV(headers, rows, res, 'dashboard-stats');
}

export async function exportDashboardExcel(res: Response): Promise<void> {
  const [stats, analytics, ai, devices, growth, churn, activity, revenue] = await Promise.all([
    analyticsService.getDashboardStats(),
    analyticsService.getAnalyticsData(),
    analyticsService.getAIAnalytics(30),
    analyticsService.getDeviceAnalytics(),
    analyticsService.getGrowthMetrics(),
    analyticsService.getChurnMetrics(),
    analyticsService.getActivityMetrics(),
    analyticsService.getSubscriptionRevenue(),
  ]);

  const sheets: Array<{ name: string; headers: string[]; rows: string[][] }> = [
    {
      name: 'Dashboard KPIs',
      headers: ['Metric', 'Value'],
      rows: [
        ['Total Restaurants', String(stats.totalRestaurants)],
        ['Active Restaurants', String(stats.activeRestaurants)],
        ['Suspended', String(stats.suspendedRestaurants)],
        ['Total Owners', String(stats.totalOwners)],
        ['Active Devices', String(stats.activeDevices)],
        ['AI Requests (30d)', String(stats.aiRequests)],
        ['API Requests (30d)', String(stats.totalApiRequests)],
        ['Orders (30d)', String(stats.totalOrders)],
        ['Bills (30d)', String(stats.totalBills)],
        ['Active Subscriptions', String(stats.subscriptionCounts.active)],
      ],
    },
    {
      name: 'Revenue',
      headers: ['Metric', 'Value'],
      rows: [
        ['Total Revenue', `₹${revenue.total.revenue.toLocaleString()}`],
        ['Cash Revenue', `₹${revenue.cash.revenue.toLocaleString()}`],
        ['Razorpay Revenue', `₹${revenue.razorpay.revenue.toLocaleString()}`],
        ['Total Payments', String(revenue.total.count)],
        ...revenue.monthly.map((m) => [`Revenue ${m.month}`, `₹${m.total.toLocaleString()}`]),
      ],
    },
    {
      name: 'AI Analytics',
      headers: ['Metric', 'Value'],
      rows: [
        ['Total AI Requests', String(ai.totalRequests)],
        ['Success Rate', `${ai.successRate}%`],
        ['Failures', String(ai.failures)],
        ['Fallback Usage', String(ai.fallbackUsage)],
        ['Cache Hits', String(ai.cacheHits)],
        ['Average Latency', `${ai.averageLatency}ms`],
        ...ai.byFeature.map((f) => [`AI Feature: ${f.name}`, String(f.value)]),
      ],
    },
    {
      name: 'Devices',
      headers: ['Status', 'Count'],
      rows: [
        ['Total', String(devices.total)],
        ['Active', String(devices.active)],
        ['Inactive', String(devices.inactive)],
        ['Blocked', String(devices.blocked)],
        ['Pending', String(devices.pending)],
        ['Online', String(devices.online)],
        ['Offline', String(devices.offline)],
        ['Healthy', String(devices.health.healthy)],
        ['Unhealthy', String(devices.health.unhealthy)],
      ],
    },
    {
      name: 'Growth',
      headers: ['Period', 'Restaurants', 'Revenue', 'Users', 'Devices', 'AI'],
      rows: [
        ['Daily', `${growth.restaurantGrowth.daily}%`, `${growth.revenueGrowth.daily}%`, `${growth.userGrowth.daily}%`, `${growth.deviceGrowth.daily}%`, `${growth.aiUsageGrowth.daily}%`],
        ['Weekly', `${growth.restaurantGrowth.weekly}%`, `${growth.revenueGrowth.weekly}%`, `${growth.userGrowth.weekly}%`, `${growth.deviceGrowth.weekly}%`, `${growth.aiUsageGrowth.weekly}%`],
        ['Monthly', `${growth.restaurantGrowth.monthly}%`, `${growth.revenueGrowth.monthly}%`, `${growth.userGrowth.monthly}%`, `${growth.deviceGrowth.monthly}%`, `${growth.aiUsageGrowth.monthly}%`],
        ['Yearly', `${growth.restaurantGrowth.yearly}%`, `${growth.revenueGrowth.yearly}%`, `${growth.userGrowth.yearly}%`, `${growth.deviceGrowth.yearly}%`, `${growth.aiUsageGrowth.yearly}%`],
      ],
    },
    {
      name: 'Churn',
      headers: ['Metric', 'Value'],
      rows: [
        ['Suspended Restaurants', String(churn.suspendedRestaurants)],
        ['Subscription Churn Total', String(churn.subscriptionChurn.total)],
        ['Churn Rate', `${churn.churnRate}%`],
        ['Trial Conversions', String(churn.trialConversions.converted)],
        ['Conversion Rate', `${churn.trialConversions.rate}%`],
        ['Failed Renewals', String(churn.failedRenewals)],
        ['Inactive Restaurants', String(churn.inactiveRestaurants)],
      ],
    },
    {
      name: 'Activity',
      headers: ['Activity', 'Daily', 'Weekly', 'Monthly'],
      rows: [
        ['Logins', String(activity.dailyLogins), String(activity.weeklyLogins), String(activity.monthlyLogins)],
        ['Active Users', String(activity.activeUsers), '-', '-'],
        ['Active Owners', String(activity.activeOwners), '-', '-'],
        ['Owner Activity', String(activity.ownerActivity.daily), String(activity.ownerActivity.weekly), String(activity.ownerActivity.monthly)],
        ['Device Activity', String(activity.deviceActivity.daily), String(activity.deviceActivity.weekly), String(activity.deviceActivity.monthly)],
        ['AI Activity', String(activity.aiActivity.daily), String(activity.aiActivity.weekly), String(activity.aiActivity.monthly)],
      ],
    },
    {
      name: 'Daily Trends',
      headers: ['Date', 'Restaurants', 'Logins', 'Revenue', 'AI Usage', 'API Requests'],
      rows: analytics.restaurantGrowth.map((r, i) => [
        r.name,
        String(r.value),
        String(analytics.dailyLogins[i]?.value || 0),
        String(analytics.revenueDaily[i]?.value || 0),
        String(analytics.aiUsage[i]?.value || 0),
        String(analytics.apiRequestsDaily[i]?.value || 0),
      ]),
    },
  ];

  await exportToExcel(sheets, res, 'dashboard-full');
}

export async function exportDashboardPDF(res: Response): Promise<void> {
  const [stats, ai, devices, growth, churn] = await Promise.all([
    analyticsService.getDashboardStats(),
    analyticsService.getAIAnalytics(30),
    analyticsService.getDeviceAnalytics(),
    analyticsService.getGrowthMetrics(),
    analyticsService.getChurnMetrics(),
  ]);

  const sections: Array<{ heading: string; data: Array<{ label: string; value: string }> }> = [
    {
      heading: 'Dashboard KPIs',
      data: [
        { label: 'Total Restaurants', value: String(stats.totalRestaurants) },
        { label: 'Active Restaurants', value: String(stats.activeRestaurants) },
        { label: 'Suspended', value: String(stats.suspendedRestaurants) },
        { label: 'Active Devices', value: String(stats.activeDevices) },
        { label: 'Offline Devices', value: String(stats.offlineDevices) },
        { label: 'AI Requests (30d)', value: String(stats.aiRequests) },
        { label: 'AI Success Rate', value: `${stats.aiSuccessRate}%` },
        { label: 'Orders (30d)', value: String(stats.totalOrders) },
        { label: 'Active Subscriptions', value: String(stats.subscriptionCounts.active) },
      ],
    },
    {
      heading: 'AI Analytics',
      data: [
        { label: 'Total Requests', value: String(ai.totalRequests) },
        { label: 'Success Rate', value: `${ai.successRate}%` },
        { label: 'Failures', value: String(ai.failures) },
        { label: 'Average Latency', value: `${ai.averageLatency}ms` },
        { label: 'Cache Hits', value: String(ai.cacheHits) },
        ...ai.byFeature.slice(0, 5).map((f) => ({
          label: `Feature: ${f.name}`,
          value: `${f.value} (${f.successRate}% success)`,
        })),
      ],
    },
    {
      heading: 'Device Health',
      data: [
        { label: 'Total Devices', value: String(devices.total) },
        { label: 'Active', value: String(devices.active) },
        { label: 'Online', value: String(devices.online) },
        { label: 'Offline', value: String(devices.offline) },
        { label: 'Healthy', value: String(devices.health.healthy) },
        { label: 'Unhealthy', value: String(devices.health.unhealthy) },
      ],
    },
    {
      heading: 'Growth Rates',
      data: [
        { label: 'Restaurant Growth (Daily)', value: `${growth.restaurantGrowth.daily}%` },
        { label: 'Restaurant Growth (Weekly)', value: `${growth.restaurantGrowth.weekly}%` },
        { label: 'Restaurant Growth (Monthly)', value: `${growth.restaurantGrowth.monthly}%` },
        { label: 'Revenue Growth (Daily)', value: `${growth.revenueGrowth.daily}%` },
        { label: 'Revenue Growth (Monthly)', value: `${growth.revenueGrowth.monthly}%` },
        { label: 'Device Growth (Daily)', value: `${growth.deviceGrowth.daily}%` },
        { label: 'AI Usage Growth (Daily)', value: `${growth.aiUsageGrowth.daily}%` },
      ],
    },
    {
      heading: 'Churn Metrics',
      data: [
        { label: 'Suspended Restaurants', value: String(churn.suspendedRestaurants) },
        { label: 'Subscription Churn Rate', value: `${churn.churnRate}%` },
        { label: 'Trial Conversion Rate', value: `${churn.trialConversions.rate}%` },
        { label: 'Failed Renewals (30d)', value: String(churn.failedRenewals) },
      ],
    },
  ];

  await exportToPDF('Platform Analytics Dashboard', sections, res, 'dashboard-report');
}
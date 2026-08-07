/**
 * =============================================================================
 *  customerReports.ts — Customer CRM Reports Routes (Phase 1.6)
 * =============================================================================
 *
 * Routes: Full CRM report bundle (JSON/CSV), segment distribution, birthdays.
 * Access: All staff (read).
 * Path:   /api/customer-reports
 */

import { Router } from 'express';
import { getReport, getSegmentReport, getBirthdayReport } from '../controllers/customerReportController';
import { requireAuth } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import { customerReportQuerySchema } from '../validation';

const router = Router();

router.get('/', requireAuth, requireFeature('loyalty'), validate({ query: customerReportQuerySchema }), getReport);
router.get('/segments', requireAuth, requireFeature('loyalty'), getSegmentReport);
router.get('/birthdays', requireAuth, requireFeature('loyalty'), getBirthdayReport);

export default router;

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Calendar Routes — Context Calendar API (Phase 1: platform-admin managed).
 *
 *   GET    /api/calendar/events            — list (startDate/endDate/type/scope/status/search/restaurantId/withinDays/limit)
 *   GET    /api/calendar/events/:id        — single event
 *   POST   /api/calendar/events            — create
 *   PUT    /api/calendar/events/:id        — update
 *   PATCH  /api/calendar/events/:id/archive — archive (recoverable via restore)
 *   PATCH  /api/calendar/events/:id/restore — restore archived → active
 *
 * Auth: requireAdminAuth (admin-dashboard JWT, surface=admin, role=super_admin).
 * All rules (date order, scope fields, tenancy) live in calendarService — the
 * same service later Gemini/external writers will call.
 */

import { Router } from 'express';
import { requireAdminAuth } from '../../../middleware/authMiddleware';
import { validate } from '../../../middleware/validate';
import {
  listEvents, getEvent, createEvent, updateEvent, archiveEvent, restoreEvent,
  calendarErrorHandler,
} from '../controllers/calendarController';
import {
  generateEvents, approveGenerated, approveDraft,
  calendarAssistantErrorHandler,
} from '../controllers/calendarAssistantController';
import {
  createEventSchema, updateEventSchema, eventParamsSchema, eventQuerySchema,
  assistantGenerateSchema, assistantApproveSchema,
} from '../validators/calendar';

const router = Router();

// Route order matters: static paths BEFORE :id params.
// ─── AI assistant (Phase 2) — generate never persists; approve re-validates.
router.post('/assistant/generate', requireAdminAuth, validate({ body: assistantGenerateSchema }), generateEvents);
router.post('/assistant/approve', requireAdminAuth, validate({ body: assistantApproveSchema }), approveGenerated);

router.get('/events', requireAdminAuth, validate({ query: eventQuerySchema }), listEvents);
router.post('/events', requireAdminAuth, validate({ body: createEventSchema }), createEvent);

router.get('/events/:id', requireAdminAuth, validate({ params: eventParamsSchema }), getEvent);
router.put('/events/:id', requireAdminAuth, validate({ params: eventParamsSchema, body: updateEventSchema }), updateEvent);
router.patch('/events/:id/archive', requireAdminAuth, validate({ params: eventParamsSchema }), archiveEvent);
router.patch('/events/:id/restore', requireAdminAuth, validate({ params: eventParamsSchema }), restoreEvent);
router.patch('/events/:id/approve', requireAdminAuth, validate({ params: eventParamsSchema }), approveDraft);

router.use(calendarErrorHandler);
router.use(calendarAssistantErrorHandler);

export default router;

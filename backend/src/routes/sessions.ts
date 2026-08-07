/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * sessions.ts — Session & refresh-token management routes.
 *
 * All routes require an authenticated JWT (bearer token). Session access is
 * scoped to the logged-in user; ownership is enforced in sessionService.
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { listSessions, revokeSession, revokeAllSessions } from '../controllers/sessionController';
import { objectId } from '../validation/common';
import { validate } from '../middleware/validate';
import { z } from 'zod';

const router = Router();

router.use(requireAuth);

router.get('/', listSessions);
router.delete('/:id', validate({ params: z.object({ id: objectId }) }), revokeSession);
router.post('/revoke-all', revokeAllSessions);

export default router;
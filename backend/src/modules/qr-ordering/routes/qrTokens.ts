/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * QR Token Routes — QR Studio API (POS). Authenticated, Owner/Manager only.
 *
 * Route prefix: /api/qr-tokens
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../../middleware/authMiddleware';
import { validate } from '../../../middleware/validate';
import {
  listQrTokens,
  createQrToken,
  deleteQrToken,
  seedQrTokens,
} from '../controllers/qrTokenController';

const router = Router();

router.use(requireAuth, requireRole('Owner', 'Manager'));

const createTokenSchema = z.object({
  type: z.enum(['table', 'car', 'pickup']),
  tableId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  parkingSlot: z.string().max(40).optional(),
  branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
}).strict();

const seedSchema = z.object({
  branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
}).strict();

router.get('/', listQrTokens);
router.post('/', validate({ body: createTokenSchema }), createQrToken);
router.post('/seed', validate({ body: seedSchema }), seedQrTokens);
router.delete('/:id', deleteQrToken);

export default router;

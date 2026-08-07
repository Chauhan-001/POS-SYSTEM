import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { registerDevice, getMyDevices, heartbeatDevice } from '../controllers/deviceRegistrationController';
import { deviceRegisterSchema, deviceHeartbeatSchema } from '../validation/device';

const router = Router();

// NOTE: this router is mounted at /api/devices (server.ts), so paths here are
// relative — /register → /api/devices/register (matches the POS frontend client).
router.post('/register', requireAuth, validate({ body: deviceRegisterSchema }), registerDevice);
router.post('/heartbeat', requireAuth, validate({ body: deviceHeartbeatSchema }), heartbeatDevice);
router.get('/my-devices', requireAuth, getMyDevices);

export default router;

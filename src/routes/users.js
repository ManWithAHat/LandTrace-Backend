import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getMe, updateMe } from '../controllers/users.js';

const router = Router();

router.use(authenticateToken);
router.get('/me', getMe);
router.patch('/me', updateMe);

export default router;

import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { createTrace, listTraces, getTrace, deleteTrace } from '../controllers/traces.js';

const router = Router();

router.use(authenticateToken);
router.post('/', createTrace);
router.get('/', listTraces);
router.get('/:id', getTrace);
router.delete('/:id', deleteTrace);

export default router;

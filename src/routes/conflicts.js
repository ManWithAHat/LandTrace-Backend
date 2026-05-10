import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  listConflicts,
  getConflict,
  addConflictNote,
  updateConflictStatus,
} from '../controllers/conflicts.js';

const router = Router();

router.use(authenticateToken);
router.get('/', listConflicts);
router.get('/:id', getConflict);
router.post('/:id/notes', addConflictNote);
router.patch('/:id/status', updateConflictStatus);

export default router;

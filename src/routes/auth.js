import { Router } from 'express';
import { requestOtp, verifyOtp, refreshToken, logout } from '../controllers/auth.js';

const router = Router();

router.post('/otp/request', requestOtp);
router.post('/otp/verify', verifyOtp);
router.post('/token/refresh', refreshToken);
router.post('/logout', logout);

export default router;

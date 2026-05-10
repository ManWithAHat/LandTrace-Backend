import { verifyAccessToken } from '../utils/token.js';
import { errorResponse } from '../utils/errors.js';

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function authenticateToken(req, res, next) {
  const header = req.headers['authorization'];
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return errorResponse(res, 401, 'UNAUTHORIZED', 'Missing access token');
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub };
    next();
  } catch {
    return errorResponse(res, 401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
}

/**
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
export function errorResponse(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

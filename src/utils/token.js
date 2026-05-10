import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export function signAccessToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

export function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

// SHA-256 for deterministic lookup — bcrypt can't be used for token lookup
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

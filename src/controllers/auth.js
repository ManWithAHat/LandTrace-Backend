import { z } from 'zod';
import { sendOtp, checkOtp } from '../services/twilio.js';
import { supabase } from '../db.js';
import { signAccessToken, generateRefreshToken, hashToken } from '../utils/token.js';
import { errorResponse } from '../utils/errors.js';

const E164 = /^\+[1-9]\d{1,14}$/;

const phoneSchema = z.object({
  phone: z.string().regex(E164, 'Phone must be E.164 format (e.g. +919876543210)'),
});

const verifySchema = z.object({
  phone: z.string().regex(E164, 'Phone must be E.164 format'),
  code: z.string().length(6, 'OTP must be 6 digits'),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

function refreshExpiresAt() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString();
}

export async function requestOtp(req, res) {
  const parsed = phoneSchema.safeParse(req.body);
  if (!parsed.success) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', parsed.error.errors[0].message);
  }

  try {
    await sendOtp(parsed.data.phone);
    return res.json({ message: 'OTP sent' });
  } catch (err) {
    console.error('Twilio sendOtp:', err);
    return errorResponse(res, 502, 'OTP_SEND_FAILED', 'Failed to send OTP');
  }
}

export async function verifyOtp(req, res) {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', parsed.error.errors[0].message);
  }

  const { phone, code } = parsed.data;

  let check;
  try {
    check = await checkOtp(phone, code);
  } catch (err) {
    console.error('Twilio checkOtp:', err);
    return errorResponse(res, 502, 'OTP_CHECK_FAILED', 'Failed to verify OTP');
  }

  if (check.status !== 'approved') {
    return errorResponse(res, 400, 'OTP_INVALID', 'Invalid or expired OTP');
  }

  const { data: userResult, error: upsertErr } = await supabase.rpc('upsert_user', {
    p_phone: phone,
  });

  if (upsertErr || !userResult) {
    console.error('upsert_user:', upsertErr);
    return errorResponse(res, 500, 'DB_ERROR', 'Failed to create or fetch user');
  }

  const { is_new_user: isNewUser, ...user } = userResult;

  const accessToken = signAccessToken(user.id);
  const refreshToken = generateRefreshToken();
  const tokenHash = hashToken(refreshToken);

  const { error: tokenErr } = await supabase.from('refresh_tokens').insert({
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: refreshExpiresAt(),
    revoked: false,
  });

  if (tokenErr) {
    console.error('Insert refresh_token:', tokenErr);
    return errorResponse(res, 500, 'DB_ERROR', 'Failed to issue session');
  }

  return res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    user_id: user.id,
    is_new_user: isNewUser,
  });
}

export async function refreshToken(req, res) {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'refresh_token is required');
  }

  const tokenHash = hashToken(parsed.data.refresh_token);

  const { data: row, error } = await supabase
    .from('refresh_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .eq('revoked', false)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !row) {
    return errorResponse(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
  }

  // Revoke old token
  await supabase.from('refresh_tokens').update({ revoked: true }).eq('id', row.id);

  // Issue rotated pair
  const newAccess = signAccessToken(row.user_id);
  const newRefresh = generateRefreshToken();
  const newHash = hashToken(newRefresh);

  const { error: insertErr } = await supabase.from('refresh_tokens').insert({
    user_id: row.user_id,
    token_hash: newHash,
    expires_at: refreshExpiresAt(),
    revoked: false,
  });

  if (insertErr) {
    return errorResponse(res, 500, 'DB_ERROR', 'Failed to issue new session');
  }

  return res.json({ access_token: newAccess, refresh_token: newRefresh });
}

export async function logout(req, res) {
  const parsed = refreshSchema.safeParse(req.body);
  if (parsed.success) {
    const tokenHash = hashToken(parsed.data.refresh_token);
    await supabase
      .from('refresh_tokens')
      .update({ revoked: true })
      .eq('token_hash', tokenHash);
  }
  return res.status(204).end();
}

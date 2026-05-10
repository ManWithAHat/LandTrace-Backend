import { z } from 'zod';
import { supabase } from '../db.js';
import { errorResponse } from '../utils/errors.js';

const updateSchema = z
  .object({
    name: z.string().min(1).max(100),
    village: z.string().max(100),
    district: z.string().max(100),
    state: z.string().max(100),
    language: z.string().max(20),
  })
  .partial()
  .strict();

export async function getMe(req, res) {
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', req.user.id)
    .single();

  if (error || !user) {
    return errorResponse(res, 404, 'USER_NOT_FOUND', 'User not found');
  }

  return res.json(user);
}

export async function updateMe(req, res) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', parsed.error.errors[0].message);
  }

  if (Object.keys(parsed.data).length === 0) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'No valid fields provided');
  }

  const { data: user, error } = await supabase
    .from('users')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) {
    console.error('updateMe:', error);
    return errorResponse(res, 500, 'DB_ERROR', 'Failed to update user');
  }

  return res.json(user);
}

import { z } from 'zod';
import { supabase } from '../db.js';
import { errorResponse } from '../utils/errors.js';

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['open', 'resolved', 'dismissed']).default('open'),
});

const noteSchema = z.object({
  text: z.string().min(1).max(1000),
});

const statusSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
  resolution_note: z.string().max(1000).optional(),
});

/** Returns true when userId owns either trace in the conflict. */
async function assertConflictAccess(conflictId, userId) {
  const { data: hasAccess, error } = await supabase.rpc('user_can_access_conflict', {
    p_conflict_id: conflictId,
    p_user_id: userId,
  });
  if (error) throw error;
  return hasAccess ?? false;
}

export async function listConflicts(req, res) {
  const parsed = pageSchema.safeParse(req.query);
  if (!parsed.success) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Invalid query params');
  }

  const { limit, offset, status } = parsed.data;

  const { data: conflicts, error } = await supabase.rpc('list_conflicts_for_user', {
    p_user_id: req.user.id,
    p_status: status,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    console.error('listConflicts:', error);
    return errorResponse(res, 500, 'DB_ERROR', 'Failed to fetch conflicts');
  }

  return res.json({ conflicts: conflicts ?? [], limit, offset, status });
}

export async function getConflict(req, res) {
  const { id } = req.params;

  try {
    const hasAccess = await assertConflictAccess(id, req.user.id);
    if (!hasAccess) {
      return errorResponse(res, 404, 'NOT_FOUND', 'Conflict not found');
    }

    const { data: conflict, error } = await supabase.rpc('get_conflict_full', {
      p_conflict_id: id,
    });

    if (error) {
      console.error('getConflict:', error);
      return errorResponse(res, 500, 'DB_ERROR', 'Failed to fetch conflict');
    }

    if (!conflict) {
      return errorResponse(res, 404, 'NOT_FOUND', 'Conflict not found');
    }

    return res.json(conflict);
  } catch (err) {
    console.error('getConflict:', err);
    return errorResponse(res, 500, 'DB_ERROR', 'Failed to fetch conflict');
  }
}

export async function addConflictNote(req, res) {
  const { id } = req.params;
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', parsed.error.errors[0].message);
  }

  try {
    const hasAccess = await assertConflictAccess(id, req.user.id);
    if (!hasAccess) {
      return errorResponse(res, 404, 'NOT_FOUND', 'Conflict not found');
    }

    const { data: note, error } = await supabase
      .from('conflict_notes')
      .insert({ conflict_id: id, author_id: req.user.id, body: parsed.data.text })
      .select()
      .single();

    if (error) {
      console.error('addConflictNote:', error);
      return errorResponse(res, 500, 'DB_ERROR', 'Failed to add note');
    }

    return res.status(201).json(note);
  } catch (err) {
    console.error('addConflictNote:', err);
    return errorResponse(res, 500, 'DB_ERROR', 'Failed to add note');
  }
}

export async function updateConflictStatus(req, res) {
  const { id } = req.params;
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', parsed.error.errors[0].message);
  }

  const { status, resolution_note } = parsed.data;

  try {
    const hasAccess = await assertConflictAccess(id, req.user.id);
    if (!hasAccess) {
      return errorResponse(res, 404, 'NOT_FOUND', 'Conflict not found');
    }

    const { data: updated, error: updateErr } = await supabase
      .from('conflicts')
      .update({ status, resolved_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      console.error('updateConflictStatus:', updateErr);
      return errorResponse(res, 500, 'DB_ERROR', 'Failed to update conflict status');
    }

    if (resolution_note) {
      await supabase.from('conflict_notes').insert({
        conflict_id: id,
        author_id: req.user.id,
        body: resolution_note,
      });
    }

    return res.json(updated);
  } catch (err) {
    console.error('updateConflictStatus:', err);
    return errorResponse(res, 500, 'DB_ERROR', 'Failed to update conflict');
  }
}

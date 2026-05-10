import { z } from 'zod';
import { supabase } from '../db.js';
import { detectConflicts, upsertConflict } from '../services/conflicts.js';
import { errorResponse } from '../utils/errors.js';

const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z
    .array(z.array(z.tuple([z.number(), z.number()])).min(4))
    .min(1),
});

const createSchema = z.object({
  geometry: polygonSchema,
  local_id: z.string().min(1).max(100),
  label: z.string().max(200).optional(),
  traced_at: z.string().datetime().optional(),
});

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function createTrace(req, res) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', parsed.error.errors[0].message);
  }

  const { geometry, local_id, label, traced_at } = parsed.data;
  const geomJson = JSON.stringify(geometry);
  const ownerId = req.user.id;

  const { data: trace, error: insertErr } = await supabase.rpc('insert_trace', {
    p_owner_id: ownerId,
    p_local_id: local_id,
    p_label: label ?? null,
    p_geojson: geomJson,
    p_traced_at: traced_at ?? new Date().toISOString(),
  });

  if (insertErr) {
    if (insertErr.code === '23505') {
      return errorResponse(res, 409, 'DUPLICATE_LOCAL_ID', 'A trace with this local_id already exists');
    }
    console.error('createTrace insert:', insertErr);
    return errorResponse(res, 500, 'DB_ERROR', 'Failed to insert trace');
  }

  // Non-fatal conflict detection — trace is committed regardless
  const conflicts = [];
  try {
    const hits = await detectConflicts(geomJson, ownerId, trace.id);
    for (const hit of hits) {
      const conflict = await upsertConflict(trace.id, hit);
      if (conflict) conflicts.push(conflict);
    }
  } catch (err) {
    console.error('createTrace conflict detection:', err);
  }

  return res.status(201).json({ trace, conflicts });
}

export async function listTraces(req, res) {
  const parsed = pageSchema.safeParse(req.query);
  if (!parsed.success) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Invalid pagination params');
  }

  const { limit, offset } = parsed.data;

  const { data: traces, error } = await supabase.rpc('list_traces', {
    p_owner_id: req.user.id,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    console.error('listTraces:', error);
    return errorResponse(res, 500, 'DB_ERROR', 'Failed to fetch traces');
  }

  return res.json({ traces: traces ?? [], limit, offset });
}

export async function getTrace(req, res) {
  const { data: trace, error } = await supabase.rpc('get_trace', {
    p_trace_id: req.params.id,
    p_owner_id: req.user.id,
  });

  if (error) {
    console.error('getTrace:', error);
    return errorResponse(res, 500, 'DB_ERROR', 'Failed to fetch trace');
  }

  if (!trace) {
    return errorResponse(res, 404, 'NOT_FOUND', 'Trace not found');
  }

  return res.json(trace);
}

export async function deleteTrace(req, res) {
  const { data: trace, error: fetchErr } = await supabase
    .from('traces')
    .select('id')
    .eq('id', req.params.id)
    .eq('owner_id', req.user.id)
    .single();

  if (fetchErr || !trace) {
    return errorResponse(res, 404, 'NOT_FOUND', 'Trace not found');
  }

  const { error: delErr } = await supabase
    .from('traces')
    .delete()
    .eq('id', req.params.id);

  if (delErr) {
    console.error('deleteTrace:', delErr);
    return errorResponse(res, 500, 'DB_ERROR', 'Failed to delete trace');
  }

  return res.status(204).end();
}

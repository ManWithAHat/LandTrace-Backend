import { supabase } from '../db.js';

/**
 * Find all traces from other owners that intersect the given GeoJSON polygon.
 *
 * @param {string} geometryGeoJson - JSON string of the new trace's GeoJSON Polygon
 * @param {string} ownerUuid       - owner_id of the new trace
 * @param {string} traceUuid       - id of the new trace (excluded from results)
 * @returns {Promise<Array>}
 */
export async function detectConflicts(geometryGeoJson, ownerUuid, traceUuid) {
  const { data: rows, error } = await supabase.rpc('detect_conflicts', {
    p_geojson: geometryGeoJson,
    p_owner_id: ownerUuid,
    p_trace_id: traceUuid,
  });
  if (error) throw error;
  return rows ?? [];
}

/**
 * Upsert a conflict row. Enforces canonical ordering: smaller UUID → trace_a_id.
 * Returns the inserted conflict row, or null if it already existed (DO NOTHING).
 *
 * @param {string} traceNewId  - id of the newly uploaded trace
 * @param {object} row         - a row from detectConflicts()
 * @returns {Promise<object|null>}
 */
export async function upsertConflict(traceNewId, row) {
  const { other_trace_id, overlap_geometry, overlap_sqm, other_area, new_area } = row;

  const isNewFirst = traceNewId < other_trace_id;
  const [traceAId, traceBId] = isNewFirst
    ? [traceNewId, other_trace_id]
    : [other_trace_id, traceNewId];

  // overlap_pct_a = overlap as % of trace_a area; overlap_pct_b = % of trace_b area
  const aArea = isNewFirst ? new_area : other_area;
  const bArea = isNewFirst ? other_area : new_area;
  const overlapPctA = aArea > 0 ? (overlap_sqm / aArea) * 100 : 0;
  const overlapPctB = bArea > 0 ? (overlap_sqm / bArea) * 100 : 0;

  const { data: conflict, error } = await supabase.rpc('upsert_conflict', {
    p_trace_a_id: traceAId,
    p_trace_b_id: traceBId,
    p_overlap_geojson: JSON.stringify(overlap_geometry),
    p_overlap_sqm: overlap_sqm,
    p_overlap_pct_a: overlapPctA,
    p_overlap_pct_b: overlapPctB,
  });
  if (error) throw error;
  return conflict ?? null;
}

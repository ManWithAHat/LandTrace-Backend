-- ================================================================
-- LandTrace – Supabase RPC Functions (PostGIS)
-- Paste into the Supabase SQL Editor and click Run.
-- Safe to re-run: all functions use CREATE OR REPLACE.
-- ================================================================


-- ----------------------------------------------------------------
-- 1. insert_trace
-- Inserts a trace with ST_GeomFromGeoJSON and returns the full row
-- including area_sqm / perimeter_m populated by the DB trigger.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION insert_trace(
  p_owner_id  uuid,
  p_local_id  text,
  p_label     text,
  p_geojson   text,
  p_traced_at timestamptz
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  INSERT INTO traces (owner_id, local_id, label, geometry, traced_at)
  VALUES (
    p_owner_id,
    p_local_id,
    p_label,
    ST_GeomFromGeoJSON(p_geojson),
    p_traced_at
  )
  RETURNING json_build_object(
    'id',          id,
    'owner_id',    owner_id,
    'local_id',    local_id,
    'label',       label,
    'geometry',    ST_AsGeoJSON(geometry)::json,
    'area_sqm',    area_sqm,
    'perimeter_m', perimeter_m,
    'traced_at',   traced_at,
    'created_at',  created_at
  ) INTO v_result;

  RETURN v_result;
END;
$$;


-- ----------------------------------------------------------------
-- 2. list_traces
-- Returns a user's traces (paginated), geometry as GeoJSON object.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_traces(
  p_owner_id uuid,
  p_limit    int DEFAULT 20,
  p_offset   int DEFAULT 0
)
RETURNS TABLE (
  id          uuid,
  owner_id    uuid,
  local_id    text,
  label       text,
  geometry    json,
  area_sqm    float8,
  perimeter_m float8,
  traced_at   timestamptz,
  created_at  timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.owner_id,
    t.local_id,
    t.label,
    ST_AsGeoJSON(t.geometry)::json,
    t.area_sqm,
    t.perimeter_m,
    t.traced_at,
    t.created_at
  FROM traces t
  WHERE t.owner_id = p_owner_id
  ORDER BY t.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;


-- ----------------------------------------------------------------
-- 3. get_trace
-- Returns a single trace scoped to its owner, or NULL if not found.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_trace(
  p_trace_id uuid,
  p_owner_id uuid
)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'id',          t.id,
    'owner_id',    t.owner_id,
    'local_id',    t.local_id,
    'label',       t.label,
    'geometry',    ST_AsGeoJSON(t.geometry)::json,
    'area_sqm',    t.area_sqm,
    'perimeter_m', t.perimeter_m,
    'traced_at',   t.traced_at,
    'created_at',  t.created_at
  )
  FROM traces t
  WHERE t.id = p_trace_id AND t.owner_id = p_owner_id;
$$;


-- ----------------------------------------------------------------
-- 4. detect_conflicts
-- Finds all traces from other owners that intersect p_geojson.
-- Uses a CTE so ST_GeomFromGeoJSON is evaluated only once per call.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION detect_conflicts(
  p_geojson  text,
  p_owner_id uuid,
  p_trace_id uuid
)
RETURNS TABLE (
  other_trace_id   uuid,
  other_owner_id   uuid,
  overlap_geometry json,
  overlap_sqm      float8,
  other_area       float8,
  new_area         float8
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH new_geom AS (
    SELECT ST_GeomFromGeoJSON(p_geojson) AS g
  )
  SELECT
    t.id                                                              AS other_trace_id,
    t.owner_id                                                        AS other_owner_id,
    ST_AsGeoJSON(ST_Intersection(t.geometry, ng.g))::json            AS overlap_geometry,
    ST_Area(ST_Transform(ST_Intersection(t.geometry, ng.g), 32643))  AS overlap_sqm,
    ST_Area(ST_Transform(t.geometry, 32643))                         AS other_area,
    ST_Area(ST_Transform(ng.g, 32643))                               AS new_area
  FROM traces t
  CROSS JOIN new_geom ng
  WHERE t.owner_id != p_owner_id
    AND t.id        != p_trace_id
    AND ST_Intersects(t.geometry, ng.g);
$$;


-- ----------------------------------------------------------------
-- 5. upsert_conflict
-- Inserts a conflict row. Caller must enforce canonical ordering
-- (smaller UUID → trace_a_id). Returns NULL when DO NOTHING fires
-- (conflict already existed).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_conflict(
  p_trace_a_id      uuid,
  p_trace_b_id      uuid,
  p_overlap_geojson text,
  p_overlap_sqm     float8,
  p_overlap_pct_a   float8,
  p_overlap_pct_b   float8
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  INSERT INTO conflicts (
    trace_a_id, trace_b_id,
    overlap_geometry, overlap_sqm,
    overlap_pct_a, overlap_pct_b,
    status, detected_at
  )
  VALUES (
    p_trace_a_id,
    p_trace_b_id,
    ST_GeomFromGeoJSON(p_overlap_geojson),
    p_overlap_sqm,
    p_overlap_pct_a,
    p_overlap_pct_b,
    'open',
    NOW()
  )
  ON CONFLICT (trace_a_id, trace_b_id) DO NOTHING
  RETURNING json_build_object(
    'id',            id,
    'trace_a_id',    trace_a_id,
    'trace_b_id',    trace_b_id,
    'overlap_sqm',   overlap_sqm,
    'overlap_pct_a', overlap_pct_a,
    'overlap_pct_b', overlap_pct_b,
    'status',        status,
    'detected_at',   detected_at
  ) INTO v_result;

  RETURN v_result;
END;
$$;


-- ----------------------------------------------------------------
-- 6. get_conflict_full
-- Returns a single conflict with both trace geometries, farmer info,
-- and all notes in one round trip. Returns NULL if id not found.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_conflict_full(
  p_conflict_id uuid
)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'id',               c.id,
    'trace_a_id',       c.trace_a_id,
    'trace_b_id',       c.trace_b_id,
    'overlap_geometry', ST_AsGeoJSON(c.overlap_geometry)::json,
    'overlap_sqm',      c.overlap_sqm,
    'overlap_pct_a',    c.overlap_pct_a,
    'overlap_pct_b',    c.overlap_pct_b,
    'status',           c.status,
    'detected_at',      c.detected_at,
    'resolved_at',      c.resolved_at,
    'trace_a_geometry', ST_AsGeoJSON(ta.geometry)::json,
    'trace_a_label',    ta.label,
    'trace_a_area_sqm', ta.area_sqm,
    'trace_b_geometry', ST_AsGeoJSON(tb.geometry)::json,
    'trace_b_label',    tb.label,
    'trace_b_area_sqm', tb.area_sqm,
    'farmer_a_id',      ua.id,
    'farmer_a_name',    ua.name,
    'farmer_a_phone',   ua.phone,
    'farmer_a_village', ua.village,
    'farmer_b_id',      ub.id,
    'farmer_b_name',    ub.name,
    'farmer_b_phone',   ub.phone,
    'farmer_b_village', ub.village,
    'notes', COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'id',          cn.id,
            'body',        cn.body,
            'created_at',  cn.created_at,
            'author_id',   u.id,
            'author_name', u.name
          )
          ORDER BY cn.created_at
        )
        FROM conflict_notes cn
        JOIN users u ON u.id = cn.author_id
        WHERE cn.conflict_id = c.id
      ),
      '[]'::json
    )
  )
  FROM conflicts c
  JOIN traces ta ON ta.id = c.trace_a_id
  JOIN traces tb ON tb.id = c.trace_b_id
  JOIN users  ua ON ua.id = ta.owner_id
  JOIN users  ub ON ub.id = tb.owner_id
  WHERE c.id = p_conflict_id;
$$;


-- ----------------------------------------------------------------
-- 7. list_conflicts_for_user
-- Returns paginated conflicts involving the user, filtered by status.
-- Includes both farmers' name, phone, village.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_conflicts_for_user(
  p_user_id uuid,
  p_status  text DEFAULT 'open',
  p_limit   int  DEFAULT 20,
  p_offset  int  DEFAULT 0
)
RETURNS TABLE (
  id               uuid,
  trace_a_id       uuid,
  trace_b_id       uuid,
  overlap_sqm      float8,
  overlap_pct_a    float8,
  overlap_pct_b    float8,
  status           text,
  detected_at      timestamptz,
  resolved_at      timestamptz,
  farmer_a_name    text,
  farmer_a_phone   text,
  farmer_a_village text,
  farmer_b_name    text,
  farmer_b_phone   text,
  farmer_b_village text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.trace_a_id,
    c.trace_b_id,
    c.overlap_sqm,
    c.overlap_pct_a,
    c.overlap_pct_b,
    c.status::text,
    c.detected_at,
    c.resolved_at,
    ua.name,
    ua.phone,
    ua.village,
    ub.name,
    ub.phone,
    ub.village
  FROM conflicts c
  JOIN traces ta ON ta.id = c.trace_a_id
  JOIN traces tb ON tb.id = c.trace_b_id
  JOIN users  ua ON ua.id = ta.owner_id
  JOIN users  ub ON ub.id = tb.owner_id
  WHERE (ta.owner_id = p_user_id OR tb.owner_id = p_user_id)
    AND c.status::text = p_status
  ORDER BY c.detected_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;


-- ----------------------------------------------------------------
-- 8. user_can_access_conflict
-- Returns true when p_user_id owns either trace in the conflict.
-- Used as an access guard in note and status-update endpoints.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION user_can_access_conflict(
  p_conflict_id uuid,
  p_user_id     uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM conflicts c
    JOIN traces ta ON ta.id = c.trace_a_id
    JOIN traces tb ON tb.id = c.trace_b_id
    WHERE c.id = p_conflict_id
      AND (ta.owner_id = p_user_id OR tb.owner_id = p_user_id)
  );
$$;

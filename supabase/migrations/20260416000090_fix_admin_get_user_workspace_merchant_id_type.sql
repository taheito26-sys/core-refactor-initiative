-- Fix: admin_get_user_workspace declared target_merchant_id and merchant_ids as uuid/uuid[]
-- but merchant_profiles.merchant_id is TEXT (e.g. 'taheito', 'zakaria').
-- The ::uuid cast was throwing "invalid input syntax for type uuid" for every call,
-- causing the admin workspace to show "No admin-readable workspace data found."

CREATE OR REPLACE FUNCTION public.admin_get_user_workspace(_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  target_profile jsonb;
  target_merchant_id text;
  relationship_ids uuid[];
  merchant_ids text[];
  result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT to_jsonb(mp)
  INTO target_profile
  FROM public.merchant_profiles mp
  WHERE mp.user_id = _target_user_id
  LIMIT 1;

  target_merchant_id := NULLIF(target_profile->>'merchant_id', '');

  SELECT COALESCE(array_agg(r.id), ARRAY[]::uuid[])
  INTO relationship_ids
  FROM public.merchant_relationships r
  WHERE target_merchant_id IS NOT NULL
    AND r.status = 'active'
    AND (r.merchant_a_id = target_merchant_id OR r.merchant_b_id = target_merchant_id);

  SELECT COALESCE(array_agg(DISTINCT merchant_id), ARRAY[]::text[])
  INTO merchant_ids
  FROM (
    SELECT target_merchant_id AS merchant_id
    WHERE target_merchant_id IS NOT NULL
    UNION
    SELECT r.merchant_a_id AS merchant_id
    FROM public.merchant_relationships r
    WHERE relationship_ids IS NOT NULL AND r.id = ANY(relationship_ids)
    UNION
    SELECT r.merchant_b_id AS merchant_id
    FROM public.merchant_relationships r
    WHERE relationship_ids IS NOT NULL AND r.id = ANY(relationship_ids)
  ) merchants;

  SELECT jsonb_build_object(
    'user_id', _target_user_id,
    'merchant_profile', target_profile,
    'tracker_snapshot', (
      SELECT jsonb_build_object(
        'state', ts.state,
        'preferences', ts.preferences,
        'updated_at', ts.updated_at
      )
      FROM public.tracker_snapshots ts
      WHERE ts.user_id = _target_user_id
      LIMIT 1
    ),
    'deals', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC)
      FROM public.merchant_deals d
      WHERE relationship_ids IS NOT NULL
        AND d.relationship_id = ANY(relationship_ids)
    ), '[]'::jsonb),
    'settlements', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.created_at DESC)
      FROM public.merchant_settlements s
      WHERE s.settled_by = _target_user_id
         OR EXISTS (
           SELECT 1
           FROM public.merchant_deals d
           WHERE d.id = s.deal_id
             AND relationship_ids IS NOT NULL
             AND d.relationship_id = ANY(relationship_ids)
         )
    ), '[]'::jsonb),
    'profits', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC)
      FROM public.merchant_profits p
      WHERE p.recorded_by = _target_user_id
         OR EXISTS (
           SELECT 1
           FROM public.merchant_deals d
           WHERE d.id = p.deal_id
             AND relationship_ids IS NOT NULL
             AND d.relationship_id = ANY(relationship_ids)
         )
    ), '[]'::jsonb),
    'relationships', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC)
      FROM public.merchant_relationships r
      WHERE relationship_ids IS NOT NULL AND r.id = ANY(relationship_ids)
    ), '[]'::jsonb),
    'merchant_profiles', COALESCE((
      SELECT jsonb_agg(to_jsonb(mp) ORDER BY mp.display_name NULLS LAST)
      FROM public.merchant_profiles mp
      WHERE target_merchant_id IS NOT NULL
        AND mp.merchant_id = ANY(merchant_ids)
    ), '[]'::jsonb)
  )
  INTO result;

  RETURN result;
END;
$$;

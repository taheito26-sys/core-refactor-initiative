ALTER TABLE public.tracker_snapshots
  ADD COLUMN IF NOT EXISTS write_generation bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.save_tracker_snapshot_if_newer(
  _user_id uuid,
  _state jsonb,
  _updated_at timestamptz,
  _write_generation bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM _user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO public.tracker_snapshots AS ts (user_id, state, updated_at, write_generation)
  VALUES (_user_id, _state, _updated_at, COALESCE(_write_generation, 0))
  ON CONFLICT (user_id) DO UPDATE
  SET
    state = EXCLUDED.state,
    updated_at = EXCLUDED.updated_at,
    write_generation = EXCLUDED.write_generation
  WHERE COALESCE(ts.write_generation, 0) <= COALESCE(EXCLUDED.write_generation, 0);

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_tracker_snapshot_if_newer(uuid, jsonb, timestamptz, bigint) TO authenticated;

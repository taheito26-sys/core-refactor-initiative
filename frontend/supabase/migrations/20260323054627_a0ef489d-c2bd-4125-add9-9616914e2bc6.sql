
-- Admin correct tracker state (batch or trade) with audit logging
CREATE OR REPLACE FUNCTION public.admin_correct_tracker(
  _target_user_id uuid,
  _entity_type text,  -- 'batch' or 'trade'
  _entity_id text,
  _updates jsonb,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _snapshot jsonb;
  _state jsonb;
  _arr jsonb;
  _new_arr jsonb := '[]'::jsonb;
  _before jsonb;
  _after jsonb;
  _i int;
  _elem jsonb;
  _found boolean := false;
  _key text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  -- Get current tracker snapshot
  SELECT state INTO _state
  FROM tracker_snapshots
  WHERE user_id = _target_user_id;

  IF _state IS NULL THEN
    RAISE EXCEPTION 'No tracker data found for user';
  END IF;

  -- Determine array key
  IF _entity_type = 'batch' THEN
    _key := 'batches';
  ELSIF _entity_type = 'trade' THEN
    _key := 'trades';
  ELSE
    RAISE EXCEPTION 'Invalid entity type: must be batch or trade';
  END IF;

  _arr := COALESCE(_state->_key, '[]'::jsonb);

  -- Find and update the entity
  FOR _i IN 0..jsonb_array_length(_arr)-1 LOOP
    _elem := _arr->_i;
    IF _elem->>'id' = _entity_id THEN
      _before := _elem;
      _after := _elem || _updates;
      _new_arr := _new_arr || jsonb_build_array(_after);
      _found := true;
    ELSE
      _new_arr := _new_arr || jsonb_build_array(_elem);
    END IF;
  END LOOP;

  IF NOT _found THEN
    RAISE EXCEPTION 'Entity not found in tracker state';
  END IF;

  -- Update tracker snapshot
  UPDATE tracker_snapshots
  SET state = jsonb_set(_state, ARRAY[_key], _new_arr),
      updated_at = now()
  WHERE user_id = _target_user_id;

  -- Write audit log
  INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    'correct_tracker_' || _entity_type,
    'tracker_' || _entity_type,
    _target_user_id,
    jsonb_build_object(
      'target_user_id', _target_user_id,
      'entity_id', _entity_id,
      'before', _before,
      'after', _after,
      'reason', _reason
    )
  );
END;
$$;

-- Admin delete tracker entity (batch or trade) with audit logging
CREATE OR REPLACE FUNCTION public.admin_void_tracker_entity(
  _target_user_id uuid,
  _entity_type text,
  _entity_id text,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _state jsonb;
  _arr jsonb;
  _new_arr jsonb := '[]'::jsonb;
  _before jsonb;
  _i int;
  _elem jsonb;
  _found boolean := false;
  _key text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT state INTO _state
  FROM tracker_snapshots
  WHERE user_id = _target_user_id;

  IF _state IS NULL THEN
    RAISE EXCEPTION 'No tracker data found for user';
  END IF;

  IF _entity_type = 'batch' THEN _key := 'batches';
  ELSIF _entity_type = 'trade' THEN _key := 'trades';
  ELSE RAISE EXCEPTION 'Invalid entity type';
  END IF;

  _arr := COALESCE(_state->_key, '[]'::jsonb);

  FOR _i IN 0..jsonb_array_length(_arr)-1 LOOP
    _elem := _arr->_i;
    IF _elem->>'id' = _entity_id THEN
      _before := _elem;
      -- Mark as voided rather than deleting
      _new_arr := _new_arr || jsonb_build_array(_elem || '{"voided": true}'::jsonb);
      _found := true;
    ELSE
      _new_arr := _new_arr || jsonb_build_array(_elem);
    END IF;
  END LOOP;

  IF NOT _found THEN
    RAISE EXCEPTION 'Entity not found';
  END IF;

  UPDATE tracker_snapshots
  SET state = jsonb_set(_state, ARRAY[_key], _new_arr),
      updated_at = now()
  WHERE user_id = _target_user_id;

  INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    'void_tracker_' || _entity_type,
    'tracker_' || _entity_type,
    _target_user_id,
    jsonb_build_object(
      'target_user_id', _target_user_id,
      'entity_id', _entity_id,
      'before', _before,
      'reason', _reason
    )
  );
END;
$$;

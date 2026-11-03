CREATE OR REPLACE FUNCTION public.admin_analytics_overview(_months integer DEFAULT 12)
 RETURNS TABLE(month text, new_users bigint, deal_count bigint, deal_volume numeric, settlement_amount numeric, profit_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  WITH months AS (
    SELECT to_char(d, 'YYYY-MM') AS m, d AS month_start, (d + interval '1 month') AS month_end
    FROM generate_series(
      date_trunc('month', now()) - ((_months - 1) || ' months')::interval,
      date_trunc('month', now()),
      '1 month'
    ) d
  ),
  user_counts AS (
    SELECT to_char(created_at, 'YYYY-MM') AS m, count(*) AS cnt
    FROM merchant_profiles
    GROUP BY 1
  ),
  deal_counts AS (
    SELECT to_char(created_at, 'YYYY-MM') AS m, count(*) AS cnt, coalesce(sum(amount), 0) AS vol
    FROM merchant_deals
    GROUP BY 1
  ),
  settlement_counts AS (
    SELECT to_char(created_at, 'YYYY-MM') AS m, coalesce(sum(amount), 0) AS amt
    FROM merchant_settlements
    GROUP BY 1
  ),
  profit_counts AS (
    SELECT to_char(created_at, 'YYYY-MM') AS m, coalesce(sum(amount), 0) AS amt
    FROM merchant_profits
    GROUP BY 1
  )
  SELECT
    mo.m,
    coalesce(u.cnt, 0),
    coalesce(d.cnt, 0),
    coalesce(d.vol, 0),
    coalesce(s.amt, 0),
    coalesce(p.amt, 0)
  FROM months mo
  LEFT JOIN user_counts u ON u.m = mo.m
  LEFT JOIN deal_counts d ON d.m = mo.m
  LEFT JOIN settlement_counts s ON s.m = mo.m
  LEFT JOIN profit_counts p ON p.m = mo.m
  ORDER BY mo.m;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_broadcast_notification(_title text, _body text, _category text DEFAULT 'system'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _count integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  INSERT INTO notifications (user_id, title, body, category)
  SELECT p.user_id, _title, _body, _category
  FROM profiles p
  WHERE p.status = 'approved';

  GET DIAGNOSTICS _count = ROW_COUNT;

  INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    'broadcast_notification',
    'notification',
    NULL,
    jsonb_build_object('title', _title, 'body', _body, 'category', _category, 'recipient_count', _count)
  );

  RETURN _count;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_correct_deal(_deal_id uuid, _updates jsonb, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _before jsonb;
  _after jsonb;
  _target_user_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  -- Capture before state
  SELECT row_to_json(d.*)::jsonb INTO _before
  FROM merchant_deals d WHERE d.id = _deal_id;

  IF _before IS NULL THEN
    RAISE EXCEPTION 'Deal not found';
  END IF;

  _target_user_id := (_before->>'created_by')::uuid;

  -- Apply updates
  UPDATE merchant_deals SET
    title = COALESCE((_updates->>'title')::text, title),
    amount = COALESCE((_updates->>'amount')::numeric, amount),
    status = COALESCE((_updates->>'status')::text, status),
    currency = COALESCE((_updates->>'currency')::text, currency),
    notes = COALESCE((_updates->>'notes')::text, notes),
    updated_at = now()
  WHERE id = _deal_id;

  -- Capture after state
  SELECT row_to_json(d.*)::jsonb INTO _after
  FROM merchant_deals d WHERE d.id = _deal_id;

  -- Write audit log
  INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    'correct_deal',
    'merchant_deal',
    _deal_id,
    jsonb_build_object(
      'target_user_id', _target_user_id,
      'before', _before,
      'after', _after,
      'reason', _reason
    )
  );

  RETURN _after;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_correct_tracker(_target_user_id uuid, _entity_type text, _entity_id text, _updates jsonb, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.admin_merchant_performance()
 RETURNS TABLE(merchant_id text, display_name text, nickname text, deal_count bigint, total_volume numeric, total_profit numeric, settlement_count bigint, avg_deal_size numeric, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    mp.merchant_id,
    mp.display_name,
    mp.nickname,
    coalesce((SELECT count(*) FROM merchant_deals md WHERE md.created_by = mp.user_id), 0) AS deal_count,
    coalesce((SELECT sum(md.amount) FROM merchant_deals md WHERE md.created_by = mp.user_id), 0) AS total_volume,
    coalesce((SELECT sum(pr.amount) FROM merchant_profits pr WHERE pr.recorded_by = mp.user_id), 0) AS total_profit,
    coalesce((SELECT count(*) FROM merchant_settlements ms WHERE ms.settled_by = mp.user_id), 0) AS settlement_count,
    CASE WHEN (SELECT count(*) FROM merchant_deals md WHERE md.created_by = mp.user_id) > 0
      THEN round((SELECT sum(md.amount) FROM merchant_deals md WHERE md.created_by = mp.user_id) / (SELECT count(*) FROM merchant_deals md WHERE md.created_by = mp.user_id), 2)
      ELSE 0
    END AS avg_deal_size,
    mp.status
  FROM merchant_profiles mp
  ORDER BY total_volume DESC;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_revenue_breakdown()
 RETURNS TABLE(currency text, deal_type text, deal_count bigint, total_volume numeric, total_profit numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    md.currency,
    md.deal_type,
    count(*) AS deal_count,
    coalesce(sum(md.amount), 0) AS total_volume,
    coalesce(sum(mp.amount), 0) AS total_profit
  FROM merchant_deals md
  LEFT JOIN merchant_profits mp ON mp.deal_id = md.id
  GROUP BY md.currency, md.deal_type
  ORDER BY total_volume DESC;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_system_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'total_users', (SELECT count(*) FROM profiles),
    'approved_users', (SELECT count(*) FROM profiles WHERE status = 'approved'),
    'pending_users', (SELECT count(*) FROM profiles WHERE status = 'pending'),
    'rejected_users', (SELECT count(*) FROM profiles WHERE status = 'rejected'),
    'total_deals', (SELECT count(*) FROM merchant_deals),
    'deals_pending', (SELECT count(*) FROM merchant_deals WHERE status = 'pending'),
    'deals_active', (SELECT count(*) FROM merchant_deals WHERE status = 'active'),
    'deals_completed', (SELECT count(*) FROM merchant_deals WHERE status = 'completed'),
    'deals_cancelled', (SELECT count(*) FROM merchant_deals WHERE status = 'cancelled'),
    'total_settlement_amount', (SELECT coalesce(sum(amount), 0) FROM merchant_settlements),
    'total_profit_amount', (SELECT coalesce(sum(amount), 0) FROM merchant_profits),
    'total_merchant_profiles', (SELECT count(*) FROM merchant_profiles),
    'total_relationships', (SELECT count(*) FROM merchant_relationships WHERE status = 'active')
  ) INTO result;

  RETURN result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_void_deal(_deal_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _before jsonb;
  _target_user_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT row_to_json(d.*)::jsonb INTO _before
  FROM merchant_deals d WHERE d.id = _deal_id;

  IF _before IS NULL THEN
    RAISE EXCEPTION 'Deal not found';
  END IF;

  _target_user_id := (_before->>'created_by')::uuid;

  UPDATE merchant_deals SET status = 'voided', updated_at = now()
  WHERE id = _deal_id;

  INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    'void_deal',
    'merchant_deal',
    _deal_id,
    jsonb_build_object(
      'target_user_id', _target_user_id,
      'before', _before,
      'reason', _reason
    )
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_void_tracker_entity(_target_user_id uuid, _entity_type text, _entity_id text, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.approve_settlement(_settlement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rows_updated INT;
BEGIN
  UPDATE merchant_settlements
    SET status = 'approved'
    WHERE id = _settlement_id AND status = 'pending';
  GET DIAGNOSTICS _rows_updated = ROW_COUNT;

  IF _rows_updated = 0 THEN
    RAISE EXCEPTION 'Settlement % not found or already processed', _settlement_id;
  END IF;

  UPDATE settlement_periods
    SET status = 'settled'
    WHERE settlement_id = _settlement_id
      AND status = 'pending_settlement';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.auto_expire_agreements()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.expires_at IS NOT NULL AND NEW.expires_at < NOW() AND NEW.status = 'approved' THEN
    NEW.status := 'expired';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_add_reaction(_message_id uuid, _emoji text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _me UUID := auth.uid(); _room_id UUID;
BEGIN
  SELECT room_id INTO _room_id FROM public.chat_messages WHERE id = _message_id;
  IF NOT public.fn_is_chat_member(_room_id, _me) THEN RAISE EXCEPTION 'Not a member'; END IF;
  INSERT INTO public.chat_message_reactions (message_id, room_id, user_id, emoji) VALUES (_message_id, _room_id, _me, _emoji) ON CONFLICT (message_id, user_id, emoji) DO NOTHING;
END; $function$
;
CREATE OR REPLACE FUNCTION public.chat_answer_call(_call_id uuid, _sdp_answer text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _me UUID := auth.uid();
BEGIN
  UPDATE public.chat_call_participants SET status = 'connected', joined_at = now(), sdp_answer = _sdp_answer WHERE call_id = _call_id AND user_id = _me;
  UPDATE public.chat_calls SET status = 'active', connected_at = now() WHERE id = _call_id AND status = 'ringing';
END; $function$
;
CREATE OR REPLACE FUNCTION public.chat_cancel_market_offer(_offer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _me UUID := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE public.market_offers
  SET status = 'cancelled', updated_at = now()
  WHERE id = _offer_id AND user_id = _me AND status = 'active';

  IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found or not cancellable'; END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_create_attachment(_room_id uuid, _message_id uuid, _storage_path text, _file_name text, _file_size bigint, _mime_type text, _cdn_url text DEFAULT NULL::text, _thumbnail_path text DEFAULT NULL::text, _duration_ms integer DEFAULT NULL::integer, _width integer DEFAULT NULL::integer, _height integer DEFAULT NULL::integer, _waveform jsonb DEFAULT NULL::jsonb, _checksum_sha256 text DEFAULT NULL::text, _is_encrypted boolean DEFAULT false, _iv text DEFAULT NULL::text, _auth_tag text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me         uuid := auth.uid();
  _policy     record;
  _new_id     uuid;
  _mime_class text;
  _max_bytes  bigint;
  _expected_prefix text;
BEGIN
  -- Must be authenticated
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Must be a room member
  IF NOT fn_is_chat_member(_room_id, _me) THEN
    RAISE EXCEPTION 'Not a member of this room';
  END IF;

  -- Storage path must start with uid/room_id/
  _expected_prefix := _me::text || '/' || _room_id::text || '/';
  IF NOT _storage_path LIKE (_expected_prefix || '%') THEN
    RAISE EXCEPTION 'Invalid storage path prefix. Expected: %', _expected_prefix;
  END IF;

  -- Load room policy (if any)
  SELECT p.* INTO _policy
  FROM chat_rooms r
  LEFT JOIN chat_room_policies p ON p.id = r.policy_id
  WHERE r.id = _room_id;

  -- Determine MIME class
  _mime_class := split_part(_mime_type, '/', 1);

  -- Enforce allow_images (images + video)
  IF _mime_class IN ('image', 'video') AND _policy.id IS NOT NULL AND NOT _policy.allow_images THEN
    RAISE EXCEPTION 'Images/video not allowed in this room';
  END IF;

  -- Enforce allow_voice_notes (audio)
  IF _mime_class = 'audio' AND _policy.id IS NOT NULL AND NOT _policy.allow_voice_notes THEN
    RAISE EXCEPTION 'Voice notes not allowed in this room';
  END IF;

  -- Enforce allow_files (everything else)
  IF _mime_class NOT IN ('image', 'video', 'audio') AND _policy.id IS NOT NULL AND NOT _policy.allow_files THEN
    RAISE EXCEPTION 'File uploads not allowed in this room';
  END IF;

  -- Enforce max_file_size_mb
  IF _policy.id IS NOT NULL AND _policy.max_file_size_mb IS NOT NULL THEN
    _max_bytes := _policy.max_file_size_mb::bigint * 1024 * 1024;
    IF _file_size > _max_bytes THEN
      RAISE EXCEPTION 'File exceeds maximum size of % MB', _policy.max_file_size_mb;
    END IF;
  END IF;

  -- Enforce allowed_mime_types whitelist
  IF _policy.id IS NOT NULL AND NOT chat_is_allowed_mime(_mime_type, _policy.allowed_mime_types) THEN
    RAISE EXCEPTION 'MIME type % is not allowed in this room', _mime_type;
  END IF;

  -- Insert the attachment row
  INSERT INTO chat_attachments (
    room_id, message_id, uploader_id, storage_path,
    file_name, file_size, mime_type, cdn_url, thumbnail_path,
    duration_ms, width, height, waveform, checksum_sha256,
    is_encrypted, iv, auth_tag, is_validated
  ) VALUES (
    _room_id, _message_id, _me, _storage_path,
    _file_name, _file_size, _mime_type, _cdn_url, _thumbnail_path,
    _duration_ms, _width, _height, _waveform, _checksum_sha256,
    _is_encrypted, _iv, _auth_tag, true
  )
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_create_market_offer(_offer_type text, _rate numeric, _min_amount numeric DEFAULT 0, _max_amount numeric DEFAULT 0, _currency_pair text DEFAULT 'USDT/QAR'::text, _note text DEFAULT NULL::text, _expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
  _room_id UUID;
  _mid TEXT;
  _offer_id UUID;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT public.chat_get_qatar_market_room() INTO _room_id;
  IF _room_id IS NULL THEN RAISE EXCEPTION 'Qatar P2P Market room not found'; END IF;

  IF NOT public.fn_is_chat_member(_room_id, _me) THEN
    RAISE EXCEPTION 'Not a member of the market room';
  END IF;

  SELECT merchant_id INTO _mid FROM public.merchant_profiles WHERE user_id = _me AND status = 'active' LIMIT 1;
  IF _mid IS NULL THEN RAISE EXCEPTION 'No active merchant profile'; END IF;

  INSERT INTO public.market_offers (room_id, user_id, merchant_id, offer_type, rate, min_amount, max_amount, currency_pair, note, expires_at)
  VALUES (_room_id, _me, _mid, _offer_type, _rate, _min_amount, _max_amount, _currency_pair, _note, _expires_at)
  RETURNING id INTO _offer_id;

  RETURN _offer_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_create_merchant_client_room(_customer_user_id uuid, _room_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _me UUID := auth.uid(); _room_id UUID; _ua UUID; _ub UUID; _policy UUID;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _ua := LEAST(_me, _customer_user_id); _ub := GREATEST(_me, _customer_user_id);
  SELECT room_id INTO _room_id FROM public.chat_direct_rooms WHERE user_a_id = _ua AND user_b_id = _ub;
  IF _room_id IS NOT NULL THEN RETURN _room_id; END IF;
  SELECT id INTO _policy FROM public.chat_room_policies WHERE room_type = 'merchant_client';
  INSERT INTO public.chat_rooms (type, name, created_by, policy_id, is_direct) VALUES ('merchant_client', _room_name, _me, _policy, TRUE) RETURNING id INTO _room_id;
  INSERT INTO public.chat_direct_rooms (user_a_id, user_b_id, room_id) VALUES (_ua, _ub, _room_id);
  INSERT INTO public.chat_room_members (room_id, user_id, role) VALUES (_room_id, _me, 'owner'), (_room_id, _customer_user_id, 'member');
  RETURN _room_id;
END; $function$
;
CREATE OR REPLACE FUNCTION public.chat_delete_message(_message_id uuid, _for_everyone boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _me UUID := auth.uid(); _role public.chat_member_role; _msg public.chat_messages;
BEGIN
  SELECT * INTO _msg FROM public.chat_messages WHERE id = _message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message not found'; END IF;
  _role := public.fn_chat_member_role(_msg.room_id, _me);
  IF _role IS NULL THEN RAISE EXCEPTION 'Not a member'; END IF;
  IF _for_everyone THEN
    IF _msg.sender_id <> _me AND _role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
    UPDATE public.chat_messages SET is_deleted = TRUE, deleted_at = now(), deleted_by = _me, content = '', metadata = '{}', updated_at = now() WHERE id = _message_id;
  ELSE
    UPDATE public.chat_messages SET deleted_for_sender = TRUE, updated_at = now() WHERE id = _message_id AND sender_id = _me;
  END IF;
END; $function$
;
CREATE OR REPLACE FUNCTION public.chat_edit_message(_message_id uuid, _new_content text)
 RETURNS SETOF chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _me UUID := auth.uid(); _msg public.chat_messages;
BEGIN
  SELECT * INTO _msg FROM public.chat_messages WHERE id = _message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message not found'; END IF;
  IF _msg.sender_id <> _me THEN RAISE EXCEPTION 'Cannot edit'; END IF;
  IF _msg.view_once THEN RAISE EXCEPTION 'Cannot edit one-time-view'; END IF;
  UPDATE public.chat_messages SET content = _new_content, is_edited = TRUE, edited_at = now(), updated_at = now() WHERE id = _message_id RETURNING * INTO _msg;
  RETURN NEXT _msg;
END; $function$
;
CREATE OR REPLACE FUNCTION public.chat_end_call(_call_id uuid, _end_reason text DEFAULT 'ended'::text, _signaling_channel text DEFAULT 'supabase'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
  _room_id UUID;
  _dur INTEGER;
BEGIN
  SELECT room_id, EXTRACT(EPOCH FROM (now() - connected_at))::INTEGER
  INTO _room_id, _dur
  FROM public.chat_calls
  WHERE id = _call_id;

  UPDATE public.chat_calls
  SET status = CASE
      WHEN _end_reason = 'declined'  THEN 'declined'::public.chat_call_status
      WHEN _end_reason = 'missed'    THEN 'missed'::public.chat_call_status
      WHEN _end_reason = 'no_answer' THEN 'no_answer'::public.chat_call_status
      WHEN _end_reason = 'failed'    THEN 'failed'::public.chat_call_status
      ELSE 'ended'::public.chat_call_status
    END,
    ended_at = now(),
    duration_seconds = GREATEST(COALESCE(_dur, 0), 0),
    end_reason = _end_reason,
    signaling_channel = _signaling_channel
  WHERE id = _call_id;

  UPDATE public.chat_call_participants
  SET status = 'disconnected', left_at = now()
  WHERE call_id = _call_id AND user_id = _me;

  IF _end_reason NOT IN ('declined', 'missed', 'no_answer') THEN
    PERFORM public.chat_send_message(
      _room_id,
      'Call ended · ' || COALESCE(_dur::text || 's', '0s'),
      'call_summary',
      jsonb_build_object('call_id', _call_id, 'duration_seconds', _dur),
      NULL,
      gen_random_uuid()::text
    );
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_export_room_transcript(_room_id uuid)
 RETURNS TABLE(sender_name text, content text, sent_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _export_disabled boolean;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.fn_is_chat_member(_room_id, _me) THEN RAISE EXCEPTION 'Not a member of this room'; END IF;

  SELECT COALESCE(p.disable_export, false) INTO _export_disabled
  FROM public.chat_rooms r LEFT JOIN public.chat_room_policies p ON p.id = r.policy_id
  WHERE r.id = _room_id;

  IF _export_disabled THEN RAISE EXCEPTION 'Export is disabled for this room'; END IF;

  RETURN QUERY
    SELECT COALESCE(mp.display_name, 'Unknown'), m.content, m.created_at
    FROM public.chat_messages m
    LEFT JOIN public.merchant_profiles mp ON mp.user_id = m.sender_id
    WHERE m.room_id = _room_id AND m.is_deleted = false
    ORDER BY m.created_at ASC;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_forward_message(_message_id uuid, _target_room_id uuid, _client_nonce text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _msg record;
  _src_room uuid;
  _fwd_disabled boolean;
  _strip_identity boolean;
  _hop_count int := 0;
  _cursor uuid;
  _new_id uuid;
  _sender_name text;
  _att record;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO _msg FROM public.chat_messages WHERE id = _message_id AND is_deleted = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message not found'; END IF;
  _src_room := _msg.room_id;

  IF NOT public.fn_is_chat_member(_src_room, _me) THEN
    RAISE EXCEPTION 'Not a member of source room';
  END IF;
  IF NOT public.fn_is_chat_member(_target_room_id, _me) THEN
    RAISE EXCEPTION 'Not a member of target room';
  END IF;

  SELECT COALESCE(p.disable_forwarding, false), COALESCE(p.strip_forward_sender_identity, false)
  INTO _fwd_disabled, _strip_identity
  FROM public.chat_rooms r LEFT JOIN public.chat_room_policies p ON p.id = r.policy_id
  WHERE r.id = _src_room;

  IF _fwd_disabled THEN RAISE EXCEPTION 'Forwarding is disabled in source room'; END IF;
  IF _msg.view_once THEN RAISE EXCEPTION 'Cannot forward view-once messages'; END IF;

  -- Hop limit
  _cursor := _msg.forwarded_from_id;
  WHILE _cursor IS NOT NULL AND _hop_count < 10 LOOP
    _hop_count := _hop_count + 1;
    SELECT forwarded_from_id INTO _cursor FROM public.chat_messages WHERE id = _cursor;
  END LOOP;
  IF _hop_count >= 3 THEN RAISE EXCEPTION 'Forward hop limit exceeded (max 3)'; END IF;

  IF _strip_identity THEN _sender_name := NULL;
  ELSE SELECT display_name INTO _sender_name FROM public.merchant_profiles WHERE user_id = _msg.sender_id LIMIT 1;
  END IF;

  -- Insert forwarded message
  INSERT INTO public.chat_messages (room_id, sender_id, content, type, forwarded_from_id, client_nonce, metadata)
  VALUES (_target_room_id, _me, _msg.content, _msg.type, _message_id, _client_nonce,
    jsonb_build_object('is_forwarded', true, 'original_sender_name', _sender_name))
  RETURNING id INTO _new_id;

  -- Clone attachment if present
  SELECT * INTO _att FROM public.chat_attachments WHERE message_id = _message_id LIMIT 1;
  IF FOUND THEN
    INSERT INTO public.chat_attachments (
      message_id, room_id, uploader_id, storage_path, cdn_url,
      file_name, file_size, mime_type, thumbnail_path,
      duration_ms, width, height, waveform,
      checksum_sha256, is_validated, is_encrypted, iv, auth_tag
    ) VALUES (
      _new_id, _target_room_id, _me, _att.storage_path, _att.cdn_url,
      _att.file_name, _att.file_size, _att.mime_type, _att.thumbnail_path,
      _att.duration_ms, _att.width, _att.height, _att.waveform,
      _att.checksum_sha256, _att.is_validated, _att.is_encrypted, _att.iv, _att.auth_tag
    );
  END IF;

  UPDATE public.chat_rooms SET last_message_at = now(), last_message_id = _new_id,
    last_message_preview = left(_msg.content, 100), updated_at = now()
  WHERE id = _target_room_id;

  RETURN _new_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_get_or_create_collab_room(_name text DEFAULT 'Qatar P2P Market'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
  _room_id UUID;
  _policy UUID;
  _super_admin UUID := 'c0c85f54-ad64-4baf-9247-6c81d131d9d9';
BEGIN
  -- Always look for THE existing collab room first (singleton)
  SELECT r.id INTO _room_id
  FROM public.chat_rooms r
  WHERE r.type = 'merchant_collab'
  ORDER BY r.created_at ASC
  LIMIT 1;

  IF _room_id IS NOT NULL THEN
    -- Auto-join the caller if not already a member
    INSERT INTO public.chat_room_members (room_id, user_id, role)
    VALUES (
      _room_id,
      _me,
      CASE WHEN _me = _super_admin THEN 'owner'::chat_member_role ELSE 'member'::chat_member_role END
    )
    ON CONFLICT (room_id, user_id)
    DO UPDATE SET removed_at = NULL,
      role = CASE WHEN _me = _super_admin THEN 'owner'::chat_member_role ELSE chat_room_members.role END;
    RETURN _room_id;
  END IF;

  -- No collab room exists yet — create one
  SELECT id INTO _policy FROM public.chat_room_policies WHERE room_type = 'merchant_collab';

  INSERT INTO public.chat_rooms (type, name, created_by, policy_id, is_direct)
  VALUES ('merchant_collab', _name, _me, _policy, FALSE)
  RETURNING id INTO _room_id;

  INSERT INTO public.chat_room_members (room_id, user_id, role)
  VALUES (_room_id, _me, CASE WHEN _me = _super_admin THEN 'owner'::chat_member_role ELSE 'member'::chat_member_role END);

  RETURN _room_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_get_or_create_direct_room(_other_user_id uuid, _room_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _me UUID := auth.uid(); _room_id UUID; _ua UUID; _ub UUID; _policy UUID;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _me = _other_user_id THEN RAISE EXCEPTION 'Cannot create room with yourself'; END IF;
  _ua := LEAST(_me, _other_user_id); _ub := GREATEST(_me, _other_user_id);
  SELECT room_id INTO _room_id FROM public.chat_direct_rooms WHERE user_a_id = _ua AND user_b_id = _ub;
  IF _room_id IS NOT NULL THEN RETURN _room_id; END IF;
  SELECT id INTO _policy FROM public.chat_room_policies WHERE room_type = 'merchant_private';
  INSERT INTO public.chat_rooms (type, name, created_by, policy_id, is_direct) VALUES ('merchant_private', _room_name, _me, _policy, TRUE) RETURNING id INTO _room_id;
  INSERT INTO public.chat_direct_rooms (user_a_id, user_b_id, room_id) VALUES (_ua, _ub, _room_id);
  INSERT INTO public.chat_room_members (room_id, user_id, role) VALUES (_room_id, _me, 'owner'), (_room_id, _other_user_id, 'member');
  RETURN _room_id;
END; $function$
;
CREATE OR REPLACE FUNCTION public.chat_get_privacy_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
  _row public.chat_privacy_settings%ROWTYPE;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  INSERT INTO public.chat_privacy_settings (user_id) VALUES (_me)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO _row FROM public.chat_privacy_settings WHERE user_id = _me;

  RETURN jsonb_build_object(
    'user_id', _row.user_id,
    'hide_read_receipts', _row.hide_read_receipts,
    'hide_last_seen', _row.hide_last_seen,
    'hide_typing', _row.hide_typing,
    'invisible_mode', _row.invisible_mode,
    'online_visibility', _row.online_visibility,
    'notification_preview', _row.notification_preview,
    'show_sender_in_notification', _row.show_sender_in_notification,
    'anonymous_mode', _row.anonymous_mode,
    'screenshot_protection', _row.screenshot_protection,
    'watermark_enabled', _row.watermark_enabled,
    'forwarding_disabled', _row.forwarding_disabled,
    'copy_disabled', _row.copy_disabled,
    'export_disabled', _row.export_disabled,
    'updated_at', _row.updated_at
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_get_qatar_market_room()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id FROM public.chat_rooms
  WHERE type = 'merchant_collab'
  ORDER BY created_at ASC LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_get_room_members(_room_id uuid)
 RETURNS TABLE(id uuid, room_id uuid, user_id uuid, role chat_member_role, joined_at timestamp with time zone, last_read_at timestamp with time zone, last_read_message_id uuid, is_muted boolean, is_pinned boolean, is_archived boolean, notification_level text, display_name text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    m.id,
    m.room_id,
    m.user_id,
    m.role,
    m.joined_at,
    m.last_read_at,
    m.last_read_message_id,
    m.is_muted,
    m.is_pinned,
    m.is_archived,
    m.notification_level,
    COALESCE(
      NULLIF(TRIM(m.display_name_override), ''),
      NULLIF(TRIM(mp.display_name), ''),
      NULLIF(TRIM(mp.nickname), ''),
      NULLIF(TRIM(cp.display_name), ''),
      NULLIF(TRIM(pr.full_name), ''),
      NULLIF(TRIM(pr.username), ''),
      NULLIF(TRIM(au.raw_user_meta_data->>'full_name'), ''),
      NULLIF(TRIM(au.raw_user_meta_data->>'name'), ''),
      NULLIF(SPLIT_PART(COALESCE(pr.email, au.email), '@', 1), ''),
      LEFT(m.user_id::text, 8)
    ) AS display_name,
    COALESCE(
      NULLIF(TRIM(mp.avatar_url), ''),
      NULLIF(TRIM(pr.avatar_url), '')
    ) AS avatar_url
  FROM public.chat_room_members m
  LEFT JOIN public.merchant_profiles mp ON mp.user_id = m.user_id
  LEFT JOIN public.customer_profiles cp ON cp.user_id = m.user_id
  LEFT JOIN public.profiles           pr ON pr.user_id = m.user_id
  LEFT JOIN auth.users                au ON au.id      = m.user_id
  WHERE m.room_id = _room_id
    AND m.removed_at IS NULL
    AND fn_is_chat_member(_room_id, auth.uid());
$function$
;
CREATE OR REPLACE FUNCTION public.chat_get_rooms()
 RETURNS TABLE(room_id uuid, room_type chat_room_type, name text, avatar_url text, is_direct boolean, last_message_at timestamp with time zone, last_message_preview text, unread_count bigint, is_muted boolean, is_pinned boolean, is_archived boolean, member_count bigint, other_user_id uuid, other_user_metadata jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    r.id AS room_id, r.type AS room_type,
    CASE WHEN r.is_direct THEN COALESCE(mp.display_name, mp.nickname, p.full_name, p.username, 'Unknown') ELSE r.name END AS name,
    CASE WHEN r.is_direct THEN COALESCE(mp.avatar_url, p.avatar_url, r.avatar_url) ELSE r.avatar_url END AS avatar_url,
    r.is_direct, r.last_message_at, r.last_message_preview,
    COALESCE((
      SELECT COUNT(*) FROM public.chat_messages m
      WHERE m.room_id = r.id AND m.is_deleted = FALSE AND m.sender_id <> auth.uid()
      AND NOT EXISTS (SELECT 1 FROM public.chat_message_receipts rcpt WHERE rcpt.message_id = m.id AND rcpt.user_id = auth.uid() AND rcpt.status = 'read')
    ), 0) AS unread_count,
    mem.is_muted, mem.is_pinned, mem.is_archived,
    (SELECT COUNT(*) FROM public.chat_room_members m2 WHERE m2.room_id = r.id AND m2.removed_at IS NULL) AS member_count,
    other_mem.user_id AS other_user_id,
    CASE WHEN r.is_direct AND other_mem.user_id IS NOT NULL THEN
      jsonb_strip_nulls(jsonb_build_object(
        'display_name', COALESCE(mp.display_name, mp.nickname, p.full_name, p.username, 'Unknown'),
        'avatar_url', COALESCE(mp.avatar_url, p.avatar_url)
      ))
    ELSE '{}'::JSONB END AS other_user_metadata
  FROM public.chat_rooms r
  JOIN public.chat_room_members mem ON mem.room_id = r.id AND mem.user_id = auth.uid() AND mem.removed_at IS NULL
  LEFT JOIN LATERAL (
    SELECT m2.user_id FROM public.chat_room_members m2
    WHERE m2.room_id = r.id AND m2.user_id <> auth.uid() AND m2.removed_at IS NULL LIMIT 1
  ) other_mem ON r.is_direct = TRUE
  LEFT JOIN public.merchant_profiles mp ON mp.user_id = other_mem.user_id
  LEFT JOIN public.profiles p ON p.user_id = other_mem.user_id
  WHERE mem.is_archived = FALSE
  ORDER BY COALESCE(r.last_message_at, r.created_at) DESC;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_get_rooms_v2()
 RETURNS TABLE(room_id uuid, room_name text, room_type text, is_direct boolean, last_message_at timestamp with time zone, last_message_preview text, unread_count bigint, my_role text, is_muted boolean, is_pinned boolean, is_archived boolean, room_policy jsonb, room_avatar text, other_user_metadata jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _me UUID := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  RETURN QUERY
    SELECT
      r.id AS room_id,
      -- Resolve DM room name from counterparty profile
      CASE
        WHEN r.is_direct THEN COALESCE(
          mp_other.display_name,
          mp_other.nickname,
          pr_other.full_name,
          pr_other.username,
          (au_other.raw_user_meta_data->>'full_name'),
          (au_other.raw_user_meta_data->>'name'),
          split_part(COALESCE(pr_other.email, au_other.email), '@', 1),
          r.name,
          'Direct Message'
        )
        ELSE COALESCE(r.name, 'Unnamed Room')
      END AS room_name,
      r.type::text AS room_type,
      r.is_direct,
      r.last_message_at,
      r.last_message_preview,
      COALESCE((
        SELECT count(*) FROM public.chat_messages m
        WHERE m.room_id = r.id AND m.is_deleted = false
          AND m.created_at > COALESCE(mem.last_read_at, mem.joined_at)
          AND m.sender_id <> _me
      ), 0)::bigint AS unread_count,
      mem.role::text AS my_role,
      mem.is_muted,
      mem.is_pinned,
      mem.is_archived,
      -- Policy JSON
      CASE WHEN p.id IS NOT NULL THEN jsonb_build_object(
        'encryption_mode', p.encryption_mode::text,
        'allow_calls', p.allow_calls,
        'allow_files', p.allow_files,
        'allow_images', p.allow_images,
        'allow_voice_notes', p.allow_voice_notes,
        'screenshot_protection', p.screenshot_protection,
        'watermark_enabled', p.watermark_enabled,
        'disable_forwarding', p.disable_forwarding,
        'disable_export', p.disable_export,
        'strip_forward_sender_identity', p.strip_forward_sender_identity,
        'retention_hours', p.retention_hours,
        'max_file_size_mb', p.max_file_size_mb
      ) ELSE NULL END AS room_policy,
      -- Avatar: prefer counterparty merchant avatar, then profile, then room
      CASE
        WHEN r.is_direct THEN COALESCE(mp_other.avatar_url, pr_other.avatar_url, r.avatar_url)
        ELSE r.avatar_url
      END AS room_avatar,
      -- Other user metadata for DMs
      CASE
        WHEN r.is_direct AND other_mem.user_id IS NOT NULL THEN jsonb_build_object(
          'display_name', COALESCE(mp_other.display_name, pr_other.full_name, pr_other.username),
          'nickname', mp_other.nickname,
          'avatar_url', COALESCE(mp_other.avatar_url, pr_other.avatar_url),
          'email', COALESCE(pr_other.email, au_other.email),
          'merchant_id', mp_other.merchant_id
        )
        ELSE NULL
      END AS other_user_metadata
    FROM public.chat_rooms r
    JOIN public.chat_room_members mem
      ON mem.room_id = r.id AND mem.user_id = _me AND mem.removed_at IS NULL
    LEFT JOIN public.chat_room_policies p ON p.id = r.policy_id
    -- For DMs: find the other member
    LEFT JOIN LATERAL (
      SELECT om.user_id
      FROM public.chat_room_members om
      WHERE om.room_id = r.id AND om.user_id <> _me AND om.removed_at IS NULL
      LIMIT 1
    ) other_mem ON r.is_direct
    LEFT JOIN public.merchant_profiles mp_other ON mp_other.user_id = other_mem.user_id
    LEFT JOIN public.profiles pr_other ON pr_other.user_id = other_mem.user_id
    LEFT JOIN auth.users au_other ON au_other.id = other_mem.user_id
    ORDER BY COALESCE(r.last_message_at, r.created_at) DESC;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_initiate_call(_room_id uuid, _call_id uuid DEFAULT NULL::uuid, _ice_config jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
  _policy RECORD;
BEGIN
  IF _call_id IS NULL THEN
    _call_id := gen_random_uuid();
  END IF;

  SELECT p.allow_calls
  INTO _policy
  FROM public.chat_rooms r
  JOIN public.chat_room_policies p ON p.id = r.policy_id
  WHERE r.id = _room_id;

  IF NOT _policy.allow_calls THEN
    RAISE EXCEPTION 'Calls not permitted';
  END IF;

  IF NOT public.fn_is_chat_member(_room_id, _me) THEN
    RAISE EXCEPTION 'Not a member';
  END IF;

  UPDATE public.chat_calls
  SET status = 'missed', ended_at = now()
  WHERE room_id = _room_id AND status = 'ringing';

  INSERT INTO public.chat_calls (id, room_id, initiated_by, status, ice_config)
  VALUES (_call_id, _room_id, _me, 'ringing', _ice_config);

  INSERT INTO public.chat_call_participants (call_id, user_id, status, joined_at)
  VALUES (_call_id, _me, 'connected', now());

  INSERT INTO public.chat_call_participants (call_id, user_id, status)
  SELECT _call_id, m.user_id, 'ringing'
  FROM public.chat_room_members m
  WHERE m.room_id = _room_id
    AND m.user_id <> _me
    AND m.removed_at IS NULL;

  PERFORM public.chat_send_message(
    _room_id,
    'Call started',
    'system',
    jsonb_build_object('call_id', _call_id, 'event', 'call_initiated'),
    NULL,
    gen_random_uuid()::text
  );

  RETURN _call_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_is_allowed_mime(_mime_type text, _allowed_mime_types text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT
    _allowed_mime_types IS NULL                          -- NULL = allow all
    OR _mime_type = ANY(_allowed_mime_types)             -- exact match
    OR (split_part(_mime_type, '/', 1) || '/*') = ANY(_allowed_mime_types)  -- wildcard
$function$
;
CREATE OR REPLACE FUNCTION public.chat_link_attachment_to_message(_attachment_id uuid, _message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me       uuid := auth.uid();
  _att      record;
  _msg      record;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Load attachment
  SELECT id, room_id, uploader_id, message_id
    INTO _att
    FROM chat_attachments
   WHERE id = _attachment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attachment not found';
  END IF;

  IF _att.uploader_id <> _me THEN
    RAISE EXCEPTION 'Not the uploader of this attachment';
  END IF;

  -- Load message
  SELECT id, room_id, sender_id
    INTO _msg
    FROM chat_messages
   WHERE id = _message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  IF _msg.sender_id <> _me THEN
    RAISE EXCEPTION 'Not the sender of this message';
  END IF;

  -- Room must match
  IF _att.room_id <> _msg.room_id THEN
    RAISE EXCEPTION 'Attachment and message are in different rooms';
  END IF;

  -- Link
  UPDATE chat_attachments
     SET message_id = _message_id
   WHERE id = _attachment_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_mark_room_read(_room_id uuid, _up_to_message_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
  _hide BOOLEAN;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT COALESCE(s.hide_read_receipts, false) INTO _hide
  FROM public.chat_privacy_settings s WHERE s.user_id = _me;

  -- Always update own member record
  UPDATE public.chat_room_members SET
    last_read_message_id = COALESCE(_up_to_message_id,
      (SELECT id FROM public.chat_messages WHERE room_id = _room_id AND is_deleted = FALSE ORDER BY created_at DESC LIMIT 1)),
    last_read_at = now()
  WHERE room_id = _room_id AND user_id = _me;

  -- Only write receipts if not hiding
  IF NOT COALESCE(_hide, false) THEN
    INSERT INTO public.chat_message_receipts (message_id, room_id, user_id, status, updated_at)
    SELECT m.id, _room_id, _me, 'read', now()
    FROM public.chat_messages m
    WHERE m.room_id = _room_id AND m.is_deleted = FALSE
      AND (_up_to_message_id IS NULL OR m.created_at <= (SELECT created_at FROM public.chat_messages WHERE id = _up_to_message_id))
    ON CONFLICT (message_id, user_id) DO UPDATE SET status = 'read', updated_at = now()
    WHERE chat_message_receipts.status <> 'read';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_mark_viewed(_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _me UUID := auth.uid();
BEGIN
  UPDATE public.chat_messages SET viewed_by = array_append(CASE WHEN _me = ANY(viewed_by) THEN viewed_by ELSE viewed_by END, _me)
  WHERE id = _message_id AND view_once = TRUE AND NOT (_me = ANY(viewed_by));
END; $function$
;
CREATE OR REPLACE FUNCTION public.chat_push_ice_candidate(_call_id uuid, _candidate jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _me UUID := auth.uid();
BEGIN
  UPDATE public.chat_call_participants
  SET ice_candidates = ice_candidates || jsonb_build_array(_candidate)
  WHERE call_id = _call_id
    AND user_id != _me;  -- push to the OTHER participant(s)
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_remove_reaction(_message_id uuid, _emoji text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN DELETE FROM public.chat_message_reactions WHERE message_id = _message_id AND user_id = auth.uid() AND emoji = _emoji; END; $function$
;
CREATE OR REPLACE FUNCTION public.chat_run_expiry_cleanup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _expired_msgs  int;
  _expired_offers int;
  _cleaned_att   int;
  _cleaned_stor  int;
  _paths         text[];
BEGIN
  -- 1) Expire messages past expires_at
  WITH expired AS (
    UPDATE public.chat_messages
       SET is_deleted = true,
           deleted_at = now(),
           content    = '[expired]'
     WHERE expires_at IS NOT NULL
       AND expires_at <= now()
       AND is_deleted = false
    RETURNING id
  )
  SELECT count(*) INTO _expired_msgs FROM expired;

  -- 2) Expire active market offers past expires_at
  WITH expired_offers AS (
    UPDATE public.market_offers
       SET status     = 'expired',
           updated_at = now()
     WHERE status = 'active'
       AND expires_at IS NOT NULL
       AND expires_at <= now()
    RETURNING id
  )
  SELECT count(*) INTO _expired_offers FROM expired_offers;

  -- 3) Collect storage paths from:
  --    a) orphaned attachments (message_id IS NULL, older than 2h)
  --    b) attachments on deleted messages (is_deleted=true, deleted 5+ min ago)
  WITH doomed AS (
    SELECT a.id, a.storage_path
      FROM public.chat_attachments a
     WHERE a.message_id IS NULL
       AND a.created_at < now() - interval '2 hours'
    UNION ALL
    SELECT a.id, a.storage_path
      FROM public.chat_attachments a
      JOIN public.chat_messages m ON m.id = a.message_id
     WHERE m.is_deleted = true
       AND COALESCE(m.deleted_at, m.updated_at, m.created_at) <= now() - interval '5 minutes'
  ),
  del_att AS (
    DELETE FROM public.chat_attachments
     WHERE id IN (SELECT id FROM doomed)
    RETURNING storage_path
  )
  SELECT count(*), array_agg(storage_path)
    INTO _cleaned_att, _paths
    FROM del_att;

  -- 4) Delete matching storage objects
  IF _paths IS NOT NULL AND array_length(_paths, 1) > 0 THEN
    WITH del_stor AS (
      DELETE FROM storage.objects
       WHERE bucket_id = 'chat-attachments'
         AND name = ANY(_paths)
      RETURNING id
    )
    SELECT count(*) INTO _cleaned_stor FROM del_stor;
  ELSE
    _cleaned_stor := 0;
  END IF;

  RETURN jsonb_build_object(
    'expired_messages',      _expired_msgs,
    'expired_offers',        _expired_offers,
    'cleaned_attachments',   _cleaned_att,
    'cleaned_storage_objects', _cleaned_stor,
    'ran_at',                now()
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_search_messages(_room_id uuid, _query text, _limit integer DEFAULT 40)
 RETURNS SETOF chat_messages
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.* FROM public.chat_messages m WHERE m.room_id = _room_id AND m.is_deleted = FALSE AND public.fn_is_chat_member(_room_id, auth.uid()) AND m.search_vector @@ plainto_tsquery('english', _query)
  ORDER BY ts_rank(m.search_vector, plainto_tsquery('english', _query)) DESC, m.created_at DESC LIMIT _limit;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_send_message(_room_id uuid, _content text, _type text DEFAULT 'text'::text, _metadata jsonb DEFAULT '{}'::jsonb, _reply_to_id uuid DEFAULT NULL::uuid, _client_nonce text DEFAULT NULL::text, _expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _view_once boolean DEFAULT false, _watermark_text text DEFAULT NULL::text, _attachment_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me  uuid := auth.uid();
  _msg public.chat_messages;
  _att record;
BEGIN
  -- Auth check
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Room membership
  IF NOT public.fn_is_chat_member(_room_id, _me) THEN RAISE EXCEPTION 'Not a member'; END IF;

  -- Client nonce idempotency: if a message with this nonce already exists, return it
  IF _client_nonce IS NOT NULL THEN
    SELECT * INTO _msg FROM public.chat_messages
     WHERE room_id = _room_id AND client_nonce = _client_nonce
     LIMIT 1;
    IF FOUND THEN
      RETURN NEXT _msg;
      RETURN;
    END IF;
  END IF;

  -- Validate attachment if provided
  IF _attachment_id IS NOT NULL THEN
    SELECT * INTO _att FROM public.chat_attachments WHERE id = _attachment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Attachment not found';
    END IF;
    IF _att.uploader_id <> _me THEN
      RAISE EXCEPTION 'Attachment uploader mismatch';
    END IF;
    IF _att.room_id <> _room_id THEN
      RAISE EXCEPTION 'Attachment room mismatch';
    END IF;
    IF _att.message_id IS NOT NULL THEN
      RAISE EXCEPTION 'Attachment already linked to a message';
    END IF;
  END IF;

  -- Insert message
  INSERT INTO public.chat_messages (
    room_id, sender_id, type, content, metadata,
    reply_to_id, client_nonce, expires_at, view_once, watermark_text
  ) VALUES (
    _room_id, _me, _type::public.chat_message_type, _content, _metadata,
    _reply_to_id, _client_nonce, _expires_at, _view_once, _watermark_text
  ) RETURNING * INTO _msg;

  -- Link attachment to the new message (same transaction)
  IF _attachment_id IS NOT NULL THEN
    UPDATE public.chat_attachments
       SET message_id = _msg.id
     WHERE id = _attachment_id;
  END IF;

  -- Update room preview
  UPDATE public.chat_rooms
     SET last_message_id = _msg.id,
         last_message_at = _msg.created_at,
         last_message_preview = left(_content, 120),
         updated_at = now()
   WHERE id = _room_id;

  -- Self-receipt
  INSERT INTO public.chat_message_receipts (message_id, room_id, user_id, status)
  VALUES (_msg.id, _room_id, _me, 'read')
  ON CONFLICT (message_id, user_id) DO NOTHING;

  RETURN NEXT _msg;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_set_presence(_status text DEFAULT 'online'::text, _device_info jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
  _priv public.chat_privacy_settings;
  _effective_status TEXT;
BEGIN
  IF _me IS NULL THEN RETURN; END IF;

  SELECT * INTO _priv FROM public.chat_privacy_settings WHERE user_id = _me;

  -- If invisible mode, always store offline
  IF COALESCE(_priv.invisible_mode, false) THEN
    _effective_status := 'offline';
  ELSE
    _effective_status := _status;
  END IF;

  INSERT INTO public.chat_presence (user_id, status, last_seen_at, device_info, updated_at)
  VALUES (
    _me,
    _effective_status,
    CASE WHEN COALESCE(_priv.hide_last_seen, false) THEN '1970-01-01'::timestamptz ELSE now() END,
    _device_info,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    status = EXCLUDED.status,
    last_seen_at = EXCLUDED.last_seen_at,
    device_info = EXCLUDED.device_info,
    updated_at = now();
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_set_typing(_room_id uuid, _is_typing boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
  _hide BOOLEAN;
BEGIN
  IF NOT public.fn_is_chat_member(_room_id, _me) THEN RAISE EXCEPTION 'Not a member'; END IF;

  SELECT COALESCE(s.hide_typing, false) INTO _hide
  FROM public.chat_privacy_settings s WHERE s.user_id = _me;

  IF COALESCE(_hide, false) THEN RETURN; END IF;

  INSERT INTO public.chat_typing_state (room_id, user_id, is_typing, expires_at, updated_at)
  VALUES (_room_id, _me, _is_typing, now() + interval '8 seconds', now())
  ON CONFLICT (room_id, user_id) DO UPDATE SET is_typing = EXCLUDED.is_typing, expires_at = EXCLUDED.expires_at, updated_at = now();
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_update_privacy_settings(_hide_read_receipts boolean DEFAULT NULL::boolean, _hide_last_seen boolean DEFAULT NULL::boolean, _hide_typing boolean DEFAULT NULL::boolean, _invisible_mode boolean DEFAULT NULL::boolean, _online_visibility text DEFAULT NULL::text, _notification_preview text DEFAULT NULL::text, _show_sender_in_notification boolean DEFAULT NULL::boolean, _anonymous_mode boolean DEFAULT NULL::boolean, _screenshot_protection boolean DEFAULT NULL::boolean, _watermark_enabled boolean DEFAULT NULL::boolean, _forwarding_disabled boolean DEFAULT NULL::boolean, _copy_disabled boolean DEFAULT NULL::boolean, _export_disabled boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  INSERT INTO public.chat_privacy_settings (user_id) VALUES (_me)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.chat_privacy_settings SET
    hide_read_receipts          = COALESCE(_hide_read_receipts, hide_read_receipts),
    hide_last_seen              = COALESCE(_hide_last_seen, hide_last_seen),
    hide_typing                 = COALESCE(_hide_typing, hide_typing),
    invisible_mode              = COALESCE(_invisible_mode, invisible_mode),
    online_visibility           = COALESCE(_online_visibility, online_visibility),
    notification_preview        = COALESCE(_notification_preview, notification_preview),
    show_sender_in_notification = COALESCE(_show_sender_in_notification, show_sender_in_notification),
    anonymous_mode              = COALESCE(_anonymous_mode, anonymous_mode),
    screenshot_protection       = COALESCE(_screenshot_protection, screenshot_protection),
    watermark_enabled           = COALESCE(_watermark_enabled, watermark_enabled),
    forwarding_disabled         = COALESCE(_forwarding_disabled, forwarding_disabled),
    copy_disabled               = COALESCE(_copy_disabled, copy_disabled),
    export_disabled             = COALESCE(_export_disabled, export_disabled),
    updated_at                  = now()
  WHERE user_id = _me;

  RETURN public.chat_get_privacy_settings();
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_update_privacy_settings(_invisible_mode boolean DEFAULT NULL::boolean, _hide_typing boolean DEFAULT NULL::boolean, _hide_read_receipts boolean DEFAULT NULL::boolean, _hide_last_seen boolean DEFAULT NULL::boolean, _online_visibility text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  INSERT INTO public.chat_privacy_settings (user_id) VALUES (_me)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.chat_privacy_settings SET
    invisible_mode     = COALESCE(_invisible_mode, invisible_mode),
    hide_typing        = COALESCE(_hide_typing, hide_typing),
    hide_read_receipts = COALESCE(_hide_read_receipts, hide_read_receipts),
    hide_last_seen     = COALESCE(_hide_last_seen, hide_last_seen),
    online_visibility  = COALESCE(_online_visibility, online_visibility),
    updated_at         = now()
  WHERE user_id = _me;

  RETURN public.chat_get_privacy_settings();
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_update_room_policy(_room_id uuid, _updates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _policy_id uuid;
  _my_role text;
  _result jsonb;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check caller is owner or admin of the room
  SELECT role INTO _my_role
  FROM public.chat_room_members
  WHERE room_id = _room_id AND user_id = _me AND removed_at IS NULL;

  IF _my_role IS NULL OR _my_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only room owner or admin can update policies';
  END IF;

  -- Get policy_id
  SELECT policy_id INTO _policy_id
  FROM public.chat_rooms
  WHERE id = _room_id;

  IF _policy_id IS NULL THEN
    RAISE EXCEPTION 'Room has no policy';
  END IF;

  -- Apply updates (only allowed fields)
  UPDATE public.chat_room_policies SET
    watermark_enabled = COALESCE((_updates->>'watermark_enabled')::boolean, watermark_enabled),
    screenshot_protection = COALESCE((_updates->>'screenshot_protection')::boolean, screenshot_protection),
    disable_forwarding = COALESCE((_updates->>'disable_forwarding')::boolean, disable_forwarding),
    disable_export = COALESCE((_updates->>'disable_export')::boolean, disable_export),
    history_searchable = COALESCE((_updates->>'history_searchable')::boolean, history_searchable),
    allow_calls = COALESCE((_updates->>'allow_calls')::boolean, allow_calls),
    allow_files = COALESCE((_updates->>'allow_files')::boolean, allow_files),
    allow_images = COALESCE((_updates->>'allow_images')::boolean, allow_images),
    allow_voice_notes = COALESCE((_updates->>'allow_voice_notes')::boolean, allow_voice_notes),
    strip_forward_sender_identity = COALESCE((_updates->>'strip_forward_sender_identity')::boolean, strip_forward_sender_identity),
    link_preview_enabled = COALESCE((_updates->>'link_preview_enabled')::boolean, link_preview_enabled),
    updated_at = now()
  WHERE id = _policy_id;

  -- Return updated policy
  SELECT to_jsonb(p) INTO _result
  FROM public.chat_room_policies p
  WHERE p.id = _policy_id;

  RETURN _result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.current_merchant_id()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT merchant_id FROM public.merchant_profiles WHERE user_id = auth.uid() LIMIT 1
$function$
;
CREATE OR REPLACE FUNCTION public.customer_wallet_summary(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  -- Verify caller is the owner
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'available_balance', COALESCE(SUM(CASE WHEN status = 'completed' THEN
      CASE WHEN order_type = 'buy' THEN amount ELSE -amount END
    ELSE 0 END), 0),
    'pending_balance', COALESCE(SUM(CASE WHEN status = 'pending' THEN
      CASE WHEN order_type = 'buy' THEN amount ELSE amount END
    ELSE 0 END), 0),
    'held_balance', COALESCE(SUM(CASE WHEN status IN ('payment_sent', 'confirmed', 'awaiting_payment') THEN
      CASE WHEN order_type = 'buy' THEN amount ELSE amount END
    ELSE 0 END), 0),
    'total_completed', COALESCE(COUNT(*) FILTER (WHERE status = 'completed'), 0),
    'currency', 'USDT'
  ) INTO result
  FROM public.customer_orders
  WHERE customer_user_id = p_user_id;

  RETURN result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.deal_reinvested_pool(_deal_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT pool_balance_after 
     FROM public.deal_capital_ledger 
     WHERE deal_id = _deal_id 
     ORDER BY created_at DESC 
     LIMIT 1),
    0
  )
$function$
;
CREATE OR REPLACE FUNCTION public.fn_auto_pause_listing_on_trade_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.listing_id IS NOT NULL THEN
    UPDATE public.otc_listings
      SET status = 'paused', updated_at = now()
      WHERE id = NEW.listing_id AND status = 'active';
  END IF;
  RETURN NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_auto_release_escrow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    -- Release escrow deposits
    UPDATE public.otc_escrow
      SET status = 'released', released_at = now(), updated_at = now()
      WHERE trade_id = NEW.id AND status = 'deposited';
    -- Update escrow_status on the trade
    UPDATE public.otc_trades
      SET escrow_status = 'released'
      WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_chat_add_reaction(_room_id uuid, _message_id uuid, _reaction text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_os_room_member(_room_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  INSERT INTO public.message_reactions
    (room_id, message_id, user_id, reaction)
  VALUES
    (_room_id, _message_id, public.current_merchant_id(), _reaction)
  ON CONFLICT (message_id, user_id, reaction) DO NOTHING;

  RETURN true;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_chat_delete_message(p_room_id uuid, p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.os_messages
    WHERE id = p_message_id
      AND room_id = p_room_id
      AND sender_merchant_id = public.current_merchant_id()
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE public.os_messages
  SET content    = '||DELETED||',
      is_deleted = true,
      deleted_at = now()
  WHERE id = p_message_id
    AND room_id = p_room_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_chat_deliver_receipts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.chat_message_receipts (message_id, room_id, user_id, status, updated_at)
  SELECT NEW.id, NEW.room_id, m.user_id, 'delivered', now() FROM public.chat_room_members m
  WHERE m.room_id = NEW.room_id AND m.user_id <> NEW.sender_id AND m.removed_at IS NULL
  ON CONFLICT (message_id, user_id) DO NOTHING;
  RETURN NEW;
END; $function$
;
CREATE OR REPLACE FUNCTION public.fn_chat_expire_messages()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN RETURN public.chat_run_expiry_cleanup(); END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_chat_mark_read(_room_id uuid, _message_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _cutoff TIMESTAMPTZ; _mid TEXT;
BEGIN
    _mid := public.current_merchant_id();
    SELECT created_at INTO _cutoff FROM public.os_messages
    WHERE id = _message_id AND room_id = _room_id;
    IF NOT FOUND THEN RETURN FALSE; END IF;

    UPDATE public.os_messages
    SET read_at = now()
    WHERE room_id = _room_id
      AND sender_merchant_id <> _mid
      AND created_at <= _cutoff
      AND read_at IS NULL;

    RETURN FOUND;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_chat_member_role(p_room_id uuid, p_user_id uuid)
 RETURNS chat_member_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role FROM public.chat_room_members WHERE room_id = p_room_id AND user_id = p_user_id AND removed_at IS NULL LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_chat_notify_new_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _member RECORD; _sender TEXT;
BEGIN
  IF NEW.type = 'system' THEN RETURN NEW; END IF;
  SELECT COALESCE(mp.display_name, p.full_name, 'Someone') INTO _sender
  FROM auth.users u LEFT JOIN public.merchant_profiles mp ON mp.user_id = u.id LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE u.id = NEW.sender_id LIMIT 1;
  FOR _member IN SELECT m.user_id FROM public.chat_room_members m WHERE m.room_id = NEW.room_id AND m.user_id <> NEW.sender_id AND m.removed_at IS NULL AND m.notification_level <> 'none' AND (m.is_muted = FALSE OR (m.muted_until IS NOT NULL AND m.muted_until < now())) LOOP
    INSERT INTO public.notifications (user_id, category, title, body, actor_id, entity_type, entity_id, target_path, target_entity_type, target_entity_id, dedupe_key)
    VALUES (_member.user_id, 'message', _sender,
      left(CASE WHEN NEW.type = 'text' THEN NEW.content WHEN NEW.type = 'voice_note' THEN '🎙 Voice message' WHEN NEW.type = 'image' THEN '🖼 Image' WHEN NEW.type = 'file' THEN '📎 File' ELSE NEW.type::text END, 80),
      NEW.sender_id, 'chat_message', NEW.id::text, '/chat', 'chat_message', NEW.id::text,
      'chat:' || NEW.room_id::text || ':' || _member.user_id::text)
    ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NEW;
END; $function$
;
CREATE OR REPLACE FUNCTION public.fn_chat_pin_message(p_room_id uuid, p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_os_room_member(p_room_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE public.os_messages
  SET is_pinned = true,
      pinned_at = now(),
      pinned_by = public.current_merchant_id()
  WHERE id = p_message_id
    AND room_id = p_room_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_chat_remove_reaction(_room_id uuid, _message_id uuid, _reaction text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.message_reactions
  WHERE message_id = _message_id
    AND user_id    = public.current_merchant_id()
    AND reaction   = _reaction;

  RETURN true;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_chat_send_message(_room_id uuid, _body text, _body_json jsonb DEFAULT '{}'::jsonb, _message_type text DEFAULT 'text'::text, _client_nonce text DEFAULT NULL::text, _reply_to_message_id uuid DEFAULT NULL::uuid, _expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    _msg_id UUID; _mid TEXT; _now TIMESTAMPTZ;
BEGIN
    _mid := public.current_merchant_id();
    IF _mid IS NULL THEN RAISE EXCEPTION 'No merchant profile found for current user'; END IF;
    _now := now();

    INSERT INTO public.os_messages (room_id, sender_merchant_id, content, expires_at, created_at)
    VALUES (_room_id, _mid, _body, _expires_at, _now)
    RETURNING id INTO _msg_id;

    UPDATE public.os_rooms SET updated_at = _now WHERE id = _room_id;

    RETURN jsonb_build_object(
      'id', _msg_id, 'room_id', _room_id, 'content', _body,
      'sender_merchant_id', _mid, 'created_at', _now
    );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_chat_unpin_message(p_room_id uuid, p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_os_room_member(p_room_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE public.os_messages
  SET is_pinned = false,
      pinned_at = null,
      pinned_by = null
  WHERE id = p_message_id
    AND room_id = p_room_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_finalize_settlement_decisions(p_period_id uuid, p_agreement_id uuid, p_agreement_snapshot jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  rec               record;
  v_final_decision  text;
  v_reinvested      numeric;
  v_withdrawn       numeric;
  v_cap_after       numeric;
  v_snapshot        jsonb;
  v_now             timestamptz := now();
begin
  for rec in
    select *
    from public.settlement_decisions
    where settlement_period_id = p_period_id
      and agreement_id         = p_agreement_id
      and finalized_at is null
  loop
    v_final_decision := case
      when rec.decision = 'pending' then rec.default_behavior
      else rec.decision
    end;

    v_reinvested := case when v_final_decision = 'reinvest' then rec.profit_amount else 0 end;
    v_withdrawn  := case when v_final_decision = 'withdraw' then rec.profit_amount else 0 end;
    v_cap_after  := rec.effective_capital_before + v_reinvested;

    v_snapshot := p_agreement_snapshot || jsonb_build_object(
      'merchant_id',              rec.merchant_id,
      'role',                     rec.role,
      'profit_amount',            rec.profit_amount,
      'final_decision',           v_final_decision,
      'was_explicit',             rec.decision <> 'pending',
      'default_behavior',         rec.default_behavior,
      'reinvested_amount',        v_reinvested,
      'withdrawn_amount',         v_withdrawn,
      'effective_capital_before', rec.effective_capital_before,
      'effective_capital_after',  v_cap_after,
      'finalized_by',             auth.uid()::text
    );

    update public.settlement_decisions
    set decision                = v_final_decision,
        reinvested_amount       = v_reinvested,
        withdrawn_amount        = v_withdrawn,
        effective_capital_after = v_cap_after,
        finalization_snapshot   = v_snapshot,
        finalized_at            = v_now
    where id = rec.id;
  end loop;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_get_dashboard_stats(p_merchant_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rel_ids   uuid[];
  v_result    json;
begin
  if auth.uid()::text <> p_merchant_id then
    raise exception 'not_authorized';
  end if;

  select array_agg(id)
  into v_rel_ids
  from public.merchant_relationships
  where (merchant_a_id = p_merchant_id or merchant_b_id = p_merchant_id)
    and status = 'active';

  if v_rel_ids is null then
    return json_build_object(
      'total_deployed',       0,
      'active_capital',       0,
      'active_relationships', 0,
      'pending_approvals',    0
    );
  end if;

  select json_build_object(
    'total_deployed',
      coalesce((
        select sum(amount)
        from public.merchant_deals
        where relationship_id = any(v_rel_ids)
      ), 0),
    'active_capital',
      coalesce((
        select sum(amount)
        from public.merchant_deals
        where relationship_id = any(v_rel_ids)
          and status in ('active','approved')
      ), 0),
    'active_relationships',
      array_length(v_rel_ids, 1),
    'pending_approvals',
      coalesce((
        select count(*)
        from public.merchant_approvals
        where relationship_id = any(v_rel_ids)
          and status = 'pending'
      ), 0)
  ) into v_result;

  return v_result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_get_user_privacy(p_user_id uuid)
 RETURNS chat_privacy_settings
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT * FROM public.chat_privacy_settings WHERE user_id = p_user_id LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_is_chat_member(p_room_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.chat_room_members WHERE room_id = p_room_id AND user_id = p_user_id AND removed_at IS NULL);
$function$
;
CREATE OR REPLACE FUNCTION public.fn_is_presence_visible(_target_user_id uuid, _viewer_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _priv public.chat_privacy_settings;
  _shares_room BOOLEAN;
BEGIN
  -- Always visible to self
  IF _target_user_id = _viewer_id THEN RETURN true; END IF;

  SELECT * INTO _priv FROM public.chat_privacy_settings WHERE user_id = _target_user_id;

  -- No privacy settings = visible to all
  IF NOT FOUND THEN RETURN true; END IF;

  -- Invisible mode = hidden from everyone
  IF _priv.invisible_mode THEN RETURN false; END IF;

  -- Check online_visibility
  IF _priv.online_visibility = 'everyone' THEN RETURN true; END IF;

  IF _priv.online_visibility = 'nobody' THEN RETURN false; END IF;

  -- 'contacts' = shares at least one chat room
  SELECT EXISTS (
    SELECT 1 FROM public.chat_room_members a
    JOIN public.chat_room_members b ON a.room_id = b.room_id
    WHERE a.user_id = _target_user_id AND b.user_id = _viewer_id
      AND a.removed_at IS NULL AND b.removed_at IS NULL
  ) INTO _shares_room;

  RETURN _shares_room;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_notify_capital_transfer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rel RECORD;
  _sender_merchant_id TEXT;
  _partner_merchant_id TEXT;
  _partner_user_id UUID;
  _sender_name TEXT;
BEGIN
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships WHERE id = NEW.relationship_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT merchant_id INTO _sender_merchant_id
  FROM public.merchant_profiles WHERE user_id = NEW.transferred_by LIMIT 1;

  IF _sender_merchant_id = _rel.merchant_a_id THEN
    _partner_merchant_id := _rel.merchant_b_id;
  ELSE
    _partner_merchant_id := _rel.merchant_a_id;
  END IF;

  SELECT user_id INTO _partner_user_id
  FROM public.merchant_profiles WHERE merchant_id = _partner_merchant_id LIMIT 1;

  SELECT COALESCE(nickname, display_name, merchant_id) INTO _sender_name
  FROM public.merchant_profiles WHERE user_id = NEW.transferred_by LIMIT 1;

  IF _partner_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    entity_type, entity_id, actor_id,
    target_path, target_tab, target_focus, target_entity_type, target_entity_id
  ) VALUES (
    _partner_user_id, 'deal',
    COALESCE(_sender_name, 'A partner') || ' transferred ' || NEW.direction || ' capital',
    NEW.amount || ' ' || NEW.currency || COALESCE(' — ' || NEW.note, ''),
    'capital_transfer', NEW.id::text, NEW.transferred_by,
    '/trading/orders', 'transfers', 'focusTransferId', 'capital_transfer', NEW.id::text
  );
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_notify_cash_custody_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _requester_name TEXT; _recipient_user_id UUID;
BEGIN
  _recipient_user_id := NEW.custodian_user_id;
  IF _recipient_user_id IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(nickname, display_name, merchant_id) INTO _requester_name
  FROM public.merchant_profiles WHERE merchant_id = NEW.requester_merchant_id LIMIT 1;
  INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_tab, target_focus, target_entity_type, target_entity_id)
  VALUES (_recipient_user_id, 'stock',
    COALESCE(_requester_name, 'A merchant') || ' sent you a cash custody request',
    'Amount: ' || NEW.amount || ' ' || NEW.currency || COALESCE(' — ' || NEW.note, ''),
    'cash_custody', NEW.id::text,
    '/trading/stock', 'cash', 'focusCustodyId', 'cash_custody', NEW.id::text);
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_notify_customer_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _conn RECORD;
  _recipient_user_id UUID;
  _sender_name TEXT;
BEGIN
  SELECT customer_user_id, merchant_id INTO _conn
  FROM public.customer_merchant_connections WHERE id = NEW.connection_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.sender_role = 'customer' THEN
    SELECT user_id INTO _recipient_user_id
    FROM public.merchant_profiles WHERE merchant_id = _conn.merchant_id LIMIT 1;
    SELECT display_name INTO _sender_name
    FROM public.customer_profiles WHERE user_id = NEW.sender_user_id LIMIT 1;
  ELSE
    _recipient_user_id := _conn.customer_user_id;
    SELECT COALESCE(nickname, display_name) INTO _sender_name
    FROM public.merchant_profiles WHERE merchant_id = _conn.merchant_id LIMIT 1;
  END IF;

  IF _recipient_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    target_path, target_tab, target_focus,
    target_entity_type, target_entity_id,
    actor_id, entity_type, entity_id
  )
  VALUES (
    _recipient_user_id, 'message',
    COALESCE(_sender_name, 'New message'),
    LEFT(NEW.content, 100),
    CASE WHEN NEW.sender_role = 'customer' THEN '/merchants' ELSE '/c/chat' END,
    CASE WHEN NEW.sender_role = 'customer' THEN 'clients' ELSE NULL END,
    'focusMessageId',
    'customer_message', NEW.id::text,
    NEW.sender_user_id,
    'customer_message', NEW.id::text
  );
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_notify_customer_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _customer_name TEXT;
  _merchant_user_id UUID;
BEGIN
  SELECT display_name INTO _customer_name
  FROM public.customer_profiles WHERE user_id = NEW.customer_user_id LIMIT 1;

  SELECT user_id INTO _merchant_user_id
  FROM public.merchant_profiles WHERE merchant_id = NEW.merchant_id LIMIT 1;

  IF _merchant_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_entity_type, target_entity_id)
  VALUES (
    _merchant_user_id, 'customer_order',
    COALESCE(_customer_name, 'A customer') || ' placed a ' || NEW.order_type || ' order',
    NEW.amount || ' ' || NEW.currency || COALESCE(' — ' || NEW.note, ''),
    'customer_order', NEW.id::text,
    '/trading/orders', 'customer_order', NEW.id::text
  );
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_notify_otc_dispute()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Notify respondent
  INSERT INTO public.notifications (user_id, category, title, body, metadata)
  VALUES (
    NEW.respondent_user_id,
    'deal',
    'OTC Dispute Opened',
    'A dispute has been opened against a trade you are involved in.',
    jsonb_build_object('dispute_id', NEW.id, 'trade_id', NEW.trade_id, 'action', 'view_dispute', 'deep_link', '/marketplace?tab=trades')
  );
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_notify_otc_escrow_deposit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _trade record;
  _notify_user_id uuid;
BEGIN
  IF NEW.status = 'deposited' AND (OLD.status IS NULL OR OLD.status <> 'deposited') THEN
    SELECT * INTO _trade FROM public.otc_trades WHERE id = NEW.trade_id;
    IF FOUND THEN
      IF _trade.initiator_user_id = NEW.depositor_user_id THEN
        _notify_user_id := _trade.responder_user_id;
      ELSE
        _notify_user_id := _trade.initiator_user_id;
      END IF;

      INSERT INTO public.notifications (user_id, category, title, body, target_path, target_tab, target_entity_type, target_entity_id, dedupe_key)
      VALUES (
        _notify_user_id,
        'deal',
        'Escrow Deposit Received',
        'Your counterparty deposited ' || NEW.amount || ' ' || NEW.currency || ' into escrow',
        '/marketplace',
        'trades',
        'otc_trade',
        NEW.trade_id::text,
        'otc_escrow_' || NEW.trade_id || '_' || NEW.depositor_user_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_notify_otc_trade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _recipient_id uuid;
  _title text;
  _body text;
  _actor_id uuid;
BEGIN
  -- Determine recipient (the OTHER party) and message
  IF TG_OP = 'INSERT' THEN
    -- New offer → notify the responder (listing owner)
    _recipient_id := NEW.responder_user_id;
    _actor_id := NEW.initiator_user_id;
    _title := 'New OTC Offer';
    _body := 'You received a new trade offer for ' || NEW.amount || ' ' || NEW.currency;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Status changed
    IF NEW.status = OLD.status THEN
      RETURN NEW; -- No status change, skip
    END IF;
    
    CASE NEW.status
      WHEN 'countered' THEN
        -- Counter came from responder → notify initiator
        _recipient_id := NEW.initiator_user_id;
        _actor_id := NEW.responder_user_id;
        _title := 'Counter Offer Received';
        _body := 'Your trade offer was countered: ' || COALESCE(NEW.counter_amount::text, '') || ' @ ' || COALESCE(NEW.counter_rate::text, '');
      WHEN 'confirmed' THEN
        -- Could be either party confirming
        -- The one who DIDN'T update should get notified
        -- We approximate: if status was 'offered', responder confirmed → notify initiator
        -- if status was 'countered', initiator confirmed → notify responder
        IF OLD.status = 'offered' THEN
          _recipient_id := NEW.initiator_user_id;
          _actor_id := NEW.responder_user_id;
        ELSE
          _recipient_id := NEW.responder_user_id;
          _actor_id := NEW.initiator_user_id;
        END IF;
        _title := 'Trade Confirmed ✅';
        _body := 'Your OTC trade for ' || COALESCE(NEW.counter_amount, NEW.amount) || ' ' || NEW.currency || ' has been confirmed';
      WHEN 'completed' THEN
        -- Notify both but skip the actor (we don't know who, so notify both)
        -- We'll notify the responder; the UI handles the rest
        _recipient_id := CASE 
          WHEN NEW.initiator_user_id != COALESCE(NEW.responder_user_id, NEW.initiator_user_id) 
          THEN NEW.responder_user_id 
          ELSE NEW.initiator_user_id 
        END;
        _actor_id := CASE WHEN _recipient_id = NEW.responder_user_id THEN NEW.initiator_user_id ELSE NEW.responder_user_id END;
        _title := 'Trade Completed 🎉';
        _body := 'OTC trade for ' || COALESCE(NEW.counter_amount, NEW.amount) || ' ' || NEW.currency || ' marked as completed';
      WHEN 'cancelled' THEN
        -- Notify the other party
        -- We approximate: notify responder if initiator cancelled, vice versa
        _recipient_id := NEW.responder_user_id;
        _actor_id := NEW.initiator_user_id;
        _title := 'Trade Cancelled';
        _body := 'An OTC trade for ' || NEW.amount || ' ' || NEW.currency || ' was cancelled';
      ELSE
        RETURN NEW;
    END CASE;
  ELSE
    RETURN NEW;
  END IF;

  -- Don't notify yourself
  IF _recipient_id = _actor_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    entity_type, entity_id,
    actor_id, target_path, target_tab,
    dedupe_key
  ) VALUES (
    _recipient_id, 'deal', _title, _body,
    'otc_trade', NEW.id::text,
    _actor_id, '/marketplace', 'trades',
    'otc_trade_' || NEW.id::text || '_' || NEW.status
  );

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_notify_otc_trade_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'offered' THEN
    INSERT INTO public.notifications (user_id, category, title, body, target_path, target_tab, target_entity_type, target_entity_id, dedupe_key)
    VALUES (
      NEW.responder_user_id,
      'deal',
      'New OTC Trade Offer',
      'You received a trade offer for ' || NEW.amount || ' ' || NEW.currency,
      '/marketplace',
      'trades',
      'otc_trade',
      NEW.id::text,
      'otc_offer_' || NEW.id
    );
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_notify_otc_trade_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _notify_user_id uuid;
  _title text;
  _body text;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('confirmed', 'completed', 'cancelled', 'countered') THEN
    IF NEW.initiator_user_id = OLD.initiator_user_id THEN
      _notify_user_id := NEW.responder_user_id;
    ELSE
      _notify_user_id := NEW.initiator_user_id;
    END IF;

    _title := 'OTC Trade ' || initcap(NEW.status);
    _body := 'Trade for ' || NEW.amount || ' ' || NEW.currency || ' is now ' || NEW.status;

    INSERT INTO public.notifications (user_id, category, title, body, target_path, target_tab, target_entity_type, target_entity_id, dedupe_key)
    VALUES (
      _notify_user_id,
      'deal',
      _title,
      _body,
      '/marketplace',
      'trades',
      'otc_trade',
      NEW.id::text,
      'otc_status_' || NEW.id || '_' || NEW.status
    );
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_notify_profit_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rel RECORD;
  _recorder_merchant_id TEXT;
  _partner_merchant_id TEXT;
  _partner_user_id UUID;
  _recorder_name TEXT;
BEGIN
  IF NEW.relationship_id IS NULL THEN RETURN NEW; END IF;

  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships WHERE id = NEW.relationship_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT merchant_id INTO _recorder_merchant_id
  FROM public.merchant_profiles WHERE user_id = NEW.recorded_by LIMIT 1;

  IF _recorder_merchant_id = _rel.merchant_a_id THEN
    _partner_merchant_id := _rel.merchant_b_id;
  ELSE
    _partner_merchant_id := _rel.merchant_a_id;
  END IF;

  SELECT user_id INTO _partner_user_id
  FROM public.merchant_profiles WHERE merchant_id = _partner_merchant_id LIMIT 1;

  SELECT COALESCE(nickname, display_name, merchant_id) INTO _recorder_name
  FROM public.merchant_profiles WHERE user_id = NEW.recorded_by LIMIT 1;

  IF _partner_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    entity_type, entity_id, actor_id,
    target_path, target_entity_type, target_entity_id
  ) VALUES (
    _partner_user_id, 'deal',
    COALESCE(_recorder_name, 'A partner') || ' recorded a profit',
    NEW.amount || ' ' || NEW.currency || COALESCE(' — ' || NEW.notes, ''),
    'profit', NEW.id::text, NEW.recorded_by,
    '/trading/orders', 'deal', NEW.deal_id::text
  );
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_notify_settlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rel RECORD;
  _settler_merchant_id TEXT;
  _partner_merchant_id TEXT;
  _partner_user_id UUID;
  _settler_name TEXT;
BEGIN
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships WHERE id = NEW.relationship_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT merchant_id INTO _settler_merchant_id
  FROM public.merchant_profiles WHERE user_id = NEW.settled_by LIMIT 1;

  IF _settler_merchant_id = _rel.merchant_a_id THEN
    _partner_merchant_id := _rel.merchant_b_id;
  ELSE
    _partner_merchant_id := _rel.merchant_a_id;
  END IF;

  SELECT user_id INTO _partner_user_id
  FROM public.merchant_profiles WHERE merchant_id = _partner_merchant_id LIMIT 1;

  SELECT COALESCE(nickname, display_name, merchant_id) INTO _settler_name
  FROM public.merchant_profiles WHERE user_id = NEW.settled_by LIMIT 1;

  IF _partner_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    entity_type, entity_id, actor_id,
    target_path, target_tab, target_entity_type, target_entity_id
  ) VALUES (
    _partner_user_id, 'settlement',
    COALESCE(_settler_name, 'A partner') || ' submitted a settlement',
    NEW.amount || ' ' || NEW.currency || COALESCE(' — ' || NEW.notes, ''),
    'settlement', NEW.id::text, NEW.settled_by,
    '/trading/orders', 'settlements', 'settlement', NEW.id::text
  );
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_os_messages_notify_counterparty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _counterparty_merchant_id TEXT;
  _recipient_user_id UUID;
  _sender_name TEXT;
BEGIN
  SELECT rm.merchant_id INTO _counterparty_merchant_id
  FROM public.os_room_members rm
  WHERE rm.room_id = NEW.room_id AND rm.merchant_id <> NEW.sender_merchant_id
  LIMIT 1;
  IF _counterparty_merchant_id IS NULL THEN RETURN NEW; END IF;

  SELECT user_id INTO _recipient_user_id
  FROM public.merchant_profiles WHERE merchant_id = _counterparty_merchant_id LIMIT 1;
  IF _recipient_user_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(nickname, display_name, sender_merchant_id)
    INTO _sender_name
  FROM public.merchant_profiles WHERE merchant_id = NEW.sender_merchant_id LIMIT 1;

  IF NEW.content LIKE '||SYS_%' THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id)
  VALUES (_recipient_user_id, 'message', COALESCE(_sender_name, 'New message'),
          LEFT(NEW.content, 100), 'os_room', NEW.room_id::text);
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_otc_lifecycle_cleanup()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Expire listings older than 7 days
  UPDATE public.otc_listings
    SET status = 'expired', updated_at = now()
    WHERE status = 'active'
      AND updated_at < now() - interval '7 days';

  -- Cancel offered/countered trades older than 48h
  UPDATE public.otc_trades
    SET status = 'expired', updated_at = now()
    WHERE status IN ('offered', 'countered')
      AND updated_at < now() - interval '48 hours';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_refresh_otc_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.merchant_profiles SET
    otc_avg_rating = sub.avg_rating,
    otc_review_count = sub.cnt
  FROM (
    SELECT
      AVG(rating)::numeric AS avg_rating,
      COUNT(*) AS cnt
    FROM public.otc_reviews
    WHERE reviewed_user_id = NEW.reviewed_user_id
  ) sub
  WHERE user_id = NEW.reviewed_user_id;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_refresh_otc_reputation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('completed', 'cancelled') AND OLD.status != NEW.status THEN
    -- Update initiator stats
    UPDATE public.merchant_profiles SET
      otc_completed_trades = sub.completed,
      otc_completion_rate = CASE WHEN sub.total > 0 THEN (sub.completed::numeric / sub.total * 100) ELSE 0 END,
      otc_total_volume = sub.volume,
      otc_reputation_updated_at = now()
    FROM (
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status IN ('completed','cancelled')) AS total,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN COALESCE(counter_total, total) ELSE 0 END), 0) AS volume
      FROM public.otc_trades
      WHERE initiator_user_id = NEW.initiator_user_id
    ) sub
    WHERE user_id = NEW.initiator_user_id;

    -- Update responder stats
    UPDATE public.merchant_profiles SET
      otc_completed_trades = sub.completed,
      otc_completion_rate = CASE WHEN sub.total > 0 THEN (sub.completed::numeric / sub.total * 100) ELSE 0 END,
      otc_total_volume = sub.volume,
      otc_reputation_updated_at = now()
    FROM (
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status IN ('completed','cancelled')) AS total,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN COALESCE(counter_total, total) ELSE 0 END), 0) AS volume
      FROM public.otc_trades
      WHERE responder_user_id = NEW.responder_user_id
    ) sub
    WHERE user_id = NEW.responder_user_id;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_refresh_verification_tier()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tier text;
BEGIN
  IF COALESCE(NEW.otc_completed_trades, 0) >= 50 AND COALESCE(NEW.otc_completion_rate, 0) >= 90 THEN
    _tier := 'verified';
  ELSIF COALESCE(NEW.otc_completed_trades, 0) >= 10 AND COALESCE(NEW.otc_completion_rate, 0) >= 70 THEN
    _tier := 'trusted';
  ELSE
    _tier := 'new';
  END IF;

  IF _tier IS DISTINCT FROM COALESCE(NEW.verification_tier, 'new') THEN
    NEW.verification_tier := _tier;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $function$
;
CREATE OR REPLACE FUNCTION public.fn_sync_escrow_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _deposited_count int;
  _trade_id uuid := COALESCE(NEW.trade_id, OLD.trade_id);
BEGIN
  SELECT COUNT(*) INTO _deposited_count
    FROM public.otc_escrow
    WHERE trade_id = _trade_id AND status = 'deposited';

  UPDATE public.otc_trades SET escrow_status = CASE
    WHEN _deposited_count >= 2 THEN 'both_deposited'
    WHEN _deposited_count = 1 THEN 'partial'
    ELSE 'none'
  END, updated_at = now()
  WHERE id = _trade_id;

  RETURN COALESCE(NEW, OLD);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_unread_counts(_user_id uuid DEFAULT auth.uid())
 RETURNS TABLE(relationship_id uuid, unread_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT mm.relationship_id, COUNT(*) AS unread_count
  FROM public.merchant_messages mm
  JOIN public.merchant_relationships mr ON mr.id = mm.relationship_id
  WHERE mm.sender_id != _user_id
    AND mm.read_at IS NULL
    AND (
      mr.merchant_a_id = (SELECT merchant_id FROM public.merchant_profiles WHERE user_id = _user_id LIMIT 1)
      OR
      mr.merchant_b_id = (SELECT merchant_id FROM public.merchant_profiles WHERE user_id = _user_id LIMIT 1)
    )
  GROUP BY mm.relationship_id;
$function$
;
CREATE OR REPLACE FUNCTION public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_extract_query_trgm$function$
;
CREATE OR REPLACE FUNCTION public.gin_extract_value_trgm(text, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_extract_value_trgm$function$
;
CREATE OR REPLACE FUNCTION public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_trgm_consistent$function$
;
CREATE OR REPLACE FUNCTION public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal)
 RETURNS "char"
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_trgm_triconsistent$function$
;
CREATE OR REPLACE FUNCTION public.gtrgm_compress(internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_compress$function$
;
CREATE OR REPLACE FUNCTION public.gtrgm_consistent(internal, text, smallint, oid, internal)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_consistent$function$
;
CREATE OR REPLACE FUNCTION public.gtrgm_decompress(internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_decompress$function$
;
CREATE OR REPLACE FUNCTION public.gtrgm_distance(internal, text, smallint, oid, internal)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_distance$function$
;
CREATE OR REPLACE FUNCTION public.gtrgm_in(cstring)
 RETURNS gtrgm
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_in$function$
;
CREATE OR REPLACE FUNCTION public.gtrgm_options(internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/pg_trgm', $function$gtrgm_options$function$
;
CREATE OR REPLACE FUNCTION public.gtrgm_out(gtrgm)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_out$function$
;
CREATE OR REPLACE FUNCTION public.gtrgm_penalty(internal, internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_penalty$function$
;
CREATE OR REPLACE FUNCTION public.gtrgm_picksplit(internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_picksplit$function$
;
CREATE OR REPLACE FUNCTION public.gtrgm_same(gtrgm, gtrgm, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_same$function$
;
CREATE OR REPLACE FUNCTION public.gtrgm_union(internal, internal)
 RETURNS gtrgm
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_union$function$
;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email, status)
  VALUES (NEW.id, COALESCE(NEW.email, ''), 'pending');
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.has_relationship_with(_viewer_merchant_id text, _target_merchant_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.merchant_relationships r
    WHERE r.status = 'active'
    AND ((r.merchant_a_id = _viewer_merchant_id AND r.merchant_b_id = _target_merchant_id)
      OR (r.merchant_b_id = _viewer_merchant_id AND r.merchant_a_id = _target_merchant_id))
  )
$function$
;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$function$
;
CREATE OR REPLACE FUNCTION public.is_customer_connection_member(_connection_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.customer_merchant_connections c
    WHERE c.id = _connection_id
    AND (
      c.customer_user_id = auth.uid()
      OR c.merchant_id = public.current_merchant_id()
    )
  )
$function$
;
CREATE OR REPLACE FUNCTION public.is_os_room_member(_room_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.os_room_members
    WHERE room_id = _room_id
      AND merchant_id = public.current_merchant_id()
  )
$function$
;
CREATE OR REPLACE FUNCTION public.is_relationship_member(_relationship_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.merchant_relationships r
    WHERE r.id = _relationship_id
    AND current_merchant_id() IN (r.merchant_a_id, r.merchant_b_id)
  )
$function$
;
CREATE OR REPLACE FUNCTION public.mark_conversation_read(_relationship_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_relationship_member(_relationship_id) THEN
    RAISE EXCEPTION 'Not a member of this relationship';
  END IF;

  UPDATE public.merchant_messages
  SET read_at = now()
  WHERE relationship_id = _relationship_id
    AND sender_id != auth.uid()
    AND read_at IS NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.merchant_trust_metrics(p_merchant_id text, p_customer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_customer_user_id THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Verify connection exists
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_merchant_connections
    WHERE customer_user_id = p_customer_user_id
      AND merchant_id = p_merchant_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'No active connection';
  END IF;

  SELECT jsonb_build_object(
    'total_trades', COUNT(*),
    'completed_trades', COUNT(*) FILTER (WHERE status = 'completed'),
    'cancelled_trades', COUNT(*) FILTER (WHERE status = 'cancelled'),
    'completion_rate', CASE WHEN COUNT(*) > 0
      THEN ROUND((COUNT(*) FILTER (WHERE status = 'completed'))::numeric / COUNT(*)::numeric * 100, 1)
      ELSE 0 END,
    'avg_response_minutes', COALESCE(
      ROUND(AVG(EXTRACT(EPOCH FROM (confirmed_at - created_at)) / 60) FILTER (WHERE confirmed_at IS NOT NULL), 1),
      0
    )
  ) INTO result
  FROM public.customer_orders
  WHERE merchant_id = p_merchant_id;

  RETURN result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_capital_ledger_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _partner_user_id uuid;
  _initiator_name text;
  _rel record;
BEGIN
  -- Get the relationship to find the counterparty
  SELECT mr.merchant_a_id, mr.merchant_b_id INTO _rel
  FROM merchant_relationships mr
  WHERE mr.id = NEW.relationship_id;

  IF _rel IS NULL THEN RETURN NEW; END IF;

  -- Find the initiator's merchant_id
  DECLARE
    _initiator_merchant text;
    _partner_merchant text;
  BEGIN
    SELECT mp.merchant_id INTO _initiator_merchant
    FROM merchant_profiles mp
    WHERE mp.user_id = NEW.initiated_by
    LIMIT 1;

    -- Partner is the other side
    IF _initiator_merchant = _rel.merchant_a_id THEN
      _partner_merchant := _rel.merchant_b_id;
    ELSE
      _partner_merchant := _rel.merchant_a_id;
    END IF;

    SELECT mp.user_id INTO _partner_user_id
    FROM merchant_profiles mp
    WHERE mp.merchant_id = _partner_merchant
    LIMIT 1;

    SELECT mp.display_name INTO _initiator_name
    FROM merchant_profiles mp
    WHERE mp.merchant_id = _initiator_merchant
    LIMIT 1;
  END;

  IF _partner_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    target_path, target_tab, target_entity_type, target_entity_id,
    actor_id
  ) VALUES (
    _partner_user_id,
    'deal',
    COALESCE(_initiator_name, 'Partner') || ' ' || CASE
      WHEN NEW.type = 'contribution' THEN 'added capital'
      WHEN NEW.type = 'withdrawal' THEN 'withdrew capital'
      WHEN NEW.type = 'reinvestment' THEN 'reinvested profits'
      ELSE 'updated capital pool'
    END,
    NEW.amount || ' ' || NEW.currency || ' — Pool balance: ' || NEW.pool_balance_after,
    '/merchants', 'capital', 'capital_ledger', NEW.id::text,
    NEW.initiated_by
  );

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_cash_custody_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _custodian_user_id uuid;
  _requester_name text;
BEGIN
  -- Resolve custodian user id
  IF NEW.custodian_user_id IS NOT NULL THEN
    _custodian_user_id := NEW.custodian_user_id;
  ELSE
    SELECT mp.user_id INTO _custodian_user_id
    FROM merchant_profiles mp
    WHERE mp.merchant_id = NEW.custodian_merchant_id
    LIMIT 1;
  END IF;

  IF _custodian_user_id IS NULL THEN RETURN NEW; END IF;
  -- Suppress self-notification
  IF _custodian_user_id = COALESCE(NEW.requester_user_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN NEW;
  END IF;

  -- Requester name
  SELECT mp.display_name INTO _requester_name
  FROM merchant_profiles mp
  WHERE mp.merchant_id = NEW.requester_merchant_id
  LIMIT 1;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    target_path, target_entity_type, target_entity_id,
    actor_id
  ) VALUES (
    _custodian_user_id,
    'deal',
    COALESCE(_requester_name, 'A merchant') || ' requested cash custody',
    NEW.amount || ' ' || NEW.currency || CASE WHEN NEW.note IS NOT NULL THEN ' — ' || LEFT(NEW.note, 50) ELSE '' END,
    '/stock', 'cash_custody', NEW.id::text,
    NEW.requester_user_id
  );

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_customer_on_order_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _merchant_name text;
  _title text;
  _body text;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT display_name INTO _merchant_name
  FROM merchant_profiles
  WHERE merchant_id = NEW.merchant_id
  LIMIT 1;

  _title := CASE NEW.status
    WHEN 'confirmed' THEN 'Order Confirmed'
    WHEN 'completed' THEN 'Order Completed'
    WHEN 'cancelled' THEN 'Order Cancelled'
    WHEN 'awaiting_payment' THEN 'Payment Requested'
    WHEN 'payment_sent' THEN 'Payment Noted'
    ELSE 'Order Updated'
  END;

  _body := COALESCE(_merchant_name, 'Merchant') || ' updated your ' || NEW.order_type || ' order to: ' || NEW.status;

  INSERT INTO notifications (
    user_id, title, body, category,
    target_path, target_focus,
    target_entity_type, target_entity_id,
    actor_id, entity_type, entity_id
  )
  VALUES (
    NEW.customer_user_id, _title, _body, 'order',
    '/c/orders', 'focusOrderId',
    'customer_order', NEW.id::text,
    NULL,
    'customer_order', NEW.id::text
  );

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_customer_order_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _merchant_user_id uuid;
  _customer_name text;
BEGIN
  -- Get the merchant's user_id
  SELECT mp.user_id INTO _merchant_user_id
  FROM merchant_profiles mp
  WHERE mp.merchant_id = NEW.merchant_id
  LIMIT 1;

  IF _merchant_user_id IS NULL OR _merchant_user_id = NEW.customer_user_id THEN
    RETURN NEW;
  END IF;

  -- Get customer display name
  SELECT cp.display_name INTO _customer_name
  FROM customer_profiles cp
  WHERE cp.user_id = NEW.customer_user_id
  LIMIT 1;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    target_path, target_tab, target_entity_type, target_entity_id,
    actor_id
  ) VALUES (
    _merchant_user_id,
    'order',
    COALESCE(_customer_name, 'A customer') || ' placed a ' || NEW.order_type || ' order',
    NEW.amount || ' ' || NEW.currency,
    '/merchants', 'customer-orders', 'customer_order', NEW.id::text,
    NEW.customer_user_id
  );

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_merchant_deal_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rel RECORD;
  _creator_name TEXT;
  _partner_merchant_id TEXT;
  _partner_user_id UUID;
  _creator_user_id UUID;
  _title TEXT;
  _body TEXT;
  _actor_id UUID;
  _recipient_tab TEXT;
BEGIN
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships
  WHERE id = NEW.relationship_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT display_name INTO _creator_name
  FROM public.merchant_profiles
  WHERE user_id = NEW.created_by;

  _creator_name := COALESCE(_creator_name, 'A partner');

  IF EXISTS (SELECT 1 FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_a_id AND user_id = NEW.created_by) THEN
    _partner_merchant_id := _rel.merchant_b_id;
  ELSE
    _partner_merchant_id := _rel.merchant_a_id;
  END IF;

  SELECT user_id INTO _partner_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = _partner_merchant_id;

  IF _partner_user_id IS NULL THEN RETURN NEW; END IF;

  -- INSERT: new deal created → notify the partner (NOT the creator)
  IF TG_OP = 'INSERT' THEN
    _title := _creator_name || ' sent you a new deal';
    _body := NEW.title || ' — ' || NEW.amount || ' ' || NEW.currency;
    _actor_id := NEW.created_by;
    -- Partner receives this as incoming
    _recipient_tab := 'incoming';

    INSERT INTO public.notifications (
      user_id, title, body, category,
      actor_id, target_path, target_tab, target_focus, target_entity_type, target_entity_id,
      entity_type, entity_id
    )
    VALUES (
      _partner_user_id, _title, _body, 'deal',
      _actor_id, '/trading/orders', _recipient_tab, 'focusDealId', 'deal', NEW.id::text,
      'deal', NEW.id::text
    );

  -- UPDATE: status changed → notify both parties EXCEPT the one who changed it
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    _title := 'Deal "' || NEW.title || '" ' || NEW.status;
    _body := 'Status changed from ' || OLD.status || ' to ' || NEW.status;
    -- We don't know exactly who triggered the update, so we use auth.uid() as actor
    _actor_id := auth.uid();

    -- Notify the deal creator if they are NOT the actor
    IF NEW.created_by IS DISTINCT FROM _actor_id THEN
      INSERT INTO public.notifications (
        user_id, title, body, category,
        actor_id, target_path, target_tab, target_focus, target_entity_type, target_entity_id,
        entity_type, entity_id
      )
      VALUES (
        NEW.created_by, _title, _body, 'deal',
        _actor_id, '/trading/orders', 'outgoing', 'focusDealId', 'deal', NEW.id::text,
        'deal', NEW.id::text
      );
    END IF;

    -- Notify the partner if they are NOT the actor
    IF _partner_user_id IS DISTINCT FROM _actor_id THEN
      INSERT INTO public.notifications (
        user_id, title, body, category,
        actor_id, target_path, target_tab, target_focus, target_entity_type, target_entity_id,
        entity_type, entity_id
      )
      VALUES (
        _partner_user_id, _title, _body, 'deal',
        _actor_id, '/trading/orders', 'incoming', 'focusDealId', 'deal', NEW.id::text,
        'deal', NEW.id::text
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_merchant_on_customer_connection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _merchant_user_id uuid;
  _customer_name text;
BEGIN
  SELECT user_id INTO _merchant_user_id
  FROM merchant_profiles
  WHERE merchant_id = NEW.merchant_id
  LIMIT 1;

  IF _merchant_user_id IS NULL THEN RETURN NEW; END IF;

  SELECT display_name INTO _customer_name
  FROM customer_profiles
  WHERE user_id = NEW.customer_user_id
  LIMIT 1;

  INSERT INTO notifications (
    user_id, title, body, category,
    target_path, target_tab, target_focus,
    target_entity_type, target_entity_id,
    actor_id, entity_type, entity_id
  )
  VALUES (
    _merchant_user_id,
    'New Client Request',
    COALESCE(_customer_name, 'A customer') || ' wants to connect with you',
    'customer',
    '/merchants', 'clients', 'focusConnectionId',
    'customer_connection', NEW.id::text,
    NEW.customer_user_id,
    'customer_connection', NEW.id::text
  );

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_merchant_on_customer_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _merchant_user_id uuid;
  _customer_name text;
BEGIN
  SELECT user_id INTO _merchant_user_id
  FROM merchant_profiles
  WHERE merchant_id = NEW.merchant_id
  LIMIT 1;

  IF _merchant_user_id IS NULL THEN RETURN NEW; END IF;

  SELECT display_name INTO _customer_name
  FROM customer_profiles
  WHERE user_id = NEW.customer_user_id
  LIMIT 1;

  INSERT INTO notifications (user_id, title, body, category, target_path, actor_id, entity_type, entity_id)
  VALUES (
    _merchant_user_id,
    'New Customer Order',
    COALESCE(_customer_name, 'A customer') || ' placed a ' || NEW.order_type || ' order for ' || NEW.amount || ' ' || NEW.currency,
    'customer',
    '/trading/merchants?tab=client-orders',
    NEW.customer_user_id,
    'customer_order',
    NEW.id::text
  );

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_on_capital_transfer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rel RECORD;
  _actor_name TEXT;
  _partner_user_id UUID;
BEGIN
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships WHERE id = NEW.relationship_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT display_name INTO _actor_name
  FROM public.merchant_profiles WHERE user_id = NEW.transferred_by
  LIMIT 1;

  IF _rel.merchant_a_id = (SELECT merchant_id FROM public.merchant_profiles WHERE user_id = NEW.transferred_by LIMIT 1) THEN
    SELECT user_id INTO _partner_user_id FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_b_id LIMIT 1;
  ELSE
    SELECT user_id INTO _partner_user_id FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_a_id LIMIT 1;
  END IF;

  IF _partner_user_id IS NULL OR _partner_user_id = NEW.transferred_by THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    entity_type, entity_id,
    actor_id,
    target_path, target_tab, target_focus,
    target_entity_type, target_entity_id
  ) VALUES (
    _partner_user_id, 'deal',
    COALESCE(_actor_name, 'Partner') || ' transferred ' || NEW.direction || ' capital',
    NEW.amount || ' ' || NEW.currency,
    'capital_transfer', NEW.id::text,
    NEW.transferred_by,
    '/trading/orders', 'transfers', 'focusTransferId',
    'capital_transfer', NEW.id::text
  );

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_on_customer_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _target_user_id uuid;
  _sender_name text;
  _conn record;
BEGIN
  -- Get connection details
  SELECT * INTO _conn
  FROM customer_merchant_connections
  WHERE id = NEW.connection_id
  LIMIT 1;

  IF _conn IS NULL THEN RETURN NEW; END IF;

  IF NEW.sender_role = 'customer' THEN
    -- Notify merchant
    SELECT user_id INTO _target_user_id
    FROM merchant_profiles
    WHERE merchant_id = _conn.merchant_id
    LIMIT 1;
    
    SELECT display_name INTO _sender_name
    FROM customer_profiles
    WHERE user_id = NEW.sender_user_id
    LIMIT 1;
  ELSE
    -- Notify customer
    _target_user_id := _conn.customer_user_id;
    
    SELECT display_name INTO _sender_name
    FROM merchant_profiles
    WHERE merchant_id = _conn.merchant_id
    LIMIT 1;
  END IF;

  IF _target_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO notifications (user_id, title, body, category, target_path, actor_id, entity_type, entity_id)
  VALUES (
    _target_user_id,
    'New Message',
    COALESCE(_sender_name, 'Someone') || ': ' || LEFT(NEW.content, 100),
    'chat',
    CASE WHEN NEW.sender_role = 'customer' THEN '/trading/merchants?tab=clients' ELSE '/c/chat' END,
    NEW.sender_user_id,
    'customer_message',
    NEW.id::text
  );

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_on_invite_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _actor_name TEXT;
  _actor_user_id UUID;
  _notify_user_id UUID;
  _actor_merchant_id TEXT;
  _target_merchant_id TEXT;
  _title TEXT;
  _body TEXT;
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'accepted' THEN
    _actor_merchant_id := NEW.to_merchant_id;
    _target_merchant_id := NEW.from_merchant_id;

    SELECT display_name, user_id INTO _actor_name, _actor_user_id
    FROM public.merchant_profiles WHERE merchant_id = _actor_merchant_id LIMIT 1;

    SELECT user_id INTO _notify_user_id
    FROM public.merchant_profiles WHERE merchant_id = _target_merchant_id LIMIT 1;

    _title := '✅ ' || COALESCE(_actor_name, 'A merchant') || ' accepted your invite';
    _body := 'You are now connected. Start collaborating!';

  ELSIF NEW.status = 'rejected' THEN
    _actor_merchant_id := NEW.to_merchant_id;
    _target_merchant_id := NEW.from_merchant_id;

    SELECT display_name, user_id INTO _actor_name, _actor_user_id
    FROM public.merchant_profiles WHERE merchant_id = _actor_merchant_id LIMIT 1;

    SELECT user_id INTO _notify_user_id
    FROM public.merchant_profiles WHERE merchant_id = _target_merchant_id LIMIT 1;

    _title := '❌ ' || COALESCE(_actor_name, 'A merchant') || ' declined your invite';
    _body := 'Your connection request was not accepted.';

  ELSE
    RETURN NEW;
  END IF;

  IF _notify_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    user_id, title, body, category,
    actor_id, target_path, target_focus,
    target_entity_type, target_entity_id,
    entity_type, entity_id
  )
  VALUES (
    _notify_user_id, _title, _body, 'invite',
    _actor_user_id, '/merchants', 'focusInviteId',
    'invite', NEW.id::text,
    'invite', NEW.id::text
  );

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_on_new_agreement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rel RECORD;
  _creator_merchant_id TEXT;
  _partner_merchant_id TEXT;
  _partner_user_id UUID;
  _creator_name TEXT;
  _title TEXT;
  _body TEXT;
  _agg_type TEXT;
BEGIN
  -- Only fire on INSERT
  IF TG_OP != 'INSERT' THEN RETURN NEW; END IF;

  -- Get the relationship
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships
  WHERE id = NEW.relationship_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Get the creator's merchant_id
  SELECT merchant_id INTO _creator_merchant_id
  FROM public.merchant_profiles
  WHERE user_id = NEW.created_by LIMIT 1;

  -- Determine who the partner is
  IF _creator_merchant_id = _rel.merchant_a_id THEN
    _partner_merchant_id := _rel.merchant_b_id;
  ELSE
    _partner_merchant_id := _rel.merchant_a_id;
  END IF;

  -- Get partner user_id
  SELECT user_id INTO _partner_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = _partner_merchant_id LIMIT 1;

  IF _partner_user_id IS NULL THEN RETURN NEW; END IF;

  -- Get creator display name
  SELECT COALESCE(nickname, display_name, merchant_id) INTO _creator_name
  FROM public.merchant_profiles
  WHERE user_id = NEW.created_by LIMIT 1;

  _agg_type := CASE
    WHEN NEW.agreement_type = 'operator_priority' THEN 'Operator Priority'
    ELSE 'Standard'
  END;

  _title := _creator_name || ' sent you a new agreement';
  _body := _agg_type || ' Profit Share · ' || NEW.settlement_cadence || ' settlement';

  INSERT INTO public.notifications (
    user_id, title, body, category,
    actor_id, target_path, target_entity_type, target_entity_id,
    entity_type, entity_id
  )
  VALUES (
    _partner_user_id, _title, _body, 'agreement',
    NEW.created_by, '/merchants', 'agreement', NEW.id::text,
    'agreement', NEW.id::text
  );

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_on_new_invite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sender_name TEXT;
  _sender_user_id UUID;
  _recipient_user_id UUID;
BEGIN
  SELECT display_name, user_id INTO _sender_name, _sender_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = NEW.from_merchant_id
  LIMIT 1;

  _sender_name := COALESCE(_sender_name, 'A merchant');

  SELECT user_id INTO _recipient_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = NEW.to_merchant_id
  LIMIT 1;

  IF _recipient_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    user_id, title, body, category,
    actor_id, target_path, target_tab, target_focus,
    target_entity_type, target_entity_id,
    entity_type, entity_id
  )
  VALUES (
    _recipient_user_id,
    '🔔 ' || _sender_name || ' sent you an invite',
    COALESCE(NEW.message, 'You have a new connection request'),
    'invite',
    _sender_user_id,
    '/merchants', NULL, 'focusInviteId',
    'invite', NEW.id::text,
    'invite', NEW.id::text
  );

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_on_new_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rel RECORD;
  _sender_merchant_id TEXT;
  _recipient_merchant_id TEXT;
  _recipient_user_id UUID;
  _sender_name TEXT;
BEGIN
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships
  WHERE id = NEW.relationship_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT merchant_id INTO _sender_merchant_id
  FROM public.merchant_profiles
  WHERE user_id = NEW.sender_id LIMIT 1;

  IF _sender_merchant_id = _rel.merchant_a_id THEN
    _recipient_merchant_id := _rel.merchant_b_id;
  ELSE
    _recipient_merchant_id := _rel.merchant_a_id;
  END IF;

  SELECT user_id INTO _recipient_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = _recipient_merchant_id LIMIT 1;

  SELECT COALESCE(nickname, display_name, merchant_id) INTO _sender_name
  FROM public.merchant_profiles
  WHERE user_id = NEW.sender_id LIMIT 1;

  IF _recipient_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body, conversation_id, message_id,
    actor_id, target_path, target_entity_type, target_entity_id
  )
  VALUES (
    _recipient_user_id,
    'message',
    COALESCE(_sender_name, 'Unknown'),
    LEFT(NEW.content, 100),
    NEW.relationship_id,
    NEW.id,
    NEW.sender_id,
    '/chat',
    'message',
    NEW.id::text
  );

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_on_profit_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rel RECORD;
  _actor_name TEXT;
  _partner_user_id UUID;
BEGIN
  IF NEW.relationship_id IS NULL THEN RETURN NEW; END IF;

  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships WHERE id = NEW.relationship_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT display_name INTO _actor_name
  FROM public.merchant_profiles WHERE user_id = NEW.recorded_by
  LIMIT 1;

  IF _rel.merchant_a_id = (SELECT merchant_id FROM public.merchant_profiles WHERE user_id = NEW.recorded_by LIMIT 1) THEN
    SELECT user_id INTO _partner_user_id FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_b_id LIMIT 1;
  ELSE
    SELECT user_id INTO _partner_user_id FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_a_id LIMIT 1;
  END IF;

  IF _partner_user_id IS NULL OR _partner_user_id = NEW.recorded_by THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    entity_type, entity_id,
    actor_id,
    target_path, target_tab, target_focus,
    target_entity_type, target_entity_id
  ) VALUES (
    _partner_user_id, 'deal',
    COALESCE(_actor_name, 'Partner') || ' recorded profit',
    NEW.amount || ' ' || NEW.currency,
    'deal', NEW.deal_id::text,
    NEW.recorded_by,
    '/trading/orders', 'my', 'focusDealId',
    'deal', NEW.deal_id::text
  );

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_on_settlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rel RECORD;
  _settler_name TEXT;
  _partner_user_id UUID;
BEGIN
  -- Get relationship details
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships WHERE id = NEW.relationship_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Get settler's display name
  SELECT display_name INTO _settler_name
  FROM public.merchant_profiles WHERE user_id = NEW.settled_by
  LIMIT 1;

  -- Determine partner user
  IF _rel.merchant_a_id = (SELECT merchant_id FROM public.merchant_profiles WHERE user_id = NEW.settled_by LIMIT 1) THEN
    SELECT user_id INTO _partner_user_id FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_b_id LIMIT 1;
  ELSE
    SELECT user_id INTO _partner_user_id FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_a_id LIMIT 1;
  END IF;

  IF _partner_user_id IS NULL OR _partner_user_id = NEW.settled_by THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    entity_type, entity_id,
    actor_id,
    target_path, target_tab, target_focus,
    target_entity_type, target_entity_id
  ) VALUES (
    _partner_user_id, 'settlement',
    COALESCE(_settler_name, 'Partner') || ' submitted a settlement',
    NEW.amount || ' ' || NEW.currency,
    'settlement', NEW.id::text,
    NEW.settled_by,
    '/trading/orders', 'settlements', 'focusSettlementId',
    'settlement', NEW.id::text
  );

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.os_after_message_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Audit event
  INSERT INTO public.os_audit_events (room_id, actor_merchant_id, event_type, target_type, target_id)
  VALUES (NEW.room_id, NEW.sender_merchant_id, 'message_sent', 'os_message', NEW.id);

  -- Notification dispatch
  PERFORM public.os_send_notification(NEW.room_id, NEW.id, 'normal');

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.os_capture_snapshot(_target_business_object_id uuid, _trigger_event text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _mid TEXT := public.current_merchant_id();
  _bo RECORD;
  _hash text;
BEGIN
  SELECT * INTO _bo FROM public.os_business_objects WHERE id = _target_business_object_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business object not found'; END IF;
  IF NOT public.is_os_room_member(_bo.room_id) THEN RAISE EXCEPTION 'Not a room member'; END IF;

  _hash := md5(_bo.payload::text || _bo.status || now()::text);

  UPDATE public.os_business_objects SET state_snapshot_hash = _hash, updated_at = now()
  WHERE id = _target_business_object_id;

  INSERT INTO public.os_business_objects (room_id, object_type, source_message_id, created_by_merchant_id, state_snapshot_hash, payload, status)
  VALUES (_bo.room_id, 'snapshot', _bo.source_message_id, _mid, _hash,
    jsonb_build_object('snapshot_of', _target_business_object_id, 'trigger', _trigger_event, 'frozen_payload', _bo.payload, 'frozen_status', _bo.status),
    'locked');

  INSERT INTO public.os_audit_events (room_id, actor_merchant_id, event_type, target_type, target_id, metadata)
  VALUES (_bo.room_id, _mid, 'capture_snapshot', 'business_object', _target_business_object_id,
    jsonb_build_object('hash', _hash, 'trigger', _trigger_event));

  RETURN _hash;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.os_convert_message(_message_id uuid, _target_type text, _payload jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _mid TEXT := public.current_merchant_id();
  _msg RECORD;
  _new_id uuid;
BEGIN
  SELECT room_id, content INTO _msg
  FROM public.os_messages WHERE id = _message_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Message not found'; END IF;
  IF NOT public.is_os_room_member(_msg.room_id) THEN RAISE EXCEPTION 'Not a room member'; END IF;

  INSERT INTO public.os_business_objects (room_id, object_type, source_message_id, created_by_merchant_id, payload, status)
  VALUES (_msg.room_id, _target_type, _message_id, _mid, _payload || jsonb_build_object('source_content', _msg.content), 'pending')
  RETURNING id INTO _new_id;

  INSERT INTO public.os_audit_events (room_id, actor_merchant_id, event_type, target_type, target_id, metadata)
  VALUES (_msg.room_id, _mid, 'convert_message', 'business_object', _new_id,
    jsonb_build_object('source_message_id', _message_id, 'target_type', _target_type));

  RETURN _new_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.os_get_unread_counts(_merchant_id text DEFAULT current_merchant_id())
 RETURNS TABLE(room_id uuid, unread_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.room_id, COUNT(*) AS unread_count
  FROM public.os_messages m
  JOIN public.os_room_members rm ON rm.room_id = m.room_id AND rm.merchant_id = _merchant_id
  WHERE m.sender_merchant_id != _merchant_id
    AND m.read_at IS NULL
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.os_room_presence p
        WHERE p.room_id = m.room_id
          AND p.merchant_id = _merchant_id
          AND p.is_focused = true
          AND p.last_seen_at > m.created_at - interval '10 seconds'
      )
    )
  GROUP BY m.room_id;
$function$
;
CREATE OR REPLACE FUNCTION public.os_promote_thread(_room_id uuid, _source_message_ids uuid[], _routing_target text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _mid TEXT := public.current_merchant_id();
  _thread_id uuid;
BEGIN
  IF NOT public.is_os_room_member(_room_id) THEN RAISE EXCEPTION 'Not a room member'; END IF;

  INSERT INTO public.os_threads (room_id, source_message_ids, routing_target, created_by_merchant_id)
  VALUES (_room_id, _source_message_ids, _routing_target, _mid)
  RETURNING id INTO _thread_id;

  UPDATE public.os_messages SET thread_id = _thread_id
  WHERE id = ANY(_source_message_ids) AND room_id = _room_id;

  RETURN _thread_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.os_record_presence(_room_id uuid, _is_focused boolean, _last_read_message_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _mid TEXT := public.current_merchant_id();
BEGIN
  IF NOT public.is_os_room_member(_room_id) THEN
    RAISE EXCEPTION 'Not a member of this room';
  END IF;

  INSERT INTO public.os_room_presence (room_id, merchant_id, is_focused, last_read_message_id, last_seen_at)
  VALUES (_room_id, _mid, _is_focused, _last_read_message_id, now())
  ON CONFLICT (room_id, merchant_id)
  DO UPDATE SET
    is_focused = EXCLUDED.is_focused,
    last_read_message_id = COALESCE(EXCLUDED.last_read_message_id, os_room_presence.last_read_message_id),
    last_seen_at = now();
END;
$function$
;
CREATE OR REPLACE FUNCTION public.os_send_notification(_room_id uuid, _message_id uuid, _urgency text DEFAULT 'normal'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _msg RECORD;
  _sender_name TEXT;
  _sender_user_id UUID;
  _count integer := 0;
  _member RECORD;
  _user_id uuid;
BEGIN
  SELECT sender_merchant_id, content INTO _msg
  FROM public.os_messages WHERE id = _message_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT COALESCE(nickname, display_name, merchant_id) INTO _sender_name
  FROM public.merchant_profiles WHERE merchant_id = _msg.sender_merchant_id LIMIT 1;

  SELECT mp.user_id INTO _sender_user_id
  FROM public.merchant_profiles mp WHERE mp.merchant_id = _msg.sender_merchant_id LIMIT 1;

  FOR _member IN
    SELECT rm.merchant_id FROM public.os_room_members rm
    WHERE rm.room_id = _room_id AND rm.merchant_id != _msg.sender_merchant_id
  LOOP
    SELECT mp.user_id INTO _user_id
    FROM public.merchant_profiles mp WHERE mp.merchant_id = _member.merchant_id LIMIT 1;

    IF _user_id IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id, category, title, body,
        conversation_id, message_id,
        entity_type, entity_id, anchor_id,
        actor_id, target_path, target_focus,
        target_entity_type, target_entity_id
      )
      VALUES (
        _user_id, 'message', COALESCE(_sender_name, 'Unknown'),
        LEFT(_msg.content, 100),
        _room_id, _message_id,
        'os_room', _room_id::text, _message_id::text,
        _sender_user_id, '/chat', 'roomId',
        'os_room', _room_id::text
      );
      _count := _count + 1;
    END IF;
  END LOOP;

  RETURN _count;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.reject_settlement(_settlement_id uuid, _actor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rows_updated    INT;
  _period          RECORD;
  _cap_entry       RECORD;
  _current_pool    DECIMAL;
BEGIN
  UPDATE merchant_settlements
    SET status = 'rejected'
    WHERE id = _settlement_id AND status = 'pending';
  GET DIAGNOSTICS _rows_updated = ROW_COUNT;

  IF _rows_updated = 0 THEN
    RAISE EXCEPTION 'Settlement % not found or already processed', _settlement_id;
  END IF;

  SELECT id, deal_id INTO _period
    FROM settlement_periods
    WHERE settlement_id = _settlement_id
      AND status = 'pending_settlement';

  IF _period.id IS NOT NULL THEN
    UPDATE settlement_periods
      SET status       = 'due',
          resolution   = NULL,
          resolved_by  = NULL,
          resolved_at  = NULL,
          settled_amount = 0,
          settlement_id  = NULL
      WHERE id = _period.id;

    SELECT * INTO _cap_entry
      FROM deal_capital_ledger
      WHERE period_id = _period.id
        AND type = 'payout'
      LIMIT 1;

    IF _cap_entry.id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM deal_capital_ledger
        WHERE original_entry_id = _cap_entry.id AND type = 'reversal'
      ) THEN
        SELECT public.deal_reinvested_pool(_cap_entry.deal_id)
          INTO _current_pool;

        INSERT INTO deal_capital_ledger (
          deal_id, relationship_id, type, amount, currency,
          period_id, initiated_by,
          pool_balance_after,
          original_entry_id,
          note
        ) VALUES (
          _cap_entry.deal_id,
          _cap_entry.relationship_id,
          'reversal',
          _cap_entry.amount,
          _cap_entry.currency,
          _period.id,
          _actor_id,
          _current_pool,
          _cap_entry.id,
          'Reversal: payout rejected for settlement ' || _settlement_id::text
        );
      END IF;
    END IF;
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_limit(real)
 RETURNS real
 LANGUAGE c
 STRICT
AS '$libdir/pg_trgm', $function$set_limit$function$
;
CREATE OR REPLACE FUNCTION public.set_merchant_deal_status(_deal_id uuid, _status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Verify caller is a member of the deal's relationship
  IF NOT EXISTS (
    SELECT 1 FROM public.merchant_deals d
    WHERE d.id = _deal_id
      AND public.is_relationship_member(d.relationship_id)
  ) THEN
    RAISE EXCEPTION 'Access denied: not a member of this deal relationship';
  END IF;

  UPDATE public.merchant_deals
  SET status = _status, updated_at = now()
  WHERE id = _deal_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.show_limit()
 RETURNS real
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$show_limit$function$
;
CREATE OR REPLACE FUNCTION public.show_trgm(text)
 RETURNS text[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$show_trgm$function$
;
CREATE OR REPLACE FUNCTION public.similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity$function$
;
CREATE OR REPLACE FUNCTION public.similarity_dist(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity_dist$function$
;
CREATE OR REPLACE FUNCTION public.similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity_op$function$
;
CREATE OR REPLACE FUNCTION public.strict_word_similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity$function$
;
CREATE OR REPLACE FUNCTION public.strict_word_similarity_commutator_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_commutator_op$function$
;
CREATE OR REPLACE FUNCTION public.strict_word_similarity_dist_commutator_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_dist_commutator_op$function$
;
CREATE OR REPLACE FUNCTION public.strict_word_similarity_dist_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_dist_op$function$
;
CREATE OR REPLACE FUNCTION public.strict_word_similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_op$function$
;
CREATE OR REPLACE FUNCTION public.update_otc_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_capital_ledger_type()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.type NOT IN ('reinvest', 'withdrawal', 'payout', 'reversal') THEN
    RAISE EXCEPTION 'Invalid capital ledger type: %', NEW.type;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_discoverability()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.discoverability NOT IN ('public', 'merchant_id_only', 'hidden') THEN
    RAISE EXCEPTION 'Invalid discoverability value: %', NEW.discoverability;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_profit_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid profit status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_psa_ratios()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.agreement_type = 'operator_priority' THEN
    -- operator_priority agreements use 0/0 ratios; skip ratio validation
    RETURN NEW;
  END IF;

  -- Standard agreements: ratios must be > 0, < 100, and sum to 100
  IF NEW.partner_ratio <= 0 OR NEW.partner_ratio >= 100 THEN
    RAISE EXCEPTION 'partner_ratio must be between 0 and 100 (exclusive) for standard agreements';
  END IF;
  IF NEW.merchant_ratio <= 0 OR NEW.merchant_ratio >= 100 THEN
    RAISE EXCEPTION 'merchant_ratio must be between 0 and 100 (exclusive) for standard agreements';
  END IF;
  IF NEW.partner_ratio + NEW.merchant_ratio != 100 THEN
    RAISE EXCEPTION 'partner_ratio + merchant_ratio must equal 100 for standard agreements';
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_psa_settlement_way()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.settlement_way IS NOT NULL AND NEW.settlement_way NOT IN ('reinvest', 'withdraw') THEN
    RAISE EXCEPTION 'Invalid settlement_way: %', NEW.settlement_way;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_psa_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status NOT IN ('pending', 'approved', 'rejected', 'expired') THEN
    RAISE EXCEPTION 'Invalid agreement status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_settlement_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.decision NOT IN ('pending', 'reinvest', 'withdraw') THEN
    RAISE EXCEPTION 'Invalid settlement decision: %', NEW.decision;
  END IF;
  IF NEW.default_behavior NOT IN ('reinvest', 'withdraw') THEN
    RAISE EXCEPTION 'Invalid default behavior: %', NEW.default_behavior;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_settlement_period_cadence()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.cadence NOT IN ('per_order', 'weekly', 'monthly') THEN
    RAISE EXCEPTION 'Invalid cadence: %', NEW.cadence;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_settlement_period_resolution()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.resolution IS NOT NULL AND NEW.resolution NOT IN ('payout', 'reinvest') THEN
    RAISE EXCEPTION 'Invalid resolution: %', NEW.resolution;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_settlement_period_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status NOT IN ('pending', 'due', 'overdue', 'settled', 'disputed') THEN
    RAISE EXCEPTION 'Invalid settlement period status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_settlement_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid settlement status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.word_similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity$function$
;
CREATE OR REPLACE FUNCTION public.word_similarity_commutator_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_commutator_op$function$
;
CREATE OR REPLACE FUNCTION public.word_similarity_dist_commutator_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_dist_commutator_op$function$
;
CREATE OR REPLACE FUNCTION public.word_similarity_dist_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_dist_op$function$
;
CREATE OR REPLACE FUNCTION public.word_similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_op$function$
;

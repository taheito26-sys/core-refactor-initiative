--
-- PostgreSQL database dump
--

\restrict ggXi6RLofO1ClW70VYf5R6vN2XLf7zl0QlvuY24VMATuqNA5PM8dWqTfnwzKz8E

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.9

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'moderator',
    'user'
);


--
-- Name: chat_call_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.chat_call_status AS ENUM (
    'ringing',
    'active',
    'ended',
    'missed',
    'declined',
    'failed',
    'no_answer'
);


--
-- Name: chat_encryption_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.chat_encryption_mode AS ENUM (
    'none',
    'tls_only',
    'server_e2ee',
    'client_e2ee'
);


--
-- Name: chat_member_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.chat_member_role AS ENUM (
    'owner',
    'admin',
    'member',
    'guest'
);


--
-- Name: chat_message_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.chat_message_type AS ENUM (
    'text',
    'voice_note',
    'image',
    'file',
    'system',
    'call_summary',
    'order_card',
    'payment_card',
    'reaction_burst'
);


--
-- Name: chat_room_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.chat_room_type AS ENUM (
    'merchant_private',
    'merchant_client',
    'merchant_collab'
);


--
-- Name: admin_analytics_overview(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_analytics_overview(_months integer DEFAULT 12) RETURNS TABLE(month text, new_users bigint, deal_count bigint, deal_volume numeric, settlement_amount numeric, profit_amount numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: admin_broadcast_notification(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_broadcast_notification(_title text, _body text, _category text DEFAULT 'system'::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: admin_correct_deal(uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_correct_deal(_deal_id uuid, _updates jsonb, _reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: admin_correct_tracker(uuid, text, text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_correct_tracker(_target_user_id uuid, _entity_type text, _entity_id text, _updates jsonb, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
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


--
-- Name: admin_merchant_performance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_merchant_performance() RETURNS TABLE(merchant_id text, display_name text, nickname text, deal_count bigint, total_volume numeric, total_profit numeric, settlement_count bigint, avg_deal_size numeric, status text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: admin_revenue_breakdown(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_revenue_breakdown() RETURNS TABLE(currency text, deal_type text, deal_count bigint, total_volume numeric, total_profit numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: admin_system_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_system_stats() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: admin_void_deal(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_void_deal(_deal_id uuid, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: admin_void_tracker_entity(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_void_tracker_entity(_target_user_id uuid, _entity_type text, _entity_id text, _reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
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


--
-- Name: approve_settlement(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_settlement(_settlement_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: auto_expire_agreements(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_expire_agreements() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.expires_at IS NOT NULL AND NEW.expires_at < NOW() AND NEW.status = 'approved' THEN
    NEW.status := 'expired';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: chat_add_reaction(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_add_reaction(_message_id uuid, _emoji text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _me UUID := auth.uid(); _room_id UUID;
BEGIN
  SELECT room_id INTO _room_id FROM public.chat_messages WHERE id = _message_id;
  IF NOT public.fn_is_chat_member(_room_id, _me) THEN RAISE EXCEPTION 'Not a member'; END IF;
  INSERT INTO public.chat_message_reactions (message_id, room_id, user_id, emoji) VALUES (_message_id, _room_id, _me, _emoji) ON CONFLICT (message_id, user_id, emoji) DO NOTHING;
END; $$;


--
-- Name: chat_answer_call(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_answer_call(_call_id uuid, _sdp_answer text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _me UUID := auth.uid();
BEGIN
  UPDATE public.chat_call_participants SET status = 'connected', joined_at = now(), sdp_answer = _sdp_answer WHERE call_id = _call_id AND user_id = _me;
  UPDATE public.chat_calls SET status = 'active', connected_at = now() WHERE id = _call_id AND status = 'ringing';
END; $$;


--
-- Name: chat_cancel_market_offer(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_cancel_market_offer(_offer_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _me UUID := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE public.market_offers
  SET status = 'cancelled', updated_at = now()
  WHERE id = _offer_id AND user_id = _me AND status = 'active';

  IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found or not cancellable'; END IF;
END;
$$;


--
-- Name: chat_create_attachment(uuid, uuid, text, text, bigint, text, text, text, integer, integer, integer, jsonb, text, boolean, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_create_attachment(_room_id uuid, _message_id uuid, _storage_path text, _file_name text, _file_size bigint, _mime_type text, _cdn_url text DEFAULT NULL::text, _thumbnail_path text DEFAULT NULL::text, _duration_ms integer DEFAULT NULL::integer, _width integer DEFAULT NULL::integer, _height integer DEFAULT NULL::integer, _waveform jsonb DEFAULT NULL::jsonb, _checksum_sha256 text DEFAULT NULL::text, _is_encrypted boolean DEFAULT false, _iv text DEFAULT NULL::text, _auth_tag text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_create_market_offer(text, numeric, numeric, numeric, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_create_market_offer(_offer_type text, _rate numeric, _min_amount numeric DEFAULT 0, _max_amount numeric DEFAULT 0, _currency_pair text DEFAULT 'USDT/QAR'::text, _note text DEFAULT NULL::text, _expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_create_merchant_client_room(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_create_merchant_client_room(_customer_user_id uuid, _room_name text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
END; $$;


--
-- Name: chat_delete_message(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_delete_message(_message_id uuid, _for_everyone boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
END; $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    type public.chat_message_type DEFAULT 'text'::public.chat_message_type NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    reply_to_id uuid,
    forwarded_from_id uuid,
    client_nonce text,
    is_edited boolean DEFAULT false NOT NULL,
    edited_at timestamp with time zone,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    deleted_for_sender boolean DEFAULT false NOT NULL,
    expires_at timestamp with time zone,
    view_once boolean DEFAULT false NOT NULL,
    viewed_by uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    watermark_text text,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(content, ''::text))) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.chat_messages REPLICA IDENTITY FULL;


--
-- Name: chat_edit_message(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_edit_message(_message_id uuid, _new_content text) RETURNS SETOF public.chat_messages
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _me UUID := auth.uid(); _msg public.chat_messages;
BEGIN
  SELECT * INTO _msg FROM public.chat_messages WHERE id = _message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message not found'; END IF;
  IF _msg.sender_id <> _me THEN RAISE EXCEPTION 'Cannot edit'; END IF;
  IF _msg.view_once THEN RAISE EXCEPTION 'Cannot edit one-time-view'; END IF;
  UPDATE public.chat_messages SET content = _new_content, is_edited = TRUE, edited_at = now(), updated_at = now() WHERE id = _message_id RETURNING * INTO _msg;
  RETURN NEXT _msg;
END; $$;


--
-- Name: chat_end_call(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_end_call(_call_id uuid, _end_reason text DEFAULT 'ended'::text, _signaling_channel text DEFAULT 'supabase'::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_export_room_transcript(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_export_room_transcript(_room_id uuid) RETURNS TABLE(sender_name text, content text, sent_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_forward_message(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_forward_message(_message_id uuid, _target_room_id uuid, _client_nonce text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_get_or_create_collab_room(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_get_or_create_collab_room(_name text DEFAULT 'Qatar P2P Market'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_get_or_create_direct_room(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_get_or_create_direct_room(_other_user_id uuid, _room_name text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
END; $$;


--
-- Name: chat_get_privacy_settings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_get_privacy_settings() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_get_qatar_market_room(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_get_qatar_market_room() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT id FROM public.chat_rooms
  WHERE type = 'merchant_collab'
  ORDER BY created_at ASC LIMIT 1;
$$;


--
-- Name: chat_get_room_members(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_get_room_members(_room_id uuid) RETURNS TABLE(id uuid, room_id uuid, user_id uuid, role public.chat_member_role, joined_at timestamp with time zone, last_read_at timestamp with time zone, last_read_message_id uuid, is_muted boolean, is_pinned boolean, is_archived boolean, notification_level text, display_name text, avatar_url text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_get_rooms(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_get_rooms() RETURNS TABLE(room_id uuid, room_type public.chat_room_type, name text, avatar_url text, is_direct boolean, last_message_at timestamp with time zone, last_message_preview text, unread_count bigint, is_muted boolean, is_pinned boolean, is_archived boolean, member_count bigint, other_user_id uuid, other_user_metadata jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_get_rooms_v2(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_get_rooms_v2() RETURNS TABLE(room_id uuid, room_name text, room_type text, is_direct boolean, last_message_at timestamp with time zone, last_message_preview text, unread_count bigint, my_role text, is_muted boolean, is_pinned boolean, is_archived boolean, room_policy jsonb, room_avatar text, other_user_metadata jsonb)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_initiate_call(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_initiate_call(_room_id uuid, _call_id uuid DEFAULT NULL::uuid, _ice_config jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_is_allowed_mime(text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_is_allowed_mime(_mime_type text, _allowed_mime_types text[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT
    _allowed_mime_types IS NULL                          -- NULL = allow all
    OR _mime_type = ANY(_allowed_mime_types)             -- exact match
    OR (split_part(_mime_type, '/', 1) || '/*') = ANY(_allowed_mime_types)  -- wildcard
$$;


--
-- Name: chat_link_attachment_to_message(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_link_attachment_to_message(_attachment_id uuid, _message_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_mark_room_read(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_mark_room_read(_room_id uuid, _up_to_message_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_mark_viewed(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_mark_viewed(_message_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _me UUID := auth.uid();
BEGIN
  UPDATE public.chat_messages SET viewed_by = array_append(CASE WHEN _me = ANY(viewed_by) THEN viewed_by ELSE viewed_by END, _me)
  WHERE id = _message_id AND view_once = TRUE AND NOT (_me = ANY(viewed_by));
END; $$;


--
-- Name: chat_push_ice_candidate(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_push_ice_candidate(_call_id uuid, _candidate jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _me UUID := auth.uid();
BEGIN
  UPDATE public.chat_call_participants
  SET ice_candidates = ice_candidates || jsonb_build_array(_candidate)
  WHERE call_id = _call_id
    AND user_id != _me;  -- push to the OTHER participant(s)
END;
$$;


--
-- Name: chat_remove_reaction(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_remove_reaction(_message_id uuid, _emoji text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN DELETE FROM public.chat_message_reactions WHERE message_id = _message_id AND user_id = auth.uid() AND emoji = _emoji; END; $$;


--
-- Name: chat_run_expiry_cleanup(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_run_expiry_cleanup() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_search_messages(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_search_messages(_room_id uuid, _query text, _limit integer DEFAULT 40) RETURNS SETOF public.chat_messages
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT m.* FROM public.chat_messages m WHERE m.room_id = _room_id AND m.is_deleted = FALSE AND public.fn_is_chat_member(_room_id, auth.uid()) AND m.search_vector @@ plainto_tsquery('english', _query)
  ORDER BY ts_rank(m.search_vector, plainto_tsquery('english', _query)) DESC, m.created_at DESC LIMIT _limit;
$$;


--
-- Name: chat_send_message(uuid, text, text, jsonb, uuid, text, timestamp with time zone, boolean, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_send_message(_room_id uuid, _content text, _type text DEFAULT 'text'::text, _metadata jsonb DEFAULT '{}'::jsonb, _reply_to_id uuid DEFAULT NULL::uuid, _client_nonce text DEFAULT NULL::text, _expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _view_once boolean DEFAULT false, _watermark_text text DEFAULT NULL::text, _attachment_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.chat_messages
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_set_presence(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_set_presence(_status text DEFAULT 'online'::text, _device_info jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_set_typing(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_set_typing(_room_id uuid, _is_typing boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_update_privacy_settings(boolean, boolean, boolean, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_update_privacy_settings(_invisible_mode boolean DEFAULT NULL::boolean, _hide_typing boolean DEFAULT NULL::boolean, _hide_read_receipts boolean DEFAULT NULL::boolean, _hide_last_seen boolean DEFAULT NULL::boolean, _online_visibility text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_update_privacy_settings(boolean, boolean, boolean, boolean, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_update_privacy_settings(_hide_read_receipts boolean DEFAULT NULL::boolean, _hide_last_seen boolean DEFAULT NULL::boolean, _hide_typing boolean DEFAULT NULL::boolean, _invisible_mode boolean DEFAULT NULL::boolean, _online_visibility text DEFAULT NULL::text, _notification_preview text DEFAULT NULL::text, _show_sender_in_notification boolean DEFAULT NULL::boolean, _anonymous_mode boolean DEFAULT NULL::boolean, _screenshot_protection boolean DEFAULT NULL::boolean, _watermark_enabled boolean DEFAULT NULL::boolean, _forwarding_disabled boolean DEFAULT NULL::boolean, _copy_disabled boolean DEFAULT NULL::boolean, _export_disabled boolean DEFAULT NULL::boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_update_room_policy(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_update_room_policy(_room_id uuid, _updates jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: current_merchant_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_merchant_id() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT merchant_id FROM public.merchant_profiles WHERE user_id = auth.uid() LIMIT 1
$$;


--
-- Name: customer_wallet_summary(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.customer_wallet_summary(p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: deal_reinvested_pool(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deal_reinvested_pool(_deal_id uuid) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT pool_balance_after 
     FROM public.deal_capital_ledger 
     WHERE deal_id = _deal_id 
     ORDER BY created_at DESC 
     LIMIT 1),
    0
  )
$$;


--
-- Name: fn_auto_pause_listing_on_trade_complete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_auto_pause_listing_on_trade_complete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.listing_id IS NOT NULL THEN
    UPDATE public.otc_listings
      SET status = 'paused', updated_at = now()
      WHERE id = NEW.listing_id AND status = 'active';
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: fn_auto_release_escrow(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_auto_release_escrow() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_chat_add_reaction(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_chat_add_reaction(_room_id uuid, _message_id uuid, _reaction text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_chat_delete_message(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_chat_delete_message(p_room_id uuid, p_message_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_chat_deliver_receipts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_chat_deliver_receipts() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.chat_message_receipts (message_id, room_id, user_id, status, updated_at)
  SELECT NEW.id, NEW.room_id, m.user_id, 'delivered', now() FROM public.chat_room_members m
  WHERE m.room_id = NEW.room_id AND m.user_id <> NEW.sender_id AND m.removed_at IS NULL
  ON CONFLICT (message_id, user_id) DO NOTHING;
  RETURN NEW;
END; $$;


--
-- Name: fn_chat_expire_messages(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_chat_expire_messages() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN RETURN public.chat_run_expiry_cleanup(); END;
$$;


--
-- Name: fn_chat_mark_read(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_chat_mark_read(_room_id uuid, _message_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_chat_member_role(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_chat_member_role(p_room_id uuid, p_user_id uuid) RETURNS public.chat_member_role
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT role FROM public.chat_room_members WHERE room_id = p_room_id AND user_id = p_user_id AND removed_at IS NULL LIMIT 1;
$$;


--
-- Name: fn_chat_notify_new_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_chat_notify_new_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
END; $$;


--
-- Name: fn_chat_pin_message(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_chat_pin_message(p_room_id uuid, p_message_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_chat_remove_reaction(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_chat_remove_reaction(_room_id uuid, _message_id uuid, _reaction text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  DELETE FROM public.message_reactions
  WHERE message_id = _message_id
    AND user_id    = public.current_merchant_id()
    AND reaction   = _reaction;

  RETURN true;
END;
$$;


--
-- Name: fn_chat_send_message(uuid, text, jsonb, text, text, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_chat_send_message(_room_id uuid, _body text, _body_json jsonb DEFAULT '{}'::jsonb, _message_type text DEFAULT 'text'::text, _client_nonce text DEFAULT NULL::text, _reply_to_message_id uuid DEFAULT NULL::uuid, _expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_chat_unpin_message(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_chat_unpin_message(p_room_id uuid, p_message_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_finalize_settlement_decisions(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_finalize_settlement_decisions(p_period_id uuid, p_agreement_id uuid, p_agreement_snapshot jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_get_dashboard_stats(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_dashboard_stats(p_merchant_id text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: chat_privacy_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_privacy_settings (
    user_id uuid NOT NULL,
    invisible_mode boolean DEFAULT false NOT NULL,
    hide_typing boolean DEFAULT false NOT NULL,
    hide_read_receipts boolean DEFAULT false NOT NULL,
    hide_last_seen boolean DEFAULT false NOT NULL,
    online_visibility text DEFAULT 'everyone'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notification_preview text DEFAULT 'full'::text NOT NULL,
    show_sender_in_notification boolean DEFAULT true NOT NULL,
    anonymous_mode boolean DEFAULT false NOT NULL,
    screenshot_protection boolean DEFAULT false NOT NULL,
    watermark_enabled boolean DEFAULT false NOT NULL,
    forwarding_disabled boolean DEFAULT false NOT NULL,
    copy_disabled boolean DEFAULT false NOT NULL,
    export_disabled boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_privacy_settings_online_visibility_check CHECK ((online_visibility = ANY (ARRAY['everyone'::text, 'contacts'::text, 'nobody'::text])))
);


--
-- Name: fn_get_user_privacy(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_user_privacy(p_user_id uuid) RETURNS public.chat_privacy_settings
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT * FROM public.chat_privacy_settings WHERE user_id = p_user_id LIMIT 1;
$$;


--
-- Name: fn_is_chat_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_is_chat_member(p_room_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.chat_room_members WHERE room_id = p_room_id AND user_id = p_user_id AND removed_at IS NULL);
$$;


--
-- Name: fn_is_presence_visible(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_is_presence_visible(_target_user_id uuid, _viewer_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_notify_capital_transfer(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_notify_capital_transfer() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_notify_cash_custody_request(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_notify_cash_custody_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_notify_customer_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_notify_customer_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_notify_customer_order(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_notify_customer_order() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_notify_otc_dispute(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_notify_otc_dispute() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_notify_otc_escrow_deposit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_notify_otc_escrow_deposit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_notify_otc_trade(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_notify_otc_trade() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_notify_otc_trade_offer(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_notify_otc_trade_offer() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_notify_otc_trade_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_notify_otc_trade_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_notify_profit_record(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_notify_profit_record() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_notify_settlement(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_notify_settlement() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_os_messages_notify_counterparty(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_os_messages_notify_counterparty() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_otc_lifecycle_cleanup(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_otc_lifecycle_cleanup() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_refresh_otc_rating(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_refresh_otc_rating() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_refresh_otc_reputation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_refresh_otc_reputation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_refresh_verification_tier(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_refresh_verification_tier() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: fn_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;


--
-- Name: fn_sync_escrow_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_escrow_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: get_unread_counts(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_unread_counts(_user_id uuid DEFAULT auth.uid()) RETURNS TABLE(relationship_id uuid, unread_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, status)
  VALUES (NEW.id, COALESCE(NEW.email, ''), 'pending');
  RETURN NEW;
END;
$$;


--
-- Name: has_relationship_with(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_relationship_with(_viewer_merchant_id text, _target_merchant_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.merchant_relationships r
    WHERE r.status = 'active'
    AND ((r.merchant_a_id = _viewer_merchant_id AND r.merchant_b_id = _target_merchant_id)
      OR (r.merchant_b_id = _viewer_merchant_id AND r.merchant_a_id = _target_merchant_id))
  )
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;


--
-- Name: is_customer_connection_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_customer_connection_member(_connection_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.customer_merchant_connections c
    WHERE c.id = _connection_id
    AND (
      c.customer_user_id = auth.uid()
      OR c.merchant_id = public.current_merchant_id()
    )
  )
$$;


--
-- Name: is_os_room_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_os_room_member(_room_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.os_room_members
    WHERE room_id = _room_id
      AND merchant_id = public.current_merchant_id()
  )
$$;


--
-- Name: is_relationship_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_relationship_member(_relationship_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.merchant_relationships r
    WHERE r.id = _relationship_id
    AND current_merchant_id() IN (r.merchant_a_id, r.merchant_b_id)
  )
$$;


--
-- Name: mark_conversation_read(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_conversation_read(_relationship_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: merchant_trust_metrics(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merchant_trust_metrics(p_merchant_id text, p_customer_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: notify_capital_ledger_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_capital_ledger_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: notify_cash_custody_request(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_cash_custody_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: notify_customer_on_order_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_customer_on_order_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: notify_customer_order_created(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_customer_order_created() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: notify_merchant_deal_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_merchant_deal_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: notify_merchant_on_customer_connection(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_merchant_on_customer_connection() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: notify_merchant_on_customer_order(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_merchant_on_customer_order() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: notify_on_capital_transfer(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_on_capital_transfer() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: notify_on_customer_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_on_customer_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: notify_on_invite_status_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_on_invite_status_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: notify_on_new_agreement(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_on_new_agreement() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: notify_on_new_invite(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_on_new_invite() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: notify_on_new_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_on_new_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: notify_on_profit_record(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_on_profit_record() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: notify_on_settlement(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_on_settlement() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: os_after_message_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.os_after_message_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Audit event
  INSERT INTO public.os_audit_events (room_id, actor_merchant_id, event_type, target_type, target_id)
  VALUES (NEW.room_id, NEW.sender_merchant_id, 'message_sent', 'os_message', NEW.id);

  -- Notification dispatch
  PERFORM public.os_send_notification(NEW.room_id, NEW.id, 'normal');

  RETURN NEW;
END;
$$;


--
-- Name: os_capture_snapshot(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.os_capture_snapshot(_target_business_object_id uuid, _trigger_event text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: os_convert_message(uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.os_convert_message(_message_id uuid, _target_type text, _payload jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: os_get_unread_counts(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.os_get_unread_counts(_merchant_id text DEFAULT public.current_merchant_id()) RETURNS TABLE(room_id uuid, unread_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: os_promote_thread(uuid, uuid[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.os_promote_thread(_room_id uuid, _source_message_ids uuid[], _routing_target text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: os_record_presence(uuid, boolean, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.os_record_presence(_room_id uuid, _is_focused boolean, _last_read_message_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: os_send_notification(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.os_send_notification(_room_id uuid, _message_id uuid, _urgency text DEFAULT 'normal'::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: reject_settlement(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_settlement(_settlement_id uuid, _actor_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: set_merchant_deal_status(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_merchant_deal_status(_deal_id uuid, _status text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: update_otc_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_otc_updated_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: validate_capital_ledger_type(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_capital_ledger_type() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.type NOT IN ('reinvest', 'withdrawal', 'payout', 'reversal') THEN
    RAISE EXCEPTION 'Invalid capital ledger type: %', NEW.type;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: validate_discoverability(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_discoverability() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.discoverability NOT IN ('public', 'merchant_id_only', 'hidden') THEN
    RAISE EXCEPTION 'Invalid discoverability value: %', NEW.discoverability;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: validate_profit_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_profit_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid profit status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: validate_psa_ratios(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_psa_ratios() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: validate_psa_settlement_way(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_psa_settlement_way() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.settlement_way IS NOT NULL AND NEW.settlement_way NOT IN ('reinvest', 'withdraw') THEN
    RAISE EXCEPTION 'Invalid settlement_way: %', NEW.settlement_way;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: validate_psa_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_psa_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'approved', 'rejected', 'expired') THEN
    RAISE EXCEPTION 'Invalid agreement status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: validate_settlement_decision(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_settlement_decision() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.decision NOT IN ('pending', 'reinvest', 'withdraw') THEN
    RAISE EXCEPTION 'Invalid settlement decision: %', NEW.decision;
  END IF;
  IF NEW.default_behavior NOT IN ('reinvest', 'withdraw') THEN
    RAISE EXCEPTION 'Invalid default behavior: %', NEW.default_behavior;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: validate_settlement_period_cadence(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_settlement_period_cadence() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.cadence NOT IN ('per_order', 'weekly', 'monthly') THEN
    RAISE EXCEPTION 'Invalid cadence: %', NEW.cadence;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: validate_settlement_period_resolution(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_settlement_period_resolution() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.resolution IS NOT NULL AND NEW.resolution NOT IN ('payout', 'reinvest') THEN
    RAISE EXCEPTION 'Invalid resolution: %', NEW.resolution;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: validate_settlement_period_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_settlement_period_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'due', 'overdue', 'settled', 'disputed') THEN
    RAISE EXCEPTION 'Invalid settlement period status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: validate_settlement_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_settlement_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid settlement status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: admin_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_user_id uuid NOT NULL,
    action text NOT NULL,
    target_type text DEFAULT 'user'::text NOT NULL,
    target_id uuid,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: balance_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.balance_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    relationship_id uuid NOT NULL,
    merchant_id text NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USDT'::text NOT NULL,
    type text DEFAULT 'credit'::text NOT NULL,
    reference_id text,
    reference_type text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: capital_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capital_transfers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deal_id uuid,
    relationship_id uuid NOT NULL,
    direction text NOT NULL,
    amount numeric NOT NULL,
    cost_basis numeric DEFAULT 0 NOT NULL,
    total_cost numeric DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USDT'::text NOT NULL,
    transferred_by uuid NOT NULL,
    note text,
    CONSTRAINT capital_transfers_direction_check CHECK ((direction = ANY (ARRAY['lender_to_operator'::text, 'operator_to_lender'::text])))
);


--
-- Name: cash_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_accounts (
    id text NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    currency text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    bank_name text,
    branch text,
    notes text,
    last_reconciled bigint,
    created_at bigint NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_merchant_account boolean DEFAULT false,
    CONSTRAINT cash_accounts_currency_check CHECK ((currency = ANY (ARRAY['QAR'::text, 'USDT'::text, 'USD'::text]))),
    CONSTRAINT cash_accounts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text]))),
    CONSTRAINT cash_accounts_type_check CHECK ((type = ANY (ARRAY['hand'::text, 'bank'::text, 'vault'::text])))
);


--
-- Name: cash_custody_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_custody_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    requester_merchant_id text NOT NULL,
    custodian_merchant_id text NOT NULL,
    amount numeric NOT NULL,
    currency text DEFAULT 'QAR'::text NOT NULL,
    note text,
    status text DEFAULT 'pending'::text NOT NULL,
    counter_amount numeric,
    counter_note text,
    requester_user_id uuid,
    custodian_user_id uuid,
    relationship_id uuid,
    accepted_at timestamp with time zone,
    rejected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cash_custody_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'counter_proposed'::text, 'cancelled'::text])))
);


--
-- Name: cash_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_ledger (
    id text NOT NULL,
    user_id uuid NOT NULL,
    account_id text NOT NULL,
    contra_account_id text,
    ts bigint NOT NULL,
    type text NOT NULL,
    direction text NOT NULL,
    amount numeric(18,6) DEFAULT 0 NOT NULL,
    currency text NOT NULL,
    note text,
    linked_entity_id text,
    linked_entity_type text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    batch_id text,
    CONSTRAINT cash_ledger_currency_check CHECK ((currency = ANY (ARRAY['QAR'::text, 'USDT'::text, 'USD'::text]))),
    CONSTRAINT cash_ledger_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text]))),
    CONSTRAINT cash_ledger_linked_entity_type_check CHECK ((linked_entity_type = ANY (ARRAY['batch'::text, 'trade'::text]))),
    CONSTRAINT cash_ledger_type_check CHECK ((type = ANY (ARRAY['opening'::text, 'deposit'::text, 'withdrawal'::text, 'transfer_in'::text, 'transfer_out'::text, 'stock_purchase'::text, 'stock_refund'::text, 'stock_edit_adjust'::text, 'reconcile'::text])))
);


--
-- Name: chat_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid,
    room_id uuid NOT NULL,
    uploader_id uuid NOT NULL,
    storage_path text NOT NULL,
    cdn_url text,
    file_name text NOT NULL,
    file_size bigint NOT NULL,
    mime_type text NOT NULL,
    thumbnail_path text,
    duration_ms integer,
    width integer,
    height integer,
    waveform jsonb,
    checksum_sha256 text,
    is_validated boolean DEFAULT false NOT NULL,
    is_encrypted boolean DEFAULT false NOT NULL,
    iv text,
    auth_tag text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid,
    user_id uuid,
    event_type text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_call_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_call_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    call_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'ringing'::text NOT NULL,
    joined_at timestamp with time zone,
    left_at timestamp with time zone,
    sdp_offer text,
    sdp_answer text,
    ice_candidates jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT chat_call_participants_status_check CHECK ((status = ANY (ARRAY['ringing'::text, 'connected'::text, 'disconnected'::text, 'declined'::text])))
);

ALTER TABLE ONLY public.chat_call_participants REPLICA IDENTITY FULL;


--
-- Name: chat_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_calls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    initiated_by uuid NOT NULL,
    status public.chat_call_status DEFAULT 'ringing'::public.chat_call_status NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    connected_at timestamp with time zone,
    ended_at timestamp with time zone,
    duration_seconds integer,
    end_reason text,
    ice_config jsonb,
    quality_stats jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    signaling_channel text DEFAULT 'supabase'::text
);

ALTER TABLE ONLY public.chat_calls REPLICA IDENTITY FULL;


--
-- Name: chat_device_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_device_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    device_id text NOT NULL,
    key_type text DEFAULT 'identity'::text NOT NULL,
    public_key text NOT NULL,
    key_id integer,
    signature text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    used_at timestamp with time zone,
    CONSTRAINT chat_device_keys_key_type_check CHECK ((key_type = ANY (ARRAY['identity'::text, 'signed_prekey'::text, 'one_time_prekey'::text])))
);


--
-- Name: chat_direct_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_direct_rooms (
    user_a_id uuid NOT NULL,
    user_b_id uuid NOT NULL,
    room_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_direct_rooms_check CHECK ((user_a_id < user_b_id))
);


--
-- Name: chat_e2ee_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_e2ee_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    encrypted_session_key text NOT NULL,
    session_version integer DEFAULT 1 NOT NULL,
    sender_device_id text NOT NULL,
    recipient_device_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    rotated_at timestamp with time zone
);


--
-- Name: chat_message_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_message_reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_message_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_message_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'delivered'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_message_receipts_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'delivered'::text, 'read'::text])))
);

ALTER TABLE ONLY public.chat_message_receipts REPLICA IDENTITY FULL;


--
-- Name: chat_presence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_presence (
    user_id uuid NOT NULL,
    status text DEFAULT 'offline'::text NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    device_info jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_presence_status_check CHECK ((status = ANY (ARRAY['online'::text, 'away'::text, 'offline'::text])))
);

ALTER TABLE ONLY public.chat_presence REPLICA IDENTITY FULL;


--
-- Name: chat_room_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_room_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role public.chat_member_role DEFAULT 'member'::public.chat_member_role NOT NULL,
    display_name_override text,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    invited_by uuid,
    is_muted boolean DEFAULT false NOT NULL,
    muted_until timestamp with time zone,
    is_pinned boolean DEFAULT false NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    notification_level text DEFAULT 'all'::text NOT NULL,
    last_read_message_id uuid,
    last_read_at timestamp with time zone,
    removed_at timestamp with time zone,
    removed_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_room_members_notification_level_check CHECK ((notification_level = ANY (ARRAY['all'::text, 'mentions'::text, 'none'::text])))
);


--
-- Name: chat_room_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_room_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_type public.chat_room_type NOT NULL,
    encryption_mode public.chat_encryption_mode DEFAULT 'tls_only'::public.chat_encryption_mode NOT NULL,
    retention_hours integer,
    allow_files boolean DEFAULT true NOT NULL,
    allow_voice_notes boolean DEFAULT true NOT NULL,
    allow_images boolean DEFAULT true NOT NULL,
    allow_calls boolean DEFAULT false NOT NULL,
    allow_group_calls boolean DEFAULT false NOT NULL,
    moderation_level text DEFAULT 'none'::text NOT NULL,
    history_searchable boolean DEFAULT false NOT NULL,
    watermark_enabled boolean DEFAULT false NOT NULL,
    disappearing_default_hours integer,
    max_file_size_mb integer DEFAULT 50 NOT NULL,
    allowed_mime_types text[],
    screenshot_protection boolean DEFAULT false NOT NULL,
    link_preview_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    disable_forwarding boolean DEFAULT false NOT NULL,
    disable_export boolean DEFAULT false NOT NULL,
    strip_forward_sender_identity boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_room_policies_moderation_level_check CHECK ((moderation_level = ANY (ARRAY['none'::text, 'light'::text, 'strict'::text])))
);


--
-- Name: os_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.os_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    thread_id uuid,
    sender_merchant_id text NOT NULL,
    sender_identity_id uuid,
    content text NOT NULL,
    permissions jsonb DEFAULT '{"copyable": true, "exportable": true, "ai_readable": true, "forwardable": true}'::jsonb NOT NULL,
    expires_at timestamp with time zone,
    retention_policy text DEFAULT 'indefinite'::text NOT NULL,
    view_limit integer,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_pinned boolean DEFAULT false NOT NULL,
    pinned_at timestamp with time zone,
    pinned_by text,
    CONSTRAINT os_messages_retention_policy_check CHECK ((retention_policy = ANY (ARRAY['indefinite'::text, '30d'::text, '7d'::text, '24h'::text, 'view_once'::text])))
);

ALTER TABLE ONLY public.os_messages REPLICA IDENTITY FULL;


--
-- Name: os_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.os_rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text DEFAULT 'standard'::text NOT NULL,
    lane text DEFAULT 'Personal'::text NOT NULL,
    security_policies jsonb DEFAULT '{"watermark": false, "disable_copy": false, "disable_export": false, "disable_forwarding": false}'::jsonb NOT NULL,
    retention_policy text DEFAULT 'indefinite'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT os_rooms_lane_check CHECK ((lane = ANY (ARRAY['Personal'::text, 'Team'::text, 'Customers'::text, 'Deals'::text, 'Alerts'::text, 'Archived'::text]))),
    CONSTRAINT os_rooms_retention_policy_check CHECK ((retention_policy = ANY (ARRAY['indefinite'::text, '30d'::text, '7d'::text, '24h'::text, 'view_once'::text]))),
    CONSTRAINT os_rooms_type_check CHECK ((type = ANY (ARRAY['standard'::text, 'broadcast'::text, 'approval'::text, 'incident'::text, 'deal'::text, 'temporary'::text])))
);


--
-- Name: chat_room_summary_v; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.chat_room_summary_v WITH (security_invoker='true') AS
 SELECT id,
    name,
    type,
    lane,
    updated_at AS last_message_at,
    security_policies,
    retention_policy,
    ( SELECT count(*) AS count
           FROM public.os_messages m
          WHERE (m.room_id = r.id)) AS message_count,
    ( SELECT m.content
           FROM public.os_messages m
          WHERE (m.room_id = r.id)
          ORDER BY m.created_at DESC
         LIMIT 1) AS last_message_content,
    ( SELECT m.sender_merchant_id
           FROM public.os_messages m
          WHERE (m.room_id = r.id)
          ORDER BY m.created_at DESC
         LIMIT 1) AS last_message_sender
   FROM public.os_rooms r;


--
-- Name: chat_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type public.chat_room_type NOT NULL,
    name text,
    description text,
    avatar_url text,
    created_by uuid,
    policy_id uuid,
    last_message_id uuid,
    last_message_at timestamp with time zone,
    last_message_preview text,
    is_direct boolean DEFAULT false NOT NULL,
    is_announcement_only boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    migrated_from text,
    migrated_source_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_typing_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_typing_state (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    is_typing boolean DEFAULT false NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:00:08'::interval) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.chat_typing_state REPLICA IDENTITY FULL;


--
-- Name: conversation_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    relationship_id uuid NOT NULL,
    is_muted boolean DEFAULT false NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    muted_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_merchant_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_merchant_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_user_id uuid NOT NULL,
    merchant_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    nickname text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_preferred boolean DEFAULT false NOT NULL
);


--
-- Name: customer_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    connection_id uuid NOT NULL,
    sender_user_id uuid NOT NULL,
    sender_role text DEFAULT 'customer'::text NOT NULL,
    content text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_order_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_order_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    event_type text NOT NULL,
    actor_user_id uuid NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_user_id uuid NOT NULL,
    merchant_id text NOT NULL,
    connection_id uuid NOT NULL,
    order_type text DEFAULT 'buy'::text NOT NULL,
    amount numeric NOT NULL,
    currency text DEFAULT 'USDT'::text NOT NULL,
    rate numeric,
    total numeric,
    status text DEFAULT 'pending'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_proof_url text,
    payment_proof_uploaded_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    expires_at timestamp with time zone
);


--
-- Name: customer_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    display_name text NOT NULL,
    phone text,
    region text,
    preferred_currency text DEFAULT 'USDT'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: daily_reference_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_reference_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rate_date date NOT NULL,
    wacop_rate numeric NOT NULL,
    total_usdt_stock numeric DEFAULT 0 NOT NULL,
    total_cost_basis_qar numeric DEFAULT 0 NOT NULL,
    source text DEFAULT 'fifo_wacop'::text NOT NULL,
    recorded_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deal_capital; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_capital (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_id uuid NOT NULL,
    relationship_id uuid NOT NULL,
    merchant_id text NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USDT'::text NOT NULL,
    type text DEFAULT 'contribution'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deal_capital_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_capital_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_id uuid NOT NULL,
    relationship_id uuid NOT NULL,
    type text NOT NULL,
    amount numeric NOT NULL,
    currency text DEFAULT 'USDT'::text NOT NULL,
    period_id uuid,
    initiated_by uuid NOT NULL,
    note text,
    pool_balance_after numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    original_entry_id uuid
);


--
-- Name: gas_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gas_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    action text NOT NULL,
    gas_used numeric DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: market_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    merchant_id text NOT NULL,
    offer_type text NOT NULL,
    currency_pair text DEFAULT 'USDT/QAR'::text NOT NULL,
    rate numeric(18,6) NOT NULL,
    min_amount numeric(18,6) DEFAULT 0 NOT NULL,
    max_amount numeric(18,6) DEFAULT 0 NOT NULL,
    note text,
    status text DEFAULT 'active'::text NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_offers_offer_type_check CHECK ((offer_type = ANY (ARRAY['buy'::text, 'sell'::text]))),
    CONSTRAINT market_offers_status_check CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text, 'expired'::text, 'filled'::text])))
);


--
-- Name: merchant_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    relationship_id uuid NOT NULL,
    type text NOT NULL,
    target_entity_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    submitted_by uuid NOT NULL,
    reviewer_id uuid,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT merchant_approvals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT merchant_approvals_type_check CHECK ((type = ANY (ARRAY['deal_creation'::text, 'deal_update'::text])))
);


--
-- Name: merchant_deals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_deals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    relationship_id uuid NOT NULL,
    title text NOT NULL,
    amount numeric NOT NULL,
    currency text DEFAULT 'USDT'::text NOT NULL,
    deal_type text DEFAULT 'general'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_by uuid NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    realized_pnl numeric DEFAULT 0 NOT NULL,
    settlement_cadence text DEFAULT 'monthly'::text,
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: merchant_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_merchant_id text NOT NULL,
    to_merchant_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    message text,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT merchant_invites_check CHECK ((from_merchant_id <> to_merchant_id)),
    CONSTRAINT merchant_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])))
);


--
-- Name: merchant_liquidity_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_liquidity_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    merchant_id text NOT NULL,
    user_id uuid NOT NULL,
    publish_cash_enabled boolean DEFAULT false NOT NULL,
    publish_usdt_enabled boolean DEFAULT false NOT NULL,
    published_cash_amount numeric(18,2),
    published_usdt_amount numeric(18,6),
    cash_publish_mode text DEFAULT 'status'::text NOT NULL,
    usdt_publish_mode text DEFAULT 'status'::text NOT NULL,
    cash_range_min numeric(18,2),
    cash_range_max numeric(18,2),
    usdt_range_min numeric(18,6),
    usdt_range_max numeric(18,6),
    cash_status text DEFAULT 'unavailable'::text NOT NULL,
    usdt_status text DEFAULT 'unavailable'::text NOT NULL,
    reserve_buffer_cash numeric(18,2) DEFAULT 0 NOT NULL,
    reserve_buffer_usdt numeric(18,6) DEFAULT 0 NOT NULL,
    reserved_cash_commitments numeric(18,2) DEFAULT 0 NOT NULL,
    reserved_usdt_commitments numeric(18,6) DEFAULT 0 NOT NULL,
    visibility_scope text DEFAULT 'relationships'::text NOT NULL,
    auto_sync_enabled boolean DEFAULT false NOT NULL,
    last_published_at timestamp with time zone,
    expires_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: merchant_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    relationship_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    content text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    msg_type text DEFAULT 'text'::text NOT NULL,
    delivered_at timestamp with time zone,
    edited_at timestamp with time zone,
    reply_to uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT merchant_messages_msg_type_check CHECK ((msg_type = ANY (ARRAY['text'::text, 'voice'::text, 'poll'::text, 'forward'::text, 'system'::text, 'image'::text, 'file'::text])))
);


--
-- Name: merchant_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    merchant_id text NOT NULL,
    nickname text NOT NULL,
    display_name text NOT NULL,
    bio text,
    region text,
    default_currency text DEFAULT 'USDT'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    merchant_code text,
    discoverability text DEFAULT 'public'::text NOT NULL,
    avatar_url text,
    otc_completed_trades integer DEFAULT 0 NOT NULL,
    otc_completion_rate numeric DEFAULT 0 NOT NULL,
    otc_total_volume numeric DEFAULT 0 NOT NULL,
    otc_reputation_updated_at timestamp with time zone,
    otc_avg_rating numeric DEFAULT 0 NOT NULL,
    otc_review_count integer DEFAULT 0 NOT NULL,
    verification_tier text DEFAULT 'new'::text NOT NULL,
    CONSTRAINT merchant_profiles_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);


--
-- Name: merchant_profits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_profits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_id uuid NOT NULL,
    amount numeric NOT NULL,
    currency text DEFAULT 'USDT'::text NOT NULL,
    recorded_by uuid NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    relationship_id uuid,
    status text DEFAULT 'pending'::text NOT NULL
);


--
-- Name: merchant_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_relationships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    merchant_a_id text NOT NULL,
    merchant_b_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT merchant_relationships_check CHECK ((merchant_a_id <> merchant_b_id)),
    CONSTRAINT merchant_relationships_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'ended'::text])))
);


--
-- Name: merchant_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_id uuid NOT NULL,
    amount numeric NOT NULL,
    currency text DEFAULT 'USDT'::text NOT NULL,
    settled_by uuid NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    relationship_id uuid,
    status text DEFAULT 'pending'::text NOT NULL
);


--
-- Name: message_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    message_id uuid NOT NULL,
    user_id text NOT NULL,
    reaction text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    category text NOT NULL,
    push_enabled boolean DEFAULT true NOT NULL,
    in_app_enabled boolean DEFAULT true NOT NULL,
    sound_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    category text DEFAULT 'system'::text NOT NULL,
    title text NOT NULL,
    body text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    conversation_id uuid,
    message_id uuid,
    entity_type text,
    entity_id text,
    anchor_id text,
    actor_id uuid,
    target_path text,
    target_tab text,
    target_focus text,
    target_entity_type text,
    target_entity_id text,
    dedupe_key text,
    CONSTRAINT chk_notifications_target_tab CHECK (((target_tab IS NULL) OR (target_tab = ANY (ARRAY['my'::text, 'incoming'::text, 'outgoing'::text, 'transfers'::text, 'trades'::text, 'settlements'::text, 'clients'::text, 'agreements'::text])))),
    CONSTRAINT notifications_category_check CHECK ((category = ANY (ARRAY['invite'::text, 'approval'::text, 'system'::text, 'message'::text, 'deal'::text, 'stock'::text, 'customer_order'::text, 'customer_message'::text, 'order'::text, 'agreement'::text, 'settlement'::text, 'chat'::text])))
);


--
-- Name: order_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_group_id uuid NOT NULL,
    order_id text NOT NULL,
    relationship_id uuid NOT NULL,
    merchant_id text NOT NULL,
    family text NOT NULL,
    profit_share_agreement_id uuid,
    allocated_usdt numeric(18,6) DEFAULT 0 NOT NULL,
    merchant_cost_per_usdt numeric(18,6) DEFAULT 0 NOT NULL,
    sell_price numeric(18,6) DEFAULT 0 NOT NULL,
    fee_share numeric(18,6) DEFAULT 0 NOT NULL,
    allocation_revenue numeric(18,6) DEFAULT 0 NOT NULL,
    allocation_cost numeric(18,6) DEFAULT 0 NOT NULL,
    allocation_fee numeric(18,6) DEFAULT 0 NOT NULL,
    allocation_net numeric(18,6) DEFAULT 0 NOT NULL,
    partner_share_pct numeric(5,2) DEFAULT 0 NOT NULL,
    merchant_share_pct numeric(5,2) DEFAULT 0 NOT NULL,
    partner_amount numeric(18,6) DEFAULT 0 NOT NULL,
    merchant_amount numeric(18,6) DEFAULT 0 NOT NULL,
    agreement_ratio_snapshot text,
    deal_terms_snapshot jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_allocations_family_check CHECK ((family = ANY (ARRAY['profit_share'::text, 'sales_deal'::text, 'capital_transfer'::text]))),
    CONSTRAINT order_allocations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'settled'::text, 'voided'::text])))
);


--
-- Name: os_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.os_audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid,
    actor_merchant_id text NOT NULL,
    event_type text NOT NULL,
    target_type text,
    target_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: os_business_objects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.os_business_objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    object_type text NOT NULL,
    source_message_id uuid,
    created_by_merchant_id text NOT NULL,
    state_snapshot_hash text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT os_business_objects_object_type_check CHECK ((object_type = ANY (ARRAY['order'::text, 'payment'::text, 'agreement'::text, 'dispute'::text, 'task'::text, 'deal_offer'::text, 'snapshot'::text]))),
    CONSTRAINT os_business_objects_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'completed'::text, 'locked'::text])))
);


--
-- Name: os_channel_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.os_channel_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    merchant_id text NOT NULL,
    provider_type text NOT NULL,
    provider_uid text NOT NULL,
    confidence_level text DEFAULT 'certain'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT os_channel_identities_confidence_level_check CHECK ((confidence_level = ANY (ARRAY['certain'::text, 'probable'::text, 'unresolved'::text]))),
    CONSTRAINT os_channel_identities_provider_type_check CHECK ((provider_type = ANY (ARRAY['WhatsApp'::text, 'Web'::text, 'Telegram'::text, 'Email'::text, 'SMS'::text])))
);


--
-- Name: os_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.os_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid,
    policy_type text NOT NULL,
    rules jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT os_policies_policy_type_check CHECK ((policy_type = ANY (ARRAY['acl'::text, 'retention'::text, 'automation'::text, 'compliance'::text])))
);


--
-- Name: os_room_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.os_room_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    merchant_id text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT os_room_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'guest'::text])))
);


--
-- Name: os_room_presence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.os_room_presence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    merchant_id text NOT NULL,
    is_focused boolean DEFAULT false NOT NULL,
    last_read_message_id uuid,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: os_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.os_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    title text,
    routing_target text,
    source_message_ids uuid[] DEFAULT '{}'::uuid[],
    created_by_merchant_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: os_workflow_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.os_workflow_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    workflow_name text NOT NULL,
    trigger_message_id uuid,
    status text DEFAULT 'running'::text NOT NULL,
    input_payload jsonb DEFAULT '{}'::jsonb,
    output_payload jsonb DEFAULT '{}'::jsonb,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT os_workflow_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: otc_disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otc_disputes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trade_id uuid NOT NULL,
    opened_by uuid NOT NULL,
    respondent_user_id uuid NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    evidence_urls text[] DEFAULT '{}'::text[] NOT NULL,
    respondent_evidence_urls text[] DEFAULT '{}'::text[] NOT NULL,
    admin_mediator_id uuid,
    status text DEFAULT 'open'::text NOT NULL,
    resolution text,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: otc_escrow; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otc_escrow (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trade_id uuid NOT NULL,
    depositor_user_id uuid NOT NULL,
    side text NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USDT'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    deposited_at timestamp with time zone,
    released_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT otc_escrow_side_check CHECK ((side = ANY (ARRAY['cash'::text, 'usdt'::text])))
);


--
-- Name: otc_listings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otc_listings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    merchant_id text NOT NULL,
    side text NOT NULL,
    currency text DEFAULT 'QAR'::text NOT NULL,
    amount_min numeric DEFAULT 0 NOT NULL,
    amount_max numeric DEFAULT 0 NOT NULL,
    rate numeric DEFAULT 0 NOT NULL,
    payment_methods text[] DEFAULT '{}'::text[] NOT NULL,
    note text,
    status text DEFAULT 'active'::text NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT otc_listings_side_check CHECK ((side = ANY (ARRAY['cash'::text, 'usdt'::text]))),
    CONSTRAINT otc_listings_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'expired'::text])))
);


--
-- Name: otc_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otc_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trade_id uuid NOT NULL,
    reviewer_user_id uuid NOT NULL,
    reviewed_user_id uuid NOT NULL,
    rating smallint NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT otc_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: otc_trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otc_trades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid,
    initiator_user_id uuid NOT NULL,
    responder_user_id uuid NOT NULL,
    initiator_merchant_id text NOT NULL,
    responder_merchant_id text NOT NULL,
    side text NOT NULL,
    currency text DEFAULT 'QAR'::text NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    rate numeric DEFAULT 0 NOT NULL,
    total numeric DEFAULT 0 NOT NULL,
    counter_amount numeric,
    counter_rate numeric,
    counter_total numeric,
    note text,
    counter_note text,
    status text DEFAULT 'offered'::text NOT NULL,
    chat_room_id uuid,
    confirmed_at timestamp with time zone,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    escrow_status text DEFAULT 'none'::text NOT NULL,
    CONSTRAINT otc_trades_side_check CHECK ((side = ANY (ARRAY['cash'::text, 'usdt'::text]))),
    CONSTRAINT otc_trades_status_check CHECK ((status = ANY (ARRAY['offered'::text, 'countered'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text, 'expired'::text])))
);


--
-- Name: p2p_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.p2p_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market text NOT NULL,
    data jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    email text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    role text DEFAULT 'merchant'::text NOT NULL,
    full_name text,
    username text,
    avatar_url text,
    CONSTRAINT profiles_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'suspended'::text])))
);


--
-- Name: profit_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profit_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    relationship_id uuid NOT NULL,
    deal_id uuid,
    agreement_id uuid,
    period_id uuid,
    merchant_id text NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USDT'::text NOT NULL,
    type text DEFAULT 'profit'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    notes text,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profit_share_agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profit_share_agreements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    relationship_id uuid NOT NULL,
    partner_ratio numeric(5,2) NOT NULL,
    merchant_ratio numeric(5,2) NOT NULL,
    settlement_cadence text DEFAULT 'monthly'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    created_by uuid NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    agreement_type text DEFAULT 'standard'::text NOT NULL,
    operator_ratio numeric,
    operator_merchant_id text,
    operator_contribution numeric,
    lender_contribution numeric,
    terms_snapshot jsonb,
    operator_default_profit_handling text DEFAULT 'reinvest'::text NOT NULL,
    counterparty_default_profit_handling text DEFAULT 'withdraw'::text NOT NULL,
    invested_capital numeric,
    settlement_way text,
    CONSTRAINT profit_share_agreements_settlement_cadence_check CHECK ((settlement_cadence = ANY (ARRAY['monthly'::text, 'weekly'::text, 'per_order'::text])))
);


--
-- Name: push_device_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_device_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    platform text DEFAULT 'web'::text NOT NULL,
    device_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: settlement_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settlement_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    settlement_period_id uuid NOT NULL,
    agreement_id uuid NOT NULL,
    merchant_id text NOT NULL,
    role text DEFAULT 'participant'::text NOT NULL,
    profit_amount numeric DEFAULT 0 NOT NULL,
    decision text DEFAULT 'pending'::text NOT NULL,
    default_behavior text DEFAULT 'withdraw'::text NOT NULL,
    decision_due_at timestamp with time zone,
    decision_confirmed_at timestamp with time zone,
    reinvested_amount numeric DEFAULT 0 NOT NULL,
    withdrawn_amount numeric DEFAULT 0 NOT NULL,
    effective_capital_before numeric DEFAULT 0 NOT NULL,
    effective_capital_after numeric DEFAULT 0 NOT NULL,
    finalization_snapshot jsonb,
    finalized_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: settlement_overviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settlement_overviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    relationship_id uuid NOT NULL,
    agreement_id uuid,
    period_label text,
    total_profit numeric DEFAULT 0 NOT NULL,
    total_reinvested numeric DEFAULT 0 NOT NULL,
    total_withdrawn numeric DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: settlement_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settlement_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_id uuid NOT NULL,
    relationship_id uuid NOT NULL,
    cadence text NOT NULL,
    period_key text NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    trade_count integer DEFAULT 0 NOT NULL,
    gross_volume numeric DEFAULT 0 NOT NULL,
    total_cost numeric DEFAULT 0 NOT NULL,
    net_profit numeric DEFAULT 0 NOT NULL,
    total_fees numeric DEFAULT 0 NOT NULL,
    partner_amount numeric DEFAULT 0 NOT NULL,
    merchant_amount numeric DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    settled_amount numeric DEFAULT 0 NOT NULL,
    settlement_id uuid,
    resolution text,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    due_at timestamp with time zone,
    settled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tracker_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tracker_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: tracker_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tracker_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL
);


--
-- Name: admin_audit_logs admin_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: balance_ledger balance_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_ledger
    ADD CONSTRAINT balance_ledger_pkey PRIMARY KEY (id);


--
-- Name: capital_transfers capital_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capital_transfers
    ADD CONSTRAINT capital_transfers_pkey PRIMARY KEY (id);


--
-- Name: cash_accounts cash_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_accounts
    ADD CONSTRAINT cash_accounts_pkey PRIMARY KEY (id);


--
-- Name: cash_custody_requests cash_custody_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_requests
    ADD CONSTRAINT cash_custody_requests_pkey PRIMARY KEY (id);


--
-- Name: cash_ledger cash_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_ledger
    ADD CONSTRAINT cash_ledger_pkey PRIMARY KEY (id);


--
-- Name: chat_attachments chat_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_attachments
    ADD CONSTRAINT chat_attachments_pkey PRIMARY KEY (id);


--
-- Name: chat_audit_events chat_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_audit_events
    ADD CONSTRAINT chat_audit_events_pkey PRIMARY KEY (id);


--
-- Name: chat_call_participants chat_call_participants_call_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_call_participants
    ADD CONSTRAINT chat_call_participants_call_id_user_id_key UNIQUE (call_id, user_id);


--
-- Name: chat_call_participants chat_call_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_call_participants
    ADD CONSTRAINT chat_call_participants_pkey PRIMARY KEY (id);


--
-- Name: chat_calls chat_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_calls
    ADD CONSTRAINT chat_calls_pkey PRIMARY KEY (id);


--
-- Name: chat_device_keys chat_device_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_device_keys
    ADD CONSTRAINT chat_device_keys_pkey PRIMARY KEY (id);


--
-- Name: chat_device_keys chat_device_keys_user_id_device_id_key_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_device_keys
    ADD CONSTRAINT chat_device_keys_user_id_device_id_key_type_key UNIQUE (user_id, device_id, key_type);


--
-- Name: chat_direct_rooms chat_direct_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_direct_rooms
    ADD CONSTRAINT chat_direct_rooms_pkey PRIMARY KEY (user_a_id, user_b_id);


--
-- Name: chat_direct_rooms chat_direct_rooms_room_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_direct_rooms
    ADD CONSTRAINT chat_direct_rooms_room_id_key UNIQUE (room_id);


--
-- Name: chat_e2ee_sessions chat_e2ee_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_e2ee_sessions
    ADD CONSTRAINT chat_e2ee_sessions_pkey PRIMARY KEY (id);


--
-- Name: chat_e2ee_sessions chat_e2ee_sessions_room_id_sender_id_recipient_id_sender_de_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_e2ee_sessions
    ADD CONSTRAINT chat_e2ee_sessions_room_id_sender_id_recipient_id_sender_de_key UNIQUE (room_id, sender_id, recipient_id, sender_device_id, recipient_device_id);


--
-- Name: chat_message_reactions chat_message_reactions_message_id_user_id_emoji_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_message_id_user_id_emoji_key UNIQUE (message_id, user_id, emoji);


--
-- Name: chat_message_reactions chat_message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_pkey PRIMARY KEY (id);


--
-- Name: chat_message_receipts chat_message_receipts_message_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_receipts
    ADD CONSTRAINT chat_message_receipts_message_id_user_id_key UNIQUE (message_id, user_id);


--
-- Name: chat_message_receipts chat_message_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_receipts
    ADD CONSTRAINT chat_message_receipts_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_client_nonce_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_client_nonce_key UNIQUE (client_nonce);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_presence chat_presence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_presence
    ADD CONSTRAINT chat_presence_pkey PRIMARY KEY (user_id);


--
-- Name: chat_privacy_settings chat_privacy_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_privacy_settings
    ADD CONSTRAINT chat_privacy_settings_pkey PRIMARY KEY (user_id);


--
-- Name: chat_room_members chat_room_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_pkey PRIMARY KEY (id);


--
-- Name: chat_room_members chat_room_members_room_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_room_id_user_id_key UNIQUE (room_id, user_id);


--
-- Name: chat_room_policies chat_room_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_policies
    ADD CONSTRAINT chat_room_policies_pkey PRIMARY KEY (id);


--
-- Name: chat_room_policies chat_room_policies_room_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_policies
    ADD CONSTRAINT chat_room_policies_room_type_key UNIQUE (room_type);


--
-- Name: chat_rooms chat_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_pkey PRIMARY KEY (id);


--
-- Name: chat_typing_state chat_typing_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_typing_state
    ADD CONSTRAINT chat_typing_state_pkey PRIMARY KEY (room_id, user_id);


--
-- Name: conversation_settings conversation_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_settings
    ADD CONSTRAINT conversation_settings_pkey PRIMARY KEY (id);


--
-- Name: conversation_settings conversation_settings_user_id_relationship_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_settings
    ADD CONSTRAINT conversation_settings_user_id_relationship_id_key UNIQUE (user_id, relationship_id);


--
-- Name: customer_merchant_connections customer_merchant_connections_customer_user_id_merchant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_merchant_connections
    ADD CONSTRAINT customer_merchant_connections_customer_user_id_merchant_id_key UNIQUE (customer_user_id, merchant_id);


--
-- Name: customer_merchant_connections customer_merchant_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_merchant_connections
    ADD CONSTRAINT customer_merchant_connections_pkey PRIMARY KEY (id);


--
-- Name: customer_messages customer_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_messages
    ADD CONSTRAINT customer_messages_pkey PRIMARY KEY (id);


--
-- Name: customer_order_events customer_order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_order_events
    ADD CONSTRAINT customer_order_events_pkey PRIMARY KEY (id);


--
-- Name: customer_orders customer_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_orders
    ADD CONSTRAINT customer_orders_pkey PRIMARY KEY (id);


--
-- Name: customer_profiles customer_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_profiles
    ADD CONSTRAINT customer_profiles_pkey PRIMARY KEY (id);


--
-- Name: customer_profiles customer_profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_profiles
    ADD CONSTRAINT customer_profiles_user_id_key UNIQUE (user_id);


--
-- Name: daily_reference_rates daily_reference_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_reference_rates
    ADD CONSTRAINT daily_reference_rates_pkey PRIMARY KEY (id);


--
-- Name: daily_reference_rates daily_reference_rates_rate_date_recorded_by_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_reference_rates
    ADD CONSTRAINT daily_reference_rates_rate_date_recorded_by_key UNIQUE (rate_date, recorded_by);


--
-- Name: deal_capital_ledger deal_capital_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_capital_ledger
    ADD CONSTRAINT deal_capital_ledger_pkey PRIMARY KEY (id);


--
-- Name: deal_capital deal_capital_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_capital
    ADD CONSTRAINT deal_capital_pkey PRIMARY KEY (id);


--
-- Name: gas_log gas_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gas_log
    ADD CONSTRAINT gas_log_pkey PRIMARY KEY (id);


--
-- Name: market_offers market_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_offers
    ADD CONSTRAINT market_offers_pkey PRIMARY KEY (id);


--
-- Name: merchant_approvals merchant_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_approvals
    ADD CONSTRAINT merchant_approvals_pkey PRIMARY KEY (id);


--
-- Name: merchant_deals merchant_deals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_deals
    ADD CONSTRAINT merchant_deals_pkey PRIMARY KEY (id);


--
-- Name: merchant_invites merchant_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_invites
    ADD CONSTRAINT merchant_invites_pkey PRIMARY KEY (id);


--
-- Name: merchant_liquidity_profiles merchant_liquidity_profiles_merchant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_liquidity_profiles
    ADD CONSTRAINT merchant_liquidity_profiles_merchant_id_key UNIQUE (merchant_id);


--
-- Name: merchant_liquidity_profiles merchant_liquidity_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_liquidity_profiles
    ADD CONSTRAINT merchant_liquidity_profiles_pkey PRIMARY KEY (id);


--
-- Name: merchant_messages merchant_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_messages
    ADD CONSTRAINT merchant_messages_pkey PRIMARY KEY (id);


--
-- Name: merchant_profiles merchant_profiles_merchant_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_profiles
    ADD CONSTRAINT merchant_profiles_merchant_code_key UNIQUE (merchant_code);


--
-- Name: merchant_profiles merchant_profiles_merchant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_profiles
    ADD CONSTRAINT merchant_profiles_merchant_id_key UNIQUE (merchant_id);


--
-- Name: merchant_profiles merchant_profiles_nickname_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_profiles
    ADD CONSTRAINT merchant_profiles_nickname_key UNIQUE (nickname);


--
-- Name: merchant_profiles merchant_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_profiles
    ADD CONSTRAINT merchant_profiles_pkey PRIMARY KEY (id);


--
-- Name: merchant_profiles merchant_profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_profiles
    ADD CONSTRAINT merchant_profiles_user_id_key UNIQUE (user_id);


--
-- Name: merchant_profits merchant_profits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_profits
    ADD CONSTRAINT merchant_profits_pkey PRIMARY KEY (id);


--
-- Name: merchant_relationships merchant_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_relationships
    ADD CONSTRAINT merchant_relationships_pkey PRIMARY KEY (id);


--
-- Name: merchant_settlements merchant_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_settlements
    ADD CONSTRAINT merchant_settlements_pkey PRIMARY KEY (id);


--
-- Name: message_reactions message_reactions_message_id_user_id_reaction_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_message_id_user_id_reaction_key UNIQUE (message_id, user_id, reaction);


--
-- Name: message_reactions message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_user_id_category_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_category_key UNIQUE (user_id, category);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: order_allocations order_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_allocations
    ADD CONSTRAINT order_allocations_pkey PRIMARY KEY (id);


--
-- Name: os_audit_events os_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_audit_events
    ADD CONSTRAINT os_audit_events_pkey PRIMARY KEY (id);


--
-- Name: os_business_objects os_business_objects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_business_objects
    ADD CONSTRAINT os_business_objects_pkey PRIMARY KEY (id);


--
-- Name: os_channel_identities os_channel_identities_merchant_id_provider_type_provider_ui_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_channel_identities
    ADD CONSTRAINT os_channel_identities_merchant_id_provider_type_provider_ui_key UNIQUE (merchant_id, provider_type, provider_uid);


--
-- Name: os_channel_identities os_channel_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_channel_identities
    ADD CONSTRAINT os_channel_identities_pkey PRIMARY KEY (id);


--
-- Name: os_messages os_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_messages
    ADD CONSTRAINT os_messages_pkey PRIMARY KEY (id);


--
-- Name: os_policies os_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_policies
    ADD CONSTRAINT os_policies_pkey PRIMARY KEY (id);


--
-- Name: os_room_members os_room_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_room_members
    ADD CONSTRAINT os_room_members_pkey PRIMARY KEY (id);


--
-- Name: os_room_members os_room_members_room_id_merchant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_room_members
    ADD CONSTRAINT os_room_members_room_id_merchant_id_key UNIQUE (room_id, merchant_id);


--
-- Name: os_room_presence os_room_presence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_room_presence
    ADD CONSTRAINT os_room_presence_pkey PRIMARY KEY (id);


--
-- Name: os_room_presence os_room_presence_room_id_merchant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_room_presence
    ADD CONSTRAINT os_room_presence_room_id_merchant_id_key UNIQUE (room_id, merchant_id);


--
-- Name: os_rooms os_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_rooms
    ADD CONSTRAINT os_rooms_pkey PRIMARY KEY (id);


--
-- Name: os_threads os_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_threads
    ADD CONSTRAINT os_threads_pkey PRIMARY KEY (id);


--
-- Name: os_workflow_runs os_workflow_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_workflow_runs
    ADD CONSTRAINT os_workflow_runs_pkey PRIMARY KEY (id);


--
-- Name: otc_disputes otc_disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otc_disputes
    ADD CONSTRAINT otc_disputes_pkey PRIMARY KEY (id);


--
-- Name: otc_escrow otc_escrow_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otc_escrow
    ADD CONSTRAINT otc_escrow_pkey PRIMARY KEY (id);


--
-- Name: otc_escrow otc_escrow_trade_id_depositor_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otc_escrow
    ADD CONSTRAINT otc_escrow_trade_id_depositor_user_id_key UNIQUE (trade_id, depositor_user_id);


--
-- Name: otc_listings otc_listings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otc_listings
    ADD CONSTRAINT otc_listings_pkey PRIMARY KEY (id);


--
-- Name: otc_reviews otc_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otc_reviews
    ADD CONSTRAINT otc_reviews_pkey PRIMARY KEY (id);


--
-- Name: otc_reviews otc_reviews_trade_id_reviewer_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otc_reviews
    ADD CONSTRAINT otc_reviews_trade_id_reviewer_user_id_key UNIQUE (trade_id, reviewer_user_id);


--
-- Name: otc_trades otc_trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otc_trades
    ADD CONSTRAINT otc_trades_pkey PRIMARY KEY (id);


--
-- Name: p2p_snapshots p2p_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.p2p_snapshots
    ADD CONSTRAINT p2p_snapshots_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);


--
-- Name: profit_records profit_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profit_records
    ADD CONSTRAINT profit_records_pkey PRIMARY KEY (id);


--
-- Name: profit_share_agreements profit_share_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profit_share_agreements
    ADD CONSTRAINT profit_share_agreements_pkey PRIMARY KEY (id);


--
-- Name: push_device_tokens push_device_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_device_tokens
    ADD CONSTRAINT push_device_tokens_pkey PRIMARY KEY (id);


--
-- Name: push_device_tokens push_device_tokens_user_id_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_device_tokens
    ADD CONSTRAINT push_device_tokens_user_id_token_key UNIQUE (user_id, token);


--
-- Name: settlement_decisions settlement_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_decisions
    ADD CONSTRAINT settlement_decisions_pkey PRIMARY KEY (id);


--
-- Name: settlement_decisions settlement_decisions_settlement_period_id_merchant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_decisions
    ADD CONSTRAINT settlement_decisions_settlement_period_id_merchant_id_key UNIQUE (settlement_period_id, merchant_id);


--
-- Name: settlement_overviews settlement_overviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_overviews
    ADD CONSTRAINT settlement_overviews_pkey PRIMARY KEY (id);


--
-- Name: settlement_periods settlement_periods_deal_id_period_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_periods
    ADD CONSTRAINT settlement_periods_deal_id_period_key_key UNIQUE (deal_id, period_key);


--
-- Name: settlement_periods settlement_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_periods
    ADD CONSTRAINT settlement_periods_pkey PRIMARY KEY (id);


--
-- Name: tracker_snapshots tracker_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracker_snapshots
    ADD CONSTRAINT tracker_snapshots_pkey PRIMARY KEY (id);


--
-- Name: tracker_snapshots tracker_snapshots_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracker_snapshots
    ADD CONSTRAINT tracker_snapshots_user_id_key UNIQUE (user_id);


--
-- Name: tracker_states tracker_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracker_states
    ADD CONSTRAINT tracker_states_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: idx_admin_audit_logs_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_logs_admin ON public.admin_audit_logs USING btree (admin_user_id);


--
-- Name: idx_attachments_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachments_message ON public.chat_attachments USING btree (message_id);


--
-- Name: idx_attachments_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachments_room ON public.chat_attachments USING btree (room_id);


--
-- Name: idx_attachments_uploader; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachments_uploader ON public.chat_attachments USING btree (uploader_id);


--
-- Name: idx_audit_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_room ON public.chat_audit_events USING btree (room_id, created_at DESC);


--
-- Name: idx_audit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user ON public.chat_audit_events USING btree (user_id, created_at DESC);


--
-- Name: idx_call_participant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_participant_user ON public.chat_call_participants USING btree (user_id, status);


--
-- Name: idx_call_participants; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_participants ON public.chat_call_participants USING btree (call_id);


--
-- Name: idx_calls_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_room ON public.chat_calls USING btree (room_id, started_at DESC);


--
-- Name: idx_calls_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_status ON public.chat_calls USING btree (status) WHERE (status = ANY (ARRAY['ringing'::public.chat_call_status, 'active'::public.chat_call_status]));


--
-- Name: idx_capital_ledger_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_capital_ledger_deal ON public.deal_capital_ledger USING btree (deal_id);


--
-- Name: idx_capital_ledger_relationship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_capital_ledger_relationship ON public.deal_capital_ledger USING btree (relationship_id);


--
-- Name: idx_cash_accounts_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_accounts_user_id ON public.cash_accounts USING btree (user_id);


--
-- Name: idx_cash_ledger_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_ledger_account ON public.cash_ledger USING btree (account_id);


--
-- Name: idx_cash_ledger_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_ledger_ts ON public.cash_ledger USING btree (ts DESC);


--
-- Name: idx_cash_ledger_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_ledger_type ON public.cash_ledger USING btree (type);


--
-- Name: idx_cash_ledger_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_ledger_user_id ON public.cash_ledger USING btree (user_id);


--
-- Name: idx_chat_direct_room_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_direct_room_id ON public.chat_direct_rooms USING btree (room_id);


--
-- Name: idx_chat_members_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_members_active ON public.chat_room_members USING btree (room_id, user_id) WHERE (removed_at IS NULL);


--
-- Name: idx_chat_members_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_members_room ON public.chat_room_members USING btree (room_id);


--
-- Name: idx_chat_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_members_user ON public.chat_room_members USING btree (user_id);


--
-- Name: idx_chat_messages_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_expires ON public.chat_messages USING btree (expires_at) WHERE (expires_at IS NOT NULL);


--
-- Name: idx_chat_messages_nonce; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_nonce ON public.chat_messages USING btree (client_nonce) WHERE (client_nonce IS NOT NULL);


--
-- Name: idx_chat_messages_reply; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_reply ON public.chat_messages USING btree (reply_to_id) WHERE (reply_to_id IS NOT NULL);


--
-- Name: idx_chat_messages_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_room ON public.chat_messages USING btree (room_id, created_at DESC);


--
-- Name: idx_chat_messages_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_search ON public.chat_messages USING gin (search_vector);


--
-- Name: idx_chat_messages_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_sender ON public.chat_messages USING btree (sender_id);


--
-- Name: idx_chat_rooms_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_rooms_created_by ON public.chat_rooms USING btree (created_by);


--
-- Name: idx_chat_rooms_last_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_rooms_last_message ON public.chat_rooms USING btree (last_message_at DESC NULLS LAST);


--
-- Name: idx_chat_rooms_migrated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_rooms_migrated ON public.chat_rooms USING btree (migrated_source_id) WHERE (migrated_source_id IS NOT NULL);


--
-- Name: idx_chat_rooms_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_rooms_type ON public.chat_rooms USING btree (type);


--
-- Name: idx_ct_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ct_deal ON public.capital_transfers USING btree (deal_id);


--
-- Name: idx_ct_relationship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ct_relationship ON public.capital_transfers USING btree (relationship_id);


--
-- Name: idx_customer_order_events_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_order_events_order ON public.customer_order_events USING btree (order_id);


--
-- Name: idx_daily_reference_rates_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_reference_rates_date ON public.daily_reference_rates USING btree (recorded_by, rate_date DESC);


--
-- Name: idx_device_keys_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_keys_user ON public.chat_device_keys USING btree (user_id, key_type) WHERE (is_active = true);


--
-- Name: idx_merchant_approvals_relationship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_approvals_relationship ON public.merchant_approvals USING btree (relationship_id);


--
-- Name: idx_merchant_deals_relationship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_deals_relationship ON public.merchant_deals USING btree (relationship_id);


--
-- Name: idx_merchant_invites_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_invites_from ON public.merchant_invites USING btree (from_merchant_id);


--
-- Name: idx_merchant_invites_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_invites_to ON public.merchant_invites USING btree (to_merchant_id);


--
-- Name: idx_merchant_liquidity_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_liquidity_merchant ON public.merchant_liquidity_profiles USING btree (merchant_id);


--
-- Name: idx_merchant_liquidity_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_liquidity_scope ON public.merchant_liquidity_profiles USING btree (visibility_scope, status);


--
-- Name: idx_merchant_liquidity_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_liquidity_updated ON public.merchant_liquidity_profiles USING btree (last_published_at DESC NULLS LAST);


--
-- Name: idx_merchant_messages_relationship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_messages_relationship ON public.merchant_messages USING btree (relationship_id);


--
-- Name: idx_merchant_profiles_merchant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_profiles_merchant_id ON public.merchant_profiles USING btree (merchant_id);


--
-- Name: idx_merchant_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_profiles_user_id ON public.merchant_profiles USING btree (user_id);


--
-- Name: idx_merchant_profits_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_profits_deal ON public.merchant_profits USING btree (deal_id);


--
-- Name: idx_merchant_profits_relationship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_profits_relationship ON public.merchant_profits USING btree (relationship_id);


--
-- Name: idx_merchant_relationships_a; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_relationships_a ON public.merchant_relationships USING btree (merchant_a_id);


--
-- Name: idx_merchant_relationships_b; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_relationships_b ON public.merchant_relationships USING btree (merchant_b_id);


--
-- Name: idx_merchant_settlements_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_settlements_deal ON public.merchant_settlements USING btree (deal_id);


--
-- Name: idx_merchant_settlements_relationship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_settlements_relationship ON public.merchant_settlements USING btree (relationship_id);


--
-- Name: idx_message_reactions_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_reactions_message_id ON public.message_reactions USING btree (message_id);


--
-- Name: idx_message_reactions_room_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_reactions_room_id ON public.message_reactions USING btree (room_id);


--
-- Name: idx_messages_relationship_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_relationship_created ON public.merchant_messages USING btree (relationship_id, created_at DESC);


--
-- Name: idx_messages_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_unread ON public.merchant_messages USING btree (relationship_id, read_at) WHERE (read_at IS NULL);


--
-- Name: idx_mo_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mo_merchant ON public.market_offers USING btree (merchant_id);


--
-- Name: idx_mo_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mo_room ON public.market_offers USING btree (room_id);


--
-- Name: idx_mo_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mo_status ON public.market_offers USING btree (status);


--
-- Name: idx_mo_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mo_user ON public.market_offers USING btree (user_id);


--
-- Name: idx_notifications_actor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_actor_id ON public.notifications USING btree (actor_id);


--
-- Name: idx_notifications_dedupe_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_notifications_dedupe_key ON public.notifications USING btree (dedupe_key) WHERE (dedupe_key IS NOT NULL);


--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id, read_at);


--
-- Name: idx_oa_agreement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oa_agreement ON public.order_allocations USING btree (profit_share_agreement_id);


--
-- Name: idx_oa_family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oa_family ON public.order_allocations USING btree (family);


--
-- Name: idx_oa_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oa_merchant ON public.order_allocations USING btree (merchant_id);


--
-- Name: idx_oa_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oa_order ON public.order_allocations USING btree (order_id);


--
-- Name: idx_oa_relationship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oa_relationship ON public.order_allocations USING btree (relationship_id);


--
-- Name: idx_oa_sale_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oa_sale_group ON public.order_allocations USING btree (sale_group_id);


--
-- Name: idx_oa_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oa_status ON public.order_allocations USING btree (status);


--
-- Name: idx_os_audit_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_audit_actor ON public.os_audit_events USING btree (actor_merchant_id, created_at);


--
-- Name: idx_os_audit_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_audit_room ON public.os_audit_events USING btree (room_id, created_at);


--
-- Name: idx_os_bo_room_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_bo_room_created ON public.os_business_objects USING btree (room_id, created_at);


--
-- Name: idx_os_bo_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_bo_source ON public.os_business_objects USING btree (source_message_id) WHERE (source_message_id IS NOT NULL);


--
-- Name: idx_os_identities_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_identities_merchant ON public.os_channel_identities USING btree (merchant_id);


--
-- Name: idx_os_messages_room_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_messages_room_created ON public.os_messages USING btree (room_id, created_at);


--
-- Name: idx_os_messages_room_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_messages_room_id ON public.os_messages USING btree (room_id);


--
-- Name: idx_os_messages_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_messages_thread ON public.os_messages USING btree (thread_id) WHERE (thread_id IS NOT NULL);


--
-- Name: idx_os_messages_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_messages_unread ON public.os_messages USING btree (room_id, read_at) WHERE (read_at IS NULL);


--
-- Name: idx_os_policies_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_policies_room ON public.os_policies USING btree (room_id);


--
-- Name: idx_os_presence_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_presence_room ON public.os_room_presence USING btree (room_id, merchant_id);


--
-- Name: idx_os_room_members_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_room_members_merchant ON public.os_room_members USING btree (merchant_id);


--
-- Name: idx_os_room_members_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_room_members_room ON public.os_room_members USING btree (room_id);


--
-- Name: idx_os_threads_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_threads_room ON public.os_threads USING btree (room_id);


--
-- Name: idx_os_wf_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_os_wf_room ON public.os_workflow_runs USING btree (room_id, started_at);


--
-- Name: idx_otc_listings_side; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otc_listings_side ON public.otc_listings USING btree (side);


--
-- Name: idx_otc_listings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otc_listings_status ON public.otc_listings USING btree (status);


--
-- Name: idx_otc_listings_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otc_listings_user ON public.otc_listings USING btree (user_id);


--
-- Name: idx_otc_trades_initiator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otc_trades_initiator ON public.otc_trades USING btree (initiator_user_id);


--
-- Name: idx_otc_trades_listing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otc_trades_listing ON public.otc_trades USING btree (listing_id);


--
-- Name: idx_otc_trades_responder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otc_trades_responder ON public.otc_trades USING btree (responder_user_id);


--
-- Name: idx_otc_trades_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otc_trades_status ON public.otc_trades USING btree (status);


--
-- Name: idx_p2p_snapshots_market_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_p2p_snapshots_market_time ON public.p2p_snapshots USING btree (market, fetched_at DESC);


--
-- Name: idx_profiles_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_status ON public.profiles USING btree (status);


--
-- Name: idx_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_user_id ON public.profiles USING btree (user_id);


--
-- Name: idx_psa_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_psa_created_by ON public.profit_share_agreements USING btree (created_by);


--
-- Name: idx_psa_effective; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_psa_effective ON public.profit_share_agreements USING btree (effective_from, expires_at);


--
-- Name: idx_psa_relationship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_psa_relationship ON public.profit_share_agreements USING btree (relationship_id);


--
-- Name: idx_psa_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_psa_status ON public.profit_share_agreements USING btree (status);


--
-- Name: idx_reactions_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reactions_message ON public.chat_message_reactions USING btree (message_id);


--
-- Name: idx_receipts_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipts_message ON public.chat_message_receipts USING btree (message_id);


--
-- Name: idx_receipts_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipts_room ON public.chat_message_receipts USING btree (room_id, user_id);


--
-- Name: idx_settlement_decisions_period_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settlement_decisions_period_id ON public.settlement_decisions USING btree (settlement_period_id);


--
-- Name: idx_settlement_periods_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settlement_periods_deal ON public.settlement_periods USING btree (deal_id);


--
-- Name: idx_settlement_periods_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settlement_periods_due ON public.settlement_periods USING btree (due_at) WHERE (status = ANY (ARRAY['pending'::text, 'due'::text, 'overdue'::text]));


--
-- Name: idx_settlement_periods_relationship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settlement_periods_relationship ON public.settlement_periods USING btree (relationship_id);


--
-- Name: idx_settlement_periods_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settlement_periods_status ON public.settlement_periods USING btree (status);


--
-- Name: idx_typing_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_typing_expires ON public.chat_typing_state USING btree (expires_at);


--
-- Name: idx_typing_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_typing_room ON public.chat_typing_state USING btree (room_id) WHERE (is_typing = true);


--
-- Name: notifications_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_id_idx ON public.notifications USING btree (user_id);


--
-- Name: uniq_capital_ledger_period_non_reversal; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_capital_ledger_period_non_reversal ON public.deal_capital_ledger USING btree (period_id) WHERE ((period_id IS NOT NULL) AND (type <> 'reversal'::text));


--
-- Name: merchant_invites on_invite_status_change_notification; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_invite_status_change_notification AFTER UPDATE ON public.merchant_invites FOR EACH ROW EXECUTE FUNCTION public.notify_on_invite_status_change();


--
-- Name: merchant_invites on_new_invite_notification; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_new_invite_notification AFTER INSERT ON public.merchant_invites FOR EACH ROW EXECUTE FUNCTION public.notify_on_new_invite();


--
-- Name: profit_share_agreements trg_auto_expire_agreements; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auto_expire_agreements BEFORE INSERT OR UPDATE ON public.profit_share_agreements FOR EACH ROW EXECUTE FUNCTION public.auto_expire_agreements();


--
-- Name: otc_trades trg_auto_pause_listing_on_complete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auto_pause_listing_on_complete AFTER UPDATE ON public.otc_trades FOR EACH ROW EXECUTE FUNCTION public.fn_auto_pause_listing_on_trade_complete();


--
-- Name: otc_trades trg_auto_release_escrow; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auto_release_escrow AFTER UPDATE ON public.otc_trades FOR EACH ROW EXECUTE FUNCTION public.fn_auto_release_escrow();


--
-- Name: cash_custody_requests trg_cash_custody_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cash_custody_updated_at BEFORE UPDATE ON public.cash_custody_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: chat_messages trg_chat_deliver_receipts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chat_deliver_receipts AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.fn_chat_deliver_receipts();


--
-- Name: chat_messages trg_chat_messages_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chat_messages_updated_at BEFORE UPDATE ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: chat_messages trg_chat_notify_new_message; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chat_notify_new_message AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.fn_chat_notify_new_message();


--
-- Name: chat_presence trg_chat_presence_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chat_presence_updated_at BEFORE UPDATE ON public.chat_presence FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: chat_room_members trg_chat_room_members_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chat_room_members_updated_at BEFORE UPDATE ON public.chat_room_members FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: chat_room_policies trg_chat_room_policies_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chat_room_policies_updated_at BEFORE UPDATE ON public.chat_room_policies FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: chat_rooms trg_chat_rooms_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chat_rooms_updated_at BEFORE UPDATE ON public.chat_rooms FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: chat_typing_state trg_chat_typing_state_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chat_typing_state_updated_at BEFORE UPDATE ON public.chat_typing_state FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: deal_capital_ledger trg_notify_capital_ledger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_capital_ledger AFTER INSERT ON public.deal_capital_ledger FOR EACH ROW EXECUTE FUNCTION public.notify_capital_ledger_change();


--
-- Name: capital_transfers trg_notify_capital_transfer; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_capital_transfer AFTER INSERT ON public.capital_transfers FOR EACH ROW EXECUTE FUNCTION public.notify_on_capital_transfer();


--
-- Name: cash_custody_requests trg_notify_cash_custody; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_cash_custody AFTER INSERT ON public.cash_custody_requests FOR EACH ROW EXECUTE FUNCTION public.notify_cash_custody_request();


--
-- Name: customer_messages trg_notify_customer_message; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_customer_message AFTER INSERT ON public.customer_messages FOR EACH ROW EXECUTE FUNCTION public.fn_notify_customer_message();


--
-- Name: customer_orders trg_notify_customer_on_order_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_customer_on_order_update AFTER UPDATE ON public.customer_orders FOR EACH ROW EXECUTE FUNCTION public.notify_customer_on_order_update();


--
-- Name: customer_orders trg_notify_customer_order; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_customer_order AFTER INSERT ON public.customer_orders FOR EACH ROW EXECUTE FUNCTION public.notify_customer_order_created();


--
-- Name: merchant_deals trg_notify_merchant_deal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_merchant_deal AFTER INSERT OR UPDATE ON public.merchant_deals FOR EACH ROW EXECUTE FUNCTION public.notify_merchant_deal_change();


--
-- Name: customer_merchant_connections trg_notify_merchant_on_customer_connection; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_merchant_on_customer_connection AFTER INSERT ON public.customer_merchant_connections FOR EACH ROW EXECUTE FUNCTION public.notify_merchant_on_customer_connection();


--
-- Name: customer_orders trg_notify_merchant_on_customer_order; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_merchant_on_customer_order AFTER INSERT ON public.customer_orders FOR EACH ROW EXECUTE FUNCTION public.notify_merchant_on_customer_order();


--
-- Name: profit_share_agreements trg_notify_new_agreement; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_new_agreement AFTER INSERT ON public.profit_share_agreements FOR EACH ROW EXECUTE FUNCTION public.notify_on_new_agreement();


--
-- Name: customer_messages trg_notify_on_customer_message; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_on_customer_message AFTER INSERT ON public.customer_messages FOR EACH ROW EXECUTE FUNCTION public.notify_on_customer_message();


--
-- Name: merchant_messages trg_notify_on_new_message; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_on_new_message AFTER INSERT ON public.merchant_messages FOR EACH ROW EXECUTE FUNCTION public.notify_on_new_message();


--
-- Name: otc_trades trg_notify_otc_trade; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_otc_trade AFTER INSERT OR UPDATE ON public.otc_trades FOR EACH ROW EXECUTE FUNCTION public.fn_notify_otc_trade();


--
-- Name: merchant_profits trg_notify_profit_record; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_profit_record AFTER INSERT ON public.merchant_profits FOR EACH ROW EXECUTE FUNCTION public.notify_on_profit_record();


--
-- Name: merchant_settlements trg_notify_settlement; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_settlement AFTER INSERT ON public.merchant_settlements FOR EACH ROW EXECUTE FUNCTION public.notify_on_settlement();


--
-- Name: os_messages trg_os_after_message_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_os_after_message_insert AFTER INSERT ON public.os_messages FOR EACH ROW EXECUTE FUNCTION public.os_after_message_insert();


--
-- Name: os_messages trg_os_messages_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_os_messages_notify AFTER INSERT ON public.os_messages FOR EACH ROW EXECUTE FUNCTION public.fn_os_messages_notify_counterparty();


--
-- Name: otc_disputes trg_otc_dispute_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_otc_dispute_notify AFTER INSERT ON public.otc_disputes FOR EACH ROW EXECUTE FUNCTION public.fn_notify_otc_dispute();


--
-- Name: otc_escrow trg_otc_escrow_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_otc_escrow_notify AFTER INSERT OR UPDATE ON public.otc_escrow FOR EACH ROW EXECUTE FUNCTION public.fn_notify_otc_escrow_deposit();


--
-- Name: otc_listings trg_otc_listings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_otc_listings_updated_at BEFORE UPDATE ON public.otc_listings FOR EACH ROW EXECUTE FUNCTION public.update_otc_updated_at();


--
-- Name: otc_trades trg_otc_trade_offer_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_otc_trade_offer_notify AFTER INSERT ON public.otc_trades FOR EACH ROW EXECUTE FUNCTION public.fn_notify_otc_trade_offer();


--
-- Name: otc_trades trg_otc_trade_status_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_otc_trade_status_notify AFTER UPDATE ON public.otc_trades FOR EACH ROW EXECUTE FUNCTION public.fn_notify_otc_trade_status();


--
-- Name: otc_trades trg_otc_trades_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_otc_trades_updated_at BEFORE UPDATE ON public.otc_trades FOR EACH ROW EXECUTE FUNCTION public.update_otc_updated_at();


--
-- Name: otc_reviews trg_refresh_otc_rating; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_refresh_otc_rating AFTER INSERT ON public.otc_reviews FOR EACH ROW EXECUTE FUNCTION public.fn_refresh_otc_rating();


--
-- Name: otc_trades trg_refresh_otc_reputation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_refresh_otc_reputation AFTER UPDATE ON public.otc_trades FOR EACH ROW EXECUTE FUNCTION public.fn_refresh_otc_reputation();


--
-- Name: merchant_profiles trg_refresh_verification_tier; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_refresh_verification_tier BEFORE UPDATE ON public.merchant_profiles FOR EACH ROW EXECUTE FUNCTION public.fn_refresh_verification_tier();


--
-- Name: settlement_decisions trg_settlement_decisions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_settlement_decisions_updated_at BEFORE UPDATE ON public.settlement_decisions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: otc_escrow trg_sync_escrow_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_escrow_status AFTER INSERT OR UPDATE ON public.otc_escrow FOR EACH ROW EXECUTE FUNCTION public.fn_sync_escrow_status();


--
-- Name: deal_capital_ledger trg_validate_capital_ledger_type; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_capital_ledger_type BEFORE INSERT OR UPDATE ON public.deal_capital_ledger FOR EACH ROW EXECUTE FUNCTION public.validate_capital_ledger_type();


--
-- Name: merchant_profiles trg_validate_discoverability; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_discoverability BEFORE INSERT OR UPDATE ON public.merchant_profiles FOR EACH ROW EXECUTE FUNCTION public.validate_discoverability();


--
-- Name: merchant_profits trg_validate_profit_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_profit_status BEFORE INSERT OR UPDATE ON public.merchant_profits FOR EACH ROW EXECUTE FUNCTION public.validate_profit_status();


--
-- Name: profit_share_agreements trg_validate_psa_ratios; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_psa_ratios BEFORE INSERT OR UPDATE ON public.profit_share_agreements FOR EACH ROW EXECUTE FUNCTION public.validate_psa_ratios();


--
-- Name: profit_share_agreements trg_validate_psa_settlement_way; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_psa_settlement_way BEFORE INSERT OR UPDATE ON public.profit_share_agreements FOR EACH ROW EXECUTE FUNCTION public.validate_psa_settlement_way();


--
-- Name: profit_share_agreements trg_validate_psa_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_psa_status BEFORE INSERT OR UPDATE ON public.profit_share_agreements FOR EACH ROW EXECUTE FUNCTION public.validate_psa_status();


--
-- Name: settlement_decisions trg_validate_settlement_decision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_settlement_decision BEFORE INSERT OR UPDATE ON public.settlement_decisions FOR EACH ROW EXECUTE FUNCTION public.validate_settlement_decision();


--
-- Name: settlement_periods trg_validate_settlement_period_cadence; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_settlement_period_cadence BEFORE INSERT OR UPDATE ON public.settlement_periods FOR EACH ROW EXECUTE FUNCTION public.validate_settlement_period_cadence();


--
-- Name: settlement_periods trg_validate_settlement_period_resolution; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_settlement_period_resolution BEFORE INSERT OR UPDATE ON public.settlement_periods FOR EACH ROW EXECUTE FUNCTION public.validate_settlement_period_resolution();


--
-- Name: settlement_periods trg_validate_settlement_period_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_settlement_period_status BEFORE INSERT OR UPDATE ON public.settlement_periods FOR EACH ROW EXECUTE FUNCTION public.validate_settlement_period_status();


--
-- Name: merchant_settlements trg_validate_settlement_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_settlement_status BEFORE INSERT OR UPDATE ON public.merchant_settlements FOR EACH ROW EXECUTE FUNCTION public.validate_settlement_status();


--
-- Name: customer_merchant_connections update_cmc_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_cmc_updated_at BEFORE UPDATE ON public.customer_merchant_connections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: conversation_settings update_conversation_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_conversation_settings_updated_at BEFORE UPDATE ON public.conversation_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: customer_orders update_customer_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_customer_orders_updated_at BEFORE UPDATE ON public.customer_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: customer_profiles update_customer_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_customer_profiles_updated_at BEFORE UPDATE ON public.customer_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: merchant_approvals update_merchant_approvals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_merchant_approvals_updated_at BEFORE UPDATE ON public.merchant_approvals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: merchant_deals update_merchant_deals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_merchant_deals_updated_at BEFORE UPDATE ON public.merchant_deals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: merchant_liquidity_profiles update_merchant_liquidity_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_merchant_liquidity_profiles_updated_at BEFORE UPDATE ON public.merchant_liquidity_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: merchant_profiles update_merchant_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_merchant_profiles_updated_at BEFORE UPDATE ON public.merchant_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: merchant_relationships update_merchant_relationships_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_merchant_relationships_updated_at BEFORE UPDATE ON public.merchant_relationships FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: notification_preferences update_notification_prefs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_notification_prefs_updated_at BEFORE UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: otc_disputes update_otc_disputes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_otc_disputes_updated_at BEFORE UPDATE ON public.otc_disputes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: push_device_tokens update_push_tokens_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_push_tokens_updated_at BEFORE UPDATE ON public.push_device_tokens FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: settlement_periods update_settlement_periods_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_settlement_periods_updated_at BEFORE UPDATE ON public.settlement_periods FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: admin_audit_logs admin_audit_logs_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES auth.users(id);


--
-- Name: capital_transfers capital_transfers_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capital_transfers
    ADD CONSTRAINT capital_transfers_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.merchant_deals(id) ON DELETE SET NULL;


--
-- Name: capital_transfers capital_transfers_relationship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capital_transfers
    ADD CONSTRAINT capital_transfers_relationship_id_fkey FOREIGN KEY (relationship_id) REFERENCES public.merchant_relationships(id) ON DELETE CASCADE;


--
-- Name: cash_accounts cash_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_accounts
    ADD CONSTRAINT cash_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: cash_custody_requests cash_custody_requests_custodian_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_requests
    ADD CONSTRAINT cash_custody_requests_custodian_user_id_fkey FOREIGN KEY (custodian_user_id) REFERENCES auth.users(id);


--
-- Name: cash_custody_requests cash_custody_requests_relationship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_requests
    ADD CONSTRAINT cash_custody_requests_relationship_id_fkey FOREIGN KEY (relationship_id) REFERENCES public.merchant_relationships(id);


--
-- Name: cash_custody_requests cash_custody_requests_requester_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_custody_requests
    ADD CONSTRAINT cash_custody_requests_requester_user_id_fkey FOREIGN KEY (requester_user_id) REFERENCES auth.users(id);


--
-- Name: cash_ledger cash_ledger_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_ledger
    ADD CONSTRAINT cash_ledger_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.cash_accounts(id) ON DELETE CASCADE;


--
-- Name: cash_ledger cash_ledger_contra_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_ledger
    ADD CONSTRAINT cash_ledger_contra_account_id_fkey FOREIGN KEY (contra_account_id) REFERENCES public.cash_accounts(id) ON DELETE SET NULL;


--
-- Name: cash_ledger cash_ledger_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_ledger
    ADD CONSTRAINT cash_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chat_attachments chat_attachments_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_attachments
    ADD CONSTRAINT chat_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;


--
-- Name: chat_attachments chat_attachments_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_attachments
    ADD CONSTRAINT chat_attachments_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_attachments chat_attachments_uploader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_attachments
    ADD CONSTRAINT chat_attachments_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: chat_audit_events chat_audit_events_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_audit_events
    ADD CONSTRAINT chat_audit_events_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_audit_events chat_audit_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_audit_events
    ADD CONSTRAINT chat_audit_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: chat_call_participants chat_call_participants_call_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_call_participants
    ADD CONSTRAINT chat_call_participants_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.chat_calls(id) ON DELETE CASCADE;


--
-- Name: chat_call_participants chat_call_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_call_participants
    ADD CONSTRAINT chat_call_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chat_calls chat_calls_initiated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_calls
    ADD CONSTRAINT chat_calls_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: chat_calls chat_calls_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_calls
    ADD CONSTRAINT chat_calls_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_device_keys chat_device_keys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_device_keys
    ADD CONSTRAINT chat_device_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chat_direct_rooms chat_direct_rooms_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_direct_rooms
    ADD CONSTRAINT chat_direct_rooms_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_direct_rooms chat_direct_rooms_user_a_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_direct_rooms
    ADD CONSTRAINT chat_direct_rooms_user_a_id_fkey FOREIGN KEY (user_a_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chat_direct_rooms chat_direct_rooms_user_b_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_direct_rooms
    ADD CONSTRAINT chat_direct_rooms_user_b_id_fkey FOREIGN KEY (user_b_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chat_e2ee_sessions chat_e2ee_sessions_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_e2ee_sessions
    ADD CONSTRAINT chat_e2ee_sessions_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chat_e2ee_sessions chat_e2ee_sessions_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_e2ee_sessions
    ADD CONSTRAINT chat_e2ee_sessions_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_e2ee_sessions chat_e2ee_sessions_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_e2ee_sessions
    ADD CONSTRAINT chat_e2ee_sessions_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chat_message_reactions chat_message_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;


--
-- Name: chat_message_reactions chat_message_reactions_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_message_reactions chat_message_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chat_message_receipts chat_message_receipts_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_receipts
    ADD CONSTRAINT chat_message_receipts_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;


--
-- Name: chat_message_receipts chat_message_receipts_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_receipts
    ADD CONSTRAINT chat_message_receipts_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_message_receipts chat_message_receipts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_receipts
    ADD CONSTRAINT chat_message_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: chat_messages chat_messages_forwarded_from_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_forwarded_from_id_fkey FOREIGN KEY (forwarded_from_id) REFERENCES public.chat_messages(id) ON DELETE SET NULL;


--
-- Name: chat_messages chat_messages_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.chat_messages(id) ON DELETE SET NULL;


--
-- Name: chat_messages chat_messages_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: chat_presence chat_presence_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_presence
    ADD CONSTRAINT chat_presence_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chat_room_members chat_room_members_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: chat_room_members chat_room_members_removed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: chat_room_members chat_room_members_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_room_members chat_room_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chat_rooms chat_rooms_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: chat_rooms chat_rooms_policy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES public.chat_room_policies(id);


--
-- Name: chat_typing_state chat_typing_state_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_typing_state
    ADD CONSTRAINT chat_typing_state_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_typing_state chat_typing_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_typing_state
    ADD CONSTRAINT chat_typing_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: conversation_settings conversation_settings_relationship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_settings
    ADD CONSTRAINT conversation_settings_relationship_id_fkey FOREIGN KEY (relationship_id) REFERENCES public.merchant_relationships(id) ON DELETE CASCADE;


--
-- Name: conversation_settings conversation_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_settings
    ADD CONSTRAINT conversation_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: customer_messages customer_messages_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_messages
    ADD CONSTRAINT customer_messages_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.customer_merchant_connections(id);


--
-- Name: customer_order_events customer_order_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_order_events
    ADD CONSTRAINT customer_order_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.customer_orders(id) ON DELETE CASCADE;


--
-- Name: customer_orders customer_orders_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_orders
    ADD CONSTRAINT customer_orders_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.customer_merchant_connections(id);


--
-- Name: deal_capital_ledger deal_capital_ledger_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_capital_ledger
    ADD CONSTRAINT deal_capital_ledger_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.merchant_deals(id) ON DELETE CASCADE;


--
-- Name: deal_capital_ledger deal_capital_ledger_original_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_capital_ledger
    ADD CONSTRAINT deal_capital_ledger_original_entry_id_fkey FOREIGN KEY (original_entry_id) REFERENCES public.deal_capital_ledger(id) ON DELETE SET NULL;


--
-- Name: deal_capital_ledger deal_capital_ledger_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_capital_ledger
    ADD CONSTRAINT deal_capital_ledger_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.settlement_periods(id);


--
-- Name: deal_capital_ledger deal_capital_ledger_relationship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_capital_ledger
    ADD CONSTRAINT deal_capital_ledger_relationship_id_fkey FOREIGN KEY (relationship_id) REFERENCES public.merchant_relationships(id);


--
-- Name: market_offers market_offers_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_offers
    ADD CONSTRAINT market_offers_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: merchant_approvals merchant_approvals_relationship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_approvals
    ADD CONSTRAINT merchant_approvals_relationship_id_fkey FOREIGN KEY (relationship_id) REFERENCES public.merchant_relationships(id) ON DELETE CASCADE;


--
-- Name: merchant_approvals merchant_approvals_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_approvals
    ADD CONSTRAINT merchant_approvals_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES auth.users(id);


--
-- Name: merchant_approvals merchant_approvals_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_approvals
    ADD CONSTRAINT merchant_approvals_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES auth.users(id);


--
-- Name: merchant_deals merchant_deals_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_deals
    ADD CONSTRAINT merchant_deals_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: merchant_deals merchant_deals_relationship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_deals
    ADD CONSTRAINT merchant_deals_relationship_id_fkey FOREIGN KEY (relationship_id) REFERENCES public.merchant_relationships(id) ON DELETE CASCADE;


--
-- Name: merchant_invites merchant_invites_from_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_invites
    ADD CONSTRAINT merchant_invites_from_merchant_id_fkey FOREIGN KEY (from_merchant_id) REFERENCES public.merchant_profiles(merchant_id);


--
-- Name: merchant_invites merchant_invites_to_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_invites
    ADD CONSTRAINT merchant_invites_to_merchant_id_fkey FOREIGN KEY (to_merchant_id) REFERENCES public.merchant_profiles(merchant_id);


--
-- Name: merchant_liquidity_profiles merchant_liquidity_profiles_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_liquidity_profiles
    ADD CONSTRAINT merchant_liquidity_profiles_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchant_profiles(merchant_id) ON DELETE CASCADE;


--
-- Name: merchant_liquidity_profiles merchant_liquidity_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_liquidity_profiles
    ADD CONSTRAINT merchant_liquidity_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: merchant_messages merchant_messages_relationship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_messages
    ADD CONSTRAINT merchant_messages_relationship_id_fkey FOREIGN KEY (relationship_id) REFERENCES public.merchant_relationships(id) ON DELETE CASCADE;


--
-- Name: merchant_messages merchant_messages_reply_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_messages
    ADD CONSTRAINT merchant_messages_reply_to_fkey FOREIGN KEY (reply_to) REFERENCES public.merchant_messages(id);


--
-- Name: merchant_messages merchant_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_messages
    ADD CONSTRAINT merchant_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id);


--
-- Name: merchant_profiles merchant_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_profiles
    ADD CONSTRAINT merchant_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: merchant_profits merchant_profits_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_profits
    ADD CONSTRAINT merchant_profits_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.merchant_deals(id) ON DELETE CASCADE;


--
-- Name: merchant_profits merchant_profits_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_profits
    ADD CONSTRAINT merchant_profits_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES auth.users(id);


--
-- Name: merchant_profits merchant_profits_relationship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_profits
    ADD CONSTRAINT merchant_profits_relationship_id_fkey FOREIGN KEY (relationship_id) REFERENCES public.merchant_relationships(id);


--
-- Name: merchant_relationships merchant_relationships_merchant_a_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_relationships
    ADD CONSTRAINT merchant_relationships_merchant_a_id_fkey FOREIGN KEY (merchant_a_id) REFERENCES public.merchant_profiles(merchant_id);


--
-- Name: merchant_relationships merchant_relationships_merchant_b_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_relationships
    ADD CONSTRAINT merchant_relationships_merchant_b_id_fkey FOREIGN KEY (merchant_b_id) REFERENCES public.merchant_profiles(merchant_id);


--
-- Name: merchant_settlements merchant_settlements_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_settlements
    ADD CONSTRAINT merchant_settlements_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.merchant_deals(id) ON DELETE CASCADE;


--
-- Name: merchant_settlements merchant_settlements_relationship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_settlements
    ADD CONSTRAINT merchant_settlements_relationship_id_fkey FOREIGN KEY (relationship_id) REFERENCES public.merchant_relationships(id);


--
-- Name: merchant_settlements merchant_settlements_settled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_settlements
    ADD CONSTRAINT merchant_settlements_settled_by_fkey FOREIGN KEY (settled_by) REFERENCES auth.users(id);


--
-- Name: message_reactions message_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.os_messages(id) ON DELETE CASCADE;


--
-- Name: message_reactions message_reactions_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.os_rooms(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: order_allocations order_allocations_profit_share_agreement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_allocations
    ADD CONSTRAINT order_allocations_profit_share_agreement_id_fkey FOREIGN KEY (profit_share_agreement_id) REFERENCES public.profit_share_agreements(id);


--
-- Name: order_allocations order_allocations_relationship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_allocations
    ADD CONSTRAINT order_allocations_relationship_id_fkey FOREIGN KEY (relationship_id) REFERENCES public.merchant_relationships(id) ON DELETE CASCADE;


--
-- Name: os_audit_events os_audit_events_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_audit_events
    ADD CONSTRAINT os_audit_events_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.os_rooms(id) ON DELETE SET NULL;


--
-- Name: os_business_objects os_business_objects_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_business_objects
    ADD CONSTRAINT os_business_objects_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.os_rooms(id) ON DELETE CASCADE;


--
-- Name: os_business_objects os_business_objects_source_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_business_objects
    ADD CONSTRAINT os_business_objects_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES public.os_messages(id) ON DELETE SET NULL;


--
-- Name: os_messages os_messages_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_messages
    ADD CONSTRAINT os_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.os_rooms(id) ON DELETE CASCADE;


--
-- Name: os_messages os_messages_sender_identity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_messages
    ADD CONSTRAINT os_messages_sender_identity_id_fkey FOREIGN KEY (sender_identity_id) REFERENCES public.os_channel_identities(id) ON DELETE SET NULL;


--
-- Name: os_messages os_messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_messages
    ADD CONSTRAINT os_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.os_threads(id) ON DELETE SET NULL;


--
-- Name: os_policies os_policies_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_policies
    ADD CONSTRAINT os_policies_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.os_rooms(id) ON DELETE CASCADE;


--
-- Name: os_room_members os_room_members_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_room_members
    ADD CONSTRAINT os_room_members_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.os_rooms(id) ON DELETE CASCADE;


--
-- Name: os_room_presence os_room_presence_last_read_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_room_presence
    ADD CONSTRAINT os_room_presence_last_read_message_id_fkey FOREIGN KEY (last_read_message_id) REFERENCES public.os_messages(id) ON DELETE SET NULL;


--
-- Name: os_room_presence os_room_presence_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_room_presence
    ADD CONSTRAINT os_room_presence_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.os_rooms(id) ON DELETE CASCADE;


--
-- Name: os_threads os_threads_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_threads
    ADD CONSTRAINT os_threads_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.os_rooms(id) ON DELETE CASCADE;


--
-- Name: os_workflow_runs os_workflow_runs_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_workflow_runs
    ADD CONSTRAINT os_workflow_runs_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.os_rooms(id) ON DELETE CASCADE;


--
-- Name: os_workflow_runs os_workflow_runs_trigger_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.os_workflow_runs
    ADD CONSTRAINT os_workflow_runs_trigger_message_id_fkey FOREIGN KEY (trigger_message_id) REFERENCES public.os_messages(id) ON DELETE SET NULL;


--
-- Name: otc_disputes otc_disputes_trade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otc_disputes
    ADD CONSTRAINT otc_disputes_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES public.otc_trades(id) ON DELETE CASCADE;


--
-- Name: otc_escrow otc_escrow_trade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otc_escrow
    ADD CONSTRAINT otc_escrow_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES public.otc_trades(id) ON DELETE CASCADE;


--
-- Name: otc_reviews otc_reviews_trade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otc_reviews
    ADD CONSTRAINT otc_reviews_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES public.otc_trades(id) ON DELETE CASCADE;


--
-- Name: otc_trades otc_trades_chat_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otc_trades
    ADD CONSTRAINT otc_trades_chat_room_id_fkey FOREIGN KEY (chat_room_id) REFERENCES public.chat_rooms(id) ON DELETE SET NULL;


--
-- Name: otc_trades otc_trades_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otc_trades
    ADD CONSTRAINT otc_trades_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.otc_listings(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id);


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profit_share_agreements profit_share_agreements_relationship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profit_share_agreements
    ADD CONSTRAINT profit_share_agreements_relationship_id_fkey FOREIGN KEY (relationship_id) REFERENCES public.merchant_relationships(id) ON DELETE CASCADE;


--
-- Name: settlement_decisions settlement_decisions_agreement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_decisions
    ADD CONSTRAINT settlement_decisions_agreement_id_fkey FOREIGN KEY (agreement_id) REFERENCES public.profit_share_agreements(id);


--
-- Name: settlement_decisions settlement_decisions_settlement_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_decisions
    ADD CONSTRAINT settlement_decisions_settlement_period_id_fkey FOREIGN KEY (settlement_period_id) REFERENCES public.settlement_periods(id);


--
-- Name: settlement_periods settlement_periods_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_periods
    ADD CONSTRAINT settlement_periods_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.merchant_deals(id) ON DELETE CASCADE;


--
-- Name: settlement_periods settlement_periods_relationship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_periods
    ADD CONSTRAINT settlement_periods_relationship_id_fkey FOREIGN KEY (relationship_id) REFERENCES public.merchant_relationships(id);


--
-- Name: settlement_periods settlement_periods_settlement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_periods
    ADD CONSTRAINT settlement_periods_settlement_id_fkey FOREIGN KEY (settlement_id) REFERENCES public.merchant_settlements(id);


--
-- Name: tracker_snapshots tracker_snapshots_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracker_snapshots
    ADD CONSTRAINT tracker_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: admin_audit_logs Admins can create audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can create audit logs" ON public.admin_audit_logs FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles Admins can manage roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage roles" ON public.user_roles USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: merchant_deals Admins can update all deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update all deals" ON public.merchant_deals FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: merchant_profiles Admins can update all merchant profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update all merchant profiles" ON public.merchant_profiles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: profiles Admins can update all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: tracker_snapshots Admins can update all tracker snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update all tracker snapshots" ON public.tracker_snapshots FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: otc_disputes Admins can update disputes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update disputes" ON public.otc_disputes FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: merchant_approvals Admins can view all approvals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all approvals" ON public.merchant_approvals FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: deal_capital_ledger Admins can view all capital ledger; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all capital ledger" ON public.deal_capital_ledger FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: customer_merchant_connections Admins can view all customer connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all customer connections" ON public.customer_merchant_connections FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: customer_messages Admins can view all customer messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all customer messages" ON public.customer_messages FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: customer_orders Admins can view all customer orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all customer orders" ON public.customer_orders FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: customer_profiles Admins can view all customer profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all customer profiles" ON public.customer_profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: merchant_deals Admins can view all deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all deals" ON public.merchant_deals FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: otc_disputes Admins can view all disputes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all disputes" ON public.otc_disputes FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: merchant_invites Admins can view all invites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all invites" ON public.merchant_invites FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: merchant_profiles Admins can view all merchant profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all merchant profiles" ON public.merchant_profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: merchant_messages Admins can view all messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all messages" ON public.merchant_messages FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: notifications Admins can view all notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all notifications" ON public.notifications FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: customer_order_events Admins can view all order events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all order events" ON public.customer_order_events FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: profiles Admins can view all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: merchant_profits Admins can view all profits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all profits" ON public.merchant_profits FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: merchant_relationships Admins can view all relationships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all relationships" ON public.merchant_relationships FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles Admins can view all roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all roles" ON public.user_roles FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: settlement_periods Admins can view all settlement periods; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all settlement periods" ON public.settlement_periods FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: merchant_settlements Admins can view all settlements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all settlements" ON public.merchant_settlements FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: tracker_snapshots Admins can view all tracker snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all tracker snapshots" ON public.tracker_snapshots FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: admin_audit_logs Admins can view audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view audit logs" ON public.admin_audit_logs FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: p2p_snapshots Anyone authenticated can read P2P snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone authenticated can read P2P snapshots" ON public.p2p_snapshots FOR SELECT TO authenticated USING (true);


--
-- Name: customer_order_events Authenticated users can insert order events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert order events" ON public.customer_order_events FOR INSERT WITH CHECK (((auth.uid() = actor_user_id) AND (EXISTS ( SELECT 1
   FROM public.customer_orders o
  WHERE ((o.id = customer_order_events.order_id) AND ((o.customer_user_id = auth.uid()) OR (o.merchant_id = public.current_merchant_id())))))));


--
-- Name: merchant_liquidity_profiles Connected customers can view merchant liquidity; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Connected customers can view merchant liquidity" ON public.merchant_liquidity_profiles FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.customer_merchant_connections c
  WHERE ((c.merchant_id = merchant_liquidity_profiles.merchant_id) AND (c.customer_user_id = auth.uid()) AND (c.status = 'active'::text)))));


--
-- Name: customer_messages Connection members can send messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Connection members can send messages" ON public.customer_messages FOR INSERT WITH CHECK (((auth.uid() = sender_user_id) AND public.is_customer_connection_member(connection_id)));


--
-- Name: customer_messages Connection members can update messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Connection members can update messages" ON public.customer_messages FOR UPDATE USING (public.is_customer_connection_member(connection_id));


--
-- Name: customer_messages Connection members can view messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Connection members can view messages" ON public.customer_messages FOR SELECT USING (public.is_customer_connection_member(connection_id));


--
-- Name: customer_merchant_connections Customers can insert own connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can insert own connections" ON public.customer_merchant_connections FOR INSERT WITH CHECK ((auth.uid() = customer_user_id));


--
-- Name: customer_orders Customers can insert own orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can insert own orders" ON public.customer_orders FOR INSERT WITH CHECK ((auth.uid() = customer_user_id));


--
-- Name: customer_profiles Customers can insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can insert own profile" ON public.customer_profiles FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: merchant_profiles Customers can search public merchant profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can search public merchant profiles" ON public.merchant_profiles FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = 'customer'::text)))) AND (discoverability = 'public'::text)));


--
-- Name: customer_merchant_connections Customers can update own connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can update own connections" ON public.customer_merchant_connections FOR UPDATE USING ((auth.uid() = customer_user_id));


--
-- Name: customer_orders Customers can update own orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can update own orders" ON public.customer_orders FOR UPDATE USING ((auth.uid() = customer_user_id));


--
-- Name: customer_profiles Customers can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can update own profile" ON public.customer_profiles FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: customer_merchant_connections Customers can view own connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can view own connections" ON public.customer_merchant_connections FOR SELECT USING ((auth.uid() = customer_user_id));


--
-- Name: customer_order_events Customers can view own order events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can view own order events" ON public.customer_order_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.customer_orders o
  WHERE ((o.id = customer_order_events.order_id) AND (o.customer_user_id = auth.uid())))));


--
-- Name: customer_orders Customers can view own orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can view own orders" ON public.customer_orders FOR SELECT USING ((auth.uid() = customer_user_id));


--
-- Name: customer_profiles Customers can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can view own profile" ON public.customer_profiles FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: merchant_deals Deal creators can delete own pending deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Deal creators can delete own pending deals" ON public.merchant_deals FOR DELETE USING (((auth.uid() = created_by) AND (status = 'pending'::text)));


--
-- Name: otc_disputes Dispute participants can view; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Dispute participants can view" ON public.otc_disputes FOR SELECT USING (((opened_by = auth.uid()) OR (respondent_user_id = auth.uid())));


--
-- Name: merchant_profiles Merchant profiles visibility by discoverability; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Merchant profiles visibility by discoverability" ON public.merchant_profiles FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (discoverability = 'public'::text) OR ((discoverability = ANY (ARRAY['merchant_id_only'::text, 'hidden'::text])) AND public.has_relationship_with(public.current_merchant_id(), merchant_id))));


--
-- Name: customer_merchant_connections Merchants can update connections to them; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Merchants can update connections to them" ON public.customer_merchant_connections FOR UPDATE USING ((merchant_id = public.current_merchant_id()));


--
-- Name: customer_orders Merchants can update orders to them; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Merchants can update orders to them" ON public.customer_orders FOR UPDATE USING ((merchant_id = public.current_merchant_id()));


--
-- Name: customer_merchant_connections Merchants can view connections to them; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Merchants can view connections to them" ON public.customer_merchant_connections FOR SELECT USING ((merchant_id = public.current_merchant_id()));


--
-- Name: customer_order_events Merchants can view order events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Merchants can view order events" ON public.customer_order_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.customer_orders o
  WHERE ((o.id = customer_order_events.order_id) AND (o.merchant_id = public.current_merchant_id())))));


--
-- Name: customer_orders Merchants can view orders to them; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Merchants can view orders to them" ON public.customer_orders FOR SELECT USING ((merchant_id = public.current_merchant_id()));


--
-- Name: merchant_messages Message recipients can mark as read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Message recipients can mark as read" ON public.merchant_messages FOR UPDATE USING (public.is_relationship_member(relationship_id));


--
-- Name: cash_custody_requests Participants can update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Participants can update" ON public.cash_custody_requests FOR UPDATE TO authenticated USING (((requester_user_id = auth.uid()) OR (custodian_user_id = auth.uid())));


--
-- Name: otc_disputes Participants can update disputes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Participants can update disputes" ON public.otc_disputes FOR UPDATE USING (((opened_by = auth.uid()) OR (respondent_user_id = auth.uid())));


--
-- Name: cash_custody_requests Participants can view their requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Participants can view their requests" ON public.cash_custody_requests FOR SELECT TO authenticated USING (((requester_user_id = auth.uid()) OR (custodian_user_id = auth.uid())));


--
-- Name: merchant_invites Recipients can update invites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Recipients can update invites" ON public.merchant_invites FOR UPDATE USING ((public.current_merchant_id() = to_merchant_id));


--
-- Name: merchant_approvals Relationship members can create approvals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Relationship members can create approvals" ON public.merchant_approvals FOR INSERT WITH CHECK (((auth.uid() = submitted_by) AND public.is_relationship_member(relationship_id)));


--
-- Name: merchant_deals Relationship members can create deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Relationship members can create deals" ON public.merchant_deals FOR INSERT WITH CHECK (((auth.uid() = created_by) AND public.is_relationship_member(relationship_id)));


--
-- Name: deal_capital_ledger Relationship members can insert capital entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Relationship members can insert capital entries" ON public.deal_capital_ledger FOR INSERT WITH CHECK ((public.is_relationship_member(relationship_id) AND (auth.uid() = initiated_by)));


--
-- Name: settlement_periods Relationship members can insert settlement periods; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Relationship members can insert settlement periods" ON public.settlement_periods FOR INSERT WITH CHECK (public.is_relationship_member(relationship_id));


--
-- Name: merchant_messages Relationship members can send messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Relationship members can send messages" ON public.merchant_messages FOR INSERT WITH CHECK (((auth.uid() = sender_id) AND public.is_relationship_member(relationship_id)));


--
-- Name: merchant_approvals Relationship members can update approvals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Relationship members can update approvals" ON public.merchant_approvals FOR UPDATE USING (public.is_relationship_member(relationship_id));


--
-- Name: merchant_deals Relationship members can update deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Relationship members can update deals" ON public.merchant_deals FOR UPDATE USING (public.is_relationship_member(relationship_id));


--
-- Name: settlement_periods Relationship members can update settlement periods; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Relationship members can update settlement periods" ON public.settlement_periods FOR UPDATE USING (public.is_relationship_member(relationship_id));


--
-- Name: merchant_approvals Relationship members can view approvals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Relationship members can view approvals" ON public.merchant_approvals FOR SELECT USING (public.is_relationship_member(relationship_id));


--
-- Name: deal_capital_ledger Relationship members can view capital ledger; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Relationship members can view capital ledger" ON public.deal_capital_ledger FOR SELECT USING (public.is_relationship_member(relationship_id));


--
-- Name: merchant_deals Relationship members can view deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Relationship members can view deals" ON public.merchant_deals FOR SELECT USING (public.is_relationship_member(relationship_id));


--
-- Name: merchant_messages Relationship members can view messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Relationship members can view messages" ON public.merchant_messages FOR SELECT USING (public.is_relationship_member(relationship_id));


--
-- Name: settlement_periods Relationship members can view settlement periods; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Relationship members can view settlement periods" ON public.settlement_periods FOR SELECT USING (public.is_relationship_member(relationship_id));


--
-- Name: cash_custody_requests Requester can insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Requester can insert" ON public.cash_custody_requests FOR INSERT TO authenticated WITH CHECK ((requester_user_id = auth.uid()));


--
-- Name: notifications System can insert notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "System can insert notifications" ON public.notifications FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: merchant_settlements Users can create settlements for their deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create settlements for their deals" ON public.merchant_settlements FOR INSERT WITH CHECK (((auth.uid() = settled_by) AND (EXISTS ( SELECT 1
   FROM public.merchant_deals d
  WHERE ((d.id = merchant_settlements.deal_id) AND public.is_relationship_member(d.relationship_id))))));


--
-- Name: cash_accounts Users can delete own accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own accounts" ON public.cash_accounts FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: cash_ledger Users can delete own ledger entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own ledger entries" ON public.cash_ledger FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: push_device_tokens Users can delete own tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own tokens" ON public.push_device_tokens FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: conversation_settings Users can insert own conversation settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own conversation settings" ON public.conversation_settings FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: merchant_profiles Users can insert own merchant profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own merchant profile" ON public.merchant_profiles FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: notification_preferences Users can insert own preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own preferences" ON public.notification_preferences FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: profiles Users can insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: daily_reference_rates Users can insert own reference rates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own reference rates" ON public.daily_reference_rates FOR INSERT WITH CHECK ((auth.uid() = recorded_by));


--
-- Name: push_device_tokens Users can insert own tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own tokens" ON public.push_device_tokens FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: tracker_snapshots Users can insert own tracker state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own tracker state" ON public.tracker_snapshots FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: merchant_relationships Users can insert relationships they are part of; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert relationships they are part of" ON public.merchant_relationships FOR INSERT WITH CHECK (((public.current_merchant_id() = merchant_a_id) OR (public.current_merchant_id() = merchant_b_id)));


--
-- Name: otc_disputes Users can open disputes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can open disputes" ON public.otc_disputes FOR INSERT WITH CHECK ((opened_by = auth.uid()));


--
-- Name: merchant_profits Users can record profits for their deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can record profits for their deals" ON public.merchant_profits FOR INSERT WITH CHECK (((auth.uid() = recorded_by) AND (EXISTS ( SELECT 1
   FROM public.merchant_deals d
  WHERE ((d.id = merchant_profits.deal_id) AND public.is_relationship_member(d.relationship_id))))));


--
-- Name: merchant_invites Users can send invites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can send invites" ON public.merchant_invites FOR INSERT WITH CHECK ((public.current_merchant_id() = from_merchant_id));


--
-- Name: conversation_settings Users can update own conversation settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own conversation settings" ON public.conversation_settings FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: merchant_profiles Users can update own merchant profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own merchant profile" ON public.merchant_profiles FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: notifications Users can update own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: notification_preferences Users can update own preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own preferences" ON public.notification_preferences FOR UPDATE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: daily_reference_rates Users can update own reference rates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own reference rates" ON public.daily_reference_rates FOR UPDATE USING ((auth.uid() = recorded_by));


--
-- Name: merchant_relationships Users can update own relationships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own relationships" ON public.merchant_relationships FOR UPDATE USING (((public.current_merchant_id() = merchant_a_id) OR (public.current_merchant_id() = merchant_b_id)));


--
-- Name: push_device_tokens Users can update own tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own tokens" ON public.push_device_tokens FOR UPDATE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: tracker_snapshots Users can update own tracker state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own tracker state" ON public.tracker_snapshots FOR UPDATE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: merchant_invites Users can view invites they sent or received; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view invites they sent or received" ON public.merchant_invites FOR SELECT USING (((public.current_merchant_id() = from_merchant_id) OR (public.current_merchant_id() = to_merchant_id)));


--
-- Name: conversation_settings Users can view own conversation settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own conversation settings" ON public.conversation_settings FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: notifications Users can view own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own notifications" ON public.notifications FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: notification_preferences Users can view own preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own preferences" ON public.notification_preferences FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: daily_reference_rates Users can view own reference rates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own reference rates" ON public.daily_reference_rates FOR SELECT USING ((auth.uid() = recorded_by));


--
-- Name: merchant_relationships Users can view own relationships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own relationships" ON public.merchant_relationships FOR SELECT USING (((public.current_merchant_id() = merchant_a_id) OR (public.current_merchant_id() = merchant_b_id)));


--
-- Name: user_roles Users can view own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: push_device_tokens Users can view own tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own tokens" ON public.push_device_tokens FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: tracker_snapshots Users can view own tracker state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own tracker state" ON public.tracker_snapshots FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: merchant_profits Users can view profits for their deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view profits for their deals" ON public.merchant_profits FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.merchant_deals d
  WHERE ((d.id = merchant_profits.deal_id) AND public.is_relationship_member(d.relationship_id)))));


--
-- Name: merchant_settlements Users can view settlements for their deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view settlements for their deals" ON public.merchant_settlements FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.merchant_deals d
  WHERE ((d.id = merchant_settlements.deal_id) AND public.is_relationship_member(d.relationship_id)))));


--
-- Name: cash_accounts Users manage own cash accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own cash accounts" ON public.cash_accounts USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: cash_ledger Users manage own cash ledger; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own cash ledger" ON public.cash_ledger USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: admin_audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_attachments attachments_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attachments_member_select ON public.chat_attachments FOR SELECT TO authenticated USING (public.fn_is_chat_member(room_id, auth.uid()));


--
-- Name: chat_attachments attachments_self_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attachments_self_insert ON public.chat_attachments FOR INSERT TO authenticated WITH CHECK (((uploader_id = auth.uid()) AND public.fn_is_chat_member(room_id, auth.uid())));


--
-- Name: chat_attachments attachments_self_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attachments_self_update ON public.chat_attachments FOR UPDATE USING ((uploader_id = auth.uid())) WITH CHECK ((uploader_id = auth.uid()));


--
-- Name: chat_audit_events audit_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_admin_select ON public.chat_audit_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: chat_audit_events audit_system_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_system_insert ON public.chat_audit_events FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: balance_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.balance_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: balance_ledger bl_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bl_insert ON public.balance_ledger FOR INSERT WITH CHECK (public.is_relationship_member(relationship_id));


--
-- Name: balance_ledger bl_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bl_select ON public.balance_ledger FOR SELECT USING (public.is_relationship_member(relationship_id));


--
-- Name: chat_call_participants call_participants_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY call_participants_select ON public.chat_call_participants FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.chat_calls c
  WHERE ((c.id = chat_call_participants.call_id) AND public.fn_is_chat_member(c.room_id, auth.uid())))));


--
-- Name: chat_call_participants call_participants_upsert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY call_participants_upsert ON public.chat_call_participants TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: chat_calls calls_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calls_member_insert ON public.chat_calls FOR INSERT TO authenticated WITH CHECK (((initiated_by = auth.uid()) AND public.fn_is_chat_member(room_id, auth.uid()) AND (EXISTS ( SELECT 1
   FROM (public.chat_rooms r
     JOIN public.chat_room_policies p ON ((p.id = r.policy_id)))
  WHERE ((r.id = chat_calls.room_id) AND (p.allow_calls = true))))));


--
-- Name: chat_calls calls_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calls_member_select ON public.chat_calls FOR SELECT TO authenticated USING ((public.fn_is_chat_member(room_id, auth.uid()) AND (EXISTS ( SELECT 1
   FROM (public.chat_rooms r
     JOIN public.chat_room_policies p ON ((p.id = r.policy_id)))
  WHERE ((r.id = chat_calls.room_id) AND (p.allow_calls = true))))));


--
-- Name: chat_calls calls_member_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calls_member_update ON public.chat_calls FOR UPDATE TO authenticated USING (public.fn_is_chat_member(room_id, auth.uid()));


--
-- Name: capital_transfers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.capital_transfers ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_custody_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cash_custody_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cash_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_call_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_call_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_calls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_calls ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_device_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_device_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_direct_rooms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_direct_rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_e2ee_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_e2ee_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_message_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_message_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_message_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_message_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_presence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_presence ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_privacy_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_privacy_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_room_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_room_members ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_room_policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_room_policies ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_rooms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_typing_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_typing_state ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_privacy_settings cps_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cps_insert_own ON public.chat_privacy_settings FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: chat_privacy_settings cps_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cps_select_own ON public.chat_privacy_settings FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: chat_privacy_settings cps_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cps_update_own ON public.chat_privacy_settings FOR UPDATE USING ((user_id = auth.uid()));


--
-- Name: capital_transfers ct_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ct_insert ON public.capital_transfers FOR INSERT WITH CHECK ((public.is_relationship_member(relationship_id) AND (auth.uid() = transferred_by)));


--
-- Name: capital_transfers ct_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ct_select ON public.capital_transfers FOR SELECT USING (public.is_relationship_member(relationship_id));


--
-- Name: customer_merchant_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_merchant_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_order_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_order_events ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_reference_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_reference_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_capital dc_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dc_insert ON public.deal_capital FOR INSERT WITH CHECK (public.is_relationship_member(relationship_id));


--
-- Name: deal_capital dc_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dc_select ON public.deal_capital FOR SELECT USING (public.is_relationship_member(relationship_id));


--
-- Name: deal_capital; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_capital ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_capital_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_capital_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_device_keys device_keys_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY device_keys_select ON public.chat_device_keys FOR SELECT TO authenticated USING (true);


--
-- Name: chat_device_keys device_keys_self_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY device_keys_self_write ON public.chat_device_keys TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: chat_direct_rooms direct_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY direct_insert ON public.chat_direct_rooms FOR INSERT TO authenticated WITH CHECK (((user_a_id = auth.uid()) OR (user_b_id = auth.uid())));


--
-- Name: chat_direct_rooms direct_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY direct_select ON public.chat_direct_rooms FOR SELECT TO authenticated USING (((user_a_id = auth.uid()) OR (user_b_id = auth.uid())));


--
-- Name: chat_e2ee_sessions e2ee_sessions_participant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY e2ee_sessions_participant ON public.chat_e2ee_sessions FOR SELECT TO authenticated USING (((sender_id = auth.uid()) OR (recipient_id = auth.uid())));


--
-- Name: chat_e2ee_sessions e2ee_sessions_sender_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY e2ee_sessions_sender_write ON public.chat_e2ee_sessions TO authenticated USING ((sender_id = auth.uid())) WITH CHECK ((sender_id = auth.uid()));


--
-- Name: otc_escrow escrow_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY escrow_insert ON public.otc_escrow FOR INSERT TO authenticated WITH CHECK (((depositor_user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.otc_trades t
  WHERE ((t.id = otc_escrow.trade_id) AND ((t.initiator_user_id = auth.uid()) OR (t.responder_user_id = auth.uid())))))));


--
-- Name: otc_escrow escrow_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY escrow_select ON public.otc_escrow FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.otc_trades t
  WHERE ((t.id = otc_escrow.trade_id) AND ((t.initiator_user_id = auth.uid()) OR (t.responder_user_id = auth.uid()))))));


--
-- Name: otc_escrow escrow_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY escrow_update ON public.otc_escrow FOR UPDATE TO authenticated USING (((depositor_user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.otc_trades t
  WHERE ((t.id = otc_escrow.trade_id) AND ((t.initiator_user_id = auth.uid()) OR (t.responder_user_id = auth.uid())))))));


--
-- Name: gas_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gas_log ENABLE ROW LEVEL SECURITY;

--
-- Name: gas_log gl_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gl_all ON public.gas_log USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: market_offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_offers ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_room_members members_insert_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_insert_self ON public.chat_room_members FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: chat_room_members members_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_select ON public.chat_room_members FOR SELECT TO authenticated USING (public.fn_is_chat_member(room_id, auth.uid()));


--
-- Name: chat_room_members members_update_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_update_self ON public.chat_room_members FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: merchant_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merchant_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: merchant_deals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merchant_deals ENABLE ROW LEVEL SECURITY;

--
-- Name: merchant_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merchant_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: merchant_liquidity_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merchant_liquidity_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: merchant_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merchant_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: merchant_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merchant_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: merchant_profits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merchant_profits ENABLE ROW LEVEL SECURITY;

--
-- Name: merchant_relationships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merchant_relationships ENABLE ROW LEVEL SECURITY;

--
-- Name: merchant_settlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merchant_settlements ENABLE ROW LEVEL SECURITY;

--
-- Name: message_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages messages_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_member_insert ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (((sender_id = auth.uid()) AND public.fn_is_chat_member(room_id, auth.uid())));


--
-- Name: chat_messages messages_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_member_select ON public.chat_messages FOR SELECT TO authenticated USING ((public.fn_is_chat_member(room_id, auth.uid()) AND ((is_deleted = false) OR (deleted_by = auth.uid()))));


--
-- Name: chat_messages messages_sender_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_sender_update ON public.chat_messages FOR UPDATE TO authenticated USING (((sender_id = auth.uid()) AND public.fn_is_chat_member(room_id, auth.uid()))) WITH CHECK ((sender_id = auth.uid()));


--
-- Name: merchant_liquidity_profiles mlp_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mlp_insert ON public.merchant_liquidity_profiles FOR INSERT WITH CHECK (((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM public.merchant_profiles me
  WHERE ((me.user_id = auth.uid()) AND (me.merchant_id = merchant_liquidity_profiles.merchant_id))))));


--
-- Name: merchant_liquidity_profiles mlp_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mlp_select ON public.merchant_liquidity_profiles FOR SELECT USING (((auth.uid() = user_id) OR (visibility_scope = 'network'::text) OR (EXISTS ( SELECT 1
   FROM (public.merchant_profiles me
     JOIN public.merchant_relationships rel ON ((((rel.merchant_a_id = me.merchant_id) AND (rel.merchant_b_id = merchant_liquidity_profiles.merchant_id)) OR ((rel.merchant_b_id = me.merchant_id) AND (rel.merchant_a_id = merchant_liquidity_profiles.merchant_id)))))
  WHERE ((me.user_id = auth.uid()) AND (rel.status = ANY (ARRAY['active'::text, 'pending'::text])))))));


--
-- Name: merchant_liquidity_profiles mlp_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mlp_update ON public.merchant_liquidity_profiles FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: market_offers mo_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mo_insert ON public.market_offers FOR INSERT WITH CHECK (((user_id = auth.uid()) AND public.fn_is_chat_member(room_id, auth.uid())));


--
-- Name: market_offers mo_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mo_select ON public.market_offers FOR SELECT USING (public.fn_is_chat_member(room_id, auth.uid()));


--
-- Name: market_offers mo_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mo_update ON public.market_offers FOR UPDATE USING ((user_id = auth.uid()));


--
-- Name: message_reactions mr_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mr_delete ON public.message_reactions FOR DELETE USING ((user_id = public.current_merchant_id()));


--
-- Name: message_reactions mr_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mr_insert ON public.message_reactions FOR INSERT WITH CHECK (((user_id = public.current_merchant_id()) AND (EXISTS ( SELECT 1
   FROM public.os_room_members
  WHERE ((os_room_members.room_id = message_reactions.room_id) AND (os_room_members.merchant_id = public.current_merchant_id()))))));


--
-- Name: message_reactions mr_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mr_select ON public.message_reactions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.os_room_members
  WHERE ((os_room_members.room_id = message_reactions.room_id) AND (os_room_members.merchant_id = public.current_merchant_id())))));


--
-- Name: notification_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: order_allocations oa_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY oa_insert ON public.order_allocations FOR INSERT WITH CHECK (public.is_relationship_member(relationship_id));


--
-- Name: order_allocations oa_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY oa_select ON public.order_allocations FOR SELECT USING (public.is_relationship_member(relationship_id));


--
-- Name: order_allocations oa_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY oa_update ON public.order_allocations FOR UPDATE USING (public.is_relationship_member(relationship_id));


--
-- Name: order_allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: os_audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.os_audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: os_audit_events os_audit_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_audit_insert ON public.os_audit_events FOR INSERT WITH CHECK ((actor_merchant_id = public.current_merchant_id()));


--
-- Name: os_audit_events os_audit_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_audit_select ON public.os_audit_events FOR SELECT USING ((((room_id IS NOT NULL) AND public.is_os_room_member(room_id)) OR ((room_id IS NULL) AND public.has_role(auth.uid(), 'admin'::public.app_role))));


--
-- Name: os_business_objects os_bo_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_bo_insert ON public.os_business_objects FOR INSERT WITH CHECK (public.is_os_room_member(room_id));


--
-- Name: os_business_objects os_bo_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_bo_select ON public.os_business_objects FOR SELECT USING (public.is_os_room_member(room_id));


--
-- Name: os_business_objects os_bo_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_bo_update ON public.os_business_objects FOR UPDATE USING (public.is_os_room_member(room_id));


--
-- Name: os_business_objects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.os_business_objects ENABLE ROW LEVEL SECURITY;

--
-- Name: os_channel_identities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.os_channel_identities ENABLE ROW LEVEL SECURITY;

--
-- Name: os_channel_identities os_ci_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_ci_select ON public.os_channel_identities FOR SELECT TO authenticated USING ((merchant_id = public.current_merchant_id()));


--
-- Name: os_channel_identities os_identities_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_identities_insert ON public.os_channel_identities FOR INSERT WITH CHECK ((merchant_id = public.current_merchant_id()));


--
-- Name: os_channel_identities os_identities_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_identities_update ON public.os_channel_identities FOR UPDATE USING ((merchant_id = public.current_merchant_id()));


--
-- Name: os_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.os_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: os_messages os_messages_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_messages_insert ON public.os_messages FOR INSERT WITH CHECK ((public.is_os_room_member(room_id) AND (sender_merchant_id = public.current_merchant_id())));


--
-- Name: os_messages os_messages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_messages_select ON public.os_messages FOR SELECT USING (public.is_os_room_member(room_id));


--
-- Name: os_messages os_messages_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_messages_update ON public.os_messages FOR UPDATE USING (public.is_os_room_member(room_id));


--
-- Name: os_policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.os_policies ENABLE ROW LEVEL SECURITY;

--
-- Name: os_policies os_policies_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_policies_insert ON public.os_policies FOR INSERT WITH CHECK ((((room_id IS NOT NULL) AND public.is_os_room_member(room_id)) OR ((room_id IS NULL) AND public.has_role(auth.uid(), 'admin'::public.app_role))));


--
-- Name: os_policies os_policies_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_policies_select ON public.os_policies FOR SELECT USING (((room_id IS NULL) OR public.is_os_room_member(room_id)));


--
-- Name: os_room_presence os_presence_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_presence_select ON public.os_room_presence FOR SELECT USING (public.is_os_room_member(room_id));


--
-- Name: os_room_presence os_presence_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_presence_update ON public.os_room_presence FOR UPDATE USING ((merchant_id = public.current_merchant_id()));


--
-- Name: os_room_presence os_presence_upsert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_presence_upsert ON public.os_room_presence FOR INSERT WITH CHECK (((merchant_id = public.current_merchant_id()) AND public.is_os_room_member(room_id)));


--
-- Name: os_room_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.os_room_members ENABLE ROW LEVEL SECURITY;

--
-- Name: os_room_members os_room_members_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_room_members_insert ON public.os_room_members FOR INSERT WITH CHECK ((public.is_os_room_member(room_id) OR (merchant_id = public.current_merchant_id())));


--
-- Name: os_room_members os_room_members_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_room_members_select ON public.os_room_members FOR SELECT USING (public.is_os_room_member(room_id));


--
-- Name: os_room_presence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.os_room_presence ENABLE ROW LEVEL SECURITY;

--
-- Name: os_rooms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.os_rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: os_rooms os_rooms_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_rooms_insert ON public.os_rooms FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: os_rooms os_rooms_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_rooms_select ON public.os_rooms FOR SELECT USING (public.is_os_room_member(id));


--
-- Name: os_rooms os_rooms_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_rooms_update ON public.os_rooms FOR UPDATE USING (public.is_os_room_member(id));


--
-- Name: os_threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.os_threads ENABLE ROW LEVEL SECURITY;

--
-- Name: os_threads os_threads_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_threads_insert ON public.os_threads FOR INSERT WITH CHECK (public.is_os_room_member(room_id));


--
-- Name: os_threads os_threads_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_threads_select ON public.os_threads FOR SELECT USING (public.is_os_room_member(room_id));


--
-- Name: os_workflow_runs os_wf_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_wf_insert ON public.os_workflow_runs FOR INSERT WITH CHECK (public.is_os_room_member(room_id));


--
-- Name: os_workflow_runs os_wf_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_wf_select ON public.os_workflow_runs FOR SELECT USING (public.is_os_room_member(room_id));


--
-- Name: os_workflow_runs os_wf_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY os_wf_update ON public.os_workflow_runs FOR UPDATE USING (public.is_os_room_member(room_id));


--
-- Name: os_workflow_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.os_workflow_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: otc_disputes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.otc_disputes ENABLE ROW LEVEL SECURITY;

--
-- Name: otc_escrow; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.otc_escrow ENABLE ROW LEVEL SECURITY;

--
-- Name: otc_listings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.otc_listings ENABLE ROW LEVEL SECURITY;

--
-- Name: otc_listings otc_listings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY otc_listings_delete ON public.otc_listings FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: otc_listings otc_listings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY otc_listings_insert ON public.otc_listings FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: otc_listings otc_listings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY otc_listings_select ON public.otc_listings FOR SELECT TO authenticated USING (true);


--
-- Name: otc_listings otc_listings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY otc_listings_update ON public.otc_listings FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: otc_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.otc_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: otc_trades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.otc_trades ENABLE ROW LEVEL SECURITY;

--
-- Name: otc_trades otc_trades_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY otc_trades_delete ON public.otc_trades FOR DELETE TO authenticated USING (((initiator_user_id = auth.uid()) OR (responder_user_id = auth.uid())));


--
-- Name: otc_trades otc_trades_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY otc_trades_insert ON public.otc_trades FOR INSERT TO authenticated WITH CHECK ((initiator_user_id = auth.uid()));


--
-- Name: otc_trades otc_trades_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY otc_trades_select ON public.otc_trades FOR SELECT TO authenticated USING (((initiator_user_id = auth.uid()) OR (responder_user_id = auth.uid())));


--
-- Name: otc_trades otc_trades_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY otc_trades_update ON public.otc_trades FOR UPDATE TO authenticated USING (((initiator_user_id = auth.uid()) OR (responder_user_id = auth.uid())));


--
-- Name: p2p_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.p2p_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_call_participants participants_self_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participants_self_update ON public.chat_call_participants FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: chat_room_policies policies_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY policies_authenticated_read ON public.chat_room_policies FOR SELECT TO authenticated USING (true);


--
-- Name: profit_records pr_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pr_insert ON public.profit_records FOR INSERT WITH CHECK (public.is_relationship_member(relationship_id));


--
-- Name: profit_records pr_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pr_select ON public.profit_records FOR SELECT USING (public.is_relationship_member(relationship_id));


--
-- Name: chat_presence presence_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY presence_member_select ON public.chat_presence FOR SELECT TO authenticated USING (public.fn_is_presence_visible(user_id, auth.uid()));


--
-- Name: chat_presence presence_self_upsert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY presence_self_upsert ON public.chat_presence TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profit_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profit_records ENABLE ROW LEVEL SECURITY;

--
-- Name: profit_share_agreements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profit_share_agreements ENABLE ROW LEVEL SECURITY;

--
-- Name: profit_share_agreements psa_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY psa_insert ON public.profit_share_agreements FOR INSERT WITH CHECK (public.is_relationship_member(relationship_id));


--
-- Name: profit_share_agreements psa_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY psa_select ON public.profit_share_agreements FOR SELECT USING (public.is_relationship_member(relationship_id));


--
-- Name: profit_share_agreements psa_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY psa_update ON public.profit_share_agreements FOR UPDATE USING (public.is_relationship_member(relationship_id));


--
-- Name: push_device_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_device_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_message_reactions reactions_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reactions_member_select ON public.chat_message_reactions FOR SELECT TO authenticated USING (public.fn_is_chat_member(room_id, auth.uid()));


--
-- Name: chat_message_reactions reactions_self_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reactions_self_all ON public.chat_message_reactions TO authenticated USING ((user_id = auth.uid())) WITH CHECK (((user_id = auth.uid()) AND public.fn_is_chat_member(room_id, auth.uid())));


--
-- Name: chat_message_receipts receipts_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY receipts_member_select ON public.chat_message_receipts FOR SELECT TO authenticated USING (public.fn_is_chat_member(room_id, auth.uid()));


--
-- Name: chat_message_receipts receipts_self_upsert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY receipts_self_upsert ON public.chat_message_receipts TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: otc_reviews reviews_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reviews_insert ON public.otc_reviews FOR INSERT TO authenticated WITH CHECK (((reviewer_user_id = auth.uid()) AND (reviewer_user_id <> reviewed_user_id) AND (EXISTS ( SELECT 1
   FROM public.otc_trades t
  WHERE ((t.id = otc_reviews.trade_id) AND (t.status = 'completed'::text) AND ((t.initiator_user_id = auth.uid()) OR (t.responder_user_id = auth.uid())))))));


--
-- Name: otc_reviews reviews_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reviews_select ON public.otc_reviews FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.otc_trades t
  WHERE ((t.id = otc_reviews.trade_id) AND ((t.initiator_user_id = auth.uid()) OR (t.responder_user_id = auth.uid()))))) OR (reviewed_user_id = auth.uid())));


--
-- Name: chat_rooms rooms_creator_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rooms_creator_insert ON public.chat_rooms FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));


--
-- Name: chat_rooms rooms_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rooms_member_select ON public.chat_rooms FOR SELECT TO authenticated USING (public.fn_is_chat_member(id, auth.uid()));


--
-- Name: chat_rooms rooms_member_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rooms_member_update ON public.chat_rooms FOR UPDATE TO authenticated USING (public.fn_is_chat_member(id, auth.uid())) WITH CHECK (public.fn_is_chat_member(id, auth.uid()));


--
-- Name: settlement_decisions sd_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sd_insert ON public.settlement_decisions FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profit_share_agreements psa
  WHERE ((psa.id = settlement_decisions.agreement_id) AND public.is_relationship_member(psa.relationship_id)))));


--
-- Name: settlement_decisions sd_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sd_select ON public.settlement_decisions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profit_share_agreements psa
  WHERE ((psa.id = settlement_decisions.agreement_id) AND public.is_relationship_member(psa.relationship_id)))));


--
-- Name: settlement_decisions sd_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sd_update ON public.settlement_decisions FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profit_share_agreements psa
  WHERE ((psa.id = settlement_decisions.agreement_id) AND public.is_relationship_member(psa.relationship_id)))));


--
-- Name: settlement_decisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settlement_decisions ENABLE ROW LEVEL SECURITY;

--
-- Name: settlement_overviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settlement_overviews ENABLE ROW LEVEL SECURITY;

--
-- Name: settlement_periods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settlement_periods ENABLE ROW LEVEL SECURITY;

--
-- Name: settlement_overviews so_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY so_insert ON public.settlement_overviews FOR INSERT WITH CHECK (public.is_relationship_member(relationship_id));


--
-- Name: settlement_overviews so_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY so_select ON public.settlement_overviews FOR SELECT USING (public.is_relationship_member(relationship_id));


--
-- Name: settlement_overviews so_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY so_update ON public.settlement_overviews FOR UPDATE USING (public.is_relationship_member(relationship_id));


--
-- Name: tracker_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tracker_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: tracker_states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tracker_states ENABLE ROW LEVEL SECURITY;

--
-- Name: tracker_states ts_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ts_all ON public.tracker_states USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: chat_typing_state typing_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY typing_member_select ON public.chat_typing_state FOR SELECT TO authenticated USING (public.fn_is_chat_member(room_id, auth.uid()));


--
-- Name: chat_typing_state typing_self_upsert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY typing_self_upsert ON public.chat_typing_state TO authenticated USING ((user_id = auth.uid())) WITH CHECK (((user_id = auth.uid()) AND public.fn_is_chat_member(room_id, auth.uid())));


--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict ggXi6RLofO1ClW70VYf5R6vN2XLf7zl0QlvuY24VMATuqNA5PM8dWqTfnwzKz8E


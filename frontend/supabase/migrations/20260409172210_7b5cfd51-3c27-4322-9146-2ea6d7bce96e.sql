
CREATE OR REPLACE FUNCTION public.chat_run_expiry_cleanup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.chat_run_expiry_cleanup() FROM public;
GRANT EXECUTE ON FUNCTION public.chat_run_expiry_cleanup() TO authenticated;

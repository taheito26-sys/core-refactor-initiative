
CREATE OR REPLACE FUNCTION public.chat_run_expiry_cleanup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _expired_messages     int;
  _expired_offers       int;
  _cleaned_attachments  int;
  _cleaned_storage      int;
  _cutoff               timestamptz := now() - interval '2 hours';
BEGIN
  -- 1. Expire messages
  WITH expired AS (
    UPDATE public.chat_messages
       SET is_deleted = true, deleted_at = now()
     WHERE expires_at IS NOT NULL
       AND expires_at < now()
       AND is_deleted = false
    RETURNING id
  )
  SELECT count(*) INTO _expired_messages FROM expired;

  -- 2. Expire market offers
  WITH expired_offers AS (
    UPDATE public.market_offers
       SET status = 'expired', updated_at = now()
     WHERE expires_at IS NOT NULL
       AND expires_at < now()
       AND status = 'active'
    RETURNING id
  )
  SELECT count(*) INTO _expired_offers FROM expired_offers;

  -- 3. Delete abandoned attachments (no message_id, older than 2 hours)
  --    First collect their storage paths, then delete storage objects, then attachments.
  WITH abandoned AS (
    SELECT id, storage_path
      FROM public.chat_attachments
     WHERE message_id IS NULL
       AND created_at < _cutoff
  ),
  deleted_storage AS (
    DELETE FROM storage.objects
     WHERE bucket_id = 'chat-attachments'
       AND name IN (SELECT storage_path FROM abandoned)
    RETURNING id
  ),
  deleted_attachments AS (
    DELETE FROM public.chat_attachments
     WHERE id IN (SELECT id FROM abandoned)
    RETURNING id
  )
  SELECT
    (SELECT count(*) FROM deleted_attachments),
    (SELECT count(*) FROM deleted_storage)
  INTO _cleaned_attachments, _cleaned_storage;

  RETURN jsonb_build_object(
    'expired_messages',      _expired_messages,
    'expired_offers',        _expired_offers,
    'cleaned_attachments',   _cleaned_attachments,
    'cleaned_storage_objects', _cleaned_storage,
    'ran_at',                now()
  );
END;
$$;

-- Keep callable by authenticated users only
REVOKE ALL ON FUNCTION public.chat_run_expiry_cleanup() FROM public;
GRANT EXECUTE ON FUNCTION public.chat_run_expiry_cleanup() TO authenticated;

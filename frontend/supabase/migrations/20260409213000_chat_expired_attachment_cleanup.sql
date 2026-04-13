-- Purge attachment rows and blobs for messages that have already expired or been deleted.

CREATE OR REPLACE FUNCTION public.chat_run_expiry_cleanup()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _expired_messages INTEGER := 0;
  _expired_offers INTEGER := 0;
  _cleaned_attachments INTEGER := 0;
  _cleaned_storage_objects INTEGER := 0;
BEGIN
  UPDATE public.chat_messages
  SET is_deleted = TRUE,
      deleted_at = COALESCE(deleted_at, now()),
      content = '',
      metadata = jsonb_build_object('expired', TRUE, 'expired_at', now()),
      updated_at = now()
  WHERE expires_at IS NOT NULL
    AND expires_at <= now()
    AND is_deleted = FALSE;

  GET DIAGNOSTICS _expired_messages = ROW_COUNT;

  UPDATE public.market_offers
  SET status = 'expired',
      updated_at = now()
  WHERE status = 'active'
    AND expires_at IS NOT NULL
    AND expires_at <= now();

  GET DIAGNOSTICS _expired_offers = ROW_COUNT;

  WITH deleted_attachments AS (
    DELETE FROM public.chat_attachments a
    USING public.chat_messages m
    WHERE a.message_id = m.id
      AND m.is_deleted = TRUE
      AND COALESCE(m.deleted_at, m.updated_at, m.created_at) <= now() - interval '5 minutes'
    RETURNING a.storage_path
  ),
  stale_unattached AS (
    DELETE FROM public.chat_attachments
    WHERE message_id IS NULL
      AND created_at <= now() - interval '2 hours'
    RETURNING storage_path
  ),
  all_deleted_attachments AS (
    SELECT storage_path FROM deleted_attachments
    UNION ALL
    SELECT storage_path FROM stale_unattached
  ),
  deleted_objects AS (
    DELETE FROM storage.objects so
    USING all_deleted_attachments da
    WHERE so.bucket_id = 'chat-attachments'
      AND so.name = da.storage_path
    RETURNING so.name
  )
  SELECT
    (SELECT count(*)::INTEGER FROM all_deleted_attachments),
    (SELECT count(*)::INTEGER FROM deleted_objects)
  INTO _cleaned_attachments, _cleaned_storage_objects;

  RETURN jsonb_build_object(
    'expired_messages', _expired_messages,
    'expired_offers', _expired_offers,
    'cleaned_attachments', _cleaned_attachments,
    'cleaned_storage_objects', _cleaned_storage_objects,
    'ran_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.chat_run_expiry_cleanup() TO authenticated;

-- Enforce room-aware attachment registration and tighten storage upload paths.

CREATE OR REPLACE FUNCTION public.chat_is_allowed_mime(
  _mime_type TEXT,
  _allowed_mime_types TEXT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  _allowed TEXT;
BEGIN
  IF _allowed_mime_types IS NULL OR array_length(_allowed_mime_types, 1) IS NULL THEN
    RETURN TRUE;
  END IF;

  FOREACH _allowed IN ARRAY _allowed_mime_types LOOP
    IF right(_allowed, 2) = '/*' THEN
      IF _mime_type LIKE replace(_allowed, '/*', '/%') THEN
        RETURN TRUE;
      END IF;
    ELSIF _mime_type = _allowed THEN
      RETURN TRUE;
    END IF;
  END LOOP;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_create_attachment(
  _room_id UUID,
  _storage_path TEXT,
  _file_name TEXT,
  _file_size BIGINT,
  _mime_type TEXT,
  _thumbnail_path TEXT DEFAULT NULL,
  _duration_ms INTEGER DEFAULT NULL,
  _width INTEGER DEFAULT NULL,
  _height INTEGER DEFAULT NULL,
  _waveform JSONB DEFAULT NULL,
  _checksum_sha256 TEXT DEFAULT NULL,
  _cdn_url TEXT DEFAULT NULL,
  _is_encrypted BOOLEAN DEFAULT FALSE,
  _iv TEXT DEFAULT NULL,
  _auth_tag TEXT DEFAULT NULL
)
RETURNS public.chat_attachments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _policy public.chat_room_policies;
  _attachment public.chat_attachments;
  _path_prefix TEXT;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.fn_is_chat_member(_room_id, _uid) THEN
    RAISE EXCEPTION 'Not a member of this room';
  END IF;

  SELECT p.*
  INTO _policy
  FROM public.chat_rooms r
  JOIN public.chat_room_policies p ON p.id = r.policy_id
  WHERE r.id = _room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room policy not found';
  END IF;

  _path_prefix := _uid::TEXT || '/' || _room_id::TEXT || '/';
  IF position(_path_prefix IN _storage_path) <> 1 THEN
    RAISE EXCEPTION 'Attachment path must be namespaced under your user and room';
  END IF;

  IF _mime_type LIKE 'image/%' OR _mime_type LIKE 'video/%' THEN
    IF NOT coalesce(_policy.allow_images, TRUE) THEN
      RAISE EXCEPTION 'Images and videos are disabled in this room';
    END IF;
  ELSIF _mime_type LIKE 'audio/%' THEN
    IF NOT coalesce(_policy.allow_voice_notes, TRUE) THEN
      RAISE EXCEPTION 'Voice notes are disabled in this room';
    END IF;
  ELSE
    IF NOT coalesce(_policy.allow_files, TRUE) THEN
      RAISE EXCEPTION 'File uploads are disabled in this room';
    END IF;
  END IF;

  IF _file_size > (coalesce(_policy.max_file_size_mb, 50)::BIGINT * 1024 * 1024) THEN
    RAISE EXCEPTION 'File exceeds maximum size of %MB', coalesce(_policy.max_file_size_mb, 50);
  END IF;

  IF NOT public.chat_is_allowed_mime(_mime_type, _policy.allowed_mime_types) THEN
    RAISE EXCEPTION 'File type "%" is not allowed in this room', _mime_type;
  END IF;

  INSERT INTO public.chat_attachments (
    room_id,
    uploader_id,
    storage_path,
    cdn_url,
    file_name,
    file_size,
    mime_type,
    thumbnail_path,
    duration_ms,
    width,
    height,
    waveform,
    checksum_sha256,
    is_validated,
    is_encrypted,
    iv,
    auth_tag
  )
  VALUES (
    _room_id,
    _uid,
    _storage_path,
    _cdn_url,
    _file_name,
    _file_size,
    _mime_type,
    _thumbnail_path,
    _duration_ms,
    _width,
    _height,
    _waveform,
    _checksum_sha256,
    TRUE,
    coalesce(_is_encrypted, FALSE),
    _iv,
    _auth_tag
  )
  RETURNING *
  INTO _attachment;

  RETURN _attachment;
END;
$$;

REVOKE ALL ON FUNCTION public.chat_create_attachment(
  UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, JSONB, TEXT, TEXT, BOOLEAN, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_create_attachment(
  UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, JSONB, TEXT, TEXT, BOOLEAN, TEXT, TEXT
) TO authenticated;

DROP POLICY IF EXISTS "chat_attachments_upload" ON storage.objects;
CREATE POLICY "chat_attachments_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
    AND EXISTS (
      SELECT 1
      FROM public.chat_rooms r
      WHERE r.id::TEXT = (storage.foldername(name))[2]
        AND public.fn_is_chat_member(r.id, auth.uid())
    )
  );

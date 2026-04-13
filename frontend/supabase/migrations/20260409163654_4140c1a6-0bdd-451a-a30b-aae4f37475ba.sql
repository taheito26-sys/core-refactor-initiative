
-- 1. Helper: check if a MIME type is allowed by a whitelist (supports wildcards like image/*)
CREATE OR REPLACE FUNCTION public.chat_is_allowed_mime(
  _mime_type text,
  _allowed_mime_types text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    _allowed_mime_types IS NULL                          -- NULL = allow all
    OR _mime_type = ANY(_allowed_mime_types)             -- exact match
    OR (split_part(_mime_type, '/', 1) || '/*') = ANY(_allowed_mime_types)  -- wildcard
$$;

-- 2. RPC: validated attachment creation
CREATE OR REPLACE FUNCTION public.chat_create_attachment(
  _room_id       uuid,
  _message_id    uuid,
  _storage_path  text,
  _file_name     text,
  _file_size     bigint,
  _mime_type     text,
  _cdn_url       text       DEFAULT NULL,
  _thumbnail_path text      DEFAULT NULL,
  _duration_ms   integer    DEFAULT NULL,
  _width         integer    DEFAULT NULL,
  _height        integer    DEFAULT NULL,
  _waveform      jsonb      DEFAULT NULL,
  _checksum_sha256 text     DEFAULT NULL,
  _is_encrypted  boolean    DEFAULT false,
  _iv            text       DEFAULT NULL,
  _auth_tag      text       DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- 3. Replace the overly-permissive upload policy with folder-gated version
DROP POLICY IF EXISTS "chat_attachments_upload" ON storage.objects;

CREATE POLICY "chat_attachments_upload"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND fn_is_chat_member((storage.foldername(name))[2]::uuid, auth.uid())
);

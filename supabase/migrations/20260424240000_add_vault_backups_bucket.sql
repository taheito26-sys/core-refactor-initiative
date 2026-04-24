-- Create a private storage bucket for user vault backups.
-- Each user stores files under their own user_id folder.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vault-backups', 'vault-backups', false, 10485760, ARRAY['application/json'])
ON CONFLICT (id) DO NOTHING;

-- RLS: users can only access their own folder (user_id prefix)
CREATE POLICY "Users can upload own vault backups"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vault-backups' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can read own vault backups"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'vault-backups' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own vault backups"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'vault-backups' AND (storage.foldername(name))[1] = auth.uid()::text);

NOTIFY pgrst, 'reload schema';

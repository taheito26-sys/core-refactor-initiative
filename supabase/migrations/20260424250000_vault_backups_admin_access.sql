-- Allow admins to read, write, and delete ALL users' vault backups.
-- Admin bulk backup/restore from the admin panel needs this.

CREATE POLICY "Admins can read all vault backups"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'vault-backups' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can upload all vault backups"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vault-backups' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete all vault backups"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'vault-backups' AND public.has_role(auth.uid(), 'admin'));

NOTIFY pgrst, 'reload schema';

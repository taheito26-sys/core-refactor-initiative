-- Allow uploaders to update their own attachments (link to message)
CREATE POLICY "attachments_self_update"
ON public.chat_attachments
FOR UPDATE
USING (uploader_id = auth.uid())
WITH CHECK (uploader_id = auth.uid());
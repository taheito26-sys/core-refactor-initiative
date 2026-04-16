-- ============================================================
-- Storage Export (buckets + policies + object metadata)
-- Generated from Lovable Cloud database
-- ============================================================

-- NOTE: This file exports bucket config, RLS policies, and object
-- metadata. The actual binary files (images, audio, docs) stored in
-- storage cannot be exported via SQL — they must be downloaded from
-- the storage API and re-uploaded to the new project.

BEGIN;

-- ── Storage Buckets ──

INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('chat-attachments', 'chat-attachments', false, 104857600,
  ARRAY['image/jpeg','image/png','image/gif','image/webp','image/heic',
        'video/mp4','video/webm','audio/mpeg','audio/ogg','audio/wav',
        'audio/webm','audio/mp4','application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain','text/csv'])
ON CONFLICT (id) DO NOTHING;

-- ── Storage RLS Policies ──

-- payment-proofs policies
DROP POLICY IF EXISTS "Customers upload own payment proofs" ON storage.objects;
CREATE POLICY "Customers upload own payment proofs"
ON storage.objects FOR INSERT
WITH CHECK ((bucket_id = 'payment-proofs') AND ((auth.uid())::text = (storage.foldername(name))[1]));

DROP POLICY IF EXISTS "Customers view own payment proofs" ON storage.objects;
CREATE POLICY "Customers view own payment proofs"
ON storage.objects FOR SELECT
USING ((bucket_id = 'payment-proofs') AND ((auth.uid())::text = (storage.foldername(name))[1]));

DROP POLICY IF EXISTS "Merchants view payment proofs for their orders" ON storage.objects;
CREATE POLICY "Merchants view payment proofs for their orders"
ON storage.objects FOR SELECT
USING ((bucket_id = 'payment-proofs') AND (EXISTS (
  SELECT 1 FROM customer_orders o
  WHERE o.merchant_id = current_merchant_id()
  AND o.payment_proof_url ~~ ('%' || objects.name)
)));

-- chat-attachments policies
DROP POLICY IF EXISTS "chat_attachments_upload" ON storage.objects;
CREATE POLICY "chat_attachments_upload"
ON storage.objects FOR INSERT
WITH CHECK ((bucket_id = 'chat-attachments')
  AND ((storage.foldername(name))[1] = (auth.uid())::text)
  AND fn_is_chat_member(((storage.foldername(name))[2])::uuid, auth.uid()));

DROP POLICY IF EXISTS "chat_attachments_read" ON storage.objects;
CREATE POLICY "chat_attachments_read"
ON storage.objects FOR SELECT
USING ((bucket_id = 'chat-attachments') AND (EXISTS (
  SELECT 1 FROM chat_attachments a
  WHERE a.storage_path = objects.name
  AND fn_is_chat_member(a.room_id, auth.uid())
)));

DROP POLICY IF EXISTS "chat_attachments_delete" ON storage.objects;
CREATE POLICY "chat_attachments_delete"
ON storage.objects FOR DELETE
USING ((bucket_id = 'chat-attachments') AND ((storage.foldername(name))[1] = (auth.uid())::text));

-- ── Storage Object Metadata (reference only) ──
-- Actual files must be downloaded via Storage API and re-uploaded.
-- Object paths listed below for inventory:

-- bucket: chat-attachments
--   path: c0c85f54-ad64-4baf-9247-6c81d131d9d9/f6079282-6a43-4d71-88a3-2e05b62a4474/1775659965930_89a7a6b6-4e7e-48c4-949a-2abef6b2f339.png
--   owner: c0c85f54-ad64-4baf-9247-6c81d131d9d9
--   type: image/png
--   size: 502919 bytes
--   created: 2026-04-08 14:52:47.708929+00

-- bucket: chat-attachments
--   path: c0c85f54-ad64-4baf-9247-6c81d131d9d9/f6079282-6a43-4d71-88a3-2e05b62a4474/1775660466964_22a7b828-b9e0-4e77-9436-4e7e6dc26e6d.webm
--   owner: c0c85f54-ad64-4baf-9247-6c81d131d9d9
--   type: audio/webm
--   size: 55733 bytes
--   created: 2026-04-08 15:01:08.382926+00

-- bucket: chat-attachments
--   path: c0c85f54-ad64-4baf-9247-6c81d131d9d9/f72040ac-1d66-44ac-a4ee-98adc1b54a5a/1775702203240_8e5e7aa9-9fdf-4673-810d-a9190304a61b.webm
--   owner: c0c85f54-ad64-4baf-9247-6c81d131d9d9
--   type: audio/webm
--   size: 100216 bytes
--   created: 2026-04-09 02:36:44.161809+00

-- bucket: chat-attachments
--   path: c0c85f54-ad64-4baf-9247-6c81d131d9d9/f72040ac-1d66-44ac-a4ee-98adc1b54a5a/1775702220645_191e1a12-879b-4788-83ce-da9947c5e5ae.jpg
--   owner: c0c85f54-ad64-4baf-9247-6c81d131d9d9
--   type: image/jpeg
--   size: 472039 bytes
--   created: 2026-04-09 02:37:01.714263+00

-- bucket: chat-attachments
--   path: c0c85f54-ad64-4baf-9247-6c81d131d9d9/f72040ac-1d66-44ac-a4ee-98adc1b54a5a/1775705376746_fbbe6dae-ea39-4f88-92e5-5ae534f40843.docx
--   owner: c0c85f54-ad64-4baf-9247-6c81d131d9d9
--   type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
--   size: 37044 bytes
--   created: 2026-04-09 03:29:37.137922+00

-- bucket: chat-attachments
--   path: c0c85f54-ad64-4baf-9247-6c81d131d9d9/f6079282-6a43-4d71-88a3-2e05b62a4474/1775706380386_713c18bb-59c8-4639-9be2-7cc70a75f6ee.webm
--   owner: c0c85f54-ad64-4baf-9247-6c81d131d9d9
--   type: audio/webm
--   size: 32787 bytes
--   created: 2026-04-09 03:46:21.269507+00

-- bucket: chat-attachments
--   path: fc995e98-f667-4024-9d40-a9c75dab2320/f6079282-6a43-4d71-88a3-2e05b62a4474/1775774426412_93962124-f61d-4462-aed2-a05e0fe97be1.webm
--   owner: fc995e98-f667-4024-9d40-a9c75dab2320
--   type: audio/webm
--   size: 104570 bytes
--   created: 2026-04-09 22:40:27.589406+00

-- bucket: chat-attachments
--   path: fc995e98-f667-4024-9d40-a9c75dab2320/f6079282-6a43-4d71-88a3-2e05b62a4474/1775774724892_2c36b947-9190-4cc5-a435-10029f987b4e.webm
--   owner: fc995e98-f667-4024-9d40-a9c75dab2320
--   type: audio/webm
--   size: 899 bytes
--   created: 2026-04-09 22:45:25.426199+00

-- bucket: chat-attachments
--   path: fc995e98-f667-4024-9d40-a9c75dab2320/f6079282-6a43-4d71-88a3-2e05b62a4474/1775774745420_c7e8c237-37e0-40b9-9bb1-62fa2f93e2e6.webm
--   owner: fc995e98-f667-4024-9d40-a9c75dab2320
--   type: audio/webm
--   size: 326427 bytes
--   created: 2026-04-09 22:45:46.601134+00

COMMIT;

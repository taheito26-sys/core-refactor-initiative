-- Allow non-admin users to read tracker snapshots for users in the same merchant scope.
-- This enables merchant-level Orders/Stock visibility across multiple attached user identities.
CREATE POLICY "Users can view same-merchant tracker state"
  ON public.tracker_snapshots FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.merchant_profiles me
      JOIN public.merchant_profiles owner_profile
        ON owner_profile.user_id = tracker_snapshots.user_id
      WHERE me.user_id = auth.uid()
        AND me.merchant_id = owner_profile.merchant_id
    )
  );

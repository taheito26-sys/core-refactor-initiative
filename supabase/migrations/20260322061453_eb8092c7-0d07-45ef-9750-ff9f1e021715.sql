
-- Fix permissive INSERT policy on notifications
-- Replace WITH CHECK (true) with a check that only allows inserting for the user's own user_id
-- or by admins (for system notifications)
DROP POLICY "System can create notifications" ON public.notifications;

CREATE POLICY "Users can receive notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
  );

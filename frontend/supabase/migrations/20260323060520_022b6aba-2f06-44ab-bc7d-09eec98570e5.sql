CREATE OR REPLACE FUNCTION public.admin_broadcast_notification(_title text, _body text, _category text DEFAULT 'system')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _count integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  INSERT INTO notifications (user_id, title, body, category)
  SELECT p.user_id, _title, _body, _category
  FROM profiles p
  WHERE p.status = 'approved';

  GET DIAGNOSTICS _count = ROW_COUNT;

  INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    'broadcast_notification',
    'notification',
    NULL,
    jsonb_build_object('title', _title, 'body', _body, 'category', _category, 'recipient_count', _count)
  );

  RETURN _count;
END;
$$;
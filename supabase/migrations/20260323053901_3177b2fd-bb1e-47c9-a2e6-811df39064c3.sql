
-- Admin read policies for all business tables
CREATE POLICY "Admins can view all deals" ON public.merchant_deals
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update all deals" ON public.merchant_deals
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view all tracker snapshots" ON public.tracker_snapshots
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update all tracker snapshots" ON public.tracker_snapshots
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view all settlements" ON public.merchant_settlements
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view all profits" ON public.merchant_profits
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view all relationships" ON public.merchant_relationships
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view all messages" ON public.merchant_messages
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view all approvals" ON public.merchant_approvals
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view all invites" ON public.merchant_invites
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view all notifications" ON public.notifications
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view all merchant profiles" ON public.merchant_profiles
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update all merchant profiles" ON public.merchant_profiles
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin system stats RPC
CREATE OR REPLACE FUNCTION public.admin_system_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'total_users', (SELECT count(*) FROM profiles),
    'approved_users', (SELECT count(*) FROM profiles WHERE status = 'approved'),
    'pending_users', (SELECT count(*) FROM profiles WHERE status = 'pending'),
    'rejected_users', (SELECT count(*) FROM profiles WHERE status = 'rejected'),
    'total_deals', (SELECT count(*) FROM merchant_deals),
    'deals_pending', (SELECT count(*) FROM merchant_deals WHERE status = 'pending'),
    'deals_active', (SELECT count(*) FROM merchant_deals WHERE status = 'active'),
    'deals_completed', (SELECT count(*) FROM merchant_deals WHERE status = 'completed'),
    'deals_cancelled', (SELECT count(*) FROM merchant_deals WHERE status = 'cancelled'),
    'total_settlement_amount', (SELECT coalesce(sum(amount), 0) FROM merchant_settlements),
    'total_profit_amount', (SELECT coalesce(sum(amount), 0) FROM merchant_profits),
    'total_merchant_profiles', (SELECT count(*) FROM merchant_profiles),
    'total_relationships', (SELECT count(*) FROM merchant_relationships WHERE status = 'active')
  ) INTO result;

  RETURN result;
END;
$$;

-- Admin correct deal RPC with audit logging
CREATE OR REPLACE FUNCTION public.admin_correct_deal(
  _deal_id uuid,
  _updates jsonb,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _before jsonb;
  _after jsonb;
  _target_user_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  -- Capture before state
  SELECT row_to_json(d.*)::jsonb INTO _before
  FROM merchant_deals d WHERE d.id = _deal_id;

  IF _before IS NULL THEN
    RAISE EXCEPTION 'Deal not found';
  END IF;

  _target_user_id := (_before->>'created_by')::uuid;

  -- Apply updates
  UPDATE merchant_deals SET
    title = COALESCE((_updates->>'title')::text, title),
    amount = COALESCE((_updates->>'amount')::numeric, amount),
    status = COALESCE((_updates->>'status')::text, status),
    currency = COALESCE((_updates->>'currency')::text, currency),
    notes = COALESCE((_updates->>'notes')::text, notes),
    updated_at = now()
  WHERE id = _deal_id;

  -- Capture after state
  SELECT row_to_json(d.*)::jsonb INTO _after
  FROM merchant_deals d WHERE d.id = _deal_id;

  -- Write audit log
  INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    'correct_deal',
    'merchant_deal',
    _deal_id,
    jsonb_build_object(
      'target_user_id', _target_user_id,
      'before', _before,
      'after', _after,
      'reason', _reason
    )
  );

  RETURN _after;
END;
$$;

-- Admin void/cancel deal RPC
CREATE OR REPLACE FUNCTION public.admin_void_deal(
  _deal_id uuid,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _before jsonb;
  _target_user_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT row_to_json(d.*)::jsonb INTO _before
  FROM merchant_deals d WHERE d.id = _deal_id;

  IF _before IS NULL THEN
    RAISE EXCEPTION 'Deal not found';
  END IF;

  _target_user_id := (_before->>'created_by')::uuid;

  UPDATE merchant_deals SET status = 'voided', updated_at = now()
  WHERE id = _deal_id;

  INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    'void_deal',
    'merchant_deal',
    _deal_id,
    jsonb_build_object(
      'target_user_id', _target_user_id,
      'before', _before,
      'reason', _reason
    )
  );
END;
$$;

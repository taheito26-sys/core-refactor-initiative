-- Shared merchant↔customer order workflow redesign
-- This migration implements the approval-first workflow with normalized cash links

-- 1. Extend customer_orders with workflow status and actor tracking
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS workflow_status text;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS placed_by_role text;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS placed_by_user_id uuid;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS approval_required_from_role text;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS approved_by_user_id uuid;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS rejected_by_user_id uuid;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS revision_no integer NOT NULL DEFAULT 1;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS edited_from_order_id uuid;

-- 2. Add constraints to workflow columns
ALTER TABLE public.customer_orders
  ADD CONSTRAINT chk_placed_by_role
    CHECK (placed_by_role IS NULL OR placed_by_role IN ('merchant', 'customer'));

ALTER TABLE public.customer_orders
  ADD CONSTRAINT chk_approval_required_from_role
    CHECK (approval_required_from_role IS NULL OR approval_required_from_role IN ('merchant', 'customer'));

ALTER TABLE public.customer_orders
  ADD CONSTRAINT chk_workflow_status
    CHECK (workflow_status IS NULL OR workflow_status IN (
      'pending_customer_approval',
      'pending_merchant_approval',
      'approved',
      'rejected',
      'cancelled'
    ));

-- 3. Create normalized cash-link table
CREATE TABLE IF NOT EXISTS public.customer_order_cash_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.customer_orders(id) ON DELETE CASCADE,
  owner_role text NOT NULL,
  cash_account_id text NOT NULL REFERENCES public.cash_accounts(id),
  amount numeric,
  currency text,
  link_kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_owner_role CHECK (owner_role IN ('merchant', 'customer')),
  CONSTRAINT chk_link_kind CHECK (link_kind IN ('send', 'receive', 'settlement', 'reserve')),
  CONSTRAINT unique_cash_link UNIQUE (order_id, owner_role, link_kind)
);

ALTER TABLE public.customer_order_cash_links ENABLE ROW LEVEL SECURITY;

-- RLS for cash links: merchant can see cash links to their orders, customer can see cash links to their orders
CREATE POLICY "Merchants can view cash links on their orders" ON public.customer_order_cash_links
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.customer_orders
      WHERE id = order_id
      AND merchant_id = public.current_merchant_id()
    )
  );

CREATE POLICY "Customers can view cash links on their orders" ON public.customer_order_cash_links
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.customer_orders
      WHERE id = order_id
      AND customer_user_id = auth.uid()
    )
  );

-- 4. Create the three core RPCs

-- RPC 1: Create customer order request
CREATE OR REPLACE FUNCTION public.create_customer_order_request(
  p_connection_id uuid,
  p_placed_by_role text,
  p_amount numeric,
  p_order_type text,
  p_send_country text,
  p_receive_country text,
  p_send_currency text,
  p_receive_currency text,
  p_payout_rail text,
  p_note text DEFAULT NULL,
  p_merchant_cash_account_id text DEFAULT NULL,
  p_customer_cash_account_id text DEFAULT NULL
)
RETURNS public.customer_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_user_id uuid;
  v_merchant_id text;
  v_merchant_user_id uuid;
  v_approval_required_from_role text;
  v_placed_by_user_id uuid;
  v_row public.customer_orders%rowtype;
BEGIN
  -- Validate placed_by_role
  IF p_placed_by_role NOT IN ('merchant', 'customer') THEN
    RAISE EXCEPTION 'placed_by_role must be merchant or customer';
  END IF;

  -- Get connection and validate actor ownership
  SELECT customer_user_id, merchant_id INTO v_customer_user_id, v_merchant_id
  FROM public.customer_merchant_connections
  WHERE id = p_connection_id
  AND status IN ('pending', 'active')
  LIMIT 1;

  IF v_customer_user_id IS NULL THEN
    RAISE EXCEPTION 'Connection not found or inactive';
  END IF;

  -- Validate actor is authorized for this side
  IF p_placed_by_role = 'merchant' THEN
    IF v_merchant_id != public.current_merchant_id() THEN
      RAISE EXCEPTION 'Merchant not authorized for this connection';
    END IF;
    -- Get the merchant user ID
    SELECT user_id INTO v_merchant_user_id
    FROM public.merchant_profiles WHERE merchant_id = v_merchant_id LIMIT 1;
    v_placed_by_user_id := v_merchant_user_id;
    v_approval_required_from_role := 'customer';
  ELSE
    IF auth.uid() != v_customer_user_id THEN
      RAISE EXCEPTION 'Customer not authorized for this connection';
    END IF;
    v_placed_by_user_id := auth.uid();
    v_approval_required_from_role := 'merchant';
  END IF;

  -- Insert the order with correct workflow status
  INSERT INTO public.customer_orders (
    customer_user_id,
    merchant_id,
    connection_id,
    order_type,
    amount,
    currency,
    note,
    send_country,
    receive_country,
    send_currency,
    receive_currency,
    payout_rail,
    workflow_status,
    placed_by_role,
    placed_by_user_id,
    approval_required_from_role,
    status
  ) VALUES (
    v_customer_user_id,
    v_merchant_id,
    p_connection_id,
    p_order_type,
    p_amount,
    p_send_currency,
    p_note,
    p_send_country,
    p_receive_country,
    p_send_currency,
    p_receive_currency,
    p_payout_rail,
    CASE p_placed_by_role WHEN 'merchant' THEN 'pending_customer_approval' ELSE 'pending_merchant_approval' END,
    p_placed_by_role,
    v_placed_by_user_id,
    v_approval_required_from_role,
    'pending'
  )
  RETURNING * INTO v_row;

  -- Insert cash links in same transaction
  IF p_placed_by_role = 'merchant' AND p_merchant_cash_account_id IS NOT NULL THEN
    INSERT INTO public.customer_order_cash_links (
      order_id, owner_role, cash_account_id, link_kind
    ) VALUES (
      v_row.id, 'merchant', p_merchant_cash_account_id, 'send'
    );
  END IF;

  IF p_placed_by_role = 'customer' AND p_customer_cash_account_id IS NOT NULL THEN
    INSERT INTO public.customer_order_cash_links (
      order_id, owner_role, cash_account_id, link_kind
    ) VALUES (
      v_row.id, 'customer', p_customer_cash_account_id, 'send'
    );
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_customer_order_request(uuid, text, numeric, text, text, text, text, text, text, text, text, text)
  TO authenticated;

-- RPC 2: Respond to customer order request (approve/reject)
CREATE OR REPLACE FUNCTION public.respond_customer_order_request(
  p_order_id uuid,
  p_actor_role text,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS public.customer_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.customer_orders%rowtype;
  v_actor_user_id uuid;
BEGIN
  -- Validate inputs
  IF p_actor_role NOT IN ('merchant', 'customer') THEN
    RAISE EXCEPTION 'actor_role must be merchant or customer';
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'action must be approve or reject';
  END IF;

  -- Get order
  SELECT * INTO v_order FROM public.customer_orders WHERE id = p_order_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Determine actor user ID based on role
  IF p_actor_role = 'merchant' THEN
    IF v_order.merchant_id != public.current_merchant_id() THEN
      RAISE EXCEPTION 'Merchant not authorized for this order';
    END IF;
    v_actor_user_id := (SELECT user_id FROM public.merchant_profiles WHERE merchant_id = v_order.merchant_id LIMIT 1);
  ELSE
    IF auth.uid() != v_order.customer_user_id THEN
      RAISE EXCEPTION 'Customer not authorized for this order';
    END IF;
    v_actor_user_id := auth.uid();
  END IF;

  -- Verify actor is the one required to approve
  IF v_order.approval_required_from_role != p_actor_role THEN
    RAISE EXCEPTION 'This order is not awaiting approval from %', p_actor_role;
  END IF;

  -- Process action
  IF p_action = 'approve' THEN
    UPDATE public.customer_orders SET
      workflow_status = 'approved',
      approval_required_from_role = NULL,
      approved_by_user_id = v_actor_user_id,
      approved_at = now(),
      status = 'confirmed'
    WHERE id = p_order_id
    RETURNING * INTO v_order;
  ELSE
    UPDATE public.customer_orders SET
      workflow_status = 'rejected',
      approval_required_from_role = NULL,
      rejected_by_user_id = v_actor_user_id,
      rejected_at = now(),
      rejection_reason = p_reason,
      status = 'cancelled'
    WHERE id = p_order_id
    RETURNING * INTO v_order;
  END IF;

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.respond_customer_order_request(uuid, text, text, text)
  TO authenticated;

-- RPC 3: Edit customer order request
CREATE OR REPLACE FUNCTION public.edit_customer_order_request(
  p_order_id uuid,
  p_actor_role text,
  p_amount numeric DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_merchant_cash_account_id text DEFAULT NULL,
  p_customer_cash_account_id text DEFAULT NULL
)
RETURNS public.customer_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.customer_orders%rowtype;
  v_counterpart_role text;
  v_new_revision integer;
BEGIN
  -- Validate actor_role
  IF p_actor_role NOT IN ('merchant', 'customer') THEN
    RAISE EXCEPTION 'actor_role must be merchant or customer';
  END IF;

  -- Get order
  SELECT * INTO v_order FROM public.customer_orders WHERE id = p_order_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Verify actor authorization
  IF p_actor_role = 'merchant' THEN
    IF v_order.merchant_id != public.current_merchant_id() THEN
      RAISE EXCEPTION 'Merchant not authorized for this order';
    END IF;
  ELSE
    IF auth.uid() != v_order.customer_user_id THEN
      RAISE EXCEPTION 'Customer not authorized for this order';
    END IF;
  END IF;

  -- Can only edit if order is approved
  IF v_order.workflow_status != 'approved' THEN
    RAISE EXCEPTION 'Can only edit approved orders';
  END IF;

  -- Determine counterpart role for new approval requirement
  v_counterpart_role := CASE p_actor_role WHEN 'merchant' THEN 'customer' ELSE 'merchant' END;
  v_new_revision := v_order.revision_no + 1;

  -- Update with new revision and reset approval requirement
  UPDATE public.customer_orders SET
    amount = COALESCE(p_amount, amount),
    note = COALESCE(p_note, note),
    revision_no = v_new_revision,
    workflow_status = CASE v_counterpart_role WHEN 'merchant' THEN 'pending_merchant_approval' ELSE 'pending_customer_approval' END,
    approval_required_from_role = v_counterpart_role,
    approved_by_user_id = NULL,
    approved_at = NULL,
    rejection_reason = NULL,
    rejected_by_user_id = NULL,
    rejected_at = NULL,
    edited_from_order_id = p_order_id
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- Update cash links
  IF p_actor_role = 'merchant' AND p_merchant_cash_account_id IS NOT NULL THEN
    DELETE FROM public.customer_order_cash_links
    WHERE order_id = p_order_id AND owner_role = 'merchant' AND link_kind = 'send';

    INSERT INTO public.customer_order_cash_links (
      order_id, owner_role, cash_account_id, link_kind
    ) VALUES (
      p_order_id, 'merchant', p_merchant_cash_account_id, 'send'
    );
  END IF;

  IF p_actor_role = 'customer' AND p_customer_cash_account_id IS NOT NULL THEN
    DELETE FROM public.customer_order_cash_links
    WHERE order_id = p_order_id AND owner_role = 'customer' AND link_kind = 'send';

    INSERT INTO public.customer_order_cash_links (
      order_id, owner_role, cash_account_id, link_kind
    ) VALUES (
      p_order_id, 'customer', p_customer_cash_account_id, 'send'
    );
  END IF;

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_customer_order_request(uuid, text, numeric, text, text, text)
  TO authenticated;

-- 5. Update notification trigger to only fire after successful order write
-- Drop old trigger and function
DROP TRIGGER IF EXISTS trg_notify_customer_order ON public.customer_orders;
DROP FUNCTION IF EXISTS public.fn_notify_customer_order();

-- Create new notification function that respects workflow_status
CREATE OR REPLACE FUNCTION public.fn_notify_customer_order_workflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _merchant_user_id UUID;
  _customer_name TEXT;
  _notification_title TEXT;
  _notification_body TEXT;
BEGIN
  -- Only notify on relevant workflow transitions

  -- Notify merchant when order is placed (customer -> merchant approval)
  IF NEW.workflow_status IN ('pending_merchant_approval', 'pending_customer_approval')
    AND NEW.placed_by_user_id IS NOT NULL THEN

    SELECT user_id INTO _merchant_user_id
    FROM public.merchant_profiles WHERE merchant_id = NEW.merchant_id LIMIT 1;

    IF _merchant_user_id IS NOT NULL THEN
      SELECT display_name INTO _customer_name
      FROM public.customer_profiles WHERE user_id = NEW.customer_user_id LIMIT 1;

      _notification_title := COALESCE(_customer_name, 'A customer') || ' ' ||
        CASE NEW.placed_by_role WHEN 'merchant' THEN 'requested' ELSE 'placed' END || ' an order';
      _notification_body := NEW.amount || ' ' || NEW.currency;

      INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_entity_type, target_entity_id)
      VALUES (
        _merchant_user_id, 'customer_order',
        _notification_title,
        _notification_body,
        'customer_order', NEW.id::text,
        '/trading/orders', 'customer_order', NEW.id::text
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_customer_order_workflow
  AFTER INSERT OR UPDATE ON public.customer_orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_customer_order_workflow();

-- 6. Add cash_accounts table if not exists (should exist from prior migrations)
-- Just ensure it exists with the right structure
CREATE TABLE IF NOT EXISTS public.cash_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  currency text NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, name)
);

ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own cash accounts" ON public.cash_accounts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own cash accounts" ON public.cash_accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own cash accounts" ON public.cash_accounts
  FOR UPDATE USING (auth.uid() = user_id);

-- Notify about migration
NOTIFY pgrst, 'reload schema';

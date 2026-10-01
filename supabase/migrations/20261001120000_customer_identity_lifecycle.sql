-- Customer identity & lifecycle fixes. Design and gap list:
-- docs/customer-identity-lifecycle.md. Every statement here is additive or a
-- CREATE OR REPLACE of an existing function; no existing row is deleted.

-- ─── G5: restore the profiles row for new signups ────────────────────────
-- 20260928235408 created its own trigger under the name on_auth_user_created,
-- dropping the original trigger of that name that ran handle_new_user(). New
-- auth users have been getting no public.profiles row since. Restored under a
-- distinct name so the two can never collide again, and made idempotent.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, status)
  VALUES (NEW.id, COALESCE(NEW.email, ''), 'pending')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Merchant-created portal logins made while the trigger was missing have no
-- profiles row at all (the edge function's role update matched nothing).
-- Only these accounts are backfilled: their intended state is known
-- (approved customer). Other accounts are left alone rather than guessed at.
INSERT INTO public.profiles (user_id, email, status, role)
SELECT u.id, COALESCE(u.email, ''), 'approved', 'customer'
FROM auth.users u
WHERE u.raw_user_meta_data->>'portal' = 'customer'
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;

-- ─── G6: only auto-create a customer profile for portal logins ───────────
-- Creating one for every auth user made each brand-new merchant look like a
-- customer (ProfileGuard sent them to /c/home instead of onboarding) and made
-- admin-create-customer-login fail on its own customer_profiles insert.
CREATE OR REPLACE FUNCTION public.on_auth_user_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.raw_user_meta_data->>'portal' = 'customer' THEN
    PERFORM public.ensure_customer_profile(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- ─── Explicit merchant-record ↔ portal-account link ──────────────────────
-- The merchant's own customer record id (tracker Customer.id, shown as
-- CUS-XXXXXX) that this connection belongs to. Nullable: legacy connections
-- are resolved client-side until a merchant action links them.
ALTER TABLE public.customer_merchant_connections
  ADD COLUMN IF NOT EXISTS merchant_customer_id text;

CREATE INDEX IF NOT EXISTS customer_merchant_connections_merchant_customer_idx
  ON public.customer_merchant_connections (merchant_id, merchant_customer_id)
  WHERE merchant_customer_id IS NOT NULL;

-- ─── G3: mirrored sales are approved orders, not NULL ("Cancelled") ──────
-- Same 30-parameter signature as 20260909150000, so a plain replace.
CREATE OR REPLACE FUNCTION public.mirror_merchant_customer_order(
  p_connection_id       uuid,
  p_amount              numeric      default null,
  p_currency            text         default 'USDT',
  p_status              text         default 'completed',
  p_order_type          text         default 'buy',
  p_rate                numeric      default null,
  p_total               numeric      default null,
  p_note                text         default null,
  p_send_country        text         default null,
  p_receive_country     text         default null,
  p_send_currency       text         default null,
  p_receive_currency    text         default null,
  p_payout_rail         text         default null,
  p_corridor_label      text         default null,
  p_pricing_mode        text         default 'merchant_quote',
  p_guide_rate          numeric      default null,
  p_guide_total         numeric      default null,
  p_guide_source        text         default null,
  p_guide_snapshot      jsonb        default null,
  p_guide_generated_at  timestamptz  default null,
  p_final_rate          numeric      default null,
  p_final_total         numeric      default null,
  p_final_quote_note    text         default null,
  p_quoted_by_user_id   uuid         default null,
  p_customer_accepted_quote_at  timestamptz default null,
  p_customer_rejected_quote_at  timestamptz default null,
  p_quote_rejection_reason      text        default null,
  p_market_pair         text         default null,
  p_pricing_version     text         default 'merchant-sale-sync-v1',
  p_source_trade_id     text         default null
)
returns public.customer_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_user_id uuid;
  v_merchant_id      text;
  v_row              public.customer_orders%rowtype;
begin
  if p_amount is null then
    raise exception 'p_amount is required';
  end if;

  select customer_user_id, merchant_id
    into v_customer_user_id, v_merchant_id
  from public.customer_merchant_connections
  where id = p_connection_id
    and merchant_id = public.current_merchant_id()
    and status in ('pending', 'active')
  limit 1;

  if v_customer_user_id is null then
    raise exception 'Connection not found or not owned by current merchant';
  end if;

  if p_source_trade_id is not null then
    select * into v_row
    from public.customer_orders
    where merchant_id = v_merchant_id
      and source_trade_id = p_source_trade_id
    limit 1;

    if found then
      return v_row;
    end if;
  end if;

  insert into public.customer_orders (
    customer_user_id, merchant_id, connection_id,
    order_type, amount, currency, rate, total, status, note,
    send_country, receive_country, send_currency, receive_currency,
    payout_rail, corridor_label, pricing_mode,
    guide_rate, guide_total, guide_source, guide_snapshot, guide_generated_at,
    quoted_by_user_id, market_pair, pricing_version, source_trade_id,
    workflow_status, approved_at, revision_no
  ) values (
    v_customer_user_id, v_merchant_id, p_connection_id,
    p_order_type, p_amount, p_currency, p_rate, p_total, p_status, p_note,
    p_send_country, p_receive_country, p_send_currency, p_receive_currency,
    p_payout_rail, p_corridor_label, p_pricing_mode,
    p_guide_rate, p_guide_total, p_guide_source, p_guide_snapshot, p_guide_generated_at,
    p_quoted_by_user_id, p_market_pair, p_pricing_version, p_source_trade_id,
    'approved', now(), 1
  )
  on conflict (merchant_id, source_trade_id) where source_trade_id is not null do nothing
  returning * into v_row;

  if not found and p_source_trade_id is not null then
    select * into v_row
    from public.customer_orders
    where merchant_id = v_merchant_id
      and source_trade_id = p_source_trade_id
    limit 1;
  end if;

  return v_row;
end;
$$;

revoke all on function public.mirror_merchant_customer_order from public;
grant execute on function public.mirror_merchant_customer_order to authenticated;

-- Rows already mirrored with a NULL workflow_status render as "Cancelled" in
-- the customer portal. They are completed merchant sales. placed_by_role
-- stays NULL, so the workflow notification trigger sends nothing for this.
UPDATE public.customer_orders
SET workflow_status = 'approved',
    approved_at = COALESCE(approved_at, created_at)
WHERE workflow_status IS NULL
  AND status = 'completed'
  AND (
    source_trade_id IS NOT NULL
    OR pricing_version IN ('tracker-sync-v1', 'merchant-sale-sync-v1')
  );

-- ─── G10: notification text for mirrored sales; silent backfill ──────────
CREATE OR REPLACE FUNCTION public.notify_customer_order_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _merchant_name text;
  _actor_user_id uuid := auth.uid();
BEGIN
  IF _actor_user_id IS NULL OR _actor_user_id = NEW.customer_user_id THEN
    RETURN NEW;
  END IF;

  -- A merchant syncing a customer's past orders into the portal in bulk.
  IF NEW.pricing_version = 'tracker-sync-backfill' THEN
    RETURN NEW;
  END IF;

  SELECT mp.display_name
    INTO _merchant_name
  FROM public.merchant_profiles mp
  WHERE mp.merchant_id = NEW.merchant_id
  LIMIT 1;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    target_path, target_focus, target_entity_type, target_entity_id,
    actor_id
  ) VALUES (
    NEW.customer_user_id,
    'customer_order',
    CASE
      WHEN NEW.source_trade_id IS NOT NULL
        THEN COALESCE(_merchant_name, 'Your merchant') || ' recorded your order'
      ELSE COALESCE(_merchant_name, 'Your merchant') || ' placed an order for approval'
    END,
    NEW.amount || ' ' || NEW.currency || ' · ' || COALESCE(NEW.corridor_label, 'QAR -> EGP'),
    '/c/orders', 'id', 'customer_order', NEW.id::text,
    _actor_user_id
  );

  RETURN NEW;
END;
$$;

-- ─── G7: admin-only customer deletion ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_customer_by_admin(p_user_id UUID)
RETURNS JSON AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only platform admins can delete customers' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.customer_merchant_connections WHERE customer_user_id = p_user_id;
  DELETE FROM public.customer_profiles WHERE user_id = p_user_id;

  RETURN JSON_BUILD_OBJECT(
    'success', true,
    'message', 'Customer data deleted successfully (profile & connections)',
    'user_id', p_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.delete_customer_by_admin(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_customer_by_admin(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

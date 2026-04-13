
-- 1. Add role column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'merchant';

-- 2. Customer profiles table
CREATE TABLE public.customer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  display_name text NOT NULL,
  phone text,
  region text,
  preferred_currency text NOT NULL DEFAULT 'USDT',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers can view own profile" ON public.customer_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Customers can insert own profile" ON public.customer_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Customers can update own profile" ON public.customer_profiles FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_customer_profiles_updated_at BEFORE UPDATE ON public.customer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Customer-merchant connections
CREATE TABLE public.customer_merchant_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid NOT NULL,
  merchant_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  nickname text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_user_id, merchant_id)
);
ALTER TABLE public.customer_merchant_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers can view own connections" ON public.customer_merchant_connections
  FOR SELECT USING (auth.uid() = customer_user_id);
CREATE POLICY "Customers can insert own connections" ON public.customer_merchant_connections
  FOR INSERT WITH CHECK (auth.uid() = customer_user_id);
CREATE POLICY "Merchants can view connections to them" ON public.customer_merchant_connections
  FOR SELECT USING (merchant_id = public.current_merchant_id());
CREATE POLICY "Merchants can update connections to them" ON public.customer_merchant_connections
  FOR UPDATE USING (merchant_id = public.current_merchant_id());
CREATE POLICY "Customers can update own connections" ON public.customer_merchant_connections
  FOR UPDATE USING (auth.uid() = customer_user_id);

CREATE TRIGGER update_cmc_updated_at BEFORE UPDATE ON public.customer_merchant_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Customer orders
CREATE TABLE public.customer_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid NOT NULL,
  merchant_id text NOT NULL,
  connection_id uuid NOT NULL REFERENCES public.customer_merchant_connections(id),
  order_type text NOT NULL DEFAULT 'buy',
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USDT',
  rate numeric,
  total numeric,
  status text NOT NULL DEFAULT 'pending',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers can view own orders" ON public.customer_orders
  FOR SELECT USING (auth.uid() = customer_user_id);
CREATE POLICY "Customers can insert own orders" ON public.customer_orders
  FOR INSERT WITH CHECK (auth.uid() = customer_user_id);
CREATE POLICY "Merchants can view orders to them" ON public.customer_orders
  FOR SELECT USING (merchant_id = public.current_merchant_id());
CREATE POLICY "Merchants can update orders to them" ON public.customer_orders
  FOR UPDATE USING (merchant_id = public.current_merchant_id());
CREATE POLICY "Customers can update own orders" ON public.customer_orders
  FOR UPDATE USING (auth.uid() = customer_user_id);

CREATE TRIGGER update_customer_orders_updated_at BEFORE UPDATE ON public.customer_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Customer messages
CREATE TABLE public.customer_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.customer_merchant_connections(id),
  sender_user_id uuid NOT NULL,
  sender_role text NOT NULL DEFAULT 'customer',
  content text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customer_messages ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user is part of a connection
CREATE OR REPLACE FUNCTION public.is_customer_connection_member(_connection_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.customer_merchant_connections c
    WHERE c.id = _connection_id
    AND (
      c.customer_user_id = auth.uid()
      OR c.merchant_id = public.current_merchant_id()
    )
  )
$$;

CREATE POLICY "Connection members can view messages" ON public.customer_messages
  FOR SELECT USING (public.is_customer_connection_member(connection_id));
CREATE POLICY "Connection members can send messages" ON public.customer_messages
  FOR INSERT WITH CHECK (auth.uid() = sender_user_id AND public.is_customer_connection_member(connection_id));
CREATE POLICY "Connection members can update messages" ON public.customer_messages
  FOR UPDATE USING (public.is_customer_connection_member(connection_id));

-- 6. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_merchant_connections;

-- 7. Notification trigger for customer orders
CREATE OR REPLACE FUNCTION public.fn_notify_customer_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _customer_name TEXT;
  _merchant_user_id UUID;
BEGIN
  SELECT display_name INTO _customer_name
  FROM public.customer_profiles WHERE user_id = NEW.customer_user_id LIMIT 1;

  SELECT user_id INTO _merchant_user_id
  FROM public.merchant_profiles WHERE merchant_id = NEW.merchant_id LIMIT 1;

  IF _merchant_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_entity_type, target_entity_id)
  VALUES (
    _merchant_user_id, 'customer_order',
    COALESCE(_customer_name, 'A customer') || ' placed a ' || NEW.order_type || ' order',
    NEW.amount || ' ' || NEW.currency || COALESCE(' — ' || NEW.note, ''),
    'customer_order', NEW.id::text,
    '/trading/orders', 'customer_order', NEW.id::text
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_customer_order
  AFTER INSERT ON public.customer_orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_customer_order();

-- 8. Notification trigger for customer messages
CREATE OR REPLACE FUNCTION public.fn_notify_customer_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _conn RECORD;
  _recipient_user_id UUID;
  _sender_name TEXT;
BEGIN
  SELECT customer_user_id, merchant_id INTO _conn
  FROM public.customer_merchant_connections WHERE id = NEW.connection_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.sender_role = 'customer' THEN
    SELECT user_id INTO _recipient_user_id
    FROM public.merchant_profiles WHERE merchant_id = _conn.merchant_id LIMIT 1;
    SELECT display_name INTO _sender_name
    FROM public.customer_profiles WHERE user_id = NEW.sender_user_id LIMIT 1;
  ELSE
    _recipient_user_id := _conn.customer_user_id;
    SELECT COALESCE(nickname, display_name) INTO _sender_name
    FROM public.merchant_profiles WHERE merchant_id = _conn.merchant_id LIMIT 1;
  END IF;

  IF _recipient_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id)
  VALUES (
    _recipient_user_id, 'message',
    COALESCE(_sender_name, 'New message'),
    LEFT(NEW.content, 100),
    'customer_message', NEW.id::text
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_customer_message
  AFTER INSERT ON public.customer_messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_customer_message();

-- 9. Add RLS policy for customers to view merchant liquidity of connected merchants
CREATE POLICY "Connected customers can view merchant liquidity" ON public.merchant_liquidity_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.customer_merchant_connections c
      WHERE c.merchant_id = merchant_liquidity_profiles.merchant_id
      AND c.customer_user_id = auth.uid()
      AND c.status = 'active'
    )
  );

-- 10. Add RLS policy for customers to search merchant profiles (public discoverability)
CREATE POLICY "Customers can search public merchant profiles" ON public.merchant_profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'customer')
    AND discoverability = 'public'
  );

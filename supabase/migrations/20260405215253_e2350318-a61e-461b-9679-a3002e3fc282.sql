
-- MIGRATION 4: DELETE policies for cash tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cash_ledger' AND policyname = 'Users can delete own ledger entries'
  ) THEN
    CREATE POLICY "Users can delete own ledger entries"
      ON public.cash_ledger FOR DELETE TO authenticated
      USING (user_id = auth.uid());
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cash_accounts' AND policyname = 'Users can delete own accounts'
  ) THEN
    CREATE POLICY "Users can delete own accounts"
      ON public.cash_accounts FOR DELETE TO authenticated
      USING (user_id = auth.uid());
  END IF;
END;
$$;

-- MIGRATION 5: cash_custody_requests table
CREATE TABLE IF NOT EXISTS public.cash_custody_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_merchant_id TEXT NOT NULL,
  custodian_merchant_id TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'QAR',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','rejected','counter_proposed','cancelled')),
  counter_amount NUMERIC,
  counter_note TEXT,
  requester_user_id UUID REFERENCES auth.users(id),
  custodian_user_id UUID REFERENCES auth.users(id),
  relationship_id UUID REFERENCES public.merchant_relationships(id),
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cash_custody_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view their requests"
  ON public.cash_custody_requests FOR SELECT TO authenticated
  USING (requester_user_id = auth.uid() OR custodian_user_id = auth.uid());

CREATE POLICY "Requester can insert"
  ON public.cash_custody_requests FOR INSERT TO authenticated
  WITH CHECK (requester_user_id = auth.uid());

CREATE POLICY "Participants can update"
  ON public.cash_custody_requests FOR UPDATE TO authenticated
  USING (requester_user_id = auth.uid() OR custodian_user_id = auth.uid());

CREATE TRIGGER trg_cash_custody_updated_at
  BEFORE UPDATE ON public.cash_custody_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'cash_custody_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_custody_requests;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_notify_cash_custody_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _requester_name TEXT;
  _recipient_user_id UUID;
BEGIN
  _recipient_user_id := NEW.custodian_user_id;
  IF _recipient_user_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(nickname, display_name, merchant_id)
    INTO _requester_name
  FROM public.merchant_profiles
  WHERE merchant_id = NEW.requester_merchant_id LIMIT 1;

  INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id)
  VALUES (
    _recipient_user_id,
    'message',
    COALESCE(_requester_name, 'A merchant') || ' sent you a cash custody request',
    'Amount: ' || NEW.amount || ' ' || NEW.currency || COALESCE(' — ' || NEW.note, ''),
    'cash_custody',
    NEW.id::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_cash_custody ON public.cash_custody_requests;
CREATE TRIGGER trg_notify_cash_custody
  AFTER INSERT ON public.cash_custody_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_cash_custody_request();

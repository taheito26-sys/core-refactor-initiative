-- One exchange P2P order can be split across multiple tracker entities (e.g.
-- registering part of a Binance order under one customer and the remainder
-- under another). exchange_p2p_orders.linked_entity_type/id/at stay as the
-- "most recent link" pointer for existing single-link consumers (badges,
-- exchange inbox), while this table is the source of truth for how much of
-- the order has actually been allocated so far.
CREATE TABLE IF NOT EXISTS public.exchange_p2p_order_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.exchange_p2p_orders(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('batch', 'trade')),
  entity_id text NOT NULL,
  allocated_amount numeric NOT NULL CHECK (allocated_amount > 0),
  customer_label text,
  linked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.exchange_p2p_order_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own exchange order links" ON public.exchange_p2p_order_links
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.exchange_p2p_orders o WHERE o.id = order_id AND o.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.exchange_p2p_orders o WHERE o.id = order_id AND o.user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_exchange_p2p_order_links_order ON public.exchange_p2p_order_links (order_id);

-- Backfill: orders already marked linked under the old scalar columns had
-- their full amount imported as a single entity, so record that as one
-- full-amount link row.
INSERT INTO public.exchange_p2p_order_links (order_id, entity_type, entity_id, allocated_amount, linked_at)
SELECT id, linked_entity_type, linked_entity_id, amount, linked_at
FROM public.exchange_p2p_orders
WHERE linked_entity_id IS NOT NULL AND linked_entity_type IS NOT NULL
ON CONFLICT DO NOTHING;

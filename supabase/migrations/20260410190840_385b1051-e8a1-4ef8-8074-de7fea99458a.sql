
-- Reviews table
CREATE TABLE IF NOT EXISTS public.otc_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES public.otc_trades(id) ON DELETE CASCADE,
  reviewer_user_id uuid NOT NULL,
  reviewed_user_id uuid NOT NULL,
  rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trade_id, reviewer_user_id)
);

ALTER TABLE public.otc_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reviews_select" ON public.otc_reviews FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.otc_trades t
      WHERE t.id = otc_reviews.trade_id
        AND (t.initiator_user_id = auth.uid() OR t.responder_user_id = auth.uid())
    )
    OR reviewed_user_id = auth.uid()
  );

CREATE POLICY "reviews_insert" ON public.otc_reviews FOR INSERT TO authenticated
  WITH CHECK (
    reviewer_user_id = auth.uid()
    AND reviewer_user_id != reviewed_user_id
    AND EXISTS (
      SELECT 1 FROM public.otc_trades t
      WHERE t.id = otc_reviews.trade_id
        AND t.status = 'completed'
        AND (t.initiator_user_id = auth.uid() OR t.responder_user_id = auth.uid())
    )
  );

-- Add rating cache to merchant_profiles
ALTER TABLE public.merchant_profiles
  ADD COLUMN IF NOT EXISTS otc_avg_rating numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS otc_review_count int NOT NULL DEFAULT 0;

-- Trigger to update cached rating on new review
CREATE OR REPLACE FUNCTION public.fn_refresh_otc_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.merchant_profiles SET
    otc_avg_rating = sub.avg_rating,
    otc_review_count = sub.cnt
  FROM (
    SELECT
      AVG(rating)::numeric AS avg_rating,
      COUNT(*) AS cnt
    FROM public.otc_reviews
    WHERE reviewed_user_id = NEW.reviewed_user_id
  ) sub
  WHERE user_id = NEW.reviewed_user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_otc_rating ON public.otc_reviews;
CREATE TRIGGER trg_refresh_otc_rating
  AFTER INSERT ON public.otc_reviews
  FOR EACH ROW EXECUTE FUNCTION public.fn_refresh_otc_rating();

-- Lifecycle: function to expire stale listings and cancel old trades
CREATE OR REPLACE FUNCTION public.fn_otc_lifecycle_cleanup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Expire listings older than 7 days
  UPDATE public.otc_listings
    SET status = 'expired', updated_at = now()
    WHERE status = 'active'
      AND updated_at < now() - interval '7 days';

  -- Cancel offered/countered trades older than 48h
  UPDATE public.otc_trades
    SET status = 'expired', updated_at = now()
    WHERE status IN ('offered', 'countered')
      AND updated_at < now() - interval '48 hours';
END;
$$;


ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_relationships;

CREATE INDEX IF NOT EXISTS idx_os_messages_room_id ON public.os_messages (room_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_settlement_decisions_period_id ON public.settlement_decisions (settlement_period_id);

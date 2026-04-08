ALTER TABLE public.notifications DROP CONSTRAINT notifications_category_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check 
  CHECK (category = ANY (ARRAY['invite','approval','system','message','deal','stock','customer_order','customer_message']));
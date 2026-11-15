ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS current_started_at timestamptz;
UPDATE public.shipments SET current_started_at = started_at WHERE status = 'on_the_road' AND current_started_at IS NULL;
ALTER TABLE public.shipment_stops
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS radius_km numeric NOT NULL DEFAULT 20 CHECK (radius_km > 0 AND radius_km <= 200),
  ADD COLUMN IF NOT EXISTS arrival_method text CHECK (arrival_method IN ('gps', 'override', 'start')),
  ADD COLUMN IF NOT EXISTS arrival_reason text,
  ADD COLUMN IF NOT EXISTS arrival_latitude double precision,
  ADD COLUMN IF NOT EXISTS arrival_longitude double precision,
  ADD COLUMN IF NOT EXISTS arrival_accuracy_m numeric;

-- City/port areas are approximate. Country-wide stops deliberately require an explained confirmation.
UPDATE public.shipment_stops SET latitude = CASE
  WHEN name_en = 'Obour (Cairo)' THEN 30.228 WHEN name_en = 'Kafr El Sheikh' THEN 31.111
  WHEN name_en = 'Port Said' THEN 31.265 WHEN name_en = 'Safaga port' THEN 26.733 END,
  longitude = CASE WHEN name_en = 'Obour (Cairo)' THEN 31.482 WHEN name_en = 'Kafr El Sheikh' THEN 30.939
  WHEN name_en = 'Port Said' THEN 32.302 WHEN name_en = 'Safaga port' THEN 33.936 END
WHERE kind = 'fixed' AND latitude IS NULL AND name_en IN ('Obour (Cairo)', 'Kafr El Sheikh', 'Port Said', 'Safaga port');
CREATE OR REPLACE FUNCTION public.shipment_stop_defaults() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'fixed' AND NEW.latitude IS NULL THEN
    NEW.latitude := CASE NEW.name_en WHEN 'Obour (Cairo)' THEN 30.228 WHEN 'Kafr El Sheikh' THEN 31.111 WHEN 'Port Said' THEN 31.265 WHEN 'Safaga port' THEN 26.733 END;
    NEW.longitude := CASE NEW.name_en WHEN 'Obour (Cairo)' THEN 31.482 WHEN 'Kafr El Sheikh' THEN 30.939 WHEN 'Port Said' THEN 32.302 WHEN 'Safaga port' THEN 33.936 END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shipment_stop_area_defaults BEFORE INSERT ON public.shipment_stops FOR EACH ROW EXECUTE FUNCTION public.shipment_stop_defaults();

CREATE TABLE public.shipment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL, ended_at timestamptz, end_reason text, is_legacy boolean NOT NULL DEFAULT false,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX shipment_one_open_session ON public.shipment_sessions(shipment_id) WHERE ended_at IS NULL;
CREATE INDEX shipment_sessions_by_trip ON public.shipment_sessions(shipment_id, started_at);
CREATE TABLE public.shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  actor_user_id uuid, event_type text NOT NULL CHECK (event_type IN ('created','started','ended_early','restart_approved','delivered','cancelled','arrival','legacy')),
  occurred_at timestamptz NOT NULL DEFAULT now(), details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX shipment_events_by_trip ON public.shipment_events(shipment_id, occurred_at);
ALTER TABLE public.shipment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Shipment parties read sessions" ON public.shipment_sessions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_id));
CREATE POLICY "Shipment parties read events" ON public.shipment_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_id));
GRANT SELECT ON public.shipment_sessions, public.shipment_events TO authenticated;
-- These are written only by server actions, never by the browser.
REVOKE INSERT, UPDATE, DELETE ON public.shipment_sessions, public.shipment_events FROM anon, authenticated;
INSERT INTO public.shipment_sessions (shipment_id, started_at, ended_at, end_reason, is_legacy)
SELECT id, started_at, CASE WHEN status = 'on_the_road' THEN NULL ELSE GREATEST(started_at, COALESCE(ended_at,delivered_at,updated_at)) END,
  CASE WHEN status = 'on_the_road' THEN NULL ELSE status END, true
FROM public.shipments WHERE started_at IS NOT NULL AND status <> 'preparing';
INSERT INTO public.shipment_events (shipment_id,event_type,occurred_at,details)
SELECT id,'legacy',created_at,jsonb_build_object('note','Earlier restart approvals were not recorded; history starts here') FROM public.shipments;

CREATE OR REPLACE FUNCTION public.shipment_status_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event text; v_driver uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.shipment_events(shipment_id,actor_user_id,event_type) VALUES(NEW.id,auth.uid(),'created');
    RETURN NEW;
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF OLD.status = 'on_the_road' THEN
    UPDATE public.shipment_sessions SET ended_at = GREATEST(started_at,now()), end_reason = NEW.status
      WHERE shipment_id = NEW.id AND ended_at IS NULL;
  END IF;
  v_event := NEW.status;
  IF NEW.status = 'on_the_road' THEN
    v_event := 'started';
    UPDATE public.shipments SET current_started_at = now() WHERE id = NEW.id;
    INSERT INTO public.shipment_sessions(shipment_id,started_at) VALUES(NEW.id,now());
    UPDATE public.shipment_stops SET arrival_method=COALESCE(arrival_method,'start') WHERE id=(SELECT id FROM public.shipment_stops WHERE shipment_id=NEW.id ORDER BY seq LIMIT 1);
  ELSIF NEW.status = 'preparing' AND OLD.status = 'ended_early' THEN
    v_event := 'restart_approved';
    SELECT user_id INTO v_driver FROM public.shipment_drivers WHERE id = NEW.driver_id;
    IF v_driver IS NOT NULL THEN
      INSERT INTO public.notifications(user_id,category,title,body,entity_type,entity_id,target_path)
      VALUES(v_driver,'system','Restart approved / تمت الموافقة على الاستئناف',NEW.reference,'shipment',NEW.id::text,'/d/shipments/'||NEW.id::text);
    END IF;
  END IF;
  INSERT INTO public.shipment_events(shipment_id,actor_user_id,event_type) VALUES(NEW.id,auth.uid(),v_event);
  RETURN NEW;
END $$;
CREATE TRIGGER shipment_status_history AFTER INSERT OR UPDATE OF status ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.shipment_status_history();

CREATE OR REPLACE FUNCTION public.driver_confirm_arrival(p_stop_id uuid, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL,
  p_accuracy numeric DEFAULT NULL, p_recorded_at timestamptz DEFAULT NULL, p_override_reason text DEFAULT NULL)
RETURNS public.shipments LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.shipments%rowtype; st public.shipment_stops%rowtype; v_next uuid; distance_km double precision;
  verified boolean := false; reason text := NULLIF(btrim(p_override_reason),'');
BEGIN
  SELECT * INTO st FROM public.shipment_stops WHERE id = p_stop_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stop not found'; END IF;
  s := public.driver_shipment_for_update(st.shipment_id);
  IF s.status <> 'on_the_road' THEN RAISE EXCEPTION 'The trip is not on the road'; END IF;
  SELECT id INTO v_next FROM public.shipment_stops WHERE shipment_id = s.id AND reached_at IS NULL ORDER BY seq LIMIT 1;
  IF v_next IS DISTINCT FROM p_stop_id THEN RAISE EXCEPTION 'Stops are confirmed in order'; END IF;
  IF p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180 AND p_accuracy BETWEEN 0 AND 1000
    AND p_recorded_at BETWEEN now() - interval '10 minutes' AND now() + interval '1 minute'
    AND st.latitude IS NOT NULL AND st.longitude IS NOT NULL THEN
    distance_km := 6371 * 2 * asin(sqrt(LEAST(1.0,GREATEST(0.0,
      power(sin(radians(p_lat-st.latitude)/2),2) + cos(radians(st.latitude))*cos(radians(p_lat))*power(sin(radians(p_lng-st.longitude)/2),2)))));
    verified := distance_km <= st.radius_km;
  END IF;
  IF NOT COALESCE(verified,false) AND (reason IS NULL OR char_length(reason) < 8 OR char_length(reason) > 300) THEN
    RAISE EXCEPTION 'GPS cannot verify this arrival. Provide an override reason of 8 to 300 characters';
  END IF;
  UPDATE public.shipment_stops SET reached_at=now(), arrival_method=CASE WHEN verified THEN 'gps' ELSE 'override' END,
    arrival_reason=CASE WHEN verified THEN NULL ELSE reason END,
    arrival_latitude=CASE WHEN p_lat BETWEEN -90 AND 90 THEN p_lat END,
    arrival_longitude=CASE WHEN p_lng BETWEEN -180 AND 180 THEN p_lng END, arrival_accuracy_m=p_accuracy
  WHERE id=p_stop_id;
  IF p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180 AND p_recorded_at BETWEEN now()-interval '10 minutes' AND now()+interval '1 minute' THEN
    INSERT INTO public.shipment_locations(shipment_id,driver_user_id,latitude,longitude,accuracy_m,recorded_at,source)
      VALUES(s.id,auth.uid(),p_lat,p_lng,p_accuracy,LEAST(p_recorded_at,now()),'stop') ON CONFLICT (shipment_id,recorded_at) DO NOTHING;
  END IF;
  INSERT INTO public.shipment_events(shipment_id,actor_user_id,event_type,details)
    VALUES(s.id,auth.uid(),'arrival',jsonb_build_object('stop',st.name_en,'stop_ar',st.name_ar,'method',CASE WHEN verified THEN 'gps' ELSE 'override' END,'reason',CASE WHEN verified THEN NULL ELSE reason END,'distance_km',distance_km));
  IF NOT EXISTS(SELECT 1 FROM public.shipment_stops WHERE shipment_id=s.id AND reached_at IS NULL) THEN
    UPDATE public.shipments SET status='delivered',delivered_at=now(),updated_at=now() WHERE id=s.id RETURNING * INTO s;
    INSERT INTO public.notifications(user_id,category,title,body,entity_type,entity_id,target_path)
      VALUES(s.customer_user_id,'system','Shipment delivered / تم تسليم الشحنة',s.reference,'shipment',s.id::text,'/c/shipments');
  END IF;
  RETURN s;
END $$;
-- The legacy route cannot bypass verification with a bare stop ID.
CREATE OR REPLACE FUNCTION public.driver_reach_stop(p_stop_id uuid) RETURNS public.shipments
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN RETURN public.driver_confirm_arrival(p_stop_id); END $$;
REVOKE ALL ON FUNCTION public.driver_confirm_arrival(uuid,double precision,double precision,numeric,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_confirm_arrival(uuid,double precision,double precision,numeric,timestamptz,text) TO authenticated;

ALTER TABLE public.shipment_readings ADD COLUMN IF NOT EXISTS client_request_id uuid, ADD COLUMN IF NOT EXISTS uploaded_at timestamptz;
UPDATE public.shipment_readings SET uploaded_at=taken_at WHERE uploaded_at IS NULL;
ALTER TABLE public.shipment_readings ALTER COLUMN uploaded_at SET DEFAULT now();
CREATE UNIQUE INDEX shipment_reading_request_id ON public.shipment_readings(shipment_id,client_request_id) WHERE client_request_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.driver_submit_reading_v2(p_shipment_id uuid,p_client_request_id uuid,p_temperature numeric,p_set_point numeric,p_photo_path text,p_note text,
  p_lat double precision,p_lng double precision,p_accuracy numeric,p_device_time timestamptz,p_entry_mode text,p_read_temperature numeric,p_read_set_point numeric,
  p_place_ar text DEFAULT NULL,p_place_en text DEFAULT NULL)
RETURNS public.shipment_readings LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.shipments%rowtype; r public.shipment_readings%rowtype;
BEGIN
  s := public.driver_shipment_for_update(p_shipment_id);
  IF p_client_request_id IS NULL THEN RAISE EXCEPTION 'A reading request ID is required'; END IF;
  IF p_photo_path IS DISTINCT FROM p_shipment_id::text||'/'||p_client_request_id::text||'.jpg' THEN RAISE EXCEPTION 'Photo reference does not match this reading request'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_shipment_id::text||p_client_request_id::text,0));
  SELECT * INTO r FROM public.shipment_readings WHERE shipment_id=p_shipment_id AND client_request_id=p_client_request_id;
  IF FOUND THEN RETURN r; END IF;
  IF s.status <> 'on_the_road' THEN RAISE EXCEPTION 'Start the trip before sending readings; ended trips cannot accept new readings'; END IF;
  IF p_device_time IS NULL OR p_device_time < now()-interval '7 days' OR p_device_time > now()+interval '5 minutes' THEN RAISE EXCEPTION 'Photo time is outside the supported seven-day upload window'; END IF;
  r := public.driver_submit_reading(p_shipment_id,p_temperature,p_set_point,p_photo_path,p_note,p_lat,p_lng,p_accuracy,p_device_time,p_entry_mode,p_read_temperature,p_read_set_point,p_place_ar,p_place_en);
  UPDATE public.shipment_readings SET client_request_id=p_client_request_id,taken_at=LEAST(p_device_time,now()),uploaded_at=now() WHERE id=r.id RETURNING * INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.driver_submit_reading_v2(uuid,uuid,numeric,numeric,text,text,double precision,double precision,numeric,timestamptz,text,numeric,numeric,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_submit_reading_v2(uuid,uuid,numeric,numeric,text,text,double precision,double precision,numeric,timestamptz,text,numeric,numeric,text,text) TO authenticated;

-- Legacy overloads cannot bypass the request ID, active-run check or delayed-upload rules.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='driver_submit_reading' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  END LOOP;
END $$;

CREATE TABLE public.shipment_reading_reminders (
 shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE, due_at timestamptz NOT NULL, stage text NOT NULL,
 PRIMARY KEY(shipment_id,due_at,stage)
);
ALTER TABLE public.shipment_reading_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shipment_reading_reminders FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.notify_shipment_readings_due() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s record; v_due timestamptz; v_stage text; inserted integer; total integer:=0;
BEGIN
 FOR s IN SELECT sh.*,d.user_id AS driver_user_id FROM public.shipments sh JOIN public.shipment_drivers d ON d.id=sh.driver_id AND d.active WHERE sh.status='on_the_road' ORDER BY sh.id FOR UPDATE OF sh LOOP
  SELECT GREATEST(COALESCE(s.current_started_at,s.started_at),max(taken_at)) + make_interval(hours=>s.reading_interval_hours) INTO v_due
    FROM public.shipment_readings WHERE shipment_id=s.id;
  IF v_due IS NULL OR now()<v_due-interval '30 minutes' THEN CONTINUE; END IF;
  v_stage:=CASE WHEN now()>=v_due THEN 'overdue' ELSE 'due_soon' END;
  INSERT INTO public.shipment_reading_reminders VALUES(s.id,v_due,v_stage) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  IF inserted=0 THEN CONTINUE; END IF;
  INSERT INTO public.notifications(user_id,category,title,body,entity_type,entity_id,target_path)
    VALUES(s.driver_user_id,'system',CASE WHEN v_stage='overdue' THEN 'Temperature reading overdue / تأخرت قراءة الحرارة' ELSE 'Temperature reading due soon / اقترب موعد قراءة الحرارة' END,s.reference||' · '||v_due::text,'shipment',s.id::text,'/d/shipments/'||s.id::text);
  IF v_stage='overdue' THEN
    INSERT INTO public.notifications(user_id,category,title,body,entity_type,entity_id,target_path)
    VALUES(s.customer_user_id,'system','Temperature reading overdue / تأخرت قراءة الحرارة',s.reference||' · '||v_due::text,'shipment',s.id::text,'/c/shipments');
  END IF;
  total:=total+1;
 END LOOP;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.notify_shipment_readings_due() FROM PUBLIC,anon,authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='shipment-reading-reminders') THEN PERFORM cron.unschedule('shipment-reading-reminders'); END IF; END $$;
SELECT cron.schedule('shipment-reading-reminders','*/5 * * * *','SELECT public.notify_shipment_readings_due()');
NOTIFY pgrst,'reload schema';

ALTER PUBLICATION supabase_realtime ADD TABLE public.shipment_sessions, public.shipment_events;

-- Revoke only the abandoned browser-verification sign-in whose temporary token appeared in a test error.
DO $$ DECLARE removed integer; BEGIN
  IF to_regclass('auth.sessions') IS NOT NULL THEN
    IF has_table_privilege(current_user,'auth.sessions','DELETE') THEN
      DELETE FROM auth.sessions WHERE id='187decd5-e375-4487-bcfb-5a60208706b7';
      GET DIAGNOSTICS removed=ROW_COUNT;
      RAISE NOTICE 'Abandoned verification sign-in removed: %',removed;
    END IF;
  END IF;
END $$;

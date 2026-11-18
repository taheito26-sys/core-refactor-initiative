-- The nine main stops of the Egypt to Qatar route get an area (and a confirmation radius) when a shipment is created,
-- so an arrival can be checked against the phone's position. Stops from the older route keep their existing areas.
CREATE OR REPLACE FUNCTION public.shipment_stop_defaults() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  area record;
BEGIN
  IF NEW.kind = 'fixed' AND NEW.latitude IS NULL THEN
    SELECT * INTO area FROM (VALUES
      ('Obour (Cairo)', 30.228, 31.482, 20),
      ('Kafr El Sheikh', 31.111, 30.939, 20),
      ('Port Said', 31.265, 32.302, 20),
      ('Safaga port', 26.733, 33.936, 20),
      ('Kafr El-Sheikh, Egypt', 31.111, 30.939, 20),
      ('Safaga Port, Egypt', 26.733, 33.936, 20),
      ('Duba Port, Saudi Arabia', 27.350, 35.690, 20),
      ('Tabuk, Saudi Arabia', 28.384, 36.555, 30),
      ('Buraydah (Al-Qassim), Saudi Arabia', 26.326, 43.975, 30),
      ('Riyadh, Saudi Arabia', 24.713, 46.675, 40),
      ('Al-Hofuf (Al-Ahsa), Saudi Arabia', 25.364, 49.588, 30),
      ('Salwa / Abu Samra Border Crossing', 24.720, 50.790, 20),
      ('Doha, Qatar', 25.285, 51.531, 30)
    ) AS v(name_en, lat, lng, radius_km) WHERE v.name_en = NEW.name_en;
    IF FOUND THEN
      NEW.latitude := area.lat;
      NEW.longitude := area.lng;
      NEW.radius_km := area.radius_km;
    END IF;
  END IF;
  RETURN NEW;
END $$;

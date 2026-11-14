export type ShipmentStatus = 'preparing' | 'on_the_road' | 'delivered' | 'cancelled';

export interface ShipmentStop {
  id: string;
  shipment_id: string;
  seq: number;
  name_en: string;
  name_ar: string;
  kind: 'fixed' | 'driver';
  reached_at: string | null;
}

export interface ShipmentReading {
  id: string;
  shipment_id: string;
  temperature_c: number;
  set_point_c: number | null;
  photo_path: string;
  note: string | null;
  is_alert: boolean;
  taken_at: string;
}

export interface ShipmentDriver {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  phone: string | null;
  truck_plate: string | null;
  active: boolean;
  created_at: string;
}

export interface Shipment {
  id: string;
  customer_user_id: string;
  reference: string;
  cargo: string;
  weight_tons: number | null;
  target_temp_c: number;
  tolerance_c: number;
  reading_interval_hours: number;
  driver_id: string | null;
  status: ShipmentStatus;
  note: string | null;
  started_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

/** A shipment as the list pages load it: with its driver, stops and newest reading. */
export interface ShipmentWithDetails extends Shipment {
  driver: Pick<ShipmentDriver, 'id' | 'display_name' | 'truck_plate' | 'phone'> | null;
  stops: ShipmentStop[];
  readings: ShipmentReading[];
}

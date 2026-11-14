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
  /** Where the phone was and what its clock said when the photo was taken. */
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  device_taken_at: string | null;
  /** The phone's clock and the server's differ by more than ten minutes. */
  time_mismatch: boolean;
  entry_mode: 'auto' | 'auto_edited' | 'manual';
  place_ar: string | null;
  place_en: string | null;
}

export interface ShipmentLocation {
  id?: string;
  shipment_id?: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  recorded_at: string;
  source: 'auto' | 'reading' | 'stop';
  place_ar: string | null;
  place_en: string | null;
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
  /** The newest known position, if the driver has shared one. */
  locations: ShipmentLocation[];
}

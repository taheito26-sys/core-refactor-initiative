import { supabase } from '@/integrations/supabase/client';
import { compressPhoto } from './image';
import type { Shipment, ShipmentDriver, ShipmentReading, ShipmentStop, ShipmentWithDetails } from './types';

// The generated Supabase types predate the shipments tables and functions; drop this cast once
// they are regenerated. It only describes the few calls this module makes.
interface Query extends PromiseLike<{ data: unknown; error: Error | null }> {
  eq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean; referencedTable?: string }): Query;
  limit(count: number, options?: { referencedTable?: string }): Query;
  maybeSingle(): PromiseLike<{ data: unknown; error: Error | null }>;
}
interface UntypedClient {
  from(table: string): { select(columns: string): Query };
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: Error | null }>;
}
const db = supabase as unknown as UntypedClient;

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

const LIST_SELECT =
  '*, driver:shipment_drivers(id, display_name, truck_plate, phone), stops:shipment_stops(*), readings:shipment_readings(*)';

/** Shipments the caller can see: a customer's own, or the ones assigned to a driver. Newest first. */
export async function listShipments(): Promise<ShipmentWithDetails[]> {
  const { data, error } = await db
    .from('shipments')
    .select(LIST_SELECT)
    .order('created_at', { ascending: false })
    .order('taken_at', { ascending: false, referencedTable: 'readings' })
    .limit(1, { referencedTable: 'readings' });
  if (error) throw error;
  return (data ?? []) as ShipmentWithDetails[];
}

export interface ShipmentDetail extends ShipmentWithDetails {
  /** Every reading, newest first. */
  readings: ShipmentReading[];
}

export async function getShipment(id: string): Promise<ShipmentDetail | null> {
  const { data, error } = await db
    .from('shipments')
    .select(LIST_SELECT)
    .eq('id', id)
    .order('taken_at', { ascending: false, referencedTable: 'readings' })
    .maybeSingle();
  if (error) throw error;
  return (data as ShipmentDetail | null) ?? null;
}

export async function listDrivers(): Promise<ShipmentDriver[]> {
  const { data, error } = await db.from('shipment_drivers').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ShipmentDriver[];
}

export interface NewShipmentInput {
  cargo: string;
  weightTons: number | null;
  targetTempC: number;
  toleranceC: number;
  intervalHours: number;
  driverId: string | null;
  note: string;
  stops: { name_en: string; name_ar: string }[];
}

export const createShipment = (input: NewShipmentInput) =>
  rpc<Shipment>('create_customer_shipment', {
    p_cargo: input.cargo,
    p_weight_tons: input.weightTons,
    p_target_temp: input.targetTempC,
    p_tolerance: input.toleranceC,
    p_interval_hours: input.intervalHours,
    p_driver_id: input.driverId,
    p_note: input.note,
    p_stops: input.stops,
  });

export const assignShipmentDriver = (shipmentId: string, driverId: string | null) =>
  rpc<Shipment>('customer_assign_shipment_driver', { p_shipment_id: shipmentId, p_driver_id: driverId });

export const cancelShipment = (shipmentId: string) => rpc<Shipment>('customer_cancel_shipment', { p_shipment_id: shipmentId });

export const setDriverActive = (driverId: string, active: boolean) =>
  rpc<ShipmentDriver>('customer_set_driver_active', { p_driver_id: driverId, p_active: active });

export interface NewDriverInput {
  username: string;
  password: string;
  displayName: string;
  phone: string;
  truckPlate: string;
}

/** Creates the driver's login (an auth user), so it runs in an edge function with the service role. */
export async function createDriver(input: NewDriverInput): Promise<{ driverId: string; username: string }> {
  const { data, error } = await supabase.functions.invoke('create-shipment-driver', { body: input });
  if (error) {
    // The function answers with { error } and a 4xx; the client wraps that in a generic message.
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error((detail as { error?: string } | null)?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as { driverId: string; username: string };
}

export const startShipment = (shipmentId: string) => rpc<Shipment>('driver_start_shipment', { p_shipment_id: shipmentId });

export const reachStop = (stopId: string) => rpc<Shipment>('driver_reach_stop', { p_stop_id: stopId });

export const addStop = (shipmentId: string, name: string) =>
  rpc<ShipmentStop>('driver_add_stop', { p_shipment_id: shipmentId, p_name: name });

export interface ReadingInput {
  shipmentId: string;
  photo: File;
  temperatureC: number;
  setPointC: number | null;
  note: string;
}

/** Uploads the (shrunk) screen photo, then records the reading that points at it. */
export async function submitReading(input: ReadingInput): Promise<ShipmentReading> {
  const blob = await compressPhoto(input.photo);
  const path = `${input.shipmentId}/${Date.now()}-${crypto.randomUUID()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from('shipment-photos')
    .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
  if (uploadError) throw uploadError;
  return rpc<ShipmentReading>('driver_submit_reading', {
    p_shipment_id: input.shipmentId,
    p_temperature: input.temperatureC,
    p_set_point: input.setPointC,
    p_photo_path: path,
    p_note: input.note,
  });
}

export async function signedPhotoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('shipment-photos').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw error ?? new Error('No photo URL');
  return data.signedUrl;
}

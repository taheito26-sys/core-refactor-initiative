import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import {
  addStop, assignShipmentDriver, cancelShipment, createDriver, createShipment, getShipment, listDrivers,
  listShipments, reachStop, setDriverActive, signedPhotoUrl, startShipment, submitReading,
} from './api';

const SHIPMENTS_KEY = ['shipments'] as const;
/** Fallback poll when realtime is unavailable: a few hours between readings makes a minute plenty. */
const REFRESH_MS = 60_000;

export function useShipments() {
  const { userId } = useAuth();
  useShipmentsRealtime();
  return useQuery({ queryKey: [...SHIPMENTS_KEY, 'list'], queryFn: listShipments, enabled: !!userId, refetchInterval: REFRESH_MS });
}

export function useShipment(id: string | null) {
  return useQuery({
    queryKey: [...SHIPMENTS_KEY, 'one', id],
    queryFn: () => getShipment(id as string),
    enabled: !!id,
    refetchInterval: REFRESH_MS,
  });
}

export const useDrivers = () => {
  const { userId } = useAuth();
  return useQuery({ queryKey: ['shipment-drivers'], queryFn: listDrivers, enabled: !!userId });
};

/** A new reading, stop or status change shows up without a reload. Visible rows are limited by RLS. */
function useShipmentsRealtime() {
  const qc = useQueryClient();
  const { userId } = useAuth();
  useEffect(() => {
    if (!userId) return;
    const refresh = () => qc.invalidateQueries({ queryKey: SHIPMENTS_KEY });
    const channel = supabase
      .channel(`shipments-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shipments' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shipment_stops' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shipment_readings' }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [qc, userId]);
}

/** Signed photo URLs last an hour, so they are cached for most of it. */
export const usePhotoUrl = (path: string | null) =>
  useQuery({ queryKey: ['shipment-photo', path], queryFn: () => signedPhotoUrl(path as string), enabled: !!path, staleTime: 50 * 60_000 });

function useShipmentMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>, alsoInvalidate: readonly (readonly string[])[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SHIPMENTS_KEY });
      alsoInvalidate.forEach((key) => qc.invalidateQueries({ queryKey: [...key] }));
    },
  });
}

export const useCreateShipment = () => useShipmentMutation(createShipment);
export const useCancelShipment = () => useShipmentMutation(cancelShipment);
export const useAssignDriver = () =>
  useShipmentMutation(({ shipmentId, driverId }: { shipmentId: string; driverId: string | null }) => assignShipmentDriver(shipmentId, driverId));
export const useCreateDriver = () => useShipmentMutation(createDriver, [['shipment-drivers']]);
export const useSetDriverActive = () =>
  useShipmentMutation(({ driverId, active }: { driverId: string; active: boolean }) => setDriverActive(driverId, active), [['shipment-drivers']]);
export const useStartShipment = () => useShipmentMutation(startShipment);
export const useReachStop = () => useShipmentMutation(reachStop);
export const useAddStop = () => useShipmentMutation(({ shipmentId, name }: { shipmentId: string; name: string }) => addStop(shipmentId, name));
export const useSubmitReading = () => useShipmentMutation(submitReading);

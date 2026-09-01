import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ExchangeId } from '../types';

export type CounterpartyEntityType = 'customer' | 'supplier';

export interface CounterpartyMapping {
  id: string;
  exchange: ExchangeId;
  counterpartyName: string;
  entityType: CounterpartyEntityType;
  /** Customer id for entityType 'customer'; null for 'supplier' (batches store a name only, no id). */
  entityId: string | null;
  entityName: string;
}

const normalizeCounterparty = (name: string) => name.trim().toLowerCase();

export function useCounterpartyMap() {
  return useQuery({
    queryKey: ['exchange-counterparty-map'],
    queryFn: async (): Promise<CounterpartyMapping[]> => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('exchange_counterparty_map' as any)
        .select('id, exchange, counterparty_name, entity_type, entity_id, entity_name');
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((r: any) => ({
        id: r.id as string,
        exchange: r.exchange as ExchangeId,
        counterpartyName: r.counterparty_name as string,
        entityType: r.entity_type as CounterpartyEntityType,
        entityId: (r.entity_id as string | null) ?? null,
        entityName: r.entity_name as string,
      }));
    },
  });
}

/** Looks up a remembered mapping for a given exchange + counterparty + which side (customer/supplier). */
export function findCounterpartyMapping(
  mappings: CounterpartyMapping[] | undefined,
  exchange: ExchangeId,
  counterpartyName: string | undefined | null,
  entityType: CounterpartyEntityType,
): CounterpartyMapping | undefined {
  if (!counterpartyName?.trim()) return undefined;
  const key = normalizeCounterparty(counterpartyName);
  return mappings?.find(
    (m) => m.exchange === exchange && m.entityType === entityType && normalizeCounterparty(m.counterpartyName) === key,
  );
}

/**
 * Remembers (or updates) which tracker Customer/Supplier a counterparty name
 * resolves to. Called after every exchange-imported save, not just from an
 * explicit "map this" action -- whichever name the user actually saved under
 * (auto-resolved, hand-typed, or picked from the existing list) becomes the
 * mapping, so the next import from the same counterparty prefills correctly
 * without any extra setup step.
 */
export async function saveCounterpartyMapping(params: {
  exchange: ExchangeId;
  counterpartyName: string;
  entityType: CounterpartyEntityType;
  entityId?: string | null;
  entityName: string;
}): Promise<void> {
  const name = params.counterpartyName.trim();
  if (!name || !params.entityName.trim()) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('exchange_counterparty_map' as any)
    .upsert(
      {
        user_id: user.id,
        exchange: params.exchange,
        counterparty_name: name,
        entity_type: params.entityType,
        entity_id: params.entityId ?? null,
        entity_name: params.entityName.trim(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,exchange,counterparty_name,entity_type' },
    );
  if (error) console.warn('[counterparty-map] save failed:', error.message);
}

export function useInvalidateCounterpartyMap() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['exchange-counterparty-map'] });
}

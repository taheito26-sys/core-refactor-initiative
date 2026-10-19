import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { statementKey, statementQueryOptions } from '@/features/customer/statements-api';

describe('statement query options', () => {
  beforeEach(() => { localStorage.clear(); invoke.mockReset(); });

  it('paints from the last answer remembered on the device while a fresh one loads', async () => {
    invoke.mockResolvedValue({ data: { statements: [{ id: 1 }] }, error: null });
    expect(statementQueryOptions('plain', 'u1').initialData).toBeUndefined();
    await statementQueryOptions('plain', 'u1').queryFn();
    const next = statementQueryOptions('plain', 'u1');
    expect(next.initialData).toEqual([{ id: 1 }]);
    expect(next.initialDataUpdatedAt).toBeGreaterThan(0);
    // another buyer on the same device does not see it
    expect(statementQueryOptions('plain', 'u2').initialData).toBeUndefined();
  });

  it('keeps the remembered answer when a refresh fails instead of replacing it with nothing', async () => {
    invoke.mockResolvedValueOnce({ data: { statements: [{ id: 1 }] }, error: null });
    await statementQueryOptions('sales', 'u1').queryFn();
    invoke.mockResolvedValueOnce({ data: null, error: new Error('down') });
    await expect(statementQueryOptions('sales', 'u1').queryFn()).rejects.toThrow();
    expect(statementQueryOptions('sales', 'u1').initialData).toEqual([{ id: 1 }]);
  });

  it('keeps the two variants under their own keys', () => {
    expect(statementKey('plain', 'u')).not.toEqual(statementKey('sales', 'u'));
    expect(invoke).not.toHaveBeenCalled();
  });
});

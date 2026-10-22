import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { rememberCustomerRole, statementKey, statementQueryOptions, warmStatements } from '@/features/customer/statements-api';

describe('statement query options', () => {
  beforeEach(() => { localStorage.clear(); invoke.mockReset(); });

  it('always asks the server and never seeds the page with an answer kept on the device', async () => {
    invoke.mockResolvedValue({ data: { statements: [{ id: 1 }] }, error: null });
    const options = statementQueryOptions('plain', 'u1');
    expect(options).not.toHaveProperty('initialData');
    expect(await options.queryFn()).toEqual([{ id: 1 }]);
    expect(Object.keys(localStorage).filter(k => k.includes('stmt'))).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(1);
    await statementQueryOptions('plain', 'u1').queryFn();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('shares one request between callers that ask at the same moment', async () => {
    let release: (v: unknown) => void = () => undefined;
    invoke.mockReturnValue(new Promise(r => { release = r; }));
    const a = statementQueryOptions('plain', 'u1').queryFn();
    const b = statementQueryOptions('plain', 'u1').queryFn();
    release({ data: { statements: [{ id: 2 }] }, error: null });
    expect(await a).toEqual([{ id: 2 }]);
    expect(await b).toEqual([{ id: 2 }]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('fails when the server fails instead of falling back to anything', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('down') });
    await expect(statementQueryOptions('sales', 'u1').queryFn()).rejects.toThrow();
  });

  it('starts early only for an account known to be a buyer', async () => {
    invoke.mockResolvedValue({ data: { statements: [] }, error: null });
    warmStatements('merchant-1');
    expect(invoke).not.toHaveBeenCalled();
    rememberCustomerRole('buyer-1');
    warmStatements('buyer-1');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('keeps the two variants under their own keys', () => {
    expect(statementKey('plain', 'u')).not.toEqual(statementKey('sales', 'u'));
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const select = vi.fn();
const chain: Record<string, unknown> = {};
chain.update = vi.fn(() => chain);
chain.eq = vi.fn(() => chain);
chain.select = select;
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: vi.fn(() => chain) } }));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ user: { id: 'm' } }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { acceptClaimRecord } from '@/hooks/useLoanPaymentClaims';

beforeEach(() => { vi.clearAllMocks(); (chain.update as ReturnType<typeof vi.fn>).mockClear(); });

describe('acceptClaimRecord', () => {
  it('accepts through the database function', async () => {
    rpc.mockResolvedValue({ error: null });
    await acceptClaimRecord('claim-1', 'batch-1');
    expect(rpc).toHaveBeenCalledWith('accept_loan_payment_claim', { p_claim_id: 'claim-1', p_batch_id: 'batch-1' });
    expect(select).not.toHaveBeenCalled();
  });

  it('surfaces what the database refused, without falling back', async () => {
    rpc.mockResolvedValue({ error: { code: 'P0001', message: 'This payment claim was already rejected' } });
    await expect(acceptClaimRecord('c', 'b')).rejects.toMatchObject({ message: 'This payment claim was already rejected' });
    expect(select).not.toHaveBeenCalled();
  });

  it('falls back to a guarded update while the function is not installed', async () => {
    rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'Could not find the function public.accept_loan_payment_claim' } });
    select.mockResolvedValue({ data: [{ id: 'c' }], error: null });
    await acceptClaimRecord('c', 'b');
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'accepted', applied_batch_id: 'b' }));
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending');
  });

  it('treats an update that changed no row as a failure, not a success', async () => {
    rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'x' } });
    select.mockResolvedValue({ data: [], error: null });
    await expect(acceptClaimRecord('c', 'b')).rejects.toThrow('already reviewed');
  });
});

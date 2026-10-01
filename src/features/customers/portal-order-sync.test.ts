import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { isMissingFunctionError, mirrorAction, portalSignature } from './portal-order-sync';

const PORTAL = '11111111-1111-4111-8111-111111111111';
const trade = { amountUSDT: 100, sellPriceQAR: 3.65, voided: false };

describe('portalSignature', () => {
  it('changes when the amount, rate, void state or buyer changes', () => {
    const base = portalSignature(trade, PORTAL);
    expect(portalSignature({ ...trade, amountUSDT: 101 }, PORTAL)).not.toBe(base);
    expect(portalSignature({ ...trade, sellPriceQAR: 3.7 }, PORTAL)).not.toBe(base);
    expect(portalSignature({ ...trade, voided: true }, PORTAL)).not.toBe(base);
    expect(portalSignature(trade, null)).not.toBe(base);
    expect(portalSignature({ ...trade }, PORTAL)).toBe(base);
  });
});

describe('mirrorAction', () => {
  const sig = portalSignature(trade, PORTAL);

  it('does nothing for a trade already in sync', () => {
    expect(mirrorAction({ ...trade, mirrorStatus: 'mirrored', mirrorSignature: sig }, sig)).toBe('none');
  });

  it('leaves trades skipped before signatures existed alone (no surprise history push)', () => {
    expect(mirrorAction({ ...trade, mirrorStatus: 'skipped_not_connected' }, sig)).toBe('none');
    expect(mirrorAction({ ...trade, mirrorStatus: 'failed' }, sig)).toBe('none');
  });

  it('reconciles a mirrored trade that was edited, voided or reassigned', () => {
    expect(mirrorAction({ ...trade, mirrorStatus: 'mirrored', mirrorSignature: 'old' }, sig)).toBe('reconcile');
    expect(mirrorAction({ ...trade, mirrorStatus: 'mirrored' }, sig)).toBe('reconcile');
  });

  it('syncs a new trade, and a skipped one whose buyer has since been linked', () => {
    expect(mirrorAction({ ...trade }, sig)).toBe('sync');
    expect(mirrorAction({ ...trade, mirrorStatus: 'skipped_not_connected', mirrorSignature: portalSignature(trade, null) }, sig)).toBe('sync');
  });

  it('marks a voided, never-mirrored trade as skipped without calling the server', () => {
    const voided = { ...trade, voided: true };
    expect(mirrorAction(voided, portalSignature(voided, PORTAL))).toBe('mark_skipped');
  });
});

describe('isMissingFunctionError', () => {
  it('recognises PostgREST missing-function errors', () => {
    expect(isMissingFunctionError({ code: 'PGRST202', message: '' })).toBe(true);
    expect(isMissingFunctionError({ message: 'Could not find the function public.reconcile_mirrored_customer_order' })).toBe(true);
    expect(isMissingFunctionError({ code: '42501', message: 'permission denied' })).toBe(false);
  });
});

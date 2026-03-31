import { describe, expect, it } from 'vitest';
import { classifyLedgerLine } from '@/services/ledgerImport/classifier';
import { parseLedgerText } from '@/services/ledgerImport/parser';
import { buildNetworkMerchants } from '@/services/ledgerImport/network';

const ctx = {
  uploaderUserId: 'user-123',
  selectedMerchantId: 'merchant-z',
  selectedMerchantName: 'Z merchant',
  sourceType: 'pasted_text' as const,
};

describe('ledger import phase parser', () => {
  it('pasted text parsing still works', () => {
    const row = classifyLedgerLine('محمد ارسللي usdt 15000 على 3.72', 0, ctx);
    expect(row.status).toBe('parsed');
    expect(row.parsedType).toBe('merchant_deal');
    expect(row.direction).toBe('merchant_to_me');
  });

  it('محمد is never treated as merchant and selected merchant remains counterparty', () => {
    const row = classifyLedgerLine('محمد ارسللي usdt 100 على 3.7 بواسطة ابو تميم', 1, ctx);
    expect(row.uploaderUserId).toBe('user-123');
    expect(row.selectedMerchantId).toBe('merchant-z');
    expect(row.selectedMerchantName).toBe('Z merchant');
    expect(row.intermediary).toContain('ابو تميم');
  });

  it('ابو عوني stays intermediary metadata by default', () => {
    const row = classifyLedgerLine('ارسلت لمحمد usdt 2000 على 3.72 (ابو عوني)', 1, ctx);
    expect(row.intermediary).toContain('ابو عوني');
    expect(row.parsedType).toBe('merchant_deal');
  });

  it('unsupported rows remain skipped', () => {
    const row = classifyLedgerLine('اشتريت usdt 25745 على 3.735', 1, ctx);
    expect(row.status).toBe('skipped');
    expect(row.saveEnabled).toBe(false);
  });

  it('image/OCR source gets low-confidence needs_review status', () => {
    const imageBatch = parseLedgerText('محمد ارسللي usdt 50 على 3.6', {
      ...ctx,
      sourceType: 'image',
      confidencePenalty: 0.3,
    });
    expect(imageBatch.rows[0].status).toBe('needs_review');
    expect(imageBatch.rows[0].saveEnabled).toBe(false);
  });

  it('network merchant list only includes related merchants', () => {
    const merchants = buildNetworkMerchants(
      'm-me',
      [{ id: 'rel-1', merchant_a_id: 'm-me', merchant_b_id: 'm-a' }],
      [
        { merchant_id: 'm-a', display_name: 'A', nickname: null, merchant_code: null },
        { merchant_id: 'm-outside', display_name: 'Outside', nickname: null, merchant_code: null },
      ],
    );
    expect(merchants).toHaveLength(1);
    expect(merchants[0].merchantId).toBe('m-a');
  });
});

import { describe, expect, it } from 'vitest';
import { classifyLedgerLine } from '@/services/ledgerImport/classifier';
import { parseLedgerText } from '@/services/ledgerImport/parser';

const ctx = {
  ownerUserId: 'user-123',
  defaultCounterpartyMerchant: 'Zack',
};

describe('ledger import phase 1 parser', () => {
  it('parses Mohamed sent-to-me USDT line as merchant_to_me', () => {
    const row = classifyLedgerLine('محمد ارسللي usdt 15000 على 3.72', ctx);
    expect(row.status).toBe('parsed');
    expect(row.type).toBe('merchant_deal');
    expect(row.direction).toBe('merchant_to_me');
    expect(row.usdtAmount).toBe(15000);
    expect(row.rate).toBe(3.72);
    expect(row.counterpartyMerchant).toBe('Zack');
  });

  it('parses sent-to-Mohamed as me_to_merchant with intermediary', () => {
    const row = classifyLedgerLine('ارسلت لمحمد usdt 2000 على 3.72 (ابو عوني)', ctx);
    expect(row.status).toBe('parsed');
    expect(row.direction).toBe('me_to_merchant');
    expect(row.intermediary).toContain('ابو');
  });

  it('skips stock purchase lines in phase 1', () => {
    const row = classifyLedgerLine('اشتريت usdt 25745 على 3.735', ctx);
    expect(row.status).toBe('skipped');
    expect(row.type).toBe('unsupported');
    expect(row.saveEnabled).toBe(false);
  });

  it('never treats محمد as merchant and always keeps Zack as counterparty', () => {
    const row = classifyLedgerLine('محمد ارسللي usdt 15000 على 3.72 بواسطة ابو تميم', ctx);
    expect(row.ownerUserId).toBe('user-123');
    expect(row.counterpartyMerchant).toBe('Zack');
    expect(row.intermediary).toContain('ابو تميم');
  });

  it('deduplicates normalized duplicate lines in same batch', () => {
    const batch = parseLedgerText(
      'محمد ارسللي usdt 15000 على 3.72\nمحمد   ارسللي usdt 15000 على 3.72',
      ctx,
    );

    expect(batch.rows).toHaveLength(2);
    expect(batch.rows[0].status).toBe('parsed');
    expect(batch.rows[1].status).toBe('skipped');
    expect(batch.rows[1].parseResult).toContain('Duplicate');
  });
});

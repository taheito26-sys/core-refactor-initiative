import { describe, expect, it } from 'vitest';
import { parseBalanceSms } from '@/features/bank-sms/parser';
import { applyBalance, applySmsBatch, balanceKey, latestSmsTimestamp } from '@/features/bank-sms/cache';

const sms = (body: string, date = 1000, address = 'QNB') => ({ address, body, date });

describe('parseBalanceSms', () => {
  it('reads an English available balance with account and currency', () => {
    const p = parseBalanceSms(sms('Debit of QAR 150.00 from A/C xxxx1234. Available balance: QAR 12,345.67'));
    expect(p).toMatchObject({ sender: 'QNB', last4: '1234', currency: 'QAR', balance: 12345.67 });
  });

  it('reads an Arabic message with Arabic-Indic digits', () => {
    const p = parseBalanceSms(sms('تم سحب ٥٠٠ جنيه من حسابك المنتهي بـ ٩٨٧٦. رصيدك المتاح ١٢٬٣٤٥٫٥٠ جنيه', 1, 'CIB'));
    expect(p).toMatchObject({ currency: 'EGP', balance: 12345.5 });
  });

  it('handles trailing currency and DR as negative', () => {
    expect(parseBalanceSms(sms('Avl Bal 250.75 QAR'))).toMatchObject({ balance: 250.75, currency: 'QAR' });
    expect(parseBalanceSms(sms('Balance: 40.00 DR EGP'))?.balance).toBe(-40);
  });

  it('ignores OTPs and non-balance messages', () => {
    expect(parseBalanceSms(sms('Your OTP is 123456. Balance enquiry code'))).toBeNull();
    expect(parseBalanceSms(sms('See you at 5 tomorrow'))).toBeNull();
  });
});

describe('balance cache', () => {
  const a = parseBalanceSms(sms('Available balance QAR 100.00', 1000))!;
  const b = parseBalanceSms(sms('Available balance QAR 80.00', 2000))!;

  it('newer SMS replaces older', () => {
    const cache = applyBalance(applyBalance({}, a), b);
    expect(cache[balanceKey(a)].balance).toBe(80);
  });

  it('older SMS never overwrites a newer balance, in any order', () => {
    const cache = applyBalance(applyBalance({}, b), a);
    expect(cache[balanceKey(a)].balance).toBe(80);
  });

  it('keeps separate entries per bank and account, and batches idempotently', () => {
    const batch = [
      sms('Avl bal QAR 10.00 a/c 1111', 1, 'QNB'),
      sms('Avl bal QAR 20.00 a/c 2222', 2, 'QNB'),
      sms('Avl bal EGP 30.00', 3, 'CIB'),
    ];
    const once = applySmsBatch({}, batch);
    expect(Object.keys(once)).toHaveLength(3);
    expect(applySmsBatch(once, batch)).toBe(once);
    expect(latestSmsTimestamp(once)).toBe(3);
  });
});

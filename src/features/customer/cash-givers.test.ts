import { describe, expect, it } from 'vitest';
import { findGiverInNotes, giverPaymentNumbers, normalizeGiverText, resolveGiver, typedPaymentNumber } from './cash-givers';

describe('findGiverInNotes', () => {
  const givers = ['Hassan', 'Damrawi', 'حسن'];

  it('finds a giver named in a note, in either script', () => {
    expect(findGiverInNotes(['Hassan payment 28'], givers)).toBe('Hassan');
    expect(findGiverInNotes(['حسن دفعة 28'], givers)).toBe('حسن');
  });

  it('ignores case and Arabic diacritics', () => {
    expect(findGiverInNotes(['from DAMRAWI'], givers)).toBe('Damrawi');
    expect(findGiverInNotes(['حَسَن دفعة'], givers)).toBe('حسن');
  });

  it('matches whole words only', () => {
    expect(findGiverInNotes(['Hassanein payment'], givers)).toBeNull();
  });

  it('prefers the longer name when several are mentioned', () => {
    expect(findGiverInNotes(['Ali Hassan'], ['Ali', 'Ali Hassan'])).toBe('Ali Hassan');
  });

  it('returns null when nothing is named', () => {
    expect(findGiverInNotes(['bank transfer', null, undefined], givers)).toBeNull();
    expect(findGiverInNotes(['Hassan'], [])).toBeNull();
  });

  it('searches every note given', () => {
    expect(findGiverInNotes([null, 'merchant note', 'Hassan'], givers)).toBe('Hassan');
  });
});

describe('resolveGiver', () => {
  it('lets an explicit assignment override the notes', () => {
    expect(resolveGiver('Damrawi', ['Hassan payment'], ['Hassan', 'Damrawi'])).toBe('Damrawi');
  });

  it('falls back to the notes, then to nothing', () => {
    expect(resolveGiver(null, ['Hassan payment'], ['Hassan'])).toBe('Hassan');
    expect(resolveGiver('  ', ['x'], ['Hassan'])).toBeNull();
  });
});

describe('giverPaymentNumbers', () => {
  it('counts each giver separately in date order', () => {
    const n = giverPaymentNumbers([
      { key: 'c', date: 300, giver: 'Hassan' },
      { key: 'a', date: 100, giver: 'Hassan' },
      { key: 'b', date: 200, giver: 'Damrawi' },
      { key: 'd', date: 400, giver: 'Damrawi' },
      { key: 'e', date: 500, giver: null },
    ]);
    expect(n.get('a')).toBe(1);
    expect(n.get('c')).toBe(2);
    expect(n.get('b')).toBe(1);
    expect(n.get('d')).toBe(2);
    expect(n.has('e')).toBe(false);
  });

  it('treats spelling variants of one name as the same giver', () => {
    const n = giverPaymentNumbers([
      { key: 'a', date: 1, giver: 'Hassan' },
      { key: 'b', date: 2, giver: 'hassan ' },
    ]);
    expect(n.get('b')).toBe(2);
  });

  it('is stable for payments that share a date', () => {
    const rows = [{ key: 'y', date: 5, giver: 'A' }, { key: 'x', date: 5, giver: 'A' }];
    expect(giverPaymentNumbers(rows).get('x')).toBe(1);
    expect(giverPaymentNumbers([...rows].reverse()).get('x')).toBe(1);
  });
});

describe('normalizeGiverText', () => {
  it('folds alef, ya and ta marbuta variants', () => {
    expect(normalizeGiverText('أحمد')).toBe(normalizeGiverText('احمد'));
    expect(normalizeGiverText('فاطمة')).toBe(normalizeGiverText('فاطمه'));
  });
});

describe('typedPaymentNumber', () => {
  it('reads the number written next to the giver, in either digit script', () => {
    expect(typedPaymentNumber(['حسن دفعة رقم ١٢'], 'حسن')).toBe(12);
    expect(typedPaymentNumber(['دفعه حسن 36'], 'حسن')).toBe(36);
    expect(typedPaymentNumber(['دفعة رقم ١٩ عم حسن'], 'حسن')).toBe(19);
  });

  it('ignores amounts, decimals and notes that do not name the giver', () => {
    expect(typedPaymentNumber(['Note count: 20,000'], 'حسن')).toBeNull();
    expect(typedPaymentNumber(['حسن 19000 فيهم 12000'], 'حسن')).toBeNull();
    expect(typedPaymentNumber(['حسن 1.5'], 'حسن')).toBeNull();
    expect(typedPaymentNumber(['دفعة رقم 12'], 'حسن')).toBeNull();
    expect(typedPaymentNumber(['حسن'], 'حسن')).toBeNull();
  });

  it('refuses an ambiguous note and needs a giver', () => {
    expect(typedPaymentNumber(['حسن 12 و 13'], 'حسن')).toBeNull();
    expect(typedPaymentNumber(['حسن 12'], null)).toBeNull();
  });
});

describe('giverPaymentNumbers with numbers typed in notes', () => {
  const row = (key: string, date: number, typed: number | null) => ({ key, date, giver: 'حسن', typed });

  it('uses the typed number and lets an unnumbered payment fill the gap the buyer left', () => {
    const rows = [
      row('s10', 10, 11), row('s11', 11, null), row('s12', 12, 12), row('s13', 13, 13),
      row('s14', 14, 14), row('s16', 16, 15), row('s17', 17, 16), row('s18', 18, 19), row('s19', 19, 20),
    ];
    const n = giverPaymentNumbers(rows);
    expect(n.get('s12')).toBe(12);
    expect(n.get('s13')).toBe(13);
    expect(n.get('s18')).toBe(19);
    expect(n.get('s11')).toBe(17);
  });

  it('numbers a new payment after the highest run, not into an old gap', () => {
    const typed = [...Array(16).keys()].map(i => row(`t${i + 1}`, i + 1, i + 1));
    const later = [19, 20, 21].map((t, i) => row(`u${t}`, 30 + i, t));
    const n = giverPaymentNumbers([...typed, ...later, row('new1', 100, null), row('new2', 101, null)]);
    expect(n.get('new1')).toBe(22);
    expect(n.get('new2')).toBe(23);
  });

  it('is unchanged for a giver whose notes carry no numbers', () => {
    const n = giverPaymentNumbers([row('b', 2, null), row('a', 1, null), row('c', 3, null)]);
    expect([n.get('a'), n.get('b'), n.get('c')]).toEqual([1, 2, 3]);
  });

  it('keeps each giver separate', () => {
    const n = giverPaymentNumbers([
      { key: 'h', date: 1, giver: 'حسن', typed: 5 },
      { key: 'd', date: 2, giver: 'الدمراوي', typed: null },
    ]);
    expect(n.get('h')).toBe(5);
    expect(n.get('d')).toBe(1);
  });
});

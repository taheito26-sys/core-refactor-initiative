import { describe, expect, it } from 'vitest';
import { findGiverInNotes, giverPaymentNumbers, normalizeGiverText, resolveGiver } from './cash-givers';

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

import { describe, it, expect } from 'vitest';
import { computePageSlices } from '@/lib/htmlReportToPdf';

// Page breaks in the statement PDF are computed against the measured boxes of
// unbreakable elements (table rows, cards, headings). A boundary landing inside
// one renders that element cut in half across the page break — the "tail of the
// table is chopped off" bug reported from mobile, where substituted fonts make a
// sheet overflow that fits on one page elsewhere.

// Rows of `height` px, laid out back to back starting at `from`.
const rowsFrom = (from: number, count: number, height = 30): Array<[number, number]> =>
  Array.from({ length: count }, (_, i) => [from + i * height, from + (i + 1) * height] as [number, number]);

const boundariesOf = (slices: number[]) => {
  const out: number[] = [];
  let cursor = 0;
  for (const s of slices) { cursor += s; out.push(cursor); }
  out.pop(); // the final cursor is the end of content, not a page break
  return out;
};

const cutsThrough = (boundary: number, ranges: Array<[number, number]>) =>
  ranges.some(([top, bottom]) => boundary > top + 0.5 && boundary < bottom - 0.5);

describe('computePageSlices', () => {
  it('returns a single slice when the content already fits', () => {
    expect(computePageSlices(800, 1145, rowsFrom(100, 10))).toEqual([800]);
  });

  it('never breaks a page inside a row', () => {
    const ranges = rowsFrom(1100, 9);
    const slices = computePageSlices(1410, 1145, ranges);
    for (const b of boundariesOf(slices)) expect(cutsThrough(b, ranges)).toBe(false);
  });

  it('pulls the break back off the row that straddles the budget', () => {
    // A row spans 1100-1130 and the budget lands at 1145, mid-row. The break
    // must move up so the whole row travels to the next page.
    const slices = computePageSlices(1410, 1145, rowsFrom(1100, 9));
    expect(slices[0]).toBeLessThan(1145);
    expect(slices[0]).toBeLessThanOrEqual(1100);
  });

  it('always accounts for the full content height', () => {
    const cases: Array<[number, number, Array<[number, number]>]> = [
      [1410, 1145, rowsFrom(1100, 9)],
      [5000, 1145, rowsFrom(200, 150)],
      [1146, 1145, rowsFrom(1140, 2)],
      [3000, 500, rowsFrom(0, 100)],
    ];
    for (const [total, budget, ranges] of cases) {
      const sum = computePageSlices(total, budget, ranges).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(total, 5);
    }
  });

  it('keeps every slice within the page budget', () => {
    for (const slice of computePageSlices(5000, 1145, rowsFrom(200, 150))) {
      expect(slice).toBeLessThanOrEqual(1145);
    }
  });

  it('terminates on an element taller than a whole page instead of looping forever', () => {
    // A single 900px block against a 500px budget can't be kept whole. The
    // guard clause has to make forward progress rather than spin.
    const slices = computePageSlices(1000, 500, [[0, 900]]);
    expect(slices.length).toBeGreaterThan(0);
    expect(slices.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 5);
  });

  it('handles content with no unbreakable elements at all', () => {
    expect(computePageSlices(1000, 400, []).reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 5);
  });
});

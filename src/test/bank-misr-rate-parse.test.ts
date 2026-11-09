import { describe, expect, it } from 'vitest';
import { parseBankMisrQarNotes } from '../../supabase/functions/bank-misr-rates/parse';

const row = (name: string, ...v: string[]) =>
  `<tr> <td> <img class="img-flag" src="/-/media/flags/x.ashx" /> <br /> ${name} </td> ${v.map((n) => `<td>${n}</td>`).join(' ')} </tr>`;

const page = (...rows: string[]) => `<table>${rows.join('\n')}</table>`;

describe('parseBankMisrQarNotes', () => {
  it('reads the Notes buy and sell of the QATARI Riyal row, not the Transfer pair', () => {
    const html = page(
      row('US Dollar ', '53.93', '54.03', '53.93', '54.03'),
      row('QATARI Riyal ', '13.9745', '14.8251', '13.974471', '14.825079'),
      row('Saudi Riyal ', '14.2956', '14.3869', '14.29556', '14.386899'),
    );
    expect(parseBankMisrQarNotes(html)).toEqual({ buy: 13.9745, sell: 14.8251 });
  });

  it('returns null when the row is missing or the layout changed', () => {
    expect(parseBankMisrQarNotes(page(row('US Dollar ', '53.93', '54.03')))).toBeNull();
    expect(parseBankMisrQarNotes('')).toBeNull();
  });

  it('rejects implausible numbers instead of storing them', () => {
    expect(parseBankMisrQarNotes(page(row('QATARI Riyal ', '0', '0', '8', '9')))).toBeNull();
    expect(parseBankMisrQarNotes(page(row('QATARI Riyal ', '1482.51', '1482.51')))).toBeNull();
    expect(parseBankMisrQarNotes(page(row('QATARI Riyal ', '15.5', '14.8')))).toBeNull();
  });

  it('parses the live page captured today', () => {
    const live = '<td>\n<img class="img-flag" src="/-/media/flags/qar.ashx" />\n<br />\nQATARI Riyal\n</td>\n<td>13.9745</td>\n<td>14.8251</td>\n<td>13.974471</td>\n<td>14.825079</td>';
    expect(parseBankMisrQarNotes(live)).toEqual({ buy: 13.9745, sell: 14.8251 });
  });
});

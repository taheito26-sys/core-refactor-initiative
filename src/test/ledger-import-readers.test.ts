import { describe, expect, it } from 'vitest';
import { readTextFile, validateTextFile } from '@/services/ledgerImport/fileReaders/textFileReader';
import { readSpreadsheet } from '@/services/ledgerImport/fileReaders/spreadsheetReader';
import { canSaveImportedRows } from '@/services/ledgerImport/guards';
import { parseLedgerText } from '@/services/ledgerImport/parser';

function mockFile(name: string, content: string): File {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  return {
    name,
    size: data.byteLength,
    arrayBuffer: async () => data.buffer,
  } as unknown as File;
}

describe('ledger import readers and guards', () => {
  it('text file import normalization path works', async () => {
    const file = mockFile('ledger.txt', 'محمد ارسللي usdt 10 على 3.7');
    expect(validateTextFile(file)).toBeNull();
    const text = await readTextFile(file);
    const batch = parseLedgerText(text, {
      uploaderUserId: 'u1',
      selectedMerchantId: 'm1',
      selectedMerchantName: 'M1',
      sourceType: 'text_file',
      sourceFileName: file.name,
    });
    expect(batch.rows[0].sourceType).toBe('text_file');
    expect(batch.rows[0].status).toBe('parsed');
  });

  it('spreadsheet csv row mapping works', async () => {
    const file = mockFile('ledger.csv', 'pair,quantity,rate\nUSDT,125,3.73');
    const result = await readSpreadsheet(file);
    expect(result.lines[0]).toContain('usdt 125');
  });

  it('save blocked when no network merchant is selected', () => {
    const rows = parseLedgerText('محمد ارسللي usdt 10 على 3.7', {
      uploaderUserId: 'u1',
      selectedMerchantId: 'm1',
      selectedMerchantName: 'M1',
      sourceType: 'pasted_text',
    }).rows;

    expect(canSaveImportedRows('u1', '', rows)).toBe(false);
  });
});

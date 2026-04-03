import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTextFile, validateTextFile } from '@/services/ledgerImport/fileReaders/textFileReader';
import { readSpreadsheet } from '@/services/ledgerImport/fileReaders/spreadsheetReader';
import { assessOcrTextQuality, extractTextFromImage } from '@/services/ledgerImport/fileReaders/imageReader';
import { canSaveImportedRows } from '@/services/ledgerImport/guards';
import { parseLedgerText } from '@/services/ledgerImport/parser';

function mockFile(name: string, content: string): File {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  return {
    name,
    type: name.endsWith('.jpg') ? 'image/jpeg' : 'text/plain',
    size: data.byteLength,
    arrayBuffer: async () => data.buffer,
  } as unknown as File;
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('image pipeline does not decode raw image bytes as text reader fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: '', engine: 'easyocr', metadata: { mean_confidence: 0 } }),
    }));

    const file = {
      name: 'photo.jpg',
      type: 'image/jpeg',
      size: 100,
      arrayBuffer: async () => { throw new Error('should not read raw bytes'); },
    } as unknown as File;

    const ocr = await extractTextFromImage(file);
    expect(ocr.ranOcr).toBe(true);
    expect(ocr.warning).toBeTruthy();
  });

  it('binary-like OCR text is rejected by heuristics', () => {
    const quality = assessOcrTextQuality('@@@###$$$%%%%__--==');
    expect(quality.isValid).toBe(false);
  });

  it('parser receives OCR extracted text (not image binary) for photo source', () => {
    const ocrText = 'محمد ارسللي usdt 20 على 3.7';
    const batch = parseLedgerText(ocrText, {
      uploaderUserId: 'u1',
      selectedMerchantId: 'm1',
      selectedMerchantName: 'M1',
      sourceType: 'image',
      sourceFileName: 'photo.jpg',
      confidencePenalty: 0.15,
    });
    expect(batch.rows[0].rawLine).toContain('usdt 20');
    expect(batch.rows[0].confidence).toBeLessThan(0.92);
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

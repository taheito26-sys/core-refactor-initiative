const SPREADSHEET_EXTENSIONS = ['xlsx', 'xls', 'csv'];
const MAX_SPREADSHEET_SIZE = 8 * 1024 * 1024;

export interface SpreadsheetParseResult {
  sheets: string[];
  selectedSheet: string;
  lines: string[];
}

export function validateSpreadsheetFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!SPREADSHEET_EXTENSIONS.includes(ext)) return `Unsupported spreadsheet type: .${ext || 'unknown'}`;
  if (file.size > MAX_SPREADSHEET_SIZE) return 'Spreadsheet exceeds 8MB limit';
  return null;
}

function parseCsvRows(text: string): string[] {
  const rows = text.split(/\r?\n/).filter(Boolean);
  if (rows.length === 0) return [];
  const header = rows[0].split(',').map((v) => v.trim().toLowerCase());

  return rows.slice(1).map((row) => {
    const cols = row.split(',').map((v) => v.trim());
    const record: Record<string, string> = {};
    cols.forEach((value, index) => {
      record[header[index] || `col_${index}`] = value;
    });

    const qty = Number(record.quantity || record.amount || 0);
    const rate = Number(record.rate || record.price || 0);
    const pair = (record.pair || record.currency || '').toLowerCase();
    if (qty > 0 && rate > 0 && pair.includes('usdt')) {
      return `محمد ارسللي usdt ${qty} على ${rate}`;
    }

    return Object.entries(record).map(([k, v]) => `${k}: ${v}`).join(' | ');
  });
}

function extractBinaryText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let ascii = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const ch = bytes[i];
    ascii += (ch >= 32 && ch <= 126) ? String.fromCharCode(ch) : ' ';
  }
  return ascii.replace(/\s+/g, ' ').trim();
}

export async function readSpreadsheet(file: File): Promise<SpreadsheetParseResult> {
  const validation = validateSpreadsheetFile(file);
  if (validation) throw new Error(validation);

  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'csv') {
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(buffer);
    return { sheets: ['Sheet1'], selectedSheet: 'Sheet1', lines: parseCsvRows(text) };
  }

  const buffer = await file.arrayBuffer();
  const extracted = extractBinaryText(buffer);
  if (!extracted) {
    throw new Error('Spreadsheet parsing failed. Try exporting the sheet as CSV and re-uploading.');
  }

  return {
    sheets: ['Sheet1'],
    selectedSheet: 'Sheet1',
    lines: extracted.split(/\s{2,}/).slice(0, 200),
  };
}

const ARABIC_NUM_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

export function normalizeArabicDigits(input: string): string {
  return input.replace(/[٠-٩]/g, (digit) => ARABIC_NUM_MAP[digit] ?? digit);
}

export function normalizeLedgerLine(input: string): string {
  const collapsed = normalizeArabicDigits(input)
    .replace(/[“”"'`]/g, '')
    .replace(/[،؛]/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return collapsed
    .replace(/\bيو ?اس ?دي ?تي\b/g, 'usdt')
    .replace(/\busd ?t\b/g, 'usdt')
    .replace(/\bارسل لي\b/g, 'ارسللي')
    .replace(/\bأرسل لي\b/g, 'ارسللي')
    .replace(/\bأرسلت\b/g, 'ارسلت')
    .replace(/\bالى\b/g, 'الى')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitLedgerLines(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function hashNormalizedLine(normalizedLine: string): string {
  let hash = 5381;
  for (let i = 0; i < normalizedLine.length; i += 1) {
    hash = ((hash << 5) + hash) + normalizedLine.charCodeAt(i);
  }
  return `h_${(hash >>> 0).toString(16)}`;
}

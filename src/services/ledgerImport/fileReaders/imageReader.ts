const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

declare global {
  interface Window {
    Tesseract?: {
      recognize: (file: File, lang: string) => Promise<{ data?: { text?: string } }>;
    };
  }
}

export interface OcrExtractionResult {
  text: string;
  ranOcr: boolean;
  engine: string;
  warning: string | null;
}

export function validateImageFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!IMAGE_EXTENSIONS.includes(ext)) return `Unsupported image type: .${ext || 'unknown'}`;
  if (file.size > MAX_IMAGE_SIZE) return 'Image exceeds 10MB limit';
  return null;
}

export function assessOcrTextQuality(text: string): { isValid: boolean; reason: string | null } {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const arabic = (normalized.match(/[\u0600-\u06FF]/g) || []).length;
  const digits = (normalized.match(/[0-9٠-٩]/g) || []).length;
  const symbols = (normalized.match(/[^\w\s\u0600-\u06FF]/g) || []).length;
  const total = Math.max(1, normalized.length);
  const symbolRatio = symbols / total;

  if (normalized.length < 8) return { isValid: false, reason: 'OCR output too short' };
  if (arabic + digits < 6) return { isValid: false, reason: 'OCR output lacks enough Arabic letters/digits' };
  if (symbolRatio > 0.35) return { isValid: false, reason: 'OCR output appears noisy/non-language' };
  return { isValid: true, reason: null };
}

export async function extractTextFromImage(file: File): Promise<OcrExtractionResult> {
  const validation = validateImageFile(file);
  if (validation) throw new Error(validation);

  console.debug('[ledger-import:image] selected file', { name: file.name, type: file.type, size: file.size });

  if (!window.Tesseract?.recognize) {
    return {
      text: '',
      ranOcr: false,
      engine: 'none',
      warning: 'Arabic OCR engine unavailable in this build. Please paste/correct extracted text manually.',
    };
  }

  const result = await window.Tesseract.recognize(file, 'ara+eng');
  const text = (result.data?.text || '').trim();
  const quality = assessOcrTextQuality(text);

  console.debug('[ledger-import:image] OCR ran', {
    ranOcr: true,
    engine: 'window.Tesseract',
    textLength: text.length,
    quality: quality.reason || 'ok',
  });

  return {
    text,
    ranOcr: true,
    engine: 'window.Tesseract',
    warning: quality.isValid ? null : (quality.reason || 'OCR output quality is low'),
  };
}

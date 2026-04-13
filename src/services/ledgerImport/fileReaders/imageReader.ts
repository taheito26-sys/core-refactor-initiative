const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const DEFAULT_OCR_ENDPOINT = '/api/ocr/extract';

export interface OcrExtractionResult {
  text: string;
  ranOcr: boolean;
  engine: string;
  warning: string | null;
  metadata?: Record<string, unknown>;
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

function getOcrEndpoint(): string {
  return import.meta.env.VITE_OCR_SERVICE_URL || DEFAULT_OCR_ENDPOINT;
}

export async function extractTextFromImage(file: File): Promise<OcrExtractionResult> {
  const validation = validateImageFile(file);
  if (validation) throw new Error(validation);

  const endpoint = getOcrEndpoint();
  const formData = new FormData();
  formData.append('image', file);

  console.debug('[ledger-import:image] selected file', { name: file.name, type: file.type, size: file.size });
  console.debug('[ledger-import:image] OCR endpoint', endpoint);

  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`OCR backend request failed (${response.status})`);
  }

  const payload = await response.json() as {
    text?: string;
    engine?: string;
    metadata?: Record<string, unknown>;
  };

  const text = (payload.text || '').trim();
  const quality = assessOcrTextQuality(text);

  console.debug('[ledger-import:image] OCR ran', {
    ranOcr: true,
    engine: payload.engine || 'easyocr',
    textLength: text.length,
    quality: quality.reason || 'ok',
  });

  return {
    text,
    ranOcr: true,
    engine: payload.engine || 'easyocr',
    warning: quality.isValid ? null : (quality.reason || 'OCR output quality is low'),
    metadata: payload.metadata,
  };
}

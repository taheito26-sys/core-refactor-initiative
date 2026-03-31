const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

export function validateImageFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!IMAGE_EXTENSIONS.includes(ext)) return `Unsupported image type: .${ext || 'unknown'}`;
  if (file.size > MAX_IMAGE_SIZE) return 'Image exceeds 10MB limit';
  return null;
}

function extractAscii(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  let current = '';

  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b >= 32 && b <= 126) {
      current += String.fromCharCode(b);
    } else if (current.length > 8) {
      chunks.push(current);
      current = '';
    } else {
      current = '';
    }
  }

  return chunks.join('\n').trim();
}

export async function extractTextFromImage(file: File): Promise<string> {
  const validation = validateImageFile(file);
  if (validation) throw new Error(validation);

  const buffer = await file.arrayBuffer();
  const extracted = extractAscii(buffer);
  if (!extracted) {
    throw new Error('OCR extraction failed for this image. Please try another image or paste text manually.');
  }

  return extracted;
}

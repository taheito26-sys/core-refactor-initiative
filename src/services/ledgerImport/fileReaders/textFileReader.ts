const TEXT_EXTENSIONS = ['txt', 'md', 'csv'];
const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024;

export function validateTextFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!TEXT_EXTENSIONS.includes(ext)) return `Unsupported text file type: .${ext || 'unknown'}`;
  if (file.size > MAX_IMPORT_FILE_SIZE) return 'File exceeds 5MB limit';
  return null;
}

export async function readTextFile(file: File): Promise<string> {
  const validation = validateTextFile(file);
  if (validation) throw new Error(validation);
  const buffer = await file.arrayBuffer();
  return new TextDecoder('utf-8').decode(buffer);
}

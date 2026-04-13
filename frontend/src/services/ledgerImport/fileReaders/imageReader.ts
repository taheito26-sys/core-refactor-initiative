// Stub
export type OcrExtractionResult = { text: string; confidence: number };
export function validateImageFile(_file: File): boolean { return true; }
export async function extractTextFromImage(_file: File): Promise<OcrExtractionResult> { return { text: '', confidence: 0 }; }
export function assessOcrTextQuality(_result: OcrExtractionResult): number { return 0; }

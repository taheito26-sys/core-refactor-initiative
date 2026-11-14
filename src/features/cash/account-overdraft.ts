const marker = / ?\[\[allow-negative\]\]$/;

/** The overdraft flag rides at the end of the existing notes column, so it needs no schema change. */
export function encodeOverdraftFlag(notes: string | null | undefined, allowNegative: boolean | undefined): string | null {
  if (!allowNegative) return notes ?? null;
  return `${notes || ''}${notes ? ' ' : ''}[[allow-negative]]`;
}

export function decodeOverdraftFlag(notes: string | null | undefined): { notes: string | null; allowNegative: boolean } {
  const raw = notes ?? null;
  if (!raw || !marker.test(raw)) return { notes: raw, allowNegative: false };
  return { notes: raw.replace(marker, '') || null, allowNegative: true };
}

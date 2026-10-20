// ─── Cash givers ───
// A buyer hands cash to the merchant through several people. Each payment is
// tied to one of them, either explicitly or because the payment's note
// already names them (the way notes were written before givers existed).

/** Lowercases and folds the Arabic spelling variants that differ between writers, so "حسن" matches "حَسَن". */
export function normalizeGiverText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

const tokens = (text: string) => normalizeGiverText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** True when the giver's name appears in the text as whole words ("Hassan" is not found inside "Hassanein"). */
function mentions(text: string, giver: string): boolean {
  const want = tokens(giver);
  if (want.length === 0) return false;
  const have = tokens(text);
  for (let i = 0; i + want.length <= have.length; i += 1) {
    if (want.every((w, j) => have[i + j] === w)) return true;
  }
  return false;
}

/** The giver a note names, or null. When several are named, the longest name wins ("Ali Hassan" over "Ali"). */
export function findGiverInNotes(notes: Array<string | null | undefined>, givers: string[]): string | null {
  let best: string | null = null;
  for (const giver of givers) {
    if (!notes.some(n => n && mentions(n, giver))) continue;
    if (best === null || normalizeGiverText(giver).length > normalizeGiverText(best).length) best = giver;
  }
  return best;
}

/** An explicit choice wins; otherwise whoever the notes name. */
export function resolveGiver(
  explicit: string | null | undefined,
  notes: Array<string | null | undefined>,
  givers: string[],
): string | null {
  if (explicit && explicit.trim()) return explicit.trim();
  return findGiverInNotes(notes, givers);
}

/** Payment number per giver: the giver's first payment by date is 1, the next 2, and so on. */
export function giverPaymentNumbers(rows: Array<{ key: string; date: number; giver: string | null }>): Map<string, number> {
  const result = new Map<string, number>();
  const counts = new Map<string, number>();
  const ordered = rows
    .filter((r): r is { key: string; date: number; giver: string } => !!r.giver)
    .sort((a, b) => a.date - b.date || a.key.localeCompare(b.key));
  for (const r of ordered) {
    const id = normalizeGiverText(r.giver);
    const next = (counts.get(id) ?? 0) + 1;
    counts.set(id, next);
    result.set(r.key, next);
  }
  return result;
}

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

const toWesternDigits = (text: string) => text
  .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
  .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0));

/**
 * The payment number a buyer wrote into a note next to the giver's name ("حسن دفعة رقم ١٢",
 * "دفعه حسن 36"), or null. Only a plain whole number from 1 to 999 counts, and only when the
 * note names the giver: amounts such as "20,000" or "19000" and decimals are not numbers of
 * a payment. Several different numbers across the notes are ambiguous, so none is taken.
 */
export function typedPaymentNumber(notes: Array<string | null | undefined>, giver: string | null): number | null {
  if (!giver) return null;
  const found = new Set<number>();
  for (const note of notes) {
    if (!note || !mentions(note, giver)) continue;
    for (const m of toWesternDigits(note).match(/\d+(?:[.,]\d+)*/g) ?? []) {
      if (!/^\d+$/.test(m)) continue;
      const n = Number(m);
      if (n >= 1 && n <= 999) found.add(n);
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * Payment number per giver. A number written in the payment's note is used as it is. A payment
 * without one fills the first gap the buyer left above the closest earlier numbered payment (a
 * forgotten payment slots into 17), or, when it is newer than every numbered payment, continues
 * the run (39). An old payment that has no gap to slot into gets no number, so it never takes the
 * number a newer payment should have. A giver whose notes carry no numbers is counted 1, 2, 3.
 */
export function giverPaymentNumbers(
  rows: Array<{ key: string; date: number; giver: string | null; typed?: number | null }>,
): Map<string, number> {
  const result = new Map<string, number>();
  const byGiver = new Map<string, Array<{ key: string; date: number; typed: number | null }>>();
  for (const r of rows) {
    if (!r.giver) continue;
    const id = normalizeGiverText(r.giver);
    const list = byGiver.get(id) ?? [];
    list.push({ key: r.key, date: r.date, typed: r.typed ?? null });
    byGiver.set(id, list);
  }
  for (const list of byGiver.values()) {
    list.sort((a, b) => a.date - b.date || a.key.localeCompare(b.key));
    const typedRows = list.filter(r => r.typed !== null);
    const taken = new Set(typedRows.map(r => r.typed as number));
    const maxTyped = Math.max(0, ...taken);
    const lastTypedDate = typedRows.length > 0 ? Math.max(...typedRows.map(r => r.date)) : -Infinity;
    let lastTyped = 0;
    for (const r of list) {
      if (r.typed !== null) {
        result.set(r.key, r.typed);
        lastTyped = r.typed;
        continue;
      }
      let n = lastTyped + 1;
      while (n <= maxTyped && taken.has(n)) n += 1;
      if (n > maxTyped) {
        if (r.date < lastTypedDate) continue;
        n = Math.max(0, ...taken) + 1;
      }
      taken.add(n);
      result.set(r.key, n);
    }
  }
  return result;
}

/**
 * Gives every payment its own identity. A payment's key is its currency, day and amount, so two
 * real payments of the same amount on the same day collide: the list drew them twice and numbered
 * them alike. The second and later ones get an occurrence suffix; `base` stays the shared key.
 */
export function uniquePaymentKeys<T extends { currency: string; date: number; amount: number }>(rows: T[]): Array<T & { key: string; base: string }> {
  const seen = new Map<string, number>();
  return rows.map(r => {
    const base = `${r.currency}:${r.date}:${r.amount}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...r, key: n === 1 ? base : `${base}#${n}`, base };
  });
}

/** Colours a giver's payments can take, none of them the red a waiting payment uses or the grey of a cancelled one. */
export const GIVER_COLORS = ['#16a34a', '#7c3aed', '#0ea5e9', '#f59e0b', '#db2777', '#0d9488', '#ea580c', '#4f46e5'] as const;
/** Payments with no giver. */
export const NO_GIVER_COLOR = '#2563eb';

/**
 * One colour per person, whatever their payments or orders are: it follows the giver's place in the buyer's own
 * list, so the same person keeps the same colour every time, and a person the list has not got yet falls back to
 * a colour taken from the name, which is just as steady.
 */
export function giverAccent(giver: string | null | undefined, giverNames: string[]): string {
  if (!giver) return NO_GIVER_COLOR;
  const want = normalizeGiverText(giver);
  const at = giverNames.findIndex(n => normalizeGiverText(n) === want);
  if (at >= 0) return GIVER_COLORS[at % GIVER_COLORS.length];
  let hash = 0;
  for (const ch of want) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return GIVER_COLORS[hash % GIVER_COLORS.length];
}

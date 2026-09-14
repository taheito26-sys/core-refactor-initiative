// Canonicalizes a display name for duplicate-safe matching: NFKC-normalizes,
// folds every dash-like character (hyphen, non-breaking hyphen, figure
// dash, en/em dash, minus sign) to a plain "-", strips zero-width
// characters, and collapses whitespace. Two cosmetically different
// spellings of the same name (e.g. from different raw exchange-import
// strings) resolve to the same key here even though a plain
// trim().toLowerCase() would not.
//
// Built from numeric code points (rather than embedding the literal
// invisible/lookalike characters in source) so the file stays readable
// and doesn't trip irregular-whitespace / misleading-character-class lint.
const DASH_LIKE_POINTS = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212];
const ZERO_WIDTH_POINTS = [0x200b, 0x200c, 0x200d, 0xfeff];

const DASH_LIKE = new RegExp(`[${DASH_LIKE_POINTS.map(cp => String.fromCharCode(cp)).join('')}]`, 'g');
const ZERO_WIDTH = new RegExp(`[${ZERO_WIDTH_POINTS.map(cp => String.fromCharCode(cp)).join('')}]`, 'g');

export function canonicalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(DASH_LIKE, '-')
    .replace(ZERO_WIDTH, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

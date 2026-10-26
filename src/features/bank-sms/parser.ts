// ─── Bank SMS balance parser ───
// Pure: turns one SMS into the remaining balance it reports, or null when the
// message is not a balance notice (OTPs, promotions, ordinary chat).

export interface RawSms {
  address: string;
  body: string;
  /** Epoch milliseconds the SMS was received. */
  date: number;
}

export interface ParsedBalance {
  sender: string;
  /** Last four digits of the account or card, when the SMS states one. */
  last4: string;
  currency: string;
  balance: number;
  smsTimestamp: number;
}

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_INDIC = '۰۱۲۳۴۵۶۷۸۹';

export function normalizeDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(EXTENDED_INDIC.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/[٬،]/g, ',');
}

const CURRENCY_ALIASES: Array<[RegExp, string]> = [
  [/^(qar|qr|ر\.?\s?ق|ريال(?:\s+قطري)?)$/i, 'QAR'],
  [/^(egp|le|e£|ج\.?\s?م|جنيه(?:\s+مصري)?)$/i, 'EGP'],
  [/^(usd|\$|دولار)$/i, 'USD'],
  [/^(sar|ر\.?\s?س)$/i, 'SAR'],
  [/^(aed|د\.?\s?إ)$/i, 'AED'],
  [/^(eur|€)$/i, 'EUR'],
  [/^(gbp|£)$/i, 'GBP'],
  [/^(kwd)$/i, 'KWD'],
  [/^(usdt)$/i, 'USDT'],
];

const CURRENCY_TOKEN = '(?:QAR|QR|EGP|LE|E£|USDT|USD|SAR|AED|EUR|GBP|KWD|\\$|€|£|ر\\.?\\s?ق|ج\\.?\\s?م|ر\\.?\\s?س|د\\.?\\s?إ|ريال(?:\\s+قطري)?|جنيه(?:\\s+مصري)?|دولار)';
const NUMBER = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?';

const BALANCE_KEYWORD =
  '(?:available\\s+balance|avail(?:able)?\\.?\\s*bal(?:ance)?\\.?|avl\\.?\\s*bal(?:ance)?\\.?|current\\s+balance|remaining\\s+balance|new\\s+balance|ledger\\s+balance|balance|bal|الرصيد\\s+المتاح|رصيدك\\s+المتاح|رصيدك\\s+الحالي|رصيدك|الرصيد\\s+الحالي|الرصيد\\s+المتبقي|الرصيد|رصيد)';

// keyword, optional separator, optional leading currency, number, optional trailing currency / CR / DR
const BALANCE_RE = new RegExp(
  `${BALANCE_KEYWORD}\\s*(?:is|هو|:|-|=|\\.)*\\s*(${CURRENCY_TOKEN})?\\s*(-)?\\s*(${NUMBER})\\s*(${CURRENCY_TOKEN}|CR|DR)?`,
  'i',
);

const OTP_RE = /\b(otp|one[\s-]?time|verification code|passcode)\b|رمز\s+(?:التحقق|الدخول)/i;

export function canonicalCurrency(token: string | undefined): string | null {
  if (!token) return null;
  const t = token.trim();
  for (const [re, code] of CURRENCY_ALIASES) if (re.test(t)) return code;
  return null;
}

function extractLast4(text: string): string {
  const masked = /(?:[xX*•]{2,}|ending(?:\s+(?:in|with))?|رقم|no\.?)\s*(\d{4})\b/.exec(text);
  if (masked) return masked[1];
  const labelled = /(?:a\/c|acct?|account|card|حساب|بطاقة|بطاقتك)\D{0,15}(\d{3,})\b/i.exec(text);
  return labelled ? labelled[1].slice(-4) : '';
}

/** Short stable label for a sender address, e.g. "QNB" or "+97444123456". */
export function senderLabel(address: string): string {
  return (address || '').trim().replace(/\s+/g, '');
}

export function parseBalanceSms(sms: RawSms): ParsedBalance | null {
  const body = normalizeDigits(sms.body || '');
  if (!body || OTP_RE.test(body)) return null;

  const match = BALANCE_RE.exec(body);
  if (!match) return null;

  const [, leadCur, minus, rawNumber, trailing] = match;
  const value = Number(rawNumber.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;

  const trailingCur = trailing && !/^(cr|dr)$/i.test(trailing) ? trailing : undefined;
  const currency =
    canonicalCurrency(leadCur) ??
    canonicalCurrency(trailingCur) ??
    // Fall back to any currency named elsewhere in the message.
    canonicalCurrency(new RegExp(CURRENCY_TOKEN, 'i').exec(body)?.[0]) ??
    '';
  const negative = Boolean(minus) || /^dr$/i.test(trailing || '');

  return {
    sender: senderLabel(sms.address),
    last4: extractLast4(body),
    currency,
    balance: negative ? -value : value,
    smsTimestamp: sms.date,
  };
}

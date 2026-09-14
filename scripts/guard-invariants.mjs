#!/usr/bin/env node
/**
 * Invariant guard for the two subsystems that have silently regressed in
 * production: buyer identity resolution, and the HTML-to-PDF export pipeline.
 *
 * This is deliberately NOT a style checker. Every rule below encodes a bug
 * that actually shipped, was reported by the merchant, and cost a round of
 * debugging — usually because the breakage is invisible in review (a buyer
 * quietly stops seeing their orders; a table row is quietly sliced in half)
 * and no test or type error fires. The rules pin the specific shape of each
 * fix so a later edit can't undo it without being told exactly what it is
 * about to re-break.
 *
 * Run: npm run guard:invariants   (also runs inside build:preflight)
 */
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

/**
 * Each rule: `require` patterns must all match, `forbid` patterns must not.
 * `hint` is printed on failure and should say what to do, not just what broke.
 */
const RULES = [
  {
    file: 'supabase/functions/_shared/buildLoanStatement.ts',
    subsystem: 'Buyer identity',
    incident:
      'A buyer split across duplicate customer records saw fewer orders in their portal than the merchant saw (16 vs 15), because the statement filtered on the single customer_id its statement link points at while the merchant list unions every record sharing the name.',
    require: [
      {
        pattern: /export function resolveCustomerIdGroup/,
        hint: 'resolveCustomerIdGroup must stay exported here — it is the single definition of "which customer records are really this same buyer", shared by the loan statement and the monthly/PDF statement.',
      },
      {
        pattern: /customerIdGroup\.has\(tr\.customerId\)/,
        hint: 'buildLoanStatementResponse must filter trades with customerIdGroup.has(tr.customerId), not against one id.',
      },
      {
        pattern: /customerIdGroup\.has\(trade\.customerId\)/,
        hint: 'buildMonthlyStatementResponse must filter trades with customerIdGroup.has(trade.customerId), not against one id.',
      },
    ],
    forbid: [
      {
        pattern: /\.customerId\s*!==\s*link\.customer_id/,
        hint: 'Single-id trade filtering drops orders recorded under a duplicate customer record. Use resolveCustomerIdGroup(...) and test membership with customerIdGroup.has(...).',
      },
      {
        pattern: /filter\((?:\([^)]*\)|\w+)\s*=>[^\n]*\.customerId\s*===\s*link\.customer_id/,
        hint: 'Single-id trade filtering drops orders recorded under a duplicate customer record. Use resolveCustomerIdGroup(...) and test membership with customerIdGroup.has(...).',
      },
    ],
  },
  {
    file: 'src/lib/tracker-helpers.ts',
    subsystem: 'Buyer identity',
    incident:
      'Buyer lookups that read only the legacy `name` field missed a buyer whose name had been filled in for the other language, silently creating a second customer record.',
    require: [
      {
        pattern: /export function customerNameVariants/,
        hint: 'customerNameVariants is the shared "every name this buyer is known by" helper that identity lookups depend on. Keep it exported here.',
      },
    ],
    forbid: [],
  },
  {
    file: 'src/pages/OrdersPage.tsx',
    subsystem: 'Buyer identity',
    incident:
      'ensureCustomer matched a typed buyer against the legacy `name` only. Once the buyer had an Arabic name on file, typing the English one no longer matched, so every new order started a second customer record the buyer\'s statement link did not cover.',
    require: [
      {
        pattern: /customerNameVariants\(c\)\.some\(/,
        hint: 'ensureCustomer (and the buyer autocomplete) must match against every name variant, so either language resolves to the same record.',
      },
    ],
    forbid: [
      {
        pattern: /normalizeName\(c\.name\)\s*===\s*normalizeName\(/,
        hint: 'Matching on the legacy `name` alone splits a bilingual buyer onto a new record. Use customerNameVariants(c).some(v => normalizeName(v) === target).',
      },
    ],
  },
  {
    file: 'src/pages/CRMPage.tsx',
    subsystem: 'Buyer identity',
    incident:
      'Saving a customer re-derived the legacy `name` from the merchant\'s current UI language, so filling in an Arabic name flipped the identity key and unlinked every subsequent order.',
    require: [
      {
        pattern: /const name = editingCust \? editingCust\.name/,
        hint: '`name` is the buyer identity key: an existing customer must keep theirs. Only a brand-new customer gets one assigned.',
      },
    ],
    forbid: [
      {
        pattern: /\bname\s*=\s*\(?\s*t\.lang\s*===/,
        hint: 'Deriving `name` from the active UI language repoints the buyer identity key and unlinks their future orders. Keep the stored name; put per-language spellings in nameEn/nameAr.',
      },
    ],
  },
  {
    file: 'src/lib/htmlReportToPdf.ts',
    subsystem: 'PDF export',
    incident:
      'Three separate production breakages: Chrome refused to decode a hand-concatenated SVG string (EncodingError), a blob: URL tainted the canvas so toDataURL threw (SecurityError), and fixed-height pagination sliced table rows in half across page breaks on mobile.',
    require: [
      {
        pattern: /new XMLSerializer\(\)/,
        hint: 'The SVG wrapper must be built through real DOM nodes and serialized with XMLSerializer. Hand-concatenating it produces invalid XML for real-world text and Chrome then refuses to decode the image ("EncodingError: The source image cannot be decoded").',
      },
      {
        pattern: /data:image\/svg\+xml/,
        hint: 'The SVG image must load from a data: URI. Chrome taints the canvas for an SVG-with-foreignObject loaded from a blob: URL, and the later toDataURL() throws "SecurityError: Tainted canvases may not be exported".',
      },
      {
        // Deliberately the usage, not just the token: leaving the constant
        // declared while dropping it from the height calculation is exactly
        // how this would silently regress.
        pattern: /scrollHeight\s*\+\s*RENDER_HEIGHT_PADDING_PX/,
        hint: 'The rasterized height must stay padded past measurer.scrollHeight. An SVG root clips to its own height, and mobile browsers lay foreignObject content out a few px taller than the measurer reports — without the pad, the bottom of the sheet (typically a table total row) is silently sliced off inside the image.',
      },
      {
        pattern: /computePageSlices/,
        hint: 'Page breaks must be computed by computePageSlices so a boundary never lands inside a table row. A fixed per-page pixel budget cuts whichever row straddles it in half.',
      },
      {
        pattern: /UNBREAKABLE_SELECTOR/,
        hint: 'computePageSlices needs the measured boxes of unbreakable elements (rows, cards, headings) to pull a page break back off them.',
      },
    ],
    forbid: [
      {
        pattern: /img\.src\s*=\s*URL\.createObjectURL/,
        hint: 'A blob: URL for the SVG image taints the canvas and makes toDataURL() throw. Use a data: URI.',
      },
      {
        pattern: /heightLeft\s*-=\s*usableHeight/,
        hint: 'This is the old fixed-height pagination that sliced table rows in half. Page slices come from computePageSlices, which respects unbreakable element boundaries.',
      },
    ],
  },
  {
    file: 'src/features/stock/utils/monthlyStatementExport.ts',
    subsystem: 'PDF export',
    incident:
      'The statement stylesheet is also parsed inside an SVG foreignObject during rasterization, where :root resolves to the <svg> element rather than the rendered subtree — custom properties declared on :root silently resolve to nothing and the PDF renders unstyled.',
    require: [
      {
        pattern: /\.sheet\s*\{/,
        hint: 'Statement CSS custom properties must be declared on .sheet.',
      },
    ],
    forbid: [
      {
        pattern: /:root\s*\{/,
        hint: 'Declare custom properties on .sheet, not :root — inside the foreignObject used for PDF rasterization, :root is the <svg> element and the variables never reach the sheet.',
      },
    ],
  },
];

let failures = 0;

for (const rule of RULES) {
  const abs = path.join(repoRoot, rule.file);
  if (!fs.existsSync(abs)) {
    console.error(`\n[${rule.subsystem}] ${rule.file}\n  MISSING: guarded file no longer exists.`);
    console.error(`  If it moved, update scripts/guard-invariants.mjs to point at the new path.`);
    failures++;
    continue;
  }
  const source = fs.readFileSync(abs, 'utf8');
  const broken = [];

  for (const { pattern, hint } of rule.require ?? []) {
    if (!pattern.test(source)) broken.push({ kind: 'missing required', pattern, hint });
  }
  for (const { pattern, hint } of rule.forbid ?? []) {
    if (pattern.test(source)) broken.push({ kind: 'found forbidden', pattern, hint });
  }

  if (broken.length > 0) {
    console.error(`\n[${rule.subsystem}] ${rule.file}`);
    console.error(`  Why this is guarded: ${rule.incident}`);
    for (const b of broken) {
      console.error(`\n  ${b.kind}: ${b.pattern}`);
      console.error(`    ${b.hint}`);
    }
    failures += broken.length;
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} invariant check(s) failed.\n\n` +
      `These guard behaviour that breaks silently — no type error, no failing\n` +
      `render, just a buyer who stops seeing their orders or a PDF row cut in\n` +
      `half. If you are deliberately changing one of these, update both the\n` +
      `rule in scripts/guard-invariants.mjs and the tests in\n` +
      `src/test/customer-name-identity.test.ts / src/test/pdf-pagination.test.ts\n` +
      `so the new intent is recorded rather than lost.\n`,
  );
  process.exit(1);
}

console.log(`Invariant guard passed (${RULES.length} guarded files).`);

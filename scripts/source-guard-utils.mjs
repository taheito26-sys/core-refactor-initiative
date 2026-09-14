import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

// `anchored` phrases only count as narration when they open the comment's
// prose. "the user is" is ordinary domain English mid-sentence ("Detects
// whether the user is on a mobile browser") and occurs throughout the
// codebase; it only reads as narration when it starts the thought ("The user
// is asking for..."). The rest are specific enough to match anywhere.
const BANNED_PHRASES = [
  { phrase: 'the user is', anchored: true },
  { phrase: 'i need to', anchored: false },
  { phrase: 'continue where', anchored: false },
  { phrase: 'previous response', anchored: false },
];

const MARKDOWN_PATTERNS = [
  /^\s*```/,
  /^\s*#{1,6}\s+/,
  /^\s*>\s+/,
  /^\s*[-*]\s+/,
  /^\s*\d+\.\s+/,
  /^\s*\|.+\|\s*$/,
];

// Structured documentation a block comment may legitimately contain: bullet
// and numbered lists (a set of statuses, rules or cases — the codebase does
// this in ~20 places) and tables (profit-service documents a formula per
// agreement type this way). Prose-document structure — headings, blockquotes,
// code fences — has no business in a doc comment and stays rejected there.
const DOC_STRUCTURE_PATTERNS = new Set([
  /^\s*[-*]\s+/.source,
  /^\s*\d+\.\s+/.source,
  /^\s*\|.+\|\s*$/.source,
]);

// Flags each line with whether it *starts* inside a block comment, so JSDoc
// continuation lines can be told apart from markdown bullets. Deliberately a
// line scanner, not a parser — it matches the rest of this guard's rigor, and
// a miss only costs a false positive/negative on one narration check.
function flagBlockCommentLines(lines) {
  let inBlock = false;
  return lines.map((raw) => {
    const startedInBlock = inBlock;
    for (let i = 0; i < raw.length - 1; i++) {
      const pair = raw.slice(i, i + 2);
      if (!inBlock && pair === '//') break;
      if (!inBlock && pair === '/*') { inBlock = true; i++; continue; }
      if (inBlock && pair === '*/') { inBlock = false; i++; continue; }
    }
    // Only a line whose *start* is comment text can carry leaked narration;
    // the markdown patterns are all anchored at ^, so a trailing `// note`
    // after real code could never match them anyway.
    const isComment = startedInBlock || /^\s*(\/\/|\/\*)/.test(raw);
    return { raw, startedInBlock, isComment };
  });
}

// A JSDoc continuation line (" * text") is comment decoration, not a markdown
// bullet, but `/^\s*[-*]\s+/` cannot tell them apart — which made this guard
// reject every self-documenting file in the repo (44 hits in htmlReportToPdf,
// 48 in OrdersPage) and left guard:precommit unusable. Stripping the leading
// asterisk before the markdown patterns run keeps the real intent: narration
// inside a comment (" * - a bullet", " * # Heading") still trips them.
function stripJsDocDecoration(line) {
  return line.replace(/^\s*\*[ \t]?/, '');
}

function scriptKindForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.tsx': return ts.ScriptKind.TSX;
    case '.jsx': return ts.ScriptKind.JSX;
    case '.js': return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

export function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function getSanitizationIssues(content) {
  const issues = [];
  const lines = content.split(/\r?\n/);

  flagBlockCommentLines(lines).forEach(({ raw, startedInBlock, isComment }, index) => {
    const lower = raw.toLowerCase();
    const lineNo = index + 1;

    // Narration only ever lands in a comment. Bare prose dumped into code is a
    // parse error, which getSyntaxIssues already rejects far more decisively —
    // so scoping both checks to comments loses nothing and stops ordinary code
    // reading as narration: a TypeScript generic closing `> = {` as a
    // blockquote, a CSS `* { … }` rule in a template literal as a bullet, or a
    // test name like "blocks a mobile browser as soon as the user is signed
    // in" as the banned phrase "the user is".
    if (!isComment) return;

    const prose = (startedInBlock ? stripJsDocDecoration(raw) : raw.replace(/^\s*\/\/+\s?/, ''))
      .trim()
      .toLowerCase();
    for (const { phrase, anchored } of BANNED_PHRASES) {
      const hit = anchored ? prose.startsWith(phrase) : lower.includes(phrase);
      if (hit) {
        issues.push(`line ${lineNo}: contains banned phrase "${phrase}"`);
      }
    }

    const line = startedInBlock ? stripJsDocDecoration(raw) : raw;
    for (const pattern of MARKDOWN_PATTERNS) {
      // Structured documentation inside a block comment is not narration.
      if (startedInBlock && DOC_STRUCTURE_PATTERNS.has(pattern.source)) continue;
      if (pattern.test(line)) {
        issues.push(`line ${lineNo}: contains markdown-like narrative content`);
        break;
      }
    }
  });

  return issues;
}

export function getSyntaxIssues(filePath, content) {
  const kind = scriptKindForFile(filePath);
  const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, kind);

  return source.parseDiagnostics.map((diag) => {
    const start = diag.start ?? 0;
    const { line, character } = source.getLineAndCharacterOfPosition(start);
    const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
    return `line ${line + 1}, col ${character + 1}: ${message}`;
  });
}

export function validateSourceContent(filePath, content) {
  const sanitizationIssues = getSanitizationIssues(content);
  const syntaxIssues = getSyntaxIssues(filePath, content);
  return [...sanitizationIssues, ...syntaxIssues];
}

export function validateSourceFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return validateSourceContent(filePath, content);
}

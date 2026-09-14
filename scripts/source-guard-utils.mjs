import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const BANNED_PHRASES = [
  'the user is',
  'i need to',
  'continue where',
  'previous response',
];

const MARKDOWN_PATTERNS = [
  /^\s*```/,
  /^\s*#{1,6}\s+/,
  /^\s*>\s+/,
  /^\s*[-*]\s+/,
  /^\s*\d+\.\s+/,
  /^\s*\|.+\|\s*$/,
];

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

    for (const phrase of BANNED_PHRASES) {
      if (lower.includes(phrase)) {
        issues.push(`line ${lineNo}: contains banned phrase "${phrase}"`);
      }
    }

    // Markdown narration only ever lands in a comment. Bare prose dumped into
    // code is a parse error, which getSyntaxIssues already rejects far more
    // decisively — so restricting these patterns to comments loses nothing and
    // stops ordinary code being mistaken for narration (a TS generic closing
    // `> = {` read as a blockquote, a CSS `* { … }` rule inside a template
    // literal read as a bullet).
    if (!isComment) return;
    const line = startedInBlock ? stripJsDocDecoration(raw) : raw;
    for (const pattern of MARKDOWN_PATTERNS) {
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

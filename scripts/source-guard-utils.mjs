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

  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    const lineNo = index + 1;

    for (const phrase of BANNED_PHRASES) {
      if (lower.includes(phrase)) {
        issues.push(`line ${lineNo}: contains banned phrase "${phrase}"`);
      }
    }

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

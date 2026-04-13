import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const NARRATIVE_PHRASES = [
  "The user is",
  "I need to",
  "continue where",
  "previous response",
  "I will complete",
  "Let's finish",
  "I have implemented",
  "Specifically, I have"
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(pattern) {
  const normalized = pattern.split(path.sep).join('/');
  const escaped = escapeRegex(normalized)
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

function walkFiles(startDir) {
  const results = [];
  if (!fs.existsSync(startDir)) return results;

  for (const entry of fs.readdirSync(startDir, { withFileTypes: true })) {
    const fullPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
      continue;
    }
    results.push(fullPath);
  }

  return results;
}

function expandInputPattern(inputPath) {
  if (!inputPath.includes('*')) return [inputPath];

  const normalizedInput = path.normalize(inputPath);
  const firstWildcard = normalizedInput.search(/[*]/);
  const searchRootCandidate = firstWildcard === -1
    ? normalizedInput
    : normalizedInput.slice(0, firstWildcard);
  const lastSeparator = searchRootCandidate.lastIndexOf(path.sep);
  const searchRoot = lastSeparator >= 0
    ? searchRootCandidate.slice(0, lastSeparator)
    : '.';

  const absoluteRoot = path.resolve(searchRoot || '.');
  const matcher = globToRegExp(path.resolve(normalizedInput));

  return walkFiles(absoluteRoot).filter((candidate) => matcher.test(path.resolve(candidate)));
}

function validateFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // 1. Check for narrative phrases
  for (const phrase of NARRATIVE_PHRASES) {
    if (content.includes(phrase)) {
      console.error(`Validation Error: Narrative contamination found in ${filePath}`);
      console.error(`Found phrase: "${phrase}"`);
      return false;
    }
  }

  // 2. Check for syntax errors using TS compiler (syntax-only, no type checking)
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    const syntaxErrors = sourceFile.parseDiagnostics || [];
    const realErrors = syntaxErrors.filter(d => d.category === ts.DiagnosticCategory.Error);

    if (realErrors.length > 0) {
      console.error(`Validation Error: Syntax errors found in ${filePath}`);
      realErrors.forEach(diagnostic => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        if (diagnostic.start !== undefined) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
          console.error(`${filePath} (${line + 1},${character + 1}): ${message}`);
        } else {
          console.error(`${filePath}: ${message}`);
        }
      });
      return false;
    }
  }

  return true;
}

const filesToValidate = process.argv
  .slice(2)
  .flatMap((input) => expandInputPattern(input));
let allValid = true;

for (const file of filesToValidate) {
  if (!validateFile(file)) {
    allValid = false;
  }
}

if (!allValid) {
  process.exit(1);
}

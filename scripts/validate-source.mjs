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

  // 2. Check for syntax errors using TS compiler
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    const program = ts.createProgram([filePath], {
      noEmit: true,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
    });

    const diagnostics = ts.getPreEmitDiagnostics(program);
    const syntaxErrors = diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);

    if (syntaxErrors.length > 0) {
      console.error(`Validation Error: Syntax errors found in ${filePath}`);
      syntaxErrors.forEach(diagnostic => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        if (diagnostic.file && diagnostic.start !== undefined) {
          const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
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

const filesToValidate = process.argv.slice(2);
let allValid = true;

for (const file of filesToValidate) {
  if (!validateFile(file)) {
    allValid = false;
  }
}

if (!allValid) {
  process.exit(1);
}
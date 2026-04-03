#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isSourceFile, validateSourceFile } from './source-guard-utils.mjs';

const args = process.argv.slice(2);

function collectFilesFromPatch(patchFile) {
  const patchContent = fs.readFileSync(patchFile, 'utf8');
  const files = new Set();
  const regex = /^\+\+\+\s+(?:b\/)?(.+)$/gm;

  for (const match of patchContent.matchAll(regex)) {
    const candidate = match[1].trim();
    if (!candidate || candidate === '/dev/null') continue;
    if (isSourceFile(candidate)) files.add(candidate);
  }

  return [...files];
}

let files = [];
const patchFlagIndex = args.indexOf('--patch');
const patchPath = patchFlagIndex >= 0 ? args[patchFlagIndex + 1] : undefined;
if (patchPath) {
  files = collectFilesFromPatch(patchPath);
}

const explicitFiles = args.filter((arg, index) => {
  if (arg.startsWith('--')) return false;
  if (patchFlagIndex >= 0 && (index === patchFlagIndex || index === patchFlagIndex + 1)) return false;
  return true;
});
files.push(...explicitFiles.filter(isSourceFile));
files = [...new Set(files)].filter((filePath) => fs.existsSync(filePath));

if (files.length === 0) {
  console.log('No source files to validate.');
  process.exit(0);
}

let hasErrors = false;
for (const file of files) {
  const issues = validateSourceFile(path.resolve(file));
  if (issues.length > 0) {
    hasErrors = true;
    console.error(`\n❌ ${file}`);
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
  }
}

if (hasErrors) {
  console.error('\nAborting: source patch validation failed.');
  process.exit(1);
}

console.log(`Validated ${files.length} source file(s) successfully.`);

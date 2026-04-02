#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isSourceFile, validateSourceContent } from './source-guard-utils.mjs';

const [targetFile] = process.argv.slice(2);

if (!targetFile) {
  console.error('Usage: node scripts/safe-source-write.mjs <target-file>');
  process.exit(1);
}

const absolutePath = path.resolve(targetFile);
const content = fs.readFileSync(0, 'utf8');

if (isSourceFile(absolutePath)) {
  const issues = validateSourceContent(absolutePath, content);
  if (issues.length > 0) {
    console.error(`Refusing write to ${targetFile}:`);
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
    process.exit(1);
  }
}

fs.writeFileSync(absolutePath, content, 'utf8');
console.log(`Wrote ${targetFile} safely.`);

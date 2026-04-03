#!/usr/bin/env node
import { execSync } from 'node:child_process';
import path from 'node:path';
import { isSourceFile, validateSourceContent } from './source-guard-utils.mjs';

const CRITICAL_PREFIXES = [
  'src/pages/OrdersPage.tsx',
  'src/pages/MerchantsPage.tsx',
  'src/components/',
];

function getStagedFiles() {
  const output = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' }).trim();
  if (!output) return [];
  return output.split(/\r?\n/).filter(Boolean);
}

function readStagedFile(filePath) {
  return execSync(`git show :${filePath}`, { encoding: 'utf8' });
}

function isCritical(filePath) {
  return CRITICAL_PREFIXES.some((prefix) => filePath === prefix || filePath.startsWith(prefix));
}

function run(command) {
  console.log(`\n▶ ${command}`);
  execSync(command, { stdio: 'inherit' });
}

const stagedFiles = getStagedFiles();
const stagedSourceFiles = stagedFiles.filter(isSourceFile);

let hasErrors = false;
for (const file of stagedSourceFiles) {
  const stagedContent = readStagedFile(file);
  const issues = validateSourceContent(path.resolve(file), stagedContent);
  if (issues.length > 0) {
    hasErrors = true;
    console.error(`\n❌ ${file}`);
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
  }
}

if (hasErrors) {
  console.error('\nCommit blocked: source guard failed.');
  process.exit(1);
}

const criticalTouched = stagedFiles.some(isCritical);
if (criticalTouched) {
  run('npm run typecheck');
  run('npm run build:dry-run');
}

console.log('\n✅ Pre-commit source guard passed.');

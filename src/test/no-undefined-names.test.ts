// Guard: a page that uses a name it never declared compiles to a valid bundle and only fails when it renders
// ("routerLocation is not defined" took down the whole Stock page). The repo's own `typecheck` script checks nothing
// (its tsconfig has `"files": []`), so this test runs the real app config and fails on any undeclared identifier.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import ts from 'typescript';

/** Known, older undeclared names that are not part of any current change. Remove an entry when it is fixed. */
const KNOWN = [/'setStockTab'/];

describe('source has no undeclared names', () => {
  it('finds no "Cannot find name" in the app', () => {
    const root = path.resolve(__dirname, '../..');
    const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.app.json');
    expect(configPath).toBeTruthy();
    const raw = ts.readConfigFile(configPath as string, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, root);
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
    // Application source only: tests mock freely, and checking every file is what makes this slow.
    const sourceFiles = program.getSourceFiles().filter(f => {
      const rel = path.relative(root, f.fileName);
      return rel.startsWith('src' + path.sep) && !/\.test\.tsx?$/.test(rel) && !rel.startsWith(`src${path.sep}test${path.sep}`);
    });
    const problems = sourceFiles
      .flatMap(f => program.getSemanticDiagnostics(f))
      // 2304 / 2552: "Cannot find name" (with and without a suggestion).
      .filter(d => (d.code === 2304 || d.code === 2552) && d.file)
      .map(d => {
        const { line } = d.file!.getLineAndCharacterOfPosition(d.start || 0);
        return `${path.relative(root, d.file!.fileName)}:${line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
      })
      .filter(msg => !KNOWN.some(re => re.test(msg)));
    expect(problems).toEqual([]);
  }, 120_000);
});

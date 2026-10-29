#!/usr/bin/env node
// Pre-push check: every changed engine or window test file must be listed in this branch's
// scripts/feature-batch-ci-named/<branch>.txt. Uses pr-preflight's own rule (namedListProblems), so the two cannot drift.
// Usage: node scripts/check-named-tests.mjs [--base origin/main]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatProblems, namedListPathFor, namedListProblems } from './pr-preflight.mjs';
import { checkAllTests } from './changed-test-coverage.mjs';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

export function checkNamedTests({ cwd, base = 'origin/main' }) {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  const listPath = namedListPathFor(branch);
  const listAbs = path.join(cwd, listPath);
  // Removed files cannot run, so they need no line; --diff-filter=d drops them and the old names of renames.
  const changedFiles = git(['diff', '--name-only', '--diff-filter=d', `${base}...HEAD`], cwd).split('\n').filter(Boolean);
  const problems = namedListProblems({
    changedFiles,
    listText: existsSync(listAbs) ? readFileSync(listAbs, 'utf8') : null,
    listPath,
  });
  const inventory = checkAllTests({ cwd, base });
  return { exitCode: problems.length || inventory.exitCode ? 1 : 0,
    text: `named-test list: ${listPath}\n${formatProblems(problems)}\n${inventory.text}` };
}

export function runCli(argv, cwd) {
  const i = argv.indexOf('--base');
  return checkNamedTests({ cwd, base: i === -1 ? 'origin/main' : argv[i + 1] });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runCli(process.argv.slice(2), process.cwd());
  console.log(result.text);
  process.exitCode = result.exitCode;
}

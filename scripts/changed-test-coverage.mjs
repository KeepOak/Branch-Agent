import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilityTests, harvestTests, namedTests } from './feature-batch-ci-targets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testFile = /^(engine|window|desktop)\/.+\.test\.(?:ts|tsx|mjs|mts)$/;

// The desktop job uses explicit node --test arguments, not test discovery. A token only counts
// when it belongs to an actual run line; mentions in comments or unrelated jobs do not count.
export function desktopRunTargets(workflow) {
  const targets = new Set();
  for (const line of workflow.split(/\r?\n/)) {
    const command = /^\s*(?:-\s*)?run:\s*(node\b.*\s--test\s+.*)$/.exec(line)?.[1];
    if (!command) continue;
    for (const token of command.matchAll(/(?:^|\s)((?:desktop\/)?scripts\/[^\s]+\.test\.(?:ts|tsx|mjs|mts))(?=\s|$)/g)) {
      targets.add(token[1].startsWith('desktop/') ? token[1] : `desktop/${token[1]}`);
    }
  }
  return targets;
}

export function changedTestPaths(nameStatus) {
  return nameStatus.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [status, ...paths] = line.split('\t');
    if (!/^[AM]/.test(status)) return []; // deleted files cannot run
    const file = paths.at(-1);
    return testFile.test(file) ? [file] : [];
  });
}

export function uncoveredTests(changed, covered) {
  return [...new Set(changed)].filter((file) => ![...covered].some((target) =>
    target === file || (target.includes('*') && path.matchesGlob(file, target)))).sort();
}

export function coverageTargets(desktopWorkflow) {
  const covered = desktopRunTargets(desktopWorkflow);
  for (const lane of ['engine', 'window']) {
    for (const file of [...namedTests(lane), ...harvestTests(lane)]) covered.add(`${lane}/${file}`);
  }
  for (const file of capabilityTests()) covered.add(`engine/${file}`);
  return covered;
}

export function additionFor(file) {
  const [lane, ...parts] = file.split('/');
  if (lane === 'desktop') {
    return `run: node --test ${parts.join('/')}` + '  (.github/workflows/desktop-checks.yml, a new step after the desktop build)';
  }
  if (/\.test\.tsx?$/.test(file)) {
    return `${lane}:${parts.join('/')}` + '  (scripts/feature-batch-ci-named/<branch-name>.txt)';
  }
  return `run: node --test ${file}` + '  (a PR workflow with the lane dependencies installed)';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.env.CHANGED_TEST_BASE || 'HEAD^1';
  const status = execFileSync('git', ['diff', '--name-status', '--no-renames', base, 'HEAD'],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  const changed = changedTestPaths(status);
  const workflow = readFileSync(path.join(root, '.github/workflows/desktop-checks.yml'), 'utf8');
  const uncovered = uncoveredTests(changed, coverageTargets(workflow));
  if (uncovered.length) {
    for (const file of uncovered) console.error(`Uncovered changed test: ${file}\n  Add: ${additionFor(file)}`);
    process.exitCode = 1;
  } else {
    console.log(`Changed test coverage: ${changed.length} added/modified test file(s) covered.`);
  }
}

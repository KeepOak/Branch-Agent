import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

test('runs the same targeted strict check CI runs', async () => {
  const local = await readFile(new URL('./strict-typecheck.mjs', import.meta.url), 'utf8');
  const ci = await readFile(new URL('./feature-batch-ci.mjs', import.meta.url), 'utf8');
  assert.match(local, /runTargetedStrictChecks\(scratch, runCheck\)/);
  assert.match(ci, /await runTargetedStrictChecks\(scratch\)/, 'CI no longer runs runTargetedStrictChecks; update the local copy');
});

test('AGENTS.md node commands exist in their documented working directories', async () => {
  const root = new URL('../', import.meta.url);
  const agents = await readFile(new URL('AGENTS.md', root), 'utf8');
  const failures = [];
  for (const [index, line] of agents.split(/\r?\n/).entries()) {
    // Angle-bracket placeholders are templates, not concrete script paths.
    for (const command of line.matchAll(/\bnode\s+(?:--test\s+)?([^\s`]+\.mjs)\b/g)) {
      const script = command[1];
      if (/[<>]/.test(script)) continue;
      const preceding = line.slice(0, command.index);
      const directories = [...preceding.matchAll(/\bcd\s+([^\s`]+)\s+&&/g)];
      const directory = directories.at(-1)?.[1] ?? '.';
      const location = `AGENTS.md:${index + 1}: ${command[0]}`;
      if (script.startsWith('scripts/') && directories.length === 0) {
        if (!line.includes('repo root')) failures.push(`${location} must specify repo root`);
      }
      try {
        await access(new URL(`${directory}/${script}`, root));
      } catch {
        failures.push(`${location} does not exist from ${directory}`);
      }
    }
  }
  assert.deepEqual(failures, [], 'documented node commands must name their working directory and exist');
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { availableMemoryBytes } from '../engine/scripts/lib/available-memory.mjs';

test('available memory includes reclaimable macOS pages instead of only unused pages', () => {
  assert.equal(availableMemoryBytes({
    platform: 'darwin', freemem: 0,
    vmStat: 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 2.\nPages inactive: 400000.\nPages purgeable: 10000.\n',
  }), 410002 * 16384);
});

test('available memory uses Linux MemAvailable and preserves the Windows counter', () => {
  assert.equal(availableMemoryBytes({ platform: 'linux', freemem: 0,
    meminfo: 'MemFree: 0 kB\nMemAvailable: 7000000 kB\n' }), 7000000 * 1024);
  assert.equal(availableMemoryBytes({ platform: 'win32', freemem: 1234 }), 1234);
  assert.equal(availableMemoryBytes({ platform: 'darwin', vmStat: 'unavailable', freemem: 5678 }), 5678);
});

test('native tooling loads host admission without a source-loader preload', () => {
  const entrypoint = new URL('../engine/scripts/lib/host-heavy-step.mts', import.meta.url);
  const facade = new URL('../engine/scripts/lib/dist-artifact-ownership.mts', import.meta.url);
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval',
    `const admission = await import(${JSON.stringify(entrypoint.href)});\n` +
    `const facade = await import(${JSON.stringify(facade.href)});\n` +
    `if (typeof facade.withDistArtifactOwnership !== 'function') throw new Error('Missing artifact facade');\n` +
    `const os = await import('node:os');\n` +
    `if (admission.resolveHeavyStepMemoryNeed('test', {}) !== Math.min(6144 * 1024 ** 2, Math.floor(os.totalmem() / 4))) throw new Error('Wrong test memory default');`], {
    env: { ...process.env, NODE_OPTIONS: '' },
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'native admission bootstrap failed');
});

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

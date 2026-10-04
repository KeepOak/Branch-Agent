import path from 'node:path';
import fs from 'node:fs/promises';
import { engineRoot, run } from './feature-batch-ci-runtime.mjs';
import { engineStrictFiles } from './feature-batch-ci-targets.mjs';

// Throwaway probe: measure engine strict tsgo peak RSS and wall per checker setting on hosted runners.
export async function runTargetedStrictChecks(scratch) {
  const engineConfig = path.join(scratch, 'engine-owned-strict.json');
  await fs.writeFile(engineConfig, JSON.stringify({
    extends: path.join(engineRoot, 'tsconfig.json'),
    compilerOptions: { declaration: false, noEmit: true,
      typeRoots: [path.join(engineRoot, 'node_modules/@types')], rootDir: engineRoot },
    files: engineStrictFiles.map(file => path.join(engineRoot, file)), include: [], exclude: [],
  }, null, 2) + '\n');
  const tsc = path.join(engineRoot, 'node_modules/typescript/bin/tsc');
  const time = process.platform === 'darwin' ? ['-l'] : ['-v'];
  const swap = process.platform === 'darwin' ? ['sysctl', ['vm.swapusage', 'hw.memsize', 'hw.ncpu']] : ['free', ['-m']];
  const probes = [
    ['checkers-1-nodiag', ['--checkers', '1'], {}],
    ['checkers-2-nodiag', ['--checkers', '2'], {}],
    ['checkers-1-diag', ['--checkers', '1', '--extendedDiagnostics'], {}],
    ['default-nodiag', [], {}],
  ];
  for (const [name, flags, extra] of probes) {
    console.log(`::group::probe ${name}`);
    await run(swap[0], swap[1]);
    const started = Date.now();
    await run('/usr/bin/time', [...time, process.execPath, tsc, '--project', engineConfig, ...flags],
      engineRoot, { ...process.env, ...extra });
    console.log(`PROBE ${name} wall=${((Date.now() - started) / 1000).toFixed(1)}s`);
    await run(swap[0], swap[1]);
    console.log('::endgroup::');
  }
  throw new Error('probe complete');
}

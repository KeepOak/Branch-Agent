import path from 'node:path';
import fs from 'node:fs/promises';
import { engineRoot, run, windowRoot } from './feature-batch-ci-runtime.mjs';
import { engineStrictFiles, windowStrictFiles } from './feature-batch-ci-targets.mjs';

// Preserve engine project strict options while bounding roots to owned sources and authored ambient declarations.
export async function runTargetedStrictChecks(scratch, runCheck = run) {
  const engineConfig = path.join(scratch, 'engine-owned-strict.json');
  await fs.writeFile(engineConfig, JSON.stringify({
    extends: path.join(engineRoot, 'tsconfig.json'),
    compilerOptions: { declaration: false, noEmit: true,
      typeRoots: [path.join(engineRoot, 'node_modules/@types')], rootDir: engineRoot },
    files: engineStrictFiles.map(file => path.join(engineRoot, file)), include: [], exclude: [],
  }, null, 2) + '\n');
  await runCheck(process.execPath, [path.join(engineRoot, 'node_modules/typescript/bin/tsc'),
    '--project', engineConfig, '--extendedDiagnostics'], engineRoot);
  const common = ['--noEmit', '--strict', '--skipLibCheck', '--target', 'es2023', '--esModuleInterop'];
  await runCheck(process.execPath, [path.join(windowRoot, 'node_modules/typescript/bin/tsc'),
    '--ignoreConfig', ...common, '--module', 'esnext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx',
    '--allowImportingTsExtensions', '--allowSyntheticDefaultImports', '--types', 'vite/client',
    '--lib', 'ES2023,DOM',
    ...windowStrictFiles], windowRoot);
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { harvestMatrix, harvestTests, shardOf, shardTests, touchedHarvestTests } from './feature-batch-ci-targets.mjs';
import { preparePnpm, publishWindowDependencies, run, scratchRoot, toolingRoot, verifiedExceptionFlags, windowRoot } from './feature-batch-ci-runtime.mjs';

const root = path.resolve(import.meta.dirname, '..');
const mode = process.argv[2];
const changed = mode === 'pr' || (mode === 'run' && process.env.HARVEST_SCOPE === 'pr')
  ? execFileSync('git', ['diff', '--name-only', process.env.HARVEST_BASE, 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter(Boolean)
  : undefined;

if (mode === 'install') {
  const scratch = await scratchRoot();
  const pnpm = await preparePnpm(scratch);
  await run(pnpm, ['install', '--frozen-lockfile', '--ignore-scripts', ...await verifiedExceptionFlags('engine')], path.join(root, 'engine'));
  if (process.env.HARVEST_LANE === 'window') {
    await run(pnpm, ['install', '--frozen-lockfile', '--ignore-scripts', ...await verifiedExceptionFlags('window'),
      `--modules-dir=${path.join(windowRoot, 'node_modules')}`,
      `--virtual-store-dir=${path.join(windowRoot, 'node_modules/.pnpm')}`], toolingRoot);
    await publishWindowDependencies();
  }
} else if (mode === 'prepare') {
  const engineRoot = path.join(root, 'engine');
  await run(process.execPath, ['--import', './scripts/tsx.mjs', '--input-type=module', '--eval',
    'const { withDistArtifactOwnership } = await import("./scripts/lib/dist-artifact-ownership.mts");\n' +
    'const { ensureKyselyTypes } = await import("./scripts/generate-kysely-types.mts");\n' +
    'await withDistArtifactOwnership(process.cwd(), () => ensureKyselyTypes(process.cwd()));'], engineRoot);
  for (const name of ['gateway-protocol', 'gateway-client']) {
    await run(process.execPath, ['--import', './scripts/tsx.mjs', 'scripts/build-workspace-package.mts', name], engineRoot);
  }
} else if (mode === 'pr' || mode === 'nightly') {
  console.log(JSON.stringify({ include: harvestMatrix(changed) }));
} else if (mode === 'run') {
  const lane = process.env.HARVEST_LANE;
  if (!['engine', 'window'].includes(lane)) throw new Error('HARVEST_LANE must be engine or window');
  const files = changed ? touchedHarvestTests(lane, changed) : harvestTests(lane);
  const selected = shardTests(files, shardOf(process.env.HARVEST_SHARD));
  const laneRoot = path.join(root, lane);
  const results = path.join(process.env.RUNNER_TEMP ?? root, `harvest-${lane}-${process.env.HARVEST_SHARD?.replace('/', '-')}.json`);
  const config = path.join(root, 'scripts', `feature-batch-ci-harvest-${lane}.config.mjs`);
  const vitest = path.join(laneRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const output = path.join(process.env.RUNNER_TEMP ?? root, `harvest-result-${process.pid}.json`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vitest, 'run', '--config', config, '--reporter=default', '--reporter=json', `--outputFile.json=${output}`, ...selected],
      { cwd: laneRoot, env: { ...process.env, CI: '1' }, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (exitCode) => resolve(exitCode ?? 1));
  });
  let failures = [];
  if (code) {
    const report = JSON.parse(await fs.readFile(output, 'utf8').catch(() => 'null'));
    const failed = report?.testResults?.filter(result => result.status === 'failed') ?? [];
    // Name each failing test and its first error lines in the job log; the JSON report alone hides them.
    for (const result of failed) {
      for (const test of result.assertionResults?.filter(entry => entry.status === 'failed') ?? []) {
        console.log(`::error title=Harvest test failed::${path.relative(laneRoot, result.name)} > ${test.fullName}`);
        console.log((test.failureMessages ?? []).join('\n').split('\n').slice(0, 8).join('\n'));
      }
    }
    failures = failed.length
      ? failed.map(result => `${lane}:${(path.isAbsolute(result.name) ? path.relative(laneRoot, result.name) : result.name).replaceAll('\\', '/')}`)
      : selected.map(file => `${lane}:${file}`);
  }
  await fs.rm(output, { force: true });
  await fs.writeFile(results, JSON.stringify({ selected: selected.map(file => `${lane}:${file}`), failures }) + '\n');
  console.log(`HARVEST_RESULTS=${results}`);
  process.exitCode = code;
} else {
  throw new Error('Usage: node scripts/feature-batch-ci-harvest.mjs install|prepare|pr|nightly|run');
}

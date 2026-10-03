import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ambientRoots, slices, validateInventory } from './feature-slice-ci-targets.mjs';
import { assertLocalModules, engineRoot, gitHead, preparePnpm, repoRoot, verifiedExceptionFlags } from './feature-batch-ci-runtime.mjs';

const nodeHeap = '--max-old-space-size=1024';
const baseEnv = { ...process.env, NODE_OPTIONS: nodeHeap, TSX_DISABLE_CACHE: '1',
  TSX_TSCONFIG_PATH: path.join(engineRoot, 'tsconfig.json'), GOMEMLIMIT: '2GiB', GOMAXPROCS: '2',
  // The compiler owner joins its process group before the outer command's 180s deadline.
  BRANCH_TSGO_TIMEOUT_MS: '120000' };
const present = async file => fs.access(path.join(engineRoot, file)).then(() => true, error => {
  if (error.code !== 'ENOENT') throw error;
  return false;
});

// An absent branch is explicit coverage debt. A partial slice is a broken registration and fails.
export async function inventory(exists = present) {
  validateInventory();
  const result = [];
  for (const slice of slices) {
    const files = [...new Set([slice.anchor, ...slice.native, ...slice.vitest, ...slice.strict])];
    const found = await Promise.all(files.map(exists));
    // Some inherited strict/test files exist on the base. Native/new primary files identify the slice.
    const primary = slice.markers ?? (slice.native.length ? slice.native : [slice.anchor]);
    const primaryFound = await Promise.all(primary.map(exists));
    const active = primaryFound.some(Boolean);
    const missing = files.filter((_, index) => !found[index]);
    const followupCoverage = [];
    const extraVitest = [], extraStrict = [];
    for (const followup of slice.followups ?? []) {
      const files = [...new Set([...followup.vitest, ...followup.strict])];
      const found = await Promise.all(files.map(exists));
      const state = found.every(Boolean) ? 'ready' : found.some(Boolean) ? 'incomplete' : 'absent';
      followupCoverage.push({ pr: followup.pr, state, files });
      if (state === 'ready') { extraVitest.push(...followup.vitest); extraStrict.push(...followup.strict); }
      if (state === 'incomplete') missing.push(...files.filter((_, index) => !found[index]));
    }
    result.push({ ...slice, vitest: [...slice.vitest, ...extraVitest], strict: [...slice.strict, ...extraStrict],
      followupCoverage, state: !active ? 'absent' : missing.length ? 'incomplete' : 'ready', missing });
  }
  return result;
}

function execute(command, args, cwd, env, scratch, receipt, label, timeoutMs = 180_000) {
  const step = { label, command, args, cwd: path.relative(repoRoot, cwd), startedAt: new Date().toISOString() };
  receipt.steps.push(step);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { chunks.push(bytes); process.stdout.write(bytes); });
    const timer = setTimeout(() => {
      step.timedOut = true;
      if (process.platform === 'win32') {
        spawn(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/taskkill.exe'),
          ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).once('error', () => child.kill('SIGKILL'));
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', async (code, signal) => {
      clearTimeout(timer);
      step.code = code; step.signal = signal; step.finishedAt = new Date().toISOString();
      step.log = `${receipt.steps.indexOf(step) + 1}-${label}.log`;
      try { await fs.writeFile(path.join(scratch, step.log), Buffer.concat(chunks)); }
      catch (error) { reject(error); return; }
      code === 0 ? resolve() : reject(new Error(`${label} failed (${code ?? signal})`));
    });
  });
}

async function hashes(selected) {
  const files = [...new Set(['engine/package.json', 'engine/pnpm-lock.yaml', 'engine/pnpm-workspace.yaml',
    'engine/tsconfig.json', 'engine/tsconfig.core.json', 'scripts/feature-slice-ci.mjs',
    'scripts/feature-slice-ci-targets.mjs', '.github/workflows/feature-slice-checks.yml',
    ...ambientRoots.map(file => `engine/${file}`),
    ...selected.flatMap(slice => [slice.anchor, ...slice.native, ...slice.vitest, ...slice.strict].map(file => `engine/${file}`))])];
  return Object.fromEntries(await Promise.all(files.map(async file => [file,
    crypto.createHash('sha256').update(await fs.readFile(path.join(repoRoot, file))).digest('hex')])));
}

async function strictChecks(selected, scratch, receipt, env) {
  for (const profile of ['core', 'project']) {
    const roots = [...new Set(selected.filter(slice => slice.profile === profile).flatMap(slice => slice.strict))];
    if (!roots.length) continue;
    const config = path.join(scratch, `strict-${profile}.json`);
    await fs.writeFile(config, JSON.stringify({ extends: path.join(engineRoot, profile === 'core' ? 'tsconfig.core.json' : 'tsconfig.json'),
      compilerOptions: { noEmit: true, declaration: false, incremental: false, rootDir: engineRoot,
        typeRoots: [path.join(engineRoot, 'node_modules/@types')] },
      files: [...roots, ...ambientRoots].map(file => path.join(engineRoot, file)), include: [], exclude: [],
    }, null, 2) + '\n');
    await execute(process.execPath, [nodeHeap, path.join(engineRoot, 'scripts/run-tsgo.mjs'),
      '--project', config, '--extendedDiagnostics'], engineRoot, env, scratch, receipt, `strict-${profile}`);
  }
}

async function vitestConfig(selected, scratch, env, receipt) {
  let setup = '';
  if (selected.some(slice => slice.worker)) {
    // Bundle the real sealed worker entrypoint with checkout-local canonical dependencies.
    const worker = path.join(scratch, 'file-tool-planning.worker.mjs');
    const buildScript = path.join(scratch, 'build-worker.mjs');
    await fs.writeFile(buildScript, `import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(${JSON.stringify(path.join(engineRoot, 'package.json'))});
const engine = ${JSON.stringify(engineRoot)};
const { paths } = JSON.parse(fs.readFileSync(path.join(engine, 'tsconfig.json'), 'utf8')).compilerOptions;
await require('esbuild').build({ entryPoints: [${JSON.stringify(path.join(engineRoot, 'src/agents/sessions/tools/file-tool-planning.worker.ts'))}],
outfile: ${JSON.stringify(worker)}, bundle: true, platform: 'node', format: 'esm', target: 'node24',
tsconfig: ${JSON.stringify(path.join(engineRoot, 'tsconfig.json'))},
plugins: [{ name: 'actual-checkout-source', setup(build) { build.onResolve({ filter: /^[^./]/ }, args => {
if (args.path.startsWith('node:')) return;
for (const [key, targets] of Object.entries(paths)) {
if (key === args.path || (key.endsWith('*') && args.path.startsWith(key.slice(0, -1)))) {
const suffix = key.endsWith('*') ? args.path.slice(key.length - 1) : '';
const candidate = path.resolve(engine, targets[0].replace('*', suffix));
if (fs.existsSync(candidate)) return { path: candidate };
if (fs.existsSync(candidate + '.ts')) return { path: candidate + '.ts' };
} }
return { path: require.resolve(args.path), external: true };
}); } }] });\n`);
    await execute(process.execPath, [nodeHeap, buildScript], engineRoot, env, scratch, receipt, 'build-real-worker');
    // External package imports resolve from engine, so keep the generated bundle in an owned artifact directory.
    const artifactDir = path.join(engineRoot, '.artifacts', path.basename(scratch));
    await fs.mkdir(artifactDir, { recursive: true });
    const localWorker = path.join(artifactDir, 'file-tool-planning.worker.mjs');
    await fs.copyFile(worker, localWorker);
    const setupFile = path.join(scratch, 'sealed-worker-setup.mjs');
    await fs.writeFile(setupFile, `import { registerSealedRuntimeProcessEntrypoint } from ${JSON.stringify(pathToFileURL(path.join(engineRoot, 'src/infra/runtime-process-url.ts')).href)};
registerSealedRuntimeProcessEntrypoint('fileToolPlanning', new URL(${JSON.stringify(pathToFileURL(localWorker).href)}));\n`);
    setup = `, ${JSON.stringify(setupFile)}`;
  }
  const files = selected.flatMap(slice => slice.vitest);
  const config = path.join(scratch, 'vitest.config.mjs');
  await fs.writeFile(config, `import { sharedVitestConfig } from ${JSON.stringify(pathToFileURL(path.join(engineRoot, 'test/vitest/vitest.shared.config.ts')).href)};
export default { ...sharedVitestConfig, root: ${JSON.stringify(engineRoot)},
test: { ...sharedVitestConfig.test, include: ${JSON.stringify(files)}, projects: undefined,
setupFiles: [...sharedVitestConfig.test.setupFiles${setup}], pool: 'forks', maxWorkers: 1,
fileParallelism: false, isolate: true, passWithNoTests: false,
execArgv: [...sharedVitestConfig.test.execArgv, '${nodeHeap}'] } };\n`);
  return config;
}

async function all() {
  const scope = await inventory();
  const selected = scope.filter(slice => slice.state === 'ready');
  const base = process.env.RUNNER_TEMP ?? process.env.BRANCH_FEATURE_SLICE_TEMP;
  assert(base, 'RUNNER_TEMP or explicit BRANCH_FEATURE_SLICE_TEMP is required');
  await fs.mkdir(base, { recursive: true });
  const scratch = await fs.mkdtemp(path.join(base, 'branch-feature-slice-'));
  const receipt = { head: await gitHead(), platform: process.platform, node: process.version, scope,
    nativeFiles: selected.flatMap(slice => slice.native), vitestFiles: selected.flatMap(slice => slice.vitest),
    steps: [], status: selected.length ? 'started' : 'inventory-only', coverageClaim: 'Named offline source tests only; no installed or complete feature acceptance.' };
  const before = await hashes(selected);
  const env = { ...baseEnv, BRANCH_TEST_ARTIFACT_DIR: path.join(scratch, 'fixtures'),
    BRANCH_HOME: path.join(scratch, 'home'), BRANCH_STATE_DIR: path.join(scratch, 'state'),
    BRANCH_CONFIG_PATH: path.join(scratch, 'config.json'), BRANCH_TEST_FAST: '1' };
  console.log(`Feature slices: ${selected.length} ready, ${scope.length - selected.length} absent. ${receipt.nativeFiles.length} native, ${receipt.vitestFiles.length} Vitest files.`);
  console.log(`Receipt directory: ${scratch}`);
  try {
    assert(!scope.some(slice => slice.state === 'incomplete'),
      `Incomplete feature slices: ${JSON.stringify(scope.filter(slice => slice.state === 'incomplete').map(slice => ({ id: slice.id, missing: slice.missing })))}`);
    if (selected.length) {
      const pnpm = await preparePnpm(scratch);
      const exceptions = await verifiedExceptionFlags('engine');
      await execute(pnpm, ['install', '--frozen-lockfile', '--ignore-scripts', ...exceptions,
        `--store-dir=${path.join(scratch, 'pnpm-store')}`], engineRoot, env, scratch, receipt, 'frozen-engine-install', 480_000);
      await assertLocalModules(engineRoot, ['vitest', 'tsx', 'typescript', 'esbuild']);
      await execute(process.execPath, [nodeHeap, '--import', './scripts/tsx.mjs', '--input-type=module', '--eval',
        'const { withDistArtifactOwnership } = await import("./scripts/lib/dist-artifact-ownership.mts");\n' +
        'const { ensureKyselyTypes } = await import("./scripts/generate-kysely-types.mts");\n' +
        'await withDistArtifactOwnership(process.cwd(), () => ensureKyselyTypes(process.cwd()));'], engineRoot, env, scratch, receipt, 'canonical-kysely-types');
      await strictChecks(selected, scratch, receipt, env);
      for (const slice of selected) {
        if (slice.native.length) await execute(process.execPath, [nodeHeap, '--import', pathToFileURL(path.join(engineRoot, 'scripts/tsx.mjs')).href,
          '--test', '--test-concurrency=1', '--test-timeout=30000', ...slice.native], engineRoot, env, scratch, receipt, `native-${slice.id}`);
      }
      if (receipt.vitestFiles.length) {
        const config = await vitestConfig(selected, scratch, env, receipt);
        await execute(process.execPath, [nodeHeap, path.join(engineRoot, 'node_modules/vitest/vitest.mjs'),
          'run', '--config', config, ...receipt.vitestFiles], engineRoot, env, scratch, receipt, 'named-vitest');
      }
      receipt.status = 'passed';
    }
  } catch (error) {
    receipt.status = 'failed'; receipt.error = String(error);
    throw error;
  } finally {
    try {
      receipt.sourceHashesBefore = before; receipt.sourceHashesAfter = await hashes(selected);
      assert.deepEqual(receipt.sourceHashesAfter, before, 'CI changed source, manifests, policies or frozen locks');
      assert.equal(await gitHead(), receipt.head, 'Checked source HEAD changed');
      await execute('git', ['diff', '--exit-code', 'HEAD', '--', 'engine', 'scripts', '.github'],
        repoRoot, env, scratch, receipt, 'tracked-source-integrity');
    } catch (error) { receipt.status = 'failed'; receipt.integrityError = String(error); throw error; }
    finally {
      await fs.writeFile(path.join(scratch, 'feature-slice-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
      if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
        `Feature slice result: **${receipt.status}**. Native files: ${receipt.nativeFiles.length}. Vitest files: ${receipt.vitestFiles.length}.\n\n` +
        scope.map(slice => `- ${slice.id}: ${slice.state}. ` + slice.followupCoverage.map(f => `PR${f.pr}: ${f.state}. `).join('') + slice.gap).join('\n') + '\n');
    }
  }
}

async function selfTest() {
  const empty = await inventory(async () => false);
  assert(empty.every(slice => slice.state === 'absent'));
  const full = await inventory(async () => true);
  assert(full.every(slice => slice.state === 'ready'));
  const partial = await inventory(async file => file === slices[0].native[0]);
  assert.equal(partial[0].state, 'incomplete');
  const inherited = new Set(slices.flatMap(slice => slice.vitest));
  slices.find(slice => slice.id === 'cron').native.slice(2).forEach(file => inherited.add(file));
  const baseline = await inventory(async file => inherited.has(file));
  assert(baseline.every(slice => slice.state === 'absent'));
  assert(slices.find(slice => slice.id === 'continue-edits').native.includes('src/agents/sessions/tools/edit-diff.continue.test.ts'));
  console.log(JSON.stringify({ ...validateInventory(), selectionControls: 5, passed: true }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const mode = process.argv[2];
  if (mode === 'validate') { await selfTest(); console.log(JSON.stringify(await inventory(), null, 2)); }
  else if (mode === 'all') await all();
  else throw new Error('Usage: node scripts/feature-slice-ci.mjs validate|all');
}

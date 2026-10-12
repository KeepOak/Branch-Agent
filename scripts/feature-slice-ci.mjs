import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { ambientRoots, slices, windowSlices, validateInventory } from './feature-slice-ci-targets.mjs';
import { assertLocalModules, engineRoot, gitHead, preparePnpm, publishWindowDependencies, repoRoot,
  toolingRoot, verifiedExceptionFlags, windowRoot } from './feature-batch-ci-runtime.mjs';

const nodeHeap = '--max-old-space-size=1024';
const baseEnv = { ...process.env, NODE_OPTIONS: nodeHeap, TSX_DISABLE_CACHE: '1',
  TSX_TSCONFIG_PATH: path.join(engineRoot, 'tsconfig.json'), GOMEMLIMIT: '2GiB', GOMAXPROCS: '2',
  // Cold hosted Mac source graphs can exceed 150s; the owner still joins before the outer 330s deadline.
  BRANCH_TSGO_TIMEOUT_MS: '300000' };
const present = async file => fs.access(path.join(engineRoot, file)).then(() => true, error => {
  if (error.code !== 'ENOENT') throw error;
  return false;
});
const sourceHash = async file => crypto.createHash('sha256').update(await fs.readFile(path.join(engineRoot, file))).digest('hex');
const launcherFile = path.join(engineRoot, 'branch.mjs');

function shardSelection(raw = process.env.FEATURE_SLICE_SHARD) {
  if (!raw) return { index: 0, total: 1 };
  const match = /^(\d+)\/(\d+)$/.exec(raw);
  assert(match, `Invalid FEATURE_SLICE_SHARD: ${raw}`);
  const index = Number(match[1]) - 1, total = Number(match[2]);
  assert(Number.isSafeInteger(index) && Number.isSafeInteger(total) && total > 0 && index >= 0 && index < total,
    `Invalid FEATURE_SLICE_SHARD: ${raw}`);
  return { index, total };
}

async function launcherState(file) {
  const stat = await fs.lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'The tracked launcher must remain a regular file');
  return { mode: stat.mode & 0o777, sha256: crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex') };
}

async function restoreKnownLauncherMode(file, before, installAttempted) {
  const observed = await launcherState(file);
  assert.equal(observed.sha256, before.sha256, 'Package-manager launcher bytes changed');
  let restored = false;
  if (observed.mode !== before.mode) {
    assert(process.platform !== 'win32' && installAttempted && before.mode === 0o644 && observed.mode === 0o755,
      'Unexpected tracked launcher permission change');
    await fs.chmod(file, before.mode);
    restored = true;
  }
  const after = await launcherState(file);
  assert.deepEqual(after, before, 'Tracked launcher identity must be restored before the complete Git integrity check');
  return { before, observed, after, restored };
}

// An absent branch is explicit coverage debt. A partial slice is a broken registration and fails.
export async function inventory(exists = present, digest = sourceHash, items = slices) {
  validateInventory();
  const result = [];
  for (const slice of items) {
    const productionFiles = slice.productionAnchors.map(anchor => typeof anchor === 'string' ? anchor : anchor.file);
    const files = [...new Set([slice.anchor, ...productionFiles, ...slice.native, ...slice.vitest, ...slice.strict])];
    const found = await Promise.all(files.map(exists));
    // Some inherited strict/test files exist on the base. Native/new primary files identify the slice.
    const primary = slice.markers ?? slice.native;
    const primaryFound = await Promise.all(primary.map(exists));
    const sourceActivation = await Promise.all(slice.productionAnchors.map(async anchor => {
      const file = typeof anchor === 'string' ? anchor : anchor.file;
      const found = await exists(file);
      const activates = found && (typeof anchor === 'string' || await digest(file) !== anchor.baselineSha256);
      return { file, present: found, activates };
    }));
    const active = primaryFound.some(Boolean) || sourceActivation.some(anchor => anchor.activates);
    const missing = files.filter((_, index) => !found[index]);
    const followupCoverage = [];
    const extraNative = [], extraVitest = [], extraStrict = [];
    for (const followup of slice.followups ?? []) {
      const files = [...new Set([...(followup.native ?? []), ...(followup.vitest ?? []), ...followup.strict])];
      const found = await Promise.all(files.map(exists));
      const state = found.every(Boolean) ? 'ready' : found.some(Boolean) ? 'incomplete' : 'absent';
      followupCoverage.push({ pr: followup.pr, state, files });
      if (state === 'ready') { extraNative.push(...(followup.native ?? [])); extraVitest.push(...(followup.vitest ?? [])); extraStrict.push(...followup.strict); }
      if (state === 'incomplete') missing.push(...files.filter((_, index) => !found[index]));
    }
    const registered = active || followupCoverage.some(followup => followup.state !== 'absent');
    result.push({ ...slice, native: [...slice.native, ...extraNative], vitest: [...slice.vitest, ...extraVitest], strict: [...slice.strict, ...extraStrict],
      sourceActivation, followupCoverage, state: !registered ? 'absent' : missing.length ? 'incomplete' : 'ready', missing });
  }
  return result;
}

export async function windowInventory() {
  return inventory(file => fs.access(path.join(windowRoot, file)).then(() => true, error => {
    if (error.code !== 'ENOENT') throw error;
    return false;
  }), async file => crypto.createHash('sha256').update(await fs.readFile(path.join(windowRoot, file))).digest('hex'), windowSlices);
}

// The strict typecheck is the same on every OS; Linux and Windows PR slice jobs already run it.
// Cold hosted macOS tsgo hits BRANCH_TSGO_TIMEOUT_MS and fails the 15-minute job.
export function shouldRunStrictChecks(platform = process.platform) {
  return platform !== 'darwin';
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

async function hashes(selected, selectedWindow = []) {
  const files = [...new Set(['engine/branch.mjs', 'engine/package.json', 'engine/pnpm-lock.yaml', 'engine/pnpm-workspace.yaml',
    'engine/tsconfig.json', 'engine/tsconfig.core.json', 'scripts/feature-slice-ci.mjs',
    'scripts/feature-slice-ci-targets.mjs', '.github/workflows/feature-slice-checks.yml',
    ...ambientRoots.map(file => `engine/${file}`),
    ...selected.flatMap(slice => [slice.anchor, ...slice.productionAnchors.map(anchor => typeof anchor === 'string' ? anchor : anchor.file),
      ...slice.native, ...slice.vitest, ...slice.strict].map(file => `engine/${file}`)),
    'window/package.json', 'window/pnpm-lock.yaml', 'window/tsconfig.json', 'window/tsconfig.app.json', 'window/tsconfig.node.json',
    'window/vite.config.ts', 'scripts/feature-batch-ci-window-tooling/package.json',
    'scripts/feature-batch-ci-window-tooling/pnpm-lock.yaml', 'scripts/feature-batch-ci-window-tooling/pnpm-workspace.yaml',
    ...selectedWindow.flatMap(slice => [slice.anchor, ...slice.productionAnchors.map(anchor => typeof anchor === 'string' ? anchor : anchor.file),
      ...slice.vitest, ...slice.strict].map(file => `window/${file}`))])];
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
      '--project', config, '--extendedDiagnostics'], engineRoot, env, scratch, receipt, `strict-${profile}`, 330_000);
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
import { pathToFileURL } from 'node:url';
const require = createRequire(${JSON.stringify(path.join(engineRoot, 'package.json'))});
const engine = ${JSON.stringify(engineRoot)};
const { paths } = JSON.parse(fs.readFileSync(path.join(engine, 'tsconfig.json'), 'utf8')).compilerOptions;
await require('esbuild').build({ entryPoints: [${JSON.stringify(path.join(engineRoot, 'src/agents/sessions/tools/file-tool-planning.worker.ts'))}],
outfile: ${JSON.stringify(worker)}, bundle: true, platform: 'node', format: 'esm', target: 'node24',
tsconfig: ${JSON.stringify(path.join(engineRoot, 'tsconfig.json'))},
plugins: [{ name: 'actual-checkout-source', setup(build) { build.onResolve({ filter: /^[^./]/ }, args => {
if (args.kind === 'entry-point' || path.isAbsolute(args.path) || args.path.startsWith('node:')) return;
for (const [key, targets] of Object.entries(paths)) {
if (key === args.path || (key.endsWith('*') && args.path.startsWith(key.slice(0, -1)))) {
const suffix = key.endsWith('*') ? args.path.slice(key.length - 1) : '';
const candidate = path.resolve(engine, targets[0].replace('*', suffix));
if (fs.existsSync(candidate)) return { path: candidate };
if (fs.existsSync(candidate + '.ts')) return { path: candidate + '.ts' };
} }
return { path: pathToFileURL(require.resolve(args.path)).href, external: true };
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

async function windowChecks(selected, pnpm, scratch, receipt, env) {
  const source = JSON.parse(await fs.readFile(path.join(windowRoot, 'package.json'), 'utf8'));
  const tooling = JSON.parse(await fs.readFile(path.join(toolingRoot, 'package.json'), 'utf8'));
  const expected = { ...source.dependencies, ...source.devDependencies };
  for (const [name, pin] of Object.entries(expected)) expected[name] = pin.startsWith('link:')
    ? `link:../../engine/packages/${name.slice('@branch/'.length)}` : pin.replace(/^[~^]/, '');
  assert.deepEqual(tooling.dependencies, expected, 'Changed window tooling requires review of its canonical lock');
  const policy = await fs.readFile(path.join(toolingRoot, 'pnpm-workspace.yaml'), 'utf8');
  assert.match(policy, /^minimumReleaseAge: 10080$/m);
  assert.match(policy, /^minimumReleaseAgeStrict: true$/m);
  const flags = await verifiedExceptionFlags('window');
  await execute(pnpm, ['install', '--frozen-lockfile', '--ignore-scripts', ...flags,
    `--store-dir=${path.join(scratch, 'window-pnpm-store')}`,
    `--modules-dir=${path.join(windowRoot, 'node_modules')}`,
    `--virtual-store-dir=${path.join(windowRoot, 'node_modules/.pnpm')}`], toolingRoot, env, scratch, receipt, 'frozen-window-install', 240_000);
  await publishWindowDependencies();
  await assertLocalModules(windowRoot, ['vitest', 'typescript', 'react', 'react-dom', 'jsdom']);
  for (const name of ['gateway-protocol', 'gateway-client']) await execute(process.execPath,
    [nodeHeap, '--import', './scripts/tsx.mjs', 'scripts/build-workspace-package.mts', name],
    engineRoot, env, scratch, receipt, `canonical-${name}-build`);
  // Use both original renderer project profiles. Build-info caches live in owned node_modules.
  await execute(process.execPath, [nodeHeap, path.join(windowRoot, 'node_modules/typescript/bin/tsc'),
    '--build', path.join(windowRoot, 'tsconfig.json'), '--verbose'], windowRoot, env, scratch, receipt, 'strict-window');
  const files = selected.flatMap(slice => slice.vitest);
  const config = path.join(scratch, 'window-vitest.config.mjs');
  await fs.writeFile(config, `import config from ${JSON.stringify(pathToFileURL(path.join(windowRoot, 'vite.config.ts')).href)};
export default { ...config, root: ${JSON.stringify(windowRoot)},
test: { ...config.test, include: ${JSON.stringify(files)}, projects: undefined, maxWorkers: 1,
fileParallelism: false, isolate: true, passWithNoTests: false, pool: 'forks', execArgv: ['${nodeHeap}'] } };\n`);
  await execute(process.execPath, [nodeHeap, path.join(windowRoot, 'node_modules/vitest/vitest.mjs'),
    'run', '--config', config, ...files], windowRoot, env, scratch, receipt, 'named-window-vitest');
}

async function all() {
  const scope = await inventory();
  const shard = shardSelection();
  const selected = scope.filter(slice => slice.state === 'ready')
    .filter((_, index) => index % shard.total === shard.index);
  const windowScope = await windowInventory();
  const selectedWindow = windowScope.filter(slice => slice.state === 'ready')
    .filter((_, index) => (index + 1) % shard.total === shard.index);
  const base = process.env.RUNNER_TEMP ?? process.env.BRANCH_FEATURE_SLICE_TEMP;
  assert(base, 'RUNNER_TEMP or explicit BRANCH_FEATURE_SLICE_TEMP is required');
  await fs.mkdir(base, { recursive: true });
  const scratch = await fs.mkdtemp(path.join(base, 'branch-feature-slice-'));
  const receipt = { head: await gitHead(), platform: process.platform, node: process.version, shard, scope, windowScope,
    nativeFiles: selected.flatMap(slice => slice.native), vitestFiles: selected.flatMap(slice => slice.vitest),
    windowVitestFiles: selectedWindow.flatMap(slice => slice.vitest),
    steps: [], status: selected.length || selectedWindow.length ? 'started' : 'inventory-only', coverageClaim: 'Named offline source tests only; no installed or complete feature acceptance.' };
  const before = await hashes(selected, selectedWindow);
  const launcherBefore = await launcherState(launcherFile);
  const env = { ...baseEnv, BRANCH_TEST_ARTIFACT_DIR: path.join(scratch, 'fixtures'),
    BRANCH_HOME: path.join(scratch, 'home'), BRANCH_STATE_DIR: path.join(scratch, 'state'),
    BRANCH_CONFIG_PATH: path.join(scratch, 'config.json'), BRANCH_TEST_FAST: '1' };
  console.log(`Feature slice shard ${shard.index + 1}/${shard.total}: ${selected.length} ready selected, ${scope.filter(slice => slice.state === 'absent').length} absent. ${receipt.nativeFiles.length} native, ${receipt.vitestFiles.length} Vitest files.`);
  console.log(`Receipt directory: ${scratch}`);
  console.log(`Window slices: ${selectedWindow.length} ready. ${receipt.windowVitestFiles.length} exact React/jsdom files.`);
  try {
    assert(!scope.some(slice => slice.state === 'incomplete'),
      `Incomplete feature slices: ${JSON.stringify(scope.filter(slice => slice.state === 'incomplete').map(slice => ({ id: slice.id, missing: slice.missing })))}`);
    assert(!windowScope.some(slice => slice.state === 'incomplete'),
      `Incomplete window slices: ${JSON.stringify(windowScope.filter(slice => slice.state === 'incomplete').map(slice => ({ id: slice.id, missing: slice.missing })))}`);
    if (selected.length || selectedWindow.length) {
      const pnpm = await preparePnpm(scratch);
      const exceptions = await verifiedExceptionFlags('engine');
      receipt.installAttempted = true;
      await execute(pnpm, ['install', '--frozen-lockfile', '--ignore-scripts', ...exceptions,
        `--store-dir=${path.join(scratch, 'pnpm-store')}`], engineRoot, env, scratch, receipt, 'frozen-engine-install', 480_000);
      receipt.launcherAfterInstall = await launcherState(launcherFile);
      assert.equal(receipt.launcherAfterInstall.sha256, launcherBefore.sha256, 'Frozen installation changed tracked launcher bytes');
      await assertLocalModules(engineRoot, ['vitest', 'tsx', 'typescript', 'esbuild']);
      await execute(process.execPath, [nodeHeap, '--import', './scripts/tsx.mjs', '--input-type=module', '--eval',
        'const { withDistArtifactOwnership } = await import("./scripts/lib/dist-artifact-ownership.mts");\n' +
        'const { ensureKyselyTypes } = await import("./scripts/generate-kysely-types.mts");\n' +
        'await withDistArtifactOwnership(process.cwd(), () => ensureKyselyTypes(process.cwd()));'], engineRoot, env, scratch, receipt, 'canonical-kysely-types');
      if (shouldRunStrictChecks()) await strictChecks(selected, scratch, receipt, env);
      for (const slice of selected) {
        if (slice.native.length) await execute(process.execPath, [nodeHeap, '--import', pathToFileURL(path.join(engineRoot, 'scripts/tsx.mjs')).href,
          '--test', '--test-concurrency=1', '--test-timeout=30000', ...slice.native], engineRoot, env, scratch, receipt, `native-${slice.id}`);
      }
      if (receipt.vitestFiles.length) {
        const config = await vitestConfig(selected, scratch, env, receipt);
        await execute(process.execPath, [nodeHeap, path.join(engineRoot, 'node_modules/vitest/vitest.mjs'),
          'run', '--config', config, ...receipt.vitestFiles], engineRoot, env, scratch, receipt, 'named-vitest');
      }
      if (selectedWindow.length) await windowChecks(selectedWindow, pnpm, scratch, receipt, env);
      receipt.status = 'passed';
    }
  } catch (error) {
    receipt.status = 'failed'; receipt.error = String(error);
    throw error;
  } finally {
    try {
      // pnpm bin linking can chmod the unchanged launcher 0644 -> 0755. Preserve that exact
      // observation and restore the original mode; never ignore bytes or other tracked diffs.
      receipt.launcher = await restoreKnownLauncherMode(launcherFile, launcherBefore, receipt.installAttempted === true);
      receipt.sourceHashesBefore = before; receipt.sourceHashesAfter = await hashes(selected, selectedWindow);
      assert.deepEqual(receipt.sourceHashesAfter, before, 'CI changed source, manifests, policies or frozen locks');
      assert.equal(await gitHead(), receipt.head, 'Checked source HEAD changed');
      await execute('git', ['diff', '--exit-code', 'HEAD', '--', 'engine', 'window', 'scripts', '.github'],
        repoRoot, env, scratch, receipt, 'tracked-source-integrity');
    } catch (error) { receipt.status = 'failed'; receipt.integrityError = String(error); throw error; }
    finally {
      await fs.writeFile(path.join(scratch, 'feature-slice-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
      if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
        `Feature slice result: **${receipt.status}**. Native files: ${receipt.nativeFiles.length}. Engine Vitest files: ${receipt.vitestFiles.length}. Window Vitest files: ${receipt.windowVitestFiles.length}.\n\n` +
        [...scope, ...windowScope].map(slice => `- ${slice.id}: ${slice.state}. ` + slice.followupCoverage.map(f => `PR${f.pr}: ${f.state}. `).join('') + slice.gap).join('\n') + '\n');
    }
  }
}

async function selfTest() {
  let controls = 0;
  assert.deepEqual(shardSelection(''), { index: 0, total: 1 });
  assert.deepEqual(shardSelection('2/2'), { index: 1, total: 2 });
  assert.throws(() => shardSelection('3/2'), /Invalid FEATURE_SLICE_SHARD/);
  controls += 3;
  assert.equal(shouldRunStrictChecks('linux'), true);
  assert.equal(shouldRunStrictChecks('win32'), true);
  assert.equal(shouldRunStrictChecks('darwin'), false);
  controls += 3;
  const empty = await inventory(async () => false);
  assert(empty.every(slice => slice.state === 'absent'));
  controls++;
  const full = await inventory(async () => true);
  assert(full.every(slice => slice.state === 'ready'));
  controls++;
  const partial = await inventory(async file => file === slices[0].native[0]);
  assert.equal(partial[0].state, 'incomplete');
  controls++;
  const inherited = new Set(['src/cron/schedule-humanize.node-test.ts', 'src/cron/schedule-humanize-cli.node-test.ts',
    'src/cron/service.restart-catchup.test.ts', 'src/cron/service.every-jobs-fire.test.ts',
    'extensions/github/src/detail.test.ts', 'extensions/github/src/detail-checks.test.ts',
    'src/agents/sessions/tools/write.test.ts', 'src/agents/bash-tools.exec-host-gateway.test.ts',
    'src/plugin-sdk/pair-loop-guard-runtime.test.ts', 'src/agents/sessions/tools/edit-diff.test.ts',
    'src/agents/embedded-agent-live-edit-diff.test.ts']);
  const baseline = await inventory(async file => inherited.has(file));
  assert(baseline.every(slice => slice.state === 'absent'));
  controls++;
  const followupOnly = await inventory(async file => file === 'extensions/cloudflare/audio-transcription.http-errors.test.ts');
  assert.equal(followupOnly.find(slice => slice.id === 'cloudflare-voice').state, 'incomplete');
  controls++;
  const nativeFollowupOnly = await inventory(async file => file === 'src/coding/search-match.boundaries.node-test.ts');
  assert.equal(nativeFollowupOnly.find(slice => slice.id === 'continue-edits').state, 'incomplete');
  controls++;
  for (const slice of slices) {
    for (const anchor of slice.productionAnchors) {
      const file = typeof anchor === 'string' ? anchor : anchor.file;
      const sourceOnly = await inventory(async candidate => candidate === file, async () => 'changed-source');
      assert.equal(sourceOnly.find(candidate => candidate.id === slice.id).state, 'incomplete', `${slice.id}: source-only ${file}`);
      controls++;
      if (typeof anchor !== 'string') {
        const unchanged = await inventory(async candidate => candidate === file, async () => anchor.baselineSha256);
        assert.equal(unchanged.find(candidate => candidate.id === slice.id).state, 'absent');
        controls++;
      }
    }
    for (const marker of slice.markers ?? slice.native) {
      const testOnly = await inventory(async file => file === marker);
      assert.equal(testOnly.find(candidate => candidate.id === slice.id).state, 'incomplete', `${slice.id}: test-only ${marker}`);
      controls++;
    }
  }
  assert(slices.find(slice => slice.id === 'continue-edits').native.includes('src/agents/sessions/tools/edit-diff.continue.test.ts'));
  controls++;
  assert((await inventory(async () => false, async () => 'changed', windowSlices)).every(slice => slice.state === 'absent'));
  controls++;
  assert((await inventory(async () => true, async () => 'changed', windowSlices)).every(slice => slice.state === 'ready'));
  controls++;
  const inheritedWindow = new Set(['src/places-nav/SettingsFrame.test.tsx', 'src/composer/composer-logic.test.ts',
    'src/connect/session-error-refresh.test.ts']);
  assert((await inventory(async file => inheritedWindow.has(file), async () => 'changed', windowSlices)).every(slice => slice.state === 'absent'));
  controls++;
  for (const slice of windowSlices) {
    for (const anchor of slice.productionAnchors) {
      const file = typeof anchor === 'string' ? anchor : anchor.file;
      const sourceOnly = await inventory(async candidate => candidate === file, async () => 'changed', windowSlices);
      assert.equal(sourceOnly.find(candidate => candidate.id === slice.id).state, 'incomplete');
      controls++;
      if (typeof anchor !== 'string') {
        const unchanged = await inventory(async candidate => candidate === file, async () => anchor.baselineSha256, windowSlices);
        assert.equal(unchanged.find(candidate => candidate.id === slice.id).state, 'absent');
        controls++;
      }
    }
    for (const marker of slice.markers) {
      const testOnly = await inventory(async file => file === marker, async () => 'changed', windowSlices);
      assert.equal(testOnly.find(candidate => candidate.id === slice.id).state, 'incomplete');
      controls++;
    }
  }
  const fixture = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'feature-launcher-control-'));
  let launcherControls = 0;
  try {
    const file = path.join(fixture, 'branch.mjs');
    await fs.writeFile(file, 'export const fixture = true;\n');
    await fs.chmod(file, 0o644);
    const before = await launcherState(file);
    const unchanged = await restoreKnownLauncherMode(file, before, false);
    assert.equal(unchanged.restored, false);
    launcherControls++;
    if (process.platform !== 'win32') {
      await fs.chmod(file, 0o755);
      await assert.rejects(restoreKnownLauncherMode(file, before, false), /Unexpected tracked launcher permission change/);
      launcherControls++;
      assert.equal((await restoreKnownLauncherMode(file, before, true)).restored, true);
      launcherControls++;
      await fs.chmod(file, 0o600);
      await assert.rejects(restoreKnownLauncherMode(file, before, true), /Unexpected tracked launcher permission change/);
      launcherControls++;
    }
    await fs.writeFile(file, 'changed bytes\n');
    await assert.rejects(restoreKnownLauncherMode(file, before, true), /launcher bytes changed/);
    launcherControls++;
  } finally { await fs.rm(fixture, { recursive: true, force: true }); }
  console.log(JSON.stringify({ ...validateInventory(), selectionControls: controls, launcherControls, passed: true }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const mode = process.argv[2];
  if (mode === 'validate') { await selfTest(); console.log(JSON.stringify({ engine: await inventory(), window: await windowInventory() }, null, 2)); }
  else if (mode === 'all') await all();
  else throw new Error('Usage: node scripts/feature-slice-ci.mjs validate|all');
}

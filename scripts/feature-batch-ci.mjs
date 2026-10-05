import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { capabilityTests, namedTests, shardOf, shardTests } from './feature-batch-ci-targets.mjs';
import { runTargetedStrictChecks } from './feature-batch-ci-typecheck.mjs';
import {
  assertLocalModules, engineRoot, gitHead, hostedChrome, preparePnpm, publishWindowDependencies, repoRoot, run,
  scratchRoot, sourceHashes, toolingRoot, verifiedExceptionFlags, windowRoot,
} from './feature-batch-ci-runtime.mjs';

export async function validateScope() {
  for (const lane of ['engine', 'window']) {
    const root = lane === 'engine' ? engineRoot : windowRoot;
    for (const file of namedTests(lane)) await fs.access(path.join(root, file));
  }
  for (const file of capabilityTests()) await fs.access(path.join(engineRoot, file));
  const source = JSON.parse(await fs.readFile(path.join(windowRoot, 'package.json'), 'utf8'));
  const tooling = JSON.parse(await fs.readFile(path.join(toolingRoot, 'package.json'), 'utf8'));
  const expected = { ...source.dependencies, ...source.devDependencies };
  for (const [name, value] of Object.entries(expected)) {
    expected[name] = value.startsWith('link:')
      ? `link:../../engine/packages/${name.slice('@branch/'.length)}` : value.replace(/^[~^]/, '');
  }
  assert.deepEqual(tooling.dependencies, expected, 'Review a changed window toolchain before updating the CI lock');
  const policy = await fs.readFile(path.join(toolingRoot, 'pnpm-workspace.yaml'), 'utf8');
  assert.match(policy, /^minimumReleaseAge: 10080$/m);
  assert.match(policy, /^minimumReleaseAgeStrict: true$/m);
  const lock = await fs.readFile(path.join(toolingRoot, 'pnpm-lock.yaml'), 'utf8');
  assert(!/[A-Za-z]:\/|Codex-session-files|branch-legion/.test(lock), 'CI tooling lock must contain portable paths');
  console.log(`Validated explicit scope: ${namedTests('engine').length} engine and ${namedTests('window').length} window files`);
}

async function installDependencies(pnpm) {
  const engineFlags = await verifiedExceptionFlags('engine');
  await run(pnpm, ['install', '--frozen-lockfile', '--ignore-scripts', ...engineFlags], engineRoot);
  const windowFlags = await verifiedExceptionFlags('window');
  await run(pnpm, ['install', '--frozen-lockfile', '--ignore-scripts', ...windowFlags,
    `--modules-dir=${path.join(windowRoot, 'node_modules')}`,
    `--virtual-store-dir=${path.join(windowRoot, 'node_modules/.pnpm')}`], toolingRoot);
  await publishWindowDependencies();
  await assertLocalModules(engineRoot, ['vitest', 'mammoth', 'xlsx', '@google/genai']);
  await assertLocalModules(windowRoot, ['vitest', 'react', 'react-dom', 'jsdom']);
}

async function prepareBuildArtifacts() {
  await run(process.execPath, ['--import', './scripts/tsx.mjs', '--input-type=module', '--eval',
    'const { withDistArtifactOwnership } = await import("./scripts/lib/dist-artifact-ownership.mts");\n' +
    'const { ensureKyselyTypes } = await import("./scripts/generate-kysely-types.mts");\n' +
    'await withDistArtifactOwnership(process.cwd(), () => ensureKyselyTypes(process.cwd()));'], engineRoot);
  for (const name of ['gateway-protocol', 'gateway-client']) {
    await run(process.execPath, ['--import', './scripts/tsx.mjs',
      'scripts/build-workspace-package.mts', name], engineRoot);
  }
}

async function featureTestEnv(scratch) {
  const env = { ...process.env, BRANCH_TEST_ARTIFACT_DIR: path.join(scratch, 'fixtures'),
    BRANCH_BROWSER_SNAPSHOT_E2E: process.platform === 'linux' ? '1' : '0' };
  if (process.platform === 'linux') env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = await hostedChrome();
  return env;
}

async function runCapabilityTests(scratch) {
  const config = path.join(repoRoot, 'scripts', 'feature-batch-ci-capabilities.config.mjs');
  await run(process.execPath, [path.join(engineRoot, 'node_modules/vitest/vitest.mjs'),
    'run', '--config', config, ...capabilityTests()], engineRoot, await featureTestEnv(scratch));
}

async function runFeatureTests(scratch) {
  const env = await featureTestEnv(scratch);
  const shard = shardOf();
  for (const lane of ['engine', 'window']) {
    const root = lane === 'engine' ? engineRoot : windowRoot;
    const config = path.join(repoRoot, 'scripts', `feature-batch-ci-${lane}.config.mjs`);
    const tests = shardTests(namedTests(lane), shard);
    if (!tests.length) continue;
    console.log(`${lane}: ${tests.length} named test files in shard ${shard.index + 1}/${shard.total}`);
    await run(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'),
      'run', '--config', config, ...tests], root, env);
  }
}

async function checkAll(suite = 'named') {
  const started = Date.now();
  await validateScope();
  const headBefore = await gitHead();
  console.log(`Feature source HEAD: ${headBefore}`);
  const before = await sourceHashes();
  const scratch = await scratchRoot();
  const receipt = { commit: headBefore, startedAt: new Date(started).toISOString(), node: process.version, platform: process.platform, before };
  try {
    const pnpm = await preparePnpm(scratch);
    await installDependencies(pnpm);
    await prepareBuildArtifacts();
    if (suite === 'capabilities') await runCapabilityTests(scratch);
    else {
      // The strict typecheck is the same on every OS; Linux runs it once. On the 7 GB macOS
      // runners its ~6 GB check thrashes and alone pushed the job past the 15-minute cap.
      // Whole-tree checks run once, in the first shard.
      const firstShard = shardOf().index === 0;
      if (process.platform === 'linux' && firstShard) await runTargetedStrictChecks(scratch);
      if (process.platform === 'linux' && firstShard) await run(process.execPath, ['--test', 'scripts/feature-batch-ci-shard.test.mjs'], repoRoot);
      // The release's native-protocol step rejects schema changes the Swift/Kotlin generators cannot
      // name (an alias without a canonical name broke every release after #188). Check it per PR.
      if (process.platform === 'linux' && firstShard) {
        for (const language of ['swift', 'kotlin']) {
          await run(process.execPath, ['scripts/prepare-native-protocol.mjs', '--language', language, '--check'], engineRoot);
        }
      }
      await runFeatureTests(scratch);
    }
    receipt.passed = true;
  } finally {
    receipt.after = await sourceHashes();
    receipt.headAfter = await gitHead();
    receipt.elapsedMs = Date.now() - started;
    await fs.writeFile(path.join(scratch, 'feature-batch-ci-proof.json'), JSON.stringify(receipt, null, 2) + '\n');
    assert.deepEqual(receipt.after, before, 'CI must preserve source manifests, policies, and frozen locks');
    assert.equal(receipt.headAfter, headBefore, 'The checked source HEAD changed during verification');
  }
}

// Release packaging smoke: the same runtime build and postbuild (including the update-compatibility
// bridge) the release runs, on Linux only and without declarations. #261 broke every release this way
// while every PR check passed.
async function checkPackaging() {
  const started = Date.now();
  const scratch = await scratchRoot();
  const pnpm = await preparePnpm(scratch);
  await run(pnpm, ['install', '--frozen-lockfile', '--ignore-scripts', ...await verifiedExceptionFlags('engine')], engineRoot);
  await run(process.execPath, ['--import', './scripts/tsx.mjs', 'scripts/build-all.mts', 'package'], engineRoot,
    { ...process.env, BRANCH_RUN_NODE_SKIP_DTS_BUILD: '1' });
  console.log(`Release packaging build passed in ${Math.round((Date.now() - started) / 1000)}s`);
}

const mode = process.argv[2];
if (mode === 'validate') await validateScope();
else if (mode === 'all') await checkAll();
else if (mode === 'capabilities') await checkAll('capabilities');
else if (mode === 'package') await checkPackaging();
else throw new Error('Usage: node scripts/feature-batch-ci.mjs validate|all|capabilities|package');

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { namedTests } from './feature-batch-ci-targets.mjs';
import { runTargetedStrictChecks } from './feature-batch-ci-typecheck.mjs';
import {
  assertLocalModules, engineRoot, featureTestInvocations, gitHead, hostedChrome, preparePnpm, publishWindowDependencies, repoRoot, run,
  scratchRoot, sourceHashes, toolingRoot, verifiedExceptionFlags, windowRoot,
} from './feature-batch-ci-runtime.mjs';

export async function validateScope() {
  for (const lane of ['engine', 'window']) {
    const root = lane === 'engine' ? engineRoot : windowRoot;
    for (const file of namedTests(lane)) await fs.access(path.join(root, file));
  }
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

async function runFeatureTests(scratch) {
  await run(process.execPath, ['--import', './engine/scripts/tsx.mjs', '--test', 'scripts/feature-batch-ci-runtime.test.mjs']);
  const env = { ...process.env, BRANCH_TEST_ARTIFACT_DIR: path.join(scratch, 'fixtures'),
    BRANCH_BROWSER_SNAPSHOT_E2E: process.platform === 'linux' ? '1' : '0' };
  if (process.platform === 'linux') env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = await hostedChrome();
  for (const lane of ['engine', 'window']) {
    for (const { root, args, env: partitionEnv } of featureTestInvocations(lane)) {
      await run(process.execPath, args, root, { ...env, ...partitionEnv });
    }
  }
}

async function checkAll() {
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
    await runTargetedStrictChecks(scratch);
    await runFeatureTests(scratch);
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

const mode = process.argv[2];
if (mode === 'validate') await validateScope();
else if (mode === 'all') await checkAll();
else throw new Error('Usage: node scripts/feature-batch-ci.mjs validate|all');

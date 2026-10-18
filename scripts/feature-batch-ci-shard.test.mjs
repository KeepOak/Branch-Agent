// node --test scripts/feature-batch-ci-shard.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { expectedShardSeconds, featureTestWeight, featureTestWeightKeys, firstShardReserveSeconds, harvestE2eError, harvestFileSecondsFor, harvestMatrix, harvestMaxShards, harvestShardBudgetSeconds, harvestShardFiles, harvestTestFiles, harvestTests, harvestUnlistedFileSeconds, planHarvestShards, mainPushShardCounts, namedTests, planShards, plannedJobSeconds, plannedSlowestSeconds, overBudgetShards, setNamedListDir, pullRequestLinuxShardCount, resolvedShardCounts, runnerSetupSeconds, runnerTestScale, shardBudgetFor, shardBudgetSeconds, shardCountFor, shardOf, shardTests, touchedHarvestTests, touchedTests, windowsSmokeTests } from './feature-batch-ci-targets.mjs';
import {
  REGISTRY_DOWNLOAD_ATTEMPTS, isTransientRegistryError, registryRetryWaitMs, withRegistryRetry,
} from './feature-batch-ci-runtime.mjs';
import { featureBatchMatrix, validateFeatureBatchMatrix } from './feature-batch-ci-matrix.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('no FEATURE_SHARD runs everything in one job', () => {
  assert.deepEqual(shardOf(''), { index: 0, total: 1 });
  assert.deepEqual(shardTests(['a', 'b'], shardOf('')), ['a', 'b']);
});

test('the shards split the named list with nothing lost or run twice', () => {
  for (const lane of ['engine', 'window']) {
    const all = namedTests(lane);
    for (const total of [2, 3, 5, 6, 10]) {
      const parts = Array.from({ length: total }, (_, index) => shardTests(all, shardOf(`${index + 1}/${total}`)));
      assert.deepEqual(parts.flat().sort(), [...all].sort());
      assert.equal(new Set(parts.flat()).size, all.length);
    }
  }
});

test('slow files land on different shards instead of the same index stripe', () => {
  // Sorted-index round-robin puts every third file on shard 1. These three would share it.
  const tests = ['slow-a', 'fast-a', 'fast-b', 'slow-b', 'fast-c', 'fast-d', 'slow-c', 'fast-e', 'fast-f'];
  const weights = new Map([['slow-a', 100], ['slow-b', 90], ['slow-c', 80]]);
  const parts = [1, 2, 3].map(n => shardTests(tests, shardOf(`${n}/3`), weights));
  assert.deepEqual(parts.map(part => part.filter(file => file.startsWith('slow-'))), [['slow-c'], ['slow-a'], ['slow-b']]);
  assert.deepEqual(parts.flat().sort(), [...tests].sort());
});

test('duration weighting keeps named engine shards within one heavy file', () => {
  const known = new Set([...namedTests('engine'), ...namedTests('window')]);
  for (const file of featureTestWeightKeys()) assert.ok(known.has(file), `${file} is not a named test`);
  const all = namedTests('engine');
  const heaviest = Math.max(...all.map(file => featureTestWeight(file)));
  for (const total of [3, 6, 7, 8, 10]) {
    const plan = planShards(all, total);
    const testLoads = plan.loads.map((load, index) => load - (index === 0 ? firstShardReserveSeconds : 0));
    const span = Math.max(...testLoads) - Math.min(...testLoads);
    assert.ok(span <= heaviest, `engine ${total}: shard span ${span}s is wider than the slowest file ${heaviest}s`);
    assert.ok(Math.max(...testLoads) / Math.min(...testLoads) < 1.25, `engine ${total}: ${testLoads.join(',')}`);
  }
});

test('the workflow takes its matrix from the planner, and every planned shard fits its budget', () => {
  const yaml = readFileSync(new URL('../.github/workflows/feature-batch-checks.yml', import.meta.url), 'utf8');
  assert.match(yaml, /timeout-minutes: 15/);
  assert.doesNotMatch(yaml, /timeout-minutes: 20/);
  assert.match(yaml, /matrix: \$\{\{ fromJSON\(needs\.plan\.outputs\.matrix\) \}\}/);
  assert.doesNotMatch(yaml, /fromJSON\(github\.event_name/);
  const counts = resolvedShardCounts();
  const push = featureBatchMatrix({ event: 'push' }).include;
  const pr = featureBatchMatrix({ event: 'pull_request' }).include;
  const labels = (rows, os) => rows.filter(row => row.os === os).map(row => row.label);
  assert.deepEqual(labels(pr, 'ubuntu-latest'), Array.from({ length: counts.pullRequestLinux }, (_, index) => `${index + 1}/${counts.pullRequestLinux}`));
  assert.deepEqual(pr.filter(row => row.os === 'windows-latest').map(row => row.label), ['touched']);
  assert.deepEqual(labels(push, 'ubuntu-latest'), Array.from({ length: counts.ubuntu }, (_, index) => `${index + 1}/${counts.ubuntu}`));
  assert.deepEqual(labels(push, 'windows-latest'), Array.from({ length: counts.windows }, (_, index) => `${index + 1}/${counts.windows}`));
  assert.deepEqual(labels(push, 'macos-latest'), Array.from({ length: counts.macos }, (_, index) => `${index + 1}/${counts.macos}`));
  for (const [os, total] of [['ubuntu', counts.ubuntu], ['windows', counts.windows], ['macos', counts.macos], ['ubuntu', counts.pullRequestLinux]]) {
    assert.deepEqual(overBudgetShards(os, total), [], `${os} ${total}: shards over the ${shardBudgetFor(os)}s budget`);
  }
});

test('the OS-specific macOS workflow takes its shard count from the planner, not a fixed list', () => {
  // A fixed 16-shard macOS matrix planned an 810 s slowest job once the named lists grew, and its shards were
  // cancelled at the 15-minute cap. The plan job filters the main-push matrix to macOS, so both use one count.
  const yaml = readFileSync(new URL('../.github/workflows/os-specific-checks.yml', import.meta.url), 'utf8');
  const named = yaml.slice(yaml.indexOf('\n  named:'), yaml.indexOf('\n  capabilities:'));
  assert.match(named, /timeout-minutes: 15/);
  assert.match(named, /needs: plan/);
  assert.match(named, /matrix: \$\{\{ fromJSON\(needs\.plan\.outputs\.matrix\) \}\}/);
  assert.match(named, /FEATURE_SHARD: \$\{\{ matrix\.shard \}\}\n/);
  assert.doesNotMatch(named, /shard: \[/);
  assert.match(yaml, /node base\/scripts\/feature-batch-ci-matrix\.mjs push --named-dir/);
  assert.match(yaml, /select\(\.os == "macos-latest"\)/);
  const macos = featureBatchMatrix({ event: 'push' }).include.filter(row => row.os === 'macos-latest');
  assert.equal(macos.length, resolvedShardCounts().macos);
  assert.deepEqual(overBudgetShards('macos', macos.length), []);
});

test('pull requests start every planned shard in one wave; main pushes keep max-parallel 6', () => {
  const yaml = readFileSync(new URL('../.github/workflows/feature-batch-checks.yml', import.meta.url), 'utf8');
  const cap = yaml.match(/max-parallel: \$\{\{ github\.event_name == 'pull_request' && (\d+) \|\| (\d+) \}\}/);
  assert.ok(cap, 'feature-batch max-parallel must be set per event');
  const [prCap, pushCap] = [Number(cap[1]), Number(cap[2])];
  const pr = featureBatchMatrix({ event: 'pull_request' }).include;
  assert.ok(prCap >= pr.length, `PR max-parallel ${prCap} is below the ${pr.length} planned PR jobs, so they would run in two waves`);
  assert.equal(pushCap, 6);
});

test('macOS and Windows main-push shards keep ten percent budget headroom', () => {
  // The only exception is a shard holding one engine file, which no shard count can split.
  const counts = resolvedShardCounts();
  for (const os of ['macos', 'windows']) {
    const jobs = plannedJobSeconds(os, counts[os]);
    const files = planShards(namedTests('engine'), counts[os]).files;
    const slowest = Math.max(...jobs.filter((_, index) => files[index].length > 1));
    assert.ok(slowest <= shardBudgetSeconds * 0.9, `${os} shard is ${slowest}s, over the ${shardBudgetSeconds * 0.9}s headroom budget`);
  }
});

test('a PR adding 60 unweighted engine tests still fits every planned shard budget', () => {
  // The rebrand docs PRs (#919-#922) name about 60 engine tests with no duration weight, so each
  // counts at the 5s default. The counts for those PRs are derived from the same weights.
  const extraTests = Array.from({ length: 60 }, (_, index) => `src/pr-batch-${String(index + 1).padStart(2, '0')}.test.ts`);
  const counts = resolvedShardCounts({ extraTests });
  for (const os of ['ubuntu', 'windows', 'macos']) {
    assert.deepEqual(overBudgetShards(os, counts[os], { extraTests }), [], `${os} with 60 extra tests: shards over the ${shardBudgetFor(os)}s budget`);
  }
});

test('adding weight past the ceiling adds one shard and never fails', () => {
  // A PR that pushes the Windows total over the ceiling gets one more shard. The matrix grows,
  // the budget still holds, and nothing throws.
  const base = shardCountFor('windows');
  const added = [];
  let count = base;
  for (let index = 0; count === base && index < 5000; index += 1) {
    added.push(`src/regression-${String(index).padStart(4, '0')}.test.ts`);
    count = shardCountFor('windows', { extraTests: added });
  }
  assert.equal(count, base + 1, 'the first increase should be exactly one shard');
  assert.deepEqual(overBudgetShards('windows', count, { extraTests: added }), []);
  const windowsRows = featureBatchMatrix({ event: 'push', extraTests: added }).include.filter(row => row.os === 'windows-latest');
  assert.equal(windowsRows.length, base + 1);
});

test('the planned job time counts runner setup on top of the tests', () => {
  for (const os of ['ubuntu', 'windows', 'macos']) {
    const tests = expectedShardSeconds(12, { typecheck: os === 'ubuntu', scale: runnerTestScale[os] });
    assert.deepEqual(plannedJobSeconds(os, 12), tests.map(seconds => seconds + runnerSetupSeconds[os]));
    assert.ok(runnerSetupSeconds[os] >= 60, `${os} setup is at least a minute of checkout, install and build`);
  }
});

test('every planned Linux shard job, setup included, fits ten minutes', () => {
  // AGENTS.md rule 13: shards finish well inside the 15-minute cap. The budget is the whole job, not the tests.
  assert.equal(shardBudgetSeconds, 10 * 60);
  const counts = resolvedShardCounts();
  for (const total of [counts.pullRequestLinux, counts.ubuntu]) {
    for (const [index, seconds] of plannedJobSeconds('ubuntu', total).entries()) {
      assert.ok(seconds <= shardBudgetSeconds, `ubuntu shard ${index + 1}/${total} plans ${seconds}s, over ${shardBudgetSeconds}s`);
    }
  }
});

test('the derived Linux count is the smallest that fits, with setup counted', () => {
  // The old PR floor of ten shards fit a 12-minute test-only budget; its jobs ran 11 to 15 minutes.
  const total = shardCountFor('ubuntu');
  const tests = Math.max(...expectedShardSeconds(total - 1, { typecheck: true }));
  assert.ok(plannedSlowestSeconds('ubuntu', total - 1) > shardBudgetSeconds, 'one shard fewer would be over budget');
  assert.equal(plannedSlowestSeconds('ubuntu', total - 1), tests + runnerSetupSeconds.ubuntu);
});

test('a shard over the Windows or macOS budget holds one engine file, which no shard count can split', () => {
  const counts = resolvedShardCounts();
  const engine = namedTests('engine');
  for (const os of ['windows', 'macos']) {
    const files = planShards(engine, counts[os]).files;
    plannedJobSeconds(os, counts[os]).forEach((seconds, index) => {
      if (seconds <= shardBudgetFor(os)) return;
      assert.equal(files[index].length, 1, `${os} shard ${index + 1}: ${files[index].join(', ')}`);
      // One more shard would not make it faster: the file is still alone.
      const more = planShards(engine, counts[os] + 1).files.find(part => part.includes(files[index][0]));
      assert.deepEqual(more, files[index]);
    });
  }
  // A Linux shard with several files over budget is never accepted.
  assert.deepEqual(overBudgetShards('ubuntu', counts.pullRequestLinux), []);
  assert.ok(overBudgetShards('ubuntu', 2).length > 0);
});

test('a malformed shard is an error, not a silent skip', () => {
  for (const bad of ['0/2', '3/2', '1', 'a/b', '1/0']) assert.throws(() => shardOf(bad));
});

test('Windows PR scope runs touched named tests plus the smoke set, never unlisted files', () => {
  const engine = namedTests('engine');
  const touched = engine.find((file) => !windowsSmokeTests.engine.includes(file));
  const picked = touchedTests('engine', [`engine/${touched}`, 'engine/src/not-a-test.ts', 'window/src/x.ts']);
  assert.deepEqual([...picked].sort(), [...new Set([touched, ...windowsSmokeTests.engine])].sort());
  for (const file of windowsSmokeTests.engine) assert.ok(engine.includes(file), `${file} must be a named test`);
  assert.deepEqual(touchedTests('window', ['engine/src/x.ts']), []);
});

test('Harvest lists stay out of named tests and PRs select touched lists and test files', () => {
  const all = harvestTests('engine');
  const pilot = harvestTestFiles('engine', ['feat-harvest-pilot-a-1.txt']);
  assert.equal(pilot.length, 21);
  assert.ok(all.every(file => !namedTests('engine').includes(file)));
  const list = 'scripts/feature-batch-ci-harvest/feat-harvest-pilot-a-1.txt';
  assert.deepEqual(touchedHarvestTests('engine', [list]), [...pilot].sort());
  assert.deepEqual(touchedHarvestTests('engine', [`engine/${all[0]}`]), [all[0]]);
  assert.deepEqual(touchedHarvestTests('engine', ['engine/src/unlisted.test.ts']), []);
  assert.deepEqual(touchedHarvestTests('window', [list]), []);
  const shards = harvestMatrix([list]).filter(item => item.lane === 'engine');
  assert.equal(shards.length, planHarvestShards([...pilot].sort(), 'pr').length);
  assert.deepEqual(shards.flatMap(item => harvestShardFiles('engine', item.shard, [list])).sort(), [...pilot].sort());
  assert.equal(harvestMatrix().filter(item => item.lane === 'engine').length, planHarvestShards(all, 'nightly').length);
});

test('Harvest shards are sized by time and never come out empty', () => {
  const all = harvestTests('engine');
  for (const scope of ['pr', 'nightly']) {
    const budget = harvestShardBudgetSeconds[scope] - runnerSetupSeconds.ubuntu;
    const plan = planHarvestShards(all, scope);
    assert.ok(plan.length >= 1 && plan.length <= harvestMaxShards, `${scope}: ${plan.length} shards`);
    assert.ok(plan.every(files => files.length > 0), `${scope}: an empty shard would select every file in the lane`);
    assert.deepEqual(plan.flat().sort(), [...all].sort(), `${scope}: every file runs in exactly one shard`);
    for (const files of plan) {
      const seconds = files.reduce((sum, file) => sum + harvestFileSecondsFor(file), 0);
      assert.ok(seconds <= budget, `${scope}: a shard plans ${seconds}s over the ${budget}s test budget`);
    }
  }
});

test('a wide PR splits into several shards, none empty, instead of one empty shard and a whole-lane run', () => {
  const wide = harvestTests('engine').slice(0, 56);
  const plan = planHarvestShards(wide, 'pr');
  assert.ok(plan.length > 1, 'a 56-file PR must not stay one shard');
  assert.ok(plan.every(files => files.length > 0));
  assert.deepEqual(plan.flat().sort(), [...wide].sort());
  const matrix = harvestMatrix(wide.map(file => `engine/${file}`)).filter(item => item.lane === 'engine');
  assert.equal(matrix.length, plan.length);
  assert.deepEqual(matrix.map(item => item.shard), plan.map((_, index) => `${index + 1}/${plan.length}`));
});

test('a Harvest shard that does not match the plan fails instead of running the whole lane', () => {
  const pilot = harvestTestFiles('engine', ['feat-harvest-pilot-a-1.txt']);
  const list = ['scripts/feature-batch-ci-harvest/feat-harvest-pilot-a-1.txt'];
  const total = planHarvestShards([...pilot].sort(), 'pr').length;
  assert.throws(() => harvestShardFiles('engine', `1/${total + 1}`, list), /does not match/);
  const picked = Array.from({ length: total }, (_, index) => harvestShardFiles('engine', `${index + 1}/${total}`, list));
  assert.deepEqual(picked.flat().sort(), [...pilot].sort());
  assert.ok(harvestMatrix().length < 256, 'the matrix stays under the GitHub job limit');
});

test('an unmeasured Harvest file weighs the default, and a measured one weighs its logged seconds', () => {
  assert.equal(harvestFileSecondsFor('src/not-measured-yet.test.ts'), harvestUnlistedFileSeconds);
  assert.equal(harvestFileSecondsFor('src/plugin-sdk/channel-inbound.test.ts'), 121);
});

test('Harvest lists reject e2e files that Harvest vitest excludes', () => {
  assert.match(harvestE2eError('engine', 'src/commands/doctor.auth-profile-consumers.e2e.test.ts'), /e2e suite/);
  assert.match(harvestE2eError('window', 'src/foo.e2e.test.tsx'), /e2e suite/);
  assert.equal(harvestE2eError('engine', 'src/commands/doctor.test.ts'), undefined);
  const all = [...harvestTests('engine'), ...harvestTests('window')];
  assert.equal(all.find(file => harvestE2eError('engine', file) || harvestE2eError('window', file)), undefined);
});

test('an empty feature-batch matrix fails closed instead of skipping every feature job', () => {
  assert.throws(() => validateFeatureBatchMatrix({ include: [] }, 'push'), /matrix is empty/);
  assert.throws(() => validateFeatureBatchMatrix({}, 'push'), /matrix is empty/);
  assert.throws(() => validateFeatureBatchMatrix({ include: [] }, 'pull_request'), /matrix is empty/);
});

test('a feature-batch matrix below the shard floors fails closed', () => {
  const real = featureBatchMatrix({ event: 'push' });
  const fewerWindows = { include: real.include.filter((row) => row.os !== 'windows-latest') };
  assert.throws(() => validateFeatureBatchMatrix(fewerWindows, 'push'), /windows-latest shard\(s\), below the floor/);
  const linux = real.include.filter((row) => row.os === 'ubuntu-latest');
  const fewerLinux = { include: [...linux.slice(0, mainPushShardCounts.ubuntu - 1), ...real.include.filter((row) => row.os !== 'ubuntu-latest')] };
  assert.throws(() => validateFeatureBatchMatrix(fewerLinux, 'push'), /ubuntu-latest shard\(s\), below the floor/);
  assert.equal(validateFeatureBatchMatrix(real, 'push'), real);
});

test('the planner reads the PR named lists as data, from the directory it is given', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'named-lists-'));
  writeFileSync(path.join(dir, 'pr-added.txt'), 'engine:src/pr-added-data.test.ts\n');
  const before = namedTests('engine');
  try {
    setNamedListDir(dir);
    const after = namedTests('engine');
    // The PR's directory is the only named-list source now: its file is read, and the repo's named lists are not.
    assert.ok(after.includes('src/pr-added-data.test.ts'));
    assert.ok(after.length < before.length, 'the repo named lists are not read from the PR directory');
  } finally {
    setNamedListDir(fileURLToPath(new URL('./feature-batch-ci-named/', import.meta.url)));
  }
});

test('the plan job uses the default-branch planner when it exists, and only a reviewed fallback literal before', () => {
  const yaml = readFileSync(new URL('../.github/workflows/feature-batch-checks.yml', import.meta.url), 'utf8');
  assert.match(yaml, /if \[ -f base\/scripts\/feature-batch-ci-matrix\.mjs \]; then/);
  const literals = [...yaml.matchAll(/echo 'matrix=(\{.*?\})' >> "\$GITHUB_OUTPUT"/g)].map((m) => JSON.parse(m[1]));
  assert.equal(literals.length, 2, 'one fallback for pull requests, one for pushes');
  const [pr, push] = literals;
  assert.doesNotThrow(() => validateFeatureBatchMatrix(pr, 'pull_request'));
  assert.doesNotThrow(() => validateFeatureBatchMatrix(push, 'push'));
  assert.equal(pr.include.filter((row) => row.os === 'ubuntu-latest').length, pullRequestLinuxShardCount);
  assert.equal(push.include.filter((row) => row.os === 'windows-latest').length, mainPushShardCounts.windows);
  assert.equal(push.include.filter((row) => row.os === 'macos-latest').length, mainPushShardCounts.macos);
  assert.equal(push.include.filter((row) => row.os === 'ubuntu-latest').length, mainPushShardCounts.ubuntu);
});

test('registry 502s and timeouts are transient; 4xx and integrity mismatches fail closed', () => {
  assert.equal(isTransientRegistryError(new Error('Download failed 502: https://registry.npmjs.org/pnpm/12.5.1')), true);
  assert.equal(isTransientRegistryError(new Error('Download failed 503: https://registry.npmjs.org/pnpm/12.5.1')), true);
  assert.equal(isTransientRegistryError(new Error('Download failed 504: https://registry.npmjs.org/pnpm/12.5.1')), true);
  assert.equal(isTransientRegistryError(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })), true);
  assert.equal(isTransientRegistryError(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })), true);
  assert.equal(isTransientRegistryError(new Error('fetch failed')), true);
  assert.equal(isTransientRegistryError(new Error('Download failed 404: https://registry.npmjs.org/missing/1.0.0')), false);
  assert.equal(isTransientRegistryError(new Error('Download failed 401: https://registry.npmjs.org/pnpm/12.5.1')), false);
  assert.equal(isTransientRegistryError(new Error('Registry/lock mismatch: pnpm@12.5.1')), false);
  assert.equal(isTransientRegistryError(new Error('Downloaded tarball/lock mismatch: pnpm@12.5.1')), false);
});

test('registry download retries use backoff, then give up, and never retry a closed failure', async () => {
  assert.deepEqual(
    Array.from({ length: REGISTRY_DOWNLOAD_ATTEMPTS - 1 }, (_, attempt) => registryRetryWaitMs(attempt)),
    [400, 800, 1600],
  );
  const waits = [];
  let flaky = 0;
  const recovered = await withRegistryRetry(async () => {
    flaky += 1;
    if (flaky < 3) throw new Error('Download failed 502: https://registry.npmjs.org/pnpm/12.5.1');
    return 'ok';
  }, { sleep: async (ms) => { waits.push(ms); }, log() {} });
  assert.equal(recovered, 'ok');
  assert.equal(flaky, 3);
  assert.deepEqual(waits, [400, 800]);

  let closed = 0;
  await assert.rejects(withRegistryRetry(async () => {
    closed += 1;
    throw new Error('Download failed 404: https://registry.npmjs.org/missing/1.0.0');
  }, { sleep: async () => { throw new Error('must not sleep on a closed failure'); }, log() {} }), /Download failed 404/);
  assert.equal(closed, 1);

  let exhausted = 0;
  await assert.rejects(withRegistryRetry(async () => {
    exhausted += 1;
    throw new Error('Download failed 502: https://registry.npmjs.org/pnpm/12.5.1');
  }, { sleep: async () => {}, log() {} }), /Download failed 502/);
  assert.equal(exhausted, REGISTRY_DOWNLOAD_ATTEMPTS);
});

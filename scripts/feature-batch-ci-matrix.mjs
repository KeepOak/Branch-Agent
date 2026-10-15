#!/usr/bin/env node
// Builds the feature-batch job matrix from the shard planner, so shard counts follow the test weights.
// Usage: node <default-branch>/scripts/feature-batch-ci-matrix.mjs <event-name> [--named-dir <pr>/scripts/feature-batch-ci-named]
// Prints one line: matrix={"include":[...]}. The planner always comes from the script's own tree (the default
// branch in CI). The PR's named lists are read as data only. An empty or under-floor matrix is an error.
import { fileURLToPath } from 'node:url';
import {
  mainPushShardCounts,
  pullRequestLinuxShardCount,
  resolvedShardCounts,
  setNamedListDir,
} from './feature-batch-ci-targets.mjs';

function linuxRows(count, scope) {
  return Array.from({ length: count }, (_, i) => ({ os: 'ubuntu-latest', shard: `${i + 1}/${count}`, label: `${i + 1}/${count}`, scope }));
}

function shardRows(os, count) {
  return Array.from({ length: count }, (_, i) => ({ os, shard: `${i + 1}/${count}`, label: `${i + 1}/${count}`, scope: 'all' }));
}

export function featureBatchMatrix({ event, extraTests = [] } = {}) {
  const counts = resolvedShardCounts({ extraTests });
  if (event === 'pull_request') {
    return { include: [...linuxRows(counts.pullRequestLinux, 'all'), { os: 'windows-latest', shard: '1/1', label: 'touched', scope: 'touched' }] };
  }
  return { include: [...shardRows('ubuntu-latest', counts.ubuntu), ...shardRows('windows-latest', counts.windows), ...shardRows('macos-latest', counts.macos)] };
}

// Fail closed: an empty matrix, or fewer shards than the floors, would skip the feature tests.
export function validateFeatureBatchMatrix(matrix, event) {
  const include = Array.isArray(matrix?.include) ? matrix.include : [];
  if (include.length === 0) throw new Error('feature-batch matrix is empty; the feature tests would be skipped');
  const count = (os) => include.filter((row) => row.os === os).length;
  const floors = event === 'pull_request'
    ? [['ubuntu-latest', pullRequestLinuxShardCount]]
    : [['ubuntu-latest', mainPushShardCounts.ubuntu], ['windows-latest', mainPushShardCounts.windows], ['macos-latest', mainPushShardCounts.macos]];
  for (const [os, floor] of floors) {
    if (count(os) < floor) throw new Error(`feature-batch matrix has ${count(os)} ${os} shard(s), below the floor of ${floor}`);
  }
  return matrix;
}

function argValue(name, argv) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const event = process.argv[2] ?? '';
  const namedDir = argValue('--named-dir', process.argv);
  if (namedDir) setNamedListDir(namedDir);
  const matrix = validateFeatureBatchMatrix(featureBatchMatrix({ event }), event);
  process.stdout.write(`matrix=${JSON.stringify(matrix)}\n`);
}

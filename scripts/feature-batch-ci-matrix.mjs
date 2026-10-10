#!/usr/bin/env node
// Builds the feature-batch job matrix from the shard planner, so shard counts follow the test weights.
// Usage: node scripts/feature-batch-ci-matrix.mjs <event-name>   prints one line: matrix={"include":[...]}
// The workflow writes that line to $GITHUB_OUTPUT. Nothing about shard counts is hand-written in YAML.
import { fileURLToPath } from 'node:url';
import { resolvedShardCounts } from './feature-batch-ci-targets.mjs';

function linuxRows(count, scope) {
  return Array.from({ length: count }, (_, i) => ({ os: 'ubuntu-latest', shard: `${i + 1}/${count}`, label: `${i + 1}/${count}`, scope }));
}

function shardRows(os, count) {
  return Array.from({ length: count }, (_, i) => ({ os, shard: `${i + 1}/${count}`, label: `${i + 1}/${count}`, scope: 'all' }));
}

// Pull requests: Linux runs the full named suite in shards, and Windows runs only the touched named tests.
// Main and nightly: the full suite on Linux, Windows and macOS.
export function featureBatchMatrix({ event, extraTests = [] } = {}) {
  const counts = resolvedShardCounts({ extraTests });
  if (event === 'pull_request') {
    return { include: [...linuxRows(counts.pullRequestLinux, 'all'), { os: 'windows-latest', shard: '1/1', label: 'touched', scope: 'touched' }] };
  }
  return { include: [...shardRows('ubuntu-latest', counts.ubuntu), ...shardRows('windows-latest', counts.windows), ...shardRows('macos-latest', counts.macos)] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const event = process.argv[2] ?? '';
  process.stdout.write(`matrix=${JSON.stringify(featureBatchMatrix({ event }))}\n`);
}

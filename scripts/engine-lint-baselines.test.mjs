import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { postMergeEngineRunTargets } from './changed-test-coverage.mjs';

const WORKFLOW_URL = new URL('../.github/workflows/engine-lint-baselines.yml', import.meta.url);
const workflow = readFileSync(WORKFLOW_URL, 'utf8');
const RUN_LINE = 'run: node scripts/run-vitest.mjs run test/scripts/control-ui-i18n.generated.test.ts';

// The repo root has no package.json, so no YAML parser: slice the text by indentation instead.
function jobs(text) {
  const lines = text.split('\n');
  const start = lines.indexOf('jobs:');
  assert.notEqual(start, -1, 'workflow has a jobs: block');
  const found = new Map();
  let name = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = /^  ([\w-]+):$/.exec(line);
    if (match) {
      name = match[1];
      found.set(name, []);
    } else if (name) {
      found.get(name).push(line);
    }
  }
  return new Map([...found].map(([key, body]) => [key, body.join('\n')]));
}

function job(name) {
  const body = jobs(workflow).get(name);
  assert.ok(body, `job ${name} exists`);
  return body;
}

function steps(body) {
  return body.split(/^(?=      - )/m).filter((step) => step.startsWith('      - '));
}

function hasLine(text, line) {
  return text.split('\n').some((candidate) => candidate.trim() === line);
}

function pullRequestPaths(text) {
  const match = /^  pull_request:\n    paths:\n((?:      - .*\n)+)/m.exec(text);
  assert.ok(match, 'pull_request has a paths list');
  return match[1].split('\n').filter(Boolean).map((line) => line.replace(/^      - /, '').trim());
}

test('a. generated-baseline-pr runs only on pull requests and stays read-only', () => {
  const body = job('generated-baseline-pr');
  assert.ok(hasLine(body, "if: github.event_name == 'pull_request'"), 'pull_request-only if');
  assert.ok(hasLine(body, 'contents: read'), 'contents: read');
  assert.doesNotMatch(body, /contents:\s*write/);
  assert.doesNotMatch(body, /GH_TOKEN/);
  assert.doesNotMatch(body, /git push/);
  assert.doesNotMatch(body, /persist-credentials:\s*true/);
});

test('b. generated-baseline-pr runs the generated test from engine with id generated', () => {
  const step = steps(job('generated-baseline-pr')).find((candidate) => hasLine(candidate, RUN_LINE));
  assert.ok(step, 'a step has the exact generated test run line');
  assert.ok(hasLine(step, 'working-directory: engine'), 'step runs in engine');
  assert.ok(hasLine(step, 'id: generated'), 'step has id generated');
});

test('c. the after-merge generated-baseline job is unchanged in its trigger, check and refresh', () => {
  const body = job('generated-baseline');
  assert.ok(hasLine(body, "if: github.event_name == 'push' && github.ref == 'refs/heads/main'"), 'main push-only if');
  assert.ok(hasLine(body, RUN_LINE), 'same generated test run line');
  assert.ok(hasLine(body, '- name: Regenerate catalog-fallbacks.json after drift'), 'refresh step still present');
});

test('d. pull_request paths cover engine and this test', () => {
  const paths = pullRequestPaths(workflow);
  assert.ok(paths.includes("'engine/**'"), 'engine/** path');
  assert.ok(paths.includes("'scripts/engine-lint-baselines.test.mjs'"), 'test path');
});

test('e. changed-test-coverage still sees exactly one post-merge engine target', () => {
  assert.deepEqual(
    [...postMergeEngineRunTargets(readFileSync('.github/workflows/engine-lint-baselines.yml', 'utf8'))],
    ['engine/test/scripts/control-ui-i18n.generated.test.ts'],
  );
});

test('f. generated-baseline-pr runs this wiring test itself', () => {
  const step = steps(job('generated-baseline-pr')).find((candidate) =>
    hasLine(candidate, '- name: Check catalog-fallbacks workflow wiring'));
  assert.ok(step, 'wiring step exists');
  assert.ok(hasLine(step, 'run: node --test scripts/engine-lint-baselines.test.mjs'), 'wiring step runs this test');
});

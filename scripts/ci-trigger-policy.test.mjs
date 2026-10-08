import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workflowsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.github/workflows');
const draftSkip = "github.event_name != 'pull_request' || github.event.pull_request.draft == false";

function workflowFiles() {
  return readdirSync(workflowsDir).filter((name) => name.endsWith('.yml')).sort();
}

function readWorkflow(name) {
  return readFileSync(path.join(workflowsDir, name), 'utf8');
}

function blockAt(content, header, indent) {
  const lines = content.split(/\r?\n/);
  const prefix = `${' '.repeat(indent)}${header}:`;
  const start = lines.findIndex((line) => line === prefix || line.startsWith(`${prefix} `));
  if (start < 0) return '';
  const collected = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length === 0) continue;
    const currentIndent = line.match(/^ */)[0].length;
    if (currentIndent <= indent && line.trim() !== '') break;
    collected.push(line);
  }
  return collected.join('\n');
}

function pullRequestTypes(content) {
  const pullRequest = blockAt(content, 'pull_request', 2);
  const inline = pullRequest.match(/^ {4}types:\s*\[([^\]]*)\]/m);
  if (inline) return inline[1].split(',').map((type) => type.trim()).filter(Boolean);
  return [...pullRequest.matchAll(/^ {6}- ([A-Za-z_]+)\s*$/gm)].map((match) => match[1]);
}

function hasPullRequestTrigger(content) {
  return blockAt(content, 'on', 0).split('\n').some((line) => /^ {2}pull_request:/.test(line));
}

function jobs(content) {
  const section = blockAt(content, 'jobs', 0);
  const lines = section.split('\n');
  const defined = [];
  let current = null;
  for (const line of lines) {
    const header = /^ {2}([A-Za-z0-9_-]+):$/.exec(line);
    if (header) {
      if (current) defined.push(current);
      current = { name: header[1], body: [] };
      continue;
    }
    current?.body.push(line);
  }
  if (current) defined.push(current);
  return defined.map((job) => ({
    name: job.name,
    if: job.body.join('\n').match(/^ {4}if:\s*(.+)\s*$/m)?.[1] ?? '',
  }));
}

function checkWorkflows() {
  return workflowFiles().filter((name) => name !== 'merge-gate.yml' && hasPullRequestTrigger(readWorkflow(name)));
}

const requiredPullRequestTypes = ['ready_for_review', 'converted_to_draft'];

test('PR-triggered check workflows list ready_for_review and converted_to_draft and skip every job on drafts', () => {
  const names = checkWorkflows();
  assert.ok(names.length > 0, 'expected at least one PR-triggered check workflow');
  for (const name of names) {
    const content = readWorkflow(name);
    const types = pullRequestTypes(content);
    for (const required of requiredPullRequestTypes) {
      assert.ok(types.includes(required),
        `${name} pull_request types must include ${required}`);
    }
    const defined = jobs(content);
    assert.ok(defined.length > 0, `${name} must define jobs`);
    for (const job of defined) {
      assert.ok(job.if.includes(draftSkip),
        `${name} job ${job.name} must skip drafts with ${draftSkip}`);
    }
  }
});

test('merge-gate lists edited so body updates retrigger without cancelling the wait', () => {
  const types = pullRequestTypes(readWorkflow('merge-gate.yml'));
  assert.ok(types.includes('edited'),
    'merge-gate pull_request types must include edited');
});

test("component-release concurrency never cancels pushes", () => {
  const concurrency = blockAt(readWorkflow('component-release.yml'), 'concurrency', 0);
  assert.match(concurrency, /cancel-in-progress:\s*\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*\}\}/);
  assert.doesNotMatch(concurrency, /github\.event_name\s*==\s*'push'/);
});

test('PR check workflows key concurrency by head SHA and do not cancel synchronize', () => {
  for (const name of checkWorkflows()) {
    if (name === 'component-release.yml' || name === 'gate-files-fresh.yml') continue;
    const concurrency = blockAt(readWorkflow(name), 'concurrency', 0);
    assert.ok(
      concurrency.includes('github.event.pull_request.head.sha'),
      `${name} concurrency group must include the PR head SHA`,
    );
    assert.doesNotMatch(
      concurrency,
      /cancel-in-progress:\s*true\s*$/m,
      `${name} must not cancel every in-progress PR run`,
    );
    assert.doesNotMatch(
      concurrency,
      /cancel-in-progress:\s*\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*\}\}/,
      `${name} must not cancel all pull_request events`,
    );
  }
});

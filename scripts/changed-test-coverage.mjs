import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { capabilityTests, harvestTests, namedE2eTests, namedTests } from './feature-batch-ci-targets.mjs';
import { slices, windowSlices } from './feature-slice-ci-targets.mjs';
import { priorityMemoryIntegration, priorityTests } from './priority-capabilities-ci-targets.mjs';
import { pickUnlistedTests, EXCLUDED } from '../desktop/scripts/run-unlisted-tests.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testFile = /^(engine|window|desktop)\/.+\.test\.(?:ts|tsx|mjs|mts)$/;

const FALSE_IF = /^\s+(?:-\s+)?if:\s*(?:false|'false'|"false"|\$\{\{\s*false\s*\}\})\s*$/;

function stepHasFalseIf(lines, runIndex) {
  let start = runIndex;
  while (start > 0 && !/^\s+-\s/.test(lines[start])) start -= 1;
  for (let i = start; i <= runIndex; i += 1) {
    if (FALSE_IF.test(lines[i])) return true;
  }
  return false;
}

// The desktop job uses explicit node --test arguments, not test discovery. A token only counts
// when it belongs to an actual run line; mentions in comments, `if: false` steps, or unrelated
// jobs do not count.
export function desktopRunTargets(workflow) {
  if (/^jobs:/m.test(workflow)) return workflowRunTargets(workflow);
  const targets = new Set();
  const lines = String(workflow).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const command = /^\s*(?:-\s*)?run:\s*(node\b.*\s--test\s+.*)$/.exec(lines[i])?.[1];
    if (!command || stepHasFalseIf(lines, i)) continue;
    for (const token of command.matchAll(/(?:^|\s)((?:desktop\/)?[\w./*?-]+\.test\.(?:ts|tsx|mjs|mts))(?=\s|$)/g)) {
      targets.add(token[1].startsWith('desktop/') ? token[1] : `desktop/${token[1]}`);
    }
  }
  return targets;
}

export function workflowHasPullRequestTrigger(workflow) {
  const text = String(workflow ?? '');
  if (/^on:\s*(?:\[(?:[^\]]*?)pull_request|pull_request(?:\s|:|\[|$))/m.test(text)) return true;
  return /^on:\s*$/m.test(text) && /^\s+pull_request\s*:/m.test(text);
}

export function hasYamlAnchorsOrAliases(workflow) {
  const stripped = String(workflow ?? '').replace(/(^|[ \t])#.*$/gm, '$1');
  return /(?:^|[\s,{:[|-])[&*][A-Za-z_][\w-]*|[ \t]<<:[ \t]*\*/.test(stripped);
}

const PLAIN_TEST_PATH = /^(?:[\w.-]+\/)*[\w.-]+\.test\.(?:ts|tsx|mjs|mts)$/;
const ALLOWED_RUN = /^node --test(?: [\w./-]+\.test\.(?:ts|tsx|mjs|mts))+$/;

export function isPlainDesktopTestPath(token) {
  return typeof token === 'string' && !token.includes('..') && PLAIN_TEST_PATH.test(token);
}

export function isAllowlistedDesktopRun(command) {
  const value = String(command ?? '').trim();
  if (!ALLOWED_RUN.test(value)) return false;
  return value.slice('node --test '.length).split(/\s+/).every(isPlainDesktopTestPath);
}

function parseNeedsValue(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (/^\[.*\]$/.test(value)) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    const ids = inner.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, ''));
    return ids.every((id) => /^[A-Za-z_][\w-]*$/.test(id)) ? ids : null;
  }
  const id = value.replace(/^['"]|['"]$/g, '');
  return /^[A-Za-z_][\w-]*$/.test(id) ? [id] : null;
}

const STEP_DISALLOWED_KEY = /^(?:if|continue-on-error|shell|working-directory):/;

function tokenizeFlow(text) {
  const tokens = [];
  const source = String(text);
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if ('{}[],:'.includes(char)) {
      tokens.push(char);
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      index += 1;
      let value = '';
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\' && index + 1 < source.length) {
          value += source[index + 1];
          index += 2;
          continue;
        }
        value += source[index];
        index += 1;
      }
      if (index >= source.length) return null;
      tokens.push(value);
      index += 1;
      continue;
    }
    const start = index;
    while (index < source.length && !/[\s{}[\],:]/.test(source[index])) index += 1;
    tokens.push(source.slice(start, index));
  }
  return tokens;
}

function parseFlowTokens(tokens) {
  if (!tokens) return null;
  let index = 0;
  const parse = () => {
    const token = tokens[index];
    if (token === '{') {
      index += 1;
      const map = {};
      if (tokens[index] === '}') {
        index += 1;
        return { kind: 'map', map };
      }
      while (index < tokens.length) {
        const key = tokens[index];
        if (typeof key !== 'string' || '{}[],:'.includes(key)) return null;
        index += 1;
        if (tokens[index] !== ':') return null;
        index += 1;
        const value = parse();
        if (value == null) return null;
        map[key] = value;
        if (tokens[index] === ',') {
          index += 1;
          continue;
        }
        if (tokens[index] === '}') {
          index += 1;
          return { kind: 'map', map };
        }
        return null;
      }
      return null;
    }
    if (token === '[') {
      index += 1;
      while (index < tokens.length && tokens[index] !== ']') {
        if (parse() == null) return null;
        if (tokens[index] === ',') index += 1;
      }
      if (tokens[index] !== ']') return null;
      index += 1;
      return { kind: 'seq' };
    }
    if (token == null || '{}[],:'.includes(token)) return null;
    index += 1;
    return { kind: 'scalar', value: token };
  };
  const value = parse();
  if (value == null || index !== tokens.length) return null;
  return value;
}

function parseFlowValue(text) {
  return parseFlowTokens(tokenizeFlow(text));
}

function parseBlockMapping(lines, indent) {
  const map = {};
  const prefix = ' '.repeat(indent);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '' || /^\s*#/.test(line)) {
      index += 1;
      continue;
    }
    if (!line.startsWith(prefix)) return line.startsWith(' ') ? null : map;
    if (line[indent] === ' ') return null;
    const match = new RegExp(`^${prefix}([A-Za-z_][\\w-]*)\\s*:(.*)$`).exec(line);
    if (!match) return null;
    const rest = match[2].trim();
    index += 1;
    if (rest && rest !== '|' && rest !== '>') {
      const value = parseFlowValue(rest);
      if (value == null) return null;
      map[match[1]] = value;
      continue;
    }
    const nested = [];
    while (index < lines.length) {
      const next = lines[index];
      if (next.trim() === '' || /^\s*#/.test(next) || next.startsWith(' '.repeat(indent + 1))) {
        nested.push(next);
        index += 1;
        continue;
      }
      break;
    }
    if (rest === '|' || rest === '>') {
      map[match[1]] = { kind: 'scalar', value: nested.join('\n') };
      continue;
    }
    const child = parseBlockMapping(nested, indent + 2);
    if (child == null) return null;
    map[match[1]] = { kind: 'map', map: child };
  }
  return map;
}

function topLevelEntries(workflow) {
  const lines = String(workflow).split(/\r?\n/);
  const entries = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '' || /^\s*#/.test(line)) {
      index += 1;
      continue;
    }
    const match = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line);
    if (!match) return null;
    index += 1;
    const body = [];
    while (index < lines.length) {
      const next = lines[index];
      if (next.trim() === '' || /^\s*#/.test(next) || /^\s/.test(next)) {
        body.push(next);
        index += 1;
        continue;
      }
      break;
    }
    entries.push({ key: match[1], rest: match[2], body });
  }
  return entries;
}

function runMappingHasShell(defaultsMap) {
  if (!Object.hasOwn(defaultsMap, 'run')) return false;
  const run = defaultsMap.run;
  if (!run || run.kind !== 'map') return true;
  return Object.hasOwn(run.map, 'shell');
}

function defaultsMappingHasRunShell(rest, body) {
  const inline = String(rest ?? '').trim();
  if (inline && inline !== '|' && inline !== '>') {
    const parsed = parseFlowValue(inline);
    if (parsed == null || parsed.kind !== 'map') return true;
    return runMappingHasShell(parsed.map);
  }
  const parsed = parseBlockMapping(body, 2);
  if (parsed == null) return true;
  return runMappingHasShell(parsed);
}

function hasTopLevelComplexOrMergeKey(workflow) {
  const stripped = String(workflow ?? '').replace(/(^|[ \t])#.*$/gm, '$1');
  return /^(?:\?[ \t]|<<:)/m.test(stripped);
}

export function workflowDefaultsSetShell(workflow) {
  const text = String(workflow ?? '');
  if (hasTopLevelComplexOrMergeKey(text)) return true;
  const entries = topLevelEntries(text);
  if (entries == null) return true;
  return entries.some((entry) =>
    entry.key === 'defaults' && defaultsMappingHasRunShell(entry.rest, entry.body));
}

function emptyJob(id) {
  return {
    id,
    hasIf: false,
    hasMatrixIncludeOrExclude: false,
    hasContinueOnError: false,
    hasShellDefault: false,
    needs: [],
    needsUnparseable: false,
    steps: [],
  };
}

function collectWorkflowJobs(workflow) {
  const jobs = new Map();
  const lines = String(workflow).split(/\r?\n/);
  let index = 0;
  while (index < lines.length && !/^jobs:\s*$/.test(lines[index])) index += 1;
  if (index >= lines.length) return jobs;
  index += 1;

  let current = null;
  let mode = 'job';
  let step = null;

  const finishStep = () => {
    if (current && step) current.steps.push(step);
    step = null;
  };
  const finishJob = () => {
    finishStep();
    if (current) jobs.set(current.id, current);
    current = null;
    mode = 'job';
  };
  const markStepDisallowed = (line) => {
    const key = line.trim().replace(/^- /, '');
    if (STEP_DISALLOWED_KEY.test(key)) step.disallowed = true;
  };

  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) {
      finishJob();
      break;
    }

    const jobMatch = /^  ([A-Za-z_][\w-]*):\s*$/.exec(line);
    if (jobMatch) {
      finishJob();
      current = emptyJob(jobMatch[1]);
      mode = 'job';
      continue;
    }
    if (!current) continue;

    if (mode === 'needs-list') {
      const item = /^      -\s+(\S+)/.exec(line);
      if (item) {
        const id = item[1].replace(/^['"]|['"]$/g, '');
        if (/^[A-Za-z_][\w-]*$/.test(id)) current.needs.push(id);
        else current.needsUnparseable = true;
        continue;
      }
      mode = 'job';
    }

    if (mode === 'strategy') {
      if (/^\s+(exclude|include):/.test(line)) {
        current.hasMatrixIncludeOrExclude = true;
        continue;
      }
      if (/^    [A-Za-z_][\w-]*:/.test(line)) mode = 'job';
      else continue;
    }

    if (mode === 'defaults') {
      if (/^      run:\s*$/.test(line)) {
        mode = 'defaults-run';
        continue;
      }
      if (/^    [A-Za-z_][\w-]*:/.test(line)) mode = 'job';
      else continue;
    }

    if (mode === 'defaults-run') {
      if (/^        shell:/.test(line)) {
        current.hasShellDefault = true;
        continue;
      }
      if (/^        working-directory:/.test(line)) continue;
      if (/^    [A-Za-z_][\w-]*:/.test(line)) mode = 'job';
      else if (/^      [A-Za-z_]/.test(line)) mode = 'defaults';
      else continue;
    }

    if (mode === 'steps' || /^    steps:\s*$/.test(line)) {
      if (/^    steps:\s*$/.test(line)) {
        mode = 'steps';
        continue;
      }
      if (/^      - /.test(line)) {
        finishStep();
        step = { disallowed: false, run: null };
        markStepDisallowed(line);
        const runSame = /^      - run:\s*(.*)$/.exec(line);
        if (runSame) step.run = runSame[1];
        continue;
      }
      if (step) {
        markStepDisallowed(line);
        const runIndented = /^        run:\s*(.*)$/.exec(line);
        if (runIndented) {
          step.run = runIndented[1];
          continue;
        }
        if (/^        /.test(line)) continue;
      }
      if (/^    [A-Za-z_][\w-]*:/.test(line)) {
        finishStep();
        mode = 'job';
      } else {
        continue;
      }
    }

    if (/^    if:/.test(line)) {
      current.hasIf = true;
      continue;
    }
    if (/^    continue-on-error:/.test(line)) {
      current.hasContinueOnError = true;
      continue;
    }
    if (/^    defaults:\s*$/.test(line)) {
      mode = 'defaults';
      continue;
    }
    if (/^    defaults:\s+\S/.test(line)) {
      current.hasShellDefault = /shell:/.test(line);
      continue;
    }
    const needs = /^    needs:\s*(.*)$/.exec(line);
    if (needs) {
      const rest = needs[1].trim();
      if (!rest || rest === '|' || rest === '>') {
        mode = 'needs-list';
        continue;
      }
      const parsed = parseNeedsValue(rest);
      if (parsed == null) current.needsUnparseable = true;
      else current.needs.push(...parsed);
      continue;
    }
    if (/^    strategy:\s*$/.test(line)) {
      mode = 'strategy';
      continue;
    }
    if (/^    steps:\s*$/.test(line)) {
      mode = 'steps';
    }
  }
  finishJob();
  return jobs;
}

function jobSelfDisqualified(job) {
  return !job
    || job.hasIf
    || job.hasMatrixIncludeOrExclude
    || job.hasContinueOnError
    || job.hasShellDefault
    || job.needsUnparseable;
}

export function jobDisqualifiedByNeeds(job, jobs, visiting = new Set()) {
  if (!job) return true;
  if (visiting.has(job.id)) return true;
  if (jobSelfDisqualified(job)) return true;
  visiting.add(job.id);
  for (const id of job.needs) {
    if (jobDisqualifiedByNeeds(jobs.get(id), jobs, visiting)) {
      visiting.delete(job.id);
      return true;
    }
  }
  visiting.delete(job.id);
  return false;
}

export function allowlistedDesktopRunTargets(workflow) {
  const targets = new Set();
  if (!workflowHasPullRequestTrigger(workflow) || hasYamlAnchorsOrAliases(workflow)) return targets;
  if (workflowDefaultsSetShell(workflow)) return targets;
  const jobs = collectWorkflowJobs(workflow);
  for (const job of jobs.values()) {
    if (jobDisqualifiedByNeeds(job, jobs)) continue;
    for (const step of job.steps) {
      if (step.disallowed || !isAllowlistedDesktopRun(step.run)) continue;
      for (const token of step.run.trim().slice('node --test '.length).split(/\s+/)) {
        if (!isPlainDesktopTestPath(token)) continue;
        targets.add(token.startsWith('desktop/') ? token : `desktop/${token}`);
      }
    }
  }
  return targets;
}

export function pullRequestDesktopRunTargets(workflow) {
  if (!workflowHasPullRequestTrigger(workflow)) return new Set();
  return desktopRunTargets(workflow);
}

// The real-engine handoff suite is deliberately split by named case on each OS. Registering
// its whole file in a named feature batch would exceed the 15-minute Windows job cap.
export function handoffRunTargets(workflow, config) {
  const targets = new Set();
  if (!/^\s*run:\s*node scripts\/run-vitest\.mjs run --config test\/vitest\/vitest\.desktop-handoff\.config\.ts -t /m.test(workflow)) {
    return targets;
  }
  for (const match of config.matchAll(/include:\s*\["(test\/.+?\.test\.ts)"\]/g)) {
    targets.add(`engine/${match[1]}`);
  }
  return targets;
}

// Engine tests that run only after merge (push to main), named on an executable run line of
// engine-lint-baselines.yml. They still run in CI, just not on pull requests.
export function postMergeEngineRunTargets(workflow) {
  const targets = new Set();
  for (const match of String(workflow ?? '').matchAll(/^\s*run:\s*node scripts\/run-vitest\.mjs run (test\/[\w./-]+\.test\.ts)\s*$/gm)) {
    targets.add(`engine/${match[1]}`);
  }
  return targets;
}

export function changedTestPaths(nameStatus) {
  return nameStatus.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [status, ...paths] = line.split('\t');
    if (!/^[AM]/.test(status)) return []; // deleted files cannot run
    const file = paths.at(-1);
    return testFile.test(file) ? [file] : [];
  });
}

export function uncoveredTests(changed, covered) {
  return [...new Set(changed)].filter((file) => ![...covered].some((target) =>
    target === file || (target.includes('*') && path.matchesGlob(file, target)))).sort();
}

// namedFor reads one lane's named feature tests; tests inject their own list so they do not depend on the repo's lists.
export function coverageTargets(
  desktopWorkflow,
  handoffWorkflow = '',
  handoffConfig = '',
  lintBaselinesWorkflow = '',
  { namedFor = namedTests, namedE2eFor = namedE2eTests } = {},
) {
  const covered = pullRequestDesktopRunTargets(desktopWorkflow);
  for (const file of handoffRunTargets(handoffWorkflow, handoffConfig)) covered.add(file);
  for (const file of postMergeEngineRunTargets(lintBaselinesWorkflow)) covered.add(file);
  for (const lane of ['engine', 'window']) {
    for (const file of [...namedFor(lane), ...namedE2eFor(lane), ...harvestTests(lane)]) covered.add(`${lane}/${file}`);
  }
  for (const file of capabilityTests()) covered.add(`engine/${file}`);
  for (const slice of slices) {
    for (const file of [...slice.native, ...slice.vitest]) covered.add(`engine/${file}`);
    for (const followup of slice.followups ?? []) {
      for (const file of [...(followup.native ?? []), ...(followup.vitest ?? [])]) covered.add(`engine/${file}`);
    }
  }
  for (const slice of windowSlices) {
    for (const file of [...slice.native, ...slice.vitest]) covered.add(`window/${file}`);
  }
  for (const file of [...priorityTests, priorityMemoryIntegration]) covered.add(`engine/${file}`);
  return covered;
}

// The desktop runner for tests no workflow step names. It may not exist yet; without it nothing changes.
export const UNLISTED_RUNNER = 'desktop/scripts/run-unlisted-tests.mjs';

// Loads the runner from the given repo root only when its file is there. Returns null otherwise.
export async function loadUnlistedRunner(repoRoot = root) {
  const file = path.join(repoRoot, UNLISTED_RUNNER);
  if (!existsSync(file)) return null;
  const runner = await import(pathToFileURL(file).href);
  if (typeof runner.pickUnlistedTests !== 'function') return null;
  return { pickUnlistedTests: runner.pickUnlistedTests, EXCLUDED: Array.isArray(runner.EXCLUDED) ? runner.EXCLUDED : [] };
}

// Changed desktop tests the runner would run, as repo paths. The runner reads files from disk, so it is asked
// about a scratch copy of the changed desktop tests and the workflow text; the checkout itself is never read.
// Files in EXCLUDED never count.
export function unlistedDesktopTargets(runner, changed, desktopWorkflow) {
  const targets = new Set();
  if (!runner || desktopWorkflow == null) return targets;
  const files = [...new Set(changed)].filter((file) => file.startsWith('desktop/') && !file.split('/').includes('..'));
  if (files.length === 0) return targets;
  const excluded = new Set(runner.EXCLUDED.map((entry) => (Array.isArray(entry) ? entry[0] : entry)));
  const scratch = mkdtempSync(path.join(tmpdir(), 'unlisted-tests-'));
  try {
    const desktopDir = path.join(scratch, 'desktop');
    for (const file of files) {
      const target = path.join(scratch, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, '');
    }
    const workflowPath = path.join(scratch, '.github/workflows/desktop-checks.yml');
    mkdirSync(path.dirname(workflowPath), { recursive: true });
    writeFileSync(workflowPath, String(desktopWorkflow));
    for (const file of runner.pickUnlistedTests({ desktopDir, workflowPath })) {
      if (excluded.has(file)) continue;
      const repoPath = `desktop/${file}`;
      if (files.includes(repoPath)) targets.add(repoPath);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return targets;
}

export function additionFor(file) {
  const [lane, ...parts] = file.split('/');
  if (lane === 'desktop') {
    return `run: node --test ${parts.join('/')}` + '  (.github/workflows/desktop-checks.yml, a new step after the desktop build)';
  }
  return `${lane}:${parts.join('/')}` + '  (scripts/feature-batch-ci-named/<branch-name>.txt)';
}

export const ALL_TEST_FILE = /\.(?:test|spec|node-test|native-tests)\.[^/.]+$/;
export const BASELINE_DIR = 'scripts/ci-uncovered-baseline';
export const LOCAL_ONLY_FILE = 'scripts/ci-local-only-tests.txt';

function gitText(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

function readOptional(cwd, file) {
  const absolute = path.join(cwd, file);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : '';
}

function textFiles(cwd, dir, suffix) {
  const absolute = path.join(cwd, dir);
  return existsSync(absolute) ? readdirSync(absolute).filter(file => suffix.test(file)).sort().map(file => `${dir}/${file}`) : [];
}

export function inventoryLines(text) {
  return String(text).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))
    .map(line => line.replace(/^([^/:]+):/, '$1/'));
}

// Read only executable run blocks, not comments or path filters. Resolve workflow/job defaults
// and step overrides before inspecting commands (notably desktop-checks' root-cwd steps).
export function workflowRunTargets(workflow) {
  const targets = new Set();
  const lines = String(workflow).split(/\r?\n/);
  const unquote = value => value.trim().replace(/^['"]|['"]$/g, '');
  const directory = value => unquote(value).replace(/^\$\{\{\s*github\.workspace\s*\}\}\/?/, '');
  let workflowDir = '', jobDir = '', jobDisabled = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^  [\w-]+:\s*$/.test(line) && lines.slice(0, i).some(item => /^jobs:/.test(item))) {
      jobDir = workflowDir;
      jobDisabled = false;
    }
    if (/^    if:/.test(line) && FALSE_IF.test(line)) jobDisabled = true;
    const defaults = /^(\s*)working-directory:\s*(.+)$/.exec(line);
    if (defaults && defaults[1].length <= 4) workflowDir = directory(defaults[2]);
    if (defaults && defaults[1].length === 8 && !/^      - /m.test(lines.slice(Math.max(0, i - 2), i).join('\n'))) {
      // Job defaults occur before steps. Step overrides are handled in the block below.
      jobDir = directory(defaults[2]);
    }
    if (!/^      - /.test(line)) continue;
    let end = i + 1;
    while (end < lines.length && !/^      - |^    \S|^  \S|^\S/.test(lines[end])) end++;
    const block = lines.slice(i, end);
    if (jobDisabled || block.some(item => FALSE_IF.test(item))) { i = end - 1; continue; }
    const override = block.map(item => /^\s+(?:- )?working-directory:\s*(.+)$/.exec(item)?.[1]).find(value => value != null);
    let cwd = override == null ? jobDir : directory(override);
    for (let j = 0; j < block.length; j++) {
      const run = /^\s+(?:- )?run:\s*(.*)$/.exec(block[j]);
      if (!run) continue;
      const commands = /^[|>][-+]?\s*$/.test(run[1]) ? block.slice(j + 1).filter(item => /^          /.test(item)) : [run[1]];
      for (let command of commands) {
        command = command.trim();
        if (command.startsWith('#')) continue;
        const cd = /^cd\s+([\w./-]+)(?:\s*&&\s*|\s*$)/.exec(command);
        if (cd) { cwd = path.posix.normalize(path.posix.join(cwd, cd[1])); command = command.slice(cd[0].length); }
        if (!/^(?:node\b.*?\s--test\b|(?:pnpm(?: exec)? |npx )?vitest\s+run\b|node scripts\/run-vitest\.mjs run\b)/.test(command)) continue;
        for (const match of command.matchAll(/(?:^|\s)['"]?([\w./*?-]+\.(?:test|spec|node-test|native-tests)\.[\w]+)['"]?(?=\s|$)/g)) {
          if (cwd.includes('${{')) continue; // Dynamic directories cannot prove a static target.
          targets.add(path.posix.normalize(path.posix.join(cwd, match[1])));
        }
      }
      break;
    }
    i = end - 1;
  }
  return targets;
}

export function evaluateTestInventory({ files, covered, baseline = [], localOnly = [], baseBaseline = null,
  baseLocalOnly = null, reviewed = false, missingEntries = [], inactiveEntries = [] }) {
  const errors = [], warnings = [];
  const present = new Set(files), debt = new Set(baseline), local = new Set(localOnly);
  const globs = [...covered].filter(file => file.includes('*'));
  const coveredFiles = new Set(files.filter(file => covered.has(file) || globs.some(glob => path.matchesGlob(file, glob))));
  const tests = files.filter(file => ALL_TEST_FILE.test(file) && !file.startsWith('mobile/') &&
    !file.startsWith('engine/.github/') && !file.startsWith('engine/test/fixtures/'));
  let localCount = 0;
  for (const file of tests) {
    if (coveredFiles.has(file)) continue;
    if (local.has(file) || /\.live\.test\.[^/]+$/.test(file)) { localCount++; continue; }
    if (!debt.has(file)) errors.push(`Uncovered test: ${file}. Add it to a CI selector.`);
  }
  for (const file of debt) {
    if (!present.has(file)) warnings.push(`Deleted baseline test: ${file}; delete that line.`);
    else if (coveredFiles.has(file)) errors.push(`Baseline test now covered: ${file}; delete that line.`);
  }
  for (const [kind, current, before] of [['baseline', debt, baseBaseline], ['local-only', local, baseLocalOnly]]) {
    if (before == null || reviewed) continue;
    const old = new Set(before);
    for (const file of current) if (!old.has(file)) errors.push(`New ${kind} entry: ${file}; requires gate-change-reviewed: <current head SHA>.`);
  }
  for (const file of missingEntries) errors.push(`CI selector names missing file: ${file}; delete that line.`);
  for (const file of inactiveEntries) warnings.push(`Inactive feature slice names missing file: ${file}`);
  return { errors, warnings, uncovered: tests.filter(file => !coveredFiles.has(file)), tests: tests.length, covered: tests.filter(file => coveredFiles.has(file)).length,
    baseline: debt.size, localOnly: localCount };
}

// Own resolution for the full-tree gate; deliberately independent of pr-preflight/feature-batch-ci.
export function checkAllTests({ cwd = root, base = null, body = '', head = '' } = {}) {
  const files = gitText(cwd, ['ls-files', '-z']).split('\0').filter(Boolean);
  const covered = new Set(), required = new Set(), inactive = new Set();
  const workflows = textFiles(cwd, '.github/workflows', /\.ya?ml$/);
  for (const file of workflows) for (const target of workflowRunTargets(readOptional(cwd, file))) covered.add(target);
  for (const dir of ['scripts/feature-batch-ci-named', 'scripts/feature-batch-ci-harvest']) {
    for (const list of textFiles(cwd, dir, /\.txt$/)) for (const file of inventoryLines(readOptional(cwd, list))) {
      covered.add(file); required.add(file);
    }
  }
  if (path.resolve(cwd) === root) {
    const desktopWorkflow = readOptional(cwd, '.github/workflows/desktop-checks.yml');
    if (/^\s*run:\s*node scripts\/run-unlisted-tests\.mjs\s*$/m.test(desktopWorkflow)) {
      for (const file of pickUnlistedTests({ desktopDir: path.join(cwd, 'desktop'),
        workflowPath: path.join(cwd, '.github/workflows/desktop-checks.yml'), excluded: EXCLUDED })) covered.add(`desktop/${file}`);
    }
    for (const file of coverageTargets(readOptional(cwd, '.github/workflows/desktop-checks.yml'),
      readOptional(cwd, '.github/workflows/engine-handoff-checks.yml'),
      readOptional(cwd, 'engine/test/vitest/vitest.desktop-handoff.config.ts'),
      readOptional(cwd, '.github/workflows/engine-lint-baselines.yml'))) covered.add(file);
    for (const lane of ['engine', 'window']) {
      for (const file of [...namedTests(lane), ...namedE2eTests(lane), ...harvestTests(lane)]) required.add(`${lane}/${file}`);
    }
    for (const [lane, items] of [['engine', slices], ['window', windowSlices]]) for (const slice of items) {
      const present = file => existsSync(path.join(cwd, lane, file));
      const active = (slice.markers ?? slice.native).some(present) || slice.productionAnchors.some(anchor => {
        if (typeof anchor === 'string') return present(anchor);
        return present(anchor.file) && createHash('sha256').update(readFileSync(path.join(cwd, lane, anchor.file))).digest('hex') !== anchor.baselineSha256;
      });
      for (const file of [...slice.native, ...slice.vitest]) (active ? required : inactive).add(`${lane}/${file}`);
      for (const followup of slice.followups ?? []) {
        const entries = [...(followup.native ?? []), ...(followup.vitest ?? [])];
        const registered = [...entries, ...(followup.strict ?? [])].some(present);
        for (const file of entries) (registered ? required : inactive).add(`${lane}/${file}`);
      }
    }
  }
  const baseline = textFiles(cwd, BASELINE_DIR, /\.txt$/).flatMap(file => inventoryLines(readOptional(cwd, file)));
  const localOnly = inventoryLines(readOptional(cwd, LOCAL_ONLY_FILE));
  let baseBaseline = null, baseLocalOnly = null;
  if (base) {
    const baseFiles = gitText(cwd, ['ls-tree', '-r', '--name-only', base, '--', BASELINE_DIR, LOCAL_ONLY_FILE]).trim().split('\n').filter(Boolean);
    baseBaseline = baseFiles.filter(file => file.startsWith(`${BASELINE_DIR}/`) && file.endsWith('.txt'))
      .flatMap(file => inventoryLines(gitText(cwd, ['show', `${base}:${file}`])));
    baseLocalOnly = baseFiles.includes(LOCAL_ONLY_FILE) ? inventoryLines(gitText(cwd, ['show', `${base}:${LOCAL_ONLY_FILE}`])) : [];
  }
  const reviewed = /^[a-f0-9]{40}$/.test(head) && String(body).split(/\r?\n/).includes(`gate-change-reviewed: ${head}`);
  const result = evaluateTestInventory({ files, covered, baseline, localOnly, baseBaseline, baseLocalOnly, reviewed,
    missingEntries: [...required].filter(file => !existsSync(path.join(cwd, file))),
    inactiveEntries: [...inactive].filter(file => !existsSync(path.join(cwd, file)) && !required.has(file)) });
  return { ...result, exitCode: result.errors.length ? 1 : 0, text: [...result.errors, ...result.warnings.map(line => `Warning: ${line}`),
    `Full-tree test coverage: ${result.tests} tests; ${result.covered} covered; ${result.baseline} baseline entries; ${result.localOnly} local-only uncovered; ${result.errors.length} error(s), ${result.warnings.length} warning(s).`].join('\n') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--all-tests')) {
    const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
    const pr = event.pull_request;
    const result = checkAllTests({ base: pr?.base?.sha ?? process.env.CHANGED_TEST_BASE ?? null,
      head: pr?.head?.sha ?? '', body: pr?.body ?? '' });
    console.log(result.text);
    if (result.exitCode) process.exitCode = result.exitCode;
  }
  const base = process.env.CHANGED_TEST_BASE || 'HEAD^1';
  const status = execFileSync('git', ['diff', '--name-status', '--no-renames', base, 'HEAD'],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  const changed = changedTestPaths(status);
  const workflow = readFileSync(path.join(root, '.github/workflows/desktop-checks.yml'), 'utf8');
  const handoffWorkflow = readFileSync(path.join(root, '.github/workflows/engine-handoff-checks.yml'), 'utf8');
  const handoffConfig = readFileSync(path.join(root, 'engine/test/vitest/vitest.desktop-handoff.config.ts'), 'utf8');
  const lintBaselinesWorkflow = readFileSync(path.join(root, '.github/workflows/engine-lint-baselines.yml'), 'utf8');
  const covered = coverageTargets(workflow, handoffWorkflow, handoffConfig, lintBaselinesWorkflow);
  for (const file of unlistedDesktopTargets(await loadUnlistedRunner(root), changed, workflow)) covered.add(file);
  const uncovered = uncoveredTests(changed, covered);
  if (uncovered.length) {
    for (const file of uncovered) console.error(`Uncovered changed test: ${file}\n  Add: ${additionFor(file)}`);
    process.exitCode = 1;
  } else {
    console.log(`Changed test coverage: ${changed.length} added/modified test file(s) covered.`);
  }
}

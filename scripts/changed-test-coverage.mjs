import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilityTests, harvestTests, namedTests } from './feature-batch-ci-targets.mjs';
import { slices, windowSlices } from './feature-slice-ci-targets.mjs';
import { priorityMemoryIntegration, priorityTests } from './priority-capabilities-ci-targets.mjs';

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

export function workflowDefaultsSetShell(workflow) {
  const lines = String(workflow).split(/\r?\n/);
  let inDefaults = false;
  let inRun = false;
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line) || (/^\S/.test(line) && inDefaults && !/^defaults:/.test(line))) break;
    if (/^defaults:\s*$/.test(line)) {
      inDefaults = true;
      inRun = false;
      continue;
    }
    if (!inDefaults) continue;
    if (/^  run:\s*$/.test(line)) {
      inRun = true;
      continue;
    }
    if (inRun && /^    shell:/.test(line)) return true;
    if (/^  [A-Za-z_]/.test(line) && !/^  run:/.test(line)) inRun = false;
  }
  return false;
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

export function coverageTargets(desktopWorkflow, handoffWorkflow = '', handoffConfig = '') {
  const covered = pullRequestDesktopRunTargets(desktopWorkflow);
  for (const file of handoffRunTargets(handoffWorkflow, handoffConfig)) covered.add(file);
  for (const lane of ['engine', 'window']) {
    for (const file of [...namedTests(lane), ...harvestTests(lane)]) covered.add(`${lane}/${file}`);
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

export function additionFor(file) {
  const [lane, ...parts] = file.split('/');
  if (lane === 'desktop') {
    return `run: node --test ${parts.join('/')}` + '  (.github/workflows/desktop-checks.yml, a new step after the desktop build)';
  }
  return `${lane}:${parts.join('/')}` + '  (scripts/feature-batch-ci-named/<branch-name>.txt)';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.env.CHANGED_TEST_BASE || 'HEAD^1';
  const status = execFileSync('git', ['diff', '--name-status', '--no-renames', base, 'HEAD'],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  const changed = changedTestPaths(status);
  const workflow = readFileSync(path.join(root, '.github/workflows/desktop-checks.yml'), 'utf8');
  const handoffWorkflow = readFileSync(path.join(root, '.github/workflows/engine-handoff-checks.yml'), 'utf8');
  const handoffConfig = readFileSync(path.join(root, 'engine/test/vitest/vitest.desktop-handoff.config.ts'), 'utf8');
  const uncovered = uncoveredTests(changed, coverageTargets(workflow, handoffWorkflow, handoffConfig));
  if (uncovered.length) {
    for (const file of uncovered) console.error(`Uncovered changed test: ${file}\n  Add: ${additionFor(file)}`);
    process.exitCode = 1;
  } else {
    console.log(`Changed test coverage: ${changed.length} added/modified test file(s) covered.`);
  }
}

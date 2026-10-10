import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SELF_CHECK_DOC = 'docs/SELF-CHECK.md';

export function isTrunkBranch(ref) {
  return typeof ref === 'string' && ref.startsWith('trunk/');
}

export function findSelfCheckBlock(body) {
  const lines = String(body ?? '').replace(/\r\n/g, '\n').split('\n');
  let start = -1;
  let inFence = false;
  let headerInFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*```/.test(lines[i])) inFence = !inFence;
    if (/^\s*(?:#{1,6}\s+SELF-CHECK|\*\*SELF-CHECK\*\*|SELF-CHECK)\s*$/.test(lines[i])) {
      start = i + 1;
      headerInFence = inFence;
    }
  }
  if (start < 0) return null;
  while (start < lines.length && !lines[start].trim()) start += 1;
  if (!headerInFence && /^\s*```[^`]*$/.test(lines[start] ?? '')) {
    start += 1;
    while (start < lines.length && !lines[start].trim()) start += 1;
  }
  const block = [];
  for (const line of lines.slice(start)) {
    if (!line.trim() || /^\s*```/.test(line) || /^\s*#{1,6}\s/.test(line)) break;
    block.push(line);
  }
  return block;
}

function entries(block) {
  let files = null;
  let tests = null;
  let testIndent = null;
  for (const line of block) {
    const file = line.match(/^\s*(?:[-*]\s+)?Files(?:\s*\((\d+)\))?:\s*(.*)$/);
    const test = line.match(/^\s*(?:[-*]\s+)?Tests[^:]*:\s*(.*)$/);
    if (file) files = { labelCount: file[1], value: file[2] };
    if (test) {
      tests = line;
      testIndent = line.match(/^\s*/)[0].length;
    } else if (testIndent !== null && line.match(/^\s*/)[0].length > testIndent) tests += `\n${line}`;
    else testIndent = null;
  }
  return { files, tests };
}

function counts(text, kind) {
  const word = kind === 'passed' ? 'pass(?:ed)?' : 'fail(?:ed)?';
  const pattern = new RegExp(`\\b(\\d+)\\s+${word}\\b|\\b${word}\\s*:?\\s+(\\d+)\\b`, 'gi');
  return [...text.matchAll(pattern)].map((match) => Number(match[1] ?? match[2]));
}

function placeholder(text) {
  return text.match(/<[^>\n]*>|yes\/no|pass\/fail|\b(?:TBD|TODO)\b/)?.[0];
}

export function checkSelfCheck({ headRef, body }) {
  if (!isTrunkBranch(headRef)) return { ok: true, skipped: true, problems: [] };
  const problems = [];
  const problem = (sentence) => problems.push(`${sentence} (${SELF_CHECK_DOC}).`);
  const block = findSelfCheckBlock(body);
  if (block === null) {
    return { ok: false, skipped: false, problems: [`The pull request description has no SELF-CHECK block. Edit the description and paste the Trunk's SELF-CHECK block (format: ${SELF_CHECK_DOC}).`] };
  }
  const { files, tests } = entries(block);
  if (!files) problem('The SELF-CHECK block has no Files line. Edit the description and add "Files: <count> (...)" from the Trunk\'s report');
  else {
    if (!files.labelCount && !/^\d+(?=\s|$)/.test(files.value)) problem('The Files line does not give a number of files. Edit the description and put the real count after "Files:"');
    const token = placeholder(files.value);
    if (token) problem(`The Files line still has a template placeholder ("${token}"). Edit the description and replace it with the real value`);
  }
  if (tests === null) problem('The SELF-CHECK block has no Tests line. Edit the description and add the test commands with their real counts, e.g. "-> 12 passed, 0 failed"');
  else {
    const passed = counts(tests, 'passed');
    const failed = counts(tests, 'failed');
    if (!passed.length) problem('The Tests line has no passed count. Edit the description and add the real number, e.g. "12 passed"');
    else if (passed.reduce((sum, count) => sum + count, 0) < 1) problem('The Tests line reports no tests passed. Edit the description and report at least one test passed');
    if (!failed.length) problem('The Tests line has no failed count. Edit the description and add it, e.g. "0 failed"');
    const token = placeholder(tests);
    if (token) problem(`The Tests line still has a template placeholder ("${token}"). Edit the description and replace it with the real commands and counts`);
    for (const part of tests.split(';')) {
      const failures = counts(part, 'failed').filter((count) => count > 0);
      if (failures.length && !/\bon base\b/i.test(part) && !/\bknown failure:\s*\S/i.test(part)) {
        problem(`The Tests line reports ${failures.reduce((sum, count) => sum + count, 0)} failed without saying why. Fix the tests and push, or mark that part "on base" (fail-on-base proof) or "known failure: <reason>" in the description`);
      }
    }
  }
  if (problems.length) return { ok: false, skipped: false, problems };
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  return { ok: true, skipped: false, problems, fileCount: Number(files.labelCount ?? files.value.match(/^\d+/)[0]), passed: sum(counts(tests, 'passed')), failed: sum(counts(tests, 'failed')) };
}

export function inputFromEvent(event) {
  return { headRef: event?.pull_request?.head?.ref ?? '', body: event?.pull_request?.body ?? '' };
}

export function formatSelfCheckSummary(result) {
  let lines = result.problems;
  if (result.skipped) lines = ['Not a trunk/ branch; nothing to check.'];
  else if (result.ok) lines = [`SELF-CHECK block found: Files ${result.fileCount}, Tests ${result.passed} passed, ${result.failed} failed.`];
  return ['## SELF-CHECK block', ...lines].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try {
    const input = inputFromEvent(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')));
    result = checkSelfCheck(input);
  } catch {
    result = { ok: false, skipped: false, problems: [`Could not read the pull request event; set GITHUB_EVENT_PATH to a readable JSON event file (${SELF_CHECK_DOC}).`] };
  }
  const summary = formatSelfCheckSummary(result);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (!result.ok) result.problems.forEach((sentence) => console.error(sentence));
  else console.log(summary.split('\n')[1]);
  process.exit(result.ok ? 0 : 1);
}

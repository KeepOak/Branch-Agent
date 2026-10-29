#!/usr/bin/env node
// Require a live MERGE verdict on the pull request's current head SHA before merge-gate goes green.
// Stops the #1882 / #1866 pattern: merge via the shared token with no MERGE on that head.
// Accepts Verifier comment form (**MERGE** `sha`) and body form (review-verdict: MERGE sha).
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MERGE_LINE = /^\s*(?:\*\*)?MERGE(?:\*\*)?\s*[`:]?\s*`?([0-9a-f]{7,40})`?\s*$/im;
export const REVIEW_VERDICT_MERGE = /^\s*review-verdict:\s*MERGE\s+([0-9a-f]{7,40})\s*$/im;
export const FIX_LINE = /^\s*(?:\*\*)?FIX(?:\*\*)?\s*[`:]?\s*`?([0-9a-f]{7,40})`?\s*$/im;
export const REVIEW_VERDICT_FIX = /^\s*review-verdict:\s*FIX\s+([0-9a-f]{7,40})\s*$/im;

function expandSha(sha, headSha) {
  const value = String(sha ?? '').toLowerCase();
  const head = String(headSha ?? '').toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(value)) return null;
  if (value.length === 40) return value;
  if (head.startsWith(value)) return head;
  return null;
}

function collectFromText(text, headSha, source, createdAt) {
  const found = [];
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    let match = MERGE_LINE.exec(line) || REVIEW_VERDICT_MERGE.exec(line);
    if (match) {
      const sha = expandSha(match[1], headSha);
      if (sha) found.push({ kind: 'MERGE', sha, source, at: createdAt ?? null });
      continue;
    }
    match = FIX_LINE.exec(line) || REVIEW_VERDICT_FIX.exec(line);
    if (match) {
      const sha = expandSha(match[1], headSha);
      if (sha) found.push({ kind: 'FIX', sha, source, at: createdAt ?? null });
    }
  }
  return found;
}

/** Pure: MERGE/FIX markers from the PR body and issue comments. */
export function parseMergeVerdicts({ body = '', comments = [], headSha }) {
  const found = collectFromText(body, headSha, 'body', null);
  for (const comment of comments) {
    const at = comment?.created_at ?? comment?.updated_at ?? null;
    found.push(...collectFromText(comment?.body ?? '', headSha, 'comment', at));
  }
  return found;
}

function timeValue(at) {
  if (!at) return 0;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : 0;
}

/** Require a MERGE on the exact current head; a later FIX on that head blocks. */
export function evaluateMergeVerdict({ body, comments, headSha }) {
  const head = String(headSha ?? '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(head)) {
    return { ok: false, message: 'Current head SHA is missing or not a full 40-character commit.' };
  }
  const verdicts = parseMergeVerdicts({ body, comments, headSha: head });
  const onHead = verdicts.filter((v) => v.sha === head);
  const merges = onHead.filter((v) => v.kind === 'MERGE').sort((a, b) => timeValue(a.at) - timeValue(b.at));
  const fixes = onHead.filter((v) => v.kind === 'FIX').sort((a, b) => timeValue(a.at) - timeValue(b.at));
  if (merges.length === 0) {
    return {
      ok: false,
      message: [
        `No live MERGE verdict for the current head ${head}.`,
        'Post a Verifier comment like: **MERGE** `' + head + '`',
        'Or add a body line: review-verdict: MERGE ' + head,
        'A MERGE for an older SHA does not count after a new push.',
      ].join('\n'),
    };
  }
  const latestMergeAt = timeValue(merges[merges.length - 1].at);
  const blockingFix = fixes.find((f) => timeValue(f.at) >= latestMergeAt);
  if (blockingFix) {
    return {
      ok: false,
      message: [
        `A FIX verdict for the current head ${head} is at least as new as the MERGE.`,
        'Address the FIX and post a fresh **MERGE** `' + head + '` on this head.',
      ].join('\n'),
    };
  }
  return { ok: true, message: `MERGE verdict present for ${head}.` };
}

export function formatMergeVerdictSummary(result) {
  return ['## MERGE verdict', '', result.message].join('\n');
}

function fetchIssueComments(repo, prNumber, token) {
  const args = [
    'api',
    '--paginate',
    `repos/${repo}/issues/${prNumber}/comments`,
    '-H',
    'Accept: application/vnd.github+json',
  ];
  const raw = execFileSync('gh', args, {
    env: { ...process.env, GH_TOKEN: token },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!raw.trim()) return [];
  const chunks = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '[') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) chunks.push(JSON.parse(raw.slice(start, i + 1)));
    }
  }
  if (!chunks.length) {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  }
  return chunks.flat();
}

export async function resolveVerdictInput({
  env = process.env,
  fetchComments = fetchIssueComments,
} = {}) {
  const { liveContext, snapshotFromEnv } = await import('./live-pull-request.mjs');
  const snapshot = snapshotFromEnv(env);
  const ctx = liveContext(env);
  if (!ctx) {
    throw new Error('CI needs REPO, PR_NUMBER and GH_TOKEN (or GITHUB_TOKEN) to read the MERGE verdict');
  }
  const body = snapshot?.body ?? '';
  const headSha = (snapshot?.headSha || env.SHA || env.HEAD_SHA || '').toLowerCase();
  const comments = fetchComments(ctx.repo, ctx.prNumber, ctx.token);
  return { body, comments, headSha };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try {
    result = evaluateMergeVerdict(await resolveVerdictInput());
  } catch (error) {
    const reason = String(error?.message ?? error).split('\n')[0];
    result = {
      ok: false,
      message: `Could not read MERGE verdict (${reason}). This is not a verdict failure; re-run the check.`,
    };
  }
  const summary = formatMergeVerdictSummary(result);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (!result.ok) console.error(result.message);
  else console.log(result.message);
  process.exit(result.ok ? 0 : 1);
}

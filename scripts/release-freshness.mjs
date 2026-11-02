#!/usr/bin/env node
// Scheduled guard: fail when main's HEAD is older than the grace period and has no published (non-draft) release.
// Drafts never count, so drafts left by superseded runs neither satisfy nor trigger it. Two API reads per run.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GRACE_MINUTES = 90;
export const ISSUE_TITLE = 'Release guard: main HEAD has no published release';

export function releaseMatchesCommit(release, sha) {
  if (!release || release.draft) return false;
  if (release.target_commitish === sha) return true;
  return typeof release.tag_name === 'string' && release.tag_name.endsWith(`-build-${sha.slice(0, 12)}`);
}

export function decide({ headSha, headDate, now, releases, graceMinutes = GRACE_MINUTES }) {
  const ageMinutes = (Date.parse(now) - Date.parse(headDate)) / 60000;
  if (!Number.isFinite(ageMinutes)) return { ok: false, reason: `cannot read the commit date ${headDate}` };
  if ((releases ?? []).some((r) => releaseMatchesCommit(r, headSha))) return { ok: true, reason: `${headSha.slice(0, 8)} has a published release` };
  if (ageMinutes <= graceMinutes) return { ok: true, reason: `${headSha.slice(0, 8)} is ${Math.round(ageMinutes)} min old, within the ${graceMinutes} min grace period` };
  return { ok: false, reason: `main HEAD ${headSha.slice(0, 8)} is ${Math.round(ageMinutes)} min old and has no published release (drafts ignored)` };
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
}

function main() {
  const repo = process.env.REPO ?? 'KeepOak/Branch-Agent';
  const head = JSON.parse(gh(['api', `repos/${repo}/commits/main`, '--jq', '{sha: .sha, date: .commit.committer.date}']));
  const releases = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=20`, '--jq', '[.[] | {tag_name, target_commitish, draft}]']));
  const result = decide({ headSha: head.sha, headDate: head.date, now: new Date().toISOString(), releases });
  console.log(result.reason);
  if (result.ok) return;
  console.log(`::error::${result.reason}`);
  const body = `${result.reason}.\n\nCommit: ${head.sha}\nRun: ${process.env.RUN_URL ?? ''}`;
  const existing = gh(['issue', 'list', '-R', repo, '--state', 'open', '--search', `"${ISSUE_TITLE}" in:title`, '--json', 'number', '--jq', '.[0].number // empty']);
  if (existing) gh(['issue', 'comment', existing, '-R', repo, '--body', body]);
  else gh(['issue', 'create', '-R', repo, '--title', ISSUE_TITLE, '--body', body]);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

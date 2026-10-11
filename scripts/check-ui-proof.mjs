import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveContext, readLivePullRequest } from './live-pull-request.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const windowSource = /^window\/.+\.(?:[cm]?[jt]sx?)$/;
const windowTest = /\.test\.(?:[cm]?[jt]sx?)$/;
const windowTypes = /\.d\.ts$/;

/** Window UI source: under window/, not a test file, not a .d.ts. */
export function isWindowUISource(filePath) {
  return windowSource.test(filePath) && !windowTest.test(filePath) && !windowTypes.test(filePath);
}

const CURSOR_FOOTER_AFTER_MARKER = /<!--\s*CURSOR_AGENT_PR_BODY_END\s*-->[\s\S]*$/i;
const CURSOR_FOOTER_DIV = /<div\b[^>]*>[\s\S]*?cursor_ref=pr_footer[\s\S]*?<\/div>\s*/gi;
const CURSOR_LINKED_MARKDOWN_IMAGE = /\[!\[[^\]]*\]\([^)]+\)\]\(\s*https?:\/\/(?:[\w.-]+\.)?cursor\.com[^)]*\)/gi;
const CURSOR_LINKED_HTML = /<a\b[^>]*\bhref\s*=\s*["'][^"']*cursor\.com[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const HTML_IMAGE = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const GITHUB_ATTACHMENT = /https:\/\/(?:user-images\.githubusercontent\.com|github\.com\/user-attachments\/assets\/)[^\s)"']+/gi;

function firstUrlToken(value) {
  return String(value).trim().replace(/^<|>$/g, '').split(/\s+/, 1)[0] ?? '';
}

function hostnameOf(url) {
  try {
    return new URL(url, 'https://proof.invalid').hostname;
  } catch {
    return '';
  }
}

/** Badge hosts, cursor.com assets, and /badge.svg-style URLs are not app screenshots. */
export function isIgnoredProofUrl(url) {
  const value = firstUrlToken(url);
  if (!value) return true;
  const hostname = hostnameOf(value);
  if (/(^|\.)(?:shields\.io|badgen\.net|badge\.fury\.io|cursor\.com)$/i.test(hostname)) return true;
  if (/(?:^|\/)badge(?:s)?(?:\.svg|\.png|\/|$|\?)/i.test(value)) return true;
  return false;
}

function bodyWithoutIgnoredBlocks(prBody) {
  return String(prBody)
    .replace(CURSOR_FOOTER_AFTER_MARKER, '')
    .replace(CURSOR_FOOTER_DIV, '')
    .replace(CURSOR_LINKED_MARKDOWN_IMAGE, '')
    .replace(CURSOR_LINKED_HTML, '');
}

function proofUrlsIn(prBody) {
  const text = bodyWithoutIgnoredBlocks(prBody);
  const urls = [];
  for (const match of text.matchAll(MARKDOWN_IMAGE)) urls.push(firstUrlToken(match[2]));
  for (const match of text.matchAll(HTML_IMAGE)) urls.push(firstUrlToken(match[1]));
  for (const match of text.matchAll(GITHUB_ATTACHMENT)) urls.push(firstUrlToken(match[0]));
  return urls;
}

export function hasScreenshotProof(prBody) {
  if (!prBody) return false;
  if (/^No visible change:\s+\S+/im.test(prBody)) return true;
  return proofUrlsIn(prBody).some((url) => !isIgnoredProofUrl(url));
}

export function checkUIProof(changedFiles, prBody) {
  const uiSourceFiles = changedFiles.filter(isWindowUISource);
  if (uiSourceFiles.length === 0) {
    return { exitCode: 0, message: 'No window UI source changes detected.' };
  }
  if (hasScreenshotProof(prBody)) {
    return {
      exitCode: 0,
      message: `Window UI changes (${uiSourceFiles.length} file(s)) have screenshot proof.`,
    };
  }
  return {
    exitCode: 1,
    message: [
      `Window UI changes detected in ${uiSourceFiles.length} file(s), but no screenshot proof found in the PR body:`,
      ...uiSourceFiles.map((file) => `  - ${file}`),
      '',
      'Add a markdown or HTML image, or a GitHub user-attachments / artifact image link.',
      'For a refactor with no UI effect, add a line: No visible change: <reason>',
      'See AGENTS.md: self-test visible changes and put screenshots in the PR.',
    ].join('\n'),
  };
}

export function prBodyFromEvent(event) {
  return event?.pull_request?.body ?? '';
}

export function changedFilesFromNameOnly(diff) {
  return diff.split(/\r?\n/).filter(Boolean);
}

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  return JSON.parse(readFileSync(eventPath, 'utf8'));
}

function filesFromGit() {
  const base = process.env.CHANGED_FILES_BASE || 'HEAD^1';
  return changedFilesFromNameOnly(execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', base, 'HEAD'],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  ));
}

function filesFromGh(repo, number) {
  return changedFilesFromNameOnly(execFileSync(
    'gh',
    ['api', `repos/${repo}/pulls/${number}/files`, '--paginate', '--jq', '.[].filename'],
    { encoding: 'utf8', windowsHide: true },
  ));
}

function bodyFromGh(repo, number) {
  return execFileSync(
    'gh',
    ['api', `repos/${repo}/pulls/${number}`, '--jq', '.body // ""'],
    { encoding: 'utf8', windowsHide: true },
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const event = readEvent();
  const repo = process.env.GITHUB_REPOSITORY;
  const number = event?.pull_request?.number;
  // The live body when CI configures it: a body edited after the push is not in the payload.
  const ctx = liveContext({ ...process.env, REPO: process.env.REPO || repo, PR_NUMBER: process.env.PR_NUMBER || number });
  // In CI a missing live context fails closed: the event payload may predate a body edit.
  if (!ctx && process.env.GITHUB_ACTIONS === 'true' && event?.pull_request) {
    console.error('Could not read the pull request body live: CI needs REPO, PR_NUMBER and a token. This is not a screenshot failure.');
    process.exit(1);
  }
  let body = prBodyFromEvent(event);
  if (ctx) {
    try {
      body = readLivePullRequest(ctx).body;
    } catch (error) {
      console.error(`Could not read the pull request body from GitHub (${String(error?.message ?? error).split('\n')[0]}). This is not a screenshot failure; re-run the check.`);
      process.exit(1);
    }
  }
  else if (!event?.pull_request && repo && number) body = bodyFromGh(repo, number);
  let files;
  try {
    files = filesFromGit();
  } catch {
    if (!repo || !number) {
      console.error('Could not read changed files from git or gh api. Need a PR checkout or GITHUB_TOKEN.');
      process.exit(1);
    }
    files = filesFromGh(repo, number);
  }
  const result = checkUIProof(files, body);
  if (result.exitCode) console.error(result.message);
  else console.log(result.message);
  process.exit(result.exitCode);
}

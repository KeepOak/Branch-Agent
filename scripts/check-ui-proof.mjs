import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const windowSource = /^window\/.+\.(?:[cm]?[jt]sx?)$/;
const windowTest = /\.test\.(?:[cm]?[jt]sx?)$/;
const windowTypes = /\.d\.ts$/;

/** Window UI source: under window/, not a test file, not a .d.ts. */
export function isWindowUISource(filePath) {
  return windowSource.test(filePath) && !windowTest.test(filePath) && !windowTypes.test(filePath);
}

const REJECTED_PROOF_HOST = /(?:^|\.)(?:cursor\.com|shields\.io|badge\.fury\.io)$/i;
const GITHUB_ATTACHMENT = /^https:\/\/(?:user-images\.githubusercontent\.com\/|github\.com\/user-attachments\/assets\/)/i;

export function proofImageUrls(prBody) {
  if (!prBody) return [];
  const urls = [];
  for (const match of prBody.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) urls.push(match[1]);
  for (const match of prBody.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) urls.push(match[1]);
  for (const match of prBody.matchAll(/https:\/\/(?:user-images\.githubusercontent\.com|github\.com\/user-attachments\/assets\/)[^\s)"']+/gi)) {
    urls.push(match[0]);
  }
  return urls;
}

export function isRejectedProofUrl(url) {
  try {
    const parsed = new URL(url, 'https://example.invalid');
    if (REJECTED_PROOF_HOST.test(parsed.hostname)) return true;
    if (/\/badge(?:s)?(?:\/|\.|$)/i.test(parsed.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

export function isAcceptedProofUrl(url) {
  if (GITHUB_ATTACHMENT.test(url)) return true;
  if (isRejectedProofUrl(url)) return false;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return Boolean(url);
  return /^https?:\/\//i.test(url);
}

export function hasScreenshotProof(prBody) {
  if (!prBody) return false;
  if (/^No visible change:\s+\S+/im.test(prBody)) return true;
  return proofImageUrls(prBody).some(isAcceptedProofUrl);
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
  let body = prBodyFromEvent(event);
  if (!event?.pull_request && repo && number) body = bodyFromGh(repo, number);
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

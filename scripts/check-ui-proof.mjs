import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAddedImagePaths } from './check-proof-images.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const windowSource = /^window\/.+\.(?:[cm]?[jt]sx?)$/;
const windowTest = /\.test\.(?:[cm]?[jt]sx?)$/;
const windowTypes = /\.d\.ts$/;

export const PROOF_REPO = 'KeepOak/Branch-Agent';
export const PROOF_SHA = /^[0-9a-f]{40}$/;
export const PROOF_IMAGE_NAME = /^[^/?#]+\.(?:png|jpe?g|gif|webp)$/i;

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
const RAW_REPO_URL = /https:\/\/raw\.githubusercontent\.com\/KeepOak\/Branch-Agent\/[^\s)"']+/gi;

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
  for (const match of text.matchAll(RAW_REPO_URL)) urls.push(firstUrlToken(match[0]));
  return [...new Set(urls)];
}

export function isGitHubAttachmentUrl(url) {
  return /^https:\/\/(?:github\.com\/user-attachments\/assets\/|user-images\.githubusercontent\.com\/)/i.test(
    firstUrlToken(url),
  );
}

export function parseRawProofUrl(url) {
  let parsed;
  try {
    parsed = new URL(firstUrlToken(url));
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (parsed.hostname !== 'raw.githubusercontent.com') {
    return { ok: false, reason: 'not-raw' };
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 5) return { ok: false, reason: 'short-path' };
  const [owner, repo, ref, ...rest] = parts;
  if (`${owner}/${repo}` !== PROOF_REPO) return { ok: false, reason: 'wrong-repo' };
  const sha = String(ref).toLowerCase();
  if (!PROOF_SHA.test(sha)) return { ok: false, reason: 'branch-ref' };
  if (rest[0] !== 'proof' || rest.length !== 2) return { ok: false, reason: 'not-proof-path' };
  if (!PROOF_IMAGE_NAME.test(rest[1])) return { ok: false, reason: 'not-image' };
  return { ok: true, sha, file: rest[1], repo: PROOF_REPO };
}

export function looksLikeRawProofAttempt(url) {
  const value = firstUrlToken(url);
  if (!/^https:\/\/raw\.githubusercontent\.com\//i.test(value)) return false;
  return /\/proof\/|\.(?:png|jpe?g|gif|webp)(?:\?|#|$)/i.test(value);
}

export function isAcceptedProofUrl(url) {
  if (isIgnoredProofUrl(url)) return false;
  if (isGitHubAttachmentUrl(url)) return true;
  return parseRawProofUrl(url).ok;
}

export function rejectedRawProofUrls(prBody) {
  return proofUrlsIn(prBody).filter((url) => looksLikeRawProofAttempt(url) && !parseRawProofUrl(url).ok);
}

export function acceptedProofUrls(prBody) {
  return proofUrlsIn(prBody).filter((url) => isAcceptedProofUrl(url));
}

export function hasScreenshotProof(prBody) {
  if (!prBody) return false;
  if (/^No visible change:\s+\S+/im.test(prBody)) return true;
  return acceptedProofUrls(prBody).length > 0;
}

function fileNames(files) {
  return files.map((file) => (typeof file === 'string' ? file : file?.filename)).filter(Boolean);
}

export function lookupProofSha(sha, {
  token,
  repo = PROOF_REPO,
  defaultBranch = 'main',
  request,
} = {}) {
  if (!request && !token) return null;
  const get = request ?? ((apiPath) => JSON.parse(execFileSync(
    'gh',
    ['api', apiPath],
    { encoding: 'utf8', windowsHide: true },
  )));
  try {
    const refs = get(`/repos/${repo}/git/matching-refs/heads/proof`);
    let onProofBranch = false;
    for (const ref of Array.isArray(refs) ? refs : []) {
      const tip = ref?.object?.sha;
      if (!tip) continue;
      if (String(tip).toLowerCase() === sha) {
        onProofBranch = true;
        break;
      }
      const compared = get(`/repos/${repo}/compare/${sha}...${tip}`);
      if (compared?.status === 'identical' || compared?.status === 'ahead') {
        onProofBranch = true;
        break;
      }
    }
    const vsDefault = get(`/repos/${repo}/compare/${sha}...${defaultBranch}`);
    const onMain = vsDefault?.status === 'identical' || vsDefault?.status === 'ahead';
    return { onProofBranch, onMain };
  } catch {
    return null;
  }
}

export function verifyRawProofShas(urls, { lookupSha } = {}) {
  if (!lookupSha) return { exitCode: 0, message: 'Proof SHA lookup skipped (no token).' };
  const parsed = urls.map(parseRawProofUrl).filter((item) => item.ok);
  for (const item of parsed) {
    const info = lookupSha(item.sha);
    if (info == null) continue;
    if (info.onProofBranch) continue;
    if (info.onMain) {
      return {
        exitCode: 1,
        message: [
          `Proof SHA ${item.sha} is reachable from main.`,
          'Pin the raw URL to a commit on an orphan proof/<head-branch> branch, not main.',
        ].join('\n'),
      };
    }
  }
  return { exitCode: 0, message: 'Proof SHAs are not on main.' };
}

const PROOF_HELP = [
  'Add a GitHub user-attachments image, or a SHA-pinned raw URL from a proof/<head-branch> orphan branch:',
  '  https://raw.githubusercontent.com/KeepOak/Branch-Agent/<40-char-sha>/proof/<file>.png',
  'Do not commit screenshots to the PR branch. For a refactor with no UI effect, add a line: No visible change: <reason>',
  'See AGENTS.md: self-test visible changes and publish screenshots on a proof/* branch.',
];

export function checkUIProof(changedFiles, prBody, options = {}) {
  const uiSourceFiles = fileNames(changedFiles).filter(isWindowUISource);
  if (uiSourceFiles.length === 0) {
    return { exitCode: 0, message: 'No window UI source changes detected.' };
  }

  const rejected = rejectedRawProofUrls(prBody);
  if (rejected.length) {
    return {
      exitCode: 1,
      message: [
        'Rejected raw.githubusercontent.com proof URL(s). Use KeepOak/Branch-Agent, a 40-character commit SHA, and a proof/<file> path:',
        ...rejected.map((url) => `  - ${url}`),
        '',
        ...PROOF_HELP,
      ].join('\n'),
    };
  }

  if (!hasScreenshotProof(prBody)) {
    return {
      exitCode: 1,
      message: [
        `Window UI changes detected in ${uiSourceFiles.length} file(s), but no screenshot proof found in the PR body:`,
        ...uiSourceFiles.map((file) => `  - ${file}`),
        '',
        ...PROOF_HELP,
      ].join('\n'),
    };
  }

  const shaCheck = verifyRawProofShas(acceptedProofUrls(prBody), options);
  if (shaCheck.exitCode) return shaCheck;

  return {
    exitCode: 0,
    message: `Window UI changes (${uiSourceFiles.length} file(s)) have screenshot proof.`,
  };
}

export function checkPrProof(changedFiles, prBody, options = {}) {
  const images = checkAddedImagePaths(changedFiles);
  if (images.exitCode) return images;
  return checkUIProof(changedFiles, prBody, options);
}

export function prBodyFromEvent(event) {
  return event?.pull_request?.body ?? '';
}

export function changedFilesFromNameOnly(diff) {
  return diff.split(/\r?\n/).filter(Boolean);
}

export function filesFromNameStatus(diff) {
  return diff.split(/\r?\n/).filter(Boolean).map((line) => {
    const [status, first, second] = line.split('\t');
    if (status?.startsWith('R') || status?.startsWith('C')) {
      return { status: 'renamed', filename: second || first, previous_filename: first };
    }
    const mapped = { A: 'added', M: 'modified', D: 'removed' };
    return { status: mapped[status] || 'modified', filename: first };
  });
}

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  return JSON.parse(readFileSync(eventPath, 'utf8'));
}

function filesFromGit() {
  const base = process.env.CHANGED_FILES_BASE || 'HEAD^1';
  return filesFromNameStatus(execFileSync(
    'git',
    ['diff', '--name-status', '--no-renames', base, 'HEAD'],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  ));
}

function filesFromGh(repo, number) {
  const diff = execFileSync(
    'gh',
    ['api', `repos/${repo}/pulls/${number}/files`, '--paginate', '--jq', '.[] | [.status, .filename] | @tsv'],
    { encoding: 'utf8', windowsHide: true },
  );
  return diff.split(/\r?\n/).filter(Boolean).map((line) => {
    const [status, filename] = line.split('\t');
    return { status, filename };
  });
}

function bodyFromGh(repo, number) {
  return execFileSync(
    'gh',
    ['api', `repos/${repo}/pulls/${number}`, '--jq', '.body // ""'],
    { encoding: 'utf8', windowsHide: true },
  );
}

function lookupFromEnv() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) return undefined;
  return (sha) => lookupProofSha(sha, { token });
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
  const result = checkPrProof(files, body, { lookupSha: lookupFromEnv() });
  if (result.exitCode) console.error(result.message);
  else console.log(result.message);
  process.exit(result.exitCode);
}

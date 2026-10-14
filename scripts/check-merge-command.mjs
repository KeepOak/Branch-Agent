// Check that merge commands in documentation use the correct pattern.
// Enforces: gh pr merge must include --merge and --match-head-commit, never --squash or --rebase.
// A gh pr merge command with --auto fails only when this change adds it. A command already
// present at the merge base with main stays. If that base cannot be read, main's copies
// are checked instead of the head.
// Also checks REST API merge calls use merge_method: "merge" and sha.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const docsToCheck = [
  'AGENTS.md',
  'CONTRIBUTING.md',
  '.cursor/BUGBOT.md',
  'docs/CHECKPOINT.md',
];

const MAIN_REFS = ['origin/main', 'main'];

// Read the quoted value assigned to a JSON-like field in a lookahead window.
// Matches merge_method: "merge" and "merge_method":"merge", not a nearby mention.
export function assignedFieldValue(context, field) {
  const pattern = new RegExp(
    String.raw`["']?${field}["']?\s*[:=]\s*["']([^"']+)["']`,
  );
  const match = context.match(pattern);
  return match ? match[1] : null;
}

export function mergeCommandLines(content) {
  return [...String(content ?? '').matchAll(/gh pr merge[^\n]*/g)].map((match) => match[0]);
}

export function isAutoMergeCommand(command) {
  return command.includes('--auto');
}

// Drop auto-merge commands the pull request diff added, so the remainder matches the base.
// Returns null when the diff hunk is missing and the base has to be read another way.
export function baseContentFromHeadAndPatch(headContent, patch) {
  if (typeof patch !== 'string') return null;
  const added = [];
  for (const line of patch.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    for (const command of mergeCommandLines(line.slice(1))) {
      if (isAutoMergeCommand(command)) added.push(command);
    }
  }
  let base = String(headContent ?? '');
  for (const command of added) {
    const at = base.indexOf(command);
    if (at === -1) continue;
    base = `${base.slice(0, at)}${base.slice(at + command.length)}`;
  }
  return base;
}

// Commands with --auto that the head has more times than the merge base.
export function addedAutoMergeCommands(baseContent, headContent) {
  const remaining = new Map();
  for (const command of mergeCommandLines(baseContent)) {
    if (!isAutoMergeCommand(command)) continue;
    remaining.set(command, (remaining.get(command) ?? 0) + 1);
  }
  const added = [];
  for (const command of mergeCommandLines(headContent)) {
    if (!isAutoMergeCommand(command)) continue;
    const count = remaining.get(command) ?? 0;
    if (count > 0) remaining.set(command, count - 1);
    else added.push(command);
  }
  return added;
}

// prFiles is the pull request diff (three-dot, against the merge base).
// A doc the diff does not touch keeps the head text as its base, so a stale
// --auto line is not treated as added. null means the base text is unavailable.
export function baseContentsFromPrDiff(docs, {
  headContents = {},
  prFiles = null,
  baseContentsForChanged = null,
} = {}) {
  const changed = new Set();
  if (Array.isArray(prFiles)) {
    for (const file of prFiles) {
      if (file?.filename) changed.add(file.filename);
      if (file?.previous_filename) changed.add(file.previous_filename);
    }
  }
  const result = {};
  for (const doc of docs) {
    if (!Array.isArray(prFiles)) {
      result[doc] = null;
      continue;
    }
    if (!changed.has(doc)) {
      result[doc] = headContents[doc] ?? '';
      continue;
    }
    const entry = prFiles.find((file) => file?.filename === doc);
    if (entry?.status === 'added') {
      result[doc] = '';
      continue;
    }
    if (baseContentsForChanged && Object.hasOwn(baseContentsForChanged, doc)) {
      result[doc] = baseContentsForChanged[doc] ?? '';
      continue;
    }
    result[doc] = null;
  }
  return result;
}

function gitOutput(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function canonicalizePath(value) {
  let resolved;
  try {
    resolved = realpathSync.native(value);
  } catch {
    try {
      resolved = realpathSync(value);
    } catch {
      resolved = path.resolve(value);
    }
  }
  if (process.platform !== 'win32') return resolved;
  if (resolved.startsWith('\\\\?\\UNC\\')) resolved = `\\\\${resolved.slice(8)}`;
  else if (resolved.startsWith('\\\\?\\')) resolved = resolved.slice(4);
  return resolved.replace(/\//g, '\\');
}

// Windows runners often hand the checker an 8.3 temp path while git
// --show-toplevel returns the long, forward-slash form. JS realpathSync does
// not expand short names; native realpath does. Compare case-insensitively on
// win32 only so Linux and macOS stay byte-for-byte.
export function samePath(left, right) {
  const a = canonicalizePath(left);
  const b = canonicalizePath(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function repoRootIfOwned(cwd) {
  const top = gitOutput(cwd, ['rev-parse', '--show-toplevel'])?.trim();
  if (!top || !samePath(top, cwd)) return null;
  return top;
}

function verifyRev(cwd, rev) {
  return gitOutput(cwd, ['rev-parse', '--verify', '--quiet', rev])?.trim() || null;
}

// Blob text at rev, null when the path is absent, undefined when rev is absent.
function showAt(cwd, rev, doc) {
  const sha = verifyRev(cwd, rev);
  if (!sha) return undefined;
  const text = gitOutput(cwd, ['cat-file', '-p', `${sha}:${doc}`]);
  return text == null ? null : text;
}

function mergeBaseSha(cwd) {
  if (verifyRev(cwd, 'HEAD^2')) {
    return gitOutput(cwd, ['merge-base', 'HEAD^1', 'HEAD^2'])?.trim() || null;
  }
  for (const ref of MAIN_REFS) {
    if (!verifyRev(cwd, ref)) continue;
    const sha = gitOutput(cwd, ['merge-base', 'HEAD', ref])?.trim();
    if (sha) return sha;
  }
  return null;
}

function mainFileText(cwd, doc) {
  for (const ref of MAIN_REFS) {
    const text = showAt(cwd, ref, doc);
    if (text !== undefined) return text ?? '';
  }
  if (verifyRev(cwd, 'HEAD^2')) {
    const text = showAt(cwd, 'HEAD^1', doc);
    if (text !== undefined) return text ?? '';
  }
  return undefined;
}

function readDoc(dir, doc) {
  try {
    return readFileSync(path.join(dir, doc), 'utf8');
  } catch {
    return null;
  }
}

function resolveFromGit(rootDir, doc, head) {
  const repo = repoRootIfOwned(rootDir);
  if (!repo) {
    if (head == null) return null;
    return { content: head, baseContent: null, diffAuto: false };
  }
  const baseSha = mergeBaseSha(repo);
  if (baseSha) {
    const base = showAt(repo, baseSha, doc);
    if (head == null && !base) return null;
    return { content: head ?? '', baseContent: base ?? '', diffAuto: true };
  }
  // A merge checkout already contains main. Reading that tree is not a raw head read.
  if (verifyRev(repo, 'HEAD^2')) {
    if (head == null) return null;
    return { content: head, baseContent: null, diffAuto: false };
  }
  const main = mainFileText(repo, doc);
  if (typeof main === 'string') return { content: main, baseContent: null, diffAuto: false };
  if (head == null) return null;
  return { content: head, baseContent: null, diffAuto: false };
}

function resolvedDoc(rootDir, doc, options) {
  const head = readDoc(rootDir, doc);
  if (options.baseContents && Object.hasOwn(options.baseContents, doc)) {
    const base = options.baseContents[doc];
    if (typeof base === 'string') {
      if (head == null) return null;
      return { content: head, baseContent: base, diffAuto: true };
    }
    const main = options.mainContents?.[doc];
    if (typeof main === 'string') return { content: main, baseContent: null, diffAuto: false };
    if (head == null) return null;
    return { content: head, baseContent: null, diffAuto: false };
  }
  return resolveFromGit(rootDir, doc, head);
}

function autoCommandsToReject(content, baseContent, diffAuto) {
  if (!diffAuto) return mergeCommandLines(content).filter(isAutoMergeCommand);
  return addedAutoMergeCommands(baseContent, content);
}

export function checkMergeCommands(rootDir = root, docs = docsToCheck, options = {}) {
  const error = options.error ?? ((...args) => console.error(...args));
  let failed = false;

  for (const doc of docs) {
    const resolved = resolvedDoc(rootDir, doc, options);
    if (!resolved) continue;
    const { content, baseContent, diffAuto } = resolved;
    const pendingAuto = new Map();
    for (const command of autoCommandsToReject(content, baseContent, diffAuto)) {
      pendingAuto.set(command, (pendingAuto.get(command) ?? 0) + 1);
    }

    for (const command of mergeCommandLines(content)) {
      if (!command.includes('--merge')) {
        error(`${doc}: merge command missing --merge:`);
        error(`  ${command}`);
        failed = true;
      }

      if (!command.includes('--match-head-commit')) {
        error(`${doc}: merge command missing --match-head-commit:`);
        error(`  ${command}`);
        failed = true;
      }

      if (command.includes('--squash')) {
        error(`${doc}: merge command must not use --squash:`);
        error(`  ${command}`);
        failed = true;
      }

      if (command.includes('--rebase')) {
        error(`${doc}: merge command must not use --rebase:`);
        error(`  ${command}`);
        failed = true;
      }

      if (isAutoMergeCommand(command)) {
        const left = pendingAuto.get(command) ?? 0;
        if (left > 0) {
          pendingAuto.set(command, left - 1);
          error(`${doc}: merge command must not use --auto:`);
          error(`  ${command}`);
          failed = true;
        }
      }
    }

    const apiMergeCalls = content.matchAll(/PUT \/repos\/[^\s]+\/pulls\/[^\s]+\/merge[^\n]*/gi);
    for (const match of apiMergeCalls) {
      const call = match[0];
      const contextStart = match.index ?? 0;
      const contextEnd = Math.min(contextStart + 300, content.length);
      const context = content.slice(contextStart, contextEnd);

      const mergeMethod = assignedFieldValue(context, 'merge_method');
      if (mergeMethod === 'squash') {
        error(`${doc}: REST API merge call must not use merge_method: "squash":`);
        error(`  ${call}`);
        failed = true;
      } else if (mergeMethod === 'rebase') {
        error(`${doc}: REST API merge call must not use merge_method: "rebase":`);
        error(`  ${call}`);
        failed = true;
      } else if (mergeMethod !== 'merge') {
        error(`${doc}: REST API merge call must specify merge_method: "merge":`);
        error(`  ${call}`);
        failed = true;
      }

      if (!assignedFieldValue(context, 'sha')) {
        error(`${doc}: REST API merge call must specify sha parameter:`);
        error(`  ${call}`);
        failed = true;
      }
    }
  }

  if (failed) {
    error('\nMerge commands must use: gh pr merge <n> --merge --match-head-commit <sha>');
    error('Or REST API: PUT /repos/KeepOak/Branch-Agent/pulls/<n>/merge with merge_method: "merge" and sha');
    return false;
  }
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const passed = checkMergeCommands();
  if (!passed) process.exit(1);
  console.log('All merge commands follow the correct pattern.');
}

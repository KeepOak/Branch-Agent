// Final head stays valid when later commits only merge main into the pull request.
// The named sha must be an ancestor of the head. Each later commit on the pull request
// (first parent only; main's own commits arrived through the merge) must be a merge
// whose other parents are on the current base (origin/main, or the pull request base
// when this checkout is GitHub's merge commit), and its tree must be that merge alone.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SHA = /^[0-9a-f]{40}$/i;

function short(sha) {
  return String(sha).slice(0, 9);
}

export function isFullSha(value) {
  return typeof value === 'string' && SHA.test(value);
}

// commit-tree (the extra-parent fold) exits when the runner has no user.email.
// This identity is not a person. The empty HOME and XDG dir exist only while git runs,
// so a runner gitconfig or attributes file cannot change the merge result.
const GATE_GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'merge-gate',
  GIT_AUTHOR_EMAIL: 'merge-gate@invalid',
  GIT_COMMITTER_NAME: 'merge-gate',
  GIT_COMMITTER_EMAIL: 'merge-gate@invalid',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

function gateGitChild() {
  const home = mkdtempSync(path.join(tmpdir(), 'merge-gate-home-'));
  return {
    home,
    env: {
      ...process.env,
      ...GATE_GIT_IDENTITY,
      HOME: home,
      XDG_CONFIG_HOME: home,
    },
  };
}

function tryGit(repoDir, args) {
  const child = gateGitChild();
  try {
    const stdout = execFileSync('git', ['-C', repoDir, '-c', 'commit.gpgsign=false', ...args], {
      encoding: 'utf8',
      env: child.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, status: 0, stdout };
  } catch (error) {
    return {
      ok: false,
      status: typeof error?.status === 'number' ? error.status : 1,
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? ''),
    };
  } finally {
    rmSync(child.home, { recursive: true, force: true });
  }
}

function failure(message) {
  return { ok: false, known: true, message };
}

function verifyCommit(repoDir, rev) {
  const result = tryGit(repoDir, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  if (!result.ok) return null;
  const sha = result.stdout.trim().toLowerCase();
  return SHA.test(sha) ? sha : null;
}

function commitExists(repoDir, sha) {
  const result = tryGit(repoDir, ['cat-file', '-t', sha]);
  return result.ok && result.stdout.trim() === 'commit';
}

// True, false, or null when the commits are not both in this checkout.
function isAncestor(repoDir, ancestor, descendant) {
  if (ancestor === descendant) return true;
  const result = tryGit(repoDir, ['merge-base', '--is-ancestor', ancestor, descendant]);
  if (result.ok) return true;
  if (result.status === 1) return false;
  return null;
}

function resolveMainTip(repoDir, headSha) {
  for (const ref of ['origin/main', 'main']) {
    const sha = verifyCommit(repoDir, ref);
    if (sha) return sha;
  }
  // pull_request checkout is detached at GitHub's merge: first parent is the base, second is the head.
  const base = verifyCommit(repoDir, 'HEAD^1');
  const head = verifyCommit(repoDir, 'HEAD^2');
  if (base && head && head === headSha) return base;
  return null;
}

function parentShas(repoDir, sha) {
  const result = tryGit(repoDir, ['rev-list', '--parents', '-n', '1', sha]);
  if (!result.ok) return null;
  const parts = result.stdout.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== sha) return null;
  return parts.slice(1).map((parent) => parent.toLowerCase());
}

// First parent only. A merge of main also reaches main's own commits, and those are the
// merge, not new commits on the pull request. The named sha is still checked as a full ancestor.
function commitsAfterNamed(repoDir, named, head) {
  const result = tryGit(repoDir, ['rev-list', '--first-parent', '--reverse', `${named}..${head}`]);
  if (!result.ok) return null;
  return result.stdout.split('\n').map((line) => line.trim().toLowerCase()).filter(Boolean);
}

function commitTree(repoDir, sha) {
  const result = tryGit(repoDir, ['rev-parse', `${sha}^{tree}`]);
  if (!result.ok) return null;
  const tree = result.stdout.trim().toLowerCase();
  return SHA.test(tree) ? tree : null;
}

function mergeTree(repoDir, left, right) {
  const result = tryGit(repoDir, ['merge-tree', '--write-tree', left, right]);
  if (!result.ok) return null;
  const matches = result.stdout.trim().match(/[0-9a-f]{40}/gi);
  return matches ? matches[matches.length - 1].toLowerCase() : null;
}

// True when `sha`'s tree equals a clean merge of `parents`, false when it does not,
// null when this checkout cannot prove it (missing objects, conflicts, or no merge result).
export function commitTreeMatchesCleanMerge(repoDir, sha, parents) {
  if (!repoDir || !isFullSha(sha) || !Array.isArray(parents) || parents.length < 2) return null;
  const expected = cleanMergeTree(repoDir, parents);
  const actual = commitTree(repoDir, sha);
  if (!expected || !actual) return null;
  return expected === actual;
}

// Tree of a clean merge of every parent, folding extra parents through a dangling commit.
function cleanMergeTree(repoDir, parents) {
  let current = parents[0];
  for (let i = 1; i < parents.length; i += 1) {
    const tree = mergeTree(repoDir, current, parents[i]);
    if (!tree) return null;
    if (i === parents.length - 1) return tree;
    const wrapped = tryGit(repoDir, ['commit-tree', tree, '-p', current, '-m', 'final-head fold']);
    if (!wrapped.ok) return null;
    const sha = wrapped.stdout.trim().toLowerCase();
    if (!SHA.test(sha)) return null;
    current = sha;
  }
  return null;
}

// `known: false` means this checkout cannot see the commits, so the caller keeps its old failure.
export function explainFinalHeadDrift({ repoDir, namedSha, headSha } = {}) {
  if (!isFullSha(namedSha) || !isFullSha(headSha)) return { ok: false, known: false };
  const named = namedSha.toLowerCase();
  const head = headSha.toLowerCase();
  if (named === head) return { ok: true, known: true };
  if (!repoDir || !commitExists(repoDir, head)) return { ok: false, known: false };
  if (!commitExists(repoDir, named)) {
    return failure(`Final head ${short(named)} is not in the fetched history, so it cannot be checked against the current head ${short(head)}`);
  }
  const ancestor = isAncestor(repoDir, named, head);
  if (ancestor === null) return { ok: false, known: false };
  if (!ancestor) {
    return failure(`Final head ${short(named)} is not an ancestor of the current head ${short(head)}`);
  }
  const commits = commitsAfterNamed(repoDir, named, head);
  if (!commits) return { ok: false, known: false };
  if (commits.length === 0) return { ok: true, known: true };
  const mainTip = resolveMainTip(repoDir, head);
  if (!mainTip) {
    return failure(`Final head ${short(named)} is not the current head ${short(head)} because main is not in this checkout`);
  }
  for (const sha of commits) {
    const parents = parentShas(repoDir, sha);
    if (!parents) {
      return failure(`Final head ${short(named)} is not the current head ${short(head)} because ${short(sha)} is not in the fetched history`);
    }
    if (parents.length < 2) {
      return failure(`Final head ${short(named)} is not the current head ${short(head)} because ${short(sha)} is not a merge commit`);
    }
    for (const parent of parents.slice(1)) {
      const onMain = isAncestor(repoDir, parent, mainTip);
      if (onMain === null) {
        return failure(`Final head ${short(named)} is not the current head ${short(head)} because ${short(sha)} has a parent that is not in the fetched history`);
      }
      if (!onMain) {
        return failure(`Final head ${short(named)} is not the current head ${short(head)} because ${short(sha)} merges something other than main`);
      }
    }
    if (commitTreeMatchesCleanMerge(repoDir, sha, parents) !== true) {
      return failure(`Final head ${short(named)} is not the current head ${short(head)} because ${short(sha)} changes files beyond the merge of main`);
    }
  }
  return { ok: true, known: true };
}

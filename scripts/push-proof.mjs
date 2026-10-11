#!/usr/bin/env node
// Pushes proof screenshots to proof/<branch> and prints the raw URLs to link from the PR body.
// The images never enter the code branch: this writes git objects directly, so the working tree,
// the index and the current branch are untouched. An existing proof branch gets a new commit on top
// (a fast-forward push, never a force-push).
// Usage: node scripts/push-proof.mjs [--branch <code-branch>] [--remote origin] <image>...
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** proof/<branch>, with the branch's slashes and other unsafe characters turned into dashes. */
export function proofBranchFor(branch) {
  const name = String(branch ?? '').trim().replace(/^proof\//, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!name || name === 'HEAD') throw new Error('cannot name a proof branch from a detached HEAD: pass --branch <code-branch>');
  return `proof/${name}`;
}

/** owner/repo from a GitHub remote URL (https or ssh), or null for any other remote. */
export function repoSlugFromRemote(url) {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url).trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

export function rawProofUrl(slug, proofBranch, name) {
  const file = name.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${slug ?? 'OWNER/REPO'}/refs/heads/${proofBranch}/${file}`;
}

/**
 * mktree input: the existing proof tree's top-level entries (ls-tree lines) with the new images
 * added at the root. A new image replaces an existing entry of the same name.
 */
export function proofTreeInput(existingLsTree, images) {
  const names = new Set();
  for (const image of images) {
    if (names.has(image.name)) throw new Error(`two images are named ${image.name}; rename one`);
    names.add(image.name);
  }
  const kept = String(existingLsTree ?? '').split('\n').filter(Boolean).filter((line) => !names.has(line.split('\t')[1]));
  const added = images.map((image) => `100644 blob ${image.sha}\t${image.name}`);
  return `${[...kept, ...added].join('\n')}\n`;
}

function git(args, cwd, input) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', input, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).trim();
}

export function pushProof({ cwd, files, branch, remote = 'origin' }) {
  if (!files?.length) throw new Error('pass at least one image file');
  const codeBranch = branch ?? git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  const proofBranch = proofBranchFor(codeBranch);
  const images = files.map((file) => {
    const abs = path.resolve(cwd, file);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`not a file: ${file}`);
    return { name: path.basename(abs), sha: git(['hash-object', '-w', '--', abs], cwd) };
  });
  const ref = `refs/heads/${proofBranch}`;
  const exists = git(['ls-remote', '--heads', remote, ref], cwd) !== '';
  let parent = null;
  if (exists) {
    git(['fetch', '--no-tags', remote, ref], cwd);
    parent = git(['rev-parse', 'FETCH_HEAD'], cwd);
  }
  const tree = git(['mktree'], cwd, proofTreeInput(parent ? git(['ls-tree', parent], cwd) : '', images));
  const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `proof: ${codeBranch}`], cwd);
  git(['push', remote, `${commit}:${ref}`], cwd);
  const slug = repoSlugFromRemote(git(['remote', 'get-url', remote], cwd));
  const links = images.map((image) => `![${image.name}](${rawProofUrl(slug, proofBranch, image.name)})`);
  return { proofBranch, commit, links };
}

export function parseArgs(argv) {
  const out = { files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--branch') out.branch = argv[++i];
    else if (argv[i] === '--remote') out.remote = argv[++i];
    else out.files.push(argv[i]);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = pushProof({ cwd: process.cwd(), ...parseArgs(process.argv.slice(2)) });
    console.log(`Pushed ${result.proofBranch} at ${result.commit.slice(0, 9)}. Paste these links in the PR body:`);
    for (const link of result.links) console.log(link);
  } catch (error) {
    console.error(`push-proof: ${String(error?.message ?? error).split('\n')[0]}`);
    console.error('Usage: node scripts/push-proof.mjs [--branch <code-branch>] [--remote origin] <image>...');
    process.exitCode = 1;
  }
}

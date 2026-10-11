import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseArgs, proofBranchFor, proofTreeInput, pushProof, rawProofUrl, repoSlugFromRemote } from './push-proof.mjs';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();

test('proofBranchFor turns the code branch into one proof/ segment', () => {
  assert.equal(proofBranchFor('trunk/470-proof-branch-gate'), 'proof/trunk-470-proof-branch-gate');
  assert.equal(proofBranchFor('proof/already'), 'proof/already');
  assert.throws(() => proofBranchFor('HEAD'), /--branch/);
});

test('repoSlugFromRemote reads https and ssh GitHub remotes only', () => {
  assert.equal(repoSlugFromRemote('https://github.com/KeepOak/Branch-Agent.git'), 'KeepOak/Branch-Agent');
  assert.equal(repoSlugFromRemote('git@github.com:KeepOak/Branch-Agent.git'), 'KeepOak/Branch-Agent');
  assert.equal(repoSlugFromRemote('/tmp/remote.git'), null);
});

test('rawProofUrl links the file on the proof branch', () => {
  assert.equal(
    rawProofUrl('KeepOak/Branch-Agent', 'proof/trunk-470', 'after shot.png'),
    'https://raw.githubusercontent.com/KeepOak/Branch-Agent/refs/heads/proof/trunk-470/after%20shot.png',
  );
});

test('proofTreeInput keeps old entries and replaces same-named ones', () => {
  const existing = '100644 blob aaa\tbefore.png\n100644 blob bbb\tafter.png\n';
  assert.equal(
    proofTreeInput(existing, [{ name: 'after.png', sha: 'ccc' }]),
    '100644 blob aaa\tbefore.png\n100644 blob ccc\tafter.png\n',
  );
  assert.throws(() => proofTreeInput('', [{ name: 'a.png', sha: '1' }, { name: 'a.png', sha: '2' }]), /two images/);
});

test('parseArgs reads --branch, --remote and files', () => {
  assert.deepEqual(parseArgs(['--branch', 'trunk/x', 'a.png', '--remote', 'up', 'b.png']), { files: ['a.png', 'b.png'], branch: 'trunk/x', remote: 'up' });
});

test('pushProof pushes images to proof/<branch> without touching the code branch', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'push-proof-'));
  try {
    const remote = path.join(dir, 'remote.git');
    const work = path.join(dir, 'work');
    git(['init', '--bare', '-q', remote], dir);
    git(['init', '-q', '-b', 'trunk/470-x', work], dir);
    git(['config', 'user.email', 'test@users.noreply.github.com'], work);
    git(['config', 'user.name', 'Test'], work);
    git(['remote', 'add', 'origin', remote], work);
    writeFileSync(path.join(work, 'README.md'), 'code\n');
    git(['add', 'README.md'], work);
    git(['commit', '-q', '-m', 'code'], work);
    const codeHead = git(['rev-parse', 'HEAD'], work);
    writeFileSync(path.join(dir, 'before.png'), 'png-before');
    writeFileSync(path.join(dir, 'after.png'), 'png-after');

    const first = pushProof({ cwd: work, files: [path.join(dir, 'before.png')] });
    assert.equal(first.proofBranch, 'proof/trunk-470-x');
    assert.deepEqual(first.links, ['![before.png](https://raw.githubusercontent.com/OWNER/REPO/refs/heads/proof/trunk-470-x/before.png)']);
    const second = pushProof({ cwd: work, files: [path.join(dir, 'after.png')] });

    assert.equal(git(['ls-tree', '--name-only', 'refs/heads/proof/trunk-470-x'], remote), 'after.png\nbefore.png');
    assert.equal(git(['rev-parse', 'refs/heads/proof/trunk-470-x^'], remote), first.commit);
    assert.equal(git(['rev-parse', 'refs/heads/proof/trunk-470-x'], remote), second.commit);
    assert.equal(git(['rev-parse', 'HEAD'], work), codeHead);
    assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], work), 'trunk/470-x');
    assert.equal(git(['status', '--porcelain'], work), '');
    assert.equal(git(['ls-tree', '--name-only', 'HEAD'], work), 'README.md');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

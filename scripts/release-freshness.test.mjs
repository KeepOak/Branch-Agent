import assert from 'node:assert/strict';
import test from 'node:test';
import { decide, releaseMatchesCommit } from './release-freshness.mjs';

const sha = '2e202d98aaaabbbbccccddddeeeeffff00001111';
const at = (min) => new Date(Date.parse('2026-10-22T00:00:00Z') + min * 60000).toISOString();
const base = { headSha: sha, headDate: at(0) };

test('published release for HEAD passes even when old', () => {
  assert.equal(decide({ ...base, now: at(500), releases: [{ tag_name: 'v0.4.4-build-2e202d98aaaa', draft: false }] }).ok, true);
  assert.equal(decide({ ...base, now: at(500), releases: [{ tag_name: 'x', target_commitish: sha, draft: false }] }).ok, true);
});

test('draft for HEAD does not count; fails after grace', () => {
  const releases = [{ tag_name: 'v0.4.4-build-2e202d98aaaa', target_commitish: sha, draft: true }];
  assert.equal(decide({ ...base, now: at(91), releases }).ok, false);
});

test('within grace passes without a release', () => {
  assert.equal(decide({ ...base, now: at(90), releases: [] }).ok, true);
});

test('drafts and releases for older commits never matter', () => {
  const releases = [{ tag_name: 'v0.4.3-build-760fb342aaaa', draft: true }, { tag_name: 'v0.4.2-build-111111111111', draft: false }];
  assert.equal(decide({ ...base, now: at(30), releases }).ok, true);
  assert.equal(decide({ ...base, now: at(120), releases }).ok, false);
  assert.equal(releaseMatchesCommit({ tag_name: 'v1-build-2e202d98aaaa', draft: true }, sha), false);
});

test('unreadable date fails loudly', () => {
  assert.equal(decide({ headSha: sha, headDate: 'bad', now: at(0), releases: [] }).ok, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateMergeVerdict,
  parseMergeVerdicts,
} from './check-merge-verdict.mjs';

const HEAD = '29255f129663bff7f9b6c5ebd8dfe9167d66004c';
const OLD = '1285af56a1ca1bae372e5cd725978c2d8229d887';

test('comment **MERGE** backticks on current head passes', () => {
  const result = evaluateMergeVerdict({
    headSha: HEAD,
    body: '',
    comments: [{ body: `**MERGE** \`${HEAD}\`\n\nLooks good.`, created_at: '2026-10-23T02:00:00Z' }],
  });
  assert.equal(result.ok, true);
});

test('body review-verdict MERGE on current head passes', () => {
  const result = evaluateMergeVerdict({
    headSha: HEAD,
    body: `notes\nreview-verdict: MERGE ${HEAD}\n`,
    comments: [],
  });
  assert.equal(result.ok, true);
});

test('MERGE on an older SHA fails', () => {
  const result = evaluateMergeVerdict({
    headSha: HEAD,
    body: '',
    comments: [{ body: `**MERGE** \`${OLD}\``, created_at: '2026-10-23T01:00:00Z' }],
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /No live MERGE/);
});

test('missing MERGE fails', () => {
  const result = evaluateMergeVerdict({ headSha: HEAD, body: 'no verdict', comments: [] });
  assert.equal(result.ok, false);
});

test('FIX after MERGE on same head blocks', () => {
  const result = evaluateMergeVerdict({
    headSha: HEAD,
    body: '',
    comments: [
      { body: `**MERGE** \`${HEAD}\``, created_at: '2026-10-23T02:00:00Z' },
      { body: `**FIX** \`${HEAD}\`\nbroken`, created_at: '2026-10-23T03:00:00Z' },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /FIX verdict/);
});

test('MERGE after FIX on same head passes', () => {
  const result = evaluateMergeVerdict({
    headSha: HEAD,
    body: '',
    comments: [
      { body: `**FIX** \`${HEAD}\``, created_at: '2026-10-23T02:00:00Z' },
      { body: `**MERGE** \`${HEAD}\``, created_at: '2026-10-23T03:00:00Z' },
    ],
  });
  assert.equal(result.ok, true);
});

test('short sha expands when it prefixes the head', () => {
  const short = HEAD.slice(0, 9);
  const found = parseMergeVerdicts({
    headSha: HEAD,
    body: `**MERGE** \`${short}\``,
    comments: [],
  });
  assert.equal(found[0]?.sha, HEAD);
});

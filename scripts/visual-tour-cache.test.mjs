// node --test scripts/visual-tour-cache.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const yaml = readFileSync(new URL('../.github/workflows/visual-tour.yml', import.meta.url), 'utf8');
const build = yaml.slice(yaml.indexOf('  build:\n'), yaml.indexOf('  tour:\n'));
const tour = yaml.slice(yaml.indexOf('  tour:\n'), yaml.indexOf('  comment:\n'));
const cacheStep = build.slice(build.indexOf('uses: actions/cache@'), build.indexOf('      - run: npm install --global pnpm'));

test('the build cache uses the repo-pinned actions/cache commit', () => {
  assert.match(cacheStep, /uses: actions\/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6\.1\.0/);
});

test('the cache stores the engine and window build outputs', () => {
  assert.match(cacheStep, /engine\/dist\//);
  assert.match(cacheStep, /engine\/packages\/\*\*\/dist\//);
  assert.match(cacheStep, /window\/dist\//);
});

test('the key covers both lockfiles, the engine and window source, the build script, and this workflow', () => {
  const key = /hashFiles\(([^)]*)\)/.exec(cacheStep)?.[1] ?? '';
  for (const input of [
    'engine/pnpm-lock.yaml', 'window/pnpm-lock.yaml', 'engine/src/**', 'engine/packages/**', 'engine/scripts/**',
    'window/src/**', 'window/index.html', 'window/vite.config.*', '.github/workflows/visual-tour.yml',
  ]) assert.ok(key.includes(`'${input}'`), `the cache key must hash ${input}`);
  assert.match(cacheStep, /key: visual-build-v1-\$\{\{ runner\.os \}\}-/);
});

test('the key never hashes the outputs it caches, so a build cannot invalidate itself', () => {
  const key = /hashFiles\(([^)]*)\)/.exec(cacheStep)?.[1] ?? '';
  assert.doesNotMatch(key, /dist/);
});

test('restore is exact only: no restore-keys, so a stale build is never restored', () => {
  assert.doesNotMatch(cacheStep, /restore-keys/);
});

test('the install and build steps run only on a cache miss', () => {
  const guarded = [...build.matchAll(/- run: [^\n]*\n(?:[^\n]*\n)*?(?=      - )/g)].map((m) => m[0]);
  const builds = build.split('\n      - ').filter((step) => /run: (npm install|pnpm install)/.test(step));
  assert.ok(builds.length >= 3, 'the three build steps are present');
  for (const step of builds) assert.match(step, /if: steps\.cache\.outputs\.cache-hit != 'true'/, step.slice(0, 80));
  assert.ok(guarded.length > 0);
});

test('the artifact uploads run on a hit and a miss alike, so the tour always gets its inputs', () => {
  const uploads = build.split('\n      - ').filter((step) => step.includes('actions/upload-artifact@'));
  assert.equal(uploads.length, 2);
  for (const step of uploads) assert.doesNotMatch(step, /cache-hit/);
});

test('the tour job still depends on the build and downloads both artifacts', () => {
  assert.match(tour, /needs: \[build\]/);
  assert.match(tour, /name: visual-engine/);
  assert.match(tour, /name: visual-window/);
});

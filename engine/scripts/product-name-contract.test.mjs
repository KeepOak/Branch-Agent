import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const engine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.BRANCH_RENAME_ARTIFACT ?? path.join(engine, 'dist');
const rejected = [
  'plugins from ClawHub.', 'skills found on ClawHub.', 'Enable Peekaboo Bridge',
  'via Peekaboo Bridge.', 'non-ClawHub sources', 'non-ClawHub plugin source',
  'ClawPack sha256', 'ClawPack spec', 'ClawPack manifest sha256', 'ClawPack size',
  'ClawHub-backed skills', 'ClawHub-installed skills', 'ClawPack package downloads',
  'ClawPack download for', 'Seedbank ClawPack integrity', 'Seedbank ClawPack npm',
  'not found on ClawHub.', 'from ClawHub', 'reconnect to ClawHub.',
  'ClawHub/bundled/official only', 'npm/clawhub spec for plugin_install',
  'copied back from Crabbox.', 'Allow Canvas', 'the Canvas panel', 'and Canvas.',
  'Present/eval/snapshot Canvas', 'Control node Canvas surfaces', 'Canvas widget unavailable',
  'Canvas preview unavailable', 'Canvas documents', 'Canvas document', 'Canvas Setup',
  'Lightweight Canvas setup hooks', 'retired Canvas host config', 'Canvas panel',
];
function filesAt(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'test-helpers', 'test-support', 'fixtures'].includes(entry.name)) return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesAt(file) : [file];
  });
}
test('runtime source does not reintroduce the audited rejected display phrases', () => {
  const files = ['src', 'ui/src', 'extensions'].flatMap(dir => filesAt(path.join(engine, dir)))
    .filter(file => /\.(?:ts|tsx|mts)$/.test(file) && !/(?:test|spec|fixture|test-support|test-helpers)/.test(path.basename(file)));
  const leaks = [];
  for (const file of files) {
    // Source comments may describe native protocol/storage concepts; enforce emitted copy.
    const text = fs.readFileSync(file, 'utf8').split('\n')
      .filter(line => !/^\s*(?:\/\/|\/\*|\*)/.test(line)).join('\n');
    for (const phrase of rejected) if (text.includes(phrase)) leaks.push(`${path.relative(engine, file)}: ${phrase}`);
  }
  assert.deepEqual(leaks, []);
});
test('built runtime contains the corrected copy and no audited display phrases', () => {
  const files = filesAt(dist).filter(file => /\.(?:js|mjs)$/.test(file));
  assert.ok(files.length > 1000, 'verify the complete engine build, not a partial fixture');
  const leaks = [];
  const required = new Set(['Connect to browse plugins from Seedbank.', 'No skills found on Seedbank.', 'Enable Knothole Bridge', 'Seedpod sha256', 'Rootway']);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const phrase of rejected) if (text.includes(phrase)) leaks.push(`${path.relative(dist, file)}: ${phrase}`);
    for (const phrase of required) if (text.includes(phrase)) required.delete(phrase);
  }
  assert.deepEqual(leaks, []); assert.deepEqual([...required], []);
});
test('external services and compatibility identities remain intact', () => {
  const artifacts = fs.readFileSync(path.join(engine, 'src/infra/clawhub-artifacts.ts'), 'utf8');
  assert.ok(artifacts.includes('headers.get("X-ClawHub-Artifact-Sha256")'));
  assert.ok(artifacts.includes('headers.get("X-ClawHub-ClawPack-Sha256")'));
  const settings = fs.readFileSync(path.join(engine, 'ui/src/i18n/locales/en-settings.ts'), 'utf8');
  assert.ok(settings.includes("Peekaboo's own Mac app"));
  const provider = fs.readFileSync(path.join(engine, 'ui/src/components/provider-icon.ts'), 'utf8');
  assert.ok(provider.includes('clawrouter: "Rootway"'));
  assert.ok(provider.includes('openrouter: "OpenRouter"'));
});

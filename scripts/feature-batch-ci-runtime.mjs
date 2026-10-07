import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { engineStrictFiles, namedTests, windowStrictFiles } from './feature-batch-ci-targets.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const engineRoot = path.join(repoRoot, 'engine');
export const windowRoot = path.join(repoRoot, 'window');
export const toolingRoot = path.join(repoRoot, 'scripts', 'feature-batch-ci-window-tooling');
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const registry = 'https://registry.npmjs.org';

export async function gitHead() {
  const result = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, windowsHide: true });
  return result.stdout.trim();
}

export function run(command, args, cwd = repoRoot, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code ?? signal}`)));
  });
}

async function fetchBytes(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      assert(response.ok, `Download failed ${response.status}: ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (!(error instanceof TypeError) || attempt === 3) throw error;
      console.warn(`Transient registry download failure (attempt ${attempt}/3): ${url}`);
      await new Promise(resolve => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw new Error(`Registry download failed: ${url}`);
}

export function lockedIntegrity(lock, name, version) {
  const key = `${name}@${version}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^  '?${key}'?:\\r?\\n    resolution: \\{integrity: (sha512-[^,}]+)`, 'm');
  const value = lock.match(pattern)?.[1];
  assert(value, `Missing exact public lock integrity: ${name}@${version}`);
  return value;
}

async function verifiedTarball(name, version, expected) {
  const metadata = JSON.parse((await fetchBytes(`${registry}/${encodeURIComponent(name)}/${version}`)).toString());
  assert.equal(metadata.name, name);
  assert.equal(metadata.version, version);
  assert.equal(metadata.dist.integrity, expected, `Registry/lock mismatch: ${name}@${version}`);
  const url = new URL(metadata.dist.tarball);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'registry.npmjs.org');
  const bytes = await fetchBytes(url.href);
  const actual = `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;
  assert.equal(actual, expected, `Downloaded tarball/lock mismatch: ${name}@${version}`);
  console.log(`Verified ${name}@${version}: registry and tarball match public SHA512`);
  return bytes;
}

export async function scratchRoot() {
  const base = process.env.RUNNER_TEMP ?? process.env.BRANCH_FEATURE_BATCH_TEMP;
  assert(base, 'RUNNER_TEMP or explicit BRANCH_FEATURE_BATCH_TEMP is required');
  await fs.mkdir(base, { recursive: true });
  return fs.mkdtemp(path.join(base, 'branch-feature-batch-'));
}

export async function preparePnpm(scratch) {
  assert.equal(process.version, 'v24.19.0', 'This gate requires the reviewed Node runtime');
  const source = JSON.parse(await fs.readFile(path.join(engineRoot, 'package.json'), 'utf8'));
  const declaration = source.packageManager.match(/^pnpm@12\.5\.1\+sha512\.([a-f0-9]{128})$/);
  assert(declaration, 'Source packageManager must pin pnpm 12.5.1 and its integrity');
  const wrapperIntegrity = `sha512-${Buffer.from(declaration[1], 'hex').toString('base64')}`;
  await verifiedTarball('pnpm', '12.5.1', wrapperIntegrity);
  assert(['win32', 'darwin', 'linux'].includes(process.platform), 'Unsupported hosted platform');
  assert(['x64', 'arm64'].includes(process.arch), 'Unsupported hosted architecture');
  const name = `@pnpm/exe.${process.platform}-${process.arch}`;
  const lock = await fs.readFile(path.join(engineRoot, 'pnpm-lock.yaml'), 'utf8');
  const bytes = await verifiedTarball(name, '12.5.1', lockedIntegrity(lock, name, '12.5.1'));
  const archive = path.join(scratch, 'pnpm-native.tgz');
  const directory = path.join(scratch, 'pnpm-native');
  await fs.writeFile(archive, bytes);
  await fs.mkdir(directory);
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/tar.exe') : 'tar';
  await run(tar, ['-xzf', archive, '-C', directory, '--strip-components=1']);
  const executable = path.join(directory, process.platform === 'win32' ? 'pnpm.exe' : 'pnpm');
  if (process.platform !== 'win32') await fs.chmod(executable, 0o755);
  await run(executable, ['--version']);
  return executable;
}

const engineExceptions = [
  ['@types/mailparser', '3.9.0'], ['@types/node', '26.6.4'],
  ['@zone-eu/mailsplit', '5.4.19'], ['libbase64', '1.3.1'],
  ['libmime', '5.4.6'], ['libqp', '2.1.2'],
  ['mailparser', '3.9.33'], ['nodemailer', '10.0.13'],
];
const windowExceptions = [['@vitest/mocker', '5.0.3'], ['@vitest/spy', '5.0.3'], ['vitest', '5.0.3']];

export async function verifiedExceptionFlags(lane) {
  assert(['engine', 'window'].includes(lane));
  const lock = await fs.readFile(path.join(lane === 'engine' ? engineRoot : windowRoot, 'pnpm-lock.yaml'), 'utf8');
  const targets = lane === 'engine' ? engineExceptions : windowExceptions;
  await Promise.all(targets.map(async ([name, version]) => {
    await verifiedTarball(name, version, lockedIntegrity(lock, name, version));
  }));
  let retained = [];
  if (lane === 'engine') {
    const policy = await fs.readFile(path.join(engineRoot, 'pnpm-workspace.yaml'), 'utf8');
    assert.match(policy, /^minimumReleaseAge: 10080$/m);
    assert.match(policy, /^minimumReleaseAgeStrict: true$/m);
    retained = policy.split('minimumReleaseAgeExclude:')[1].split('\n\n')[0]
      .split('\n').map(line => line.match(/^  - "([^"]+)"/)?.[1]).filter(Boolean);
    assert.equal(retained.length, 14, 'Review changed source exclusions before changing this gate');
  }
  return [...new Set([...retained, ...targets.map(([name, version]) => `${name}@${version}`)])]
    .map(value => `--config.minimum-release-age-exclude=${value}`);
}

export async function sourceHashes() {
  const files = ['engine/package.json', 'engine/pnpm-lock.yaml', 'engine/pnpm-workspace.yaml',
    'window/package.json', 'window/pnpm-lock.yaml', 'scripts/feature-batch-ci-window-tooling/package.json',
    'scripts/feature-batch-ci-window-tooling/pnpm-lock.yaml', 'scripts/feature-batch-ci-window-tooling/pnpm-workspace.yaml',
    ...engineStrictFiles.map(file => `engine/${file}`), ...namedTests('engine').map(file => `engine/${file}`),
    ...windowStrictFiles.map(file => `window/${file}`), ...namedTests('window').map(file => `window/${file}`),
    '.github/workflows/feature-batch-checks.yml', ...['', '-runtime', '-targets', '-typecheck', '-engine.config', '-window.config']
      .map(suffix => `scripts/feature-batch-ci${suffix}.mjs`)];
  return Object.fromEntries(await Promise.all(files.map(async file => [file, sha256(await fs.readFile(path.join(repoRoot, file)))])));
}

export async function assertLocalModules(root, names) {
  const modules = path.join(root, 'node_modules');
  const stat = await fs.lstat(modules);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `${root}: node_modules must be an owned directory`);
  assert.equal(await fs.realpath(modules), modules);
  for (const name of names) {
    const real = await fs.realpath(path.join(modules, name));
    assert(real.startsWith(path.join(modules, '.pnpm') + path.sep), `Foreign module: ${name}`);
  }
}

export async function publishWindowDependencies() {
  const modules = path.join(windowRoot, 'node_modules');
  await assertLocalModules(windowRoot, []);
  const store = await fs.realpath(path.join(modules, '.pnpm'));
  assert.equal(store, path.join(modules, '.pnpm'), 'Window virtual store must be owned locally');
  const manifest = JSON.parse(await fs.readFile(path.join(toolingRoot, 'package.json'), 'utf8'));
  for (const [name, pin] of Object.entries(manifest.dependencies)) {
    const target = await fs.realpath(path.join(toolingRoot, 'node_modules', name));
    const expected = pin.startsWith('link:')
      ? await fs.realpath(path.resolve(toolingRoot, pin.slice(5))) : null;
    if (expected) assert(target.startsWith(engineRoot + path.sep), `Foreign workspace package: ${name}`);
    assert(expected ? target === expected : target.startsWith(store + path.sep),
      `Window dependency must belong to this checkout: ${name}`);
    if (!expected) {
      const installed = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'));
      assert.equal(installed.version, pin, `Unexpected Window dependency version: ${name}`);
    }
    const link = path.join(modules, name);
    await fs.mkdir(path.dirname(link), { recursive: true });
    const existing = await fs.lstat(link).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (existing) {
      assert(existing.isSymbolicLink(), `Refusing to replace an owned directory: ${link}`);
      if (await fs.realpath(link) === target) continue;
      await fs.unlink(link);
    }
    await fs.symlink(process.platform === 'win32' ? target : path.relative(path.dirname(link), target),
      link, process.platform === 'win32' ? 'junction' : 'dir');
  }
}

export async function hostedChrome() {
  const candidates = process.platform === 'win32'
    ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
        .filter(Boolean).map(root => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const browsers = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
    for (const entry of (await fs.readdir(browsers).catch(() => [])).filter(name => /^chromium-\d+$/.test(name)).sort()) {
      candidates.unshift(path.join(browsers, entry, 'chrome-win64', 'chrome.exe'));
    }
  }
  for (const file of candidates) {
    try { await fs.access(file); return file; } catch {}
  }
  throw new Error('Hosted Chrome is required for the live browser fixture; it cannot be skipped');
}

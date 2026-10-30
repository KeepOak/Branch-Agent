/**
 * Production-deploy the engine the same way a release does, then run the CLI
 * commands that need no network or credentials: --version (must match
 * engine/package.json), --help, and status --json.
 *
 * Deploy steps match desktop/scripts/release-build.mjs prepareEngine + deployEngine
 * without Electron packaging, payload prune, cua-driver staging, or signing.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { once } from 'node:events';
import {
  assertHoistedDeployment,
  productionDeployArguments,
  productionDeployEnvironment,
} from '../desktop/scripts/release-production-layout.mjs';
import {
  engineRoot,
  preparePnpm,
  run,
  scratchRoot,
  verifiedExceptionFlags,
} from './feature-batch-ci-runtime.mjs';

const execFileAsync = promisify(execFile);

export const CLI_RELEASE_DOC = 'docs/cli-release.md';
export const CLI_RELEASE_WORKFLOW = '.github/workflows/cli-release-checks.yml';
export const POSIX_CLI_PATH = '~/.local/bin/branch';
export const WINDOWS_CLI_CMD = 'bin/branch.cmd';
export const VERSION_PACKAGE = 'engine/package.json';
export const OFFLINE_COMMAND = ['status', '--json', '--timeout', '5000'];

const FORBIDDEN_PORTS = new Set([19031, 19032]);

export function versionOutputPattern(version) {
  assert.match(String(version), /^\d/);
  return new RegExp(`^Branch Agent ${escapeRegExp(version)}(?: \\([0-9a-f]{7,40}\\))?\\r?\\n$`);
}

export function assertVersionMatchesPackage(stdout, version) {
  assert.match(String(stdout), versionOutputPattern(version),
    `branch --version must report engine package.json version ${version}`);
}

export function assertHelpOutput(stdout) {
  const text = String(stdout);
  assert.match(text, /Usage:/i);
  assert.match(text, /\bstatus\b/i);
  assert.match(text, /\bdoctor\b/i);
}

export function parseJsonOutput(stdout) {
  const text = String(stdout ?? '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  assert(start >= 0 && end > start, 'CLI produced no JSON object');
  return JSON.parse(text.slice(start, end + 1));
}

export function assertStatusOutput(stdout) {
  const value = parseJsonOutput(stdout);
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.ok(Object.keys(value).length > 0, 'status --json returned an empty object');
  return value;
}

export function isolatedCliEnv(root, port) {
  assert(!FORBIDDEN_PORTS.has(Number(port)), 'CLI smoke must not use the desktop app ports');
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env,
    HOME: root,
    USERPROFILE: root,
    LOCALAPPDATA: join(root, 'AppData', 'Local'),
    APPDATA: join(root, 'AppData', 'Roaming'),
    BRANCH_HOME: root,
    BRANCH_STATE_DIR: join(root, 'state'),
    BRANCH_CONFIG_PATH: join(root, 'state', 'branch.json'),
    BRANCH_PROFILE: 'cli-release-smoke',
    BRANCH_SKIP_CHANNELS: '1',
    BRANCH_GATEWAY_PORT: String(port),
    BRANCH_SUPERVISOR_MODE: 'external',
  };
}

export async function freeLoopbackPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  assert(!FORBIDDEN_PORTS.has(port));
  await new Promise((next) => server.close(next));
  return port;
}

export async function runCli(cliRoot, args, env, timeoutMs = 60_000) {
  try {
    return await execFileAsync(process.execPath, [join(cliRoot, 'branch.mjs'), ...args], {
      cwd: cliRoot,
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutMs,
    });
  } catch (error) {
    const detail = [error?.stderr, error?.stdout, error?.message].filter(Boolean).join('\n');
    throw new Error(`branch ${args.join(' ')} failed: ${detail}`);
  }
}

export async function installProductionCli(destination, { pnpm } = {}) {
  const flags = await verifiedExceptionFlags('engine');
  const launcher = pnpm ?? await preparePnpm(await scratchRoot());
  await run(launcher, ['install', '--frozen-lockfile', '--ignore-scripts', ...flags], engineRoot);
  await run(process.execPath, ['--import', './scripts/tsx.mjs', '--input-type=module', '--eval',
    'const { withDistArtifactOwnership } = await import("./scripts/lib/dist-artifact-ownership.mts"); const { ensureKyselyTypes } = await import("./scripts/generate-kysely-types.mts"); await withDistArtifactOwnership(process.cwd(), () => ensureKyselyTypes(process.cwd()));'], engineRoot);
  for (const name of ['gateway-protocol', 'gateway-client']) {
    await run(process.execPath, ['--import', './scripts/tsx.mjs', 'scripts/build-workspace-package.mts', name], engineRoot);
  }
  await run(launcher, ['build:package'], engineRoot, { ...process.env, BRANCH_RUN_NODE_SKIP_DTS_BUILD: '1' });
  await run(launcher, productionDeployArguments(destination, flags), engineRoot, productionDeployEnvironment(process.env));
  await assertHoistedDeployment(destination);
  assert(!(await readdir(destination)).includes('src'), 'Production deployment must not be an unbuilt source checkout');
  assert((await stat(join(destination, 'branch.mjs'))).isFile(), 'Production deployment is missing branch.mjs');
  assert((await stat(join(destination, 'dist', 'build-info.json'))).isFile(), 'Production deployment is missing dist/build-info.json');
  return destination;
}

export async function smokeInstalledCli(cliRoot) {
  const source = JSON.parse(await readFile(join(engineRoot, 'package.json'), 'utf8'));
  const installed = JSON.parse(await readFile(join(cliRoot, 'package.json'), 'utf8'));
  assert.equal(installed.version, source.version, 'Deployed CLI package.json version differs from engine/package.json');
  const buildInfo = JSON.parse(await readFile(join(cliRoot, 'dist', 'build-info.json'), 'utf8'));
  if (buildInfo.version) {
    assert.equal(buildInfo.version, source.version, 'dist/build-info.json version differs from engine/package.json');
  }

  const home = await mkdtemp(join(process.env.RUNNER_TEMP ?? process.env.BRANCH_FEATURE_BATCH_TEMP ?? tmpdir(), 'cli-release-home-'));
  const port = await freeLoopbackPort();
  const env = isolatedCliEnv(home, port);
  try {
    const version = await runCli(cliRoot, ['--version'], env, 15_000);
    assertVersionMatchesPackage(version.stdout, source.version);

    const help = await runCli(cliRoot, ['--help'], env, 30_000);
    assertHelpOutput(help.stdout);

    const status = await runCli(cliRoot, OFFLINE_COMMAND, env, 90_000);
    assertStatusOutput(status.stdout);
    console.log(`CLI smoke: --version=${source.version}; --help ok; status --json ok`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  const destination = resolve(process.argv[2]
    ?? join(process.env.RUNNER_TEMP ?? process.env.BRANCH_FEATURE_BATCH_TEMP ?? tmpdir(), 'production-cli'));
  await rm(destination, { recursive: true, force: true });
  await installProductionCli(destination);
  await smokeInstalledCli(destination);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

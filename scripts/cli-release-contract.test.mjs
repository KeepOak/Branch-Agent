import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { productionDeployArguments, productionDeployEnvironment } from '../desktop/scripts/release-production-layout.mjs';
import {
  assertHelpOutput,
  assertStatusOutput,
  assertVersionMatchesPackage,
  CLI_RELEASE_DOC,
  CLI_RELEASE_WORKFLOW,
  isolatedCliEnv,
  OFFLINE_COMMAND,
  parseJsonOutput,
  POSIX_CLI_PATH,
  VERSION_PACKAGE,
  versionOutputPattern,
  WINDOWS_CLI_CMD,
} from './cli-release-smoke.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(join(root, file), 'utf8');

test('docs and workflow name the production CLI release contract', () => {
  const doc = read(CLI_RELEASE_DOC);
  const workflow = read(CLI_RELEASE_WORKFLOW);
  const smoke = read('scripts/cli-release-smoke.mjs');
  const releaseBuild = read('desktop/scripts/release-build.mjs');
  const layout = read('desktop/scripts/release-production-layout.mjs');
  const desktopOs = read('desktop/src/desktop-os.ts');
  const controls = read('desktop/src/desktop-controls.ts');
  const config = read('desktop/src/config.ts');
  const launcher = read('engine/branch.mjs');
  const enginePackage = JSON.parse(read(VERSION_PACKAGE));

  assert.match(doc, /How the CLI ships with each release/);
  assert.match(doc, /branch-engine-<release-version>-<platform>-<arch>\.tar\.gz/);
  assert.match(doc, /release-production-layout\.mjs/);
  assert.match(doc, /pnpm --filter branch deploy --prod/);
  assert.match(doc, /Type branch in any terminal/);
  assert.doesNotMatch(doc, /OpenClaw|openclaw\.ai|docs\.openclaw|github\.com\/openclaw/i);
  assert.doesNotMatch(doc, /\biOS\b/);
  assert.doesNotMatch(doc, /notarize|Developer ID|AZURE_SIGNING/i);

  assert.match(doc, new RegExp(POSIX_CLI_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(desktopOs, /~\/\.local\/bin\/branch/);
  assert.match(controls, /~\/\.local\/bin\/branch/);
  assert.match(doc, /%LOCALAPPDATA%\\BranchAgent\\bin\\branch\.cmd/);
  assert.match(desktopOs, /join\(binDir, "branch\.cmd"\)/);
  assert.match(desktopOs, /join\(binDir, "branch"\)/);
  assert.equal(WINDOWS_CLI_CMD, 'bin/branch.cmd');
  assert.match(doc, /bin[/\\]branch\.cmd/);
  assert.match(config, /LOCALAPPDATA[\s\S]*BranchAgent/);
  assert.match(config, /Library", "Application Support", "BranchAgent"/);
  assert.match(config, /\.local", "share"/);
  assert.match(config, /BranchAgent/);
  assert.match(doc, /~\/Library\/Application Support\/BranchAgent/);
  assert.match(doc, /~\/\.local\/share\/BranchAgent/);
  assert.match(doc, /%LOCALAPPDATA%\\Programs\\Branch Agent/);

  assert.match(doc, /engine\/package\.json/);
  assert.match(doc, /dist\/build-info\.json/);
  assert.match(doc, /desktop\/package\.json/);
  assert.match(doc, /branch --version/);
  assert.match(launcher, /dist\/build-info\.json/);
  assert.match(launcher, /function resolveLauncherVersion/);
  assert.equal(typeof enginePackage.version, 'string');
  assert.match(enginePackage.version, /^\d/);
  assert.equal(enginePackage.bin.branch, 'branch.mjs');

  assert.match(doc, /branch --help/);
  assert.match(doc, /branch status --json/);
  assert.deepEqual(OFFLINE_COMMAND, ['status', '--json', '--timeout', '5000']);
  assert.doesNotMatch(OFFLINE_COMMAND.join(' '), /--deep/);

  assert.match(releaseBuild, /productionDeployArguments/);
  assert.match(releaseBuild, /branch-engine-/);
  assert.match(layout, /--filter", "branch", "deploy", "--prod"/);
  assert.match(smoke, /productionDeployArguments/);
  assert.match(smoke, /productionDeployEnvironment/);
  assert.match(smoke, /assertHoistedDeployment/);
  assert.match(smoke, /build:package/);
  assert.match(smoke, /BRANCH_RUN_NODE_SKIP_DTS_BUILD/);
  assert.match(smoke, /--frozen-lockfile/);
  assert.match(smoke, /FORBIDDEN_PORTS/);
  assert.doesNotMatch(smoke, /BRANCH_GATEWAY_PORT:\s*['"]1903/);
  assert.doesNotMatch(smoke, /macSignCommand|release-signing|notariz/i);

  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /macos-latest/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /timeout-minutes:\s*15/);
  assert.match(workflow, /scripts\/cli-release-contract\.test\.mjs/);
  assert.match(workflow, /scripts\/cli-release-smoke\.mjs/);
  assert.doesNotMatch(workflow, /macos-15/);
  assert.doesNotMatch(workflow, /\bios\b|iphone|ipad/i);
  assert.doesNotMatch(workflow, /notarize|AZURE_SIGNING|APPLE_DEVELOPER/i);
});

test('production deploy arguments stay the release hoisted copy deploy', () => {
  const args = productionDeployArguments('deployment', ['--config.minimum-release-age-exclude=reviewed@1.0.0']);
  assert.deepEqual(args.slice(0, 4), ['--filter', 'branch', 'deploy', '--prod']);
  assert(args.includes('--config.node-linker=hoisted'));
  assert(args.includes('--config.package-import-method=copy'));
  assert(args.includes('--config.inject-workspace-packages=true'));
  assert(!args.includes('--legacy'));
  assert.equal(productionDeployEnvironment({ PNPM_CONFIG_VIRTUAL_STORE_DIR_MAX_LENGTH: '120' }).PNPM_CONFIG_VIRTUAL_STORE_DIR_MAX_LENGTH, '60');
});

test('version output must match the engine package version and reject a different one', () => {
  assertVersionMatchesPackage('Branch Agent 2026.9.8 (abc1234)\n', '2026.9.8');
  assertVersionMatchesPackage('Branch Agent 2026.9.8\n', '2026.9.8');
  assert.match('Branch Agent 2026.9.8 (abcdef0)\n', versionOutputPattern('2026.9.8'));
  assert.throws(() => assertVersionMatchesPackage('Branch Agent 0.4.4 (abc1234)\n', '2026.9.8'), /must report engine package.json version/);
  assert.throws(() => assertVersionMatchesPackage('0.4.4\n', '2026.9.8'));
});

test('help and status assertions accept real CLI-shaped output and reject empty text', () => {
  assertHelpOutput('Usage: branch [options] [command]\nCommands:\n  status  Show channel health\n  doctor  Health checks\n');
  assert.throws(() => assertHelpOutput('no usage here'), /Usage/);
  assert.deepEqual(parseJsonOutput('note\n{"ok":true,"gateway":{"reachable":false}}\n'), { ok: true, gateway: { reachable: false } });
  assertStatusOutput('{"channels":[],"gateway":{"reachable":false}}\n');
  assert.throws(() => assertStatusOutput('not json'), /no JSON object/);
  assert.throws(() => assertStatusOutput('{}\n'), /empty object/);
});

test('isolated CLI env keeps the smoke off the desktop app ports and inherited credentials', () => {
  const env = isolatedCliEnv('/tmp/cli-release-home', 45123);
  assert.equal(env.BRANCH_GATEWAY_PORT, '45123');
  assert.equal(env.BRANCH_SKIP_CHANNELS, '1');
  assert.equal(env.HOME, '/tmp/cli-release-home');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.GH_TOKEN, undefined);
  assert.throws(() => isolatedCliEnv('/tmp/cli-release-home', 19031), /desktop app ports/);
  assert.throws(() => isolatedCliEnv('/tmp/cli-release-home', 19032), /desktop app ports/);
});

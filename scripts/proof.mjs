#!/usr/bin/env node
// One-command screenshot proof for UI changes. Reproduces visual-tour.yml on a
// scratch setup, then runs the existing tour against selected screen ids.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { readScreens } from './visual-tour/manifest.mjs';
import { gatewayPort } from './visual-tour/gateway-port.mjs';

export const REQUIRED_NODE = '24.19.0';
export const RESERVED_PORTS = Object.freeze([19031, 19032, 19651, 5651]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseNodeVersion(version) {
  const match = String(version ?? '').replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function nodeMeetsMinimum(version, required = REQUIRED_NODE) {
  const current = parseNodeVersion(version);
  const min = parseNodeVersion(required);
  if (!current || !min) return false;
  if (current.major === 24) {
    return current.minor > min.minor || (current.minor === min.minor && current.patch >= min.patch);
  }
  return current.major > 26 || (current.major === 26 && current.minor >= 1);
}

export function nodeUpgradeMessage(current, required = REQUIRED_NODE) {
  return [
    'Node version mismatch:',
    `  Current:  v${String(current).replace(/^v/, '')}`,
    `  Required: v${required} or a newer ${required.split('.')[0]}.x patch`,
    '',
    'This script needs the Node CI uses so the engine can load .mts files.',
    'Install it with:',
    `  nvm install ${required} && nvm use ${required}`,
    `  n ${required}`,
    `  fnm install ${required} && fnm use ${required}`,
  ].join('\n');
}

export function parseProofArgs(argv) {
  const screens = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--screens' && i + 1 < argv.length) {
      screens.push(...argv[i + 1].split(',').map((id) => id.trim()).filter(Boolean));
      i += 1;
      continue;
    }
    if (arg.startsWith('--screens=')) {
      screens.push(...arg.slice('--screens='.length).split(',').map((id) => id.trim()).filter(Boolean));
    }
  }
  return { screens };
}

export function isReservedPort(port, reserved = RESERVED_PORTS) {
  return reserved.includes(Number(port));
}

function nodePathEnv(env = process.env) {
  const nodeBin = dirname(process.execPath);
  return { ...env, PATH: `${nodeBin}${delimiter}${env.PATH ?? ''}` };
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || root,
    encoding: 'utf8',
    env: nodePathEnv({ ...process.env, ...opts.env }),
    windowsHide: true,
    stdio: opts.stdio || 'pipe',
    timeout: opts.timeout || 120000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with code ${result.status}\n${result.stderr || result.stdout}`);
  }
  return result;
}

async function findFreePorts(base, count, avoid) {
  const net = await import('node:net');
  const ports = [];
  for (let port = base; ports.length < count && port < base + 1000; port += 1) {
    if (isReservedPort(port, avoid)) continue;
    try {
      await new Promise((resolveListen, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.once('listening', () => {
          server.close();
          resolveListen();
        });
        server.listen(port, '127.0.0.1');
      });
      ports.push(port);
    } catch {
      // occupied
    }
  }
  if (ports.length < count) throw new Error(`Could not find ${count} free ports starting from ${base}`);
  return ports;
}

async function waitForHttp(url, attempts = 90) {
  const http = await import('node:http');
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const ok = await new Promise((resolveReady) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolveReady(res.statusCode === 200);
      });
      req.on('error', () => resolveReady(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolveReady(false);
      });
    });
    if (ok) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
  }
  throw new Error(`${url} did not become ready`);
}

function checkNodeVersion() {
  if (nodeMeetsMinimum(process.versions.node)) return;
  console.error(`\n${nodeUpgradeMessage(process.versions.node)}\n`);
  process.exit(1);
}

async function main() {
  checkNodeVersion();

  const { screens: screenFilter } = parseProofArgs(process.argv.slice(2));
  const screens = await readScreens(new URL('./visual-tour/screens.json', import.meta.url));
  const selected = screenFilter.length ? screens.filter((screen) => screenFilter.includes(screen.id)) : screens;
  if (selected.length === 0) {
    console.error('No screens matched the filter. Available screens:');
    console.error(screens.map((screen) => `  - ${screen.id}`).join('\n'));
    process.exit(1);
  }

  console.log(`Running proof for ${selected.length} screen(s): ${selected.map((screen) => screen.id).join(', ')}`);

  const startTime = Date.now();
  const stateDir = mkdtempSync(resolve(tmpdir(), 'branch-proof-'));
  const outputDir = resolve(root, 'artifacts/proof');
  mkdirSync(outputDir, { recursive: true });

  const [gateway, windowPort] = await findFreePorts(20000, 2, RESERVED_PORTS);
  const gatewayToken = randomBytes(32).toString('hex');
  const tokenFile = resolve(stateDir, 'token');
  writeFileSync(tokenFile, gatewayToken, { mode: 0o600 });

  const env = nodePathEnv({
    ...process.env,
    BRANCH_HOME: stateDir,
    BRANCH_SKIP_CHANNELS: '1',
    BRANCH_GATEWAY_TOKEN: gatewayToken,
    VISUAL_GATEWAY_PORT: String(gateway),
    VISUAL_WINDOW_PORT: String(windowPort),
    VISUAL_OUT: outputDir,
    VISUAL_TOKEN_FILE: tokenFile,
    VISUAL_SCREENS: selected.map((screen) => screen.id).join(','),
  });
  if (Number(gatewayPort(env)) !== gateway) {
    throw new Error(`gateway-port helper rejected scratch port ${gateway}`);
  }

  console.log('Building engine (ciBuildSeed)...');
  run('pnpm', ['install', '--frozen-lockfile'], { cwd: resolve(root, 'engine') });
  run(process.execPath, ['--import', './scripts/tsx.mjs', 'scripts/build-all.mts', 'ciBuildSeed'], {
    cwd: resolve(root, 'engine'),
    timeout: 300000,
  });

  console.log('Building window...');
  run('pnpm', ['install', '--frozen-lockfile'], { cwd: resolve(root, 'window') });
  run('pnpm', ['build'], { cwd: resolve(root, 'window'), timeout: 180000 });

  console.log('Installing Playwright...');
  run('pnpm', ['-C', 'engine', 'exec', 'playwright', 'install', 'chromium']);

  console.log(`Starting gateway on port ${gateway}...`);
  const gatewayProc = spawn(process.execPath, ['branch.mjs', 'gateway', '--dev', '--port', String(gateway)], {
    cwd: resolve(root, 'engine'),
    env,
    windowsHide: true,
    stdio: 'pipe',
  });

  console.log(`Starting window preview on port ${windowPort}...`);
  const windowProc = spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(windowPort), '--strictPort'],
    { cwd: resolve(root, 'window'), env, windowsHide: true, stdio: 'pipe' },
  );

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    console.log('Cleaning up processes...');
    for (const child of [gatewayProc, windowProc]) {
      try {
        if (child.pid) process.kill(child.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);

  try {
    console.log('Waiting for services to be ready...');
    await waitForHttp(`http://127.0.0.1:${gateway}/readyz`);
    await waitForHttp(`http://127.0.0.1:${windowPort}/`);
    console.log('Services ready!');
    console.log('Seeding data...');
    run(process.execPath, ['scripts/visual-tour/seed.mjs'], { cwd: root, env });
    console.log('Capturing screenshots...');
    run(process.execPath, ['scripts/visual-tour/tour.mjs'], { cwd: root, env, timeout: 300000, stdio: 'inherit' });
  } finally {
    cleanup();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nProof complete in ${elapsed}s`);
  console.log(`Output: ${outputDir}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error('Proof failed:', error.message);
    process.exit(1);
  });
}
